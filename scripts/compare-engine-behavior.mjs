// Behavior parity harness: replays one fixed request plan against two engine WASM builds and
// counts response diffs. The verdict comes only from response JSON string equality -- the WASM
// files themselves are never hashed or byte-compared.
// usage: bun scripts/compare-engine-behavior.mjs --base <wasm> --candidate <wasm> [--evidence <json>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageFormat, parsePackage } from "../src/package-format.js";
import { SCREEN_CATALOG, screenFile } from "../src/screen-catalog.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOCK = { nowMs: 1_759_800_000_000, tzOffsetMinutes: 540 };
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
const TRUNCATE = 120;

// ---------------------------------------------------------------- CLI

function parseArguments(argv) {
  const options = { evidence: "target/engine-compare/compare.json" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--base", "--candidate", "--evidence"].includes(flag) || value === undefined)
      fail(`不正な引数です: ${flag ?? ""}`);
    options[flag.slice(2)] = value;
  }
  if (!options.base || !options.candidate)
    fail("--base <wasm> と --candidate <wasm> は両方必須です");
  for (const key of ["base", "candidate"]) {
    options[key] = resolve(root, options[key]);
    if (!existsSync(options[key])) fail(`WASMが見つかりません: ${options[key]}`);
  }
  options.evidence = resolve(root, options.evidence);
  return options;
}
function fail(message) {
  console.error(`${message}
usage: bun scripts/compare-engine-behavior.mjs --base <wasm> --candidate <wasm> [--evidence <json>]`);
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
function storeBuffer(exports_, bytes) {
  const pointer = exports_.input_alloc(bytes.length);
  try {
    new Uint8Array(exports_.memory.buffer, pointer, bytes.length).set(bytes);
    return exports_.buffer_store(pointer, bytes.length);
  } finally {
    exports_.input_free(pointer, bytes.length);
  }
}

// ---------------------------------------------------------------- request helpers

function request(body) {
  return CLOCKED.has(body.op) ? { ...body, clock: CLOCK } : body;
}
function effectsOf(response) {
  return response?.data?.effects ?? [];
}
// `kind` is absent on HTTP effects (engine/src/http.rs), present on every other channel.
function matches(effect, kind) {
  return kind === "http" ? effect.kind === undefined : effect.kind === kind;
}
function effectId(response, kind) {
  const hit = effectsOf(response).find((effect) => matches(effect, kind));
  if (hit === undefined) throw new Error(`${kind} の effect が見つかりません`);
  return hit.id;
}
// Newest effect of that kind anywhere in the sequence so far. A handler that leaves state
// untouched emits no effect, so the live request id can predate the previous step.
function latestEffect(responses, kind) {
  for (let i = responses.length - 1; i >= 0; i--) {
    const hit = effectsOf(responses[i]).find((effect) => matches(effect, kind));
    if (hit !== undefined) return hit;
  }
  throw new Error(`${kind} の effect が見つかりません`);
}
const layoutStep = (label, width) => ({ label, build: () => ({ op: "layout", width }) });
const eventStep = (label, target, payload = {}) => ({
  label,
  build: () => ({ op: "event", target, payload }),
});

// ---------------------------------------------------------------- screens & fixtures

const DESCRIPTOR_BYTES = new Uint8Array(readFileSync(`${root}/public/screens/rpc-demo.pb`));
const FOUR_BYTES = new Uint8Array([0, 127, 128, 255]);

function readScreen(id) {
  const file = screenFile(id);
  const pkg = parsePackage(
    readFileSync(`${root}/public/screens/${file}`, "utf8"),
    packageFormat(file),
  );
  return {
    pkg,
    script: readFileSync(`${root}/public/screens/${pkg.script}`, "utf8"),
    descriptors: [...new Set(Object.values(pkg.rpc ?? {}).map((entry) => entry.descriptor))],
  };
}
function readFixture(name) {
  const pkg = parsePackage(readFileSync(`${root}/tests/browser/${name}.json`, "utf8"), "json");
  return {
    pkg,
    script: readFileSync(`${root}/tests/browser/${pkg.script}`, "utf8"),
    descriptors: [],
  };
}
function loadStep(label, screen) {
  return {
    label,
    build: (ctx) => {
      const body = { op: "load", package: screen.pkg, script: screen.script };
      if (screen.descriptors.length) {
        body.descriptors = {};
        for (const name of screen.descriptors) body.descriptors[name] = ctx.store(DESCRIPTOR_BYTES);
      }
      return body;
    },
  };
}
function inline(pkg, script) {
  return { pkg, script, descriptors: [] };
}

// Nodes carrying both `handler` and `itemId` in the raw (pre-normalization) package tree.
function handlerNodes(node, found = []) {
  if (node?.handler && node?.itemId) found.push(node);
  for (const child of node?.items ?? []) handlerNodes(child, found);
  return found;
}
function payloadFor(node) {
  switch (node.xtype) {
    case "textfield":
    case "textarea":
    case "textareafield":
    case "combobox":
    case "combo":
      return { value: "x" };
    case "numberfield":
    case "slider":
    case "sliderfield":
      return { value: 1 };
    case "checkbox":
    case "checkboxfield":
      return { value: true };
    case "panel":
      return node.collapsedBind ? { action: "toggle" } : {};
    case "window":
    case "messagebox":
      return { action: "close" };
    case "grid":
    case "gridpanel": {
      const column = node.columns?.[0]?.dataIndex;
      return column ? { action: "sort", column } : {};
    }
    default:
      return {};
  }
}
// load -> layout 240/800/4096 -> (event, layout 800) per handler node.
function baseSteps(screen) {
  const steps = [loadStep("load", screen)];
  for (const width of [240, 800, 4096]) steps.push(layoutStep(`layout:${width}`, width));
  for (const node of handlerNodes(screen.pkg.ui)) {
    steps.push(eventStep(`event:${node.itemId}`, node.itemId, payloadFor(node)));
    steps.push(layoutStep(`layout:800:${node.itemId}`, 800));
  }
  return steps;
}

// ---------------------------------------------------------------- inline fixtures

const ABI_SCREEN = {
  version: 1,
  id: "abi",
  title: "ABI 日本語",
  script: "abi.rhai",
  state: { count: 0 },
  ui: {
    xtype: "container",
    items: [
      { xtype: "metric", text: "件数", bind: "count" },
      { xtype: "button", itemId: "add", text: "増やす", handler: "add" },
    ],
  },
};
const ABI_SCRIPT = "fn init(s) { s } fn add(s,e) { s.count+=1; s }";
const PROGRESS_SCREEN = {
  ...ABI_SCREEN,
  operations: {
    transfer: {
      connection: "api",
      action: "http.download",
      handler: "done",
      options: { progressHandler: "progress" },
    },
  },
};
const PROGRESS_SCRIPT =
  'fn init(s){host_call("transfer", #{});s} fn add(s,e){s} fn done(s,r){s.count+=10;s} fn progress(s,p){s.count+=1;s}';
const NAVIGATE_SCREEN = {
  version: 1,
  id: "navigate-combo",
  title: "遷移と他の効果",
  script: "navigate-combo.rhai",
  pages: { detail: { url: "page-navigation-detail.yaml" } },
  state: { count: 0 },
  ui: {
    xtype: "container",
    items: [{ xtype: "button", itemId: "combine", text: "combine", handler: "combine" }],
  },
};
const NAVIGATE_SCRIPT =
  'fn init(s){s} fn combine(s,e){navigate("detail"); alert("x","done"); s} fn done(s,r){s}';
const ROLLBACK_SCREEN = {
  version: 1,
  id: "rollback",
  title: "ロールバック",
  script: "rollback.rhai",
  state: { count: 0, query: "" },
  ui: {
    xtype: "container",
    items: [
      { xtype: "button", itemId: "add", text: "add", handler: "add" },
      { xtype: "button", itemId: "fail", text: "fail", handler: "fail" },
    ],
  },
};
const ROLLBACK_BASE = "fn init(s){s} fn add(s,e){s.count+=1;s}";
const ROLLBACK_LOOP = `${ROLLBACK_BASE} fn fail(s,e){s.query="bad"; while true {} s}`;
const ROLLBACK_THROW = `${ROLLBACK_BASE} fn fail(s,e){s.query="bad"; throw "bad"; s}`;

// ---------------------------------------------------------------- plan

function buildPlan() {
  const plan = [];
  for (const entry of SCREEN_CATALOG)
    plan.push({ id: entry.id, steps: baseSteps(readScreen(entry.id)) });
  for (const name of ["edit", "states", "surface", "text"]) {
    const id = `font-parity-${name}`;
    plan.push({ id, steps: baseSteps(readFixture(id)) });
  }

  const dialogs = readScreen("dialogs");
  // dialogs::SEQUENCE の id 採番が load をまたいで継続することを確かめる。
  plan.push({
    id: "reload",
    steps: [
      ...baseSteps(dialogs),
      loadStep("reload:load", dialogs),
      eventStep("reload:event:showAlert", "showAlert"),
      layoutStep("reload:layout:800", 800),
    ],
  });
  plan.push({
    id: "dialog-confirm-ok",
    steps: [
      loadStep("load", dialogs),
      eventStep("event:showConfirm", "showConfirm"),
      {
        label: "event:dialog:ok",
        build: (ctx) => ({
          op: "event",
          target: `:dialog:${effectId(ctx.prev, "dialog")}:ok`,
          payload: {},
        }),
      },
      layoutStep("layout:800", 800),
    ],
  });
  plan.push({
    id: "dialog-prompt-input",
    steps: [
      loadStep("load", dialogs),
      eventStep("event:showPrompt", "showPrompt"),
      {
        label: "event:dialog:input",
        build: (ctx) => ({
          op: "event",
          target: `:dialog:${effectId(ctx.prev, "dialog")}:input`,
          payload: { value: "x" },
        }),
      },
      {
        label: "event:dialog:ok",
        build: (ctx) => ({
          op: "event",
          target: `:dialog:${effectId(ctx.at("event:showPrompt"), "dialog")}:ok`,
          payload: {},
        }),
      },
    ],
  });
  plan.push({
    id: "dialog-result-op",
    steps: [
      loadStep("load", dialogs),
      eventStep("event:showAlert", "showAlert"),
      {
        label: "dialog_result:ok",
        build: (ctx) => ({
          op: "dialog_result",
          id: effectId(ctx.prev, "dialog"),
          ok: true,
          data: null,
        }),
      },
    ],
  });

  const httpGrid = readScreen("http-grid");
  plan.push({
    id: "http-result",
    steps: [
      loadStep("load", httpGrid),
      eventStep("event:loadProducts", "loadProducts"),
      {
        label: "http_result:ok",
        build: (ctx) => ({
          op: "http_result",
          id: ctx.latest("http").id,
          ok: true,
          data: [{ id: 1, name: "x", price: 1 }],
        }),
      },
      {
        label: "http_result:consumed-id",
        build: (ctx) => ({
          op: "http_result",
          id: effectId(ctx.at("event:loadProducts"), "http"),
          ok: true,
          data: [{ id: 1, name: "x", price: 1 }],
        }),
      },
      eventStep("event:loadProducts:2", "loadProducts"),
      {
        label: "http_result:failed",
        build: (ctx) => ({
          op: "http_result",
          id: ctx.latest("http").id,
          ok: false,
          error: "boom",
        }),
      },
    ],
  });

  const storageLab = readScreen("storage-lab");
  const storageResult = (label, data) => ({
    label,
    build: (ctx) => ({
      op: "storage_result",
      id: ctx.latest("storage").id,
      ok: true,
      data,
    }),
  });
  plan.push({
    id: "storage-result",
    steps: [
      loadStep("load", storageLab),
      eventStep("event:saveProfile", "saveProfile"),
      storageResult("storage_result:write", null),
      eventStep("event:restoreProfile", "restoreProfile"),
      storageResult("storage_result:read", { name: "x", age: 1 }),
      eventStep("event:removeProfile", "removeProfile"),
      storageResult("storage_result:remove", null),
    ],
  });

  const fileLab = readScreen("file-lab");
  plan.push({
    id: "file-result",
    steps: [
      loadStep("load", fileLab),
      eventStep("event:save", "save"),
      {
        label: "file_result:write",
        build: (ctx) => ({ op: "file_result", id: ctx.latest("file").id, ok: true, data: null }),
      },
      eventStep("event:binaryRead", "binaryRead"),
      {
        label: "file_result:bytes",
        build: (ctx) => ({
          op: "file_result",
          id: ctx.latest("file").id,
          ok: true,
          buffer: ctx.store(FOUR_BYTES),
        }),
      },
      eventStep("event:binaryRead:2", "binaryRead"),
      // engine/src/abi.rs:70 -- 失敗完了はバイナリバッファを運べない。
      {
        label: "file_result:failed-with-buffer",
        build: (ctx) => ({
          op: "file_result",
          id: ctx.latest("file").id,
          ok: false,
          error: "x",
          buffer: ctx.store(FOUR_BYTES),
        }),
      },
      // 拒否された失敗完了のあとも read_bytes は保留のまま。成功完了で state を動かしてから
      // list を投げる -- 変化しない state は commit されず effect も出ないため。
      {
        label: "file_result:bytes:2",
        build: (ctx) => ({
          op: "file_result",
          id: ctx.latest("file").id,
          ok: true,
          buffer: ctx.store(FOUR_BYTES),
        }),
      },
      eventStep("event:list", "list"),
      {
        label: "file_result:list",
        build: (ctx) => ({ op: "file_result", id: ctx.latest("file").id, ok: true, data: [] }),
      },
    ],
  });

  const rpcLab = readScreen("rpc-lab");
  plan.push({
    id: "rpc-result",
    steps: [
      loadStep("load", rpcLab),
      eventStep("event:connect", "connect"),
      {
        label: "rpc_result:ok",
        build: (ctx) => ({
          op: "rpc_result",
          id: ctx.latest("rpc").id,
          ok: true,
          buffer: ctx.store(FOUR_BYTES),
        }),
      },
      eventStep("event:connect:2", "connect"),
      {
        label: "rpc_result:failed",
        build: (ctx) => ({
          op: "rpc_result",
          id: ctx.latest("rpc").id,
          ok: false,
          error: "x",
        }),
      },
    ],
  });

  const workerOrders = readScreen("worker-orders");
  plan.push({
    id: "host-result",
    steps: [
      loadStep("load", workerOrders),
      // `listed` が通る形の body を返して state を動かす。空の data だと handler がロールバックし、
      // refreshOrders の state が変化せず host effect も出ないため。
      {
        label: "host_result:load",
        build: (ctx) => ({
          op: "host_result",
          id: ctx.latest("host").id,
          ok: true,
          data: { body: [] },
          error: null,
        }),
      },
      eventStep("event:refreshOrders", "refreshOrders"),
      // listOrders には progressHandler が無い。保留中の id に進捗を送って拒否を見る。
      {
        label: "host_progress:no-progress-handler",
        build: (ctx) => {
          const effect = ctx.latest("host");
          return {
            op: "host_progress",
            id: effect.id,
            data: { operation: effect.operation, transferred: 0, total: null },
          };
        },
      },
      {
        label: "host_result:refresh",
        build: (ctx) => ({
          op: "host_result",
          id: ctx.latest("host").id,
          ok: true,
          data: { body: [] },
          error: null,
        }),
      },
    ],
  });

  const progress = { operation: "transfer", transferred: 0, total: 0 };
  plan.push({
    id: "host-progress",
    steps: [
      loadStep("load", inline(PROGRESS_SCREEN, PROGRESS_SCRIPT)),
      { label: "host_progress:missing-id", build: () => ({ op: "host_progress" }) },
      { label: "host_progress:missing-data", build: () => ({ op: "host_progress", id: 1 }) },
      {
        label: "host_progress:other-operation",
        build: () => ({
          op: "host_progress",
          id: 1,
          data: { operation: "other", transferred: 0, total: null },
        }),
      },
      {
        label: "host_progress:valid",
        build: () => ({ op: "host_progress", id: 1, data: progress }),
      },
      {
        label: "host_result",
        build: () => ({ op: "host_result", id: 1, ok: true, data: null, error: null }),
      },
      {
        label: "host_progress:consumed-id",
        build: () => ({ op: "host_progress", id: 1, data: progress }),
      },
    ],
  });

  plan.push({
    id: "navigate",
    steps: [
      loadStep("load", readScreen("page-navigation")),
      eventStep("event:openDetails", "openDetails"),
      loadStep("combined:load", inline(NAVIGATE_SCREEN, NAVIGATE_SCRIPT)),
      eventStep("combined:event:combine", "combine"),
    ],
  });

  plan.push({
    id: "rollback",
    steps: [
      loadStep("load", inline(ROLLBACK_SCREEN, ROLLBACK_LOOP)),
      eventStep("event:fail", "fail"),
      layoutStep("layout:800", 800),
      eventStep("event:add", "add"),
      loadStep("throw:load", inline(ROLLBACK_SCREEN, ROLLBACK_THROW)),
      eventStep("throw:event:fail", "fail"),
      layoutStep("throw:layout:800", 800),
      eventStep("throw:event:add", "add"),
    ],
  });

  plan.push({
    id: "failed-load-keeps-previous",
    steps: [
      loadStep("load", inline(ABI_SCREEN, ABI_SCRIPT)),
      eventStep("event:add", "add"),
      loadStep("broken:load", inline(ABI_SCREEN, 'fn init(s){throw "failed";s} fn add(s,e){s}')),
      eventStep("event:add:2", "add"),
    ],
  });

  plan.push({
    id: "theme",
    steps: [
      loadStep("load", inline(ABI_SCREEN, ABI_SCRIPT)),
      { label: "theme:dark", build: () => ({ op: "theme", theme: { version: 1, mode: "dark" } }) },
      layoutStep("layout:800", 800),
      {
        label: "theme:malformed",
        build: () => ({
          op: "theme",
          theme: { version: 1, mode: "dark", colors: { text: "invalid" } },
        }),
      },
      layoutStep("layout:800:2", 800),
    ],
  });

  plan.push({
    id: "abi-errors",
    steps: [
      eventStep("event:no-screen", "x"),
      layoutStep("layout:no-screen", 800),
      { label: "empty-request", build: () => ({}) },
      { label: "unknown-op", build: () => ({ op: "nope" }) },
      loadStep("load", inline(ABI_SCREEN, ABI_SCRIPT)),
      layoutStep("layout:100", 100),
      eventStep("event:unknown-target", "nope"),
    ],
  });

  return plan;
}

// ---------------------------------------------------------------- runs

// The base run resolves every dynamic id and records the exact request text plus the ordered
// buffer_store payloads. The candidate run replays that identical text, so any divergence in
// buffer ids also shows up as a response diff.
async function runBase(wasmPath, plan) {
  const module_ = await WebAssembly.compile(readFileSync(wasmPath));
  const records = [];
  for (const sequence of plan) {
    const exports_ = (await WebAssembly.instantiate(module_, {})).exports;
    const seen = new Map();
    const parsed = [];
    for (const step of sequence.steps) {
      step.allocations = [];
      const body = step.build({
        prev: parsed.at(-1) ?? null,
        at: (label) => seen.get(label),
        latest: (kind) => latestEffect(parsed, kind),
        store: (bytes) => {
          step.allocations.push(bytes);
          return storeBuffer(exports_, bytes);
        },
      });
      step.text = JSON.stringify(request(body));
      const response = raw(exports_, step.text);
      seen.set(step.label, parse(response));
      parsed.push(parse(response));
      records.push({ sequence: sequence.id, label: step.label, response });
    }
  }
  return records;
}
async function runCandidate(wasmPath, plan) {
  const module_ = await WebAssembly.compile(readFileSync(wasmPath));
  const records = [];
  for (const sequence of plan) {
    const exports_ = (await WebAssembly.instantiate(module_, {})).exports;
    for (const step of sequence.steps) {
      for (const bytes of step.allocations) storeBuffer(exports_, bytes);
      records.push({
        sequence: sequence.id,
        label: step.label,
        response: raw(exports_, step.text),
      });
    }
  }
  return records;
}
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- diffing

// First differing JSON path, e.g. `data.widgets[3].x`. null when the values are deep-equal.
function firstDiffPath(a, b, path = "") {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const hit = firstDiffPath(a[i], b[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return a.length === b.length ? null : `${path}[${Math.min(a.length, b.length)}]`;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))]) {
      const hit = firstDiffPath(a[key], b[key], path ? `${path}.${key}` : key);
      if (hit !== null) return hit;
    }
    return null;
  }
  return a === b ? null : path || "(root)";
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function valueAt(text, path) {
  const parsed = parse(text);
  if (parsed === null || path === "(root)" || path === "") return truncate(text);
  let current = parsed;
  for (const token of path.matchAll(/[^.[\]]+/g)) {
    if (current === undefined || current === null) break;
    current = current[token[0]];
  }
  return truncate(current === undefined ? "(absent)" : JSON.stringify(current));
}
function truncate(text) {
  return text.length > TRUNCATE ? `${text.slice(0, TRUNCATE)}…` : text;
}

