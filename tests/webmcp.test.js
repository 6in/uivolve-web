import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { createUiTools, registerUiTools } from "../src/webmcp.js";

let wasm, bytes, grid, gridScript, components, componentScript, host, tools, engine, result;
let generation, screen, busy;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  grid = JSON.parse(
    await readFile(new URL("../public/screens/grid-lab.json", import.meta.url), "utf8"),
  );
  gridScript = await readFile(new URL("../public/screens/grid-lab.rhai", import.meta.url), "utf8");
  components = JSON.parse(
    await readFile(new URL("../public/screens/components.json", import.meta.url), "utf8"),
  );
  componentScript = await readFile(
    new URL("../public/screens/components.rhai", import.meta.url),
    "utf8",
  );
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
  generation = 0;
  busy = false;
  host = {
    snapshot: () => ({
      screen,
      state: result.state,
      revision: result.revision,
      scene: engine.layout(500),
      busy,
    }),
    dispatch: (target, payload) => {
      result = engine.dispatch(target, payload);
    },
    loadScreen: async (_, { signal, beforeCommit } = {}) => {
      signal?.throwIfAborted();
      beforeCommit?.();
      load(grid, gridScript);
    },
  };
  load(grid, gridScript);
  tools = createUiTools(host);
});
function load(package_, script) {
  result = engine.load(package_, script);
  screen = { id: package_.id, title: package_.title, token: `screen-${++generation}` };
}
const call = (name, input, options) =>
  tools.find((tool) => tool.name === name).execute(input, options);
const version = () => ({ screenToken: screen.token, revision: result.revision });
const event = (key, payload) => call("ui_dispatch", { ...version(), key, payload });

