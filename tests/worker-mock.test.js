import { beforeAll, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { MockApiModel } from "../src/mock-api-model.js";
import { createMockApi } from "../src/mock-api-client.js";
import { workerMockAdapter } from "../src/adapters/worker-mock.js";
import { parsePackage, stringifyPackage } from "../src/package-format.js";
import { HostEffects } from "../src/host-effects.js";
import { WasmEngine } from "../src/engine.js";

let source, definition, screen, script, wasm;
beforeAll(async () => {
  source = await readFile(new URL("../public/mock/orders-api.yaml", import.meta.url), "utf8");
  definition = parsePackage(source, "yaml");
  screen = parsePackage(
    await readFile(new URL("../public/screens/worker-orders.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  script = await readFile(new URL("../public/screens/worker-orders.rhai", import.meta.url), "utf8");
  wasm = await WebAssembly.compile(
    await readFile(new URL("../public/engine.wasm", import.meta.url)),
  );
});

// Exercise the message protocol deterministically; actual Worker/bundle loading is checked in Chromium.
class TestWorker extends EventTarget {
  terminated = false;
  paused = false;
  postMessage(data) {
    if (this.paused) return;
    queueMicrotask(() => {
      if (this.terminated) return;
      try {
        let result;
        if (data.operation === "init") {
          this.model = new MockApiModel(data.definition);
          result = true;
        } else
          result =
            data.operation === "reset" ? this.model.reset() : this.model.request(data.request);
        this.dispatchEvent(
          new MessageEvent("message", { data: { id: data.id, ok: true, result } }),
        );
      } catch (error) {
        this.dispatchEvent(
          new MessageEvent("message", { data: { id: data.id, ok: false, error: error.message } }),
        );
      }
    });
  }
  terminate() {
    this.terminated = true;
  }
}
const request = (model, method, path, body) => model.request({ method, path, body });

// The 422 problem+json the shipped `validateOrder` route returns for a rejected order.
const problem = {
  type: "about:blank",
  title: "入力に誤りがあります",
  status: 422,
  detail: "2 件の項目に誤りがあります",
  code: "UB012",
  errors: [
    { field: "customer", code: "required", message: "顧客名を入力してください" },
    { field: "quantity", code: "range", message: "数量は1以上にしてください" },
  ],
};
// `validateOrder` は同梱の定義にあるので、本文を省いた 422 だけを足した変種を使う。
const validating = () => {
  const copy = structuredClone(definition);
  copy.routes.validateEmpty = {
    method: "POST",
    path: "orders/validate-null",
    response: { status: 422, body: null },
  };
  return copy;
};

it("executes fixed responses and CRUD with encoded IDs, conflicts, clone isolation and reset", () => {
  const model = new MockApiModel(definition);
  expect(request(model, "GET", "health").body).toEqual({ ready: true });
  expect(request(model, "GET", "orders").body).toHaveLength(2);
  const body = { id: "日本 語?#%", customer: "A", nested: { x: 1 } };
  const inserted = request(model, "POST", "orders", body);
  expect(inserted.status).toBe(201);
  body.nested.x = 2;
  inserted.body.nested.x = 3;
  const path = `orders/${encodeURIComponent(body.id)}`;
  expect(request(model, "GET", path).body.nested).toEqual({ x: 1 });
  expect(request(model, "POST", "orders", body).status).toBe(409);
  expect(request(model, "PATCH", path, { id: "different" }).status).toBe(409);
  expect(request(model, "PATCH", path, { customer: "B" }).body).toMatchObject({
    id: body.id,
    customer: "B",
    nested: { x: 1 },
  });
  expect(request(model, "DELETE", path)).toMatchObject({ status: 204, body: null });
  expect(request(model, "GET", path).status).toBe(404);
  expect(request(model, "POST", "orders", { customer: "C" }).body.id).toBe("M1");
  expect(request(new MockApiModel(validating()), "POST", "orders/validate")).toEqual({
    status: 422,
    headers: { "content-type": "application/json" },
    body: problem,
  });
  expect(request(model, "POST", "reset").body).toEqual({ reset: true });
  expect(request(model, "GET", "orders").body).toEqual(definition.collections.orders.seed);
});

it("rejects ambiguous or invalid DSL instead of silently ignoring configuration", () => {
  for (const change of [
    (d) => {
      d.unknown = true;
    },
    (d) => {
      d.version = 2;
    },
    (d) => {
      d.collections.orders.seed.push(d.collections.orders.seed[0]);
    },
    (d) => {
      d.routes.extra = {
        method: "GET",
        path: "orders/{other}",
        operation: "get",
        collection: "orders",
      };
    },
    (d) => {
      d.routes.getOrder.path = "orders/{id}/extra/{other}";
    },
    (d) => {
      d.routes.updateOrder.method = "PUT";
    },
    (d) => {
      d.routes.health.response = { status: 204, body: { x: 1 } };
    },
    (d) => {
      d.routes.listOrders.collection = "missing";
    },
    (d) => {
      d.routes.health.response.delay = 10;
    },
    (d) => {
      d.routes.health.path = "../health";
    },
  ]) {
    const invalid = structuredClone(definition);
    change(invalid);
    expect(() => new MockApiModel(invalid)).toThrow(/Mock DSL/);
  }
});

it("returns predictable request failures and enforces body/data/row limits without partial writes", () => {
  const model = new MockApiModel(definition);
  expect(request(model, "PUT", "orders").status).toBe(405);
  expect(request(model, "GET", "missing").status).toBe(404);
  expect(request(model, "GET", "orders/%FF").status).toBe(400);
  expect(request(model, "GET", "orders/%2F").status).toBe(400);
  expect(model.request({ method: "GET", path: "orders", query: { q: "A" } }).status).toBe(400);
  expect(request(model, "POST", "orders", []).status).toBe(400);
  expect(request(model, "POST", "orders", { value: "x".repeat(100_000) }).status).toBe(413);
  for (let i = 0; i < 11; i++) request(model, "POST", "orders", { value: "x".repeat(95_000) });
  expect(request(model, "GET", "orders").body).toHaveLength(12);
  expect(request(model, "PATCH", "orders/O001", { value: "x".repeat(95_000) }).status).toBe(413);
  expect(request(model, "GET", "orders/O001").body).toEqual(definition.collections.orders.seed[0]);
  const full = structuredClone(definition);
  full.collections.orders.seed = Array.from({ length: 1000 }, (_, i) => ({ id: String(i) }));
  expect(request(new MockApiModel(full), "POST", "orders", {}).status).toBe(413);
});

it("serializes Worker messages, isolates instances and rejects pending work on abort/dispose/error", async () => {
  const resources = { text: async () => source };
  const worker = new TestWorker();
  const api = await createMockApi({
    url: "https://example.test/mock.yaml",
    resources,
    workerFactory: () => worker,
  });
  const [a, b, list] = await Promise.all([
    api.request({ method: "POST", path: "orders", body: {} }),
    api.request({ method: "POST", path: "orders", body: {} }),
    api.request({ method: "GET", path: "orders" }),
  ]);
  expect([a.body.id, b.body.id]).toEqual(["M1", "M2"]);
  expect(list.body).toHaveLength(4);
  const other = await createMockApi({
    url: "https://example.test/mock.yaml",
    resources,
    workerFactory: () => new TestWorker(),
  });
  expect((await other.request({ method: "GET", path: "orders" })).body).toHaveLength(2);
  other.dispose();
  await api.reset();
  expect((await api.request({ method: "GET", path: "orders" })).body).toHaveLength(2);
  worker.paused = true;
  const controller = new AbortController();
  const waiting = api.request({ method: "GET", path: "orders" }, controller.signal);
  controller.abort(new Error("cancelled"));
  await expect(waiting).rejects.toThrow("cancelled");
  const pending = api.request({ method: "GET", path: "orders" });
  worker.dispatchEvent(new Event("error"));
  await expect(pending).rejects.toThrow("closed");
  expect(worker.terminated).toBe(true);
  await expect(api.request({ method: "GET", path: "orders" })).rejects.toThrow("closed");
  api.dispose();
});

it("rejects invalid initialization and terminates its Worker", async () => {
  const worker = new TestWorker();
  await expect(
    createMockApi({
      url: "https://example.test/mock.yaml",
      resources: { text: async () => "version: 2\nroutes: {}" },
      workerFactory: () => worker,
    }),
  ).rejects.toThrow(/version/);
  expect(worker.terminated).toBe(true);
});

it("runs the shipped screen through WASM and HostEffects without sending updates over HTTP", async () => {
  const resources = { text: vi.fn(async () => source) };
  const workers = [];
  const adapter = workerMockAdapter({
    resources,
    workerFactory: () => {
      const w = new TestWorker();
      workers.push(w);
      return w;
    },
  });
  const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports);
  let current;
  const onError = vi.fn();
  const host = new HostEffects({
    adapters: [adapter],
    connections: {
      ordersMock: {
        adapter: "worker-mock",
        baseUrl: "https://example.test/api/",
        definition: "../mock/orders-api.yaml",
      },
    },
    complete: (id, r) => {
      current = engine.completeHost(id, r);
      return current;
    },
    onError,
  });
  const prepared = host.prepare(
    screen.operations,
    "https://example.test/screens/worker-orders.yaml",
  );
  host.reset(prepared);
  const loaded = engine.load(screen, script);
  await host.run(loaded.effects);
  await vi.waitFor(() => expect(current.state.loading).toBe(false));
  expect(current.state.orders).toHaveLength(2);
  const edit = (key, value) => {
    current = engine.dispatch(key, { value });
  };
  const click = async (key) => {
    current = engine.dispatch(key);
    await host.run(current.effects);
    await vi.waitFor(() => expect(current.state.loading).toBe(false));
  };
  edit("customer", "　ＡＢＣ商店　");
  edit("orderDate", "2026-10-04");
  edit("price", "0.1");
  edit("quantity", "3");
  await click("createOrder");
  expect(current.state.orders).toHaveLength(3);
  expect(current.state.orders[2]).toMatchObject({
    id: "M1",
    customer: "ABC商店",
    due: "2026-10-18",
    total: "0.3",
  });
  edit("price", "1200");
  await click("updateOrder");
  expect(current.state.orders[2].total).toBe("3960");
  edit("customer", "discard");
  await click("getOrder");
  expect(current.state.customer).toBe("ABC商店");
  expect(() => edit("orderDate", "2026-02-30")).toThrow();
  expect(current.state.date).toBe("2026-10-04");
  expect(current.state.orders[2].date).toBe("2026-10-04");
  await click("deleteOrder");
  expect(current.state.orders).toHaveLength(2);
  await click("getOrder");
  expect(current.state.notice).toContain("HTTP_404");
  // Replacing a screen cancels requests but preserves this host's mock data.
  edit("orderDate", "2026-10-04");
  await click("createOrder");
  host.reset(prepared);
  current = engine.load(screen, script);
  await host.run(current.effects);
  await vi.waitFor(() => expect(current.state.loading).toBe(false));
  expect(current.state.orders).toHaveLength(3);
  await click("resetOrders");
  expect(current.state.orders).toHaveLength(2);
  expect(resources.text).toHaveBeenCalledTimes(1);
  expect(resources.text).toHaveBeenCalledWith("https://example.test/mock/orders-api.yaml");
  expect(workers).toHaveLength(1);
  expect(onError).not.toHaveBeenCalled();
  host.dispose();
  await vi.waitFor(() => expect(workers[0].terminated).toBe(true));
});

// Records every request body the screen sends and can fail one request the way a dropped
// connection does: the client rejects, so the adapter reports NETWORK/unknown.
class RecordingWorker extends TestWorker {
  bodies = [];
  failNext = false;
  postMessage(data) {
    if (data.operation === "request" && data.request.body !== undefined)
      this.bodies.push(data.request.body);
    if (data.operation === "request" && this.failNext) {
      this.failNext = false;
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent("message", { data: { id: data.id, ok: false, error: "boom" } }),
        );
      });
      return;
    }
    super.postMessage(data);
  }
}

