import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";

let module_, bytes, exports_, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  module_ = await WebAssembly.compile(bytes);
});
beforeEach(async () => {
  exports_ = (await WebAssembly.instantiate(module_, {})).exports;
  engine = new WasmEngine(exports_, bytes.length);
});
function raw(text) {
  const input = new TextEncoder().encode(text);
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
const screen = {
  version: 1,
  id: "abi",
  title: "ABI 日本語",
  script: "abi.rhai",
  state: { count: 0 },
  ui: {
    xtype: "container",
    items: [
      { xtype: "metric", text: "件数", bind: "count" },
      { xtype: "button", itemId: "add", text: "増やす", handler: "add" },
    ],
  },
};
const script = "fn init(s) { s } fn add(s,e) { s.count+=1; s }";

it("accepts old clockless requests and validates raw clocks in WASM before state changes", () => {
  expect(raw(JSON.stringify({ op: "load", package: screen, script })).ok).toBe(true);
  expect(raw(JSON.stringify({ op: "event", target: "add", payload: {} })).data.state.count).toBe(1);
  for (const clock of [
    { nowMs: 0.1, tzOffsetMinutes: 540 },
    { nowMs: 0, tzOffsetMinutes: 841 },
    { nowMs: 253402300800000, tzOffsetMinutes: 0 },
    { nowMs: 0, tzOffsetMinutes: 0, typo: true },
  ]) {
    expect(raw(JSON.stringify({ op: "event", target: "add", clock })).ok).toBe(false);
  }
  expect(raw(JSON.stringify({ op: "event", target: "add" })).data.state.count).toBe(2);
});

it("loads a screen with its component packages bundled and caps how many may be sent", () => {
  const child = {
    version: 1,
    id: "part",
    title: "部品",
    script: "part.rhai",
    state: { value: 0 },
    ui: { xtype: "container", items: [{ xtype: "metric", text: "件数", bind: "value" }] },
  };
  const parent = {
    ...screen,
    components: { part: { url: "https://example.com/part.json" } },
    ui: {
      xtype: "container",
      items: [
        ...screen.ui.items,
        { xtype: "part", itemId: "open", config: { status: { bind: "count" } } },
      ],
    },
  };
  const components = {
    "https://example.com/part.json": { package: child, script: "fn init(s){s}" },
  };
  const loaded = raw(JSON.stringify({ op: "load", package: parent, script, components }));
  expect(loaded).toMatchObject({ ok: true, data: { state: { count: 0 }, revision: 0 } });
  expect(raw(JSON.stringify({ op: "event", target: "add", payload: {} })).data.state.count).toBe(1);
  const many = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `https://example.com/part${i}.json`,
      { package: child, script: "fn init(s){s}" },
    ]),
  );
  const refused = raw(JSON.stringify({ op: "load", package: parent, script, components: many }));
  expect(refused).toMatchObject({ ok: false, error: "At most 8 component packages" });
  // The refused load leaves the screen that was already running untouched.
  expect(raw(JSON.stringify({ op: "event", target: "add", payload: {} })).data.state.count).toBe(2);
});

it("loads a component package with RPC descriptors of its own", async () => {
  const descriptorBytes = new Uint8Array(
    await readFile(new URL("../public/screens/rpc-demo.pb", import.meta.url)),
  );
  const child = {
    version: 1,
    id: "part",
    title: "部品",
    script: "part.rhai",
    state: { value: 0 },
    rpc: {
      echo: {
        url: "http://127.0.0.1:4180/uivolve.demo.EchoService/Echo",
        descriptor: "rpc-demo.pb",
        service: "uivolve.demo.EchoService",
        method: "Echo",
        protocol: "connect",
        handler: "done",
      },
    },
    ui: { xtype: "container", items: [{ xtype: "metric", text: "件数", bind: "value" }] },
  };
  const parent = {
    ...screen,
    components: { part: { url: "https://example.com/part.json" } },
    ui: {
      xtype: "container",
      items: [...screen.ui.items, { xtype: "part", itemId: "open", config: {} }],
    },
  };
  const childScript = 'fn init(s){s} fn done(s,r){s} fn run(s,e){rpc_call("echo", #{});s}';
  const entry = { package: child, script: childScript };
  // Without descriptors of its own the child cannot resolve the method it declares.
  const refused = raw(
    JSON.stringify({
      op: "load",
      package: parent,
      script,
      components: { "https://example.com/part.json": entry },
    }),
  );
  expect(refused).toMatchObject({
    ok: false,
    error: "Component open: RPC descriptors do not match definitions",
  });
  const id = engine.storeBuffer(descriptorBytes);
  const loaded = raw(
    JSON.stringify({
      op: "load",
      package: parent,
      script,
      components: {
        "https://example.com/part.json": { ...entry, descriptors: { "rpc-demo.pb": id } },
      },
    }),
  );
  expect(loaded).toMatchObject({ ok: true, data: { state: { count: 0 }, revision: 0 } });
});

