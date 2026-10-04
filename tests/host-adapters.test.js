import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { HostEffects } from "../src/host-effects.js";
import { httpAdapter } from "../src/adapters/http.js";
import { ResourceClient } from "../src/resource-client.js";

let wasm, engine;
const source = "https://example.test/screens/home.yaml";
const screen = () => ({
  version: 1,
  id: "host-test",
  title: "Host",
  script: "host.rhai",
  state: { loading: false, calls: 0, result: null, edit: "initial" },
  stateSchema: {
    type: "object",
    properties: { loading: { type: "boolean" }, calls: { type: "integer" } },
  },
  operations: {
    request: {
      connection: "api",
      action: "http.request",
      handler: "received",
      options: { path: "items", method: "GET" },
    },
  },
  ui: {
    xtype: "container",
    items: [
      { xtype: "button", itemId: "start", text: "start", handler: "start" },
      { xtype: "textfield", itemId: "edit", bind: "edit" },
    ],
  },
});
const script =
  'fn init(s){s} fn start(s,e){s.loading=true;host_call("request", #{});s} fn received(s,r){s.loading=false;s.calls+=1;s.result=r;s}';
const ok = (data) => ({ ok: true, data, error: null });
beforeAll(async () => {
  wasm = await WebAssembly.compile(
    await readFile(new URL("../public/engine.wasm", import.meta.url)),
  );
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports);
});

function host(definition, fetch, options = {}) {
  const resources = new ResourceClient({ baseUrl: source, fetch });
  const complete = vi.fn((id, result) => engine.completeHost(id, result));
  const onError = vi.fn();
  const effects = new HostEffects({
    adapters: [httpAdapter({ resources })],
    connections: { api: { adapter: "http", baseUrl: "https://example.test/api/" } },
    complete,
    onError,
    ...options,
  });
  effects.reset(effects.prepare(definition.operations, source));
  return { effects, complete, onError, resources };
}

it("commits host effects only after state, navigation and all effect validation succeed", () => {
  const definition = screen();
  engine.load(definition, script.replace("s.loading=true;", 's.loading="invalid";'));
  const before = engine.layout(500);
  expect(() => engine.dispatch("start")).toThrow(/boolean/);
  expect(engine.layout(500)).toEqual(before);
  expect(engine.dispatch("edit", { value: "kept" }).effects).toBeUndefined();
  engine.load(
    definition,
    script.replace('host_call("request", #{});', 'host_call("request", #{});http_get("missing");'),
  );
  expect(() => engine.dispatch("start")).toThrow(/Unknown HTTP/);
  expect(engine.dispatch("edit", { value: "kept" }).effects).toBeUndefined();
  definition.pages = { next: { url: "next.yaml" } };
  engine.load(
    definition,
    script.replace('host_call("request", #{});', 'host_call("request", #{});navigate("next");'),
  );
  expect(() => engine.dispatch("start")).toThrow(/Navigation cannot/);
});

it("supports host calls in init and completion with latest state and no duplicate completion", async () => {
  const definition = screen();
  const initial = engine.load(
    definition,
    script
      .replace("fn init(s){s}", 'fn init(s){host_call("request", #{});s}')
      .replace("s.calls+=1;", 's.calls+=1;if s.calls<2{host_call("request", #{});}'),
  );
  engine.dispatch("edit", { value: "edited" });
  const fetch = vi.fn(async () => new Response('{"value":1}'));
  const { effects, complete } = host(definition, fetch);
  await effects.run(initial.effects);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(complete.mock.results.at(-1).value.state).toMatchObject({
    calls: 2,
    edit: "edited",
    loading: false,
  });
  expect(() => engine.completeHost(initial.effects[0].id, ok({}))).toThrow(/Unknown or completed/);
  await effects.run(initial.effects);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("rejects unknown DSL attributes, missing handlers and malformed host results", () => {
  const definition = screen();
  definition.operations.request.extra = 1;
  expect(() => engine.load(definition, script)).toThrow(/unknown field/);
  delete definition.operations.request.extra;
  definition.operations.request.handler = "missing";
  expect(() => engine.load(definition, script)).toThrow(/undefined handler/);
  definition.operations.request.handler = "received";
  engine.load(definition, script);
  const effect = engine.dispatch("start").effects[0];
  expect(() => engine.completeHost(effect.id, { ok: false, error: "string" })).toThrow(
    /host error/,
  );
  expect(engine.completeHost(effect.id, ok({})).state.calls).toBe(1);
});

it("consumes a committed external result once even if its Rhai handler rolls back", async () => {
  const definition = screen();
  definition.operations.request.options.method = "POST";
  engine.load(definition, script.replace("s.calls+=1;", 's.calls="bad";'));
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const { effects, complete, onError } = host(definition, fetch);
  const started = engine.dispatch("start");
  const before = engine.layout(500);
  await effects.run(started.effects);
  expect(engine.layout(500)).toEqual(before);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].externalResult).toMatchObject({
    ok: true,
    data: { status: 204 },
  });
  expect(() => engine.completeHost(started.effects[0].id, ok({}))).toThrow(/Unknown or completed/);
  expect(complete).toHaveBeenCalledTimes(1);
});

