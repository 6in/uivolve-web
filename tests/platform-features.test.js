import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage, packageFormat, stringifyPackage } from "../src/package-format.js";
import { readPageRoute, pageUrl } from "../src/page-router.js";
import { StorageEffects } from "../src/storage-effects.js";
import { StorageClient } from "../src/storage-client.js";
import { createUiTools } from "../src/webmcp.js";

let wasm, bytes, demo, script, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  demo = parsePackage(
    await readFile(new URL("../public/screens/storage-lab.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  script = await readFile(new URL("../public/screens/storage-lab.rhai", import.meta.url), "utf8");
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
});
const success = (data = null) => ({ ok: true, data, error: "" });
const small = (schema, value) => ({
  version: 1,
  id: "typed",
  title: "Typed",
  script: "typed.rhai",
  state: { value },
  stateSchema: {
    type: "object",
    properties: { value: schema },
    required: ["value"],
    additionalProperties: false,
  },
  ui: {
    xtype: "container",
    items: [{ xtype: "button", itemId: "change", handler: "change", text: "Change" }],
  },
});

it("shares YAML/JSON parsing and round trips without changing string/boolean/null types", () => {
  expect(packageFormat("https://test/screens/APP.YML?q=1")).toBe("yaml");
  expect(parsePackage(stringifyPackage(demo, "yaml"), "yaml")).toEqual(demo);
  expect(parsePackage(stringifyPackage(demo), "json")).toEqual(demo);
  expect(
    parsePackage("state: {on: on, off: off, flag: true, empty: null, date: 2026-10-03}", "yaml")
      .state,
  ).toEqual({ on: "on", off: "off", flag: true, empty: null, date: "2026-10-03" });
});
it.each([
  "a: 1\na: 2",
  "a: &v hello\nb: *v",
  "a: 1\n---\nb: 2",
  "a: !custom hi",
  "a: !!str hi",
  "1: value",
  "a: .nan",
  "a: .inf",
  "- item",
  "null",
])("rejects YAML outside the JSON-compatible subset: %s", (text) => {
  expect(() => parsePackage(text, "yaml")).toThrow();
});
it("handles root, legacy, deep and subdirectory URLs without letting IDs become paths", () => {
  const ids = ["orders", "http-grid", "storage-lab"];
  const base = "https://test/demo/";
  expect(readPageRoute(`${base}?screen=http-grid`, base, ids)).toBe("http-grid");
  expect(readPageRoute(`${base}pages/storage-lab/`, base, ids)).toBe("storage-lab");
  expect(readPageRoute(base, base, ids)).toBe("orders");
  expect(pageUrl("http-grid", base, `${base}?screen=orders&debug=1#source`).href).toBe(
    `${base}pages/http-grid?debug=1#source`,
  );
  for (const path of ["pages/unknown", "pages/http-grid/extra", "pages/%2F..", "assets/file.js"])
    expect(() => readPageRoute(base + path, base, ids)).toThrow(/未知/);
});

it.each([
  [{ type: "integer" }, 1.5, /expected integer/],
  [{ type: "number", minimum: 0 }, -1, /minimum/],
  [{ type: "string", maxLength: 2 }, "太郎君", /maxLength/],
  [{ type: "string", minLength: 1 }, "", /minLength/],
  [{ type: "boolean" }, "false", /expected boolean/],
  [{ type: "string", enum: ["yes", "no"] }, "maybe", /enum/],
  [{ type: "array", maxItems: 1, items: { type: "integer" } }, [1, 2], /maxItems/],
  [{ type: "array", items: { type: "integer" } }, ["1"], /state.value\[0\]/],
  [
    {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    {},
    /required/,
  ],
  [
    { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
    { extra: 1 },
    /additional property/,
  ],
])("validates initial typed state with a precise path", (schema, value, message) => {
  expect(() => engine.load(small(schema, value), "fn init(s) {s} fn change(s,e) {s}")).toThrow(
    message,
  );
});
it.each([
  { type: "unknown" },
  { type: ["string", "string"] },
  { type: [] },
  { type: "integer", minimum: 2, maximum: 1 },
  { type: "string", minimum: 1 },
  { type: "array", minItems: 2, maxItems: 1 },
  { type: "object", required: ["undeclared"] },
  { type: "string", pattern: "a" },
  { type: "string", enum: [] },
])("rejects unsupported or contradictory schema declarations", (schema) => {
  expect(() => engine.load(small(schema, "x"), "fn init(s) {s} fn change(s,e) {s}")).toThrow();
});
it("accepts nullable/nested data and commits valid number input but rolls back invalid input and init", () => {
  engine.load(
    small({ type: ["integer", "null"] }, null),
    "fn init(s) {s} fn change(s,e) {s.value=42; s}",
  );
  expect(engine.dispatch("change").state.value).toBe(42);
  expect(() =>
    engine.load(small({ type: "integer" }, 0), 'fn init(s) {s.value="bad"; s} fn change(s,e){s}'),
  ).toThrow(/state.value/);
  engine.load(demo, script);
  expect(engine.dispatch("profileAge", { value: 21 }).state.age).toBe(21);
  const scene = engine.layout(500);
  expect(() => engine.dispatch("profileAge", { value: 21.5 })).toThrow(/state.age/);
  expect(() => engine.dispatch("profileName", { value: "名".repeat(41) })).toThrow(/state.name/);
  expect(engine.layout(500)).toEqual(scene);
});
it("checks bindings in initial and dynamically added components", () => {
  const bad = structuredClone(demo);
  bad.stateSchema.properties.name = { type: "integer" };
  bad.state.name = 1;
  expect(() => engine.load(bad, script)).toThrow(/bind name/);
  const screen = small({ type: "integer" }, 0);
  screen.state.tabs = [];
  screen.stateSchema.additionalProperties = true;
  screen.ui.items.push({
    xtype: "tabpanel",
    itemId: "workspace",
    itemsBind: "tabs",
    activeBind: "active",
  });
  engine.load(
    screen,
    'fn init(s){s} fn change(s,e){s.tabs.push(#{xtype:"panel",itemId:"added",title:"Added",items:[#{xtype:"textfield",itemId:"addedInput",bind:"value"}]}); s}',
  );
  const before = engine.layout(500);
  expect(() => engine.dispatch("change")).toThrow(/bind value/);
  expect(engine.layout(500)).toEqual(before);
});
it("uses JSON numeric equality for enum and rejects non-string multi-select item schemas", () => {
  const screen = small({ type: "array", items: { type: "object" }, enum: [[{ n: 1 }]] }, [
    { n: 1 },
  ]);
  engine.load(screen, "fn init(s){s} fn change(s,e){s.value=[#{n:1.0}]; s}");
  expect(engine.dispatch("change").state.value).toEqual([{ n: 1 }]);
  const invalid = small({ type: "array", items: { type: "integer" } }, []);
  invalid.ui.items.push({
    xtype: "listbox",
    itemId: "choices",
    bind: "value",
    multiSelect: true,
    options: ["1"],
  });
  expect(() => engine.load(invalid, "fn init(s){s} fn change(s,e){s}")).toThrow(
    /items need string/,
  );
});
it("validates callback state and prevents both HTTP and storage effects when state or declarations fail", () => {
  const screen = small({ type: "integer" }, 0);
  screen.storage = { data: { backend: "indexeddb", key: "data", handler: "completed" } };
  screen.requests = { data: { url: "data.json", handler: "completed" } };
  const prefix = 'fn init(s){s} fn completed(s,r){s.value="bad"; s} ';
  engine.load(screen, prefix + 'fn change(s,e){http_get("data"); storage_read("missing"); s}');
  expect(() => engine.dispatch("change")).toThrow(/Unknown storage/);
  // No HTTP pending request was committed when storage preparation failed.
  engine.load(screen, prefix + 'fn change(s,e){storage_read("data"); s}');
  const effect = engine.dispatch("change").effects[0];
  const before = engine.layout(500);
  expect(() => engine.completeStorage(effect.id, success())).toThrow(/state.value/);
  expect(engine.layout(500)).toEqual(before);
  expect(() => engine.completeStorage(effect.id, success())).toThrow(/completed/);
  engine.load(screen, prefix + 'fn change(s,e){http_get("data"); s}');
  expect(() => engine.completeHttp(engine.dispatch("change").effects[0].id, success())).toThrow(
    /state.value/,
  );
});
it("describes metadata and state schema through WebMCP and still enforces typed dispatch", async () => {
  let result = engine.load(demo, script);
  const tools = createUiTools({
    snapshot: () => ({
      screen: {
        id: demo.id,
        title: demo.title,
        token: "screen",
        webmcp: engine.layout(500).webmcp,
      },
      state: result.state,
      revision: result.revision,
      scene: engine.layout(500),
      busy: false,
    }),
    dispatch: (target, payload) => {
      result = engine.dispatch(target, payload);
    },
  });
  const call = (name, input) => tools.find((t) => t.name === name).execute(input);
  const view = await call("ui_get_screen", {});
  expect(view.screen.webmcp.tags).toContain("typed-state");
  expect(view.widgets.find((w) => w.key === "profileName").metadata.webmcp.description).toContain(
    "40文字",
  );
  expect(view.stateSchema.properties.age.type).toBe("integer");
  const rejected = await call("ui_dispatch", {
    screenToken: "screen",
    revision: 0,
    key: "profileAge",
    payload: { value: 1.5 },
  });
  expect(rejected.ok).toBe(false);
  expect(result.revision).toBe(0);
  const bad = structuredClone(demo);
  bad.webmcp.tools = [];
  expect(() => engine.load(bad, script)).toThrow(/unknown field/);
});

it.each(["indexeddb", "opfs"])(
  "emits and completes %s save/read/remove effects using current state",
  (backend) => {
    engine.load(demo, script);
    engine.dispatch("storageBackend", { value: backend });
    engine.dispatch("profileName", { value: "花子" });
    const saved = engine.dispatch("saveProfile");
    const effect = saved.effects[0];
    expect(effect).toMatchObject({
      kind: "storage",
      backend,
      operation: "write",
      key: "profile",
      data: { name: "花子", age: 20 },
    });
    expect(engine.completeStorage(effect.id, success()).state.notice).toContain("保存しました");
    engine.dispatch("profileName", { value: "変更" });
    const restored = engine.completeStorage(
      engine.dispatch("restoreProfile").effects[0].id,
      success(effect.data),
    );
    expect(restored.state.name).toBe("花子");
    expect(
      engine.completeStorage(engine.dispatch("removeProfile").effects[0].id, success()).state
        .notice,
    ).toContain("削除しました");
    expect(
      engine.completeStorage(engine.dispatch("restoreProfile").effects[0].id, success()).state
        .notice,
    ).toContain("まだありません");
  },
);
it("returns unsupported/quota/invalid data errors without erasing existing state", () => {
  engine.load(demo, script);
  const result = engine.completeStorage(engine.dispatch("restoreProfile").effects[0].id, {
    ok: false,
    error: "QuotaExceededError",
  });
  expect(result.state.loading).toBe(false);
  expect(result.state.name).toBe("太郎");
  expect(result.state.notice).toContain("QuotaExceeded");
  const bad = engine.completeStorage(
    engine.dispatch("restoreProfile").effects[0].id,
    success({ name: "名前", age: -1 }),
  );
  expect(bad.state.name).toBe("太郎");
  expect(bad.state.notice).toContain("不正");
});
it("rejects unsafe storage declarations, duplicates and uncommitted side effects", () => {
  const bad = structuredClone(demo);
  bad.storage.profileDb.key = "../other";
  expect(() => engine.load(bad, script)).toThrow(/keys/);
  bad.storage.profileDb.key = "profile";
  bad.storage.profileDb.handler = "missing";
  expect(() => engine.load(bad, script)).toThrow(/undefined handler/);
  const screen = small({ type: "integer" }, 0);
  screen.storage = {
    data: { backend: "indexeddb", key: "data", handler: "completed" },
    alias: { backend: "indexeddb", key: "data", handler: "completed" },
  };
  const prefix = "fn init(s){s} fn completed(s,r){s} ";
  engine.load(
    screen,
    prefix + 'fn change(s,e){storage_read("data"); storage_write("alias",#{value:1});s}',
  );
  expect(() => engine.dispatch("change")).toThrow(/already pending/);
  engine.load(
    screen,
    prefix + 'fn change(s,e){storage_write("data",#{value:1}); s.value="bad"; s}',
  );
  expect(() => engine.dispatch("change")).toThrow(/state.value/);
  expect(() => engine.completeStorage(1, success())).toThrow(/Unknown/);
  engine.load(screen, prefix + 'fn change(s,e){storage_read("data");s}');
  const effect = engine.dispatch("change").effects[0];
  expect(() => engine.dispatch("change")).toThrow(/already pending/);
  expect(engine.completeStorage(effect.id, success()).revision).toBe(2);
});
it("routes chained effects and drops late storage responses after screen replacement", async () => {
  let resolve;
  const client = {
    execute: vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  };
  const complete = vi.fn(() => ({ effects: [{ url: "data.json" }] }));
  const runNext = vi.fn();
  const onError = vi.fn();
  const host = new StorageEffects({ client, complete, runNext, onError });
  host.reset("old");
  const pending = host.run([{ id: 1 }]);
  host.reset("new");
  resolve({ name: "old" });
  await pending;
  expect(complete).not.toHaveBeenCalled();
  const current = host.run([{ id: 2 }]);
  resolve({ name: "new" });
  await current;
  expect(complete).toHaveBeenCalledWith(2, success({ name: "new" }), undefined);
  expect(runNext).toHaveBeenCalledWith([{ url: "data.json" }]);
  expect(onError).not.toHaveBeenCalled();
});
it("rejects missing browser capabilities and validates namespaces before native API calls", async () => {
  const client = new StorageClient({ indexedDB: null, storage: null });
  await expect(
    client.execute("page", { backend: "indexeddb", operation: "read", key: "data" }),
  ).rejects.toThrow(/利用できません/);
  await expect(
    client.execute("page", { backend: "opfs", operation: "read", key: "data" }),
  ).rejects.toThrow(/OPFS/);
  await expect(
    client.execute("../page", { backend: "opfs", operation: "read", key: "data" }),
  ).rejects.toThrow(/不正/);
});
it("keeps engine startup possible when browser storage getters are denied", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    get: () => {
      throw new DOMException("denied", "SecurityError");
    },
  });
  try {
    const client = new StorageClient({ storage: null });
    await expect(
      client.execute("page", { backend: "indexeddb", operation: "read", key: "data" }),
    ).rejects.toThrow(/利用できません/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else delete globalThis.indexedDB;
  }
});
it("times out storage even when the browser operation cannot immediately be aborted", async () => {
  const complete = vi.fn(() => ({}));
  const onError = vi.fn();
  const host = new StorageEffects({
    client: { execute: () => new Promise(() => {}) },
    complete,
    onError,
    timeout: 5,
  });
  host.reset("page");
  await host.run([{ id: 1 }]);
  expect(complete).toHaveBeenCalledWith(
    1,
    {
      ok: false,
      data: null,
      error: "保存操作がタイムアウトしました",
    },
    undefined,
  );
  expect(onError).not.toHaveBeenCalled();
});
it("waits for OPFS close, treats absent files as null and aborts before committing a cancelled write", async () => {
  const calls = [];
  let finishClose;
  const writer = {
    write: vi.fn(async (text) => calls.push(text)),
    close: vi.fn(
      () =>
        new Promise((done) => {
          finishClose = done;
        }),
    ),
    abort: vi.fn(async () => {}),
  };
  const file = {
    createWritable: async () => writer,
    getFile: async () => ({ size: 2, text: async () => "{}" }),
  };
  const directory = {
    getDirectoryHandle: async () => directory,
    getFileHandle: async () => file,
    removeEntry: async () => {},
  };
  const client = new StorageClient({ storage: { getDirectory: async () => directory } });
  const effect = { backend: "opfs", key: "profile", operation: "write", data: { name: "太郎" } };
  const completed = vi.fn();
  const writing = client.execute("page", effect).then(completed);
  await vi.waitFor(() => expect(writer.close).toHaveBeenCalled());
  expect(completed).not.toHaveBeenCalled();
  await expect(client.execute("page", effect)).rejects.toThrow(/前の保存操作/);
  finishClose();
  await writing;
  expect(calls).toEqual(['{"name":"太郎"}']);
  directory.getFileHandle = async () => {
    throw new DOMException("missing", "NotFoundError");
  };
  expect(await client.execute("page", { ...effect, operation: "read" })).toBeNull();
  directory.getFileHandle = async () => file;
  const controller = new AbortController();
  writer.write = async () => {
    controller.abort();
  };
  writer.close.mockClear();
  await expect(client.execute("page", effect, { signal: controller.signal })).rejects.toMatchObject(
    { name: "AbortError" },
  );
  expect(writer.abort).toHaveBeenCalled();
  expect(writer.close).not.toHaveBeenCalled();
});
