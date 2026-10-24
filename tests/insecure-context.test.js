import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import { WasmEngine } from "../src/engine.js";
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

// A page served over plain http (other than localhost) gets `crypto.getRandomValues` but neither
// `crypto.randomUUID` nor `crypto.subtle`; the host must still load a screen with components there.
describe("安全でないコンテキストでの UiRuntime", () => {
  const BASE = "https://example.test/app/";
  const SOURCE = "pages/home.json";
  const CARD_URL = "https://example.test/app/pages/card.json";
  const ROOT_SCRIPT = "fn init(s){s}";
  const CARD_SCRIPT = "fn init(s){s}";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

  let wasm, bytes;
  const runtimes = [];
  beforeAll(async () => {
    bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
    wasm = await WebAssembly.compile(bytes);
  });
  beforeEach(() => {
    vi.stubGlobal("crypto", { getRandomValues: (a) => webcrypto.getRandomValues(a) });
    expect(
      globalThis.crypto.randomUUID === undefined && globalThis.crypto.subtle === undefined,
    ).toBe(true);
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
    vi.unstubAllGlobals();
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
        if (url.href === new URL(SOURCE, BASE).href)
          return new Response(JSON.stringify(parent(CARD_URL)));
        if (url.href === CARD_URL) return new Response(JSON.stringify(card()));
        if (url.pathname.endsWith(".rhai"))
          return new Response(url.pathname.endsWith("/card.rhai") ? CARD_SCRIPT : ROOT_SCRIPT);
        return new Response("missing", { status: 404 });
      },
    });
    const runtime = new UiRuntime({
      baseUrl: BASE,
      engine,
      resources,
      cacheMode: "network-only",
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

  // main: the child's hash stops the load (`Cannot read properties of undefined (reading 'digest')`),
  // and past it the commit throws `crypto.randomUUID is not a function`.
  it("loads a screen with a component twice and gives each load its own token", async () => {
    const errors = [];
    const runtime = await host({ clockProvider: fixedClock, onError: (e) => errors.push(e) });
    await runtime.load(SOURCE);
    const first = runtime.screenToken;
    await runtime.load(SOURCE);
    const second = runtime.screenToken;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e === null)).toBe(true);
    expect(runtime.screen.id).toBe("home");
    expect(Object.keys(runtime.components)).toEqual([CARD_URL]);
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  // main: `crypto.randomUUID is not a function`; a token drawn from the engine's random pool would
  // instead repeat itself under a fixed provider.
  it("keeps the token apart from randomProvider, so a fixed provider still gives distinct tokens", async () => {
    const runtime = await host({
      clockProvider: fixedClock,
      randomProvider: () => new Uint8Array(1024),
    });
    await runtime.load(SOURCE);
    const first = runtime.screenToken;
    await runtime.load(SOURCE);
    expect(first).toMatch(UUID);
    expect(runtime.screenToken).toMatch(UUID);
    expect(runtime.screenToken).not.toBe(first);
  });

  // main: `Cannot read properties of undefined (reading 'digest')` while hashing the child.
  it("hashes the child's source without crypto.subtle to the same SHA-256 as node:crypto", async () => {
    const runtime = await host({ clockProvider: fixedClock });
    const fetch = vi.spyOn(runtime.applicationLoader, "fetch");
    await runtime.load(SOURCE);
    const candidate = await fetch.mock.results[0].value;
    const expected = createHash("sha256").update(JSON.stringify(card()), "utf8").digest("hex");
    expect(candidate.components[CARD_URL].hashes.source).toBe(expected);
  });
});
