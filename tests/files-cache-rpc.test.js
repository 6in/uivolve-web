import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { create, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { FileClient } from "../src/file-client.js";
import { OpfsDirectory } from "../src/opfs.js";
import { ApplicationLoader, sha256, manifestRevision } from "../src/application-loader.js";
import { ResourceClient, readLimitedBytes } from "../src/resource-client.js";
import { grpcFrame, grpcResponse, RpcClient } from "../src/rpc-client.js";
import { StorageEffects } from "../src/storage-effects.js";
import { createRpcServer } from "../scripts/rpc-server.mjs";
import { descriptorBytes, descriptorSet, registry } from "../scripts/rpc-schema.mjs";
import { memoryOpfs } from "./helpers/opfs.js";

let wasm, engine, fileDemo, fileScript, rpcDemo, rpcScript, server, endpoint;
beforeAll(async () => {
  wasm = await WebAssembly.compile(
    await readFile(new URL("../public/engine.wasm", import.meta.url)),
  );
  fileDemo = parsePackage(
    await readFile(new URL("../public/screens/file-lab.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  fileScript = await readFile(new URL("../public/screens/file-lab.rhai", import.meta.url), "utf8");
  rpcDemo = parsePackage(
    await readFile(new URL("../public/screens/rpc-lab.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  rpcScript = await readFile(new URL("../public/screens/rpc-lab.rhai", import.meta.url), "utf8");
  server = createRpcServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  endpoint = `http://127.0.0.1:${server.address().port}/uivolve.demo.EchoService/Echo`;
});
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, 0);
});
const ok = (data = null) => ({ ok: true, data, error: "" });

it("uses file effects for text and binary, consumes buffers, and preserves state on invalid completions", () => {
  engine.load(fileDemo, fileScript);
  expect(engine.dispatch("mkdir").effects[0]).toMatchObject({
    kind: "file",
    volume: "workspace",
    path: "drafts",
    operation: "mkdir",
  });
  engine.completeFile(1, ok());
  const binary = engine.dispatch("binarySave").effects[0];
  expect(engine.readBuffer(binary.buffer)).toEqual(new Uint8Array([0, 127, 128, 255]));
  engine.completeFile(binary.id, ok());
  expect(() => engine.readBuffer(binary.buffer)).toThrow(/無効/);
  const read = engine.dispatch("binaryRead").effects[0];
  expect(
    engine.completeFile(read.id, ok(new Uint8Array([0, 127, 128, 255]))).state.content,
  ).toContain("0, 127, 128, 255");
  expect(() => engine.completeFile(read.id, ok())).toThrow(/completed/);
});
it("rejects undeclared/read-only/unsafe/conflicting file intents before committing any effects", () => {
  const demo = structuredClone(fileDemo);
  demo.files.workspace.access = "read";
  engine.load(demo, fileScript);
  expect(() => engine.dispatch("save")).toThrow(/read-only/);
  const concurrent = structuredClone(fileDemo);
  concurrent.ui.items[2].items.find((node) => node.itemId === "save").disabledBind = "";
  engine.load(concurrent, fileScript);
  engine.dispatch("mkdir");
  expect(() => engine.dispatch("save")).toThrow(/already pending/);
  for (const path of ["/a", "../a", "a//b", "a/../b", "a\\b", "a\0b"]) {
    expect(() =>
      engine.load(
        fileDemo,
        `fn init(s){file_read_text("workspace",${JSON.stringify(path)});s} fn fileDone(s,r){s}`,
      ),
    ).toThrow();
  }
  const changed = structuredClone(fileDemo);
  changed.ui.items = [];
  expect(() =>
    engine.load(changed, 'fn init(s){file_read_text("missing","a");s} fn fileDone(s,r){s}'),
  ).toThrow(/Unknown file/);
  expect(engine.layout(500).widgets.length).toBeGreaterThan(0);
});
it("separates arbitrary file bytes from JSON and enforces buffer lifetime/capacity across memory growth", () => {
  const id = engine.storeBuffer(new Uint8Array([0, 255, 42]));
  const allocation = engine.exports.input_alloc(2_000_000);
  expect(engine.readBuffer(id)).toEqual(new Uint8Array([0, 255, 42]));
  engine.exports.input_free(allocation, 2_000_000);
  engine.releaseBuffer(id);
  expect(() => engine.readBuffer(id)).toThrow();
  const ids = Array.from({ length: 16 }, () => engine.storeBuffer(new Uint8Array(1_000_000)));
  expect(() => engine.storeBuffer(new Uint8Array(1))).toThrow(/容量/);
  ids.forEach((id) => engine.releaseBuffer(id));
  expect(() => engine.storeBuffer(new Uint8Array(1_000_001))).toThrow(/1 MB/);
});
it("passes larger file bytes to Rhai without JSON arrays and can enqueue them for another write", () => {
  const demo = structuredClone(fileDemo);
  demo.ui.items = [];
  const script =
    'fn init(s){file_read_bytes("workspace","in.bin");s} fn fileDone(s,r){s.content=""+r.data.len(); file_write_bytes("workspace","out.bin",r.data);s}';
  const effect = engine.load(demo, script).effects[0];
  const bytes = new Uint8Array(20000);
  bytes[19999] = 255;
  const result = engine.completeFile(effect.id, ok(bytes));
  expect(result.state.content).toBe("20000");
  expect(engine.readBuffer(result.effects[0].buffer)).toEqual(bytes);
});
it("bounds FileBytes allocations, releases shared values, and keeps binary out of JSON state", () => {
  const demo = structuredClone(fileDemo);
  demo.ui.items = [];
  const load = (body) => engine.load(demo, `fn init(s){${body};s} fn fileDone(s,r){s}`);
  expect(load('let b=file_bytes(20000,255);s.content=""+b.len()+":"+b[19999]').state.content).toBe(
    "20000:255",
  );
  expect(() => load("file_bytes(1000001,0)")).toThrow(/FileBytes/);
  expect(() => load("file_bytes(1,256)")).toThrow(/FileBytes/);
  expect(() => load("let b=file_bytes(1,0);b[1]")).toThrow(/bounds/);
  expect(() => load("let values=[];for i in 0..9 {values.push(file_bytes(1000000,0));}")).toThrow(
    /capacity/,
  );
  expect(() => load("blob(10001,0)")).toThrow();
  expect(() => load("s.content=file_bytes(1,0)")).toThrow();
  expect(load('let b=file_bytes(1000000,0);s.content="released"').state.content).toBe("released");
});
it("reads/writes UTF-8 and bytes, lists and stats actual paths while keeping page/cache namespaces apart", async () => {
  const fs = memoryOpfs(),
    client = new FileClient({ storage: fs.storage, locks: null, engine });
  const effect = { volume: "workspace", path: "下書き", operation: "mkdir" };
  await client.execute("file-lab", effect);
  await client.execute("file-lab", {
    ...effect,
    path: "下書き/画面.yaml",
    operation: "write_text",
    data: "title: 日本語\n",
  });
  expect(
    await client.execute("file-lab", {
      ...effect,
      path: "下書き/画面.yaml",
      operation: "read_text",
    }),
  ).toBe("title: 日本語\n");
  expect(await client.execute("file-lab", { ...effect, operation: "list" })).toEqual([
    { name: "画面.yaml", kind: "file" },
  ]);
  expect(
    await client.execute("file-lab", { ...effect, path: "下書き/画面.yaml", operation: "stat" }),
  ).toMatchObject({
    exists: true,
    kind: "file",
    size: new TextEncoder().encode("title: 日本語\n").length,
  });
  expect(await client.execute("file-lab", { ...effect, path: "none", operation: "stat" })).toEqual({
    exists: false,
  });
  await expect(
    client.execute("other", { ...effect, path: "下書き/画面.yaml", operation: "read_text" }),
  ).rejects.toMatchObject({ name: "NotFoundError" });
  await expect(
    client.execute("file-lab", {
      ...effect,
      path: "../cache/current.json",
      operation: "read_text",
    }),
  ).rejects.toThrow(/相対/);
  const id = engine.storeBuffer(new Uint8Array([0, 127, 255]));
  await client.execute("file-lab", {
    ...effect,
    path: "下書き/a.bin",
    operation: "write_bytes",
    buffer: id,
  });
  expect(
    await client.execute("file-lab", { ...effect, path: "下書き/a.bin", operation: "read_bytes" }),
  ).toEqual(new Uint8Array([0, 127, 255]));
  engine.releaseBuffer(id);
  await expect(
    client.execute("file-lab", { ...effect, operation: "remove" }),
  ).rejects.toMatchObject({ name: "InvalidModificationError" });
  await client.execute("file-lab", { ...effect, path: "下書き/画面.yaml", operation: "remove" });
});
it("waits for file close, keeps late writers locked and reports quota/unsupported/invalid UTF-8 failures", async () => {
  const fs = memoryOpfs(),
    client = new FileClient({ storage: fs.storage, locks: null });
  let done;
  fs.controls.beforeClose = () =>
    new Promise((resolve) => {
      done = resolve;
    });
  const effect = { volume: "work", path: "x", operation: "write_text", data: "x" };
  const completed = vi.fn(),
    controller = new AbortController();
  const pending = client.execute("page", effect, { signal: controller.signal }).then(completed);
  await vi.waitFor(() => expect(done).toBeTypeOf("function"));
  expect(completed).not.toHaveBeenCalled();
  controller.abort();
  await expect(client.execute("page", effect)).rejects.toThrow(/前のファイル/);
  done();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  fs.controls.beforeClose = async () => {
    throw new DOMException("quota", "QuotaExceededError");
  };
  await expect(client.execute("page", effect)).rejects.toMatchObject({
    name: "QuotaExceededError",
  });
  await expect(new FileClient({ storage: null }).execute("page", effect)).rejects.toThrow(/OPFS/);
  fs.controls.beforeClose = async () => {};
  const directory = new OpfsDirectory(["uivolve-web", "fs", "page", "work"], {
    storage: fs.storage,
  });
  await directory.write("bad", new Uint8Array([255]));
  await expect(
    client.execute("page", { ...effect, path: "bad", operation: "read_text" }),
  ).rejects.toThrow();
});

async function cacheFixture() {
  const fs = memoryOpfs(),
    url = new URL("https://demo.test/screens/file-lab.yaml"),
    responses = new Map();
  const source = new TextEncoder().encode(
    await readFile(new URL("../public/screens/file-lab.yaml", import.meta.url), "utf8"),
  );
  const script = new TextEncoder().encode(fileScript);
  const metadata = {
    version: 1,
    revision: "a".repeat(64),
    source: { url: "versions/a/source", sha256: await sha256(source), size: source.length },
    script: { url: "versions/a/script", sha256: await sha256(script), size: script.length },
  };
  metadata.revision = await manifestRevision(metadata);
  responses.set(url.href + ".manifest.json", JSON.stringify(metadata));
  responses.set(new URL(metadata.source.url, url).href, source);
  responses.set(new URL(metadata.script.url, url).href, script);
  const fetcher = vi.fn(async (u) => {
    const value = responses.get(String(u));
    if (value instanceof Error) throw value;
    if (value === undefined) return new Response("missing", { status: 404 });
    if (value instanceof Response) return value.clone();
    return new Response(value);
  });
  const resources = new ResourceClient({ baseUrl: url, fetch: fetcher });
  const loader = new ApplicationLoader({ resources, storage: fs.storage, locks: null });
  return { fs, url, source, script, metadata, responses, resources, loader, fetcher };
}
it("restores verified YAML/Rhai together only on network failure, with original URL and source", async () => {
  const f = await cacheFixture();
  const candidate = await f.loader.fetch(f.url, { mode: "network-first" });
  engine.load(candidate.screen, candidate.script);
  await f.loader.save(candidate);
  f.responses.set(f.url.href + ".manifest.json", new TypeError("offline"));
  const restored = await f.loader.fetch(f.url, { mode: "network-first" });
  expect(restored.status).toBe("cache");
  expect(restored.url.href).toBe(f.url.href);
  expect(restored.source).toBe(candidate.source);
  expect(restored.script).toBe(fileScript);
  engine.load(restored.screen, restored.script);
  await f.loader.clear(f.url);
  await expect(f.loader.fetch(f.url, { mode: "network-first" })).rejects.toThrow(
    /保存版もありません/,
  );
});
it.each([401, 403, 404, 500])("does not fall back to cache for HTTP %i", async (status) => {
  const f = await cacheFixture();
  await f.loader.save(await f.loader.fetch(f.url, { mode: "network-first" }));
  f.responses.set(f.url.href + ".manifest.json", new Response("denied", { status }));
  await expect(f.loader.fetch(f.url, { mode: "network-first" })).rejects.toThrow(`HTTP ${status}`);
});
async function nextGeneration(first, suffix) {
  const scriptBytes = new TextEncoder().encode(first.script + suffix);
  const metadata = {
    ...first.metadata,
    script: {
      ...first.metadata.script,
      sha256: await sha256(scriptBytes),
      size: scriptBytes.length,
    },
  };
  metadata.revision = await manifestRevision(metadata);
  return { ...first, scriptBytes, metadata };
}
it("rejects corrupted/mixed packages and authenticated caching; preserves a previous complete generation", async () => {
  const f = await cacheFixture();
  const first = await f.loader.fetch(f.url, { mode: "network-first" });
  await f.loader.save(first);
  f.responses.set(
    new URL(f.metadata.script.url, f.url).href,
    new TextEncoder().encode("wrong script"),
  );
  await expect(f.loader.fetch(f.url, { mode: "network-first" })).rejects.toThrow(/ハッシュ/);
  const second = await nextGeneration(first, "\n// generation two\n");
  await f.loader.save(second);
  const key = await sha256(new TextEncoder().encode(f.url.href));
  const directory = new OpfsDirectory(["uivolve-web", "cache", key], { storage: f.fs.storage });
  await directory.write(
    `versions/${second.metadata.revision}/script`,
    new TextEncoder().encode("bad"),
  );
  expect((await f.loader.restore(f.url)).metadata.revision).toBe(first.metadata.revision);
  f.resources.setAuthentication({ mode: "jwt", token: "example", allowedOrigins: [f.url.origin] });
  await expect(f.loader.fetch(f.url, { mode: "network-first" })).rejects.toThrow(/認証なし/);
  await expect(f.loader.save(first)).rejects.toThrow(/認証付き/);
});
it("does not publish a partially saved cache or overwrite active UI on quota failure", async () => {
  const f = await cacheFixture();
  const first = await f.loader.fetch(f.url, { mode: "network-first" });
  await f.loader.save(first);
  let count = 0;
  f.fs.controls.beforeClose = async () => {
    if (++count === 2) throw new DOMException("quota", "QuotaExceededError");
  };
  await expect(
    f.loader.save(await nextGeneration(first, "\n// generation three\n")),
  ).rejects.toMatchObject({ name: "QuotaExceededError" });
  expect((await f.loader.restore(f.url)).metadata.revision).toBe(first.metadata.revision);
});
it("keeps only the current and previous complete cache generations", async () => {
  const f = await cacheFixture();
  const first = await f.loader.fetch(f.url, { mode: "network-first" });
  const second = await nextGeneration(first, "\n// two\n");
  const third = await nextGeneration(first, "\n// three\n");
  for (const candidate of [first, second, third]) await f.loader.save(candidate);
  const key = await sha256(new TextEncoder().encode(f.url.href));
  const directory = new OpfsDirectory(["uivolve-web", "cache", key], { storage: f.fs.storage });
  expect((await directory.list("versions")).map((entry) => entry.name).sort()).toEqual(
    [second.metadata.revision, third.metadata.revision].sort(),
  );
  expect((await f.loader.restore(f.url)).metadata.revision).toBe(third.metadata.revision);
});
it("restores multiple Descriptors even when the same revision is published in a different key order", async () => {
  const f = await cacheFixture();
  const screen = structuredClone(rpcDemo);
  screen.rpc.grpcEcho.descriptor = "second.pb";
  const other = structuredClone(descriptorSet);
  other.file[0].name = "second.proto";
  const descriptors = {
    "second.pb": toBinary(FileDescriptorSetSchema, other),
    "rpc-demo.pb": descriptorBytes,
  };
  const sourceBytes = new TextEncoder().encode(JSON.stringify(screen));
  const scriptBytes = new TextEncoder().encode(rpcScript);
  const metadata = {
    ...f.metadata,
    source: { ...f.metadata.source, size: sourceBytes.length, sha256: await sha256(sourceBytes) },
    script: { ...f.metadata.script, size: scriptBytes.length, sha256: await sha256(scriptBytes) },
    descriptors: {},
  };
  for (const [key, bytes] of Object.entries(descriptors))
    metadata.descriptors[key] = { url: key, size: bytes.length, sha256: await sha256(bytes) };
  metadata.revision = await manifestRevision(metadata);
  const candidate = {
    status: "network",
    url: f.url,
    sourceBytes,
    scriptBytes,
    metadata,
    descriptors,
  };
  engine.load(screen, rpcScript, descriptors);
  await f.loader.save(candidate);
  await f.loader.save({
    ...candidate,
    metadata: {
      ...metadata,
      descriptors: Object.fromEntries(Object.entries(metadata.descriptors).reverse()),
    },
    descriptors: Object.fromEntries(Object.entries(descriptors).reverse()),
  });
  const restored = await f.loader.restore(f.url);
  expect(restored.descriptors).toEqual(descriptors);
  engine.load(restored.screen, restored.script, restored.descriptors);
});
it("bounds unknown-length response streams and cancels when the limit is exceeded", async () => {
  const cancelled = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(6));
      },
      cancel: cancelled,
    }),
  );
  await expect(readLimitedBytes(response, { limit: 5 })).rejects.toThrow(/サイズ上限/);
  expect(cancelled).toHaveBeenCalled();
});

