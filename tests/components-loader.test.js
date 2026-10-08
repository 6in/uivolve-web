import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { ApplicationLoader, manifestRevision, sha256 } from "../src/application-loader.js";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { ResourceClient } from "../src/resource-client.js";
import { UiRuntime } from "../src/runtime.js";

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

  it("refuses a screen with components on the delivery cache path", async () => {
    const parent = screen("parent", {
      components: { a: { url: "a.json" } },
      ui: { xtype: "container", items: [node("a")] },
    });
    const url = new URL(href("parent.json"));
    const sidecar = new URL(url);
    sidecar.pathname += ".manifest.json";
    const source = encoder.encode(JSON.stringify(parent));
    const script = encoder.encode("fn init(s) { s }");
    const metadata = {
      version: 1,
      revision: "a".repeat(64),
      source: { url: "versions/a/source", sha256: await sha256(source), size: source.length },
      script: { url: "versions/a/script", sha256: await sha256(script), size: script.length },
    };
    metadata.revision = await manifestRevision(metadata);
    const f = fixture([["a.json", screen("a")]]);
    f.responses.set(sidecar.href, JSON.stringify(metadata));
    f.responses.set(new URL(metadata.source.url, sidecar).href, source);
    f.responses.set(new URL(metadata.script.url, sidecar).href, script);
    await expect(f.loader.fetch(url, { mode: "network-first" })).rejects.toThrow(
      "componentsを持つ画面は配信キャッシュ（network-first）に対応していません",
    );
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
});
