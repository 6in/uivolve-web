import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { create, toBinary } from "@bufbuild/protobuf";
import { ApplicationLoader } from "../src/application-loader.js";
import { componentScope, instanceTable } from "../src/component-tree.js";
import { WasmEngine } from "../src/engine.js";
import { HostEffects } from "../src/host-effects.js";
import { ResourceClient } from "../src/resource-client.js";
import { UiRuntime } from "../src/runtime.js";
import { registry } from "../scripts/rpc-schema.mjs";

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
const ENDPOINT = "https://rpc.test/uivolve.demo.EchoService/Echo";
const href = (path) => new URL(path, BASE).href;

let wasm, bytes, descriptor;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  descriptor = new Uint8Array(
    await readFile(new URL("../public/screens/rpc-demo.pb", import.meta.url)),
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

/** A package of these fixtures: the body a URL serves, with its script next to it. */
const pkg = (id, extra = {}) => ({
  version: 1,
  id,
  title: id,
  script: `${id}.rhai`,
  state: {},
  ui: { xtype: "container", items: [] },
  ...extra,
});
/** A component node: the declared name as the xtype, the placement as the itemId. */
const place = (xtype, itemId, extra = {}) => ({ xtype, itemId, config: {}, ...extra });
const button = (itemId) => ({ xtype: "button", itemId, text: itemId, handler: itemId });

// The fixtures are strings served by the href they sit at, the way a browser downloads them.
function fetcher(files) {
  const responses = new Map();
  for (const [path, body] of Object.entries(files))
    responses.set(
      href(path),
      body instanceof Uint8Array || typeof body === "string" ? body : JSON.stringify(body),
    );
  return vi.fn(async (url) => {
    const body = responses.get(String(url));
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  });
}

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

const runtimes = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

async function newEngine() {
  return new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
}
async function host(files, options = {}) {
  const engine = await newEngine();
  const fetch = fetcher(files);
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
  return { runtime, engine, resources, fetch, errors };
}

// --- 1 / 3: the base URL of a child and the instance a completion comes back with ---

const PING_SCRIPT = `fn init(s) { s }
fn fire(s, e) { http_get("ping"); s }
fn pingDone(s, r) {
    if r.ok { s.got = "ok"; } else { s.got = "ng:" + r.error; }
    emit("pinged", #{ got: s.got });
    s
}`;
const PING_HOST_SCRIPT = `fn init(s) { s }
fn onPinged(s, e) { s.notice = e.target + "/" + e.value.got; s }`;

/** `screens/host.json` places `screens/parts/ping.json` as `a`; the child requests `ping.json`. */
const pingFiles = () => ({
  "screens/host.json": pkg("host", {
    state: { notice: "" },
    components: { ping: { url: "parts/ping.json" } },
    ui: {
      xtype: "container",
      items: [
        { xtype: "label", itemId: "notice", bind: "notice" },
        place("ping", "a", { listeners: { pinged: "onPinged" } }),
      ],
    },
  }),
  "screens/host.rhai": PING_HOST_SCRIPT,
  "screens/parts/ping.json": pkg("ping", {
    state: { got: "" },
    requests: { ping: { url: "ping.json", handler: "pingDone" } },
    ui: {
      xtype: "container",
      items: [button("fire"), { xtype: "label", itemId: "got", bind: "got" }],
    },
  }),
  "screens/parts/ping.rhai": PING_SCRIPT,
});

describe("子 Instance の effect 配送", () => {
  it("resolves a child request against the child package, not the root", async () => {
    const { runtime, resources, errors } = await host(pingFiles());
    await runtime.load("screens/host.json");
    // Only what the dispatch asks for: the packages themselves were downloaded before this.
    const text = vi.spyOn(resources, "text");
    runtime.dispatch("a/fire");
    await runtime.whenIdle();
    const requested = text.mock.calls.map(([url]) => String(url));
    expect(requested).toEqual([href("screens/parts/ping.json")]);
    expect(requested).not.toContain(href("screens/ping.json"));
    expect(errors).toEqual([]);
  });

  it("completes a child request with the instance path and carries the emit up to the root", async () => {
    const { runtime, engine, errors } = await host(pingFiles());
    const complete = vi.spyOn(engine, "completeHttp");
    await runtime.load("screens/host.json");
    runtime.dispatch("a/fire");
    await runtime.whenIdle();
    expect(complete).toHaveBeenCalledTimes(1);
    const [id, response, instance] = complete.mock.calls[0];
    expect(id).toBe(1);
    expect(response).toMatchObject({ ok: true, error: "" });
    expect(instance).toBe("a");
    // The child handler ran and announced it; the root listener moved the root state.
    expect(runtime.state.notice).toBe("a/ok");
    expect(errors).toEqual([]);
  });

  // --- 2: the storage / files scope of a placement ---

  const KEEPER_SCRIPT = `fn init(s) { s }
fn save(s, e) { storage_write("draft", #{ a: 1 }); s }
fn write(s, e) { file_write_text("vol", "f.txt", "text"); s }
fn onStored(s, r) { s }
fn onFile(s, r) { s }`;

  /** The same child, keeping data of its own, placed at `a` and at `b` of the root `host`. */
  const keeperFiles = () => ({
    "screens/host.json": pkg("host", {
      components: { keeper: { url: "parts/keeper.json" } },
      ui: { xtype: "container", items: [place("keeper", "a"), place("keeper", "b")] },
    }),
    "screens/host.rhai": "fn init(s) { s }",
    "screens/parts/keeper.json": pkg("keeper", {
      storage: { draft: { backend: "opfs", key: "draft", handler: "onStored" } },
      files: { vol: { backend: "opfs", access: "readwrite", handler: "onFile" } },
      ui: { xtype: "container", items: [button("save"), button("write")] },
    }),
    "screens/parts/keeper.rhai": KEEPER_SCRIPT,
  });

  it("scopes the storage and the files of a placement to the root id joined with its path", async () => {
    const { runtime, errors } = await host(keeperFiles());
    const stored = [];
    const written = [];
    runtime.storageEffects.client = {
      execute: async (scope) => {
        stored.push(scope);
        return null;
      },
    };
    runtime.fileEffects.client = {
      execute: async (scope) => {
        written.push(scope);
        return null;
      },
    };
    await runtime.load("screens/host.json");
    for (const target of ["a/save", "b/save", "a/write", "b/write"]) runtime.dispatch(target);
    await runtime.whenIdle();
    expect(stored).toEqual(["host__a", "host__b"]);
    expect(written).toEqual(["host__a", "host__b"]);
    // The same rule the shared table composes, for both channels of both placements.
    expect(stored).toEqual([componentScope("host", "a"), componentScope("host", "b")]);
    expect(errors).toEqual([]);
  });

  // --- 6: a child declaring rpc, with its descriptor downloaded next to it ---

  const ECHO_SCRIPT = `fn init(s) { s }
fn fire(s, e) { rpc_call("echo", #{ name: "太郎" }); s }
fn echoDone(s, r) {
    if r.ok { s.message = r.data.name; } else { s.message = r.error; }
    emit("echoed", #{ name: s.message });
    s
}`;
  const ECHO_HOST_SCRIPT = `fn init(s) { s }
fn onEchoed(s, e) { s.notice = e.target + "/" + e.value.name; s }`;

  const echoFiles = () => ({
    "screens/host.json": pkg("host", {
      state: { notice: "" },
      components: { echo: { url: "parts/echo.json" } },
      ui: {
        xtype: "container",
        items: [
          { xtype: "label", itemId: "notice", bind: "notice" },
          place("echo", "a", { listeners: { echoed: "onEchoed" } }),
        ],
      },
    }),
    "screens/host.rhai": ECHO_HOST_SCRIPT,
    "screens/parts/echo.json": pkg("echo", {
      state: { message: "" },
      rpc: {
        echo: {
          url: ENDPOINT,
          descriptor: "rpc-demo.pb",
          service: "uivolve.demo.EchoService",
          method: "Echo",
          protocol: "connect",
          handler: "echoDone",
          idempotent: true,
        },
      },
      ui: {
        xtype: "container",
        items: [button("fire"), { xtype: "label", itemId: "message", bind: "message" }],
      },
    }),
    "screens/parts/echo.rhai": ECHO_SCRIPT,
    "screens/parts/rpc-demo.pb": descriptor,
  });

  it("loads a child declaring rpc and answers it with the instance path", async () => {
    const schema = registry.getMessage("uivolve.demo.EchoResponse");
    const reply = toBinary(schema, create(schema, { name: "Hello 太郎" }));
    const { runtime, engine, errors } = await host(echoFiles());
    runtime.rpcEffects.client = { execute: async () => reply };
    const complete = vi.spyOn(engine, "completeRpc");
    await runtime.load("screens/host.json");
    expect(runtime.screen.id).toBe("host");
    runtime.dispatch("a/fire");
    await runtime.whenIdle();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][2]).toBe("a");
    expect(runtime.state.notice).toBe("a/Hello 太郎");
    expect(errors).toEqual([]);
  });
});

