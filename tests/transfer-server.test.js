import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { transferFixture } from "../scripts/transfer-server.mjs";
import { generateLargeFile } from "../examples/opfs-file-transfer/large-file.js";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { HostEffects } from "../src/host-effects.js";
import { ResourceClient } from "../src/resource-client.js";
import { FileClient } from "../src/file-client.js";
import { httpAdapter } from "../src/adapters/http.js";
import { memoryOpfs } from "./helpers/opfs.js";

let child;
let base;
beforeAll(async () => {
  child = spawn("bun", ["scripts/transfer-server.mjs", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Transfer server did not start")), 5000);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!output.includes("\n")) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(output.split("\n")[0]).url);
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited: ${code}`));
    });
  });
});
afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

it("serves CSV, chunked capacity fixtures, zero bytes and CORS", async () => {
  expect(await (await fetch(`${base}csv`)).text()).toContain("apple,2");
  for (const length of ["yes", "no"]) {
    const response = await fetch(`${base}download?size=65537&length=${length}`);
    expect(response.headers.get("content-length")).toBe(length === "yes" ? "65537" : null);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(65537).fill(97));
  }
  expect((await (await fetch(`${base}download?size=0`)).arrayBuffer()).byteLength).toBe(0);
  const cors = await fetch(`${base}upload`, { method: "OPTIONS" });
  expect(cors.status).toBe(204);
  expect(cors.headers.get("access-control-allow-headers")).toContain("Authorization");
});

it("hashes POST/PUT bodies and preserves multipart order, duplicate names and file metadata", async () => {
  const bytes = new TextEncoder().encode("日本語\0bytes");
  for (const method of ["POST", "PUT"]) {
    expect(await (await fetch(`${base}upload`, { method, body: bytes })).json()).toEqual({
      method,
      size: bytes.length,
      sha256: hash(bytes),
    });
    const body = new FormData();
    body.append("tag", "first");
    body.append("file", new Blob([bytes], { type: "text/csv" }), "日本語.csv");
    body.append("tag", "");
    body.append("file", new Blob([]), "empty.bin");
    expect(await (await fetch(`${base}multipart`, { method, body })).json()).toEqual({
      method,
      entries: [
        { name: "tag", value: "first" },
        {
          name: "file",
          filename: "日本語.csv",
          type: "text/csv",
          size: bytes.length,
          sha256: hash(bytes),
        },
        { name: "tag", value: "" },
        {
          name: "file",
          filename: "empty.bin",
          type: "application/octet-stream",
          size: 0,
          sha256: hash(""),
        },
      ],
    });
  }
});

it("accepts 100 MiB bodies beyond Bun's default body limit", async () => {
  const chunk = new Uint8Array(65536).fill(97);
  let remaining = 1600;
  const expected = createHash("sha256");
  for (let i = 0; i < 1600; i++) expected.update(chunk);
  const body = new ReadableStream({
    pull(controller) {
      if (remaining-- > 0) controller.enqueue(chunk);
      else controller.close();
    },
  });
  expect(
    await (await fetch(`${base}upload`, { method: "PUT", body, duplex: "half" })).json(),
  ).toEqual({
    method: "PUT",
    size: 104857600,
    sha256: expected.digest("hex"),
  });
}, 30000);

it("provides delay, authentication, non-2xx and invalid response fixtures", async () => {
  const started = performance.now();
  await fetch(`${base}csv?delay=40`);
  expect(performance.now() - started).toBeGreaterThanOrEqual(35);
  const streamStarted = performance.now();
  await (await fetch(`${base}download?size=65537&chunkDelay=25`)).arrayBuffer();
  expect(performance.now() - streamStarted).toBeGreaterThanOrEqual(45);
  expect((await fetch(`${base}auth`)).status).toBe(401);
  expect(
    await (
      await fetch(`${base}auth`, { headers: { Authorization: "Bearer transfer-fixture" } })
    ).json(),
  ).toEqual({ authenticated: true });
  expect((await fetch(`${base}status?code=403`)).status).toBe(403);
  expect((await fetch(`${base}status`)).status).toBe(503);
  await expect((await fetch(`${base}invalid-json`)).json()).rejects.toThrow();
  const invalid = await (await fetch(`${base}invalid-utf8`)).arrayBuffer();
  expect(() => new TextDecoder("utf-8", { fatal: true }).decode(invalid)).toThrow();
  expect((await fetch(`${base}download?size=9999999999`)).status).toBe(400);
});

it("generates the large OPFS file in chunks and closes before reporting completion", async () => {
  let written = 0;
  let calls = 0;
  let closed = false;
  const writer = {
    async write(chunk) {
      expect(chunk.length).toBe(65536);
      written += chunk.length;
      calls++;
    },
    async close() {
      closed = true;
    },
    async abort() {
      throw new Error("Unexpected abort");
    },
  };
  const handle = {
    getDirectoryHandle: async () => handle,
    getFileHandle: async () => ({ createWritable: async () => writer }),
  };
  expect(await generateLargeFile({ storage: { getDirectory: async () => handle } })).toBe(
    104857600,
  );
  expect({ written, calls, closed }).toEqual({ written: 104857600, calls: 1600, closed: true });
});

it("executes the shared sample's download, CSV edit and ordered multipart using real WASM", async () => {
  const dir = new URL("../examples/opfs-file-transfer/", import.meta.url);
  const definition = parsePackage(await readFile(new URL("home.yaml", dir), "utf8"), "yaml");
  const script = await readFile(new URL("home.rhai", dir), "utf8");
  const wasm = await readFile(new URL("../public/engine.wasm", import.meta.url));
  const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).instance.exports);
  const { storage } = memoryOpfs();
  const files = new FileClient({ engine, storage });
  const resources = new ResourceClient({
    baseUrl: "http://localhost/",
    fetch: (url, options) => transferFixture(new Request(url, options)),
  });
  const queue = [];
  let completed;
  const effects = new HostEffects({
    adapters: [httpAdapter({ resources, files })],
    connections: { api: { adapter: "http", baseUrl: "http://localhost/api/" } },
    complete(id, result) {
      completed = engine.completeHost(id, result);
      queue.push(...completed.effects);
    },
    progress: (id, result) => engine.progressHost(id, result),
  });
  effects.reset(
    effects.prepare(definition.operations, "http://localhost/", {
      scope: definition.id,
      files: definition.files,
    }),
  );
  engine.load(definition, script);
  queue.push(...engine.dispatch("csv").effects);
  while (queue.length) {
    const effect = queue.shift();
    if (effect.kind === "host") await effects.run([effect]);
    else if (effect.kind === "file") {
      const data = await files.execute(definition.id, effect);
      completed = engine.completeFile(effect.id, { ok: true, data });
      queue.push(...completed.effects);
    } else throw new Error(`Unexpected effect ${effect.kind}`);
  }
  expect(completed.state.busy).toBe(false);
  expect(completed.state.notice).toContain("完了: HTTP 200");
  const ref = files.transferFile(definition.id, definition.files, "workspace", "processed.csv");
  expect(await (await ref.file()).text()).toContain("apple,4");
  effects.dispose();
});