it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])(
  "sends %s through ResourceClient with JSON body and URL parameter encoding",
  async (method) => {
    const definition = screen();
    definition.operations.request.options = {
      method,
      path: "items/{id}",
      responseHeaders: ["X-Result"],
    };
    const body = ["GET", "HEAD"].includes(method) ? "" : ', body: #{name:"太郎"}';
    engine.load(
      definition,
      script.replace("#{}", `#{path: #{id:"日本 語"}, query: #{q:"a&b"}${body}}`),
    );
    const fetch = vi.fn(async () =>
      method === "HEAD"
        ? new Response(null, { headers: { "X-Result": "yes" } })
        : new Response('{"name":"太郎"}', { headers: { "X-Result": "yes" } }),
    );
    const { effects, complete } = host(definition, fetch);
    await effects.run(engine.dispatch("start").effects);
    const [url, options] = fetch.mock.calls[0];
    expect(url.href).toBe("https://example.test/api/items/%E6%97%A5%E6%9C%AC%20%E8%AA%9E?q=a%26b");
    expect(options.method).toBe(method);
    if (body) {
      expect(JSON.parse(new TextDecoder().decode(options.body))).toEqual({ name: "太郎" });
      expect(options.headers.get("Content-Type")).toBe("application/json");
    }
    expect(complete.mock.calls[0][1]).toMatchObject({
      ok: true,
      data: {
        status: 200,
        headers: { "X-Result": "yes" },
        body: method === "HEAD" ? null : { name: "太郎" },
      },
    });
  },
);

it("does not replay mutations on 401 and preserves a committed update outcome on bad response", async () => {
  const definition = screen();
  definition.operations.request.options.method = "PATCH";
  engine.load(definition, script);
  const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));
  const { effects, resources, complete } = host(definition, fetch);
  resources.setAuthentication({
    mode: "jwt",
    token: "old-token",
    allowedOrigins: ["https://example.test"],
    refresh: { url: "https://example.test/token", token: "refresh-token" },
  });
  await effects.run(engine.dispatch("start").effects);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer old-token");
  expect(complete.mock.calls[0][1].error.code).toBe("HTTP_401");
  fetch.mockImplementation(async () => new Response("not JSON"));
  await effects.run(engine.dispatch("start").effects);
  expect(complete.mock.calls[1][1].error).toMatchObject({
    code: "INVALID_RESPONSE",
    outcome: "committed",
    retryable: false,
  });
});

it("rejects unsafe paths, argument headers and GET bodies before sending anything", async () => {
  for (const args of [
    '#{path: #{id:".."}}',
    '#{path: #{id:"../escape"}}',
    '#{headers: #{Authorization:"secret"}}',
    "#{body: #{value:1}}",
  ]) {
    const definition = screen();
    definition.operations.request.options.path = "items/{id}";
    engine.load(definition, script.replace("#{}", args));
    const fetch = vi.fn();
    const { effects, complete } = host(definition, fetch);
    await effects.run(engine.dispatch("start").effects);
    expect(fetch).not.toHaveBeenCalled();
    expect(complete.mock.calls[0][1]).toMatchObject({
      ok: false,
      error: { outcome: "not-started" },
    });
  }
});

it("validates capabilities without replacing the active operations and blocks forbidden config", () => {
  const definition = screen();
  const { effects } = host(definition, vi.fn());
  for (const options of [
    { path: "../outside" },
    { path: "https://evil.test/" },
    { path: "items", headers: { Authorization: "secret" } },
    { path: "items", response: "bytes" },
    { path: "items", typo: true },
  ]) {
    definition.operations.request.options = options;
    expect(() => effects.prepare(definition.operations, source)).toThrow();
  }
  definition.operations.request.action = "db.query";
  expect(() => effects.prepare(definition.operations, source)).toThrow(/Unsupported/);
});

