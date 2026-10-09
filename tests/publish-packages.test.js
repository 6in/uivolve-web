import { afterAll, describe, expect, it } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishPackage } from "../scripts/publish-packages.mjs";
import { ApplicationLoader, manifestRevision, sha256 } from "../src/application-loader.js";
import { httpUrl } from "../src/http-policy.js";
import { ResourceClient } from "../src/resource-client.js";
import { memoryOpfs } from "./helpers/opfs.js";

const encoder = new TextEncoder();
const screensDirectory = fileURLToPath(new URL("../public/screens/", import.meta.url));

const temporary = [];
// A tree of screen files on disk: `files` maps a path relative to the workspace to either the text
// to write or the value to encode as JSON. The output directory is never created here, so a refusal
// can be told apart from an empty delivery.
async function workspace(files) {
  const root = await mkdtemp(join(tmpdir(), "uivolve-publish-"));
  temporary.push(root);
  for (const [path, value] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  }
  return root;
}
afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const screen = (id, extra = {}) => ({
  version: 1,
  id,
  title: id,
  script: `${id}.rhai`,
  state: {},
  ui: { xtype: "container", items: [] },
  ...extra,
});
const node = (xtype) => ({ xtype, itemId: xtype });
// Exactly `bytes` long once encoded: the padding is appended last, so the characters added inside
// its quotes are the only difference from the screen as written.
function padded(value, bytes) {
  const text = JSON.stringify({ ...value, pad: "" });
  const fill = bytes - encoder.encode(text).length;
  expect(fill).toBeGreaterThanOrEqual(0);
  return JSON.stringify({ ...value, pad: "p".repeat(fill) });
}
const files = (value) => [value.source, value.script, ...Object.values(value.descriptors ?? {})];
const everyFile = (metadata) => [
  ...files(metadata),
  ...Object.values(metadata.components ?? {}).flatMap(files),
];
// A refusal leaves nothing behind: neither the `packages/` directory nor the sidecar.
const untouched = async (output) => expect(await readdir(output).catch(() => [])).toEqual([]);

// Serves a published tree over HTTP out of the directory it was written to: the sidecar at
// `<name>.manifest.json` and every file at the url its manifest entry names, so the loader reads
// back exactly the bytes the builder produced.
async function deliver(directory, name, text) {
  const base = "https://publish.test/screens/";
  const url = new URL(name, base);
  const sidecar = new URL(`${name}.manifest.json`, base);
  const metadata = JSON.parse(text);
  const responses = new Map([[sidecar.href, text]]);
  for (const entry of everyFile(metadata))
    responses.set(new URL(entry.url, sidecar).href, await readFile(join(directory, entry.url)));
  const fetcher = async (value) => {
    const kept = responses.get(String(value));
    if (kept instanceof Error) throw kept;
    if (kept === undefined) return new Response("missing", { status: 404 });
    return new Response(kept);
  };
  const resources = new ResourceClient({ baseUrl: base, fetch: fetcher });
  const fs = memoryOpfs();
  return {
    url,
    sidecar,
    responses,
    metadata,
    fs,
    loader: new ApplicationLoader({ resources, storage: fs.storage, locks: null }),
  };
}

