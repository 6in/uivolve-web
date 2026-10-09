import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { componentScope } from "../src/component-tree.js";
import { ResourceClient } from "../src/resource-client.js";
import { UiRuntime } from "../src/runtime.js";
import { WasmEngine } from "../src/engine.js";

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

const BASE = "https://example.test/app/";
const PARENT = "screens/parts-lab.json";
// The shipped lab, the three parts it places and the product JSON one of them asks for.
const FILES = [
  PARENT,
  "screens/parts-lab.rhai",
  "screens/http-grid.json",
  "screens/http-grid.rhai",
  "screens/parts/note-pad.json",
  "screens/parts/note-pad.rhai",
  "screens/parts/approval.json",
  "screens/parts/approval.rhai",
  "data/products.json",
];
const href = (path) => new URL(path, BASE).href;
const read = (path) => readFile(new URL(`../public/${path}`, import.meta.url), "utf8");

let wasm, bytes, sources, parent;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  const texts = await Promise.all(FILES.map(read));
  sources = Object.fromEntries(FILES.map((name, index) => [name, texts[index]]));
  parent = JSON.parse(sources[PARENT]);
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

describe("raw ABI で読む部品ラボ", () => {
  let exports_;
  beforeEach(async () => {
    exports_ = (await WebAssembly.instantiate(wasm, {})).exports;
  });
  function raw(value) {
    const input = new TextEncoder().encode(JSON.stringify(value));
    const pointer = exports_.input_alloc(input.length);
    try {
      new Uint8Array(exports_.memory.buffer, pointer, input.length).set(input);
      const output = exports_.request(pointer, input.length);
      return JSON.parse(
        new TextDecoder().decode(
          new Uint8Array(exports_.memory.buffer, output, exports_.response_len()),
        ),
      );
    } finally {
      exports_.input_free(pointer, input.length);
    }
  }
  // The bundle key is the url the parent declares. The JS loader rewrites it to an absolute href
  // before it gets here; over the raw ABI the url is an opaque key, so the declaration is enough.
  const part = (name, json, script) => [
    parent.components[name].url,
    { package: JSON.parse(sources[json]), script: sources[script] },
  ];
  function load() {
    return raw({
      op: "load",
      package: parent,
      script: sources["screens/parts-lab.rhai"],
      components: Object.fromEntries([
        part("products", "screens/http-grid.json", "screens/http-grid.rhai"),
        part("note", "screens/parts/note-pad.json", "screens/parts/note-pad.rhai"),
        part("approval", "screens/parts/approval.json", "screens/parts/approval.rhai"),
      ]),
    });
  }
  const keysOf = (width) => raw({ op: "layout", width }).data.widgets.map((w) => w.key);

  it("loads the lab with its three parts bundled under their declared urls", () => {
    expect(
      Object.fromEntries(Object.entries(parent.components).map(([name, c]) => [name, c.url])),
    ).toEqual({
      products: "http-grid.json",
      note: "parts/note-pad.json",
      approval: "parts/approval.json",
    });
    expect(load()).toMatchObject({ ok: true, data: { revision: 0 } });
  });

  it("keys every widget of the three placements uniquely", () => {
    expect(load().ok).toBe(true);
    const keys = keysOf(800);
    expect(new Set(keys).size, keys.join(" ")).toBe(keys.length);
    for (const key of ["products/productsGrid:header", "note/text", "approval/ask"])
      expect(keys, keys.join(" ")).toContain(key);
  });
});