// --- 5: every instance a composed screen reports is a row of the shared table ---

describe("instanceTable と WASM の instance 値", () => {
  const FIRE_SCRIPT = `fn init(s) { s }
fn fire(s, e) { http_get("r"); s }
fn done(s, r) { s }`;
  const requesting = (id, extra = {}) =>
    pkg(id, {
      requests: { r: { url: "r.json", handler: "done" } },
      ui: { xtype: "container", items: [button("fire"), ...(extra.items ?? [])] },
      ...(extra.components ? { components: extra.components } : {}),
    });

  it("names only instances the shared table holds, three levels deep and twice over", async () => {
    const files = {
      "screens/deep.json": requesting("host", {
        components: { mid: { url: "parts/mid.json" }, leaf: { url: "parts/leaf.json" } },
        items: [place("mid", "a"), place("leaf", "b")],
      }),
      "screens/host.rhai": FIRE_SCRIPT,
      "screens/parts/mid.json": requesting("mid", {
        components: { leaf: { url: "leaf.json" } },
        items: [place("leaf", "c")],
      }),
      "screens/parts/mid.rhai": FIRE_SCRIPT,
      "screens/parts/leaf.json": requesting("leaf"),
      "screens/parts/leaf.rhai": FIRE_SCRIPT,
    };
    const resources = new ResourceClient({ baseUrl: BASE, fetch: fetcher(files) });
    const candidate = await new ApplicationLoader({ resources }).fetch(href("screens/deep.json"));
    const table = instanceTable(candidate.screen, candidate.url.href, candidate.components);
    expect([...table.keys()]).toEqual(["", "a", "a/c", "b"]);
    // The same leaf package sits at `a/c` and at `b`, so one body answers for two instances.
    expect(Object.keys(candidate.components).sort()).toEqual(
      [href("screens/parts/mid.json"), href("screens/parts/leaf.json")].sort(),
    );

    const engine = await newEngine();
    engine.load(candidate.screen, candidate.script, candidate.descriptors, {
      components: candidate.components,
    });
    const named = [];
    for (const target of ["fire", "a/fire", "a/c/fire", "b/fire"])
      for (const effect of engine.dispatch(target).effects ?? []) named.push(effect.instance ?? "");
    expect(named).toEqual(["", "a", "a/c", "b"]);
    for (const instance of named) expect(table.has(instance)).toBe(true);
  });
});

