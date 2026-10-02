import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";

let compiled;
let bytes;
let orders;
let orderScript;
let tasks;
let taskScript;
let components;
let componentScript;
let darkTheme;
let engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  compiled = await WebAssembly.compile(bytes);
  orders = JSON.parse(
    await readFile(new URL("../public/screens/orders.json", import.meta.url), "utf8"),
  );
  orderScript = await readFile(new URL("../public/screens/orders.rhai", import.meta.url), "utf8");
  tasks = JSON.parse(
    await readFile(new URL("../public/screens/tasks.json", import.meta.url), "utf8"),
  );
  taskScript = await readFile(new URL("../public/screens/tasks.rhai", import.meta.url), "utf8");
  components = JSON.parse(
    await readFile(new URL("../public/screens/components.json", import.meta.url), "utf8"),
  );
  componentScript = await readFile(
    new URL("../public/screens/components.rhai", import.meta.url),
    "utf8",
  );
  darkTheme = JSON.parse(
    await readFile(new URL("../public/themes/dark.json", import.meta.url), "utf8"),
  );
});
beforeEach(async () => {
  const instance = await WebAssembly.instantiate(compiled, {});
  engine = new WasmEngine(instance.exports, bytes.byteLength);
});

describe("actual WASM engine, downloaded DSL and Rhai", () => {
  it("runs the Hello World tutorial through input bindings and the downloaded button handler", async () => {
    const screen = JSON.parse(
      await readFile(new URL("../public/screens/hello-world.json", import.meta.url), "utf8"),
    );
    const script = await readFile(
      new URL("../public/screens/hello-world.rhai", import.meta.url),
      "utf8",
    );
    const initial = engine.load(screen, script);
    const entered = engine.dispatch("nameInput", { value: "  太郎  " });
    expect(entered.state.name).toBe("  太郎  ");
    expect(entered.state.greeting).toBe(initial.state.greeting);
    expect(engine.dispatch("helloButton").state.greeting).toBe("Hello 太郎");
    expect(engine.layout(500).widgets.find((w) => w.key === "greetingLabel").text).toBe(
      "Hello 太郎",
    );
    engine.dispatch("nameInput", { value: " \t " });
    expect(engine.dispatch("helloButton").state.greeting).toBe("Hello World");
    expect(engine.load(screen, script).state).toEqual(initial.state);
  });

  it("changes the palette without resetting drafts, modal layers, geometry or revision", () => {
    expect(engine.theme().colors.primary).toBe("#286c5c");
    engine.load(components, componentScript);
    engine.dispatch("openEditor");
    const edited = engine.dispatch("draftName", { value: "入力途中の日本語" });
    const before = engine.layout(500);
    expect(engine.theme(darkTheme)).toEqual(darkTheme);
    const after = engine.layout(500);
    expect(after.widgets).toEqual(before.widgets);
    expect(after.modal).toEqual(before.modal);
    expect(after.theme.colors.background).toBe("#192630");
    const blocked = engine.dispatch("memo", { value: "blocked" });
    expect(blocked.revision).toBe(edited.revision);
    expect(blocked.state.draftName).toBe("入力途中の日本語");
    engine.load(tasks, taskScript);
    expect(engine.layout(500).theme).toEqual(darkTheme);
  });

  it("resolves partial palettes and rejects invalid replacements atomically", () => {
    const custom = engine.theme({ version: 1, mode: "dark", colors: { primary: "#A456CF" } });
    expect(custom.colors.primary).toBe("#a456cf");
    expect(custom.colors.background).toBe(darkTheme.colors.background);
    for (const invalid of [
      { version: 2 },
      { version: 1, colors: { primray: "#123456" } },
      { version: 1, colors: { primary: "url(https://example.com/image)" } },
      { version: 1, colors: { primary: "#１２３４５６" } },
      { version: 1, styles: {} },
      { version: 1, mode: "unknown" },
    ]) {
      expect(() => engine.theme(invalid)).toThrow(/Theme|theme/);
      expect(engine.theme()).toEqual(custom);
    }
    engine.theme({ version: 1, colors: { primary: "#336699", overlay: "#11223344" } });
    expect(engine.theme().colors.background).toBe("#ffffff");
  });

  it("compiles scripts, edits Japanese text, and preserves selected rows", () => {
    expect(engine.load(orders, orderScript).state.count).toBe("4 件");
    engine.dispatch("orders", { id: 2 });
    engine.dispatch("customer", { value: "日本語の顧客" });
    const result = engine.dispatch("save");
    expect(result.state.orders[1].customer).toBe("日本語の顧客");
    engine.dispatch("amount", { value: "abc" });
    const invalid = engine.dispatch("save");
    expect(invalid.state.notice).toBe("金額は整数で入力してください。");
    expect(invalid.state.orders[1].amount).toBe(86400);
    engine.dispatch("amount", { value: "86400" });
    engine.dispatch("customer", { value: "　 \t" });
    expect(engine.dispatch("save").state.orders[1].customer).toBe("日本語の顧客");
    expect(engine.layout(500).widgets.filter((w) => w.selected)).toHaveLength(1);
  });
  it("switches to a different package without rebuilding the engine", () => {
    engine.load(orders, orderScript);
    engine.load(tasks, taskScript);
    engine.dispatch("newTask", { value: "新しいタスク" });
    expect(engine.dispatch("add").state.tasks).toHaveLength(4);
    expect(engine.dispatch("toggle").state.done).toBe("2 件");
    engine.dispatch("newTask", { value: "　 \t" });
    expect(engine.dispatch("add").state.tasks).toHaveLength(4);
  });
  it("rejects a broken replacement and continues running the old screen", () => {
    engine.load(orders, orderScript);
    expect(() => engine.load(tasks, "fn init(")).toThrow();
    expect(engine.dispatch("search", { value: "山田" }).state.visible).toHaveLength(1);
  });
  it("rejects undefined handlers and bounds a runaway script without losing state", () => {
    const broken = structuredClone(orders);
    broken.ui.items.push({ xtype: "button", itemId: "fail", handler: "fail" });
    expect(() => engine.load(broken, orderScript)).toThrow(/undefined handler/);
    const script = `${orderScript}\nfn fail(state, event) { state.query = "changed"; while true {} state }`;
    engine.load(broken, script);
    expect(() => engine.dispatch("fail")).toThrow(/operations/);
    expect(engine.dispatch("search", { value: "" }).state.visible).toHaveLength(4);
  });

  it("collapses nested panels without losing input state or accepting hidden events", () => {
    engine.load(components, componentScript);
    const expanded = engine.layout(500).height;
    engine.dispatch("memo", { value: "入力を保持" });
    const collapsed = engine.dispatch("profile", { action: "toggle" });
    expect(collapsed.state.profileCollapsed).toBe(true);
    expect(collapsed.state.notice).toBe("プロフィールを折りたたみました。");
    expect(engine.layout(500).height).toBeLessThan(expanded);
    expect(engine.layout(500).widgets.some((w) => w.target === "memo")).toBe(false);
    const hidden = engine.dispatch("memo", { value: "届かない入力" });
    expect(hidden.revision).toBe(collapsed.revision);
    expect(hidden.state.memo).toBe("入力を保持");
    engine.dispatch("profile", { action: "toggle" });
    expect(engine.layout(500).widgets.find((w) => w.target === "memo").value).toBe("入力を保持");
  });

  it("isolates stacked windows and commits changes only after confirmation", () => {
    engine.load(components, componentScript);
    const opened = engine.dispatch("openEditor");
    expect(engine.layout(500).modal.key).toBe("editor");
    expect(engine.dispatch("memo", { value: "blocked" }).revision).toBe(opened.revision);
    engine.dispatch("draftName", { value: "　 \t" });
    expect(engine.dispatch("review").state.confirmOpen).toBe(false);
    engine.dispatch("draftName", { value: "新しい名前" });
    const reviewed = engine.dispatch("review");
    expect(engine.layout(500).modal.key).toBe("confirm");
    expect(engine.dispatch("editor", { action: "close" }).revision).toBe(reviewed.revision);
    expect(engine.dispatch("draftName", { value: "blocked" }).state.draftName).toBe("新しい名前");
    engine.dispatch("confirm", { action: "close" });
    expect(engine.layout(500).modal.key).toBe("editor");
    expect(engine.dispatch("review").state.savedName).toBe("山田 太郎");
    const saved = engine.dispatch("commit");
    expect(saved.state.savedName).toBe("新しい名前");
    expect(engine.layout(500).modal).toBeNull();
    expect(engine.dispatch("draftName", { value: "hidden" }).revision).toBe(saved.revision);
    expect(engine.dispatch("commit").state.savedName).toBe("新しい名前");
  });

  it("bounds windows to the viewport and rolls back failed built-in close actions", () => {
    const failing = `${componentScript}\nfn failClose(state, event) { throw "close failed"; state }`;
    const screen = structuredClone(components);
    screen.ui.items.find((n) => n.xtype === "window").handler = "failClose";
    engine.load(screen, failing);
    engine.dispatch("openEditor");
    const scene = engine.layout(240);
    const shell = scene.widgets.find((w) => w.kind === "window");
    expect(shell.x).toBeGreaterThanOrEqual(16);
    expect(shell.x + shell.width).toBeLessThanOrEqual(224);
    expect(shell.y + shell.height).toBeLessThanOrEqual(scene.height - 16);
    expect(() => engine.dispatch("editor", { action: "close" })).toThrow(/close failed/);
    expect(engine.layout(240).modal.key).toBe("editor");
    const invalid = structuredClone(components);
    invalid.ui.items.find((n) => n.xtype === "window").visibleBind = "nested.open";
    expect(() => engine.load(invalid, componentScript)).toThrow(/top-level/);
  });
});
