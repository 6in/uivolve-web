import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { createUiTools } from "../src/webmcp.js";

let wasm, bytes, screen, script, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  screen = JSON.parse(
    await readFile(new URL("../public/screens/dynamic-tabs.json", import.meta.url), "utf8"),
  );
  script = await readFile(new URL("../public/screens/dynamic-tabs.rhai", import.meta.url), "utf8");
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
});
const widgets = () => engine.layout(500).widgets;
function mutation(body) {
  const package_ = structuredClone(screen);
  package_.ui.items.push({ xtype: "button", itemId: "mutate", handler: "mutate" });
  return engine.load(package_, `${script}\nfn mutate(state,event) { ${body}; state }`);
}

it("creates tabs during init and events, runs their handlers and preserves independent inputs", () => {
  expect(engine.load(screen, script).state.tabs).toHaveLength(1);
  engine.dispatch("product-tab1", { value: "りんご" });
  engine.dispatch("quantity-tab1", { value: 3 });
  expect(engine.dispatch("save-tab1").state.result_tab1).toBe("りんご × 3");
  const added = engine.dispatch("addTab");
  expect(added.state.activeTab).toBe(1);
  expect(added.state.tabs).toHaveLength(2);
  expect(widgets().some((w) => w.key === "product-tab1")).toBe(false);
  expect(engine.dispatch("product-tab1", { value: "hidden" }).revision).toBe(added.revision);
  engine.dispatch("product-tab2", { value: "みかん" });
  expect(engine.dispatch("save-tab2").state.result_tab2).toBe("みかん × 1");
  const first = engine.dispatch("workspace", { action: "tab", value: 0 });
  expect(first.state.product_tab1).toBe("りんご");
  expect(first.state.quantity_tab1).toBe(3);
  expect(widgets().find((w) => w.key === "quantity-tab1").value).toBe("3");
  expect(widgets().find((w) => w.key === "result-tab1").text).toBe("りんご × 3");
});

it("supports empty tabs and initializes newly added controls without resetting existing state", () => {
  const empty = structuredClone(screen);
  engine.load(empty, "fn init(state) { state } fn addTab(state,event) { state }");
  expect(widgets().filter((w) => w.kind === "tab")).toHaveLength(0);
  expect(engine.layout(240).widgets.every((w) => Number.isFinite(w.width))).toBe(true);
  mutation(
    'state.tabs.push(#{xtype:"container",itemId:"extra",title:"Extra",items:[#{xtype:"textfield",itemId:"extraInput",bind:"extraValue",value:"初期値"}]}); state.activeTab=1',
  );
  engine.dispatch("product-tab1", { value: "既存の入力" });
  const added = engine.dispatch("mutate");
  expect(added.state.extraValue).toBe("初期値");
  expect(added.state.product_tab1).toBe("既存の入力");
  expect(widgets().find((w) => w.key === "extraInput").value).toBe("初期値");
});

it("initializes downloaded definitions before init and honors activeTab defaults", () => {
  const initial = structuredClone(screen);
  delete initial.state.activeTab;
  initial.ui.items[2].activeTab = 1;
  initial.state.tabs = [
    { xtype: "container", itemId: "first", items: [] },
    {
      xtype: "container",
      itemId: "second",
      items: [{ xtype: "numberfield", itemId: "initialInput", bind: "initialValue", value: 7 }],
    },
  ];
  const result = engine.load(
    initial,
    "fn init(state) { state.observed=state.initialValue; state } fn addTab(state,event) { state }",
  );
  expect(result.state.observed).toBe(7);
  expect(result.state.activeTab).toBe(1);
  expect(widgets().find((w) => w.key === "initialInput").value).toBe("7");
});

