import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { createUiTools } from "../src/webmcp.js";
let wasm, bytes, gallery, script, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  gallery = JSON.parse(
    await readFile(new URL("../public/screens/uivolve-gallery.json", import.meta.url), "utf8"),
  );
  script = await readFile(
    new URL("../public/screens/uivolve-gallery.rhai", import.meta.url),
    "utf8",
  );
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
});
const widgets = () => engine.layout(500).widgets;
const view = (n) => engine.dispatch("galleryViews", { action: "tab", value: n });
const loadNode = (ui, state = {}, rhai = "fn init(state) { state }") =>
  engine.load({ version: 1, id: "test", title: "Test", script: "test.rhai", state, ui }, rhai);
it("loads every gallery tab with finite shared geometry and functional toolbar/split menu", () => {
  engine.load(gallery, script);
  expect(widgets().some((w) => w.kind === "toolbar")).toBe(true);
  expect(engine.dispatch("saveSplit-main").state.notice).toContain("保存操作");
  engine.dispatch("saveSplit-menu", { action: "toggle" });
  expect(engine.layout(500).popup.target).toBe("saveSplit-menu");
  engine.dispatch("saveDraft");
  expect(engine.layout(500).popup).toBeNull();
  for (let i = 0; i < 6; i++) {
    view(i);
    for (const w of widgets()) {
      for (const field of ["x", "y", "width", "height"])
        expect(Number.isFinite(w[field])).toBe(true);
      expect(w.width).toBeGreaterThanOrEqual(0);
      expect(w.x + w.width).toBeLessThanOrEqual(501);
    }
  }
  view(5);
  expect(
    widgets()
      .filter((w) => ["image", "video", "iframe"].includes(w.kind))
      .map((w) => w.kind),
  ).toEqual(["image", "video", "iframe"]);
});
it("shares radio bindings, stores checkbox bools and makes accordion panels exclusive", () => {
  engine.load(gallery, script);
  expect(engine.dispatch("express", { value: "express" }).state.delivery).toBe("express");
  const radios = widgets().filter((w) => w.kind === "radio");
  expect(radios.map((w) => w.selected)).toEqual([false, true]);
  expect(engine.dispatch("push", { value: true }).state.notifyPush).toBe(true);
  expect(() => engine.dispatch("push", { value: "true" })).toThrow();
  engine.dispatch("accordionTwo", { action: "toggle" });
  expect(widgets().find((w) => w.key === "accordionOne:toggle").selected).toBe(true);
  engine.dispatch("accordionMemo", { value: "保持した入力" });
  engine.dispatch("accordionOne", { action: "toggle" });
  expect(widgets().some((w) => w.target === "accordionMemo")).toBe(false);
  engine.dispatch("accordionTwo", { action: "toggle" });
  expect(widgets().find((w) => w.target === "accordionMemo").value).toBe("保持した入力");
  engine.dispatch("accordionTwo", { action: "toggle" });
  expect(widgets().find((w) => w.key === "accordionTwo:toggle").selected).toBe(true);
  expect(widgets().find((w) => w.key === "accordionOne:toggle").selected).toBe(true);
});
it("validates leap dates, the visible 42-day calendar, read-only state and page bounds", () => {
  loadNode({
    xtype: "datepicker",
    itemId: "calendar",
    bind: "date",
    pageBind: "month",
    value: "2024-02-29",
    showToday: false,
  });
  expect(widgets().filter((w) => w.key.startsWith("root:day:"))).toHaveLength(42);
  expect(engine.dispatch("calendar", { action: "select", value: "2024-02-29" }).state.date).toBe(
    "2024-02-29",
  );
  for (const value of ["2023-02-29", "2024-01-01", "2024-03-31", "2024-02-00"])
    expect(() => engine.dispatch("calendar", { action: "select", value })).toThrow();
  expect(engine.dispatch("calendar", { action: "select", value: "2024-03-01" }).state.month).toBe(
    "2024-03",
  );
  loadNode({ xtype: "datepicker", itemId: "calendar", value: "2024-02-29", readOnly: true });
  expect(() => engine.dispatch("calendar", { action: "month", value: "2024-03" })).toThrow(
    /read-only/,
  );
  engine.load(gallery, script);
  expect(engine.dispatch("pager", { action: "page", value: 4 }).state.page).toBe(4);
  for (const value of [-1, 5, 1.5, "1"])
    expect(() => engine.dispatch("pager", { action: "page", value })).toThrow();
});
it("answers prompt dialogs atomically and opens/closes WASM-owned notifications", () => {
  engine.load(gallery, script);
  engine.dispatch("showDialog");
  expect(engine.layout(500).modal.target).toBe("promptDialog");
  expect(() => engine.dispatch("promptDialog-answer-0", { action: "answer" })).toThrow(/保存名/);
  expect(engine.layout(500).modal.target).toBe("promptDialog");
  engine.dispatch("promptDialog-prompt", { value: "日本語の保存名" });
  const saved = engine.dispatch("promptDialog-answer-0", { action: "answer" });
  expect(saved.state.answer).toBe("OK");
  expect(saved.state.notice).toContain("日本語の保存名");
  expect(engine.layout(500).modal).toBeNull();
  engine.dispatch("showToast");
  expect(widgets().some((w) => w.kind === "toast")).toBe(true);
  expect(engine.dispatch("galleryToast", { action: "close" }).state.toastOpen).toBe(false);
  expect(widgets().some((w) => w.kind === "toast")).toBe(false);
  loadNode({
    xtype: "container",
    items: [{ xtype: "msgbox", itemId: "locked", closable: false, buttons: "ok" }],
  });
  expect(widgets().some((w) => w.kind === "window-close")).toBe(false);
  expect(() => engine.dispatch("locked", { action: "close" })).toThrow(/cannot be closed/);
});
it("updates code/diff, chat and terminal through Rhai without renderer-specific state", () => {
  engine.load(gallery, script);
  view(1);
  engine.dispatch("codeSource", { value: 'fn greet(name) {\n    "やあ、" + name\n}' });
  const diff = widgets().find((w) => w.key === "sourceDiff").config.lines;
  expect(diff.some((l) => l.text.startsWith("+ ") && l.text.includes("やあ"))).toBe(true);
  expect(diff.some((l) => l.text.startsWith("- ") && l.text.includes("Hello"))).toBe(true);
  expect(diff.filter((l) => l.tone === "text")).toHaveLength(2);
  view(4);
  engine.dispatch("chatInput", { value: "こんにちは" });
  const sent = engine.dispatch("sendMessage");
  expect(sent.state.chatDraft).toBe("");
  expect(sent.state.chatMessages.at(-1).text).toContain("こんにちは");
  expect(
    widgets()
      .find((w) => w.key === "terminalLog")
      .config.lines.at(-1).text,
  ).toContain("こんにちは");
  const revision = sent.revision;
  expect(() => engine.dispatch("sendMessage")).toThrow(/メッセージ/);
  expect(engine.dispatch("clearChat").revision).toBe(revision + 1);
  expect(engine.dispatch("clearLog").state.logLines).toEqual([]);
});
it("validates graph references, chart data and draw dimensions before replacing a screen", () => {
  engine.load(gallery, script);
  for (const ui of [
    { xtype: "networkgraph", nodes: [{ id: "n" }], edges: [{ from: "n", to: "missing" }] },
    { xtype: "gitgraph", commits: [{ id: "a", parents: ["missing"] }] },
    { xtype: "chart", data: [{ name: "a", value: "invalid" }] },
    { xtype: "chart", series: { type: "pie" }, data: [{ name: "a", value: -1 }] },
    { xtype: "draw", sprites: [{ type: "circle", r: -1 }] },
    { xtype: "draw", sprites: [{ type: "rect", opacity: 3 }] },
    { xtype: "mermaid", value: "sequenceDiagram\nA->>B: message" },
    { xtype: "mermaid", value: "flowchart LR\nA[unclosed --> B" },
    { xtype: "image", src: "javascript:alert(1)" },
    { xtype: "container", items: ["invalid"] },
  ])
    expect(() => loadNode(ui)).toThrow();
  expect(widgets().some((w) => w.target === "calendar")).toBe(true);
  view(2);
  const figure = widgets().find((w) => w.key === "barChart");
  expect(figure.config.sprites.filter((s) => s.type === "rect")).toHaveLength(10);
  view(3);
  const positions = widgets().find((w) => w.key === "network").config;
  expect(widgets().find((w) => w.key === "network").config).toEqual(positions);
  expect(positions.sprites.filter((s) => s.type === "circle")).toHaveLength(5);
});
it("exposes visible calendar and dialog actions through the common WebMCP tools", async () => {
  let result = engine.load(gallery, script);
  const tools = createUiTools({
    snapshot: () => ({
      screen: { id: gallery.id, title: gallery.title, token: "gallery" },
      state: result.state,
      revision: result.revision,
      scene: engine.layout(500),
      busy: false,
    }),
    dispatch: (target, payload) => {
      result = engine.dispatch(target, payload);
    },
  });
  const call = (name, args) => tools.find((t) => t.name === name).execute(args);
  const list = await call("ui_get_screen", { limit: 200 });
  // Use the rendered key: WebMCP supplies the generated date payload itself.
  const candidate = widgets().find(
    (w) => w.key.startsWith("calendar:day:") && w.payload.value === "2026-10-03",
  );
  expect(list.widgets.some((w) => w.key === candidate.key)).toBe(true);
  expect(
    (await call("ui_dispatch", { screenToken: "gallery", revision: 0, key: candidate.key })).ok,
  ).toBe(true);
  expect(result.state.selectedDate).toBe("2026-10-03");
  expect(
    (await call("ui_dispatch", { screenToken: "gallery", revision: 0, key: candidate.key })).ok,
  ).toBe(false);
});
it("retains alias behavior for the remaining registered uivolve component names", () => {
  const samples = [
    ["box", { text: "テキスト", height: 64 }, "document"],
    ["tbar", { items: ["ラベル", "->", "-", " ", { text: "実行" }] }, "toolbar"],
    ["code", { value: "fn init(state) { state }" }, "textarea"],
    ["diff", { original: "old", value: "new" }, "document"],
    ["console", { lines: ["✓ 完了"] }, "document"],
    ["chat", { messages: [{ from: "user", text: "こんにちは" }] }, "document"],
    ["imagecomponent", { src: "image.svg" }, "image"],
    ["uxiframe", { url: "embedded.html" }, "iframe"],
    ["forcegraph", { nodes: [{ id: "n" }] }, "figure"],
    ["cartesian", { data: [{ name: "A", value: 1 }] }, "figure"],
    ["polar", { data: [{ name: "A", value: 1 }] }, "figure"],
    ["msgbox", { buttons: "yesno" }, "window"],
  ];
  for (const [xtype, config, kind] of samples) {
    loadNode({ xtype: "container", items: [{ xtype, ...config }] });
    expect(widgets().some((w) => w.kind === kind)).toBe(true);
    if (xtype === "polar")
      expect(
        widgets()
          .find((w) => w.kind === "figure")
          .config.sprites.some((s) => s.type === "sector"),
      ).toBe(true);
  }
});
it("keeps existing calendar state, handles year boundaries and rejects invalid initial values", () => {
  const calendar = {
    xtype: "datepicker",
    itemId: "calendar",
    bind: "date",
    pageBind: "month",
    showToday: false,
  };
  expect(loadNode(calendar, { date: "2024-02-29" }).state.month).toBe("2024-02");
  for (const value of ["2023-02-29", "+024-01-01", 12, true])
    expect(() => loadNode({ ...calendar, value })).toThrow();
  for (const value of [null, true, 1]) expect(() => loadNode(calendar, { date: value })).toThrow();
  loadNode({ ...calendar, value: "0001-01-01" });
  expect(widgets().find((w) => w.key === "root:prev").disabled).toBe(true);
  loadNode({ ...calendar, value: "9999-12-31" });
  expect(widgets().find((w) => w.key === "root:next").disabled).toBe(true);
});
it("rolls back malformed chart bindings and keeps toolbar fields within a narrow viewport", () => {
  const ui = {
    xtype: "container",
    items: [
      { xtype: "chart", itemId: "chart", bind: "data" },
      { xtype: "button", itemId: "fail", handler: "fail" },
    ],
  };
  const result = loadNode(
    ui,
    {
      data: [
        { name: "A", value: -2 },
        { name: "B", value: 4 },
      ],
    },
    'fn init(state) { state } fn fail(state,event) { state.data = "invalid"; state }',
  );
  expect(() => engine.dispatch("fail")).toThrow(/array/);
  expect(
    widgets()
      .find((w) => w.key === "chart")
      .config.sprites.filter((s) => s.type === "rect"),
  ).toHaveLength(2);
  expect(result.revision).toBe(0);
  loadNode({
    xtype: "toolbar",
    items: [
      { xtype: "textfield", fieldLabel: "検索", value: "検索文字" },
      { text: "日本語の長いボタン" },
      { text: "もうひとつのボタン" },
      "->",
      { text: "保存" },
    ],
  });
  const scene = engine.layout(240);
  for (const w of scene.widgets) expect(w.x + w.width).toBeLessThanOrEqual(240);
  expect(scene.widgets.find((w) => w.kind === "toolbar").height).toBeGreaterThanOrEqual(70);
});
