import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";

let wasm, engine;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bytes = (length, value = 0) => Array.from({ length }, () => value);
const zeros = () => bytes(1024);
const definition = (state = {}) => ({
  version: 1,
  id: "random-test",
  title: "Random",
  script: "random.rhai",
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
  // No provider given: the engine falls back to browserRandom, i.e. crypto.getRandomValues.
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, 0);
});
async function withProvider(randomProvider) {
  return new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, 0, { randomProvider });
}
function evaluate(target, expression, state = {}) {
  target.load(
    definition(state),
    `fn init(s){s} fn run(s,e){s.result=${expression};s} fn noop(s,e){s}`,
  );
  return target.dispatch("run").state.result;
}

it("turns the host's bytes into a UUID without generating randomness of its own", async () => {
  const fixed = await withProvider(zeros);
  expect(evaluate(fixed, "uuid_v4()")).toBe("00000000-0000-4000-8000-000000000000");
  expect(WebAssembly.Module.imports(wasm)).toEqual([]);
});

it("shapes the default crypto bytes into a version 4 variant 10 UUID", () => {
  expect(evaluate(engine, "uuid_v4()")).toMatch(UUID);
});

it("supplies exactly 64 UUIDs per execution and starts a fresh pool after running out", () => {
  const base = definition({ keys: [] });
  const sixtyFour = "let a=[];for i in 0..64 {a.push(uuid_v4());}s.keys=a;s";
  engine.load(
    {
      ...base,
      ui: {
        ...base.ui,
        items: [
          ...base.ui.items,
          { xtype: "button", itemId: "over", text: "over", handler: "over" },
        ],
      },
    },
    `fn init(s){s} fn noop(s,e){s} fn run(s,e){${sixtyFour}} ` +
      "fn over(s,e){let a=[];for i in 0..65 {a.push(uuid_v4());}s.keys=a;s}",
  );
  const first = engine.dispatch("run").state.keys;
  expect(first).toHaveLength(64);
  expect(new Set(first).size).toBe(64);
  expect(first.every((key) => UUID.test(key))).toBe(true);
  const scene = engine.layout(400);
  expect(() => engine.dispatch("over")).toThrow(/使い切りました/);
  expect(engine.layout(400)).toEqual(scene);
  // The execution that ran out spent nothing the host can see: the next one gets its own 1,024.
  const second = engine.dispatch("run").state.keys;
  expect(new Set(second).size).toBe(64);
  expect(new Set([...first, ...second]).size).toBe(128);
});

it("names the missing supply when the provider hands back nothing", async () => {
  const empty = await withProvider(() => undefined);
  empty.load(definition(), "fn init(s){s} fn noop(s,e){s} fn run(s,e){s.id=uuid_v4();s}");
  expect(() => empty.dispatch("run")).toThrow(/供給していません/);
});

it("draws an integer inside the requested range and refuses a reversed one", () => {
  const drawn = evaluate(engine, "random_int(1, 6)");
  expect(Number.isInteger(drawn)).toBe(true);
  expect(drawn).toBeGreaterThanOrEqual(1);
  expect(drawn).toBeLessThanOrEqual(6);
  engine.load(
    definition({ result: "before" }),
    "fn init(s){s} fn noop(s,e){s} fn run(s,e){s.result=random_int(2, 1);s}",
  );
  expect(() => engine.dispatch("run")).toThrow(/minはmax以下/);
  expect(engine.dispatch("noop")).toMatchObject({ revision: 1, state: { result: "before" } });
});

// A provider that does not return 1,024 usable bytes is the host's own mistake, so it is
// reported in JS before anything is handed to WASM and before the loaded screen moves.
it.each([() => new Uint8Array(1023), () => [256, ...bytes(1023)], () => "x"])(
  "refuses an invalid provider in JS without reaching WASM: #%#",
  (provider) => {
    engine.load(
      definition({ result: "before" }),
      "fn init(s){s} fn noop(s,e){s} fn run(s,e){s.result=uuid_v4();s}",
    );
    const scene = engine.layout(400);
    const exports_ = engine.exports;
    const request = vi.fn((...args) => exports_.request(...args));
    engine.exports = Object.create(exports_, { request: { value: request } });
    engine.randomProvider = provider;
    expect(() => engine.dispatch("run")).toThrow(/randomには/);
    expect(request).not.toHaveBeenCalled();
    engine.exports = exports_;
    engine.randomProvider = zeros;
    expect(engine.layout(400)).toEqual(scene);
    expect(engine.dispatch("noop")).toMatchObject({ revision: 1, state: { result: "before" } });
  },
);