// The shipped screen on WASM + HostEffects, shared by the failure-path tests below.
async function runShipped({ randomProvider, workerFactory } = {}) {
  const resources = { text: vi.fn(async () => source) };
  const engine = new WasmEngine(
    (await WebAssembly.instantiate(wasm, {})).exports,
    0,
    randomProvider ? { randomProvider } : {},
  );
  let current;
  const failures = [];
  const host = new HostEffects({
    adapters: [
      workerMockAdapter({ resources, workerFactory: workerFactory ?? (() => new TestWorker()) }),
    ],
    connections: {
      ordersMock: {
        adapter: "worker-mock",
        baseUrl: "https://example.test/api/",
        definition: "../mock/orders-api.yaml",
      },
    },
    complete: (id, r) => {
      if (r.error) failures.push(r.error);
      current = engine.completeHost(id, r);
      return current;
    },
  });
  host.reset(host.prepare(screen.operations, "https://example.test/screens/worker-orders.yaml"));
  current = engine.load(screen, script);
  await host.run(current.effects);
  await vi.waitFor(() => expect(current.state.loading).toBe(false));
  return {
    host,
    failures,
    state: () => current.state,
    edit: (key, value) => {
      current = engine.dispatch(key, { value });
    },
    click: async (key) => {
      current = engine.dispatch(key);
      await host.run(current.effects);
      await vi.waitFor(() => expect(current.state.loading).toBe(false));
    },
  };
}

