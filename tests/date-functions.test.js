import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { browserClock } from "../src/clock.js";

let wasm, engine, current;
const beforeMidnight = Date.parse("2026-10-04T23:59:59.999+09:00");
const fixed = () => ({ nowMs: current, tzOffsetMinutes: 540 });
const definition = (state = {}) => ({
  version: 1,
  id: "date-test",
  title: "Date",
  script: "date.rhai",
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
  current = beforeMidnight;
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, 0, {
    clockProvider: fixed,
  });
});
function evaluate(expression, state = {}) {
  engine.load(
    definition(state),
    `fn init(s){s} fn run(s,e){s.result=${expression};s} fn noop(s,e){s}`,
  );
  return engine.dispatch("run").state.result;
}

it.each([
  ['date_is_valid("2024-02-29")', true],
  ['date_is_valid("2026-02-29")', false],
  ['date_is_valid("0000-01-01")', false],
  ['date_is_valid("2026-1-01")', false],
  ['date_year("2026-10-04")', 2026],
  ['date_month("2026-10-04")', 10],
  ['date_day("2026-10-04")', 4],
  ['date_weekday("2026-10-04")', 7],
  ['date_weekday("2026-10-05")', 1],
  ["date_is_leap_year(1900)", false],
  ["date_is_leap_year(2000)", true],
  ["date_is_leap_year(2100)", false],
  ["date_days_in_month(2024,2)", 29],
  ["date_days_in_month(2026,2)", 28],
  ['date_add_days("2024-02-28",1)', "2024-02-29"],
  ['date_add_days("1970-01-01",-1)', "1969-12-31"],
  ['date_add_months("2024-01-31",1)', "2024-02-29"],
  ['date_add_months("2026-03-31",-1)', "2026-02-28"],
  ['date_add_years("2024-02-29",1)', "2025-02-28"],
  ['date_diff_days("2026-10-04","2026-10-11")', 7],
  ['date_diff_days("2026-10-11","2026-10-04")', -7],
  ['date_start_of_month("2026-10-04")', "2026-10-01"],
  ['date_end_of_month("2024-02-04")', "2024-02-29"],
  ['date_format("2026-10-04","YYYY年M月D日(ddd)")', "2026年10月4日(日)"],
  ['date_format("2026-10-04T09:05:00.123+09:00","YYYY/MM/DD HH:mm:ss")', "2026/10/04 09:05:00"],
  ['datetime_add_minutes("2026-10-04T23:59:30.123+09:00",1)', "2026-10-05T00:00:30.123+09:00"],
  ['datetime_add_minutes("1970-01-01T00:00:00Z",-1)', "1969-12-31T23:59:00.000+00:00"],
  ["datetime_from_ms(-1)", "1970-01-01T08:59:59.999+09:00"],
  ['datetime_to_ms("1970-01-01T00:00:00.001Z")', 1],
  ["datetime_to_ms(datetime_from_ms(-1))", -1],
  ["datetime_to_ms(datetime_from_ms(1791088440123))", 1791088440123],
])(
  "runs date and datetime calculations through the import-free WASM: %s",
  (expression, expected) => {
    expect(evaluate(expression)).toEqual(expected);
    expect(WebAssembly.Module.imports(wasm)).toEqual([]);
  },
);

