// Semantic UI tools are independent of browser registration and rendering adapters.
import { SCREEN_CATALOG } from "./screen-catalog.js";
export { SCREEN_CATALOG } from "./screen-catalog.js";
import { widgetActions as actions, isBlocked as blocked } from "./widget-contract.js";

const guardProperties = {
  screenToken: { type: "string", description: "Copy screen.token from ui_get_screen." },
  revision: {
    type: "integer",
    minimum: 0,
    description: "Copy the latest revision; refresh after each action.",
  },
};
const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("INVALID_INPUT", `Expected an integer from ${min} to ${max}.`);
  return value;
}
function guard(snapshot, input, checkBusy = true) {
  if (!snapshot.screen) fail("NOT_READY", "No screen is loaded.");
  if (typeof input.screenToken !== "string" || !Number.isSafeInteger(input.revision))
    fail("INVALID_INPUT", "screenToken and revision are required.");
  if (input.screenToken !== snapshot.screen.token || input.revision !== snapshot.revision)
    fail("STALE_SCREEN", "The screen has changed. Call ui_get_screen again before acting.");
  if (checkBusy && snapshot.busy) fail("BUSY", "The UI is busy. Retry after it completes.");
}

// Bound recursive JSON output without changing the underlying state.
function preview(value) {
  let budget = 1000;
  let truncated = false;
  function visit(v, depth) {
    if (--budget < 0 || depth > 6) {
      truncated = true;
      return null;
    }
    if (typeof v === "string" && v.length > 2000) {
      truncated = true;
      return v.slice(0, 2000);
    }
    if (Array.isArray(v)) {
      if (v.length > 50) truncated = true;
      return v.slice(0, 50).map((item) => visit(item, depth + 1));
    }
    if (isObject(v)) {
      const entries = Object.entries(v);
      if (entries.length > 50) truncated = true;
      return Object.fromEntries(
        entries.slice(0, 50).map(([k, item]) => [k, visit(item, depth + 1)]),
      );
    }
    return v;
  }
  return { value: visit(value, 0), truncated };
}
function describe(widget, scene) {
  const metadata = Object.fromEntries(
    Object.entries(widget.config).filter(
      ([key]) => !["parentKey", "labelHeight", "rawValue"].includes(key),
    ),
  );
  const data = preview({
    key: widget.key,
    kind: widget.kind,
    target: widget.target,
    text: widget.text,
    value: Object.hasOwn(widget.config, "rawValue") ? widget.config.rawValue : widget.value,
    selected: widget.selected,
    blocked: Boolean(blocked(widget, scene)),
    actions: actions(widget),
    payload: widget.payload,
    cells: widget.cells,
    metadata,
  });
  return { ...data.value, truncated: data.truncated };
}