it("shows the fixed 422 field errors on the shipped order screen", async () => {
  const demo = await runShipped();
  await demo.click("validateOrder");
  expect(demo.state()).toMatchObject({
    customerError: "顧客名を入力してください",
    quantityError: "数量は1以上にしてください",
  });
  expect(demo.state().notice).toContain("HTTP_422");
  expect(demo.state().notice).toContain("入力に誤りがあります");
  expect(demo.failures.at(-1)).toMatchObject({
    code: "HTTP_422",
    outcome: "unknown",
    status: 422,
    body: problem,
  });
  demo.host.dispose();
});

it("keeps the idempotency key while the outcome is unknown and resends the same one", async () => {
  let seed = 0;
  const randomProvider = () => {
    seed += 1;
    return Array.from({ length: 1024 }, () => seed % 256);
  };
  const worker = new RecordingWorker();
  const demo = await runShipped({ randomProvider, workerFactory: () => worker });
  demo.edit("customer", "ABC商店");
  worker.failNext = true;
  await demo.click("createOrder");
  expect(demo.failures.at(-1)).toMatchObject({ code: "NETWORK", outcome: "unknown" });
  const key = demo.state().idempotencyKey;
  expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(demo.state().canResend).toBe(true);
  expect(worker.bodies.at(-1).idempotencyKey).toBe(key);
  await demo.click("resendOrder");
  expect(worker.bodies.at(-1).idempotencyKey).toBe(key);
  expect(demo.state()).toMatchObject({ idempotencyKey: "", canResend: false });
  expect(demo.state().orders).toHaveLength(3);
  // A later order starts a new key, so the resend above really reused the stored one.
  demo.edit("customer", "別商店");
  await demo.click("createOrder");
  expect(worker.bodies.at(-1).idempotencyKey).not.toBe(key);
  expect(demo.state().orders).toHaveLength(4);
  demo.host.dispose();
});