// ---------------------------------------------------------------- main

const options = parseArguments(process.argv.slice(2));
const started = Date.now();
const plan = buildPlan();
const base = await runBase(options.base, plan);
const candidate = await runCandidate(options.candidate, plan);

let diffs = 0;
let okResponses = 0;
let errorResponses = 0;
const records = [];
for (let i = 0; i < base.length; i++) {
  const left = base[i];
  const right = candidate[i];
  const same = left.response === right.response;
  const parsed = parse(left.response);
  if (parsed?.ok) okResponses++;
  else errorResponses++;
  if (!same) {
    diffs++;
    const path = firstDiffPath(parsed, parse(right.response)) ?? "(raw-text)";
    console.log(`DIFF ${left.sequence} ${left.label} ${path}`);
    console.log(`  base:      ${valueAt(left.response, path)}`);
    console.log(`  candidate: ${valueAt(right.response, path)}`);
  }
  records.push({
    sequence: left.sequence,
    label: left.label,
    ok: Boolean(parsed?.ok),
    error: parsed?.ok ? undefined : parsed?.error,
    same,
    bytes: left.response.length,
  });
}

const summary = {
  steps: base.length,
  diffs,
  okResponses,
  errorResponses,
  sequences: plan.length,
  durationMs: Date.now() - started,
};
mkdirSync(dirname(options.evidence), { recursive: true });
writeFileSync(
  options.evidence,
  `${JSON.stringify({ base: options.base, candidate: options.candidate, clock: CLOCK, ...summary, records }, null, 2)}\n`,
);
console.log(JSON.stringify(summary));
process.exit(diffs === 0 ? 0 : 1);
