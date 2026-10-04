import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";

let wasm, engine;
const definition = (state = {}) => ({
  version: 1,
  id: "extensions",
  title: "Extensions",
  script: "extensions.rhai",
  state,
  ui: {
    xtype: "container",
    items: [
      { xtype: "button", itemId: "run", text: "run", handler: "run" },
      { xtype: "button", itemId: "noop", text: "noop", handler: "noop" },
    ],
  },
});
beforeAll(async () => {
  wasm = await WebAssembly.compile(
    await readFile(new URL("../public/engine.wasm", import.meta.url)),
  );
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, 0, {
    clockProvider: () => undefined,
  });
});
function load(expression, state = {}) {
  return engine.load(
    definition(state),
    `fn init(s){s} fn run(s,e){s.result=${expression};s} fn noop(s,e){s}`,
  );
}
function evaluate(expression, state = {}) {
  load(expression, state);
  return engine.dispatch("run").state.result;
}

it.each([
  ['dec_add("0.1","0.2")', "0.3"],
  ['dec_sub("1","2.25")', "-1.25"],
  ['dec_mul("1234.50","2")', "2469"],
  ['dec_mul("0.0000000000000000000000000001","10")', "0.000000000000000000000000001"],
  ['dec_add("-0.00","0.0")', "0"],
  ['dec_div("1","3",2,"half_up")', "0.33"],
  ['dec_div("2","3",2,"half_up")', "0.67"],
  ['dec_div("1","2.0000000000000000000000000001",0,"half_up")', "0"],
  ['dec_div("1.0000000000000000000000000001","2",0,"half_up")', "1"],
  ['dec_div("-1","8",2,"half_even")', "-0.12"],
  ['dec_div("1","-8",2,"half_up")', "-0.13"],
  ['dec_div("-1","-8",2,"half_up")', "0.13"],
  ['dec_div("79228162514264337593543950335","79228162514264337593543950335",28,"half_even")', "1"],
  ['dec_round("-2.5",0,"down")', "-2"],
  ['dec_round("-2.5",0,"up")', "-3"],
  ['dec_round("-2.5",0,"half_up")', "-3"],
  ['dec_round("-2.5",0,"half_even")', "-2"],
  ['dec_round("-3.5",0,"half_even")', "-4"],
  ['dec_round("-0.001",2,"up")', "-0.01"],
  ['dec_round("1.20",4,"down")', "1.2"],
  ['dec_cmp("01.00","1")', 0],
  ['dec_cmp("-2","1")', -1],
  ['dec_cmp("10","2")', 1],
  ['dec_sum(["0.1","0.2","-0.30"])', "0"],
  ["dec_sum([])", "0"],
  ['dec_sum(["79228162514264337593543950335","1","-1"])', "79228162514264337593543950335"],
  ['dec_is_valid("+1")', false],
  ['dec_is_valid("1e3")', false],
  ['dec_is_valid("1_000")', false],
  ['dec_is_valid(".5")', false],
  ['dec_is_valid("1.")', false],
  ['dec_is_valid(" 1")', false],
  ['dec_is_valid("0.00000000000000000000000000001")', false],
  ['dec_is_valid("79228162514264337593543950336")', false],
  ['num_format("1234.5","#,##0.00")', "1,234.50"],
  ['num_format("-1234.5","¥#,##0")', "-¥1,235"],
  ['num_format("-0.004","#,##0.00")', "0.00"],
  ['num_format("0.125","0.0%")', "12.5%"],
  ['num_format("79228162514264337593543950335","0.0%")', "7922816251426433759354395033500.0%"],
  ['text_normalize("ＡＢＣ ﾊﾟ ①")', "ABC パ 1"],
  ['text_normalize("é","NFC")', "é"],
  ['text_normalize("é","NFD")', "é"],
  ['text_normalize("①","NFKD")', "1"],
  ['text_trim("　\\t hello \\n　")', "hello"],
  ['text_len("👨‍👩‍👧‍👦é🇯🇵")', 3],
  ['text_len("")', 0],
  ['text_pad_start("é",3,"0")', "00é"],
  ['text_pad_end("🇯🇵",3,"🙂")', "🇯🇵🙂🙂"],
  ['text_pad_start("abcd",2,"0")', "abcd"],
  ['text_truncate("👨‍👩‍👧‍👦é🇯🇵",2,"…")', "👨‍👩‍👧‍👦…"],
  ['text_truncate("abcd",0,"")', ""],
  ['text_truncate("abc",3,"long suffix")', "abc"],
])("executes pure decimal/text functions without a clock: %s", (expression, expected) => {
  expect(evaluate(expression)).toEqual(expected);
  expect(WebAssembly.Module.imports(wasm)).toEqual([]);
});

