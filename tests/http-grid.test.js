import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { HttpEffects } from "../src/http-effects.js";
import { ResourceClient } from "../src/resource-client.js";

let wasm, bytes, screen, script, products, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  screen = JSON.parse(await readFile(new URL("../public/screens/http-grid.json", import.meta.url)));
  script = await readFile(new URL("../public/screens/http-grid.rhai", import.meta.url), "utf8");
  products = JSON.parse(await readFile(new URL("../public/data/products.json", import.meta.url)));
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
  engine.load(screen, script);
});
const success = (data = products) => ({ ok: true, data, error: "" });
const request = () => engine.dispatch("loadProducts").effects[0];

it("emits requests from init and completion handlers through the same host", async () => {
  const initial = engine.load(
    screen,
    'fn init(s) {s.steps=0; http_get("products"); s} fn loadProducts(s,e) {s} fn productsReceived(s,r) {s.steps+=1; if s.steps<2 {http_get("products");} s}',
  );
  let result;
  const text = vi.fn(async () => JSON.stringify(products));
  const host = new HttpEffects({
    resources: { text },
    complete: (id, response) => (result = engine.completeHttp(id, response)),
    onError: (e) => {
      throw e;
    },
  });
  host.reset(new URL("https://example.test/screens/http-grid.json"));
  await host.run(initial.effects);
  expect(text).toHaveBeenCalledTimes(2);
  expect(result.state.steps).toBe(2);
  expect(result.revision).toBe(2);
});

it("fetches JSON without authorization and renders rows through the common engine", async () => {
  let result;
  const fetch = vi.fn(async () => new Response(JSON.stringify(products)));
  const onError = vi.fn();
  const host = new HttpEffects({
    resources: new ResourceClient({ baseUrl: "https://example.test/", fetch }),
    complete: (id, response) => (result = engine.completeHttp(id, response)),
    onError,
  });
  host.reset(new URL("https://example.test/screens/http-grid.json"));
  const started = engine.dispatch("loadProducts");
  expect(started.state.loading).toBe(true);
  expect(engine.dispatch("loadProducts").effects).toBeUndefined();
  await host.run(started.effects);
  expect(fetch.mock.calls[0][0].href).toBe("https://example.test/data/products.json");
  const options = fetch.mock.calls[0][1];
  expect(options.method).toBe("GET");
  expect(options.mode).toBe("cors");
  expect(options.headers.get("Authorization")).toBeNull();
  expect(result.state.products).toEqual(products);
  expect(result.state.loading).toBe(false);
  expect(result.state.notice).toBe("8件の商品を取得しました。");
  expect(result.revision).toBe(2);
  const scene = engine.layout(500);
  expect(scene.widgets.some((w) => w.text === "りんご")).toBe(true);
  expect(onError).not.toHaveBeenCalled();
});

it("uses current state on completion and retains rows on errors, allowing retry", () => {
  engine.completeHttp(request().id, success());
  const pending = request();
  engine.dispatch("productsGrid", { action: "sort", column: "price" });
  const failure = engine.completeHttp(pending.id, { ok: false, error: "HTTP 404" });
  expect(failure.state.products).toEqual(products);
  expect(failure.state.loading).toBe(false);
  expect(failure.state.sort).not.toBeNull();
  expect(failure.state.notice).toContain("HTTP 404");
  expect(engine.completeHttp(request().id, success([])).state.products).toEqual([]);
  expect(() => engine.completeHttp(pending.id, success())).toThrow(/Unknown or completed/);
});

it.each(
  [
    {},
    [null],
    [{ id: 1 }],
    [{ id: "1", name: "wrong", price: 1, stock: 1 }],
    [{ id: 1, name: "wrong", price: -1, stock: 1 }],
    [
      { id: 1, name: "duplicate", price: 1, stock: 1 },
      { id: 1, name: "duplicate", price: 1, stock: 1 },
    ],
  ].map((data) => [data]),
)("handles incompatible JSON without losing previously loaded rows: %j", (data) => {
  engine.completeHttp(request().id, success());
  const result = engine.completeHttp(request().id, success(data));
  expect(result.state.loading).toBe(false);
  expect(result.state.products).toEqual(products);
  expect(result.state.notice).not.toContain("取得しました");
});

