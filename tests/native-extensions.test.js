import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";

let wasm, bytes, screen, script, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  screen = JSON.parse(
    await readFile(new URL("../public/screens/native-extensions.json", import.meta.url)),
  );
  script = await readFile(
    new URL("../public/screens/native-extensions.rhai", import.meta.url),
    "utf8",
  );
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
});

function expression(code, state = {}) {
  engine.load(
    {
      version: 1,
      id: "native-test",
      title: "native",
      script: "native-test.rhai",
      state,
      ui: {
        xtype: "container",
        items: [
          { xtype: "button", itemId: "run", handler: "run" },
          { xtype: "button", itemId: "noop", handler: "noop" },
        ],
      },
    },
    `fn init(state) { state } fn noop(state,event) {state} fn run(state,event) { state.result=${code}; state }`,
  );
  return () => engine.dispatch("run");
}

it("runs the downloaded regular-expression demo and preserves results after caught errors", () => {
  engine.load(screen, script);
  const result = engine.dispatch("runRegex");
  expect(result.state.matched).toBe("一致あり");
  expect(result.state.matches).toEqual([
    { id: 1, text: "りんご 3" },
    { id: 2, text: "みかん 12" },
    { id: 3, text: "ぶどう 5" },
  ]);
  expect(result.state.captures).toBe("0: りんご 3\n1: りんご\n2: 3");
  expect(result.state.replaced).toBe("りんご × 3\nみかん × 12\nぶどう × 5");
  engine.dispatch("regexPattern", { value: "[" });
  const bad = engine.dispatch("runRegex");
  expect(bad.state.notice).toContain("実行できませんでした");
  expect(bad.state.matches).toEqual(result.state.matches);
  expect(bad.state.replaced).toBe(result.state.replaced);
  engine.dispatch("regexPattern", { value: "no-match" });
  const empty = engine.dispatch("runRegex");
  expect(empty.state.matches).toEqual([]);
  expect(empty.state.captures).toBe("");
  expect(empty.state.matched).toBe("一致なし");
  expect(empty.state.replaced).toBe(screen.state.text);
});

it("executes integer-array aggregation from the other tab and reports incompatible inputs", () => {
  engine.load(screen, script);
  engine.dispatch("nativeTabs", { action: "tab", value: 1 });
  expect(engine.dispatch("runSum").state.total).toBe(60);
  engine.dispatch("sumA", { value: 100 });
  expect(engine.dispatch("runSum").state.total).toBe(150);
  engine.dispatch("sumA", { value: 1.5 });
  const decimal = engine.dispatch("runSum");
  expect(decimal.state.total).toBe(150);
  expect(decimal.state.sumNotice).toContain("integer");
  engine.dispatch("sumA", { value: null });
  expect(engine.dispatch("runSum").state.sumNotice).toContain("integer");
});

it.each([
  ['regex_is_match("(?i)^hello$", "HELLO")', true],
  ['regex_is_match("hello", "x hello x")', true],
  ['regex_is_match("^hello$", "x hello x")', false],
  ['regex_find_all("[0-9]+", "注文3件、追加12件")', ["3", "12"]],
  ['regex_find_all("\\\\p{Hiragana}+", "東京のりんごとミカン")', ["のりんごと"]],
  ['regex_find_all("", "日a")', ["", "", ""]],
  ['regex_captures("(a)(b)?", "a")', ["a", "a", null]],
  ['regex_captures("z", "a")', []],
  ['regex_replace_all("(?P<word>日本語)", "日本語", "${word}/$1/$$")', "日本語/日本語/$"],
  ['regex_replace_all("", "日a", "-")', "-日-a-"],
  ["sum_ints([10,20,-5])", 25],
  ["sum_ints([])", 0],
])("calls typed Rust functions within the import-free WASM: %s", (code, expected) => {
  expect(expression(code)().state.result).toEqual(expected);
  expect(WebAssembly.Module.imports(wasm)).toEqual([]);
});

it.each([
  ['regex_is_match("[", "a")', {}, /regex:/],
  ['regex_is_match("(?=a)", "a")', {}, /look-around/],
  ['regex_is_match("(a)\\\\1", "aa")', {}, /backreferences/],
  ['regex_is_match("a{100000000}", "a")', {}, /size limit/],
  ['regex_is_match(state.pattern,"a")', { pattern: "a".repeat(1025) }, /pattern exceeds/],
  ['regex_is_match("a",state.text)', { text: "日".repeat(21846) }, /text exceeds/],
  ['regex_find_all("a",state.text)', { text: "a".repeat(257) }, /256 matches/],
  ['regex_replace_all("a",state.text,"b")', { text: "a".repeat(257) }, /256 replacements/],
  [
    'regex_replace_all("a","a",state.replacement)',
    { replacement: "x".repeat(4097) },
    /replacement exceeds/,
  ],
  [
    'regex_replace_all("(?s)(.+)",state.text,"$1$1")',
    { text: "x".repeat(40000) },
    /output exceeds/,
  ],
  ['regex_captures("(?s)(.+)",state.text)', { text: "x".repeat(40000) }, /output exceeds/],
  ['regex_captures(state.pattern,"a")', { pattern: "(a?)".repeat(256) }, /256 capture/],
  ['regex_is_match(123,"a")', {}, /Function not found/],
  ["sum_ints([1,2.5])", {}, /integer/],
  ["sum_ints([9223372036854775807,1])", {}, /overflow/],
])("rolls back state and revision for uncaught native failures: %s", (code, state, message) => {
  const run = expression(code, { ...state, result: "before" });
  const before = engine.layout(400);
  expect(run).toThrow(message);
  expect(engine.layout(400)).toEqual(before);
  const snapshot = engine.dispatch("noop");
  expect(snapshot.state.result).toBe("before");
  expect(snapshot.revision).toBe(1);
});
