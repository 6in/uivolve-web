// Candidate-only probe for component composition. The parity harness
// (scripts/compare-engine-behavior.mjs) skips every screen that declares `components`, because a
// base build from before composition cannot load one at all -- there is nothing to compare against.
// This script covers that gap by asserting the composed behavior of a single WASM directly: the
// shipped order-dashboard demo for the happy path, and two inline fixtures for the rejection of
// effect functions inside a child.
// usage: bun scripts/probe-composition.mjs --candidate <wasm> [--evidence <json>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageFormat, parsePackage } from "../src/package-format.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Same fixed clock as scripts/compare-engine-behavior.mjs, so both harnesses drive the same day.
const CLOCK = { nowMs: 1_759_800_000_000, tzOffsetMinutes: 540 };
const CLOCKED = new Set(["load", "event"]);
const DEMO_PARENT = "order-dashboard.json";
const DEMO_CHILD = "parts/order-list.json";

// ---------------------------------------------------------------- CLI

function parseArguments(argv) {
  const options = { candidate: null, evidence: "target/engine-compare/composition.json" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--candidate", "--evidence"].includes(flag) || value === undefined)
      fail(`不正な引数です: ${flag ?? ""}`);
    options[flag.slice(2)] = value;
  }
  if (!options.candidate) fail("--candidate <wasm> は必須です");
  options.candidate = resolve(root, options.candidate);
  if (!existsSync(options.candidate)) fail(`WASMが見つかりません: ${options.candidate}`);
  options.evidence = resolve(root, options.evidence);
  return options;
}
function fail(message) {
  console.error(`${message}
usage: bun scripts/probe-composition.mjs --candidate <wasm> [--evidence <json>]`);
  process.exit(2);
}

// ---------------------------------------------------------------- raw ABI

function raw(exports_, text) {
  const input = new TextEncoder().encode(text);
  const pointer = exports_.input_alloc(input.length);
  try {
    new Uint8Array(exports_.memory.buffer, pointer, input.length).set(input);
    const output = exports_.request(pointer, input.length);
    return new TextDecoder().decode(
      new Uint8Array(exports_.memory.buffer, output, exports_.response_len()),
    );
  } finally {
    exports_.input_free(pointer, input.length);
  }
}
function request(body) {
  return CLOCKED.has(body.op) ? { ...body, clock: CLOCK } : body;
}
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- expectations

// Every expectation returns the problems it found, so one step can report all of them at once.
function isOk(response) {
  return response?.ok ? [] : [`ok: true を期待したが ${JSON.stringify(response?.error)}`];
}
function isRefused(response, texts) {
  if (response?.ok) return ["ok: false を期待したが ok: true"];
  return hasAll(response?.error, texts, "error");
}
function equals(actual, expected, what) {
  return actual === expected ? [] : [`${what}: ${expected} を期待したが ${JSON.stringify(actual)}`];
}
function hasAll(actual, texts, what) {
  const text = typeof actual === "string" ? actual : "";
  return texts
    .filter((want) => !text.includes(want))
    .map(
      (want) => `${what}: ${JSON.stringify(want)} を含むことを期待したが ${JSON.stringify(actual)}`,
    );
}
function widgetKeys(response) {
  return (response?.data?.widgets ?? []).map((widget) => widget.key);
}
// Both placements of the same part are laid out, so every key has to carry its own prefix.
function composedKeys(response) {
  const keys = widgetKeys(response);
  const problems = [];
  if (new Set(keys).size !== keys.length) problems.push(`key が重複している: ${keys.length} 件`);
  for (const key of ["open/orders:header", "shipped/orders:header"])
    if (!keys.includes(key)) problems.push(`key ${key} が無い`);
  return problems;
}
function rowCount(response, prefix) {
  return widgetKeys(response).filter((key) => key.startsWith(`${prefix}orders:row:`)).length;
}

// ---------------------------------------------------------------- sequences

function readPackage(file) {
  const text = readFileSync(`${root}/public/screens/${file}`, "utf8");
  const pkg = parsePackage(text, packageFormat(file));
  const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  return {
    pkg,
    script: readFileSync(`${root}/public/screens/${directory}${pkg.script}`, "utf8"),
  };
}
function loadStep(label, parent, bundle, expect) {
  return {
    label,
    expect,
    build: () => ({
      op: "load",
      package: parent.pkg,
      script: parent.script,
      components: bundle,
    }),
  };
}
function layoutStep(label, width, expect) {
  return { label, expect, build: () => ({ op: "layout", width }) };
}
function eventStep(label, target, payload, expect) {
  return { label, expect, build: () => ({ op: "event", target, payload }) };
}