it("describes renderer-independent visible widgets and bounds Grid state reads", async () => {
  expect(tools).toHaveLength(5);
  expect(tools.filter((t) => t.annotations.readOnlyHint)).toHaveLength(3);
  const view = await call("ui_get_screen", { limit: 20 });
  expect(view.ok).toBe(true);
  expect(view.widgets).toHaveLength(20);
  expect(view.nextOffset).toBe(20);
  const second = await call("ui_get_screen", { offset: 20, limit: 200 });
  const combined = [...view.widgets, ...second.widgets];
  expect(combined.some((w) => w.key === "inventory:cell:1:customer")).toBe(true);
  expect(combined.some((w) => w.key === "inventory:cell:9:customer")).toBe(false);
  expect(second.widgets.every((w) => !Object.hasOwn(w, "x"))).toBe(true);
  const state = await call("ui_get_state", {
    ...version(),
    keys: ["records"],
    offset: 25,
    limit: 3,
  });
  expect(state.values.records.total).toBe(500);
  expect(state.values.records.value.map((r) => r.id)).toEqual([26, 27, 28]);
  expect(state.values.records.nextOffset).toBe(28);
  state.values.records.value[0].customer = "Changed copy";
  expect(result.state.records[25].customer).toBe("顧客 26");
  expect(result.revision).toBe(0);
});
it("runs stable-ID Grid edits through real WASM/Rhai and retains a rejected draft", async () => {
  expect((await event("inventory:cell:2:quantity", { action: "beginEdit" })).applied).toBe(true);
  await event("inventory:cell:2:quantity", { value: 9000 });
  const revision = result.revision;
  const rejected = await event("inventory:cell:2:quantity", { action: "commitEdit" });
  expect(rejected.ok).toBe(false);
  expect(rejected.error.message).toMatch(/500/);
  expect(result.revision).toBe(revision);
  expect(result.state.records[1].quantity).toBe(14);
  expect(result.state.cellEdit.value).toBe(9000);
  await event("inventory:cell:2:quantity", { value: 42 });
  const saved = await event("inventory:cell:2:quantity", { action: "commitEdit" });
  expect(saved.ok).toBe(true);
  expect(saved.revision).toBe(result.revision);
  expect(result.state.records[1].quantity).toBe(42);
  expect(result.state.edited).toBe(1);
  expect(result.state.cellEdit).toBeNull();
});
it("rejects stale revisions, repeated-screen loads, invisible widgets and disabled tabs", async () => {
  const stale = version();
  await event("inventory:cell:1:customer");
  expect(
    (await call("ui_dispatch", { ...stale, key: "inventory:cell:2:customer" })).error.code,
  ).toBe("STALE_SCREEN");
  const old = version();
  load(grid, gridScript);
  expect(
    (await call("ui_dispatch", { ...old, revision: 0, key: "inventory:cell:2:customer" })).error
      .code,
  ).toBe("STALE_SCREEN");
  expect((await event("inventory:cell:9:customer")).error.code).toBe("NOT_VISIBLE");
  expect((await event("views:tab:3")).error.code).toBe("BLOCKED");
  const tab = engine.layout(500).widgets.find((w) => w.kind === "tab" && w.payload.value === 2);
  await event(tab.key);
  expect((await event("inventory:cell:1:customer")).error.code).toBe("NOT_VISIBLE");
});
it("respects modal scope and busy state without bypassing UI guards", async () => {
  load(components, componentScript);
  await event("openEditor");
  const scope = await call("ui_get_screen");
  expect(scope.widgets.find((w) => w.key === "memo").blocked).toBe(true);
  expect((await event("memo", { value: "Background change" })).error.code).toBe("BLOCKED");
  await event("draftName", { value: "WebMCPから入力" });
  expect(result.state.draftName).toBe("WebMCPから入力");
  busy = true;
  expect((await event("draftName", { value: "busy" })).error.code).toBe("BUSY");
  expect(result.state.draftName).toBe("WebMCPから入力");
});
it("validates arguments and returns structured errors rather than false success", async () => {
  expect((await call("ui_get_screen", { limit: 201 })).error.code).toBe("INVALID_INPUT");
  expect((await call("ui_get_state", { ...version(), keys: ["not-present"] })).error.code).toBe(
    "UNKNOWN_KEY",
  );
  expect(
    (await event("inventory:cell:1:customer", { action: "eval", value: "code" })).error.code,
  ).toBe("INVALID_ACTION");
  expect((await event("inventory:cell:1:customer", { additive: "yes" })).error.code).toBe(
    "INVALID_INPUT",
  );
  expect((await call("ui_get_screen", JSON.parse('{"__proto__":{}}'))).error.code).toBe(
    "INVALID_INPUT",
  );
  expect(
    (await call("ui_load_screen", { ...version(), id: "https://example.com/app.json" })).error.code,
  ).toBe("INVALID_INPUT");
  host.dispatch = () => {};
  expect((await event("inventory:cell:1:customer")).error.code).toBe("NOT_APPLIED");
});
it("propagates cancellation before a mutation and checks version again before loading commits", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    call(
      "ui_dispatch",
      { ...version(), key: "inventory:cell:1:customer" },
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(result.revision).toBe(0);
  const loadingController = new AbortController();
  const originalScreen = screen.token;
  host.loadScreen = async (_, { signal, beforeCommit }) => {
    await Promise.resolve();
    loadingController.abort();
    signal.throwIfAborted();
    beforeCommit();
    load(grid, gridScript);
  };
  await expect(
    call("ui_load_screen", { ...version(), id: "grid-lab" }, { signal: loadingController.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(screen.token).toBe(originalScreen);
  host.loadScreen = async (_, { beforeCommit }) => {
    host.dispatch("gridSearch", { value: "changed while downloading" });
    beforeCommit();
    load(grid, gridScript);
  };
  const failed = await call("ui_load_screen", { ...version(), id: "grid-lab" });
  expect(failed.error.code).toBe("STALE_SCREEN");
  expect(result.state.query).toBe("changed while downloading");
});

function modernContext(failAt = Infinity) {
  const registry = new Map([["other_app_tool", {}]]);
  return {
    registry,
    async registerTool(tool, { signal }) {
      if (registry.size >= failAt) throw new Error("Registration failure");
      registry.set(tool.name, tool);
      signal.addEventListener("abort", () => registry.delete(tool.name), { once: true });
    },
  };
}
it("prefers the current document API, owns registrations with AbortSignal and preserves other tools", async () => {
  const modern = modernContext();
  const legacy = modernContext(0);
  const registration = await registerUiTools(tools, {
    document: { modelContext: modern },
    navigator: { modelContext: legacy },
  });
  expect(registration).toMatchObject({ status: "ready", api: "document", toolCount: 5 });
  expect(modern.registry.size).toBe(6);
  registration.dispose();
  registration.dispose();
  expect([...modern.registry.keys()]).toEqual(["other_app_tool"]);
});
it("rolls back partial registration and supports older preview APIs without a fake polyfill", async () => {
  const modern = modernContext(3);
  await expect(registerUiTools(tools, { document: { modelContext: modern } })).rejects.toThrow(
    /failure/,
  );
  expect([...modern.registry.keys()]).toEqual(["other_app_tool"]);
  const registry = new Map([["other_app_tool", {}]]);
  const legacy = {
    registerTool: (tool) => registry.set(tool.name, tool),
    unregisterTool: (name) => registry.delete(name),
  };
  const registration = await registerUiTools(tools, { navigator: { modelContext: legacy } });
  expect(registration.api).toBe("navigator");
  registration.dispose();
  expect([...registry.keys()]).toEqual(["other_app_tool"]);
  const environment = { document: {}, navigator: {} };
  expect((await registerUiTools(tools, environment)).status).toBe("unsupported");
  expect(environment.document.modelContext).toBeUndefined();
  expect(environment.navigator.modelContext).toBeUndefined();
});
