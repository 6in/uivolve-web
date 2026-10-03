import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { ResourceClient } from "../src/resource-client.js";
import { RpcClient } from "../src/rpc-client.js";
import { createRpcServer } from "./rpc-server.mjs";
import { descriptorBytes } from "./rpc-schema.mjs";

const bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
const module = await WebAssembly.compile(bytes);
const demo = parsePackage(
  await readFile(new URL("../public/screens/rpc-lab.yaml", import.meta.url), "utf8"),
  "yaml",
);
const script = await readFile(new URL("../public/screens/rpc-lab.rhai", import.meta.url), "utf8");
const server = createRpcServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const url = `http://127.0.0.1:${server.address().port}/uivolve.demo.EchoService/Echo`;
const average = (values) =>
  Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(3));
try {
  for (const protocol of ["connect", "grpc-web"]) {
    const engine = new WasmEngine(
      (await WebAssembly.instantiate(module, {})).exports,
      bytes.length,
    );
    for (const request of Object.values(demo.rpc)) request.url = url;
    engine.load(demo, script, { "rpc-demo.pb": descriptorBytes });
    let protoBytes, wireResponseBytes;
    const copies = [];
    const resources = new ResourceClient({ baseUrl: url });
    const receive = resources.binaryRequest.bind(resources);
    resources.binaryRequest = async (...args) => {
      const result = await receive(...args);
      wireResponseBytes = result.bytes.length;
      return result;
    };
    const client = new RpcClient({
      resources,
      engine: {
        readBuffer(id) {
          const t = performance.now();
          const data = engine.readBuffer(id);
          copies.push(performance.now() - t);
          protoBytes = data.length;
          return data;
        },
      },
    });
    const encode = [],
      network = [],
      decode = [];
    for (let i = 0; i < 55; i++) {
      let t = performance.now();
      const effect = engine.dispatch(protocol === "connect" ? "connect" : "grpc").effects[0];
      const prepared = performance.now() - t;
      t = performance.now();
      const data = await client.execute(url, effect);
      const elapsed = performance.now() - t;
      t = performance.now();
      engine.completeRpc(effect.id, { ok: true, data, error: "" });
      const completed = performance.now() - t;
      if (i >= 5) {
        encode.push(prepared);
        network.push(elapsed);
        decode.push(completed);
      }
    }
    console.log(
      JSON.stringify(
        {
          protocol,
          samples: 50,
          wasmBytes: bytes.length,
          requestJsonBytes: new TextEncoder().encode(
            JSON.stringify({ name: "太郎", sequenceId: "9007199254740993", payload: "AH+A/w==" }),
          ).length,
          requestProtoBytes: protoBytes,
          requestBodyBytes: protoBytes + (protocol === "grpc-web" ? 5 : 0),
          responseBodyBytes: wireResponseBytes,
          dispatchEncodeMs: average(encode),
          copyMs: average(copies.slice(5)),
          transportMs: average(network),
          completeDecodeMs: average(decode),
        },
        null,
        2,
      ),
    );
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
