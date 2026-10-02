import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { createUiTools } from "../src/webmcp.js";

let wasm, bytes, engine, demo, script;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  demo = JSON.parse(
    await readFile(new URL("../public/screens/layout-lab.json", import.meta.url), "utf8"),
  );
  script = await readFile(new URL("../public/screens/layout-lab.rhai", import.meta.url), "utf8");
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
});
const packageFor = (ui, state = {}) => ({
  version: 1,
  id: "layout-test",
  title: "Layouts",
  script: "layouts.rhai",
  state,
  ui,
});
const load = (ui, state = {}, script = "fn init(state) { state }") =>
  engine.load(packageFor(ui, state), script);
const panel = (id, extra = {}) => ({
  xtype: "panel",
  itemId: id,
  title: id,
  items: [{ xtype: "label", text: id }],
  ...extra,
});
const widget = (scene, key) => scene.widgets.find((w) => w.key === key);
const bounds = (scene) => {
  for (const w of scene.widgets) {
    for (const k of ["x", "y", "width", "height"]) expect(Number.isFinite(w[k])).toBe(true);
    expect(w.width).toBeGreaterThanOrEqual(0);
    expect(w.height).toBeGreaterThanOrEqual(0);
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.x + w.width).toBeLessThanOrEqual(scene.width + 0.001);
    expect(w.y + w.height).toBeLessThanOrEqual(scene.height + 0.001);
  }
};

it("packs Grid spans, matches row heights, and measures responsive rows before arranging", () => {
  load({
    xtype: "container",
    layout: { type: "grid", columns: 3, minColumnWidth: 120, gap: 10, padding: 8 },
    items: [
      panel("a", { height: 160 }),
      panel("b"),
      panel("c"),
      panel("wide", { colSpan: 2 }),
      panel("last"),
    ],
  });
  const scene = engine.layout(600),
    a = widget(scene, "a"),
    b = widget(scene, "b"),
    c = widget(scene, "c"),
    wide = widget(scene, "wide");
  expect(a.x).toBe(24);
  expect(b.y).toBe(a.y);
  expect(c.y).toBe(a.y);
  expect(b.height).toBe(160);
  expect(b.x).toBeCloseTo(a.x + a.width + 10);
  expect(wide.width).toBeCloseTo(a.width * 2 + 10);
  expect(wide.y).toBe(a.y + 170);
  bounds(scene);
  const narrow = engine.layout(240);
  expect(widget(narrow, "wide").width).toBe(widget(narrow, "a").width);
  expect(widget(narrow, "b").y).toBe(widget(narrow, "a").y + 170);
  expect(narrow.height).toBeGreaterThan(scene.height);
  bounds(narrow);
});

it("places five Border regions, fills Fit, and grows rather than overlapping content", () => {
  load({
    xtype: "container",
    layout: { type: "border", gap: 8, padding: 10 },
    height: 500,
    items: [
      panel("north", { region: "north" }),
      panel("south", { region: "south" }),
      panel("west", { region: "west", width: 120 }),
      panel("east", { region: "east", width: 90 }),
      panel("center", {
        region: "center",
        layout: { type: "fit", padding: 5 },
        items: [panel("fill")],
      }),
    ],
  });
  for (const width of [700, 360, 240]) {
    const scene = engine.layout(width),
      n = widget(scene, "north"),
      s = widget(scene, "south"),
      w = widget(scene, "west"),
      e = widget(scene, "east"),
      c = widget(scene, "center"),
      fill = widget(scene, "fill");
    expect(n.width).toBe(s.width);
    expect(w.y).toBe(n.y + n.height + 8);
    expect(e.height).toBe(c.height);
    expect(c.x).toBeCloseTo(w.x + w.width + 8);
    expect(e.x).toBeCloseTo(c.x + c.width + 8);
    expect(s.y).toBeCloseTo(c.y + c.height + 8);
    expect(fill.height).toBe(c.height - 56 - 10);
    bounds(scene);
  }
  load({
    xtype: "container",
    layout: "border",
    height: 40,
    items: [panel("center", { region: "center", height: 250 })],
  });
  expect(widget(engine.layout(400), "center").height).toBe(250);
});

