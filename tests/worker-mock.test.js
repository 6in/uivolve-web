import { beforeAll, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { MockApiModel } from "../src/mock-api-model.js";
import { createMockApi } from "../src/mock-api-client.js";
import { workerMockAdapter } from "../src/adapters/worker-mock.js";
import { parsePackage } from "../src/package-format.js";
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
