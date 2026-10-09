import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { ApplicationLoader, manifestRevision, sha256 } from "../src/application-loader.js";
import { componentScope, instanceTable, scopeProblem } from "../src/component-tree.js";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { ResourceClient } from "../src/resource-client.js";
import { UiRuntime } from "../src/runtime.js";
import { memoryOpfs } from "./helpers/opfs.js";

// Adapters are verified in-browser. These tests exercise the shared host with real WASM.
vi.mock("../src/dom-renderer.js", () => ({
  DomRenderer: class {
    constructor(stage) {
      this.stage = stage;
      this.render = vi.fn();
      this.reset = vi.fn();
      this.dispose = vi.fn();
    }
  },
}));
vi.mock("../src/canvas-renderer.js", () => ({
  CanvasRenderer: class {
    constructor(stage) {
      this.stage = stage;
      this.render = vi.fn();
      this.reset = vi.fn();
      this.dispose = vi.fn();
    }
  },
}));

describe("ApplicationLoader の components 取得", () => {
  const base = "https://parts.test/screens/";
  const encoder = new TextEncoder();
  const href = (path) => new URL(path, base).href;
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
  // Each entry is [path, package, script]; the script is published at the package's own script URL
  // so that every child resolves its Rhai relative to itself.
  function fixture(list) {
    const responses = new Map();
    for (const [path, value, script = "fn init(s) { s }"] of list) {
      const url = href(path);
      responses.set(url, JSON.stringify(value));
      responses.set(new URL(value.script, url).href, script);
    }
    const reads = new Map();
    const fetcher = vi.fn(async (u) => {
      const key = String(u);
      reads.set(key, (reads.get(key) ?? 0) + 1);
      const value = responses.get(key);
      if (value instanceof Error) throw value;
      if (value === undefined) return new Response("missing", { status: 404 });
      if (value instanceof Response) return value.clone();
      return new Response(value);
    });
    const resources = new ResourceClient({ baseUrl: base, fetch: fetcher });
    return { responses, reads, fetcher, resources, loader: new ApplicationLoader({ resources }) };
  }
  // Publishes a version 2 manifest for `list` on the fixture: `list` has the shape `fixture` takes,
  // the first entry being the root, and `descriptors` maps a package path to the descriptor bytes
  // it delivers. Calling it again on the same fixture republishes under the same file names.
  async function treeManifest(f, list, { descriptors = {} } = {}) {
    const url = new URL(href(list[0][0]));
    const sidecar = new URL(url);
    sidecar.pathname += ".manifest.json";
    const publish = async (name, bytes) => {
      const entry = {
        url: `packages/rev/${name}`,
        sha256: await sha256(bytes),
        size: bytes.length,
      };
      f.responses.set(new URL(entry.url, sidecar).href, bytes);
      return entry;
    };
    const pkg = async (prefix, [path, value, script = "fn init(s) { s }"]) => {
      const own = {};
      const keys = Object.keys(descriptors[path] ?? {}).sort();
      for (let n = 0; n < keys.length; n++)
        own[keys[n]] = await publish(`${prefix}descriptor-${n}`, descriptors[path][keys[n]]);
      return {
        source: await publish(`${prefix}source`, encoder.encode(JSON.stringify(value))),
        script: await publish(`${prefix}script`, encoder.encode(script)),
        descriptors: own,
      };
    };
    const metadata = {
      version: 2,
      revision: "a".repeat(64),
      ...(await pkg("", list[0])),
      components: {},
    };
    const children = list.slice(1);
    const order = children.map(([path]) => path).sort();
    for (const child of children)
      metadata.components[child[0]] = await pkg(`component-${order.indexOf(child[0])}-`, child);
    metadata.revision = await manifestRevision(metadata);
    f.responses.set(sidecar.href, JSON.stringify(metadata));
    return { url, sidecar, metadata };
  }

  it("fetches children and grandchildren once each and rewrites every declared url", async () => {
    const f = fixture([
      [
        "parent.json",
        screen("parent", {
          components: { childA: { url: "a.json" }, childB: { url: "parts/b.json" } },
          ui: { xtype: "container", items: [node("childA"), node("childB")] },
        }),
      ],
      [
        "a.json",
        screen("a", {
          components: { leaf: { url: "./leaf.json" } },
          ui: { xtype: "container", items: [node("leaf")] },
        }),
      ],
      ["parts/b.json", screen("b")],
      ["leaf.json", screen("leaf")],
    ]);
    const candidate = await f.loader.fetch(href("parent.json"));
    const children = [href("a.json"), href("parts/b.json"), href("leaf.json")];
    expect(Object.keys(candidate.components).sort()).toEqual([...children].sort());
    // The parent plus its three descendants: four packages, each reachable by its absolute href.
    expect([candidate.url.href, ...Object.keys(candidate.components)]).toHaveLength(4);
    expect(candidate.screen.components).toEqual({
      childA: { url: href("a.json") },
      childB: { url: href("parts/b.json") },
    });
    expect(candidate.components[href("a.json")].screen.components).toEqual({
      leaf: { url: href("leaf.json") },
    });
    expect(candidate.components[href("leaf.json")].screen.id).toBe("leaf");
    expect(candidate.components[href("parts/b.json")].script).toBe("fn init(s) { s }");
    for (const child of children) expect(f.reads.get(child)).toBe(1);
  });

  it("downloads the same href once even when two declarations place it", async () => {
    const f = fixture([
      [
        "parent.json",
        screen("parent", {
          components: { left: { url: "part.json" }, right: { url: "./part.json" } },
          ui: {
            xtype: "container",
            items: [node("left"), { xtype: "panel", items: [node("right")] }],
          },
        }),
      ],
      ["part.json", screen("part")],
    ]);
    const candidate = await f.loader.fetch(href("parent.json"));
    expect(Object.keys(candidate.components)).toEqual([href("part.json")]);
    expect(candidate.screen.components.right.url).toBe(href("part.json"));
    expect(f.reads.get(href("part.json"))).toBe(1);
    expect(f.reads.get(href("part.rhai"))).toBe(1);
  });

  it("refuses a child that declares itself or one of its ancestors", async () => {
    const itself = fixture([
      ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
      ["a.json", screen("a", { components: { self: { url: "a.json" } } })],
    ]);
    await expect(itself.loader.fetch(href("parent.json"))).rejects.toThrow(/循環参照/);
    const ancestor = fixture([
      ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
      ["a.json", screen("a", { components: { up: { url: "parent.json" } } })],
    ]);
    await expect(ancestor.loader.fetch(href("parent.json"))).rejects.toThrow(
      `コンポーネント up の循環参照: ${href("parent.json")}`,
    );
  });

  it("allows three levels and refuses a fourth", async () => {
    const list = [
      ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
      ["a.json", screen("a", { components: { b: { url: "b.json" } } })],
      ["b.json", screen("b")],
      ["c.json", screen("c")],
    ];
    expect(Object.keys((await fixture(list).loader.fetch(href("parent.json"))).components)).toEqual(
      [href("a.json"), href("b.json")],
    );
    const deeper = fixture([
      ...list.slice(0, 2),
      ["b.json", screen("b", { components: { c: { url: "c.json" } } })],
      ["c.json", screen("c")],
    ]);
    await expect(deeper.loader.fetch(href("parent.json"))).rejects.toThrow(
      `コンポーネントの入れ子が3段を超えています: ${href("c.json")}`,
    );
  });

  it("counts the root as one Instance and refuses the ninth", async () => {
    const parent = (count) =>
      fixture([
        [
          "parent.json",
          screen("parent", {
            components: { part: { url: "part.json" } },
            ui: {
              xtype: "container",
              items: Array.from({ length: count }, () => ({ xtype: "part" })),
            },
          }),
        ],
        ["part.json", screen("part")],
      ]);
    const candidate = await parent(7).loader.fetch(href("parent.json"));
    expect(Object.keys(candidate.components)).toEqual([href("part.json")]);
    await expect(parent(8).loader.fetch(href("parent.json"))).rejects.toThrow(
      `コンポーネントの数が8を超えています（rootを含む）: ${href("part.json")}`,
    );
  });

  it("returns an empty components map for a screen without children", async () => {
    const f = fixture([["plain.json", screen("plain")]]);
    const candidate = await f.loader.fetch(href("plain.json"));
    expect(candidate.components).toEqual({});
    expect(Object.keys(candidate.components)).toHaveLength(0);
  });

  it("refuses a declaration without a string url before fetching anything", async () => {
    for (const declaration of [{}, null, { url: 5 }]) {
      const f = fixture([["parent.json", screen("parent", { components: { a: declaration } })]]);
      await expect(f.loader.fetch(href("parent.json"))).rejects.toThrow(
        "コンポーネント a の宣言が不正です（url を文字列で指定してください）",
      );
      // Only the parent's own body and script were read; no child URL was guessed at.
      expect([...f.reads.keys()].sort()).toEqual([href("parent.json"), href("parent.rhai")]);
    }
  });

  it("applies the existing Rhai size limit to a child script", async () => {
    const f = fixture([
      ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
      ["a.json", screen("a"), "/".repeat(100_001)],
    ]);
    await expect(f.loader.fetch(href("parent.json"))).rejects.toThrow(
      "Rhaiは100 KB以内にしてください",
    );
  });

  // The same table the engine reads, so both sides compose and refuse the same scopes.
  it("composes and judges every row of the shared scope table", async () => {
    const rows = JSON.parse(
      await readFile(new URL("./helpers/component-scope-cases.json", import.meta.url), "utf8"),
    );
    expect(rows.length).toBeGreaterThan(11);
    for (const { rootId, path, scope } of rows) {
      if (scope === null) {
        expect(scopeProblem(rootId, path)).toBe(
          `コンポーネント ${path} の保存領域 ${componentScope(rootId, path)} が不正です（英数字・-・_ で80バイト以内、各要素に __ を含めない）`,
        );
      } else {
        expect(componentScope(rootId, path)).toBe(scope);
        expect(scopeProblem(rootId, path)).toBe(null);
      }
    }
  });

  // `mid` keeps no data of its own, so only the `part` placement below it is checked.
  const placed = (items) =>
    fixture([
      [
        "parent.json",
        screen("parent", {
          components: { part: { url: "part.json" }, mid: { url: "mid.json" } },
          ui: { xtype: "container", items },
        }),
      ],
      [
        "mid.json",
        screen("mid", {
          components: { part: { url: "part.json" } },
          ui: { xtype: "container", items: [{ xtype: "part", itemId: "b" }] },
        }),
      ],
      [
        "part.json",
        screen("part", {
          storage: { draft: { backend: "opfs", key: "draft", handler: "done" } },
        }),
      ],
    ]);

  it("refuses an itemId carrying __ for a child that declares storage", async () => {
    const flat = placed([{ xtype: "part", itemId: "a__b" }]);
    await expect(flat.loader.fetch(href("parent.json"))).rejects.toThrow(
      "コンポーネント a__b の保存領域 parent__a__b が不正です（英数字・-・_ で80バイト以内、各要素に __ を含めない）",
    );
    // The same child one level down composes the same scope out of two sound parts.
    const nested = placed([{ xtype: "mid", itemId: "a" }]);
    const candidate = await nested.loader.fetch(href("parent.json"));
    expect(Object.keys(candidate.components).sort()).toEqual(
      [href("mid.json"), href("part.json")].sort(),
    );
  });

  // A child resolves its RPC descriptor against its own URL, so the bytes travel with its entry.
  it("keeps the descriptors a child downloaded on its entry of the components map", async () => {
    const bytes = new Uint8Array(
      await readFile(new URL("../public/screens/rpc-demo.pb", import.meta.url)),
    );
    const f = fixture([
      [
        "parent.json",
        screen("parent", {
          components: { part: { url: "part.json" } },
          ui: { xtype: "container", items: [node("part")] },
        }),
      ],
      [
        "part.json",
        screen("part", {
          rpc: {
            echo: {
              url: "https://rpc.test/uivolve.demo.EchoService/Echo",
              descriptor: "rpc-demo.pb",
              service: "uivolve.demo.EchoService",
              method: "Echo",
              protocol: "connect",
              handler: "echoDone",
            },
          },
        }),
        "fn init(s) { s } fn echoDone(s, r) { s }",
      ],
    ]);
    f.responses.set(href("rpc-demo.pb"), bytes);
    const candidate = await f.loader.fetch(href("parent.json"));
    expect(candidate.components[href("part.json")].descriptors).toEqual({ "rpc-demo.pb": bytes });
    expect(f.reads.get(href("rpc-demo.pb"))).toBe(1);
  });

  it("leaves the scope rules to a child that declares neither storage nor files", async () => {
    const f = fixture([
      [
        "parent.json",
        screen("parent", {
          components: { part: { url: "part.json" } },
          ui: { xtype: "container", items: [{ xtype: "part", itemId: "a__b" }] },
        }),
      ],
      ["part.json", screen("part")],
    ]);
    const candidate = await f.loader.fetch(href("parent.json"));
    expect(Object.keys(candidate.components)).toEqual([href("part.json")]);
  });

  // A version 2 manifest lists the whole tree: the root plus every descendant, keyed by the path
  // the child resolves to against the root's own URL. Files are published under `packages/rev/`
  // with the names `publish-packages.mjs` gives them, the child index taken from the sorted keys.
  describe("ApplicationLoader の木のマニフェスト", () => {
    const MALFORMED = "マニフェストのコンポーネント情報が不正です";
    const parentWithChild = () => [
      ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
      ["a.json", screen("a")],
    ];

    it("delivers and restores a version 2 manifest for a screen without children", async () => {
      const plain = screen("plain");
      const f = fixture([["plain.json", plain]]);
      const fs = memoryOpfs();
      const loader = new ApplicationLoader({
        resources: f.resources,
        storage: fs.storage,
        locks: null,
      });
      const t = await treeManifest(f, [["plain.json", plain]]);
      const candidate = await loader.fetch(t.url, { mode: "network-first" });
      expect(candidate.metadata.version).toBe(2);
      expect(candidate.metadata.components).toEqual({});
      expect(candidate.components).toEqual({});
      await loader.save(candidate);
      f.responses.set(t.sidecar.href, new TypeError("offline"));
      const restored = await loader.fetch(t.url, { mode: "network-first" });
      expect(restored.status).toBe("cache");
      expect(restored.metadata.revision).toBe(candidate.metadata.revision);
      expect(restored.source).toBe(candidate.source);
    });

    it("refuses a manifest whose version and components do not agree", async () => {
      const patches = [
        { version: 1, components: {} },
        { version: 1 },
        { version: 3 },
        { components: undefined },
        { components: null },
        { components: [] },
      ];
      for (const patch of patches) {
        const list = parentWithChild();
        const f = fixture(list);
        const t = await treeManifest(f, list);
        f.responses.set(t.sidecar.href, JSON.stringify({ ...t.metadata, ...patch }));
        await expect(f.loader.fetch(t.url, { mode: "network-first" })).rejects.toThrow(
          "配信マニフェストが不正です",
        );
        expect([...f.reads.keys()]).toEqual([t.sidecar.href]);
      }
    });

    it("refuses a malformed child before fetching any file", async () => {
      const spare = (size = 1) => ({ url: "packages/rev/x", sha256: "c".repeat(64), size });
      const cases = [
        ["script が 100 KB を超える", (c) => (c["a.json"].script.size = 100_001)],
        [
          "descriptors が 9 件",
          (c) =>
            (c["a.json"].descriptors = Object.fromEntries(
              Array.from({ length: 9 }, (_, n) => [`d-${n}.pb`, spare()]),
            )),
        ],
        ["sha256 が 63 桁", (c) => (c["a.json"].source.sha256 = "a".repeat(63))],
        ["子が object でない", (c) => (c["a.json"] = 5)],
        ["絶対化したキーが重複する", (c) => (c["./a.json"] = c["a.json"])],
        [
          "キーが HTTP / HTTPS に解決しない",
          (c) => {
            c["javascript:alert(1)"] = c["a.json"];
            delete c["a.json"];
          },
        ],
        [
          "子が 9 件",
          (c) => {
            for (let n = 0; n < 9; n++) c[`c-${n}.json`] = c["a.json"];
          },
        ],
      ];
      for (const [name, mutate] of cases) {
        const list = parentWithChild();
        const f = fixture(list);
        const t = await treeManifest(f, list);
        const metadata = structuredClone(t.metadata);
        mutate(metadata.components);
        f.responses.set(t.sidecar.href, JSON.stringify(metadata));
        await expect(f.loader.fetch(t.url, { mode: "network-first" }), name).rejects.toThrow(
          MALFORMED,
        );
        // The shape is judged before anything is downloaded, so only the manifest was read.
        expect([...f.reads.keys()], name).toEqual([t.sidecar.href]);
      }
    });

    it("rejects a delivered total over 2 MB and names the largest child", async () => {
      // Sizes alone decide this gate, and the revision covers hashes only, so the entries need no
      // matching bytes: nothing is fetched before the total is judged.
      const sized = async (f, childSize) => {
        const url = new URL(href("parent.json"));
        const sidecar = new URL(url);
        sidecar.pathname += ".manifest.json";
        const entry = (name, size, seed) => ({
          url: `packages/rev/${name}`,
          sha256: seed.repeat(64),
          size,
        });
        const child = (i, size, seed) => ({
          source: entry(`component-${i}-source`, size, seed),
          script: entry(`component-${i}-script`, 0, seed),
          descriptors: {},
        });
        const metadata = {
          version: 2,
          revision: "a".repeat(64),
          source: entry("source", 1_000_000, "1"),
          script: entry("script", 1, "2"),
          components: { "a.json": child(0, childSize, "3"), "b.json": child(1, 1_000, "4") },
        };
        metadata.revision = await manifestRevision(metadata);
        f.responses.set(sidecar.href, JSON.stringify(metadata));
        return { url, sidecar, metadata };
      };
      const over = fixture([]);
      const t = await sized(over, 999_000);
      await expect(over.loader.fetch(t.url, { mode: "network-first" })).rejects.toThrow(
        `配信ファイルの合計が2 MBを超えています（合計 2000001 バイト。最大の子: ${href("a.json")} 999000 バイト）`,
      );
      expect([...over.reads.keys()]).toEqual([t.sidecar.href]);
      // Exactly 2,000,000 passes the manifest and only then fails on the missing delivered file.
      const edge = fixture([]);
      const e = await sized(edge, 998_999);
      await expect(edge.loader.fetch(e.url, { mode: "network-first" })).rejects.toThrow("HTTP 404");
    });

    it("hashes the tree independently of the order the children are listed in", async () => {
      const list = [
        [
          "parent.json",
          screen("parent", { components: { a: { url: "a.json" }, b: { url: "parts/b.json" } } }),
        ],
        ["a.json", screen("a")],
        ["parts/b.json", screen("b")],
      ];
      const flipped = [list[0], list[2], list[1]];
      const forward = await treeManifest(fixture(list), list);
      const reversed = await treeManifest(fixture(flipped), flipped);
      expect(Object.keys(reversed.metadata.components)).toEqual(["parts/b.json", "a.json"]);
      expect(reversed.metadata.revision).toBe(forward.metadata.revision);
      // A child carrying a descriptor hashes its descriptor list the same way the root does.
      const bytes = new Uint8Array(
        await readFile(new URL("../public/screens/rpc-demo.pb", import.meta.url)),
      );
      const descriptors = { "a.json": { "rpc-demo.pb": bytes } };
      const one = await treeManifest(fixture(list), list, { descriptors });
      const two = await treeManifest(fixture(flipped), flipped, { descriptors });
      expect(two.metadata.revision).toBe(one.metadata.revision);
      expect(one.metadata.revision).not.toBe(forward.metadata.revision);
      const tampered = structuredClone(one.metadata);
      tampered.components["a.json"].source.sha256 = "f".repeat(64);
      expect(await manifestRevision(tampered)).not.toBe(one.metadata.revision);
    });

    it("reads a __proto__ child key as a plain entry instead of a prototype write", async () => {
      const list = parentWithChild();
      const f = fixture(list);
      const t = await treeManifest(f, list);
      const raw = JSON.stringify({ ...t.metadata, components: { "a.json": 5 } }).replace(
        '"a.json":',
        '"__proto__":',
      );
      expect(Object.hasOwn(JSON.parse(raw).components, "__proto__")).toBe(true);
      f.responses.set(t.sidecar.href, raw);
      await expect(f.loader.fetch(t.url, { mode: "network-first" })).rejects.toThrow(MALFORMED);
    });

    // A parent, its child and the child's own leaf, plus a second child one directory down: the
    // same shape the network-only tests walk, so both paths can be compared entry by entry.
    const tree = () => [
      [
        "parent.json",
        screen("parent", {
          components: { childA: { url: "a.json" }, childB: { url: "parts/b.json" } },
          ui: { xtype: "container", items: [node("childA"), node("childB")] },
        }),
      ],
      [
        "a.json",
        screen("a", {
          components: { leaf: { url: "./leaf.json" } },
          ui: { xtype: "container", items: [node("leaf")] },
        }),
      ],
      ["parts/b.json", screen("b")],
      ["leaf.json", screen("leaf")],
    ];
    const table = (candidate) =>
      [...instanceTable(candidate.screen, candidate.url.href, candidate.components)].map(
        ([path, entry]) => [path, entry.url, entry.screen.id],
      );
    // Replaces the manifest with a mutated copy, the revision recomputed so that the tree checks
    // are what refuse it rather than the hash comparison.
    const revised = async (f, t, mutate) => {
      const metadata = structuredClone(t.metadata);
      mutate(metadata.components);
      metadata.revision = await manifestRevision(metadata);
      f.responses.set(t.sidecar.href, JSON.stringify(metadata));
      return metadata;
    };

    it("delivers the whole tree through the manifest just as the network does", async () => {
      const list = tree();
      const direct = await fixture(list).loader.fetch(href("parent.json"));
      const f = fixture(list);
      const t = await treeManifest(f, list);
      const candidate = await f.loader.fetch(t.url, { mode: "network-first" });
      expect(Object.keys(candidate.components).sort()).toEqual(
        Object.keys(direct.components).sort(),
      );
      expect(candidate.screen.components).toEqual(direct.screen.components);
      expect(candidate.components[href("a.json")].screen.components).toEqual(
        direct.components[href("a.json")].screen.components,
      );
      expect(candidate.components[href("parts/b.json")].script).toBe("fn init(s) { s }");
      expect(table(candidate)).toEqual(table(direct));
      for (const child of Object.values(t.metadata.components)) {
        expect(f.reads.get(new URL(child.source.url, t.sidecar).href)).toBe(1);
        expect(f.reads.get(new URL(child.script.url, t.sidecar).href)).toBe(1);
      }
      // Every byte came from the delivery; the children's own URLs were never touched.
      expect(f.reads.has(href("a.json"))).toBe(false);
    });

    it("refuses a manifest and a declaration tree that do not list the same children", async () => {
      const list = tree();
      const missing = fixture(list);
      const mt = await treeManifest(missing, list);
      await revised(missing, mt, (c) => delete c["leaf.json"]);
      await expect(missing.loader.fetch(mt.url, { mode: "network-first" })).rejects.toThrow(
        `${MALFORMED}（マニフェストに無い子: ${href("leaf.json")}）`,
      );
      // A key nothing places is refused after the walk, its files left unread.
      const spare = (c) => ({
        source: { ...c["parts/b.json"].source, url: "packages/rev/spare-source" },
        script: { ...c["parts/b.json"].script, url: "packages/rev/spare-script" },
        descriptors: {},
      });
      const extra = fixture(list);
      const et = await treeManifest(extra, list);
      await revised(extra, et, (c) => (c["spare.json"] = spare(c)));
      await expect(extra.loader.fetch(et.url, { mode: "network-first" })).rejects.toThrow(
        `${MALFORMED}（宣言に無い子: ${href("spare.json")}）`,
      );
      expect(extra.reads.has(new URL("packages/rev/spare-source", et.sidecar).href)).toBe(false);
      // A `__proto__` key is one more undeclared entry, not a write to the prototype.
      const proto = fixture(list);
      const pt = await treeManifest(proto, list);
      await revised(proto, pt, (c) =>
        Object.defineProperty(c, "__proto__", {
          value: spare(c),
          enumerable: true,
          configurable: true,
          writable: true,
        }),
      );
      await expect(proto.loader.fetch(pt.url, { mode: "network-first" })).rejects.toThrow(
        `${MALFORMED}（宣言に無い子: ${href("__proto__")}）`,
      );
    });

    it("names the child whose delivered file does not match its entry", async () => {
      const list = tree();
      const swapped = encoder.encode("fn init(t) { t }");
      const child = fixture(list);
      const ct = await treeManifest(child, list);
      child.responses.set(
        new URL(ct.metadata.components["a.json"].script.url, ct.sidecar).href,
        swapped,
      );
      await expect(child.loader.fetch(ct.url, { mode: "network-first" })).rejects.toThrow(
        `配信ファイルのサイズ・ハッシュが一致しません（${href("a.json")}）`,
      );
      // The root keeps the wording it always had: there is no other package it could mean.
      const root = fixture(list);
      const rt = await treeManifest(root, list);
      root.responses.set(new URL(rt.metadata.script.url, rt.sidecar).href, swapped);
      await expect(root.loader.fetch(rt.url, { mode: "network-first" })).rejects.toThrow(
        /^配信ファイルのサイズ・ハッシュが一致しません$/,
      );
    });

    it("falls back to the stored version when a child cannot be reached", async () => {
      const list = tree();
      const f = fixture(list);
      const fs = memoryOpfs();
      const loader = new ApplicationLoader({
        resources: f.resources,
        storage: fs.storage,
        locks: null,
      });
      const t = await treeManifest(f, list);
      f.responses.set(
        new URL(t.metadata.components["a.json"].source.url, t.sidecar).href,
        new TypeError("offline"),
      );
      await expect(loader.fetch(t.url, { mode: "network-first" })).rejects.toThrow(
        "通信に失敗し、利用できる保存版もありません",
      );
    });

    it("judges cycles, depth and scope on the manifest path as well", async () => {
      const cyclic = [
        ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
        ["a.json", screen("a", { components: { up: { url: "parent.json" } } })],
      ];
      const c = fixture(cyclic);
      const ct = await treeManifest(c, cyclic);
      await expect(c.loader.fetch(ct.url, { mode: "network-first" })).rejects.toThrow(
        `コンポーネント up の循環参照: ${href("parent.json")}`,
      );
      const deep = [
        ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
        ["a.json", screen("a", { components: { b: { url: "b.json" } } })],
        ["b.json", screen("b", { components: { c: { url: "c.json" } } })],
        ["c.json", screen("c")],
      ];
      const d = fixture(deep);
      const dt = await treeManifest(d, deep);
      await expect(d.loader.fetch(dt.url, { mode: "network-first" })).rejects.toThrow(
        `コンポーネントの入れ子が3段を超えています: ${href("c.json")}`,
      );
      const scoped = [
        [
          "parent.json",
          screen("parent", {
            components: { part: { url: "part.json" } },
            ui: { xtype: "container", items: [{ xtype: "part", itemId: "a__b" }] },
          }),
        ],
        [
          "part.json",
          screen("part", {
            storage: { draft: { backend: "opfs", key: "draft", handler: "done" } },
          }),
        ],
      ];
      const s = fixture(scoped);
      const st = await treeManifest(s, scoped);
      await expect(s.loader.fetch(st.url, { mode: "network-first" })).rejects.toThrow(
        "コンポーネント a__b の保存領域 parent__a__b が不正です（英数字・-・_ で80バイト以内、各要素に __ を含めない）",
      );
    });

    // `save` and `restore` still hold one package each: the stored tree arrives with T5.
    it("stores the root alone and refuses to restore a screen that declares children", async () => {
      const list = tree();
      const f = fixture(list);
      const fs = memoryOpfs();
      const loader = new ApplicationLoader({
        resources: f.resources,
        storage: fs.storage,
        locks: null,
      });
      const t = await treeManifest(f, list);
      const candidate = await loader.fetch(t.url, { mode: "network-first" });
      const written = [];
      fs.controls.beforeClose = async (name) => written.push(name);
      await loader.save(candidate);
      expect(written).toEqual(["source", "script", "current.json"]);
      await expect(loader.restore(t.url)).rejects.toThrow(MALFORMED);
      await loader.clear(t.url);
      await expect(loader.restore(t.url)).rejects.toThrow(
        "通信に失敗し、利用できる保存版もありません",
      );
    });
  });

  // Children outlive the screen that pulled them in: one loader belongs to one UiRuntime, so a
  // navigation between two screens placing the same part reuses the part it already holds. Only a
  // refresh, a cache mode change or different authentication metadata empties the shared map.
  describe("子パッケージのメモリ共有", () => {
    // Two roots over the same child, and the child carries a leaf of its own: a shared entry has
    // to bring the subtree it was walked with.
    const twoRoots = () => [
      [
        "A.json",
        screen("A", {
          components: { part: { url: "a.json" } },
          ui: { xtype: "container", items: [node("part")] },
        }),
      ],
      [
        "a.json",
        screen("a", {
          components: { leaf: { url: "leaf.json" } },
          ui: { xtype: "container", items: [node("leaf")] },
        }),
      ],
      ["leaf.json", screen("leaf")],
      [
        "B.json",
        screen("B", {
          components: { part: { url: "a.json" } },
          ui: { xtype: "container", items: [node("part")] },
        }),
      ],
    ];

    it("fetches a child once across two screens that place it", async () => {
      const f = fixture(twoRoots());
      const first = await f.loader.fetch(href("A.json"));
      const walked = structuredClone(first.components[href("a.json")].screen);
      const second = await f.loader.fetch(href("B.json"));
      for (const path of ["a.json", "a.rhai", "leaf.json", "leaf.rhai"])
        expect(f.reads.get(href(path)), path).toBe(1);
      // The very entries the first load walked, not copies: the runtime clones before it compiles.
      expect(second.components[href("a.json")]).toBe(first.components[href("a.json")]);
      expect(second.components[href("leaf.json")]).toBe(first.components[href("leaf.json")]);
      // Rewriting a declaration to the href it already holds leaves the shared screen unchanged.
      expect(second.components[href("a.json")].screen).toEqual(walked);
      expect(second.screen.components.part.url).toBe(href("a.json"));
    });

    it("takes the child again on an explicit refresh but not on the load after it", async () => {
      const f = fixture(twoRoots());
      await f.loader.fetch(href("A.json"));
      await f.loader.fetch(href("B.json"), { refresh: true });
      expect(f.reads.get(href("a.json"))).toBe(2);
      await f.loader.fetch(href("B.json"));
      expect(f.reads.get(href("a.json"))).toBe(2);
    });

    it("empties the shared map only when the authentication metadata differs", async () => {
      const f = fixture(twoRoots());
      await f.loader.fetch(href("A.json"));
      // A fresh policy object holding the same metadata: `mode: "none"` keeps no origins at all,
      // so re-applying it must not cost a fetch.
      f.resources.setAuthentication({ mode: "none", allowedOrigins: ["https://parts.test"] });
      await f.loader.fetch(href("B.json"));
      expect(f.reads.get(href("a.json"))).toBe(1);
      f.resources.setAuthentication({
        mode: "jwt",
        token: "x",
        allowedOrigins: ["https://parts.test"],
      });
      await f.loader.fetch(href("B.json"));
      expect(f.reads.get(href("a.json"))).toBe(2);
      f.resources.setAuthentication({
        mode: "jwt",
        token: "x",
        allowedOrigins: ["https://parts.test", "https://other.test"],
      });
      await f.loader.fetch(href("B.json"));
      expect(f.reads.get(href("a.json"))).toBe(3);
    });

    it("reuses a delivered child while the manifest promises the same files", async () => {
      const rpc = {
        echo: {
          url: "https://rpc.test/uivolve.demo.EchoService/Echo",
          descriptor: "d.pb",
          service: "uivolve.demo.EchoService",
          method: "Echo",
          protocol: "connect",
          handler: "echoDone",
        },
      };
      const list = () => [
        ["A.json", screen("A", { components: { part: { url: "a.json" } } })],
        ["a.json", screen("a", { rpc }), "fn init(s) { s } fn echoDone(s, r) { s }"],
      ];
      const descriptors = { "a.json": { "d.pb": encoder.encode("one") } };
      const f = fixture(list());
      const t = await treeManifest(f, list(), { descriptors });
      const child = t.metadata.components["a.json"];
      const files = [child.source.url, child.script.url, child.descriptors["d.pb"].url].map(
        (url) => new URL(url, t.sidecar).href,
      );
      const taken = () => files.map((url) => f.reads.get(url) ?? 0);
      await f.loader.fetch(t.url, { mode: "network-first" });
      expect(taken()).toEqual([1, 1, 1]);
      await f.loader.fetch(t.url, { mode: "network-first" });
      expect(taken()).toEqual([1, 1, 1]);
      // A new script for the same child: the promised hash differs, so the child is taken again.
      const changed = list();
      changed[1][2] = "fn init(s) { s } fn echoDone(s, r) { s } // v2";
      await treeManifest(f, changed, { descriptors });
      const second = await f.loader.fetch(t.url, { mode: "network-first" });
      expect(second.components[href("a.json")].script).toBe(changed[1][2]);
      expect(taken()).toEqual([2, 2, 2]);
      // This time only the descriptor bytes differ; the body and the script are untouched.
      const other = { "a.json": { "d.pb": encoder.encode("two") } };
      await treeManifest(f, changed, { descriptors: other });
      const third = await f.loader.fetch(t.url, { mode: "network-first" });
      expect(third.components[href("a.json")].descriptors["d.pb"]).toEqual(other["a.json"]["d.pb"]);
      expect(taken()).toEqual([3, 3, 3]);
    });

    it("empties the shared map when the cache mode changes, either way round", async () => {
      const list = [
        ["parent.json", screen("parent", { components: { a: { url: "a.json" } } })],
        ["a.json", screen("a")],
      ];
      const delivered = (t) => new URL(t.metadata.components["a.json"].source.url, t.sidecar).href;
      // The delivered body is byte for byte the one the child's own URL serves, so the hashes
      // would match: it is the mode change that has to drop the entry.
      const first = fixture(list);
      const ft = await treeManifest(first, list);
      await first.loader.fetch(ft.url);
      await first.loader.fetch(ft.url, { mode: "network-first" });
      expect(first.reads.get(href("a.json"))).toBe(1);
      expect(first.reads.get(delivered(ft))).toBe(1);
      const second = fixture(list);
      const st = await treeManifest(second, list);
      await second.loader.fetch(st.url, { mode: "network-first" });
      await second.loader.fetch(st.url);
      expect(second.reads.get(delivered(st))).toBe(1);
      expect(second.reads.get(href("a.json"))).toBe(1);
    });

    it("walks into the declarations of a shared child as well", async () => {
      const f = fixture([
        ["A.json", screen("A", { components: { mid: { url: "mid.json" } } })],
        ["mid.json", screen("mid", { components: { leaf: { url: "leaf.json" } } })],
        ["leaf.json", screen("leaf")],
        ["B.json", screen("B", { components: { wrap: { url: "wrap.json" } } })],
        ["wrap.json", screen("wrap", { components: { mid: { url: "mid.json" } } })],
      ]);
      await f.loader.fetch(href("A.json"));
      expect(f.reads.get(href("mid.json"))).toBe(1);
      // `mid` sits one level deeper under B, so its own leaf is the fourth level and refused.
      await expect(f.loader.fetch(href("B.json"))).rejects.toThrow(
        `コンポーネントの入れ子が3段を超えています: ${href("leaf.json")}`,
      );
      expect(f.reads.get(href("mid.json"))).toBe(1);
    });

    it("shares nothing from a walk that failed partway", async () => {
      const f = fixture(twoRoots());
      f.responses.delete(href("leaf.rhai"));
      await expect(f.loader.fetch(href("A.json"))).rejects.toThrow("HTTP 404");
      f.responses.set(href("leaf.rhai"), "fn init(s) { s }");
      const candidate = await f.loader.fetch(href("B.json"));
      // `a.json` had been walked successfully before the leaf failed, and is taken again all the
      // same: a tree enters the shared map whole or not at all.
      expect(f.reads.get(href("a.json"))).toBe(2);
      expect(f.reads.get(href("leaf.json"))).toBe(2);
      expect(Object.keys(candidate.components).sort()).toEqual(
        [href("a.json"), href("leaf.json")].sort(),
      );
    });
  });
});

