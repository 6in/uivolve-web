import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { ResourceClient } from "../src/resource-client.js";
import { UiRuntime } from "../src/runtime.js";
import { createApplication, validateAppConfig } from "../src/application.js";
import { createUiTools } from "../src/ui-tools.js";
import { readPageRoute } from "../src/page-router.js";
import { memoryOpfs } from "./helpers/opfs.js";

it("uses one sampled clock for datepicker.today and init while preserving explicit today", async () => {
  let nowMs = Date.parse("2026-10-04T23:59:59.999+09:00");
  const clockProvider = vi.fn(() => ({ nowMs: nowMs++, tzOffsetMinutes: 540 }));
  const runtime = await host({ clockProvider });
  const screen = {
    ...definition,
    ui: {
      xtype: "container",
      items: [
        { xtype: "datepicker", itemId: "autoCalendar", bind: "selected", pageBind: "month" },
        {
          xtype: "datepicker",
          itemId: "fixedCalendar",
          bind: "fixedSelected",
          pageBind: "fixedMonth",
          today: "2024-02-29",
        },
        { xtype: "button", itemId: "check", handler: "check" },
      ],
    },
    state: { selected: "", month: "2026-10", fixedSelected: "", fixedMonth: "2024-02" },
  };
  runtime.compile(
    screen,
    "fn init(s){s.today=date_today();s} fn check(s,e){s.today=date_today();s}",
    "pages/home.yaml",
  );
  expect(clockProvider).toHaveBeenCalledTimes(1);
  expect(runtime.state.today).toBe("2026-10-04");
  expect(runtime.screen.ui.items[0].today).toBe("2026-10-04");
  expect(runtime.screen.ui.items[1].today).toBe("2024-02-29");
  runtime.dispatch("check");
  expect(runtime.state.today).toBe("2026-10-05");
  expect(runtime.screen.ui.items[0].today).toBe("2026-10-04");
  expect(clockProvider).toHaveBeenCalledTimes(2);
});

it("retains the clock provider on WASM refresh and preserves the active screen on an invalid clock", async () => {
  const clockProvider = () => ({
    nowMs: Date.parse("2026-10-04T00:00:00+09:00"),
    tzOffsetMinutes: 540,
  });
  const runtime = await host({ clockProvider });
  await runtime.load("pages/home.yaml");
  const realFetch = runtime.resources.fetch.bind(runtime.resources);
  runtime.resources.fetch = (url, options) =>
    url.pathname.endsWith(".wasm") ? Promise.resolve(new Response(bytes)) : realFetch(url, options);
  await runtime.load("pages/home.yaml", { refreshEngine: true });
  expect(runtime.engine.clockProvider).toBe(clockProvider);
  const previous = runtime.snapshot();
  runtime.engine.clockProvider = () => ({ nowMs: 0, tzOffsetMinutes: 1000 });
  expect(() => runtime.compile(definition, script, "pages/home.yaml")).toThrow(/clock/);
  expect(runtime.snapshot()).toEqual(previous);
});

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