it("shows the message of a 404 body that carries no title", async () => {
  const demo = await runShipped();
  demo.edit("orderId", "missing");
  await demo.click("getOrder");
  expect(demo.state().notice).toContain("HTTP_404");
  expect(demo.state().notice).toContain("Record not found");
  expect(demo.state()).toMatchObject({ idempotencyKey: "", canResend: false });
  expect(demo.failures.at(-1)).toMatchObject({
    code: "HTTP_404",
    status: 404,
    body: { message: "Record not found" },
  });
  demo.host.dispose();
});

it("delivers a fixed 422 problem+json body to the screen when the operation opts in", async () => {
  const resources = { text: vi.fn(async () => stringifyPackage(validating(), "yaml")) };
  const probe = structuredClone(screen);
  // 同梱画面にも `validateOrder` があるので、probe 側は別名で足して衝突を避ける。
  for (const [name, path, handler] of [
    ["probeValidate", "orders/validate", "probeValidated"],
    ["probeEmpty", "orders/validate-null", "probeEmptyDone"],
  ]) {
    probe.operations[name] = {
      connection: "ordersMock",
      action: "http.request",
      handler,
      options: { method: "POST", path, response: "json", errorBody: "json" },
    };
    probe.ui.items.push({ xtype: "button", itemId: name, text: name, handler: name });
  }
  Object.assign(probe.state, { errorStatus: 0, errorTitle: "", errorField: "", bodyError: "" });
  const probeScript = `${script}
fn probeValidate(s, e) { host_call("probeValidate", #{}); s.loading = true; s }
fn probeEmpty(s, e) { host_call("probeEmpty", #{}); s.loading = true; s }
fn probeValidated(s, r) {
    s.loading = false;
    s.errorStatus = r.error.status;
    s.errorTitle = r.error.body.title;
    s.errorField = r.error.body.errors[0].field;
    s
}
fn probeEmptyDone(s, r) { s.loading = false; s.bodyError = r.error.bodyError; s }
`;
  const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports);
  let current;
  const failures = [];
  const host = new HostEffects({
    adapters: [workerMockAdapter({ resources, workerFactory: () => new TestWorker() })],
    connections: {
      ordersMock: {
        adapter: "worker-mock",
        baseUrl: "https://example.test/api/",
        definition: "../mock/orders-api.yaml",
      },
    },
    complete: (id, r) => {
      if (r.error) failures.push(r.error);
      current = engine.completeHost(id, r);
      return current;
    },
  });
  host.reset(host.prepare(probe.operations, "https://example.test/screens/worker-orders.yaml"));
  current = engine.load(probe, probeScript);
  await host.run(current.effects);
  await vi.waitFor(() => expect(current.state.loading).toBe(false));
  const click = async (key) => {
    current = engine.dispatch(key);
    await host.run(current.effects);
    await vi.waitFor(() => expect(current.state.loading).toBe(false));
  };
  await click("probeValidate");
  expect(current.state).toMatchObject({
    errorStatus: 422,
    errorTitle: "入力に誤りがあります",
    errorField: "customer",
  });
  expect(failures.at(-1)).toEqual({
    code: "HTTP_422",
    message: "HTTP 422: リクエストに失敗しました",
    retryable: false,
    outcome: "unknown",
    status: 422,
    body: problem,
  });
  // 固定応答の body: null は "null" として届くのでオブジェクトではなく invalid になる。
  await click("probeEmpty");
  expect(current.state.bodyError).toBe("invalid");
  expect(failures.at(-1)).toMatchObject({ code: "HTTP_422", status: 422, bodyError: "invalid" });
  host.dispose();
});