describe("WasmEngine / UiRuntime の components", () => {
  const BASE = "https://example.test/app/";
  const SOURCE = "pages/home.yaml";
  const CARD_URL = "https://example.test/app/pages/card.json";
  const ROOT_SCRIPT = "fn init(s){s}";
  const CARD_SCRIPT = "fn init(s){s}";

  /** A child package: one datepicker, so `prepareScreen` has a `today` to inject. */
  const card = (extra = {}) => ({
    version: 1,
    id: "card",
    title: "カード",
    script: "card.rhai",
    state: { picked: "", ...extra },
    ui: {
      xtype: "container",
      items: [{ xtype: "datepicker", itemId: "cal", bind: "picked" }],
    },
  });
  /** A screen declaring `card` at `url` and placing it once. */
  const parent = (url) => ({
    version: 1,
    id: "home",
    title: "親画面",
    script: "home.rhai",
    state: { label: "受注" },
    components: { card: { url } },
    ui: {
      xtype: "container",
      items: [
        { xtype: "label", bind: "label" },
        { xtype: "card", itemId: "a", config: { status: { bind: "label" } } },
      ],
    },
  });

  let wasm, bytes, definition, script;
  const runtimes = [];
  beforeAll(async () => {
    bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
    wasm = await WebAssembly.compile(bytes);
    definition = parsePackage(
      await readFile(new URL("../examples/minimal/pages/home.yaml", import.meta.url), "utf8"),
      "yaml",
    );
    script = await readFile(
      new URL("../examples/minimal/pages/home.rhai", import.meta.url),
      "utf8",
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });
  function testDocument() {
    const view = {
      devicePixelRatio: 1,
      queries: [],
      matchMedia(media) {
        const query = Object.assign(new EventTarget(), { media });
        view.queries.push(query);
        return query;
      },
    };
    return Object.assign(new EventTarget(), {
      defaultView: view,
      fonts: Object.assign(new EventTarget(), { status: "loading", ready: Promise.resolve() }),
    });
  }
  function stage(width = 400, ownerDocument = testDocument()) {
    const element = {
      clientWidth: width,
      className: "host",
      ownerDocument,
      contains: () => false,
      style: { setProperty: vi.fn() },
      dataset: {},
    };
    element.classList = {
      add: (...names) => {
        element.className += " " + names.join(" ");
      },
    };
    return element;
  }
  async function newEngine() {
    return new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
  }
  async function host(options = {}) {
    const engine = await newEngine();
    const resources = new ResourceClient({
      baseUrl: BASE,
      fetch: async (url) => {
        const name = url.pathname.split("/").at(-1);
        return new Response(name.endsWith(".yaml") ? JSON.stringify(definition) : script);
      },
    });
    const runtime = new UiRuntime({
      baseUrl: BASE,
      engine,
      resources,
      surfaces: [
        { element: stage(400), renderer: "dom" },
        { element: stage(500), renderer: "canvas", canvas: {} },
      ],
      ...options,
    });
    runtimes.push(runtime);
    await runtime.start();
    return runtime;
  }
  const fixedClock = () => ({
    nowMs: Date.parse("2026-10-04T00:00:00+09:00"),
    tzOffsetMinutes: 540,
  });

  it("bundles the components into request.components and leaves the key off an unbundled load", async () => {
    const engine = await newEngine();
    const call = vi.spyOn(engine, "call");
    const result = engine.load(
      parent(CARD_URL),
      ROOT_SCRIPT,
      {},
      {
        components: { [CARD_URL]: { screen: card(), script: CARD_SCRIPT } },
      },
    );
    expect(call.mock.calls[0][0].components).toEqual({
      [CARD_URL]: { package: card(), script: CARD_SCRIPT },
    });
    expect(result.state.label).toBe("受注");

    const plain = await newEngine();
    const plainCall = vi.spyOn(plain, "call");
    plain.load(definition, script, {}, {});
    expect(Object.hasOwn(plainCall.mock.calls[0][0], "components")).toBe(false);
  });

  it("reports the bundled size and the largest child over 2 MB without touching the loaded screen", async () => {
    const runtime = await host({ clockProvider: fixedClock });
    runtime.compile(definition, script, SOURCE);
    const before = runtime.engine.layout(400);
    const small = "https://example.test/app/pages/small.json";
    const screen = {
      ...parent("card.json"),
      components: { card: { url: "card.json" }, slab: { url: "small.json" } },
    };
    screen.ui.items.push({ xtype: "slab", itemId: "b", config: {} });
    const components = {
      [CARD_URL]: { screen: card({ filler: "x".repeat(1_200_000) }), script: CARD_SCRIPT },
      [small]: { screen: card({ filler: "x".repeat(1_100_000) }), script: CARD_SCRIPT },
    };
    let error;
    try {
      runtime.compile(screen, ROOT_SCRIPT, SOURCE, { components });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.message).toContain("リクエストが2 MBを超えています（同梱後 ");
    expect(error.message).toContain(CARD_URL);
    expect(error.message).not.toContain(small);
    expect(runtime.engine.layout(400)).toEqual(before);
    expect(runtime.screen.id).toBe("home");
    expect(runtime.state.greeting).toBe(definition.state.greeting);
  });

  it("prepares every bundled child so a child datepicker carries the screen's clock", async () => {
    const runtime = await host({ clockProvider: fixedClock });
    runtime.compile(parent("card.json"), ROOT_SCRIPT, SOURCE, {
      components: { [CARD_URL]: { screen: card(), script: CARD_SCRIPT } },
    });
    expect(Object.keys(runtime.components)).toEqual([CARD_URL]);
    expect(runtime.components[CARD_URL].screen.ui.items[0].today).toBe("2026-10-04");
    expect(runtime.screen.components.card.url).toBe(CARD_URL);
  });

  it("refuses a declaration without a string url and keeps the loaded screen", async () => {
    const runtime = await host({ clockProvider: fixedClock });
    runtime.compile(definition, script, SOURCE);
    const before = runtime.engine.layout(400);
    for (const declaration of [{}, null, { url: 5 }]) {
      const screen = { ...parent("card.json"), components: { a: declaration } };
      expect(() =>
        runtime.compile(screen, ROOT_SCRIPT, SOURCE, {
          components: { [CARD_URL]: { screen: card(), script: CARD_SCRIPT } },
        }),
      ).toThrow("コンポーネント a の宣言が不正です（url を文字列で指定してください）");
      expect(runtime.screen.id).toBe("home");
      expect(runtime.engine.layout(400)).toEqual(before);
    }
  });

  it("reuses the children of the previous load when compile is called without components", async () => {
    const runtime = await host({ clockProvider: fixedClock });
    runtime.compile(parent("card.json"), ROOT_SCRIPT, SOURCE, {
      components: { [CARD_URL]: { screen: card(), script: CARD_SCRIPT } },
    });
    runtime.compile(parent("card.json"), ROOT_SCRIPT, SOURCE);
    expect(Object.keys(runtime.components)).toEqual([CARD_URL]);
    expect(runtime.components[CARD_URL].screen.ui.items[0].today).toBe("2026-10-04");
    expect(() => runtime.compile(parent("other.json"), ROOT_SCRIPT, SOURCE)).toThrow(
      "コンポーネント card の本体がありません",
    );
  });

  // Rebuilding the engine is the host's way of saying "take it all again", so the same gesture
  // empties the loader's shared children.
  it("passes the engine refresh on to the loader as the refresh of the shared children", async () => {
    const runtime = await host({ clockProvider: fixedClock });
    const fetch = vi.spyOn(runtime.applicationLoader, "fetch");
    await runtime.load(SOURCE);
    expect(fetch.mock.calls.at(-1)[1]).toMatchObject({ refresh: false });
    const real = runtime.resources.fetch.bind(runtime.resources);
    runtime.resources.fetch = (url, options) =>
      url.pathname.endsWith(".wasm") ? Promise.resolve(new Response(bytes)) : real(url, options);
    await runtime.load(SOURCE, { refreshEngine: true });
    expect(fetch.mock.calls.at(-1)[1]).toMatchObject({ refresh: true });
    await runtime.load(SOURCE);
    expect(fetch.mock.calls.at(-1)[1]).toMatchObject({ refresh: false });
  });
});
