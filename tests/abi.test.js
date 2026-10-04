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
