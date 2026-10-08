import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
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

const PARENT = "order-dashboard.json";
const PARENT_SCRIPT = "order-dashboard.rhai";
const CHILD = "parts/order-list.json";
const CHILD_SCRIPT = "parts/order-list.rhai";
const read = (name) => readFile(new URL(`../public/screens/${name}`, import.meta.url), "utf8");

// The shipped demo packages, read from disk exactly as a browser would download them.
let sources;
let parent, parentScript, child, childScript;
let wasm, bytes;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  const texts = await Promise.all([PARENT, PARENT_SCRIPT, CHILD, CHILD_SCRIPT].map(read));
  sources = Object.fromEntries(
    [PARENT, PARENT_SCRIPT, CHILD, CHILD_SCRIPT].map((n, i) => [n, texts[i]]),
  );
  parent = JSON.parse(sources[PARENT]);
  parentScript = sources[PARENT_SCRIPT];
  child = JSON.parse(sources[CHILD]);
  childScript = sources[CHILD_SCRIPT];
});

describe("raw ABI で読む受注ダッシュボード", () => {
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
  function load() {
    const url = parent.components.orderList.url;
    return raw({
      op: "load",
      package: parent,
      script: parentScript,
      components: { [url]: { package: child, script: childScript } },
    });
  }
  const keysOf = (width) => raw({ op: "layout", width }).data.widgets.map((w) => w.key);
  const rows = (keys, prefix) => keys.filter((k) => k.startsWith(`${prefix}orders:row:`)).length;

  it("loads the dashboard with the order-list part bundled under its declared url", () => {
    expect(parent.components.orderList.url).toBe("parts/order-list.json");
    expect(load()).toMatchObject({ ok: true, data: { revision: 0 } });
  });

  it("keys every widget uniquely and gives both placements their own grid header", () => {
    expect(load().ok).toBe(true);
    for (const width of [240, 800, 4096]) {
      const keys = keysOf(width);
      expect(new Set(keys).size, `width ${width}: ${keys}`).toBe(keys.length);
      expect(keys, `width ${width}`).toContain("open/orders:header");
      expect(keys, `width ${width}`).toContain("shipped/orders:header");
    }
  });

  it("narrows both placements when the parent query reaches them through config", () => {
    expect(load().ok).toBe(true);
    const before = keysOf(800);
    expect([rows(before, "open/"), rows(before, "shipped/")]).toEqual([2, 2]);
    const filtered = raw({ op: "event", target: "filter", payload: { value: "山田" } });
    expect(filtered.ok).toBe(true);
    expect(filtered.data.revision).toBe(1);
    const after = keysOf(800);
    expect([rows(after, "open/"), rows(after, "shipped/")]).toEqual([1, 0]);
  });

  it("carries a selection from either part up to the parent notice", () => {
    expect(load()).toMatchObject({ ok: true, data: { revision: 0 } });
    const open = raw({ op: "event", target: "open/orders", payload: { id: 1 } });
    expect(open.ok, open.error).toBe(true);
    expect(open.data.revision).toBe(1);
    for (const text of ["受注", "SO-001", "山田商事"])
      expect(open.data.state.notice).toContain(text);
    const shipped = raw({ op: "event", target: "shipped/orders", payload: { id: 2 } });
    expect(shipped.ok, shipped.error).toBe(true);
    expect(shipped.data.revision).toBe(2);
    for (const text of ["出荷済", "SO-002"]) expect(shipped.data.state.notice).toContain(text);
  });
});

describe("UiRuntime 経由の受注ダッシュボード", () => {
  const BASE = "https://example.test/app/";
  const runtimes = [];
  beforeAll(() => {
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
  async function host(options = {}) {
    const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
    // The four demo files are served by the tail of their path, the way they sit under public/.
    const responses = new Map([
      ["order-dashboard.json", sources[PARENT]],
      ["order-dashboard.rhai", sources[PARENT_SCRIPT]],
      ["order-list.json", sources[CHILD]],
      ["order-list.rhai", sources[CHILD_SCRIPT]],
    ]);
    const resources = new ResourceClient({
      baseUrl: BASE,
      fetch: async (url) => {
        const body = responses.get(url.pathname.split("/").at(-1));
        return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
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

  it("hands the same composed scene to the dom and the canvas renderer", async () => {
    // Both surfaces are the same width so the two scenes are comparable widget for widget.
    const runtime = await host({
      surfaces: [
        { element: stage(400), renderer: "dom" },
        { element: stage(400), renderer: "canvas", canvas: {} },
      ],
    });
    await runtime.load("screens/order-dashboard.json");
    expect(runtime.screen.id).toBe("order-dashboard");
    expect(runtime.surfaces.map((s) => s.renderer)).toEqual(["dom", "canvas"]);
    const scenes = [];
    for (const surface of runtime.surfaces) {
      const calls = surface.adapter.render.mock.calls;
      expect(calls.length, surface.renderer).toBeGreaterThan(0);
      const { widgets } = calls.at(-1)[0];
      scenes.push(widgets);
      const keys = widgets.map((w) => w.key);
      expect(
        keys.some((k) => k.startsWith("open/")),
        `${surface.renderer}: ${keys}`,
      ).toBe(true);
      expect(
        keys.some((k) => k.startsWith("shipped/")),
        `${surface.renderer}: ${keys}`,
      ).toBe(true);
    }
    expect(scenes[1]).toEqual(scenes[0]);
  });
});
