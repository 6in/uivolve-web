// Candidate-only probe for component composition. The parity harness
// (scripts/compare-engine-behavior.mjs) skips every screen that declares `components`, because a
// base build from before composition cannot load one at all -- there is nothing to compare against.
// This script covers that gap by asserting the composed behavior of a single WASM directly: the
// shipped order-dashboard demo for the happy path, inline fixtures for the effect functions a
// child may now call and the tool surface it still may not publish, and the shipped parts-lab
// demo for the whole effect round trip -- every child effect naming its instance, every
// completion reaching the instance that asked for it, and every misaddressed completion being
// refused without moving the screen.
// usage: bun scripts/probe-composition.mjs --candidate <wasm> [--evidence <json>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageFormat, parsePackage } from "../src/package-format.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Same fixed clock as scripts/compare-engine-behavior.mjs, so both harnesses drive the same day.
const CLOCK = { nowMs: 1_759_800_000_000, tzOffsetMinutes: 540 };
// Completions run handlers too, so they get the same fixed clock as `load` and `event`.
const CLOCKED = new Set([
  "load",
  "event",
  "http_result",
  "storage_result",
  "file_result",
  "rpc_result",
  "dialog_result",
  "host_result",
  "host_progress",
]);
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
// A refused completion has to leave the screen exactly where it was, which the next layout of the
// same width says in full: byte-for-byte the same response as the layout before the refusal.
function sameText(context, label, reference) {
  const actual = context.text(label);
  const expected = context.text(reference);
  if (actual === expected) return [];
  return [
    `${label} の応答が ${reference} と一致しない（${actual?.length} / ${expected?.length} バイト）`,
  ];
}
// The one effect of `kind` the instance queued, so a step can both assert it and keep its id for
// the completion that follows.
function oneEffect(response, kind, instance) {
  const effects = response?.data?.effects ?? [];
  const found = effects.filter(
    (effect) => effect.kind === kind && (effect.instance ?? "") === instance,
  );
  if (found.length === 1) return { effect: found[0], problems: [] };
  return {
    problems: [
      `${kind} の effect（instance: ${JSON.stringify(instance)}）が ${found.length} 件: ${JSON.stringify(effects)}`,
    ],
  };
}
function capture(response, kind, instance, bag, key) {
  const { effect, problems } = oneEffect(response, kind, instance);
  if (effect) bag[key] = effect.id;
  return problems;
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
// Completions carry ids the earlier steps read off the effects, so the body is built when the step
// runs rather than when the sequence is assembled.
function opStep(label, build, expect) {
  return { label, expect, build };
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

// ---------------------------------------------------------------- effect fixtures

const EFFECT_URL = "effect-part.json";
const EFFECT_PARENT = {
  version: 1,
  id: "effect-host",
  title: "子の効果関数",
  script: "effect-host.rhai",
  components: { effectPart: { url: EFFECT_URL } },
  state: { count: 0 },
  ui: {
    xtype: "container",
    items: [{ xtype: "effectPart", itemId: "part" }],
  },
};
const EFFECT_PARENT_SCRIPT = "fn init(s) { s }";
const EFFECT_CHILD = {
  version: 1,
  id: "effect-part",
  title: "効果関数を呼ぶ部品",
  script: "effect-part.rhai",
  state: { value: 0 },
  requests: { load: { url: "d.json", handler: "done" } },
  ui: {
    xtype: "container",
    items: [
      { xtype: "metric", text: "値", bind: "value" },
      { xtype: "button", itemId: "fire", text: "呼ぶ", handler: "run" },
    ],
  },
};
const DONE = "fn done(s, r) { s }";
// Written out, the call used to be caught while the child compiled; now the child declares the
// request and queues it like a root does.
const CALL_AT_LOAD = `fn init(s) { s } ${DONE} fn run(s, e) { http_get("load"); s.value = 1; s }`;
// `Fn("http_get")` hid the name from the load-time walk, so a stub had to refuse at run time.
const CALL_THROUGH_A_POINTER = `fn init(s) { s } ${DONE} fn run(s, e) { let f = Fn("http_get"); f.call("load"); s.value = 1; s }`;
// A dialog is screen-wide, so the effect the host receives says which instance asked for it.
const ASK_FOR_A_DIALOG = `fn init(s) { s } ${DONE} fn run(s, e) { alert("こんにちは"); s }`;
// A child describes itself for the tool surface too, so the load goes through. What the child
// then publishes is the next task's column.
const CHILD_WITH_WEBMCP = { ...EFFECT_CHILD, webmcp: { description: "部品" } };

function dialogEffect(response, instance) {
  const effects = response?.data?.effects ?? [];
  const dialog = effects.find((effect) => effect.kind === "dialog");
  if (dialog === undefined) return [`dialog の effect が無い: ${JSON.stringify(effects)}`];
  return equals(dialog.instance, instance, "dialog effect の instance");
}

function effectSequences() {
  const parent = { pkg: EFFECT_PARENT, script: EFFECT_PARENT_SCRIPT };
  const bundleWith = (script, pkg = EFFECT_CHILD) => ({ [EFFECT_URL]: { package: pkg, script } });
  const queues = (script) => ({
    id: script === CALL_AT_LOAD ? "child-effect-written-out" : "child-effect-through-a-pointer",
    steps: [
      loadStep("load", parent, bundleWith(script), isOk),
      layoutStep("layout:800", 800, isOk),
      // The handler runs to the end instead of being refused, so the child moves.
      eventStep("event:part/fire", "part/fire", {}, (r) => [
        ...isOk(r),
        ...equals(r.data?.revision, 1, "revision"),
      ]),
      layoutStep("layout:800:after", 800, isOk),
    ],
  });
  return [
    queues(CALL_AT_LOAD),
    queues(CALL_THROUGH_A_POINTER),
    {
      id: "child-dialog-carries-its-instance",
      steps: [
        loadStep("load", parent, bundleWith(ASK_FOR_A_DIALOG), isOk),
        eventStep("event:part/fire", "part/fire", {}, (r) => [
          ...isOk(r),
          ...dialogEffect(r, "part"),
        ]),
      ],
    },
    {
      id: "child-webmcp-refused",
      steps: [loadStep("load", parent, bundleWith(CALL_AT_LOAD, CHILD_WITH_WEBMCP), isOk)],
    },
  ];
}

// ---------------------------------------------------------------- parts-lab

const LAB_PARENT = "parts-lab.json";
// The declared urls, which the bundle has to be keyed by.
const LAB_CHILDREN = {
  products: "http-grid.json",
  note: "parts/note-pad.json",
  approval: "parts/approval.json",
};
const LAB_KEYS = ["products/productsGrid:header", "note/text", "approval/ask"];
const PRODUCTS = [{ id: 1, name: "x", price: 1, stock: 1 }];
// One byte past the ABI limit, so the request is refused before anything is parsed.
const OVER_2MB = "x".repeat(2_000_001);

function labKeys(response) {
  const keys = widgetKeys(response);
  const problems = [];
  if (new Set(keys).size !== keys.length) problems.push(`key が重複している: ${keys.length} 件`);
  for (const key of LAB_KEYS) if (!keys.includes(key)) problems.push(`key ${key} が無い`);
  return problems;
}
function labRows(response) {
  return widgetKeys(response).filter((key) => key.startsWith("products/productsGrid:row:")).length;
}
// Every way of addressing a completion at the wrong instance, each one refused with its own
// message and each one leaving the screen untouched.
function misaddressed(ids) {
  return [
    {
      label: "http_result:instance-omitted",
      body: () => ({ op: "http_result", id: ids.products, ok: true, data: PRODUCTS }),
      error: "Unknown or completed HTTP request",
    },
    {
      label: "http_result:instance-unknown",
      body: () => ({
        op: "http_result",
        id: ids.products,
        instance: "nope",
        ok: true,
        data: PRODUCTS,
      }),
      error: "Unknown component instance: nope",
    },
    {
      label: "http_result:instance-empty",
      body: () => ({ op: "http_result", id: ids.products, instance: "", ok: true, data: PRODUCTS }),
      error: "Invalid component instance",
    },
    {
      label: "http_result:instance-null",
      body: () => ({
        op: "http_result",
        id: ids.products,
        instance: null,
        ok: true,
        data: PRODUCTS,
      }),
      error: "Invalid component instance",
    },
    {
      label: "http_result:consumed",
      body: () => ({
        op: "http_result",
        id: ids.products,
        instance: "products",
        ok: true,
        data: PRODUCTS,
      }),
      error: "Component products: Unknown or completed HTTP request",
    },
  ];
}

// The shipped parts-lab demo: three parts that each queue their own effects and are each handed
// their own completions back.
function partsLabSequence() {
  const parent = readPackage(LAB_PARENT);
  const bundle = {};
  for (const [name, url] of Object.entries(LAB_CHILDREN)) {
    const declared = parent.pkg.components?.[name]?.url;
    if (declared !== url)
      fail(`${LAB_PARENT} の ${name} が ${url} を宣言していません: ${JSON.stringify(declared)}`);
    const child = readPackage(url);
    bundle[url] = { package: child.pkg, script: child.script };
  }
  // Ids and revisions the later steps read, filled in by the steps that see them first.
  const ids = {};
  const steps = [
    // The memo part reads its own storage in `init`, so the load already carries a child effect.
    loadStep("load", parent, bundle, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 0, "revision"),
      ...capture(r, "storage", "note", ids, "memoRead"),
    ]),
    layoutStep("layout:800", 800, (r) => [...isOk(r), ...labKeys(r)]),
    eventStep("event:products/loadProducts", "products/loadProducts", {}, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 1, "revision"),
      ...capture(r, "http", "products", ids, "products"),
    ]),
    opStep(
      "http_result:products",
      () => ({
        op: "http_result",
        id: ids.products,
        instance: "products",
        ok: true,
        data: PRODUCTS,
      }),
      (r) => [...isOk(r), ...equals(r.data?.revision, 2, "revision")],
    ),
    layoutStep("layout:800:rows", 800, (r) => [
      ...isOk(r),
      ...labKeys(r),
      ...equals(labRows(r), PRODUCTS.length, "products/productsGrid:row:* の件数"),
    ]),
  ];
  for (const bad of misaddressed(ids)) {
    const after = `${bad.label}:layout`;
    steps.push(
      opStep(bad.label, bad.body, (r) => isRefused(r, [bad.error])),
      layoutStep(after, 800, (r, context) => [
        ...isOk(r),
        ...sameText(context, after, "layout:800:rows"),
      ]),
    );
  }
  steps.push(
    // The read `init` queued has to land before the part may queue the write of the same name.
    opStep(
      "storage_result:note:init",
      () => ({
        op: "storage_result",
        id: ids.memoRead,
        instance: "note",
        ok: true,
        data: null,
      }),
      isOk,
    ),
    // The memo part saves into its own scope and tells the parent only that it is done.
    eventStep("event:note/text", "note/text", { value: "打ち合わせ" }, isOk),
    eventStep("event:note/save", "note/save", {}, (r) => {
      ids.saved = r?.data?.revision;
      return [...isOk(r), ...capture(r, "storage", "note", ids, "memoWrite")];
    }),
    opStep(
      "storage_result:note",
      () => ({
        op: "storage_result",
        id: ids.memoWrite,
        instance: "note",
        ok: true,
        data: null,
      }),
      (r) => [
        ...isOk(r),
        ...equals(r.data?.revision, ids.saved + 1, "revision"),
        ...hasAll(r.data?.state?.notice, ["メモを保存しました", "打ち合わせ"], "state.notice"),
      ],
    ),
    // A dialog is screen-wide: the effect names the part that asked, and the answer runs there.
    eventStep("event:approval/ask", "approval/ask", {}, (r) => [
      ...isOk(r),
      ...capture(r, "dialog", "approval", ids, "dialog"),
    ]),
    opStep(
      "event::dialog:ok",
      () => ({ op: "event", target: `:dialog:${ids.dialog}:ok`, payload: {} }),
      (r) => [...isOk(r), ...hasAll(r.data?.state?.notice, ["承認されました"], "state.notice")],
    ),
    eventStep("event:approval/ask:again", "approval/ask", {}, (r) => [
      ...isOk(r),
      ...capture(r, "dialog", "approval", ids, "dialogAgain"),
    ]),
    layoutStep("layout:800:asked", 800, (r) => [...isOk(r), ...labKeys(r)]),
    // Naming the wrong instance may not swallow somebody else's dialog, so it stays pending.
    opStep(
      "dialog_result:instance-omitted",
      () => ({ op: "dialog_result", id: ids.dialogAgain, ok: true, data: true }),
      (r) => isRefused(r, ["Unknown or completed dialog request"]),
    ),
    layoutStep("layout:800:asked:after", 800, (r, context) => [
      ...isOk(r),
      ...sameText(context, "layout:800:asked:after", "layout:800:asked"),
    ]),
    opStep(
      "dialog_result:approval",
      () => ({
        op: "dialog_result",
        id: ids.dialogAgain,
        instance: "approval",
        ok: true,
        data: true,
      }),
      (r) => [...isOk(r), ...hasAll(r.data?.state?.notice, ["承認されました"], "state.notice")],
    ),
    layoutStep("layout:800:approved", 800, (r) => [...isOk(r), ...labKeys(r)]),
    opStep(
      "http_result:over-2mb",
      () => ({
        op: "http_result",
        id: ids.products,
        instance: "products",
        ok: true,
        data: OVER_2MB,
      }),
      (r) => isRefused(r, ["Request exceeds 2 MB"]),
    ),
    layoutStep("layout:800:over-2mb:after", 800, (r, context) => [
      ...isOk(r),
      ...sameText(context, "layout:800:over-2mb:after", "layout:800:approved"),
    ]),
    // A completion that arrives after the screen was replaced belongs to nobody.
    eventStep("event:products/loadProducts:again", "products/loadProducts", {}, (r) => [
      ...isOk(r),
      ...capture(r, "http", "products", ids, "stale"),
    ]),
    loadStep("load:reloaded", parent, bundle, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 0, "revision"),
    ]),
    layoutStep("layout:800:reloaded", 800, (r) => [...isOk(r), ...labKeys(r)]),
    opStep(
      "http_result:stale",
      () => ({ op: "http_result", id: ids.stale, instance: "products", ok: true, data: PRODUCTS }),
      (r) => isRefused(r, ["Component products: Unknown or completed HTTP request"]),
    ),
    layoutStep("layout:800:reloaded:after", 800, (r, context) => [
      ...isOk(r),
      ...sameText(context, "layout:800:reloaded:after", "layout:800:reloaded"),
    ]),
    // The refusal left the reloaded screen at revision 0, which the next event says out loud.
    eventStep("event:products/loadProducts:reloaded", "products/loadProducts", {}, (r) => [
      ...isOk(r),
      ...equals(r.data?.revision, 1, "revision"),
    ]),
  );
  return { id: "parts-lab", steps };
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
const sequences = [demoSequence(), ...effectSequences(), partsLabSequence()];
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
