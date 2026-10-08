import { OpfsDirectory, withFileLock } from "./opfs.js";
import { packageFormat, parsePackage } from "./package-format.js";
import { httpUrl } from "./http-policy.js";
import { instanceTable, scopeProblem } from "./component-tree.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export async function sha256(bytes) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function manifestRevision(value) {
  return sha256(
    encoder.encode(
      JSON.stringify([
        value.source.sha256,
        value.script.sha256,
        Object.entries(value.descriptors ?? {})
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, entry.sha256]),
      ]),
    ),
  );
}
async function manifest(value, base) {
  if (!value || value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.revision))
    throw new Error("配信マニフェストが不正です");
  const check = (entry, limit) => {
    if (
      !entry ||
      typeof entry.url !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > limit
    )
      throw new Error("マニフェストのファイル情報が不正です");
    httpUrl(entry.url, base);
  };
  check(value.source, 1_000_000);
  check(value.script, 100_000);
  const descriptors = value.descriptors ?? {};
  if (
    typeof descriptors !== "object" ||
    Array.isArray(descriptors) ||
    Object.keys(descriptors).length > 8
  )
    throw new Error("マニフェストの型情報が不正です");
  for (const entry of Object.values(descriptors)) check(entry, 1_000_000);
  if (value.revision !== (await manifestRevision(value)))
    throw new Error("配信revisionとファイルのハッシュが一致しません");
  return value;
}
async function verify(bytes, entry) {
  if (bytes.length !== entry.size || (await sha256(bytes)) !== entry.sha256)
    throw new Error("配信ファイルのサイズ・ハッシュが一致しません");
  return bytes;
}
// The delivery cache keeps one manifest per package, so a screen that pulls in children cannot be
// restored as a whole yet. Both cache paths refuse such screens and report no children.
function withoutComponents(candidate) {
  if (Object.keys(candidate.screen.components ?? {}).length)
    throw new Error("componentsを持つ画面は配信キャッシュ（network-first）に対応していません");
  candidate.components = Object.create(null);
  return candidate;
}
export class ApplicationLoader {
  constructor({ resources, storage, locks } = {}) {
    this.resources = resources;
    this.storage = storage;
    this.locks = locks;
  }
  async #directory(url) {
    return new OpfsDirectory(["uivolve-web", "cache", await sha256(encoder.encode(url.href))], {
      storage: this.storage,
    });
  }
  async #candidate(url, source, script, descriptors = {}, status = "network", metadata) {
    const format = packageFormat(url);
    const screen = parsePackage(decoder.decode(source), format);
    const wanted = [...new Set(Object.values(screen.rpc ?? {}).map((r) => r.descriptor))];
    if (
      wanted.some((key) => typeof key !== "string" || !Object.hasOwn(descriptors, key)) ||
      Object.keys(descriptors).some((key) => !wanted.includes(key))
    )
      throw new Error("RPCのDescriptorと配信ファイルが一致しません");
    if (typeof screen.script !== "string") throw new Error("script URLがありません");
    return {
      screen,
      script: decoder.decode(script),
      source: decoder.decode(source),
      format,
      url,
      descriptors,
      status,
      metadata,
      sourceBytes: source,
      scriptBytes: script,
    };
  }
  // One package without its children: body, script and RPC descriptors, all relative to url.
  async #download(url, signal) {
    const source = encoder.encode(await this.resources.text(url, { signal }));
    const screen = parsePackage(decoder.decode(source), packageFormat(url));
    if (typeof screen.script !== "string") throw new Error("script URLがありません");
    const script = encoder.encode(
      await this.resources.text(httpUrl(screen.script, url), { signal }),
    );
    if (script.length > 100_000) throw new Error("Rhaiは100 KB以内にしてください");
    const descriptors = Object.create(null);
    for (const key of new Set(Object.values(screen.rpc ?? {}).map((r) => r.descriptor))) {
      if (typeof key !== "string") throw new Error("RPCのdescriptor URLが必要です");
      descriptors[key] = await this.resources.bytes(httpUrl(key, url), { signal });
    }
    return { source, screen, script, descriptors };
  }
  // Walks the components declarations depth first, rewriting every declared url to the absolute
  // href it resolves to against the package that declares it. Each href is downloaded once even
  // when it is placed twice, so the returned map is keyed by href and holds one body per package.
  async #components(screen, url, signal) {
    const packages = Object.create(null);
    if (!Object.keys(screen.components ?? {}).length) return packages;
    const visit = async (parent, base, depth, stack) => {
      for (const [name, declaration] of Object.entries(parent.components ?? {})) {
        if (typeof declaration?.url !== "string")
          throw new Error(
            `コンポーネント ${name} の宣言が不正です（url を文字列で指定してください）`,
          );
        const child = httpUrl(declaration.url, base);
        declaration.url = child.href;
        if (stack.includes(child.href))
          throw new Error(`コンポーネント ${name} の循環参照: ${child.href}`);
        if (depth + 1 > 3)
          throw new Error(`コンポーネントの入れ子が3段を超えています: ${child.href}`);
        if (packages[child.href]) continue;
        const downloaded = await this.#download(child, signal);
        packages[child.href] = {
          screen: downloaded.screen,
          script: decoder.decode(downloaded.script),
        };
        await visit(downloaded.screen, child, depth + 1, [...stack, child.href]);
      }
    };
    await visit(screen, url, 1, [url.href]);
    // Only an Instance that keeps data of its own needs a scope, so a child declaring neither
    // storage nor files may sit at an itemId the scope rules would refuse.
    for (const [path, entry] of instanceTable(screen, url.href, packages)) {
      const keeps =
        Object.keys(entry.screen.storage ?? {}).length ||
        Object.keys(entry.screen.files ?? {}).length;
      if (!path || !keeps) continue;
      const problem = scopeProblem(screen.id, path);
      if (problem) throw new Error(problem);
    }
    return packages;
  }
  async fetch(value, { mode = "network-only", signal } = {}) {
    const url = httpUrl(value);
    if (!["network-only", "network-first"].includes(mode))
      throw new Error("未対応のキャッシュ方式です");
    if (mode === "network-only") {
      const { source, script, descriptors } = await this.#download(url, signal);
      const candidate = await this.#candidate(url, source, script, descriptors);
      candidate.components = await this.#components(candidate.screen, url, signal);
      return candidate;
    }
    if (this.resources.getAuthentication().mode !== "none")
      throw new Error("配信キャッシュは認証なしの場合に利用できます");
    try {
      const sidecar = new URL(url);
      sidecar.pathname += ".manifest.json";
      const metadata = await manifest(
        JSON.parse(await this.resources.text(sidecar, { signal })),
        sidecar,
      );
      const source = await verify(
        await this.resources.bytes(httpUrl(metadata.source.url, sidecar), { signal }),
        metadata.source,
      );
      const script = await verify(
        await this.resources.bytes(httpUrl(metadata.script.url, sidecar), { signal }),
        metadata.script,
      );
      const descriptors = Object.create(null);
      for (const [key, entry] of Object.entries(metadata.descriptors ?? {}))
        descriptors[key] = await verify(
          await this.resources.bytes(httpUrl(entry.url, sidecar), { signal }),
          entry,
        );
      signal?.throwIfAborted();
      if (this.resources.getAuthentication().mode !== "none")
        throw new Error("認証設定が変更されたためキャッシュを中止しました");
      return withoutComponents(
        await this.#candidate(url, source, script, descriptors, "network", metadata),
      );
    } catch (e) {
      signal?.throwIfAborted();
      if (e.code !== "NETWORK" || this.resources.getAuthentication().mode !== "none") throw e;
      const candidate = await this.restore(url, { signal });
      if (this.resources.getAuthentication().mode !== "none")
        throw new Error("認証設定が変更されたためキャッシュを中止しました");
      candidate.fallbackReason = e.message;
      return candidate;
    }
  }
  async save(candidate, { signal } = {}) {
    if (!candidate.metadata || candidate.status !== "network") return;
    if (this.resources.getAuthentication().mode !== "none")
      throw new Error("認証付きソースはキャッシュしません");
    const directory = await this.#directory(candidate.url);
    const lock = `uivolve-web:cache:${candidate.url.href}`;
    await withFileLock(
      lock,
      async () => {
        const revision = candidate.metadata.revision;
        const path = `versions/${revision}`;
        await directory.mkdir(path, { signal });
        await directory.write(`${path}/source`, candidate.sourceBytes, { signal });
        await directory.write(`${path}/script`, candidate.scriptBytes, { signal });
        const keys = Object.keys(candidate.descriptors).sort();
        for (let i = 0; i < keys.length; i++)
          await directory.write(`${path}/descriptor-${i}`, candidate.descriptors[keys[i]], {
            signal,
          });
        signal?.throwIfAborted();
        if (this.resources.getAuthentication().mode !== "none")
          throw new Error("認証設定が変更されたためキャッシュを中止しました");
        const pointer = encoder.encode(
          JSON.stringify({ url: candidate.url.href, metadata: candidate.metadata }),
        );
        try {
          const old = await directory.read("current.json", { signal });
          // Preserve only valid metadata. All source files are checked on restore.
          const previous = JSON.parse(decoder.decode(old));
          if (previous.url === candidate.url.href && previous.metadata?.revision !== revision) {
            await manifest(previous.metadata, candidate.url);
            await directory.write("previous.json", old, { signal });
          }
        } catch (e) {
          if (e.name !== "NotFoundError" && !(e instanceof SyntaxError)) throw e;
        }
        await directory.write("current.json", pointer, { signal });
        const keep = new Set([revision]);
        try {
          const previous = JSON.parse(
            decoder.decode(await directory.read("previous.json", { signal })),
          );
          if (previous.url === candidate.url.href)
            keep.add((await manifest(previous.metadata, candidate.url)).revision);
        } catch {
          signal?.throwIfAborted();
        }
        const versions = await directory.directory(["versions"], { signal });
        for await (const [name, handle] of versions.entries()) {
          signal?.throwIfAborted();
          if (handle.kind === "directory" && /^[a-f0-9]{64}$/.test(name) && !keep.has(name))
            await versions.removeEntry(name, { recursive: true });
        }
      },
      { signal, locks: this.locks },
    );
  }
  async restore(value, { signal } = {}) {
    const url = httpUrl(value);
    const directory = await this.#directory(url);
    return withFileLock(
      `uivolve-web:cache:${url.href}`,
      async () => {
        for (const pointer of ["current.json", "previous.json"]) {
          let candidate;
          try {
            const stored = JSON.parse(decoder.decode(await directory.read(pointer, { signal })));
            if (stored.url !== url.href) throw new Error("キャッシュのURLが一致しません");
            const metadata = await manifest(stored.metadata, url);
            const path = `versions/${metadata.revision}`;
            const source = await verify(
              await directory.read(`${path}/source`, { signal }),
              metadata.source,
            );
            const script = await verify(
              await directory.read(`${path}/script`, { signal }),
              metadata.script,
            );
            const descriptors = Object.create(null);
            let i = 0;
            for (const key of Object.keys(metadata.descriptors ?? {}).sort())
              descriptors[key] = await verify(
                await directory.read(`${path}/descriptor-${i++}`, { signal }),
                metadata.descriptors[key],
              );
            signal?.throwIfAborted();
            candidate = await this.#candidate(url, source, script, descriptors, "cache", metadata);
          } catch {
            signal?.throwIfAborted();
          }
          // Refusing a restored screen that declares components is a decision, not a damaged
          // generation, so it must not fall through to the previous pointer.
          if (candidate) return withoutComponents(candidate);
        }
        throw new Error("通信に失敗し、利用できる保存版もありません");
      },
      { signal, locks: this.locks },
    );
  }
  async clear(value, { signal } = {}) {
    const url = httpUrl(value);
    const directory = await this.#directory(url);
    await withFileLock(
      `uivolve-web:cache:${url.href}`,
      async () => {
        try {
          const root = new OpfsDirectory(directory.parts.slice(0, -1), { storage: this.storage });
          const handle = await root.directory([], { signal });
          await handle.removeEntry(directory.parts.at(-1), { recursive: true });
        } catch (e) {
          if (e.name !== "NotFoundError") throw e;
        }
      },
      { signal, locks: this.locks },
    );
  }
}