describe("配信用パッケージの公開", () => {
  // The root declares a child in a subdirectory and a child of its own directory that carries an
  // RPC descriptor from outside `screens/`; the middle child reaches a sibling and a screen outside
  // the root's directory, so the keys cover `..`, a subdirectory and a plain name at once.
  const tree = () => ({
    "screens/root.json": screen("root", {
      components: { mid: { url: "parts/mid.json" }, rpc: { url: "rpc.json" } },
      ui: { xtype: "container", items: [node("mid"), node("rpc")] },
    }),
    "screens/root.rhai": "fn root(s) { s }",
    "screens/rpc.json": screen("rpc", {
      rpc: {
        echo: {
          url: "http://127.0.0.1:4180/uivolve.demo.EchoService/Echo",
          descriptor: "../rpc-demo.pb",
          service: "uivolve.demo.EchoService",
          method: "Echo",
          protocol: "connect",
          handler: "echoDone",
        },
      },
    }),
    "screens/rpc.rhai": "fn rpc(s) { s }",
    "screens/parts/mid.json": screen("mid", {
      components: { leaf: { url: "./leaf.json" }, shared: { url: "../../shared/x.json" } },
      ui: { xtype: "container", items: [node("leaf"), node("shared")] },
    }),
    "screens/parts/mid.rhai": "fn mid(s) { s }",
    "screens/parts/leaf.json": screen("leaf"),
    "screens/parts/leaf.rhai": "fn leaf(s) { s }",
    "shared/x.json": screen("x"),
    "shared/x.rhai": "fn x(s) { s }",
    "rpc-demo.pb": "descriptor bytes",
  });
  const CHILDREN = ["../shared/x.json", "parts/leaf.json", "parts/mid.json", "rpc.json"];

  it("keys every child by its path relative to the root and publishes the files it names", async () => {
    const root = await workspace(tree());
    const output = join(root, "out");
    const metadata = await publishPackage(join(root, "screens/root.json"), output);
    expect(metadata.version).toBe(2);
    expect(metadata.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(metadata.components).sort()).toEqual(CHILDREN);
    // The root carries no RPC of its own; the descriptor belongs to the child that declares it.
    expect(metadata.descriptors).toEqual({});
    expect(Object.keys(metadata.components["rpc.json"].descriptors)).toEqual(["../rpc-demo.pb"]);
    for (const entry of everyFile(metadata)) {
      expect(entry.url.startsWith(`packages/${metadata.revision}/`)).toBe(true);
      const bytes = await readFile(join(output, entry.url));
      expect(await sha256(bytes), entry.url).toBe(entry.sha256);
      expect(bytes.length, entry.url).toBe(entry.size);
    }
    expect(await manifestRevision(metadata)).toBe(metadata.revision);
    expect(JSON.parse(await readFile(join(output, "root.json.manifest.json"), "utf8"))).toEqual(
      metadata,
    );
  });

  it("delivers the published tree to the loader and restores it from the store", async () => {
    const root = await workspace(tree());
    const output = join(root, "out");
    await publishPackage(join(root, "screens/root.json"), output);
    const text = await readFile(join(output, "root.json.manifest.json"), "utf8");
    const served = await deliver(output, "root.json", text);
    const candidate = await served.loader.fetch(served.url, { mode: "network-first" });
    expect(candidate.status).toBe("network");
    expect(candidate.metadata.version).toBe(2);
    // The key the builder wrote and the href the loader resolves it to name the same child.
    expect(Object.keys(candidate.components).sort()).toEqual(
      CHILDREN.map((key) => httpUrl(key, served.url).href).sort(),
    );
    expect(candidate.components[httpUrl("../shared/x.json", served.url).href].screen.id).toBe("x");
    expect(candidate.components[httpUrl("rpc.json", served.url).href].descriptors).toEqual({
      "../rpc-demo.pb": encoder.encode("descriptor bytes"),
    });
    await served.loader.save(candidate);
    const restored = await served.loader.restore(served.url);
    expect(restored.metadata.revision).toBe(candidate.metadata.revision);
    expect(restored.source).toBe(candidate.source);
    expect(Object.keys(restored.components).sort()).toEqual(
      Object.keys(candidate.components).sort(),
    );
  });

  it("refuses a tree whose child declares its way back to an ancestor", async () => {
    const root = await workspace({
      "screens/root.json": screen("root", {
        components: { mid: { url: "parts/mid.json" } },
        ui: { xtype: "container", items: [node("mid")] },
      }),
      "screens/root.rhai": "fn root(s) { s }",
      "screens/parts/mid.json": screen("mid", { components: { back: { url: "../root.json" } } }),
      "screens/parts/mid.rhai": "fn mid(s) { s }",
    });
    const output = join(root, "out");
    await expect(publishPackage(join(root, "screens/root.json"), output)).rejects.toThrow(
      "循環参照",
    );
    await untouched(output);
  });

  it("refuses a tree that nests one level deeper than the contract allows", async () => {
    const chain = {
      "screens/root.json": screen("root", {
        components: { a: { url: "a.json" } },
        ui: { xtype: "container", items: [node("a")] },
      }),
      "screens/root.rhai": "fn root(s) { s }",
      "screens/a.json": screen("a", {
        components: { b: { url: "b.json" } },
        ui: { xtype: "container", items: [node("b")] },
      }),
      "screens/a.rhai": "fn a(s) { s }",
      "screens/b.json": screen("b", {
        components: { c: { url: "c.json" } },
        ui: { xtype: "container", items: [node("c")] },
      }),
      "screens/b.rhai": "fn b(s) { s }",
      "screens/c.json": screen("c"),
      "screens/c.rhai": "fn c(s) { s }",
    };
    const root = await workspace(chain);
    const output = join(root, "out");
    await expect(publishPackage(join(root, "screens/root.json"), output)).rejects.toThrow(
      "コンポーネントの入れ子が3段を超えています",
    );
    await untouched(output);
  });

  it("refuses a tree that places a ninth Instance", async () => {
    const parts = {};
    const declarations = {};
    const items = [];
    for (let i = 0; i < 8; i++) {
      parts[`screens/p${i}.json`] = screen(`p${i}`);
      parts[`screens/p${i}.rhai`] = `fn p${i}(s) { s }`;
      declarations[`c${i}`] = { url: `p${i}.json` };
      items.push(node(`c${i}`));
    }
    const root = await workspace({
      ...parts,
      "screens/root.json": screen("root", {
        components: declarations,
        ui: { xtype: "container", items },
      }),
      "screens/root.rhai": "fn root(s) { s }",
    });
    const output = join(root, "out");
    await expect(publishPackage(join(root, "screens/root.json"), output)).rejects.toThrow(
      "コンポーネントの数が8を超えています（rootを含む）",
    );
    await untouched(output);
  });

  // The declaration cap is judged before any child is read, so it stands on the count alone: the
  // ninth declaration is refused even though none of them is placed and the Instance cap is clear.
  it("refuses a root that declares a ninth component", async () => {
    const parts = {};
    const declarations = {};
    for (let i = 0; i < 9; i++) {
      parts[`screens/p${i}.json`] = screen(`p${i}`);
      parts[`screens/p${i}.rhai`] = `fn p${i}(s) { s }`;
      declarations[`c${i}`] = { url: `p${i}.json` };
    }
    const root = await workspace({
      ...parts,
      "screens/root.json": screen("root", { components: declarations }),
      "screens/root.rhai": "fn root(s) { s }",
    });
    const output = join(root, "out");
    await expect(publishPackage(join(root, "screens/root.json"), output)).rejects.toThrow(
      "コンポーネントの宣言が8件を超えています",
    );
    await untouched(output);
  });

  it("publishes a root that declares the eight the contract allows", async () => {
    const parts = {};
    const declarations = {};
    for (let i = 0; i < 8; i++) {
      parts[`screens/p${i}.json`] = screen(`p${i}`);
      parts[`screens/p${i}.rhai`] = `fn p${i}(s) { s }`;
      declarations[`c${i}`] = { url: `p${i}.json` };
    }
    const root = await workspace({
      ...parts,
      "screens/root.json": screen("root", { components: declarations }),
      "screens/root.rhai": "fn root(s) { s }",
    });
    const metadata = await publishPackage(join(root, "screens/root.json"), join(root, "out"));
    expect(Object.keys(metadata.components).sort()).toEqual(
      Object.keys(declarations).map((_, i) => `p${i}.json`),
    );
  });

  it("refuses a tree whose bodies and scripts pass two megabytes by one byte", async () => {
    const big = screen("big");
    const root = await workspace({
      "screens/root.json": padded(
        screen("root", {
          components: { big: { url: "big.json" } },
          ui: { xtype: "container", items: [node("big")] },
        }),
        1_000_000,
      ),
      // One byte of script on the root is what carries the sum past the limit.
      "screens/root.rhai": "s",
      "screens/big.json": padded(big, 1_000_000),
      "screens/big.rhai": "",
    });
    const output = join(root, "out");
    await expect(publishPackage(join(root, "screens/root.json"), output)).rejects.toThrow(
      "配信ファイルの合計が2 MBを超えています（合計 2000001 バイト。最大の子: big.json 1000000 バイト）",
    );
    await untouched(output);
  });

  // The sum names the largest child unconditionally, which holds because the body cap stops a
  // childless screen long before two megabytes: the root alone tops out at 1 MB plus 100 KB.
  it("refuses an oversized body before the sum is taken, so the root alone never reaches the limit", async () => {
    const root = await workspace({
      "screens/root.json": padded(screen("root"), 2_000_001),
      "screens/root.rhai": "",
    });
    const output = join(root, "out");
    await expect(publishPackage(join(root, "screens/root.json"), output)).rejects.toThrow(
      "画面定義が1 MBを超えています",
    );
    await untouched(output);
  });

  it("refuses a child url that is not a local relative path", async () => {
    for (const url of ["https://cdn.test/x.json", "/abs.json"]) {
      const root = await workspace({
        "screens/root.json": screen("root", {
          components: { remote: { url } },
          ui: { xtype: "container", items: [node("remote")] },
        }),
        "screens/root.rhai": "fn root(s) { s }",
      });
      const output = join(root, "out");
      await expect(publishPackage(join(root, "screens/root.json"), output), url).rejects.toThrow(
        "配信用ビルダーにはローカルの相対パスを指定してください",
      );
      await untouched(output);
    }
  });

  it("gives a child the slot its sorted key names however the root declares it", async () => {
    const parts = {
      "screens/a.json": screen("a"),
      "screens/a.rhai": "fn a(s) { s }",
      "screens/b.json": screen("b"),
      "screens/b.rhai": "fn b(s) { s }",
      "screens/root.rhai": "fn root(s) { s }",
    };
    const ui = { xtype: "container", items: [node("alpha"), node("beta")] };
    const publish = async (components) => {
      const root = await workspace({
        ...parts,
        "screens/root.json": screen("root", { components, ui }),
      });
      return publishPackage(join(root, "screens/root.json"), join(root, "out"));
    };
    const forward = await publish({ alpha: { url: "a.json" }, beta: { url: "b.json" } });
    const reverse = await publish({ beta: { url: "b.json" }, alpha: { url: "a.json" } });
    for (const metadata of [forward, reverse]) {
      expect(metadata.components["a.json"].source.url).toBe(
        `packages/${metadata.revision}/component-0-source`,
      );
      expect(metadata.components["b.json"].script.url).toBe(
        `packages/${metadata.revision}/component-1-script`,
      );
      // The revision covers the hashes alone, so rehashing the manifest as published and rehashing
      // it with its children in the other order both have to land on the revision it carries.
      expect(await manifestRevision(metadata)).toBe(metadata.revision);
      const flipped = Object.fromEntries(Object.entries(metadata.components).reverse());
      expect(await manifestRevision({ ...metadata, components: flipped })).toBe(metadata.revision);
    }
    // Nothing but the root's own bytes may differ: the children keep their keys, slots and hashes.
    const slots = (metadata) =>
      JSON.parse(JSON.stringify(metadata.components).replaceAll(metadata.revision, "<revision>"));
    expect(slots(reverse)).toEqual(slots(forward));
  });

  // The sidecars `bun run build:wasm` writes for the catalog, read where the build left them.
  const CATALOG = {
    "order-dashboard.json": ["parts/order-list.json"],
    "parts-lab.json": ["http-grid.json", "parts/approval.json", "parts/note-pad.json"],
    "http-grid.json": [],
  };

  it("publishes each catalog screen with the children its declarations reach", async () => {
    for (const [name, children] of Object.entries(CATALOG)) {
      const metadata = JSON.parse(
        await readFile(join(screensDirectory, `${name}.manifest.json`), "utf8"),
      );
      expect(metadata.version, name).toBe(2);
      expect(Object.keys(metadata.components).sort(), name).toEqual(children);
    }
  });

  it("delivers every catalog sidecar through the loader", async () => {
    for (const [name, children] of Object.entries(CATALOG)) {
      const text = await readFile(join(screensDirectory, `${name}.manifest.json`), "utf8");
      const served = await deliver(screensDirectory, name, text);
      const candidate = await served.loader.fetch(served.url, { mode: "network-first" });
      expect(candidate.metadata.version, name).toBe(2);
      expect(Object.keys(candidate.components).sort(), name).toEqual(
        children.map((key) => httpUrl(key, served.url).href).sort(),
      );
    }
  });
});
