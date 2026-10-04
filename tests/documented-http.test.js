import { expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { HostEffects } from "../src/host-effects.js";
import { ResourceClient } from "../src/resource-client.js";
import { httpAdapter } from "../src/adapters/http.js";

it("executes the documented YAML/Rhai HTTP example with two encoded path placeholders", async () => {
  const document = await readFile(new URL("../docs/http-adapter.md", import.meta.url), "utf8");
  const yaml = document.match(/```yaml\n([\s\S]*?)\n```/)[1];
  const script = document.match(/```rhai\n([\s\S]*?)\n```/)[1];
  const definition = parsePackage(yaml, "yaml");
  const source = new URL("https://example.test/app/screens/orders.yaml");
  const fetch = vi.fn(async () => new Response('{"status":"confirmed"}'));
  const resources = new ResourceClient({ baseUrl: source, fetch });
  const { instance } = await WebAssembly.instantiate(
    await readFile(new URL("../public/engine.wasm", import.meta.url)),
    {},
  );
  const engine = new WasmEngine(instance.exports);
  let completed;
  const effects = new HostEffects({
    adapters: [httpAdapter({ resources })],
    connections: { api: { adapter: "http", baseUrl: "https://example.test/app/api/" } },
    complete: (id, response) => {
      completed = engine.completeHost(id, response);
    },
  });
  effects.reset(effects.prepare(definition.operations, source));
  engine.load(definition, script);
  engine.dispatch("customerId", { value: "日本 語" });
  engine.dispatch("orderId", { value: "O?#%123" });
  const started = engine.dispatch("save");
  expect(started.state.loading).toBe(true);
  await effects.run(started.effects);
  const [url, options] = fetch.mock.calls[0];
  expect(url.href).toBe(
    "https://example.test/app/api/customers/%E6%97%A5%E6%9C%AC%20%E8%AA%9E/orders/O%3F%23%25123?include=summary",
  );
  expect(options.method).toBe("PATCH");
  expect(JSON.parse(new TextDecoder().decode(options.body))).toEqual({ status: "confirmed" });
  expect(completed.state).toMatchObject({ loading: false, notice: "更新しました: HTTP 200" });

  engine.dispatch("orderId", { value: "bad/path" });
  await effects.run(engine.dispatch("save").effects);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(completed.state.loading).toBe(false);
  expect(completed.state.notice).toContain("INVALID_ARGUMENT");
});