for (const protocol of ["connect", "grpc-web"]) {
  it(`exchanges real ${protocol} Protobuf with the official server and preserves int64/bytes`, async () => {
    const demo = structuredClone(rpcDemo);
    for (const r of Object.values(demo.rpc)) r.url = endpoint;
    engine.load(demo, rpcScript, { "rpc-demo.pb": descriptorBytes });
    const effect = engine.dispatch(protocol === "connect" ? "connect" : "grpc").effects[0];
    const resources = new ResourceClient({ baseUrl: endpoint });
    const client = new RpcClient({ resources, engine });
    const result = engine.completeRpc(effect.id, ok(await client.execute(endpoint, effect)));
    expect(result.state.message).toBe("Hello 太郎");
    expect(result.state.details).toContain("9007199254740993");
    expect(result.state.details).toContain("AH+A/w==");
    expect(() => engine.readBuffer(effect.buffer)).toThrow();
    engine.dispatch("rpcName", { value: "error" });
    const failure = engine.dispatch(protocol === "connect" ? "connect" : "grpc").effects[0];
    await expect(client.execute(endpoint, failure)).rejects.toThrow(
      protocol === "connect" ? /invalid_argument/ : /gRPC 3/,
    );
    expect(
      engine.completeRpc(failure.id, { ok: false, error: "remote error" }).state.message,
    ).toContain("remote error");
  });
}
it("checks downloaded descriptors, method/cardinality and request types without replacing current UI", () => {
  engine.load(fileDemo, fileScript);
  expect(() => engine.load(rpcDemo, rpcScript)).toThrow(/Descriptor/);
  expect(() => engine.load(rpcDemo, rpcScript, { "rpc-demo.pb": new Uint8Array([255]) })).toThrow(
    /Descriptor/,
  );
  expect(engine.layout(500).widgets.some((w) => w.key === "mkdir")).toBe(true);
  engine.load(rpcDemo, rpcScript, { "rpc-demo.pb": descriptorBytes });
  const demo = structuredClone(rpcDemo);
  demo.rpc.connectEcho.method = "Missing";
  expect(() => engine.load(demo, rpcScript, { "rpc-demo.pb": descriptorBytes })).toThrow(
    /Unknown RPC method/,
  );
  const invalid = 'fn init(s){rpc_call("connectEcho",#{name:123});s} fn echoDone(s,r){s}';
  for (const flag of ["clientStreaming", "serverStreaming"]) {
    const streaming = structuredClone(descriptorSet);
    streaming.file[0].service[0].method[0][flag] = true;
    expect(() =>
      engine.load(rpcDemo, rpcScript, {
        "rpc-demo.pb": toBinary(FileDescriptorSetSchema, streaming),
      }),
    ).toThrow(/Unary/);
  }
  const simple = structuredClone(rpcDemo);
  simple.ui.items = [];
  expect(() => engine.load(simple, invalid, { "rpc-demo.pb": descriptorBytes })).toThrow(
    /RPC connectEcho/,
  );
});
it("consumes failed typed RPC callbacks, rejects malformed binary replies and leaves previous state intact", () => {
  const demo = structuredClone(rpcDemo);
  demo.ui.items = [];
  const script =
    'fn init(s){rpc_call("connectEcho",#{name:"x"});s} fn echoDone(s,r){throw "failed callback";s}';
  const effect = engine.load(demo, script, { "rpc-demo.pb": descriptorBytes }).effects[0];
  const schema = registry.getMessage("uivolve.demo.EchoResponse");
  const bytes = toBinary(schema, create(schema, { name: "hello" }));
  const before = engine.layout(500);
  expect(() => engine.completeRpc(effect.id, ok(bytes))).toThrow(/failed callback/);
  expect(() => engine.completeRpc(effect.id, ok(bytes))).toThrow(/completed/);
  expect(engine.layout(500)).toEqual(before);
  const malformed = engine.load(demo, script, { "rpc-demo.pb": descriptorBytes }).effects[0];
  expect(() => engine.completeRpc(malformed.id, ok(new Uint8Array([255])))).toThrow(/RPC response/);
});
it("handles trailer errors even under HTTP 200 and rejects missing status/compression/truncated or multiple messages", () => {
  const headers = new Headers();
  const trailer = grpcFrame(
    new TextEncoder().encode("grpc-status: 7\r\ngrpc-message: denied\r\n"),
    128,
  );
  expect(() => grpcResponse(trailer, headers)).toThrow(/gRPC 7/);
  for (const bytes of [
    grpcFrame(new Uint8Array([1])),
    new Uint8Array([0, 0, 0, 0, 8, 1]),
    grpcFrame(new Uint8Array(), 1),
    new Uint8Array([0, 0]),
  ])
    expect(() => grpcResponse(bytes, headers)).toThrow();
  const success = new Headers({ "grpc-status": "0" });
  const pair = new Uint8Array([...grpcFrame(new Uint8Array()), ...grpcFrame(new Uint8Array())]);
  expect(() => grpcResponse(pair, success)).toThrow(/ストリーミング/);
});
it("defaults POST to no authentication replay but permits explicitly idempotent RPC refresh", async () => {
  for (const retryAuthentication of [false, true]) {
    let attempts = 0,
      refreshes = 0;
    const resources = new ResourceClient({
      baseUrl: "https://rpc.test/",
      fetch: async (url, options) => {
        if (String(url).includes("refresh")) {
          refreshes++;
          return new Response(JSON.stringify({ accessToken: "new", expiresIn: 60 }));
        }
        expect(options.method).toBe("POST");
        expect(options.mode).toBe("cors");
        attempts++;
        return new Response("", { status: attempts === 1 ? 401 : 200 });
      },
    });
    resources.setAuthentication({
      mode: "jwt",
      token: "old",
      allowedOrigins: ["https://rpc.test"],
      refresh: { url: "https://rpc.test/refresh", token: "refresh", format: "json" },
    });
    const response = await resources.fetch("https://rpc.test/call", {
      method: "POST",
      body: new Uint8Array([1]),
      retryAuthentication,
      allowHttpErrors: true,
    });
    expect(response.status).toBe(retryAuthentication ? 200 : 401);
    expect(attempts).toBe(retryAuthentication ? 2 : 1);
    expect(refreshes).toBe(retryAuthentication ? 1 : 0);
  }
});
it("times out RPC and ignores late responses from an old screen", async () => {
  const completed = vi.fn(() => ({}));
  const host = new StorageEffects({
    label: "RPC",
    timeout: 5,
    client: { execute: () => new Promise(() => {}) },
    complete: completed,
    onError: vi.fn(),
  });
  host.reset("old");
  await host.run([{ id: 1 }]);
  expect(completed.mock.calls[0][1].error).toContain("RPCがタイムアウト");
  completed.mockClear();
  const pending = host.run([{ id: 2 }]);
  host.reset("new");
  await pending;
  expect(completed).not.toHaveBeenCalled();
});
it("cancels a real slow RPC when switching screens and releases the outgoing binary buffer", async () => {
  const demo = structuredClone(rpcDemo);
  for (const r of Object.values(demo.rpc)) r.url = endpoint;
  engine.load(demo, rpcScript, { "rpc-demo.pb": descriptorBytes });
  engine.dispatch("rpcName", { value: "slow" });
  const effect = engine.dispatch("connect").effects[0];
  const complete = vi.fn((id, response) => engine.completeRpc(id, response));
  const host = new StorageEffects({
    label: "RPC",
    client: new RpcClient({ resources: new ResourceClient({ baseUrl: endpoint }), engine }),
    complete,
    onError: vi.fn(),
  });
  host.reset(endpoint);
  const pending = host.run([effect]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  engine.load(fileDemo, fileScript);
  host.reset(endpoint);
  await pending;
  expect(complete).not.toHaveBeenCalled();
  expect(() => engine.readBuffer(effect.buffer)).toThrow();
  expect(engine.layout(500).widgets.some((w) => w.key === "mkdir")).toBe(true);
});