let wasm, bytes, definition, script;
const runtimes = [];
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  definition = parsePackage(
    await readFile(new URL("../examples/minimal/pages/home.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  script = await readFile(new URL("../examples/minimal/pages/home.rhai", import.meta.url), "utf8");
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
  const resources = new ResourceClient({
    baseUrl: "https://example.test/app/",
    fetch: async (url) => {
      const name = url.pathname.split("/").at(-1);
      return new Response(name.endsWith(".yaml") ? JSON.stringify(definition) : script);
    },
  });
  const runtime = new UiRuntime({
    baseUrl: "https://example.test/app/",
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

it("passes host transferLimit and screen file context before replacing the active engine state", async () => {
  const runtime = await host({
    transferLimit: 2048,
    connections: { api: { adapter: "http", baseUrl: "https://example.test/api/" } },
  });
  const prepare = vi.spyOn(runtime.hostEffects, "prepare");
  const screen = {
    ...definition,
    files: { disk: { backend: "opfs", access: "readwrite", handler: "received" } },
    operations: {
      download: { connection: "api", action: "http.download", handler: "received", options: {} },
    },
  };
  runtime.compile(screen, script + " fn received(s,r){s}", "pages/home.yaml");
  expect(prepare.mock.calls[0][2]).toEqual({ scope: screen.id, files: screen.files });
  expect(prepare.mock.results[0].value.get("download").adapter.transferLimit).toBe(2048);
  const previous = runtime.snapshot();
  const load = vi.spyOn(runtime.engine, "load");
  screen.operations.download.options.method = "POST";
  expect(() =>
    runtime.compile(screen, script + " fn received(s,r){s}", "pages/home.yaml"),
  ).toThrow();
  expect(load).not.toHaveBeenCalled();
  expect(runtime.snapshot()).toEqual(previous);
});

it("forwards createApplication transferLimit as host configuration and rejects invalid values", async () => {
  const resources = {
    text: vi.fn(async () =>
      JSON.stringify({
        version: 1,
        renderer: "dom",
        initialPage: "home",
        pages: [{ id: "home", url: "home.yaml" }],
      }),
    ),
    fetch: vi.fn(),
  };
  await expect(
    createApplication({
      configUrl: "https://example.test/app/app.json",
      resources,
      transferLimit: 0,
    }),
  ).rejects.toThrow(/transferLimit/);
  expect(resources.fetch).not.toHaveBeenCalled();
});

it("uses the same host and state for one or both rendering adapters without demo elements", async () => {
  const runtime = await host();
  await runtime.load("pages/home.yaml", { expectedId: "home" });
  runtime.dispatch("nameInput", { value: "太郎" });
  runtime.dispatch("helloButton");
  expect(runtime.snapshot().state.greeting).toBe("Hello 太郎");
  expect(runtime.scenes.map((scene) => scene.width)).toEqual([400, 500]);
  for (const surface of runtime.surfaces) {
    const scene = surface.adapter.render.mock.calls.at(-1)[0];
    expect(scene.widgets.find((widget) => widget.key === "greetingLabel").text).toBe("Hello 太郎");
    expect(scene.assetBase).toBe("https://example.test/app/pages/home.yaml");
  }
  const detached = runtime.snapshot();
  detached.state.name = "変更";
  expect(runtime.snapshot().state.name).toBe("太郎");
});

it("repaints when fonts settle or fail and when only the device pixel ratio changes, and both stop at dispose", async () => {
  const ownerDocument = testDocument();
  const runtime = await host({
    surfaces: [{ element: stage(400, ownerDocument), renderer: "dom" }],
  });
  await runtime.load("pages/home.yaml");
  const repaint = vi.spyOn(runtime, "scheduleRender");
  // Flush the initial fonts.ready subscription so the counts below only reflect new signals.
  await new Promise((done) => setTimeout(done, 0));
  expect(repaint).not.toHaveBeenCalled();
  ownerDocument.fonts.dispatchEvent(new Event("loadingdone"));
  ownerDocument.fonts.dispatchEvent(new Event("loadingerror"));
  expect(repaint).toHaveBeenCalledTimes(2);
  // A ratio change can leave every CSS size untouched, so only the resolution query reports
  // it, and the watcher has to re-arm at the new ratio to still see the next one.
  const armed = () => ownerDocument.defaultView.queries.at(-1);
  expect(armed().media).toBe("(resolution: 1dppx)");
  for (const ratio of [2, 1]) {
    const previous = armed();
    ownerDocument.defaultView.devicePixelRatio = ratio;
    previous.dispatchEvent(new Event("change"));
    expect(armed().media).toBe(`(resolution: ${ratio}dppx)`);
  }
  expect(repaint).toHaveBeenCalledTimes(4);
  const ratioQuery = armed();
  // A second runtime on the same document must not take this one's subscriptions with it.
  const other = await host({ surfaces: [{ element: stage(500, ownerDocument), renderer: "dom" }] });
  other.dispose();
  ownerDocument.fonts.dispatchEvent(new Event("loadingdone"));
  expect(repaint).toHaveBeenCalledTimes(5);
  runtime.dispose();
  ownerDocument.fonts.dispatchEvent(new Event("loadingdone"));
  ratioQuery.dispatchEvent(new Event("change"));
  expect(repaint).toHaveBeenCalledTimes(5);
});

it("keeps the page, edited state and token when downloads, init or configured IDs fail", async () => {
  const runtime = await host();
  await runtime.load("pages/home.yaml");
  runtime.dispatch("nameInput", { value: "保持" });
  const before = runtime.snapshot();
  await expect(runtime.load("pages/home.yaml", { expectedId: "wrong" })).rejects.toThrow(/id/);
  expect(() =>
    runtime.compile(
      definition,
      'fn init(s) {throw "失敗";} fn sayHello(s,e) {s}',
      "pages/home.yaml",
    ),
  ).toThrow(/失敗/);
  runtime.resources.fetch = async () => {
    throw new Error("download failed");
  };
  await expect(runtime.load("missing.yaml")).rejects.toThrow();
  expect(runtime.snapshot()).toEqual(before);
});

it("rejects a busy dispatch and explicit abort before load changes state", async () => {
  let busy = false;
  const runtime = await host({ isBusy: () => busy });
  await runtime.load("pages/home.yaml");
  busy = true;
  expect(() => runtime.dispatch("helloButton")).toThrow(/準備/);
  await expect(runtime.load("pages/home.yaml")).rejects.toThrow(/読み込み/);
  busy = false;
  const controller = new AbortController();
  controller.abort();
  await expect(runtime.load("pages/home.yaml", { signal: controller.signal })).rejects.toThrow();
  expect(runtime.snapshot().revision).toBe(0);
});

it("aborts a replaced pending load and never commits its late response", async () => {
  const runtime = await host();
  await runtime.load("pages/home.yaml");
  let resolve;
  const waiting = new Promise((done) => {
    resolve = done;
  });
  const realFetch = runtime.resources.fetch.bind(runtime.resources);
  runtime.resources.fetch = (url, options) =>
    url.pathname.endsWith("late.yaml") ? waiting : realFetch(url, options);
  const late = runtime.load("pages/late.yaml");
  await runtime.load("pages/home.yaml", { replacePending: true });
  const token = runtime.snapshot().screen.token;
  resolve(new Response(JSON.stringify({ ...definition, id: "late" })));
  await expect(late).rejects.toThrow();
  expect(runtime.snapshot().screen.token).toBe(token);
  expect(runtime.snapshot().screen.id).toBe("home");
});

it("clamps widths, scopes themes to surfaces and releases adapters on dispose", async () => {
  const runtime = await host({ surfaces: [{ element: stage(9000), renderer: "dom" }] });
  await runtime.load("pages/home.yaml");
  expect(runtime.scenes[0].width).toBe(4096);
  runtime.theme(runtime.engine.theme());
  const surface = runtime.surfaces[0];
  expect(surface.element.style.setProperty).toHaveBeenCalled();
  runtime.dispose();
  runtime.dispose();
  expect(surface.adapter.dispose).toHaveBeenCalledTimes(1);
  expect(surface.element.className).toBe("host");
  expect(() => runtime.dispatch("helloButton")).toThrow(/破棄/);
  await expect(runtime.load("pages/home.yaml")).rejects.toThrow(/破棄/);
});

it("completes HTTP effects and redraws through the shared runtime", async () => {
  const runtime = await host();
  const screen = {
    ...definition,
    requests: { greeting: { url: "../api/hello.json", handler: "received" } },
  };
  const code =
    'fn init(s) {s} fn sayHello(s,e) {http_get("greeting"); s} fn received(s,e) {s.greeting=e.data.message; s}';
  runtime.compile(screen, code, "pages/home.yaml");
  runtime.resources.text = async (url) => {
    expect(url.href).toBe("https://example.test/app/api/hello.json");
    return JSON.stringify({ message: "Hello HTTP" });
  };
  runtime.dispatch("helloButton");
  await runtime.whenIdle();
  expect(runtime.snapshot().state.greeting).toBe("Hello HTTP");
  expect(runtime.scenes[0].widgets.find((widget) => widget.key === "greetingLabel").text).toBe(
    "Hello HTTP",
  );
});

it("does not apply an old HTTP completion after switching screens or disposing", async () => {
  const onState = vi.fn();
  const runtime = await host({ onState });
  const screen = {
    ...definition,
    requests: { greeting: { url: "../api/hello.json", handler: "received" } },
  };
  runtime.compile(
    screen,
    'fn init(s) {s} fn sayHello(s,e) {http_get("greeting"); s} fn received(s,e) {s.greeting="late";s}',
    "pages/home.yaml",
  );
  let resolve;
  runtime.resources.text = () =>
    new Promise((done) => {
      resolve = done;
    });
  runtime.dispatch("helloButton");
  runtime.compile(definition, script, "pages/home.yaml");
  const calls = onState.mock.calls.length;
  runtime.dispose();
  resolve("{}");
  await runtime.whenIdle();
  expect(onState).toHaveBeenCalledTimes(calls);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function downloadRuntime(progressBody = "s.progress=p.transferred;s") {
  const fs = memoryOpfs();
  const previousNavigator = globalThis.navigator;
  vi.stubGlobal("navigator", { storage: fs.storage });
  const onState = vi.fn();
  const onError = vi.fn();
  const runtime = await host({
    onState,
    onError,
    resources: new ResourceClient({
      baseUrl: "https://example.test/app/",
      fetch: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1]));
                controller.enqueue(new Uint8Array([2]));
                controller.close();
              },
            }),
          ),
      ),
    }),
    connections: { api: { adapter: "http", baseUrl: "https://example.test/api/" } },
  });
  runtime.compile(
    {
      ...definition,
      id: "runtime-transfer",
      state: { progress: 0, result: null },
      stateSchema: undefined,
      files: { disk: { backend: "opfs", access: "readwrite", handler: "received" } },
      operations: {
        download: {
          connection: "api",
          action: "http.download",
          handler: "received",
          options: { progressHandler: "progress" },
        },
      },
      ui: { xtype: "button", itemId: "download", handler: "download" },
    },
    `fn init(s){s} fn download(s,e){host_call("download", #{file: #{volume:"disk",path:"data.bin"}});s}
      fn received(s,r){s.result=r;s} fn progress(s,p){${progressBody}}`,
    "pages/home.yaml",
  );
  const entered = deferred();
  const release = deferred();
  let writes = 0;
  fs.controls.beforeWrite = async () => {
    if (++writes === 2) {
      entered.resolve();
      await release.promise;
    }
  };
  return { runtime, fs, onState, onError, entered, release, previousNavigator };
}

