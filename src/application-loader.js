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
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
// Revision covers the hashes of every file the version delivers, each list sorted by its key so
// that the same tree published in a different declaration order keeps the same revision.
export async function manifestRevision(value) {
  const hashes = (entries) =>
    Object.entries(entries ?? {})
      .sort(byKey)
      .map(([key, entry]) => [key, entry.sha256]);
  const root = [value.source.sha256, value.script.sha256, hashes(value.descriptors)];
  const parts =
    value.version === 2
      ? [
          ...root,
          Object.entries(value.components ?? {})
            .sort(byKey)
            .map(([key, child]) => [
              key,
              child.source.sha256,
              child.script.sha256,
              hashes(child.descriptors),
            ]),
        ]
      : root;
  return sha256(encoder.encode(JSON.stringify(parts)));
}
// A version 2 manifest lists the whole tree; version 1 describes one package and must not carry a
// `components` key at all, so an older loader never silently drops children it cannot see.
async function manifest(value, base) {
  if (
    !value ||
    ![1, 2].includes(value.version) ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    (value.version === 1 && Object.hasOwn(value, "components")) ||
    (value.version === 2 &&
      (!Object.hasOwn(value, "components") ||
        typeof value.components !== "object" ||
        value.components === null ||
        Array.isArray(value.components)))
  )
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
  // Children are read as own properties into a null-prototype map keyed by the href their relative
  // key resolves to, so a `__proto__` key and `a.json` vs `./a.json` are both plain collisions.
  const components = Object.create(null);
  if (value.version === 2) {
    const bad = () => new Error("マニフェストのコンポーネント情報が不正です");
    const children = Object.entries(value.components);
    if (children.length > 8) throw bad();
    for (const [key, child] of children) {
      if (!child || typeof child !== "object" || Array.isArray(child)) throw bad();
      let href;
      try {
        check(child.source, 1_000_000);
        check(child.script, 100_000);
        const own = child.descriptors ?? {};
        if (typeof own !== "object" || Array.isArray(own) || Object.keys(own).length > 8)
          throw bad();
        for (const entry of Object.values(own)) check(entry, 1_000_000);
        href = httpUrl(key, base).href;
      } catch {
        throw bad();
      }
      if (Object.hasOwn(components, href)) throw bad();
      components[href] = child;
    }
  }
  // A coarse gate on the delivered bytes before anything is fetched. Descriptors travel over the
  // buffer ABI rather than the request, so only bodies and scripts count; `load` has the final say
  // on the JSON-encoded length. The root alone cannot reach the limit, so a child is always named.
  const total = [value, ...Object.values(components)].reduce(
    (sum, entry) => sum + entry.source.size + entry.script.size,
    0,
  );
  if (total > 2_000_000) {
    const [href, bytes] = Object.entries(components)
      .map(([key, child]) => [key, child.source.size + child.script.size])
      .sort((a, b) => b[1] - a[1] || byKey(a, b))[0];
    throw new Error(
      `配信ファイルの合計が2 MBを超えています（合計 ${total} バイト。最大の子: ${href} ${bytes} バイト）`,
    );
  }
  if (value.revision !== (await manifestRevision(value)))
    throw new Error("配信revisionとファイルのハッシュが一致しません");
  return value;
}
async function verify(bytes, entry) {
  if (bytes.length !== entry.size || (await sha256(bytes)) !== entry.sha256)
    throw new Error("配信ファイルのサイズ・ハッシュが一致しません");
  return bytes;
}
// One delivered package judged against the files that came with it: the screen parses, its RPC
// descriptor set matches the delivered descriptors exactly and it names a script URL. The root and
// every child go through the same gate, so a child reports the same refusals the root does.
function parsed(url, source, script, descriptors) {
  const format = packageFormat(url);
  const screen = parsePackage(decoder.decode(source), format);
  const wanted = [...new Set(Object.values(screen.rpc ?? {}).map((r) => r.descriptor))];
  if (
    wanted.some((key) => typeof key !== "string" || !Object.hasOwn(descriptors, key)) ||
    Object.keys(descriptors).some((key) => !wanted.includes(key))
  )
    throw new Error("RPCのDescriptorと配信ファイルが一致しません");
  if (typeof screen.script !== "string") throw new Error("script URLがありません");
  return { screen, format, script: decoder.decode(script), source: decoder.decode(source) };
}
// True when a shared package was built from exactly the files a manifest entry names. A token
// swapped behind the same hashes is not detected here; a changed file always is.
function sameHashes(hashes, child) {
  const own = child.descriptors ?? {};
  const keys = Object.keys(own);
  return (
    hashes.source === child.source.sha256 &&
    hashes.script === child.script.sha256 &&
    keys.length === Object.keys(hashes.descriptors).length &&
    keys.every((key) => hashes.descriptors[key] === own[key].sha256)
  );
}
export class ApplicationLoader {
  // The children of the screens this runtime has loaded, keyed by href, so moving between two
  // screens that place the same part does not fetch it twice. Only the root is always taken fresh.
  #share = new Map();
  #shareKey = { mode: undefined, auth: undefined };
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
    const { screen, format, script: text, source: body } = parsed(url, source, script, descriptors);
    return {
      screen,
      script: text,
      source: body,
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
  // href it resolves to against the package that declares it. Each href is supplied once even when
  // it is placed twice, so the returned map is keyed by href and holds one body per package. Where
  // the bodies come from is the supplier's business: the cycle, depth, count and scope rules are
  // judged here so every path is held to the same contract.
  async #walk(screen, url, signal, provide) {
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
        const entry = await provide(child, name);
        packages[child.href] = entry;
        await visit(entry.screen, child, depth + 1, [...stack, child.href]);
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
  // Supplies a child by downloading it from its own URL, hashing the files once while they are in
  // hand so a later load can tell this body apart from the one a manifest promises.
  #fromNetwork(signal) {
    return async (href) => {
      // network-only has nothing to compare a body against, so a shared child is taken as it is.
      const shared = this.#share.get(href.href);
      if (shared) return shared;
      const downloaded = await this.#download(href, signal);
      const hashes = {
        source: await sha256(downloaded.source),
        script: await sha256(downloaded.script),
        descriptors: Object.create(null),
      };
      for (const [key, bytes] of Object.entries(downloaded.descriptors))
        hashes.descriptors[key] = await sha256(bytes);
      return {
        screen: downloaded.screen,
        script: decoder.decode(downloaded.script),
        descriptors: downloaded.descriptors,
        sourceBytes: downloaded.source,
        scriptBytes: downloaded.script,
        hashes,
      };
    };
  }
  // The children a version 2 manifest lists, keyed by the href their relative key resolves to.
  // `manifest()` has already refused duplicate hrefs, so the map holds one entry per child.
  #childIndex(metadata, base) {
    const index = Object.create(null);
    for (const [key, child] of Object.entries(metadata.components ?? {}))
      index[httpUrl(key, base).href] = child;
    return index;
  }
  // Supplies a child from the files the manifest delivers, each one verified against its entry.
  // A declaration the manifest says nothing about is refused before any URL is guessed at.
  #fromManifest(index, base, signal) {
    return async (href) => {
      const child = index[href.href];
      if (!child)
        throw new Error(
          `マニフェストのコンポーネント情報が不正です（マニフェストに無い子: ${href.href}）`,
        );
      // A shared body stands in only while the manifest promises the very files it was built from:
      // one differing hash, a descriptor's included, means this version delivers something else.
      const shared = this.#share.get(href.href);
      if (shared && sameHashes(shared.hashes, child)) return shared;
      const file = async (entry) => {
        const bytes = await this.resources.bytes(httpUrl(entry.url, base), { signal });
        try {
          return await verify(bytes, entry);
        } catch {
          // Which package the damaged file belongs to is the part the root's own wording lacks.
          throw new Error(`配信ファイルのサイズ・ハッシュが一致しません（${href.href}）`);
        }
      };
      const source = await file(child.source);
      const script = await file(child.script);
      const descriptors = Object.create(null);
      const hashes = {
        source: child.source.sha256,
        script: child.script.sha256,
        descriptors: Object.create(null),
      };
      for (const key of Object.keys(child.descriptors ?? {}).sort()) {
        descriptors[key] = await file(child.descriptors[key]);
        hashes.descriptors[key] = child.descriptors[key].sha256;
      }
      const judged = parsed(href, source, script, descriptors);
      return {
        screen: judged.screen,
        script: judged.script,
        descriptors,
        sourceBytes: source,
        scriptBytes: script,
        hashes,
      };
    };
  }
  // Every child the manifest lists must have been reached through a declaration; a key nothing
  // places would otherwise ride along in the revision without ever being loaded.
  #matchTree(index, packages) {
    const extra = Object.keys(index)
      .filter((href) => !packages[href])
      .sort();
    if (extra.length)
      throw new Error(`マニフェストのコンポーネント情報が不正です（宣言に無い子: ${extra[0]}）`);
  }
  // Keeps the children of a walk that completed every check. An abort or a refusal partway leaves
  // the map untouched, so no later load inherits a package that was never judged whole.
  #remember(packages) {
    for (const [href, entry] of Object.entries(packages)) this.#share.set(href, entry);
  }
  async fetch(value, { mode = "network-only", signal, refresh = false } = {}) {
    const url = httpUrl(value);
    if (!["network-only", "network-first"].includes(mode))
      throw new Error("未対応のキャッシュ方式です");
    // Both keys are compared by value: `getAuthentication` builds a new object on every call and
    // the host assigns the cache mode on every load, so an unchanged setting must keep the tree.
    const auth = JSON.stringify(this.resources.getAuthentication());
    if (refresh || mode !== this.#shareKey.mode || auth !== this.#shareKey.auth)
      this.#share.clear();
    this.#shareKey = { mode, auth };
    if (mode === "network-only") {
      const { source, script, descriptors } = await this.#download(url, signal);
      const candidate = await this.#candidate(url, source, script, descriptors);
      candidate.components = await this.#walk(
        candidate.screen,
        url,
        signal,
        this.#fromNetwork(signal),
      );
      this.#remember(candidate.components);
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
      const candidate = await this.#candidate(
        url,
        source,
        script,
        descriptors,
        "network",
        metadata,
      );
      const index = this.#childIndex(metadata, sidecar);
      const packages = await this.#walk(
        candidate.screen,
        url,
        signal,
        this.#fromManifest(index, sidecar, signal),
      );
      this.#matchTree(index, packages);
      signal?.throwIfAborted();
      if (this.resources.getAuthentication().mode !== "none")
        throw new Error("認証設定が変更されたためキャッシュを中止しました");
      candidate.components = packages;
      this.#remember(packages);
      return candidate;
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
          // Until the stored tree is walked on this path, a saved screen that declares children
          // cannot be rebuilt. Refusing it is a decision, not a damaged generation, so it must not
          // fall through to the previous pointer.
          if (candidate) {
            if (Object.keys(candidate.screen.components ?? {}).length)
              throw new Error("マニフェストのコンポーネント情報が不正です");
            candidate.components = Object.create(null);
            return candidate;
          }
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
