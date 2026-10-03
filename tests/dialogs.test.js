import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { resolveDialogIcon } from "../src/dialog-icons.js";

let wasm, engine, screen, script;
beforeAll(async () => {
  wasm = await WebAssembly.compile(
    await readFile(new URL("../public/engine.wasm", import.meta.url)),
  );
  screen = parsePackage(
    await readFile(new URL("../public/screens/dialogs.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  script = await readFile(new URL("../public/screens/dialogs.rhai", import.meta.url), "utf8");
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, 0);
  engine.load(screen, script);
});
const ok = (data = null) => ({ ok: true, data, error: "" });
function load(body, done = 's.notice=""+r.operation;s') {
  const simple = structuredClone(screen);
  simple.ui = { xtype: "button", itemId: "go", handler: "start", text: "Go" };
  return engine.load(simple, `fn init(s){s} fn start(s,e){${body};s} fn done(s,r){${done}}`);
}

const active = () => engine.layout(500).dialog;
const key = (suffix = "") => ":dialog:" + active().id + suffix;
const answer = () => engine.dispatch(key(":ok"));
it("draws an engine-owned alert and consumes a shared answer only once", () => {
  const effect = engine.dispatch("showAlert").effects[0];
  expect(effect).toMatchObject({ kind: "dialog", operation: "alert", message: "Hello 太郎" });
  const scene = engine.layout(500);
  expect(scene.dialog.message).toBe("Hello 太郎");
  expect(scene.modal.key).toBe(key());
  expect(scene.widgets.find((w) => w.kind === "dialog-icon").config.icon).toBe("info");
  expect(scene.widgets.find((w) => w.key === "showAlert").disabled).toBe(true);
  const button = key(":ok");
  const revision = answer().revision;
  expect(engine.layout(500).dialog).toBeNull();
  expect(engine.layout(500).widgets.some((w) => w.text === "alertを閉じました。")).toBe(true);
  expect(engine.dispatch(button).revision).toBe(revision);
  expect(() => engine.completeDialog(effect.id, ok())).toThrow(/completed/);
});
it.each([true, false])("handles confirm %s through scene controls", (data) => {
  load('confirm("確認","done")', 's.notice=""+r.data+":"+r.cancelled;s');
  engine.dispatch("go");
  expect(engine.dispatch(key(data ? ":ok" : ":cancel")).state.notice).toBe(data + ":" + !data);
});
it.each([null, "", "花子"])("preserves prompt cancel, empty OK and Japanese input: %j", (data) => {
  engine.dispatch("showPrompt");
  const field = key(":input");
  expect(engine.layout(500).widgets.find((w) => w.target === field).value).toBe("太郎");
  let result;
  if (data === null) result = engine.dispatch(key(":cancel"));
  else {
    const before = engine.dispatch(field, { value: data });
    expect(before.state.name).toBe("太郎");
    expect(active().value).toBe(data);
    result = answer();
  }
  expect(result.state.loading).toBe(false);
  expect(result.state.name).toBe(data === null ? "太郎" : data);
  expect(result.state.notice).toContain(data === null ? "キャンセル" : "prompt: 「");
});
it("supports callback-free alert and FIFO with prompt defaulting to empty", () => {
  load('alert("first");prompt("second","done");alert("third","done")');
  const effects = engine.dispatch("go").effects;
  expect(effects).toHaveLength(3);
  expect(active().message).toBe("first");
  expect(engine.dispatch(":dialog:" + effects[1].id + ":ok").revision).toBe(1);
  answer();
  expect(active()).toMatchObject({ message: "second", value: "" });
  engine.dispatch(key(":input"), { action: "accept", value: "回答" });
  expect(active().message).toBe("third");
  expect(answer().revision).toBe(4);
  expect(active()).toBeNull();
});
it("caps pending dialogs before a completion callback can enqueue more", () => {
  load('for i in 0..8 {alert("x","done");}', 'for i in 0..8 {alert("new");}s');
  const effects = engine.dispatch("go").effects;
  expect(effects).toHaveLength(8);
  expect(() => answer()).toThrow(/pending dialogs/);
  expect(active().id).toBe(effects[1].id);
  expect(engine.layout(500).widgets.filter((w) => w.kind === "window")).toHaveLength(1);
});
it("rejects malformed completion data, consumes requests, and rolls back callback state", () => {
  for (const [body, data] of [
    ['alert("x")', true],
    ['confirm("x","done")', "true"],
    ['prompt("x","done")', 123],
    ['prompt("x","done")', "あ".repeat(1366)],
  ]) {
    load(body);
    const before = engine.dispatch("go");
    const effect = before.effects[0];
    expect(() => engine.completeDialog(effect.id, ok(data))).toThrow(/response/);
    expect(engine.dispatch(":dialog:stale").revision).toBe(before.revision);
    expect(active()).toBeNull();
    expect(() => engine.completeDialog(effect.id, ok(data))).toThrow(/completed/);
  }
  load('confirm("x","done")', 'alert("must not display");s.loading="bad";s');
  const before = engine.dispatch("go");
  expect(() => answer()).toThrow();
  expect(engine.dispatch(":dialog:stale").revision).toBe(before.revision);
  expect(active()).toBeNull();
});
it("chains dialogs from callbacks without a host presenter", () => {
  load(
    'prompt("x","done")',
    'if r.operation=="prompt" {s.name=r.data;alert("Hello "+s.name,"done");} else {s.notice="completed";}s',
  );
  engine.dispatch("go");
  engine.dispatch(key(":input"), { action: "accept", value: "花子" });
  expect(active().message).toBe("Hello 花子");
  expect(answer().state.notice).toBe("completed");
  expect(active()).toBeNull();
});
it("blocks background events in the engine, retaining private prompt drafts", () => {
  const editable = structuredClone(screen);
  editable.ui.items[1].disabledBind = "";
  engine.load(editable, script);
  const before = engine.dispatch("showPrompt");
  expect(engine.dispatch("dialogName", { value: "background" }).revision).toBe(before.revision);
  expect(engine.dispatch("showConfirm").effects).toBeUndefined();
  const draft = engine.dispatch(key(":input"), { value: "日本語" });
  expect(draft.revision).toBe(before.revision + 1);
  expect(draft.state.name).toBe("太郎");
  expect(engine.layout(700).dialog.value).toBe("日本語");
  const cancelled = engine.dispatch(key(), { action: "close" });
  expect(cancelled.state.name).toBe("太郎");
  expect(active()).toBeNull();
});
it("uses current state after an asynchronous response while a dialog remains open", () => {
  const simple = structuredClone(screen);
  simple.requests = { api: { url: "data.json", handler: "received" } };
  simple.ui = { xtype: "button", itemId: "go", handler: "start" };
  engine.load(
    simple,
    'fn init(s){s} fn start(s,e){http_get("api");confirm("x","done");s} fn received(s,r){s.name=r.data;s} fn done(s,r){s.notice=s.name;s}',
  );
  const effects = engine.dispatch("go").effects;
  engine.completeHttp(effects.find((e) => !e.kind).id, ok("花子"));
  expect(answer().state.notice).toBe("花子");
});
it("drops dialogs on screen replacement and ignores stale scene controls", () => {
  load('alert("old");alert("queued")');
  engine.dispatch("go");
  const old = key(":ok");
  engine.load(screen, script);
  expect(active()).toBeNull();
  expect(engine.dispatch(old).revision).toBe(0);
  engine.dispatch("showAlert");
  expect(active().message).toBe("Hello 太郎");
  const before = active();
  engine.dispatch(old);
  expect(active()).toEqual(before);
  expect(() => engine.completeDialog(Number(old.split(":")[2]), ok())).toThrow(/completed/);
});
it.each([240, 500, 1000])("keeps dialogs and controls within a %spx stage", (width) => {
  load("prompt(" + JSON.stringify("長い本文\n" + "あ".repeat(800)) + ',"done")');
  engine.dispatch("go");
  const scene = engine.layout(width);
  const dialogWidgets = scene.widgets.filter((w) => w.layer === scene.modal.layer);
  for (const w of dialogWidgets) {
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.y).toBeGreaterThanOrEqual(0);
    expect(w.x + w.width).toBeLessThanOrEqual(scene.width);
    expect(w.y + w.height).toBeLessThanOrEqual(scene.height);
  }
  const message = dialogWidgets.find((w) => w.kind === "dialog-message");
  expect(message.height).toBeLessThanOrEqual(220);
  expect(message.config.lines.join("")).toBe("長い本文" + "あ".repeat(800));
});
it("rejects oversize drafts without changing the scene and accepts Enter's current value", () => {
  engine.dispatch("showPrompt");
  const before = engine.layout(500);
  expect(() => engine.dispatch(key(":input"), { value: "あ".repeat(1366) })).toThrow(/4096/);
  expect(engine.layout(500)).toEqual(before);
  expect(engine.dispatch(key(":input"), { action: "accept", value: "確定" }).state.name).toBe(
    "確定",
  );
});
it("omits the icon widget for none and puts dialogs above page windows", () => {
  const simple = structuredClone(screen);
  simple.state.loading = true;
  simple.ui = {
    xtype: "container",
    items: [
      {
        xtype: "window",
        itemId: "pageWindow",
        title: "Page",
        visibleBind: "loading",
        width: 420,
        items: [{ xtype: "button", itemId: "go", handler: "start" }],
      },
    ],
  };
  engine.load(simple, 'fn init(s){s} fn start(s,e){alert("x",#{icon:"none"});s}');
  engine.dispatch("go");
  const scene = engine.layout(500);
  expect(scene.widgets.filter((w) => w.kind === "window")).toHaveLength(2);
  expect(scene.widgets.some((w) => w.kind === "dialog-icon")).toBe(false);
  expect(scene.widgets.find((w) => w.key === "pageWindow").disabled).toBe(true);
  answer();
  expect(engine.layout(500).modal.key).toBe("pageWindow");
});
it("checks handlers, argument sizes and request limits before committing state or other I/O", () => {
  for (const body of [
    'confirm("x","missing")',
    'prompt("x","")',
    `alert(${JSON.stringify("x".repeat(4097))})`,
    `prompt("x",${JSON.stringify("あ".repeat(1366))},"done")`,
    'for i in 0..9 {alert("x");}',
    'alert("x");s.loading="bad"',
  ]) {
    load(body);
    const before = engine.layout(500);
    expect(() => engine.dispatch("go")).toThrow();
    expect(engine.layout(500)).toEqual(before);
  }
  const simple = structuredClone(screen);
  simple.requests = { api: { url: "data.json", handler: "done" } };
  simple.ui = { xtype: "button", itemId: "go", handler: "start" };
  engine.load(
    simple,
    'fn init(s){s} fn start(s,e){http_get("api");confirm("x","missing");s} fn done(s,r){s}',
  );
  expect(() => engine.dispatch("go")).toThrow(/undefined handler/);
  expect(() => engine.call({ op: "http_result", id: 1, ok: true, data: [] })).toThrow(
    /Unknown or completed/,
  );
});
it("validates init dialogs and callback arity before replacing the active screen", () => {
  const simple = structuredClone(screen);
  simple.ui = { xtype: "container", items: [] };
  const before = engine.layout(500);
  expect(() => engine.load(simple, 'fn init(s){alert("x","done");s} fn done(s){s}')).toThrow(
    /undefined handler/,
  );
  expect(() => engine.load(simple, 'fn init(s){alert("x");throw "bad init";s}')).toThrow(
    /bad init/,
  );
  expect(engine.layout(500)).toEqual(before);
  const started = engine.load(
    simple,
    'fn init(s){alert("ready","done");s} fn done(s,r){s.notice="closed";s}',
  );
  expect(started.effects).toHaveLength(1);
  expect(engine.completeDialog(started.effects[0].id, ok()).state.notice).toBe("closed");
});
it("supplies type-specific defaults without changing the existing API", () => {
  load('alert("x");confirm("x","done");prompt("x","done")');
  expect(engine.dispatch("go").effects.map((e) => e.icon)).toEqual(["info", "question", "input"]);
});
it("supports icon options for every signature, including custom images and text", () => {
  load(
    'alert("x",#{icon:"success"});alert("x","done",#{icon:"warning"});confirm("x","done",#{icon:"error"});prompt("x","done",#{icon:"none"});prompt("x","太郎","done",#{icon:#{src:"../assets/dialog-orbit.svg",alt:"アプリ"}});alert("x",#{icon:#{text:"🚀",alt:"ロケット"}})',
  );
  const effects = engine.dispatch("go").effects;
  expect(effects.map((e) => e.icon)).toEqual([
    "success",
    "warning",
    "error",
    "none",
    { src: "../assets/dialog-orbit.svg", alt: "アプリ" },
    { text: "🚀", alt: "ロケット" },
  ]);
  expect(effects[3].defaultValue).toBe("");
  expect(effects[4].defaultValue).toBe("太郎");
  effects.forEach((effect) =>
    engine.completeDialog(effect.id, ok(effect.operation === "confirm" ? true : null)),
  );
});
it.each([
  '#{icon:"unknown"}',
  "#{icon:42}",
  '#{icons:"info"}',
  '#{icon:#{src:"x",text:"🚀"}}',
  '#{icon:#{src:"x",width:100}}',
  '#{icon:#{text:" "}}',
  `#{icon:#{text:${JSON.stringify("あ".repeat(22))}}}`,
  '#{icon:#{src:"data:image/svg+xml;base64,ABC"}}',
  '#{icon:#{src:"javascript:alert(1)"}}',
  '#{icon:#{src:"file:///tmp/icon.svg"}}',
  `#{icon:#{src:${JSON.stringify("x".repeat(2049))}}}`,
  '#{icon:#{src:"icon with space.svg"}}',
  `#{icon:#{text:"🚀",alt:${JSON.stringify("あ".repeat(54))}}}`,
])("rejects invalid icon options atomically: %s", (options) => {
  load(`alert("valid");s.name="should not commit";alert("bad",${options})`);
  const before = engine.layout(500);
  expect(() => engine.dispatch("go")).toThrow(/Dialog/);
  expect(engine.layout(500)).toEqual(before);
  expect(() => engine.completeDialog(1, ok())).toThrow(/completed/);
});
it("resolves custom assets against the downloaded package, including deployment subpaths", () => {
  const base = "https://example.com/app/screens/dialogs.yaml";
  expect(resolveDialogIcon(undefined, "confirm", base)).toBe("question");
  expect(resolveDialogIcon({ src: "../assets/icon.svg", alt: "アプリ" }, "alert", base)).toEqual({
    src: "https://example.com/app/assets/icon.svg",
    alt: "アプリ",
  });
  expect(resolveDialogIcon({ src: "https://cdn.example.com/icon.png" }, "alert", base)).toEqual({
    src: "https://cdn.example.com/icon.png",
    alt: "",
  });
  expect(resolveDialogIcon({ text: "<svg>", alt: "文字" }, "prompt", base)).toEqual({
    text: "<svg>",
    alt: "文字",
  });
  expect(resolveDialogIcon("none", "alert", base)).toBe("none");
});
it.each([
  { src: "javascript:alert(1)" },
  { src: "data:image/png;base64,AAAA" },
  { src: "//user:secret@example.com/x" },
  { src: "https://user:secret@example.com/x" },
  { src: "../a.svg", text: "x" },
  { src: "../a.svg", width: 20 },
  { text: "あ".repeat(22) },
  { text: "🚀", alt: "あ".repeat(54) },
  { src: "../a\\b.svg" },
  "__proto__",
])("rejects invalid custom icon contracts at the host boundary: %j", (icon) => {
  expect(() =>
    resolveDialogIcon(icon, "alert", "https://example.com/app/screens/demo.yaml"),
  ).toThrow();
});