it("bounds pending calls and discards the entire handler on overflow", () => {
  const definition = screen();
  engine.load(
    definition,
    script.replace('host_call("request", #{});', 'for i in 0..8 {host_call("request", #{});}'),
  );
  expect(engine.dispatch("start").effects).toHaveLength(8);
  expect(() => engine.dispatch("start")).toThrow(/pending host/);
  engine.load(
    definition,
    script.replace('host_call("request", #{});', 'for i in 0..9 {host_call("request", #{});}'),
  );
  expect(() => engine.dispatch("start")).toThrow(/8 host calls/);
  expect(engine.dispatch("edit", { value: "next" }).effects).toBeUndefined();
});

it("times out adapters that ignore abort and discards late responses after reset or dispose", async () => {
  const definition = screen();
  engine.load(definition, script);
  const { effects, complete } = host(definition, () => new Promise(() => {}), { timeout: 5 });
  await effects.run(engine.dispatch("start").effects);
  expect(complete.mock.calls[0][1].error.code).toBe("TIMEOUT");
  effects.dispose();
  for (const dispose of [false, true]) {
    engine.load(definition, script);
    let resolve;
    const fetch = () =>
      new Promise((done) => {
        resolve = done;
      });
    const current = host(definition, fetch);
    const running = current.effects.run(engine.dispatch("start").effects);
    if (dispose) current.effects.dispose();
    else current.effects.reset();
    resolve(new Response("{}"));
    await running;
    expect(current.complete).not.toHaveBeenCalled();
  }
});