it.each([
  'dec_add(0.1,"0.2")',
  'dec_mul("0.0000000000000000000000000001","0.1")',
  'dec_add("79228162514264337593543950335","0.1")',
  'dec_div("1","0",2,"down")',
  'dec_div("1","3",29,"down")',
  'dec_round("1",-1,"down")',
  'dec_round("1",0,"floor")',
  'dec_sum(["1",2])',
  'num_format("1","0.00")',
  'text_normalize("a","nfkc")',
  "text_len(42)",
  'text_pad_start("a",2,"")',
  'text_pad_end("a",2,"ab")',
  'text_pad_end("a",2,"́")',
  'text_pad_start("🇯",2,"🇵")',
  'text_truncate("abc",1,"..")',
  'text_truncate("abc",-1,"")',
  'text_pad_start("a",65537,"0")',
])("rejects invalid input and rolls back state/revision: %s", (expression) => {
  const before = load(expression, { retained: "previous" });
  const scene = engine.layout(500);
  expect(() => engine.dispatch("run")).toThrow();
  expect(engine.layout(500)).toEqual(scene);
  expect(engine.dispatch("noop")).toMatchObject({
    state: before.state,
    revision: before.revision + 1,
  });
});
it("bounds input/output expansion and aggregate decimal inputs", () => {
  expect(() => evaluate("text_len(s.long)", { long: "a".repeat(65537) })).toThrow();
  expect(evaluate("text_len(s.long)", { long: "a".repeat(65536) })).toBe(65536);
  expect(() => evaluate("text_normalize(s.long)", { long: "㍿".repeat(6000) })).toThrow();
  expect(() => evaluate('text_pad_start("a",65536,"👨‍👩‍👧‍👦")')).toThrow();
  expect(() => evaluate("dec_sum(s.values)", { values: Array(10001).fill("0") })).toThrow();
  expect(() => evaluate("dec_sum(s.values)", { values: Array(10000).fill("0.000000") })).toThrow();
  expect(() => evaluate("dec_is_valid(s.long)", { long: "0".repeat(65) })).not.toThrow();
  expect(evaluate("dec_is_valid(s.long)", { long: "0".repeat(65) })).toBe(false);
});
it("lets handlers catch failures while retaining earlier results", () => {
  engine.load(
    definition({ result: "last" }),
    'fn init(s){s} fn run(s,e){try{s.result=dec_div("1","0",0,"down");}catch(error){s.error=error.to_string();}s} fn noop(s,e){s}',
  );
  const after = engine.dispatch("run");
  expect(after.state.result).toBe("last");
  expect(after.state.error).toContain("division by zero");
});
it("preserves decimal precision through JSON storage effects and completion handlers", () => {
  const screen = definition({ amount: "0.0000000000000000000000000001", phase: "write" });
  screen.storage = { record: { backend: "indexeddb", key: "decimal-record", handler: "done" } };
  engine.load(
    screen,
    `
    fn init(s){s}
    fn noop(s,e){s}
    fn run(s,e){
      if s.phase == "write" { storage_write("record", #{amount:s.amount}); }
      else { storage_read("record"); }
      s
    }
    fn done(s,r){
      if r.operation == "read" {
        s.amount = dec_add(r.data.amount, "0.0000000000000000000000000001");
      }
      s.phase = "read"; s
    }
  `,
  );
  const written = engine.dispatch("run").effects[0];
  const stored = JSON.parse(JSON.stringify(written.data));
  expect(stored.amount).toBe("0.0000000000000000000000000001");
  engine.completeStorage(written.id, { ok: true, data: null, error: "" });
  const read = engine.dispatch("run").effects[0];
  expect(engine.completeStorage(read.id, { ok: true, data: stored, error: "" }).state.amount).toBe(
    "0.0000000000000000000000000002",
  );
});
it.each(["money-lab", "text-lab"])("loads and operates the %s YAML/Rhai sample", async (name) => {
  const source = new URL(`../public/screens/${name}.yaml`, import.meta.url);
  const screen = parsePackage(await readFile(source, "utf8"), "yaml");
  const script = await readFile(new URL(`../public/screens/${name}.rhai`, import.meta.url), "utf8");
  const initial = engine.load(screen, script).state;
  if (name === "money-lab") {
    expect(initial.total).toBe("2716");
    expect(initial.totalLabel).toBe("¥2,716");
    engine.dispatch("price", { value: "-2.5" });
    engine.dispatch("quantity", { value: "1" });
    engine.dispatch("rate", { value: "0.1" });
    const refund = engine.dispatch("calculate").state;
    expect(refund.total).toBe("-2.5");
    expect(refund.totalLabel).toBe("-¥3");
    engine.dispatch("price", { value: "invalid" });
    const failed = engine.dispatch("calculate").state;
    expect(failed.total).toBe(refund.total);
    expect(failed.notice).toContain("計算できません");
  } else {
    expect(initial.normalized).toBe("ABC パ 👨‍👩‍👧‍👦");
    expect(initial.graphemeCount).toBe(7);
    expect(initial.shortLabel).toBe("ABC パ…");
    expect(initial.paddedCode).toBe("000042");
    engine.dispatch("original", { value: "é👨‍👩‍👧‍👦🇯🇵" });
    engine.dispatch("maxLength", { value: 2 });
    const next = engine.dispatch("process").state;
    expect(next.original).toBe("é👨‍👩‍👧‍👦🇯🇵");
    expect(next.shortLabel).toBe("é…");
  }
  expect(engine.layout(500).widgets.length).toBeGreaterThan(0);
});