it("keeps generated child IDs and default input keys stable when tabs are reordered", () => {
  const initial = structuredClone(screen);
  initial.state.tabs = [
    { xtype: "container", itemId: "auto-first", items: [{ xtype: "textfield" }] },
    { xtype: "container", itemId: "auto-second", items: [] },
  ];
  engine.load(
    initial,
    "fn init(state) { state } fn addTab(state,event) { let tab=state.tabs.remove(0); state.tabs.push(tab); state.activeTab=1; state }",
  );
  const field = widgets().find((w) => w.kind === "textfield");
  engine.dispatch(field.target, { value: "順番が変わっても保持" });
  engine.dispatch("addTab");
  const after = widgets().find((w) => w.kind === "textfield");
  expect(after.key).toBe(field.key);
  expect(after.value).toBe("順番が変わっても保持");
});

it("expands nested dynamic tabs and normalizes component aliases", () => {
  const initial = structuredClone(screen);
  initial.state.tabs = [
    {
      xtype: "container",
      itemId: "parent",
      items: [
        { xtype: "tabpanel", itemId: "nested", itemsBind: "innerTabs", activeBind: "innerActive" },
      ],
    },
  ];
  initial.state.innerTabs = [
    {
      xtype: "form",
      itemId: "inner-content",
      items: [
        { xtype: "textareafield", itemId: "inner-input", bind: "innerText", value: "default" },
      ],
    },
  ];
  engine.load(initial, "fn init(state) { state } fn addTab(state,event) { state }");
  expect(widgets().find((w) => w.key === "inner-input").kind).toBe("textarea");
  expect(engine.dispatch("inner-input", { value: "入れ子の入力" }).state.innerText).toBe(
    "入れ子の入力",
  );
});

it.each([
  ['state.tabs = "not an array"', /must refer to an array/],
  ['state.tabs.push(#{xtype:"container",itemId:"tab1"})', /Duplicate itemId/],
  ['state.tabs.push(#{xtype:"container"})', /stable itemId/],
  ['state.tabs.push(#{xtype:"unknown",itemId:"bad"})', /Unknown xtype/],
  ['state.tabs.push(#{xtype:"container",itemId:"bad",typo:true})', /unknown field/],
  ['state.tabs.push(#{xtype:"button",itemId:"bad",handler:"missing"})', /undefined handler/],
  ['state.tabs.push(#{xtype:"textfield",itemId:"bad",bind:"nested.name"})', /top-level/],
  [
    'state.tabs.push(#{xtype:"gridpanel",itemId:"badgrid",columns:[#{text:"Name",dataIndex:"name",editor:#{xtype:"textfield",itemsBind:"tabs"}}]})',
    /editor/,
  ],
  [
    'state.tabs[0].items.push(#{xtype:"gridpanel",itemId:"badgrid",selectedBind:"tabs",pageSize:5,columns:[#{text:"Name",dataIndex:"name"}]})',
    /must refer to an array/,
  ],
  [
    'for i in 0..8 { state.tabs.push(#{xtype:"container",itemId:"extra"+i.to_string()}); }',
    /at most 8/,
  ],
  [
    'state.tabs[0].items.push(#{xtype:"tabpanel",itemId:"cycle",itemsBind:"tabs",activeBind:"cycleActive"})',
    /200 nodes or 20 nesting/,
  ],
  [
    'let children=[]; for i in 0..201 { children.push(#{xtype:"label",itemId:"label"+i.to_string()}); } state.tabs[0].items=children',
    /200 nodes or 20 nesting/,
  ],
])("rolls back both structure and state for invalid dynamic definitions: %s", (body, message) => {
  const before = mutation(body);
  const scene = engine.layout(500);
  expect(() => engine.dispatch("mutate")).toThrow(message);
  expect(engine.layout(500)).toEqual(scene);
  const ignored = engine.dispatch("workspace", { action: "tab", value: 0 });
  expect(ignored.state).toEqual(before.state);
  expect(ignored.revision).toBe(before.revision + 1);
});