it("supports custom registered adapters and serializes delivery while child effects run outside the queue", async () => {
  const definition = screen();
  definition.operations.request = {
    connection: "local",
    action: "db.query",
    handler: "received",
    options: {},
  };
  const initial = engine.load(
    definition,
    script
      .replace("fn init(s){s}", 'fn init(s){host_call("request", #{});s}')
      .replace("s.calls+=1;", 's.calls+=1;if s.calls<2{host_call("request", #{});}'),
  );
  const execute = vi.fn(async () => ({ rows: [{ name: "local" }] }));
  const dispose = vi.fn();
  const complete = vi.fn((id, data) => engine.completeHost(id, data));
  const effects = new HostEffects({
    adapters: [{ name: "database", actions: ["db.query"], validate() {}, execute, dispose }],
    connections: { local: { adapter: "database" } },
    complete,
  });
  effects.reset(effects.prepare(definition.operations, source));
  await effects.run(initial.effects);
  expect(complete.mock.results[1].value.state.result.data.rows).toEqual([{ name: "local" }]);
  expect(execute).toHaveBeenCalledTimes(2);
  effects.dispose();
  effects.dispose();
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it("emits transactional cancellation by name without consuming completion slots", () => {
  const definition = screen();
  definition.operations.other = { ...definition.operations.request };
  const start = 'host_call("request", #{});host_call("request", #{});host_call("other", #{});';
  const cancel = 'host_cancel("request");host_cancel("missing");';
  const code = script.replace('host_call("request", #{});', start);
  engine.load(definition, code);
  const pending = engine.dispatch("start").effects;
  engine.load(definition, code.replace("s.calls+=1;", cancel + "s.calls+=1;"));
  const active = engine.dispatch("start").effects;
  expect(engine.completeHost(active[2].id, ok({})).effects).toEqual([
    { kind: "host_cancel", v: 1, operation: "request" },
  ]);
  expect(engine.completeHost(active[0].id, ok({})).state.calls).toBe(2);
  expect(engine.completeHost(active[1].id, ok({})).effects).toBeUndefined();
  expect(pending.map((effect) => effect.operation)).toEqual(["request", "request", "other"]);
  for (const failure of ['throw "bad";', 's.calls="bad";', 'http_get("missing");']) {
    engine.load(definition, code.replace("s.calls+=1;", cancel + failure + "s.calls+=1;"));
    const effect = engine.dispatch("start").effects[2];
    expect(() => engine.completeHost(effect.id, ok({}))).toThrow();
    expect(engine.dispatch("edit", { value: "kept" }).effects).toBeUndefined();
  }
});

it("validates progress handlers and applies progress transactionally with latest state", () => {
  const definition = screen();
  definition.operations.request.options.progressHandler = "progress";
  for (const invalid of ["missing", 1, null]) {
    definition.operations.request.options.progressHandler = invalid;
    expect(() => engine.load(definition, script)).toThrow(/progress handler/);
  }
  definition.operations.request.options.progressHandler = "progress";
  const code = script + " fn progress(s,p){s.calls+=1;s.result=p;s}";
  engine.load(definition, code);
  const effect = engine.dispatch("start").effects[0];
  engine.dispatch("edit", { value: "latest" });
  const data = { operation: "request", transferred: 2, total: null };
  expect(engine.progressHost(effect.id, data).state).toMatchObject({
    calls: 1,
    edit: "latest",
    result: data,
  });
  expect(engine.progressHost(effect.id, { ...data, transferred: 3, total: 3 }).state.calls).toBe(2);
  for (const bad of [
    null,
    {},
    { ...data, operation: "other" },
    { ...data, transferred: -1 },
    { ...data, transferred: 0.5 },
    { ...data, total: 1 },
    { ...data, total: "3" },
    { ...data, extra: true },
    { operation: "request", transferred: 2, extra: true },
  ]) {
    expect(() => engine.progressHost(effect.id, bad)).toThrow(/progress/);
  }
  expect(engine.completeHost(effect.id, ok({})).state.calls).toBe(3);
  expect(() => engine.progressHost(effect.id, data)).toThrow(/Unknown or completed/);
  for (const failure of ['throw "bad";', 's.calls="bad";', 'http_get("missing");']) {
    engine.load(definition, script + ' fn progress(s,p){host_cancel("request");' + failure + "s}");
    const id = engine.dispatch("start").effects[0].id;
    const before = engine.layout(500);
    expect(() => engine.progressHost(id, data)).toThrow();
    expect(engine.layout(500)).toEqual(before);
    expect(engine.dispatch("edit", { value: "kept" }).effects).toBeUndefined();
    expect(engine.completeHost(id, ok({})).state.calls).toBe(1);
  }
});

function transferHost(execute, options = {}) {
  const complete = vi.fn();
  const progress = vi.fn();
  const onError = vi.fn();
  const effects = new HostEffects({
    adapters: [{ name: "http", actions: ["http.download"], validate() {}, execute }],
    connections: { api: { adapter: "http" } },
    complete,
    progress,
    onError,
    ...options,
  });
  const prepared = effects.prepare(
    {
      receive: {
        connection: "api",
        action: "http.download",
        options: { progressHandler: "progress", timeout: 1 },
      },
      other: { connection: "api", action: "http.download", options: {} },
    },
    source,
  );
  effects.reset(prepared);
  return { effects, complete, progress, onError, prepared };
}
const transferEffect = (id, operation = "receive") => ({
  kind: "host",
  v: 1,
  id,
  operation,
  args: {},
});

it("cancels every matching operation and awaits actual cleanup while other names continue", async () => {
  const pending = [];
  const current = transferHost(
    (operation, args, context) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject, context });
      }),
  );
  const running = current.effects.run([
    transferEffect(1),
    transferEffect(2),
    transferEffect(3, "other"),
  ]);
  await current.effects.run([{ kind: "host_cancel", v: 1, operation: "receive" }]);
  expect(pending.map((p) => p.context.signal.aborted)).toEqual([true, true, false]);
  expect(current.complete).not.toHaveBeenCalled();
  pending[0].reject(Object.assign(new Error("cancelled"), { outcome: "failed" }));
  pending[1].resolve({ files: [] });
  pending[2].resolve({ files: [] });
  await running;
  expect(current.complete).toHaveBeenCalledTimes(3);
  expect(current.complete.mock.calls.find(([id]) => id === 1)[1].error).toMatchObject({
    code: "CANCELLED",
    outcome: "failed",
  });
  expect(current.complete.mock.calls.find(([id]) => id === 2)[1].error).toMatchObject({
    code: "CANCELLED",
    outcome: "committed",
  });
  expect(current.complete.mock.calls.find(([id]) => id === 3)[1].ok).toBe(true);
});