it.each([
  'date_year("2026-02-29")',
  'date_month("2026/01/01")',
  'date_day("2026-1-01")',
  "date_days_in_month(2026,0)",
  "date_is_leap_year(0)",
  'date_add_days("0001-01-01",-1)',
  'date_add_days("9999-12-31",1)',
  'date_add_months("9999-12-31",1)',
  'date_add_months("2026-01-01",9223372036854775807)',
  'date_add_years("2026-01-01",-9223372036854775807)',
  'datetime_to_ms("2026-10-04T24:00:00Z")',
  'datetime_to_ms("2026-10-04T00:00:60Z")',
  'datetime_to_ms("2026-10-04T00:00:00.1Z")',
  'datetime_to_ms("2026-10-04T00:00:00.")',
  'datetime_to_ms("2026-10-04T00:00:00+14:01")',
  'datetime_to_ms("2026-10-04T00:00:00+09:99")',
  'datetime_add_minutes("9999-12-31T23:59:59Z",1)',
  'datetime_add_minutes("1970-01-01T00:00:00Z",9223372036854775807)',
  'date_format("2026-10-04","HH:mm")',
  'date_format("2026-10-04",s.pattern)',
])("rolls back an uncaught date error: %s", (expression) => {
  engine.load(
    definition({ result: "before", pattern: "x".repeat(257) }),
    `fn init(s){s} fn run(s,e){s.result=${expression};s} fn noop(s,e){s}`,
  );
  const scene = engine.layout(400);
  expect(() => engine.dispatch("run")).toThrow();
  expect(engine.layout(400)).toEqual(scene);
  expect(engine.dispatch("noop")).toMatchObject({ revision: 1, state: { result: "before" } });
});

it("can catch invalid date inputs inside Rhai", () => {
  engine.load(
    definition(),
    'fn init(s){s} fn noop(s,e){s} fn run(s,e){try{s.result=date_add_days("bad",1);}catch(err){s.result="caught";}s}',
  );
  expect(engine.dispatch("run").state.result).toBe("caught");
});

it("samples the clock once per execution, retains milliseconds and advances across local midnight", () => {
  const provider = vi.fn(() => ({ nowMs: current++, tzOffsetMinutes: 540 }));
  engine.clockProvider = provider;
  const code =
    "s.today=date_today();s.now=datetime_now();s.ms=now_ms();s.again=now_ms();s.offset=tz_offset_minutes();";
  const initial = engine.load(
    definition(),
    `fn init(s){${code}s} fn run(s,e){${code}s} fn noop(s,e){s}`,
  );
  expect(initial.state).toMatchObject({
    today: "2026-10-04",
    ms: beforeMidnight,
    again: beforeMidnight,
    now: "2026-10-04T23:59:59.999+09:00",
    offset: 540,
  });
  const result = engine.dispatch("run");
  expect(result.state.today).toBe("2026-10-05");
  expect(result.state.ms).toBe(beforeMidnight + 1);
  engine.layout(400);
  engine.theme();
  expect(provider).toHaveBeenCalledTimes(2);
});

it("keeps clocks isolated between instances and never reuses a preceding request's clock", async () => {
  const script = "fn init(s){s} fn run(s,e){s.result=date_today();s} fn noop(s,e){s}";
  engine.load(definition(), script);
  expect(engine.dispatch("run").state.result).toBe("2026-10-04");
  const other = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, 0, {
    clockProvider: () => ({ nowMs: beforeMidnight, tzOffsetMinutes: -600 }),
  });
  other.load(definition(), script);
  expect(other.dispatch("run").state.result).toBe("2026-10-04");
  current += 1;
  expect(engine.dispatch("run").state.result).toBe("2026-10-05");
  expect(other.dispatch("run").state.result).toBe("2026-10-04");
  engine.clockProvider = () => undefined;
  expect(() => engine.dispatch("run")).toThrow(/host did not supply/);
  expect(evaluate('date_add_days("2026-10-04",1)')).toBe("2026-10-05");
});

it.each([
  { nowMs: 1.1, tzOffsetMinutes: 540 },
  { nowMs: 0, tzOffsetMinutes: 841 },
  { nowMs: 0, tzOffsetMinutes: 1.5 },
  { nowMs: 9007199254740992, tzOffsetMinutes: 0 },
  { nowMs: -62135596800001, tzOffsetMinutes: 0 },
  { nowMs: 253402300800000, tzOffsetMinutes: 0 },
])("rejects invalid host clocks before changing the loaded state: %j", (clock) => {
  engine.load(definition(), "fn init(s){s} fn run(s,e){s.result=now_ms();s} fn noop(s,e){s}");
  engine.clockProvider = () => clock;
  const scene = engine.layout(400);
  expect(() => engine.dispatch("run")).toThrow(/clock/);
  expect(engine.layout(400)).toEqual(scene);
});