// The shipped demo: a parent handing one part two configurations and listening to both.
function demoSequence() {
  const parent = readPackage(DEMO_PARENT);
  const child = readPackage(DEMO_CHILD);
  const url = parent.pkg.components?.orderList?.url;
  if (url !== DEMO_CHILD)
    fail(`${DEMO_PARENT} が ${DEMO_CHILD} を宣言していません: ${JSON.stringify(url)}`);
  const bundle = { [url]: { package: child.pkg, script: child.script } };
  const steps = [
    loadStep("load", parent, bundle, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 0, "revision"),
    ]),
  ];
  for (const width of [240, 800, 4096])
    steps.push(layoutStep(`layout:${width}`, width, (r) => [...isOk(r), ...composedKeys(r)]));
  steps.push(
    eventStep("event:filter", "filter", { value: "山田" }, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 1, "revision"),
    ]),
  );
  // The parent's query only reaches the rows through the `config` of each placement, so the row
  // counts after the filter are what a config diff going unnoticed would leave untouched.
  steps.push(
    layoutStep("layout:800:filtered", 800, (r) => [
      ...isOk(r),
      ...composedKeys(r),
      ...equals(rowCount(r, "open/"), 1, "open/orders:row:* の件数"),
      ...equals(rowCount(r, "shipped/"), 0, "shipped/orders:row:* の件数"),
    ]),
  );
  // A selection in either part travels up as an emit and lands in the parent's notice.
  steps.push(
    eventStep("event:open/orders", "open/orders", { id: 1 }, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 2, "revision"),
      ...hasAll(r.data?.state?.notice, ["受注", "SO-001"], "state.notice"),
    ]),
  );
  steps.push(
    eventStep("event:shipped/orders", "shipped/orders", { id: 2 }, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 3, "revision"),
      ...hasAll(r.data?.state?.notice, ["出荷済", "SO-002"], "state.notice"),
    ]),
  );
  return { id: "order-dashboard", steps };
}

// ---------------------------------------------------------------- rejection fixtures

const REJECT_URL = "reject-part.json";
const REJECT_PARENT = {
  version: 1,
  id: "reject-host",
  title: "効果関数の拒否",
  script: "reject-host.rhai",
  components: { rejectPart: { url: REJECT_URL } },
  state: { count: 0 },
  ui: {
    xtype: "container",
    items: [{ xtype: "rejectPart", itemId: "part" }],
  },
};
const REJECT_PARENT_SCRIPT = "fn init(s) { s }";
const REJECT_CHILD = {
  version: 1,
  id: "reject-part",
  title: "効果関数を呼ぶ部品",
  script: "reject-part.rhai",
  state: { value: 0 },
  ui: {
    xtype: "container",
    items: [
      { xtype: "metric", text: "値", bind: "value" },
      { xtype: "button", itemId: "fire", text: "呼ぶ", handler: "run" },
    ],
  },
};
// `Fn("http_get")` hides the name from the load-time walk, so the registered stub is what refuses
// -- the rejection is only guaranteed at run time. docs/components.md states this.
const REJECT_AT_RUNTIME =
  'fn init(s) { s } fn run(s, e) { let f = Fn("http_get"); f.call("x"); s.value = 1; s }';
// Written out, the same call is caught while the child compiles.
const REJECT_AT_LOAD = 'fn init(s) { s } fn run(s, e) { http_get("x"); s }';

function rejectSequences() {
  const parent = { pkg: REJECT_PARENT, script: REJECT_PARENT_SCRIPT };
  const bundleWith = (script) => ({
    [REJECT_URL]: { package: REJECT_CHILD, script },
  });
  const refused = ["http_get", "not available in components"];
  return [
    {
      id: "reject-at-runtime",
      steps: [
        loadStep("load", parent, bundleWith(REJECT_AT_RUNTIME), isOk),
        layoutStep("layout:800", 800, isOk),
        eventStep("event:part/fire", "part/fire", {}, (r) => isRefused(r, refused)),
        // A refused handler commits nothing, so the screen is exactly where it was.
        layoutStep("layout:800:after", 800, (r, ctx) => [
          ...isOk(r),
          ...equals(ctx.text("layout:800"), ctx.text("layout:800:after"), "拒否後の layout 応答"),
        ]),
      ],
    },
    {
      id: "reject-at-load",
      steps: [loadStep("load", parent, bundleWith(REJECT_AT_LOAD), (r) => isRefused(r, refused))],
    },
  ];
}

// ---------------------------------------------------------------- run

async function runSequence(module_, sequence) {
  const exports_ = (await WebAssembly.instantiate(module_, {})).exports;
  const texts = new Map();
  const records = [];
  for (const step of sequence.steps) {
    const text = raw(exports_, JSON.stringify(request(step.build())));
    texts.set(step.label, text);
    const response = parse(text);
    const problems = step.expect(response, { text: (label) => texts.get(label) }) ?? [];
    records.push({
      sequence: sequence.id,
      label: step.label,
      ok: Boolean(response?.ok),
      error: response?.ok ? undefined : response?.error,
      revision: response?.data?.revision,
      bytes: text.length,
      problems: problems.length ? problems : undefined,
    });
    for (const problem of problems) console.log(`FAIL ${sequence.id} ${step.label}: ${problem}`);
  }
  return records;
}

const options = parseArguments(process.argv.slice(2));
const started = Date.now();
const module_ = await WebAssembly.compile(readFileSync(options.candidate));
const sequences = [demoSequence(), ...rejectSequences()];
const records = [];
for (const sequence of sequences) records.push(...(await runSequence(module_, sequence)));

const problems = records.reduce((total, record) => total + (record.problems?.length ?? 0), 0);
const summary = {
  steps: records.length,
  problems,
  okResponses: records.filter((record) => record.ok).length,
  errorResponses: records.filter((record) => !record.ok).length,
  sequences: sequences.length,
  durationMs: Date.now() - started,
};
mkdirSync(dirname(options.evidence), { recursive: true });
writeFileSync(
  options.evidence,
  `${JSON.stringify({ candidate: options.candidate, clock: CLOCK, ...summary, records }, null, 2)}\n`,
);
console.log(JSON.stringify(summary));
process.exit(problems === 0 ? 0 : 1);