it("delivers a completion to the component instance the effect named", () => {
  const child = {
    version: 1,
    id: "part",
    title: "部品",
    script: "part.rhai",
    state: { last: "" },
    requests: { load: { url: "d.json", handler: "done" } },
    ui: {
      xtype: "container",
      items: [
        { xtype: "metric", text: "最後", bind: "last" },
        { xtype: "button", itemId: "fire", text: "取得", handler: "fire" },
      ],
    },
  };
  const parent = {
    ...screen,
    components: { part: { url: "https://example.com/part.json" } },
    ui: {
      xtype: "container",
      items: [...screen.ui.items, { xtype: "part", itemId: "open", config: {} }],
    },
  };
  const childScript =
    'fn init(s){s} fn fire(s,e){http_get("load");s} fn done(s,r){s.last = "done";s}';
  const components = {
    "https://example.com/part.json": { package: child, script: childScript },
  };
  expect(raw(JSON.stringify({ op: "load", package: parent, script, components })).ok).toBe(true);
  const fired = raw(JSON.stringify({ op: "event", target: "open/fire", payload: {} }));
  expect(fired.data.effects).toEqual([
    { kind: "http", id: 1, request: "load", url: "d.json", instance: "open" },
  ]);
  const layout = JSON.stringify(raw(JSON.stringify({ op: "layout", width: 800 })));
  const result = { op: "http_result", id: 1, ok: true, data: {}, error: "" };
  // A path that is not a path at all, and an instance nobody placed: both are refused, and
  // neither of them touches the screen the host is already showing.
  for (const [instance, error] of [
    [null, "Invalid component instance"],
    ["", "Invalid component instance"],
    [{}, "Invalid component instance"],
    ["open/", "Invalid component instance"],
    ["zzz", "Unknown component instance: zzz"],
  ]) {
    expect(raw(JSON.stringify({ ...result, instance }))).toMatchObject({ ok: false, error });
    expect(JSON.stringify(raw(JSON.stringify({ op: "layout", width: 800 })))).toBe(layout);
  }
  // The root never handed out this id, so the answer is nobody's until it is addressed.
  expect(raw(JSON.stringify(result))).toMatchObject({
    ok: false,
    error: "Unknown or completed HTTP request",
  });
  expect(raw(JSON.stringify({ ...result, instance: "open" }))).toMatchObject({ ok: true });
  expect(JSON.stringify(raw(JSON.stringify({ op: "layout", width: 800 })))).not.toBe(layout);
});

it("exports the existing raw ABI without requiring browser imports", () => {
  expect(WebAssembly.Module.imports(module_)).toEqual([]);
  for (const name of ["input_alloc", "input_free", "request", "response_len"])
    expect(typeof exports_[name]).toBe("function");
  expect(exports_.memory).toBeInstanceOf(WebAssembly.Memory);
});
it("returns structured errors for malformed input and preserves the loaded runtime", () => {
  engine.load(screen, script);
  for (const text of [
    "{",
    "null",
    "{}",
    '{"op":"unsupported"}',
    '{"op":"event"}',
    '{"op":"layout"}',
  ]) {
    const response = raw(text);
    expect(response.ok).toBe(false);
    expect(typeof response.error).toBe("string");
  }
  expect(engine.dispatch("add")).toMatchObject({ state: { count: 1 }, revision: 1 });
  expect(engine.layout(400).widgets.some((w) => w.text === "増やす")).toBe(true);
});
it("keeps independent WASM instances and rejects invalid replacement state/theme atomically", async () => {
  engine.load(screen, script);
  const other = new WasmEngine((await WebAssembly.instantiate(module_, {})).exports, bytes.length);
  expect(() => other.layout(400)).toThrow(/No screen/);
  const original = engine.theme();
  engine.theme({ version: 1, mode: "dark" });
  expect(other.theme()).toEqual(original);
  expect(() => engine.theme({ version: 1, mode: "dark", colors: { text: "invalid" } })).toThrow();
  expect(engine.layout(400).theme.mode).toBe("dark");
  expect(() => engine.load(screen, 'fn init(s) { throw "bad init"; s }')).toThrow();
  expect(engine.dispatch("add").state.count).toBe(1);
  const result = engine.dispatch("add");
  engine.layout(400);
  expect(result.state.count).toBe(2);
});

