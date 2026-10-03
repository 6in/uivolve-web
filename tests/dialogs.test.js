import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { DialogEffects } from "../src/dialog-effects.js";
import { parsePackage } from "../src/package-format.js";

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
function host(dialogs, complete = (id, response) => engine.completeDialog(id, response)) {
  return new DialogEffects({
    client: {
      execute(effect) {
        const method = dialogs[effect.operation];
        if (typeof method !== "function") throw new Error("ダイアログを表示できません");
        const data =
          effect.operation === "prompt"
            ? method(effect.message, effect.defaultValue)
            : method(effect.message);
        return effect.operation === "alert" ? null : data;
      },
    },
    complete,
    onError: vi.fn(),
  });
}
it("queues dialogs once in the common engine and delivers alert dismissal", async () => {
  const effect = engine.dispatch("showAlert").effects[0];
  expect(effect).toMatchObject({ kind: "dialog", operation: "alert", message: "Hello 太郎" });
  expect(engine.dispatch("showAlert").effects).toBeUndefined();
  const alert = vi.fn();
  await host({ alert }).run([effect]);
  expect(alert).toHaveBeenCalledTimes(1);
  expect(engine.layout(500).widgets.some((w) => w.text === "alertを閉じました。")).toBe(true);
  expect(() => engine.completeDialog(effect.id, ok())).toThrow(/completed/);
});
it.each([true, false])("receives confirm %s with matching cancel semantics", (data) => {
  load('confirm("確認","done")', 's.notice=""+r.data+":"+r.cancelled;s');
  const effect = engine.dispatch("go").effects[0];
  expect(engine.completeDialog(effect.id, ok(data)).state.notice).toBe(`${data}:${!data}`);
});
it.each([null, "", "花子"])(
  "preserves prompt cancel, empty OK, and Japanese input: %j",
  async (data) => {
    const effect = engine.dispatch("showPrompt").effects[0];
    const prompt = vi.fn(() => data);
    let result;
    await host({ prompt }, (id, response) => (result = engine.completeDialog(id, response))).run([
      effect,
    ]);
    expect(prompt).toHaveBeenCalledWith("名前を入力してください。", "太郎");
    expect(result.state.loading).toBe(false);
    expect(result.state.name).toBe(data === null ? "太郎" : data);
    expect(result.state.notice).toContain(data === null ? "キャンセル" : "prompt: 「");
  },
);
it("supports alert without a callback, prompt without a default, and FIFO dispatch", async () => {
  load('alert("first");prompt("second","done");alert("third","done")');
  const effects = engine.dispatch("go").effects;
  const order = [];
  const dialogs = {
    alert: (message) => order.push(message),
    prompt: (message, value) => {
      order.push(message);
      expect(value).toBe("");
      return "回答";
    },
  };
  let result;
  await host(dialogs, (id, response) => (result = engine.completeDialog(id, response))).run(
    effects,
  );
  expect(order).toEqual(["first", "second", "third"]);
  expect(result.revision).toBe(4);
});
it("checks handlers, argument sizes and request limits before committing state or other I/O", () => {
  for (const body of [
    'confirm("x","missing")',
    'prompt("x","")',
    'alert("x".repeat(4097))',
    'prompt("x","あ".repeat(1366),"done")',
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
it("caps pending dialogs and consumes each validated completion only once", () => {
  load('for i in 0..8 {alert("x");}');
  const effects = engine.dispatch("go").effects;
  expect(effects).toHaveLength(8);
  expect(() => engine.dispatch("go")).toThrow(/pending dialogs/);
  effects.forEach((e) => engine.completeDialog(e.id, ok()));
  expect(engine.dispatch("go").effects).toHaveLength(8);
});
it("rejects malformed completion data and rolls back failing completion state", () => {
  for (const [body, data] of [
    ['alert("x")', true],
    ['confirm("x","done")', "true"],
    ['prompt("x","done")', 123],
    ['prompt("x","done")', "あ".repeat(1366)],
  ]) {
    load(body);
    const effect = engine.dispatch("go").effects[0];
    const before = engine.layout(500);
    expect(() => engine.completeDialog(effect.id, ok(data))).toThrow(/response/);
    expect(engine.layout(500)).toEqual(before);
    expect(() => engine.completeDialog(effect.id, ok(data))).toThrow(/completed/);
  }
  load('confirm("x","done")', 'alert("must not display");s.loading="bad";s');
  const effect = engine.dispatch("go").effects[0],
    before = engine.layout(500);
  expect(() => engine.completeDialog(effect.id, ok(true))).toThrow();
  expect(engine.layout(500)).toEqual(before);
});
it("chains completion dialogs without reentering or deadlocking WASM", async () => {
  load(
    'prompt("x","done")',
    'if r.operation=="prompt" {s.name=r.data;alert("Hello "+s.name,"done");} else {s.notice="completed";}s',
  );
  const dialogs = { prompt: vi.fn(() => "花子"), alert: vi.fn() };
  let result;
  const h = host(dialogs, (id, response) => (result = engine.completeDialog(id, response)));
  await h.run(engine.dispatch("go").effects);
  await vi.waitFor(() => expect(result.revision).toBe(3));
  expect(dialogs.alert).toHaveBeenCalledWith("Hello 花子");
  expect(h.onError).not.toHaveBeenCalled();
});
it("uses the latest state when other events arrive before a dialog completion", () => {
  const editable = structuredClone(screen);
  editable.ui.items[1].disabledBind = "";
  engine.load(editable, script + "\n");
  const effect = engine.dispatch("showConfirm").effects[0];
  engine.dispatch("dialogName", { value: "花子" });
  expect(engine.completeDialog(effect.id, ok(true)).state.name).toBe("花子");
});
it("reports unavailable/throwing dialogs and oversize replies through the completion handler", async () => {
  for (const dialogs of [
    {},
    {
      prompt: () => {
        throw new Error("blocked");
      },
    },
    { prompt: () => "x".repeat(4097) },
  ]) {
    engine.load(screen, script);
    let result;
    await host(dialogs, (id, response) => (result = engine.completeDialog(id, response))).run(
      engine.dispatch("showPrompt").effects,
    );
    expect(result.state.loading).toBe(false);
    expect(result.state.name).toBe("太郎");
    expect(result.state.notice).toContain("失敗:");
  }
});
it("drops queued dialogs on reset and ignores a returned result after screen replacement", async () => {
  const dialogs = { alert: vi.fn() },
    complete = vi.fn(() => ({}));
  const h = host(dialogs, complete);
  const queued = h.run([{ id: 1, operation: "alert", message: "old" }]);
  h.reset();
  await queued;
  expect(dialogs.alert).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  dialogs.confirm = () => {
    h.reset();
    return true;
  };
  await h.run([{ id: 2, operation: "confirm", message: "old" }]);
  expect(complete).not.toHaveBeenCalled();
  await h.run([{ id: 3, operation: "alert", message: "new" }]);
  expect(dialogs.alert).toHaveBeenCalledWith("new");
  expect(complete).toHaveBeenCalledTimes(1);
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
it("aborts a displayed asynchronous dialog on screen replacement and resumes the new queue", async () => {
  const complete = vi.fn(() => ({}));
  let signal;
  const client = {
    execute: vi.fn((_, options) => {
      signal = options.signal;
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    }),
  };
  const h = new DialogEffects({ client, complete });
  const pending = h.run([{ id: 1, operation: "prompt", message: "old" }]);
  await vi.waitFor(() => expect(client.execute).toHaveBeenCalledTimes(1));
  expect(h.busy).toBe(true);
  h.reset();
  expect(signal.aborted).toBe(true);
  await pending;
  expect(h.busy).toBe(false);
  expect(complete).not.toHaveBeenCalled();
  client.execute.mockResolvedValueOnce(true);
  await h.run([{ id: 2, operation: "confirm", message: "new" }]);
  expect(complete).toHaveBeenCalledWith(2, ok(true));
});