it("validates request definitions, queues only committed intentions, and guards duplicate requests", () => {
  const bad = structuredClone(screen);
  bad.requests.products.handler = "missing";
  expect(() => engine.load(bad, script)).toThrow(/undefined handler/);
  expect(() =>
    engine.load(
      screen,
      'fn init(s) { http_get("missing"); s } fn loadProducts(s,e) {s} fn productsReceived(s,r) {s}',
    ),
  ).toThrow(/Unknown HTTP/);
  const failing =
    'fn init(s) {s} fn loadProducts(s,e) { http_get("products"); s.products="bad"; s } fn productsReceived(s,r) {s}';
  engine.load(screen, failing);
  expect(() => engine.dispatch("loadProducts")).toThrow(/array/);
  expect(
    engine.dispatch("productsGrid", { action: "sort", column: "price" }).effects,
  ).toBeUndefined();
  const duplicate =
    'fn init(s) {s} fn loadProducts(s,e) { http_get("products"); s } fn productsReceived(s,r) {s}';
  engine.load(screen, duplicate);
  const first = request();
  expect(() => request()).toThrow(/already pending/);
  expect(engine.completeHttp(first.id, success()).revision).toBe(2);
});

it("rolls back invalid completion handlers and consumes the request only once", () => {
  engine.load(
    screen,
    'fn init(s) {s} fn loadProducts(s,e) {http_get("products"); s} fn productsReceived(s,r) {s.products="bad"; s}',
  );
  const pending = request();
  const before = engine.layout(500);
  expect(() => engine.completeHttp(pending.id, success())).toThrow(/array/);
  expect(engine.layout(500)).toEqual(before);
  expect(() => engine.completeHttp(pending.id, success())).toThrow(/Unknown or completed/);
});

it.each([
  [() => new Response("missing", { status: 404 }), "HTTP 404"],
  [() => new Response("not JSON"), "有効なJSON"],
  [() => new Response(JSON.stringify("x".repeat(1_000_001))), "1 MB"],
])("delivers HTTP and JSON failures to the Rhai completion handler", async (response, message) => {
  let result;
  const host = new HttpEffects({
    resources: new ResourceClient({
      baseUrl: "https://example.test/",
      fetch: async () => response(),
    }),
    complete: (id, response) => (result = engine.completeHttp(id, response)),
    onError: (e) => {
      throw e;
    },
  });
  host.reset(new URL("https://example.test/screens/http-grid.json"));
  await host.run([request()]);
  expect(result.state.loading).toBe(false);
  expect(result.state.notice).toContain(message);
});

it("aborts on timeout and discards late responses after screen replacement", async () => {
  let resolve;
  const complete = vi.fn(() => ({ effects: [] }));
  const host = new HttpEffects({
    resources: {
      text: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
    complete,
    onError: vi.fn(),
  });
  host.reset(new URL("https://example.test/screens/http-grid.json"));
  const running = host.run([request()]);
  host.reset(new URL("https://example.test/screens/hello-world.json"));
  resolve(JSON.stringify(products));
  await running;
  expect(complete).not.toHaveBeenCalled();
  const timeout = new HttpEffects({
    resources: {
      text: (_, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("abort"))),
        ),
    },
    complete,
    onError: vi.fn(),
    timeout: 5,
  });
  timeout.reset(new URL("https://example.test/"));
  await timeout.run([{ id: 1, url: "data.json" }]);
  expect(complete.mock.calls[0][1]).toMatchObject({
    ok: false,
    data: null,
    error: "HTTP取得がタイムアウトしました",
  });
});