export function createUiTools(host) {
  const tool = (name, description, inputSchema, readOnly, execute) => ({
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: readOnly, untrustedContentHint: true },
    async execute(input = {}, { signal } = {}) {
      signal?.throwIfAborted();
      try {
        if (
          !isObject(input) ||
          Object.keys(input).some((key) => !Object.hasOwn(inputSchema.properties, key))
        )
          fail("INVALID_INPUT", "Arguments must match the tool schema.");
        return { ok: true, ...(await execute(input, signal)) };
      } catch (error) {
        signal?.throwIfAborted();
        return { ok: false, error: { code: error.code || "UI_ERROR", message: error.message } };
      }
    },
  });
  return [
    tool(
      "ui_list_screens",
      "List bundled UI screens that can be loaded.",
      objectSchema({}),
      true,
      () => ({ screens: SCREEN_CATALOG.map((screen) => ({ ...screen })) }),
    ),
    tool(
      "ui_get_screen",
      "Inspect the current semantic UI, visible Grid cells, input values and allowed actions. Independent of DOM/Canvas. Use screen.token and revision in mutations; paginate widgets with offset.",
      objectSchema({
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      }),
      true,
      (input) => {
        const snapshot = host.snapshot();
        if (!snapshot.screen) fail("NOT_READY", "No screen is loaded.");
        const offset = integer(input.offset, 0, 0, 10000);
        const limit = integer(input.limit, 100, 1, 200);
        const widgets = snapshot.scene.widgets;
        const schema = snapshot.scene.stateSchema ? preview(snapshot.scene.stateSchema) : null;
        return {
          screen: snapshot.screen,
          revision: snapshot.revision,
          busy: snapshot.busy,
          dialog: snapshot.dialog ? preview(snapshot.dialog).value : null,
          modal: snapshot.scene.modal,
          popup: snapshot.scene.popup,
          stateKeys: Object.keys(snapshot.state),
          ...(schema ? { stateSchema: schema.value, stateSchemaTruncated: schema.truncated } : {}),
          offset,
          total: widgets.length,
          nextOffset: offset + limit < widgets.length ? offset + limit : null,
          widgets: widgets.slice(offset, offset + limit).map((w) => describe(w, snapshot.scene)),
        };
      },
    ),
    tool(
      "ui_get_state",
      "Read named top-level state keys from the current screen. Arrays are paginated; nested values are bounded previews. No state modification.",
      objectSchema(
        {
          ...guardProperties,
          keys: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: { type: "string" },
          },
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        ["screenToken", "revision", "keys"],
      ),
      true,
      (input) => {
        const snapshot = host.snapshot();
        guard(snapshot, input, false);
        if (
          !Array.isArray(input.keys) ||
          input.keys.length < 1 ||
          input.keys.length > 10 ||
          new Set(input.keys).size !== input.keys.length ||
          input.keys.some((key) => typeof key !== "string")
        )
          fail("INVALID_INPUT", "Provide 1–10 distinct state keys.");
        const offset = integer(input.offset, 0, 0, 10000);
        const limit = integer(input.limit, 25, 1, 50);
        const values = Object.fromEntries(
          input.keys.map((key) => {
            if (!Object.hasOwn(snapshot.state, key))
              fail("UNKNOWN_KEY", `Unknown state key: ${key}`);
            const value = snapshot.state[key];
            if (!Array.isArray(value)) return [key, preview(value)];
            return [
              key,
              {
                ...preview(value.slice(offset, offset + limit)),
                total: value.length,
                offset,
                nextOffset: offset + limit < value.length ? offset + limit : null,
              },
            ];
          }),
        );
        return { screen: snapshot.screen, revision: snapshot.revision, values };
      },
    ),
    tool(
      "ui_dispatch",
      "Perform one action on a visible widget key from ui_get_screen. Payload merges its default payload; use its actions list. Grid editing uses beginEdit, draft with value, then commitEdit/cancelEdit. Runs the same WASM validation and Rhai handler as human input and updates both renderers.",
      objectSchema(
        {
          ...guardProperties,
          key: { type: "string", minLength: 1 },
          payload: objectSchema({
            action: { type: "string" },
            value: {},
            id: {},
            column: { type: "string" },
            beforeId: { type: ["string", "null"] },
            additive: { type: "boolean" },
            range: { type: "boolean" },
            toggle: { type: "boolean" },
          }),
        },
        ["screenToken", "revision", "key"],
      ),
      false,
      (input, signal) => {
        const snapshot = host.snapshot();
        guard(snapshot, input);
        if (typeof input.key !== "string") fail("INVALID_INPUT", "A widget key is required.");
        const widget = snapshot.scene.widgets.find((w) => w.key === input.key);
        if (!widget) fail("NOT_VISIBLE", "This widget is no longer visible.");
        if (blocked(widget, snapshot.scene) || !actions(widget).length)
          fail("BLOCKED", "This widget cannot be operated in the current UI.");
        const payload = input.payload ?? {};
        if (
          !isObject(payload) ||
          Object.keys(payload).some(
            (key) =>
              ![
                "action",
                "value",
                "id",
                "column",
                "beforeId",
                "additive",
                "range",
                "toggle",
              ].includes(key),
          ) ||
          ["additive", "range", "toggle"].some(
            (key) => key in payload && typeof payload[key] !== "boolean",
          ) ||
          ("column" in payload && typeof payload.column !== "string") ||
          ("beforeId" in payload &&
            payload.beforeId !== null &&
            typeof payload.beforeId !== "string") ||
          JSON.stringify(payload).length > 10000
        )
          fail("INVALID_INPUT", "Invalid event payload.");
        const merged = { ...widget.payload, ...payload };
        if (!actions(widget).includes(merged.action || ""))
          fail("INVALID_ACTION", "Use an action listed by ui_get_screen for this widget.");
        signal?.throwIfAborted();
        host.dispatch(widget.target, merged);
        const next = host.snapshot();
        if (next.revision === snapshot.revision)
          fail("NOT_APPLIED", "WASM did not accept this operation.");
        return { screen: next.screen, revision: next.revision, applied: true };
      },
    ),
    tool(
      "ui_load_screen",
      "Load a bundled screen by ID. This resets its in-memory state. Arbitrary URLs and scripts are not accepted. Inspect the screen after loading.",
      objectSchema(
        { ...guardProperties, id: { type: "string", enum: SCREEN_CATALOG.map((s) => s.id) } },
        ["screenToken", "revision", "id"],
      ),
      false,
      async (input, signal) => {
        guard(host.snapshot(), input);
        if (!SCREEN_CATALOG.some((s) => s.id === input.id))
          fail("INVALID_INPUT", "Unknown bundled screen ID.");
        await host.loadScreen(input.id, {
          signal,
          beforeCommit: () => guard(host.snapshot(), input, false),
        });
        const next = host.snapshot();
        return { screen: next.screen, revision: next.revision };
      },
    ),
  ];
}

// Current draft: document.modelContext + AbortSignal-owned registration.
// Older browser/extension previews may still expose navigator.modelContext/unregisterTool.
export async function registerUiTools(tools, environment = globalThis) {
  const current = environment.document?.modelContext;
  const legacy = environment.navigator?.modelContext;
  const context = typeof current?.registerTool === "function" ? current : legacy;
  if (typeof context?.registerTool !== "function")
    return { status: "unsupported", api: null, toolCount: 0, dispose() {} };
  const controller = new AbortController();
  const registered = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    if (typeof context.unregisterTool === "function") {
      for (const name of registered) {
        try {
          context.unregisterTool(name);
        } catch {
          /* Legacy context may already be gone. */
        }
      }
    }
  };
  try {
    for (const descriptor of tools) {
      await context.registerTool(descriptor, { signal: controller.signal });
      registered.push(descriptor.name);
    }
    return {
      status: "ready",
      api: context === current ? "document" : "navigator",
      toolCount: registered.length,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