it.each(["replace", "dispose"])(
  "drops transfer progress and completion after runtime %s while a write is pending",
  async (action) => {
    const fixture = await downloadRuntime();
    const { runtime, onState, onError, entered, release, previousNavigator } = fixture;
    try {
      const complete = vi.spyOn(runtime.engine, "completeHost");
      const progress = vi.spyOn(runtime.engine, "progressHost");
      runtime.dispatch("download");
      await entered.promise;
      await vi.waitFor(() => expect(runtime.state.progress).toBe(1));
      expect(progress).toHaveBeenCalledTimes(1);
      if (action === "replace") runtime.compile(definition, script, "pages/home.yaml");
      else runtime.dispose();
      const snapshot = runtime.snapshot();
      const count = onState.mock.calls.length;
      release.resolve();
      await runtime.whenIdle();
      expect(complete).not.toHaveBeenCalled();
      expect(progress).toHaveBeenCalledTimes(1);
      expect(onState).toHaveBeenCalledTimes(count);
      expect(runtime.snapshot()).toEqual(snapshot);
      expect(onError.mock.calls.filter(([error]) => error)).toEqual([]);
    } finally {
      release.resolve();
      await runtime.whenIdle();
      runtime.dispose();
      vi.stubGlobal("navigator", previousNavigator);
    }
  },
);