describe("UiRuntime 経由の部品ラボ", () => {
  const runtimes = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });
  // The host subscribes to the document's font set and to a resolution media query. The stub
  // records every query it hands out so a test can fire the change the browser would.
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
  // The demo files are served by the href they sit at under public/, the way a browser gets them.
  function fetcher() {
    const responses = new Map(FILES.map((path) => [href(path), sources[path]]));
    return vi.fn(async (url) => {
      const body = responses.get(String(url));
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    });
  }
  /** One Map behind the storage channel, so a second load reads back what a save wrote. */
  function fakeStorage() {
    const scopes = [];
    const keys = [];
    const store = new Map();
    const client = {
      execute: async (scope, effect) => {
        scopes.push(scope);
        keys.push(effect.key);
        const record = `${scope}/${effect.key}`;
        if (effect.operation === "write") {
          store.set(record, effect.data);
          return null;
        }
        if (effect.operation === "remove") {
          store.delete(record);
          return null;
        }
        return store.has(record) ? store.get(record) : null;
      },
    };
    return { client, scopes, keys, store };
  }
  async function host(options = {}) {
    const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
    const fetch = fetcher();
    const resources = new ResourceClient({ baseUrl: BASE, fetch });
    const errors = [];
    const runtime = new UiRuntime({
      baseUrl: BASE,
      engine,
      resources,
      onError: (error) => {
        if (error) errors.push(error);
      },
      surfaces: [{ element: stage(400), renderer: "dom" }],
      ...options,
    });
    runtimes.push(runtime);
    await runtime.start();
    // No IndexedDB here, so the memo read of the part's init is answered by the fake.
    const storage = fakeStorage();
    runtime.storageEffects.client = storage.client;
    return { runtime, fetch, errors, storage };
  }
  const keysOf = (runtime) => runtime.scenes[0].widgets.map((w) => w.key);
  const widget = (runtime, key) => runtime.scenes[0].widgets.find((w) => w.key === key);

  it("hands the same composed scene to the dom and the canvas renderer", async () => {
    // Both surfaces are the same width so the two scenes are comparable widget for widget.
    const { runtime, errors } = await host({
      surfaces: [
        { element: stage(400), renderer: "dom" },
        { element: stage(400), renderer: "canvas", canvas: {} },
      ],
    });
    await runtime.load("screens/parts-lab.json");
    await runtime.whenIdle();
    expect(runtime.screen.id).toBe("parts-lab");
    expect(runtime.surfaces.map((s) => s.renderer)).toEqual(["dom", "canvas"]);
    const scenes = [];
    for (const surface of runtime.surfaces) {
      const calls = surface.adapter.render.mock.calls;
      expect(calls.length, surface.renderer).toBeGreaterThan(0);
      const { widgets } = calls.at(-1)[0];
      scenes.push(widgets);
      const keys = widgets.map((w) => w.key);
      for (const key of ["products/productsGrid:header", "note/text", "approval/ask"])
        expect(keys, `${surface.renderer}: ${keys.join(" ")}`).toContain(key);
    }
    expect(scenes[1]).toEqual(scenes[0]);
    expect(errors).toEqual([]);
  });

  it("saves the memo in the part's own scope and restores it on the next load", async () => {
    const { runtime, errors, storage } = await host();
    await runtime.load("screens/parts-lab.json");
    await runtime.whenIdle();
    runtime.dispatch("note/text", { value: "明日の打ち合わせ" });
    runtime.dispatch("note/save");
    await runtime.whenIdle();
    // Every storage operation of the placement went to the one scope the shared table composes.
    expect([...new Set(storage.scopes)]).toEqual(["parts-lab__note"]);
    expect([...new Set(storage.scopes)]).toEqual([componentScope("parts-lab", "note")]);
    expect([...new Set(storage.keys)]).toEqual(["memo"]);
    expect([...storage.store.keys()]).toEqual(["parts-lab__note/memo"]);
    expect(runtime.state.notice).toContain("メモを保存しました");
    expect(runtime.state.notice).toContain("明日の打ち合わせ");
    // The same runtime, so the same fake client: the memo read of init fills the field again.
    await runtime.load("screens/parts-lab.json");
    await runtime.whenIdle();
    expect(widget(runtime, "note/text").value).toBe("明日の打ち合わせ");
    expect(errors).toEqual([]);
  });

  it("resolves the grid request against the part package and fills its rows", async () => {
    const { runtime, fetch, errors } = await host();
    await runtime.load("screens/parts-lab.json");
    await runtime.whenIdle();
    runtime.dispatch("products/loadProducts");
    await runtime.whenIdle();
    const rows = keysOf(runtime).filter((key) => key.startsWith("products/productsGrid:row:"));
    expect(rows.length, keysOf(runtime).join(" ")).toBeGreaterThan(0);
    // `../data/products.json` is relative to the part package, not to the lab that places it.
    const paths = fetch.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toContain("/app/data/products.json");
    expect(paths).not.toContain("/app/screens/data/products.json");
    expect(errors).toEqual([]);
  });

  it("answers the confirm of the part and carries the approval up to the lab", async () => {
    const { runtime, errors } = await host();
    await runtime.load("screens/parts-lab.json");
    await runtime.whenIdle();
    expect(runtime.state.notice).toBe("各部品のボタンを押してください。");
    expect(widget(runtime, "approval/result").text).toBe("未確認");
    runtime.dispatch("approval/ask");
    // The dialog stack belongs to the screen, so the id a child asked for is numbered at the root.
    const dialog = runtime.snapshot().dialog;
    expect(dialog).toMatchObject({ operation: "confirm" });
    runtime.dispatch(":dialog:" + dialog.id + ":ok");
    await runtime.whenIdle();
    expect(runtime.state.notice).toBe("承認されました。");
    expect(widget(runtime, "approval/result").text).toBe("承認");
    expect(errors).toEqual([]);
  });

  it("keeps the parts of the lab across a detour to another screen", async () => {
    const { runtime, fetch, errors } = await host();
    // `screens/http-grid.json` is both a part of the lab and a screen of its own: it shows the
    // difference between a child, which is shared, and a root, which is always taken again.
    const count = (path) => fetch.mock.calls.filter(([url]) => String(url) === href(path)).length;
    await runtime.load(PARENT);
    await runtime.whenIdle();
    await runtime.load("screens/http-grid.json");
    await runtime.whenIdle();
    await runtime.load(PARENT);
    await runtime.whenIdle();
    expect(runtime.screen.id).toBe("parts-lab");
    expect(count("screens/parts/note-pad.json")).toBe(1);
    expect(count("screens/parts/approval.json")).toBe(1);
    expect(count("screens/http-grid.json")).toBe(2);
    expect(count(PARENT)).toBe(2);
    expect(errors).toEqual([]);
  });
});