it("uses common layouts inside floating windows and honors their minimum height", () => {
  load(
    {
      xtype: "container",
      items: [
        {
          xtype: "window",
          itemId: "window",
          title: "Fit",
          visibleBind: "open",
          height: 360,
          layout: { type: "fit", padding: 8 },
          items: [panel("fill")],
        },
      ],
    },
    { open: true },
  );
  for (const width of [700, 240]) {
    const scene = engine.layout(width),
      shell = widget(scene, "window"),
      fill = widget(scene, "fill");
    expect(shell.height).toBe(360);
    expect(fill.height).toBe(360 - 56 - 16);
    expect(fill.width).toBe(shell.width - 28 - 16);
    bounds(scene);
  }
});

it("retains Card input, keeps a stable frame, hides inactive windows and blocks hidden events", () => {
  load(
    {
      xtype: "container",
      itemId: "cards",
      layout: "card",
      activeBind: "step",
      items: [
        panel("first", {
          items: [{ xtype: "textfield", itemId: "name", bind: "name", value: "初期値" }],
        }),
        panel("second", {
          height: 220,
          items: [
            { xtype: "button", itemId: "open", text: "Open", handler: "open" },
            {
              xtype: "window",
              itemId: "modal",
              title: "Card modal",
              visibleBind: "open",
              items: [{ xtype: "label", text: "Window" }],
            },
          ],
        }),
      ],
    },
    {},
    "fn init(state) { state } fn open(state,event) { state.open=true; state }",
  );
  const first = engine.layout(500);
  expect(widget(first, "first").height).toBe(220);
  engine.dispatch("name", { value: "日本語を保持" });
  engine.dispatch("cards", { action: "card", value: 1 });
  expect(engine.layout(500).height).toBe(first.height);
  expect(widget(engine.layout(500), "name")).toBeUndefined();
  expect(engine.dispatch("name", { value: "hidden" }).state.name).toBe("日本語を保持");
  engine.dispatch("open");
  expect(engine.layout(500).modal.target).toBe("modal");
  engine.dispatch("modal", { action: "close" });
  engine.dispatch("cards", { action: "card", value: 0 });
  expect(engine.dispatch("open").state.open).toBe(false);
  expect(widget(engine.layout(500), "name").value).toBe("日本語を保持");
  const windowUi = {
    xtype: "container",
    itemId: "cards",
    layout: "card",
    items: [
      panel("first"),
      panel("second", {
        items: [{ xtype: "window", itemId: "modal", visibleBind: "open", items: [] }],
      }),
    ],
  };
  load(windowUi, { open: true });
  expect(engine.layout(500).modal).toBeNull();
  engine.dispatch("cards", { action: "card", value: 1 });
  expect(engine.layout(500).modal.target).toBe("modal");
});

it("validates Card indices and state atomically, including handler changes", () => {
  const ui = {
    xtype: "container",
    items: [
      {
        xtype: "container",
        itemId: "cards",
        layout: "card",
        activeBind: "step",
        activeItem: 1,
        items: [panel("first"), panel("second"), panel("disabled", { disabled: true })],
      },
      { xtype: "button", itemId: "fail", handler: "fail" },
    ],
  };
  load(ui, {}, "fn init(state) { state } fn fail(state,event) { state.step=99; state }");
  for (const value of [-1, 0.5, "0", 9, 2])
    expect(() => engine.dispatch("cards", { action: "card", value })).toThrow();
  expect(() => engine.dispatch("fail")).toThrow(/Card state/);
  expect(widget(engine.layout(400), "cards:card").config.activeItem).toBe(1);
  expect(() =>
    load(ui, { step: "1" }, "fn init(state) { state } fn fail(state,event) { state }"),
  ).toThrow(/Card state/);
  expect(widget(engine.layout(400), "cards:card").config.activeItem).toBe(1);
});