it("rejects conflicting itemsBind contracts and preserves an old screen on a failed load", () => {
  engine.load(screen, script);
  const scene = engine.layout(500);
  for (const attrs of [
    { itemsBind: "nested.tabs" },
    { activeBind: "tabs" },
    { xtype: "container" },
    { items: [{ xtype: "label", text: "mixed" }] },
  ]) {
    const bad = structuredClone(screen);
    Object.assign(bad.ui.items[2], attrs);
    expect(() => engine.load(bad, script)).toThrow(/itemsBind/);
    expect(engine.layout(500)).toEqual(scene);
  }
  const badInit = `${script.replace("fn init(state)", "fn originalInit(state)")}\nfn init(state) { state.tabs=[#{xtype:"button",itemId:"bad",handler:"missing"}]; state }`;
  expect(() => engine.load(screen, badInit)).toThrow(/undefined handler/);
  expect(engine.layout(500)).toEqual(scene);
});

it("enforces the eight-tab bound and preserves inputs when definitions are removed or reordered", () => {
  mutation(
    "let first=state.tabs[0]; state.tabs.remove(0); state.tabs.push(first); state.activeTab=1",
  );
  engine.dispatch("product-tab1", { value: "保持する" });
  engine.dispatch("addTab");
  engine.dispatch("mutate");
  expect(widgets().find((w) => w.key === "product-tab1").value).toBe("保持する");
  for (let i = 2; i < 8; i++) engine.dispatch("addTab");
  const max = engine.dispatch("addTab");
  expect(max.state.tabs).toHaveLength(8);
  expect(max.state.tabLimit).toBe(true);
  expect(engine.dispatch("addTab").revision).toBe(max.revision);
  mutation("state.tabs=[]");
  engine.dispatch("product-tab1", { value: "削除後も残す" });
  expect(engine.dispatch("mutate").state.product_tab1).toBe("削除後も残す");
  expect(widgets().filter((w) => w.kind === "tab")).toHaveLength(0);
  expect(() => engine.dispatch("product-tab1", { value: "gone" })).toThrow(/Unknown itemId/);
});

it("applies hidden-tab and modal guards to dynamically created windows", () => {
  mutation(
    'state.tabs[0].items.push(#{xtype:"window",itemId:"popup",visibleBind:"popupOpen",items:[#{xtype:"textfield",itemId:"popupInput",bind:"popupText"}]}); state.popupOpen=true',
  );
  const second = engine.dispatch("addTab");
  const added = engine.dispatch("mutate");
  expect(engine.layout(500).modal).toBeNull();
  expect(engine.dispatch("popupInput", { value: "hidden" }).revision).toBe(added.revision);
  engine.dispatch("workspace", { action: "tab", value: 0 });
  expect(engine.layout(500).modal.key).toBe("popup");
  const input = engine.dispatch("popupInput", { value: "ウィンドウ内" });
  expect(engine.dispatch("addTab").revision).toBe(input.revision);
  expect(engine.dispatch("popup", { action: "close" }).state.tabs).toHaveLength(
    second.state.tabs.length,
  );
  expect(engine.layout(500).modal).toBeNull();
});

it("exposes newly added widgets through WebMCP and executes their handlers via shared dispatch", async () => {
  let result = engine.load(screen, script);
  const tools = createUiTools({
    snapshot: () => ({
      screen: { id: screen.id, title: screen.title, token: "dynamic-screen" },
      state: result.state,
      revision: result.revision,
      scene: engine.layout(500),
      busy: false,
    }),
    dispatch: (target, payload) => {
      result = engine.dispatch(target, payload);
    },
  });
  const call = (name, args = {}) => tools.find((t) => t.name === name).execute(args);
  const dispatch = (key, payload = {}) =>
    call("ui_dispatch", { screenToken: "dynamic-screen", revision: result.revision, key, payload });
  expect((await dispatch("addTab")).ok).toBe(true);
  const view = await call("ui_get_screen", { limit: 200 });
  expect(view.widgets.some((w) => w.key === "save-tab2")).toBe(true);
  expect(view.widgets.some((w) => w.key === "save-tab1")).toBe(false);
  await dispatch("product-tab2", { value: "AIから入力" });
  expect((await dispatch("save-tab2")).ok).toBe(true);
  expect(result.state.result_tab2).toBe("AIから入力 × 1");
});