it("reports a real WASM progress handler rollback and still commits the downloaded file once", async () => {
  const fixture = await downloadRuntime(
    's.progress=999;host_cancel("download");throw "progress failed";s',
  );
  const { runtime, fs, onError, entered, release, previousNavigator } = fixture;
  try {
    const complete = vi.spyOn(runtime.engine, "completeHost");
    runtime.dispatch("download");
    await entered.promise;
    await vi.waitFor(() =>
      expect(onError.mock.calls.some(([error]) => error?.message.includes("progress failed"))).toBe(
        true,
      ),
    );
    expect(runtime.state).toEqual({ progress: 0, result: null });
    release.resolve();
    await runtime.whenIdle();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(runtime.state.result).toMatchObject({
      ok: true,
      data: { body: null, files: [{ size: 2 }] },
    });
    const disk = fs.root.children
      .get("uivolve-web")
      .children.get("fs")
      .children.get("runtime-transfer")
      .children.get("disk");
    const file = await disk.children.get("data.bin").getFile();
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2]);
  } finally {
    release.resolve();
    await runtime.whenIdle();
    runtime.dispose();
    vi.stubGlobal("navigator", previousNavigator);
  }
});

it("uses an application-specific page catalog for routes and WebMCP", async () => {
  const config = validateAppConfig(
    {
      version: 1,
      renderer: "canvas",
      initialPage: "home",
      pages: [{ id: "home", url: "pages/home.yaml" }],
    },
    "https://example.test/app/",
  );
  expect(config.pages[0].url).toBe("https://example.test/app/pages/home.yaml");
  expect(
    readPageRoute(
      "https://example.test/app/",
      "https://example.test/app/",
      ["home"],
      config.initialPage,
    ),
  ).toBe("home");
  const runtime = await host();
  await runtime.load("pages/home.yaml");
  const loadScreen = vi.fn((id, options) => runtime.load("pages/home.yaml", options));
  const tools = createUiTools(
    {
      snapshot: () => runtime.snapshot(),
      dispatch: (target, payload) => runtime.dispatch(target, payload),
      loadScreen,
    },
    config.pages,
  );
  expect((await tools[0].execute()).screens.map((page) => page.id)).toEqual(["home"]);
  const snapshot = runtime.snapshot();
  const input = { screenToken: snapshot.screen.token, revision: snapshot.revision, id: "orders" };
  expect((await tools[4].execute(input)).error.code).toBe("INVALID_INPUT");
  expect(loadScreen).not.toHaveBeenCalled();
});

it.each([
  { version: 2 },
  { renderer: "gpu" },
  { initialPage: "missing" },
  { pages: [] },
  { pages: [{ id: "home", url: "javascript:alert(1)" }] },
  { pages: [{ id: "../escape", url: "home.yaml" }] },
  {
    pages: [
      { id: "home", url: "a.yaml" },
      { id: "home", url: "b.yaml" },
    ],
  },
  { cacheMode: "cache-first" },
  { webmcp: "yes" },
  { theme: {} },
])("rejects invalid application config %j", (change) => {
  expect(() =>
    validateAppConfig(
      {
        version: 1,
        renderer: "dom",
        initialPage: "home",
        pages: [{ id: "home", url: "home.yaml" }],
        ...change,
      },
      "https://example.test/app/",
    ),
  ).toThrow();
});