it("uses transfer seconds, throttles progress and cancels queued notifications on termination", async () => {
  vi.useFakeTimers();
  try {
    let context, reject;
    const current = transferHost(
      (op, args, value) => {
        context = value;
        return new Promise((resolve, fail) => {
          reject = fail;
        });
      },
      {
        progress: vi.fn(() => {
          throw new Error("handler");
        }),
      },
    );
    const running = current.effects.run([transferEffect(1)]);
    context.progress({ transferred: 1, total: null });
    await Promise.resolve();
    expect(current.onError).toHaveBeenCalledTimes(1);
    context.progress({ transferred: 2, total: null });
    context.progress({ transferred: 3, total: null });
    await vi.advanceTimersByTimeAsync(99);
    expect(current.onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(current.onError).toHaveBeenCalledTimes(2);
    context.progress({ transferred: 4, total: null });
    await vi.advanceTimersByTimeAsync(900);
    expect(context.signal.aborted).toBe(true);
    reject(Object.assign(new Error("timeout"), { outcome: "failed" }));
    await running;
    expect(current.complete.mock.calls[0][1].error.code).toBe("TIMEOUT");
    const count = current.onError.mock.calls.length;
    context.progress({ transferred: 5, total: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(current.onError).toHaveBeenCalledTimes(count);
  } finally {
    vi.useRealTimers();
  }
});

it("discards old generation progress and completion and preserves committed result validation failures", async () => {
  let context, resolve;
  const current = transferHost((op, args, value) => {
    context = value;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const running = current.effects.run([transferEffect(1)]);
  context.progress({ transferred: 1, total: null });
  current.effects.reset(current.prepared);
  resolve({ files: [] });
  await running;
  expect(current.complete).not.toHaveBeenCalled();
  expect(current.progress).not.toHaveBeenCalled();
  const cyclic = {};
  cyclic.self = cyclic;
  const invalid = transferHost(async () => cyclic);
  await invalid.effects.run([transferEffect(1)]);
  expect(invalid.complete.mock.calls[0][1].error).toMatchObject({
    code: "INVALID_RESULT",
    outcome: "committed",
  });
});

it("cancels reserved progress on reset and isolates reused ids from the old transfer", async () => {
  vi.useFakeTimers();
  const pending = [];
  const current = transferHost(
    (op, args, context) =>
      new Promise((resolve) => {
        pending.push({ context, resolve });
      }),
  );
  try {
    const old = current.effects.run([transferEffect(1)]);
    pending[0].context.progress({ transferred: 1, total: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(current.progress).toHaveBeenCalledTimes(1);
    pending[0].context.progress({ transferred: 2, total: null });
    await vi.advanceTimersByTimeAsync(99);
    expect(current.progress).toHaveBeenCalledTimes(1);
    current.effects.reset(current.prepared);
    expect(pending[0].context.signal.aborted).toBe(true);
    const fresh = current.effects.run([transferEffect(1)]);
    pending[1].context.progress({ transferred: 7, total: 9 });
    await vi.advanceTimersByTimeAsync(1);
    expect(current.progress.mock.calls).toEqual([
      [1, { operation: "receive", transferred: 1, total: null }],
      [1, { operation: "receive", transferred: 7, total: 9 }],
    ]);
    pending[0].context.progress({ transferred: 3, total: null });
    pending[0].resolve({ generation: "old" });
    await old;
    expect(current.complete).not.toHaveBeenCalled();
    expect(pending[1].context.signal.aborted).toBe(false);
    pending[1].resolve({ generation: "new" });
    await fresh;
    expect(current.complete.mock.calls).toEqual([[1, ok({ generation: "new" })]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(current.progress).toHaveBeenCalledTimes(2);
  } finally {
    current.effects.dispose();
    for (const entry of pending) entry.resolve({});
    vi.useRealTimers();
  }
});

it.each([0, 1])("checks the final transfer response UTF-8 limit at boundary +%s", async (extra) => {
  const overhead = new TextEncoder().encode(JSON.stringify(ok({ body: "" }))).length;
  const result = { body: "a".repeat(1_000_000 - overhead + extra) };
  const current = transferHost(async () => result);
  try {
    await current.effects.run([transferEffect(1)]);
    expect(current.complete).toHaveBeenCalledOnce();
    if (extra)
      expect(current.complete.mock.calls[0][1].error).toMatchObject({
        code: "LIMIT",
        outcome: "committed",
      });
    else expect(current.complete.mock.calls[0][1]).toEqual(ok(result));
  } finally {
    current.effects.dispose();
  }
});