it("applies the connection clientErrorOutcome to a mock 4xx without touching the mock DSL", async () => {
  const resources = { text: vi.fn(async () => source) };
  const probe = {
    version: 1,
    id: "mock-outcome",
    title: "Mock outcome",
    script: "mock-outcome.rhai",
    state: { result: null },
    operations: {
      get: {
        connection: "ordersMock",
        action: "http.request",
        handler: "received",
        options: { path: "orders/{id}", method: "GET" },
      },
    },
    ui: {
      xtype: "container",
      items: [{ xtype: "button", itemId: "start", text: "start", handler: "start" }],
    },
  };
  const probeScript =
    'fn init(s){s} fn start(s,e){host_call("get", #{path: #{id: "missing"}});s} fn received(s,r){s.result=r;s}';
  // HostEffects.dispose() also disposes its adapters, so each run owns a fresh mock adapter.
  const run = async (connection) => {
    const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports);
    engine.load(probe, probeScript);
    const complete = vi.fn((id, r) => engine.completeHost(id, r));
    const host = new HostEffects({
      adapters: [workerMockAdapter({ resources, workerFactory: () => new TestWorker() })],
      connections: { ordersMock: connection },
      complete,
    });
    host.reset(host.prepare(probe.operations, "https://example.test/screens/probe.yaml"));
    await host.run(engine.dispatch("start").effects);
    host.dispose();
    return complete.mock.calls[0][1].error;
  };
  const base = {
    adapter: "worker-mock",
    baseUrl: "https://example.test/api/",
    definition: "../mock/orders-api.yaml",
  };
  expect(await run({ ...base, clientErrorOutcome: "failed" })).toMatchObject({
    code: "HTTP_404",
    outcome: "failed",
  });
  expect(await run(base)).toMatchObject({ code: "HTTP_404", outcome: "unknown" });
});