it("accepts old string layouts and shared spacing, and honors small fractional flex", () => {
  load({
    xtype: "container",
    layout: "hbox",
    items: [panel("a", { flex: 0.1 }), panel("b", { flex: 0.2 })],
  });
  const scene = engine.layout(400),
    a = widget(scene, "a"),
    b = widget(scene, "b");
  expect(b.width).toBeCloseTo(a.width * 2);
  expect(b.x + b.width).toBeCloseTo(384);
  load({
    xtype: "container",
    layout: { type: "vbox", gap: 6, padding: 4 },
    items: [panel("a"), panel("b")],
  });
  expect(widget(engine.layout(400), "b").y).toBe(106);
  load({ xtype: "container", layout: "grid", columns: 2, items: [panel("a"), panel("b")] });
  expect(widget(engine.layout(400), "a").y).toBe(widget(engine.layout(400), "b").y);
});

it("rejects invalid layout contracts before replacing the active screen", () => {
  load(panel("good"));
  const invalid = [
    { layout: { type: "" } },
    { layout: { type: "grid", columns: 0 } },
    { layout: { type: "grid", columns: 2 }, items: [panel("a", { colSpan: 3 })] },
    { layout: { type: "vbox", columns: 2 } },
    { layout: { type: "grid", minColumnWidth: 10 } },
    { layout: { type: "vbox", gap: -1 } },
    { layout: { type: "vbox", padding: 65 } },
    { layout: { type: "grid", unknown: true } },
    { layout: "card", items: [] },
    { layout: "card", activeItem: 5, items: [panel("a")] },
    { layout: "card", items: [{ xtype: "window", itemId: "w", visibleBind: "open" }] },
    { layout: "fit", items: [panel("a"), panel("b")] },
    { layout: "border", items: [panel("a", { region: "west" })] },
    {
      layout: "border",
      items: [panel("a", { region: "center" }), panel("b", { region: "center" })],
    },
    { items: [panel("a", { region: "north" })] },
    { layout: "flexbox" },
  ];
  for (const bad of invalid) expect(() => load({ xtype: "container", ...bad })).toThrow();
  expect(widget(engine.layout(400), "root").text).toBe("good");
});

it("loads every layout demo at desktop and narrow widths with bounds and input retention", () => {
  engine.load(demo, script);
  for (const value of [0, 1, 2]) {
    engine.dispatch("layoutViews", { action: "tab", value });
    for (const width of [700, 500, 360, 240]) bounds(engine.layout(width));
  }
  engine.dispatch("layoutViews", { action: "tab", value: 1 });
  engine.dispatch("cardName", { value: "確認した名前" });
  engine.dispatch("nextCard");
  engine.dispatch("cardMemo", { value: "保存するメモ" });
  engine.dispatch("nextCard");
  expect(engine.dispatch("previousCard").state.cardName).toBe("確認した名前");
  expect(engine.dispatch("previousCard").state.cardMemo).toBe("保存するメモ");
});

it("exposes Card switching and only its visible children through WebMCP", async () => {
  let result = engine.load(demo, script);
  result = engine.dispatch("layoutViews", { action: "tab", value: 1 });
  const tools = createUiTools({
    snapshot: () => ({
      screen: { id: demo.id, title: demo.title, token: "layouts" },
      revision: result.revision,
      state: result.state,
      scene: engine.layout(600),
      busy: false,
    }),
    dispatch: (target, payload) => {
      result = engine.dispatch(target, payload);
    },
  });
  const call = (name, input) => tools.find((t) => t.name === name).execute(input);
  let view = await call("ui_get_screen", {});
  const card = view.widgets.find((w) => w.key === "wizard:card");
  expect(card.actions).toContain("card");
  expect(card.metadata.count).toBe(3);
  expect(
    (
      await call("ui_dispatch", {
        screenToken: "layouts",
        revision: result.revision,
        key: card.key,
        payload: { action: "card", value: 1 },
      })
    ).ok,
  ).toBe(true);
  view = await call("ui_get_screen", {});
  expect(view.widgets.some((w) => w.key === "cardMemo")).toBe(true);
  expect(view.widgets.some((w) => w.key === "cardName")).toBe(false);
  expect(
    (
      await call("ui_dispatch", {
        screenToken: "layouts",
        revision: result.revision,
        key: "cardName",
        payload: { value: "hidden" },
      })
    ).ok,
  ).toBe(false);
});