// --- 4: the host channel, kept apart per instance ---

describe("HostEffects の Instance 分離", () => {
  const HOST_SCRIPT = `fn init(s) { s }
fn fireHost(s, e) { host_call("op", #{}); s }
fn cancelHost(s, e) { host_cancel("op"); s }
fn onHost(s, r) { s.last = "host"; s }`;
  const operations = { op: { connection: "c", action: "a", handler: "onHost", options: {} } };
  const child = () =>
    pkg("op", {
      state: { last: "" },
      operations,
      ui: { xtype: "container", items: [button("fireHost"), button("cancelHost")] },
    });
  const root = () =>
    pkg("host", {
      state: { last: "" },
      operations,
      components: { op: { url: "op.json" } },
      ui: {
        xtype: "container",
        items: [button("fireHost"), button("cancelHost"), place("op", "a")],
      },
    });

  /** A screen with the same host operation on the root and on its one child. */
  async function composed() {
    const engine = await newEngine();
    engine.load(
      root(),
      HOST_SCRIPT,
      {},
      { components: { "op.json": { screen: child(), script: HOST_SCRIPT } } },
    );
    return engine;
  }
  /** A `HostEffects` whose adapter hands back a promise the test settles. */
  function effects(engine, paths = ["", "a"]) {
    const calls = [];
    const execute = vi.fn(
      (operation, args, context) =>
        new Promise((resolve, reject) => {
          calls.push({ resolve, reject, signal: context.signal });
          context.signal.addEventListener("abort", () => reject(new Error("中止")), { once: true });
        }),
    );
    const complete = vi.fn((id, response, instance) =>
      engine ? engine.completeHost(id, response, instance) : { effects: [] },
    );
    const onError = vi.fn();
    const effects = new HostEffects({
      adapters: [{ name: "db", actions: ["a"], validate() {}, execute }],
      connections: { c: { adapter: "db" } },
      complete,
      onError,
    });
    const prepared = effects.prepare(operations, BASE, {});
    effects.resetInstances(new Map(paths.map((path) => [path, prepared])));
    return { effects, calls, execute, complete, onError };
  }

  it("delivers the root and the child answer of the same id to both instances", async () => {
    const engine = await composed();
    const { effects: host, calls, complete, onError } = effects(engine);
    const rootEffect = engine.dispatch("fireHost").effects[0];
    const childEffect = engine.dispatch("a/fireHost").effects[0];
    expect(rootEffect.id).toBe(1);
    expect(rootEffect.instance).toBeUndefined();
    expect(childEffect).toMatchObject({ id: 1, instance: "a" });
    const running = host.run([rootEffect, childEffect]);
    for (const call of calls.splice(0)) call.resolve({ value: 1 });
    await running;
    expect(complete.mock.calls.map((call) => call[0])).toEqual([1, 1]);
    expect(new Set(complete.mock.calls.map((call) => call[2]))).toEqual(new Set([undefined, "a"]));
    // Both completions were accepted: neither answer was charged to the other instance.
    expect(complete.mock.results.map((result) => result.type)).toEqual(["return", "return"]);
    expect(onError).not.toHaveBeenCalled();
    host.dispose();
  });

  it("aborts only the operations of the instance that cancelled", async () => {
    const engine = await composed();
    const { effects: host, calls, complete, onError } = effects(engine);
    const rootEffect = engine.dispatch("fireHost").effects[0];
    const childEffect = engine.dispatch("a/fireHost").effects[0];
    const running = host.run([rootEffect, childEffect]);
    const cancel = engine.dispatch("a/cancelHost").effects[0];
    expect(cancel).toMatchObject({ kind: "host_cancel", operation: "op", instance: "a" });
    await host.run([cancel]);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(complete.mock.calls[0][2]).toBe("a");
    expect(complete.mock.calls[0][1].error.code).toBe("CANCELLED");
    expect(calls.map((call) => call.signal.aborted)).toEqual([false, true]);
    expect(onError).not.toHaveBeenCalled();
    host.dispose();
    await running;
  });

  it("counts the eight concurrent operations per instance, the root's not among them", async () => {
    const { effects: host, complete } = effects(null);
    const effect = (id, instance) => ({
      kind: "host",
      v: 1,
      id,
      operation: "op",
      args: {},
      ...(instance === undefined ? {} : { instance }),
    });
    const eight = (instance) => Array.from({ length: 8 }, (_, i) => effect(i + 1, instance));
    const running = host.run([...eight(undefined), ...eight("a")]);
    // Eight of the root and eight of the child are all in flight, and none was refused.
    expect(complete).not.toHaveBeenCalled();
    await host.run([effect(9, "a")]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toBe(9);
    expect(complete.mock.calls[0][2]).toBe("a");
    expect(complete.mock.calls[0][1].error).toMatchObject({
      code: "LIMIT",
      message: "同時ホスト操作は8件までです",
    });
    host.dispose();
    await running;
  });
});

// --- 7: a dialog a child asked for is answered with its path ---

describe("completeDialog の instance", () => {
  const ASK_SCRIPT = `fn init(s) { s }
fn fire(s, e) { confirm("続けますか", "answered"); s }
fn answered(s, r) { s.answer = "" + r.data; s }`;

  it("sends the instance of the child along with the dialog answer", async () => {
    const engine = await newEngine();
    const ask = pkg("ask", {
      state: { answer: "" },
      ui: {
        xtype: "container",
        items: [button("fire"), { xtype: "label", itemId: "answer", bind: "answer" }],
      },
    });
    const screen = pkg("host", {
      components: { ask: { url: "ask.json" } },
      ui: { xtype: "container", items: [place("ask", "a")] },
    });
    engine.load(
      screen,
      "fn init(s) { s }",
      {},
      {
        components: { "ask.json": { screen: ask, script: ASK_SCRIPT } },
      },
    );
    const dispatched = engine.dispatch("a/fire");
    const effect = dispatched.effects[0];
    expect(effect).toMatchObject({ kind: "dialog", operation: "confirm", instance: "a" });

    const call = vi.spyOn(engine, "call");
    const result = engine.completeDialog(effect.id, { ok: true, data: true, error: "" }, "a");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toMatchObject({
      op: "dialog_result",
      id: effect.id,
      instance: "a",
      ok: true,
      data: true,
    });
    // The child answered inside the screen's one step.
    expect(result.revision).toBe(dispatched.revision + 1);
  });
});