it("uses the supplied epoch instant for the browser offset and permits explicit fixed offsets", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(beforeMidnight);
  try {
    expect(browserClock()).toEqual({
      nowMs: beforeMidnight,
      tzOffsetMinutes: -new Date(beforeMidnight).getTimezoneOffset(),
    });
  } finally {
    now.mockRestore();
  }
  engine.clockProvider = () => ({ nowMs: beforeMidnight, tzOffsetMinutes: 0 });
  expect(evaluate("datetime_now()")).toBe("2026-10-04T14:59:59.999+00:00");
});

it.each([
  [
    "http_result",
    { requests: { api: { url: "../data.json", handler: "done" } } },
    'http_get("api");',
  ],
  [
    "host_result",
    { operations: { api: { connection: "api", action: "http.request", handler: "done" } } },
    'host_call("api", #{});',
  ],
  [
    "storage_result",
    { storage: { api: { backend: "indexeddb", key: "data", handler: "done" } } },
    'storage_read("api");',
  ],
  [
    "file_result",
    { files: { api: { backend: "opfs", access: "read", handler: "done" } } },
    'file_stat("api", "data.txt");',
  ],
  ["dialog_result", {}, 'confirm("ok?", "done");'],
])("sets a fresh execution clock for %s callbacks", (op, extra, start) => {
  engine.load(
    { ...definition(), ...extra },
    `fn init(s){s} fn noop(s,e){s} fn run(s,e){${start}s} fn done(s,r){s.result=datetime_now();s}`,
  );
  const effect = engine.dispatch("run").effects[0];
  current += 1;
  const result = engine.call({
    op,
    id: effect.id,
    ok: true,
    data: op === "dialog_result" ? true : null,
    error: op === "host_result" ? null : "",
  });
  expect(result.state.result).toBe("2026-10-05T00:00:00.000+09:00");
});

it("sets a fresh execution clock for RPC callbacks", async () => {
  const rpc = parsePackage(
    await readFile(new URL("../public/screens/rpc-lab.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  const descriptors = {
    "rpc-demo.pb": new Uint8Array(
      await readFile(new URL("../public/screens/rpc-demo.pb", import.meta.url)),
    ),
  };
  const effect = engine.load(
    { ...definition(), rpc: { echo: { ...rpc.rpc.connectEcho, handler: "done" } } },
    'fn init(s){rpc_call("echo", #{name:"test"});s} fn run(s,e){s} fn noop(s,e){s} fn done(s,r){s.result=now_ms();s}',
    descriptors,
  ).effects[0];
  current += 1;
  const result = engine.completeRpc(effect.id, { ok: false, error: "test failure" });
  expect(result.state.result).toBe(beforeMidnight + 1);
});

it("loads the date demo and uses the same pure calculations for fields and calendar selections", async () => {
  const sample = parsePackage(
    await readFile(new URL("../public/screens/date-lab.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  const script = await readFile(
    new URL("../public/screens/date-lab.rhai", import.meta.url),
    "utf8",
  );
  const initial = engine.load(sample, script);
  expect(initial.state.today).toBe("2026-10-04");
  expect(initial.state.due).toBe("2026-10-11");
  const before = engine.layout(600);
  expect(() => engine.dispatch("baseDate", { value: "2026-02-29" })).toThrow(/YYYY-MM-DD/);
  expect(engine.layout(600)).toEqual(before);
  engine.dispatch("baseDate", { value: "2024-01-31" });
  expect(engine.dispatch("calculate").state.nextMonth).toBe("2024-02-29");
});
