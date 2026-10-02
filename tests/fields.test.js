import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";

let compiled, bytes, screen, script, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  compiled = await WebAssembly.compile(bytes);
  screen = JSON.parse(
    await readFile(new URL("../public/screens/uivolve-forms.json", import.meta.url), "utf8"),
  );
  script = await readFile(new URL("../public/screens/uivolve-forms.rhai", import.meta.url), "utf8");
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(compiled, {})).exports, bytes.length);
});

it("ports uivolve aliases, stores, labels, typed events and Rhai handlers to the same scene", () => {
  engine.load(screen, script);
  const widgets = engine.layout(500).widgets;
  expect(widgets.find((w) => w.target === "personName").text).toBe("名前 *");
  expect(widgets.find((w) => w.target === "department").config.options[1]).toEqual({
    value: "engine",
    text: "エンジン",
  });
  expect(widgets.find((w) => w.target === "memo").kind).toBe("textarea");
  expect(widgets.find((w) => w.target === "languages").config.multiple).toBe(true);
  engine.dispatch("personName", { value: "新しい名前" });
  expect(engine.dispatch("quantity", { value: 12 }).state.quantity).toBe(12);
  expect(engine.dispatch("quantity", { value: null }).state.quantity).toBeNull();
  expect(engine.dispatch("saveForm").state.notice).toMatch(/入力してください/);
  engine.dispatch("quantity", { value: 5 });
  engine.dispatch("due", { value: "2028-02-29" });
  expect(engine.dispatch("notify", { value: false }).state.notify).toBe(false);
  engine.dispatch("express", { value: "express" });
  const radios = engine.layout(500).widgets.filter((w) => w.kind === "radio");
  expect(radios.map((w) => w.selected)).toEqual([false, true]);
  engine.dispatch("department", { value: "qa" });
  expect(engine.dispatch("languages", { value: ["ja", "en"] }).state.languages).toEqual([
    "ja",
    "en",
  ]);
  const stepped = engine.dispatch("volume", { value: 63 });
  expect(stepped.state.volume).toBe(65);
  expect(stepped.state.progress).toBe(0.65);
  expect(engine.layout(500).widgets.find((w) => w.kind === "progressbar").config.fraction).toBe(
    0.65,
  );
  expect(engine.dispatch("saveForm").state.summary).toBe("新しい名前 / 5 個 / 2028-02-29");
});

it("rejects forged values atomically and blocks hidden, read-only and disabled controls", () => {
  engine.load(screen, script);
  const before = engine.dispatch("memo", { value: "日本語\n複数行" });
  for (const [target, value] of [
    ["notify", "true"],
    ["quantity", "5"],
    ["quantity", -1],
    ["due", "2026-02-29"],
    ["due", "2026-00-01"],
    ["due", "２０２６-01-01"],
    ["express", "forged"],
    ["department", "unknown"],
    ["languages", ["ja", "ja"]],
    ["languages", ["unknown"]],
    ["volume", 101],
    ["personName", "x".repeat(81)],
  ]) {
    expect(() => engine.dispatch(target, { value })).toThrow();
    expect(engine.dispatch("readOnly", { value: "blocked" })).toEqual(before);
  }
  expect(engine.dispatch("disabled", { value: "blocked" })).toEqual(before);
  const collapsed = engine.dispatch("choices", { action: "toggle" });
  expect(engine.dispatch("notify", { value: false })).toEqual(collapsed);
  expect(engine.layout(500).widgets.some((w) => w.target === "notify")).toBe(false);
  engine.dispatch("choices", { action: "toggle" });
  expect(engine.layout(500).widgets.find((w) => w.target === "notify").selected).toBe(true);
  const disabled = structuredClone(screen);
  disabled.ui.disabled = true;
  disabled.state.windowOpen = true;
  disabled.ui.items.push({
    xtype: "window",
    itemId: "disabledWindow",
    visibleBind: "windowOpen",
    items: [{ xtype: "textarea", itemId: "child", value: "blocked" }],
  });
  engine.load(disabled, script);
  expect(engine.layout(500).widgets.filter((w) => w.target === "personName")[0].disabled).toBe(
    true,
  );
  expect(engine.dispatch("personName", { value: "blocked" }).revision).toBe(0);
  expect(engine.layout(500).widgets.find((w) => w.target === "child").disabled).toBe(true);
  expect(engine.layout(500).widgets.find((w) => w.kind === "window-close").disabled).toBe(true);
  expect(engine.dispatch("child", { value: "blocked" }).revision).toBe(0);
});

it("initializes values and generated bindings for standalone source-style field configurations", () => {
  const package_ = {
    version: 1,
    id: "defaults",
    title: "defaults",
    script: "test.rhai",
    state: {},
    ui: {
      xtype: "form",
      items: [
        { xtype: "textfield", value: "initial" },
        { xtype: "checkbox", name: "check", checked: true },
        { xtype: "radio", name: "group", inputValue: "one" },
        { xtype: "radio", name: "group", inputValue: "two", checked: true },
        { xtype: "combo", name: "choice", options: [1, 2] },
        {
          xtype: "fieldset",
          title: "collapsed",
          collapsible: true,
          collapsed: true,
          items: [{ xtype: "slider", name: "range", minValue: 10, maxValue: 20 }],
        },
      ],
    },
  };
  const loaded = engine.load(package_, "fn init(state) { state }");
  expect(loaded.state.ui_field_root_0).toBe("initial");
  expect(loaded.state.check).toBe(true);
  expect(loaded.state.group).toBe("two");
  expect(loaded.state.choice).toBe("1");
  expect(loaded.state.range).toBe(10);
  expect(engine.dispatch("field-root-0", { value: "changed" }).state.ui_field_root_0).toBe(
    "changed",
  );
  expect(engine.layout(240).widgets.some((w) => w.kind === "slider")).toBe(false);
});

it("validates options and bounds before replacing a working package", () => {
  engine.load(screen, script);
  for (const control of [
    { xtype: "combo", options: ["duplicate", "duplicate"] },
    { xtype: "combo", store: { data: [{ id: "missing-value" }] } },
    { xtype: "textarea", rows: 100000 },
    { xtype: "slider", minValue: 100, maxValue: 0 },
    { xtype: "slider", increment: 0 },
    { xtype: "textfield", inputType: "file" },
  ]) {
    const invalid = structuredClone(screen);
    invalid.ui.items.push(control);
    expect(() => engine.load(invalid, script)).toThrow();
    expect(engine.layout(500).widgets.some((w) => w.target === "personName")).toBe(true);
  }
});