it("creates a refreshed candidate with the current theme and option-aware dialog functions", async () => {
  engine.load(screen, script);
  engine.dispatch("add");
  engine.theme({ version: 1, mode: "dark", colors: { primary: "#123456" } });
  const candidate = await WasmEngine.create("https://example.com/engine.wasm", {
    resources: { fetch: async () => new Response(bytes) },
    theme: engine.theme(),
  });
  expect(candidate.theme()).toEqual(engine.theme());
  expect(() => candidate.load(screen, 'fn init(s){throw "failed";s} fn add(s,e){s}')).toThrow();
  expect(engine.dispatch("add").state.count).toBe(2);
  candidate.load(
    screen,
    'fn init(s){s} fn add(s,e){confirm("確認","done",#{icon:"warning"});s} fn done(s,r){s.count=if r.data {10}else{20};s}',
  );
  const effect = candidate.dispatch("add").effects[0];
  expect(effect).toMatchObject({ operation: "confirm", icon: "warning" });
  expect(candidate.layout(500).dialog.operation).toBe("confirm");
  expect(candidate.dispatch(":dialog:" + effect.id + ":ok").state.count).toBe(10);
  expect(engine.dispatch("add").state.count).toBe(3);
});

it("revalidates WASM when loading without ResourceClient", async () => {
  const fetcher = vi.fn(async () => new Response(bytes));
  vi.stubGlobal("fetch", fetcher);
  try {
    const candidate = await WasmEngine.create("https://example.com/engine.wasm");
    expect(fetcher).toHaveBeenCalledWith("https://example.com/engine.wasm", {
      cache: "no-cache",
      signal: undefined,
    });
    expect(candidate.bytes).toBe(bytes.length);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("rejects failed or cancelled refreshes without changing the current runtime", async () => {
  engine.load(screen, script);
  const before = engine.layout(500);
  await expect(
    WasmEngine.create("https://example.com/engine.wasm", {
      resources: { fetch: async () => new Response("failed", { status: 500 }) },
    }),
  ).rejects.toThrow(/HTTP 500/);
  const controller = new AbortController();
  await expect(
    WasmEngine.create("https://example.com/engine.wasm", {
      signal: controller.signal,
      resources: {
        fetch: async () => ({
          ok: true,
          arrayBuffer: async () => {
            controller.abort();
            return bytes;
          },
        }),
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(engine.layout(500)).toEqual(before);
  expect(engine.dispatch("add").state.count).toBe(1);
});

it("rejects malformed raw progress without consuming the pending call", () => {
  const definition = {
    ...screen,
    operations: {
      transfer: {
        connection: "api",
        action: "http.download",
        handler: "done",
        options: { progressHandler: "progress" },
      },
    },
  };
  engine.load(
    definition,
    'fn init(s){host_call("transfer", #{});s} fn add(s,e){s} fn done(s,r){s.count+=10;s} fn progress(s,p){s.count+=1;s}',
  );
  for (const request of [
    { op: "host_progress" },
    { op: "host_progress", id: 1 },
    { op: "host_progress", id: 1, data: { operation: "other", transferred: 0, total: null } },
  ]) {
    expect(raw(JSON.stringify(request)).ok).toBe(false);
  }
  const data = { operation: "transfer", transferred: 0, total: 0 };
  expect(raw(JSON.stringify({ op: "host_progress", id: 1, data })).data.state.count).toBe(1);
  expect(engine.completeHost(1, { ok: true, data: null, error: null }).state.count).toBe(11);
  expect(raw(JSON.stringify({ op: "host_progress", id: 1, data })).ok).toBe(false);
});
