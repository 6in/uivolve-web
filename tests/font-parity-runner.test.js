import { beforeAll, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  KIND_NO_TEXT,
  SUITES,
  STATE_CONTRACT,
  XTYPE_ALIASES,
  XTYPE_PROBE_STATE,
  XTYPE_RENDER_EXEMPT,
  XTYPE_SHAPES,
  canonicalXtype,
  engineXtypes,
  kindOwner,
  selectSuites,
  shapeLabel,
  stateTableProblems,
  xtypeTableProblems,
} from "./browser/font-parity.mjs";
import { WasmEngine } from "../src/engine.js";
import { STEPS, runSteps } from "../scripts/verify-font-parity.mjs";
import { parseArguments } from "../scripts/test-font-parity-browser.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runner = (args) =>
  spawnSync("bun", ["scripts/test-font-parity-browser.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
const silent = () => {};

it("keeps the final gate in the planned order and leaves the pre-fix baseline out of it", () => {
  expect(STEPS.map((step) => step.label)).toEqual([
    "build:wasm",
    "vitest",
    "test:rust",
    "check",
    "docs:check",
    "build",
    "build:runtime",
    "build:minimal",
    "font-parity:roles",
    "font-parity:editing",
    "font-parity:surfaces",
    "font-parity:lifecycle",
    "font-parity:matrix",
    "font-parity:distribution",
  ]);
  // Every registered suite except the baseline ledger is part of the gate.
  const gated = STEPS.filter((step) => step.label.startsWith("font-parity:")).map((step) =>
    step.label.slice("font-parity:".length),
  );
  expect(gated).toEqual(SUITES.filter((suite) => suite.name !== "baseline").map((s) => s.name));
});

it("runs gate steps in order and reports each exit code", async () => {
  const step = (label, code) => ({
    label,
    command: "bun",
    args: ["-e", `process.exit(${code})`],
  });
  const results = await runSteps([step("first", 0), step("second", 0)], { log: silent });
  expect(results).toEqual([
    { label: "first", code: 0, signal: null },
    { label: "second", code: 0, signal: null },
  ]);
});

it("stops the gate at the first failing step and propagates the failure", async () => {
  const labels = [];
  const step = (label, code) => ({
    label,
    command: "bun",
    args: ["-e", `process.exit(${code})`],
  });
  await expect(
    runSteps([step("ok", 0), step("broken", 3), step("never", 0)], {
      log: (line) => labels.push(line),
    }),
  ).rejects.toThrow("broken failed (exit 3)");
  expect(labels.some((line) => line.includes("never"))).toBe(false);
});

it("reports a missing executable instead of treating the step as a pass", async () => {
  await expect(
    runSteps([{ label: "absent", command: "uivolve-no-such-binary", args: [] }], { log: silent }),
  ).rejects.toThrow(/ENOENT|no-such-binary/);
});

it("refuses suites that do not exist", () => {
  expect(() => selectSuites(["baseline", "nope"])).toThrow('Unknown suite "nope"');
  expect(() => selectSuites([])).toThrow("at least one --suite");
});

it("refuses suites a later task still owns rather than skipping them", () => {
  for (const suite of SUITES.filter((entry) => !entry.run))
    expect(() => selectSuites([suite.name])).toThrow(
      `Suite "${suite.name}" is not implemented yet (owner ${suite.owner})`,
    );
  expect(selectSuites(["baseline"]).map((suite) => suite.name)).toEqual(["baseline"]);
});

it("requires exactly one browser route and a well-formed viewport", () => {
  expect(parseArguments(["--suite", "baseline", "--viewport", "390x844"]).viewport).toEqual({
    width: 390,
    height: 844,
  });
  expect(() =>
    parseArguments(["--browser-path", "/usr/bin/chromium-browser", "--browser-endpoint", "ws://x"]),
  ).toThrow("not both");
  expect(() => parseArguments(["--viewport", "wide"])).toThrow("WIDTHxHEIGHT");
  expect(() => parseArguments(["--suite"])).toThrow("needs a value");
  expect(() => parseArguments(["--unknown"])).toThrow('Unknown argument "--unknown"');
});

it("exits non-zero for an unimplemented suite before starting a server or a browser", () => {
  // `roles` is implemented from T2 on; this check needs a suite a later task still owns.
  const pending = SUITES.find((suite) => !suite.run);
  expect(pending).toBeTruthy();
  const result = runner(["--suite", pending.name]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Suite "${pending.name}" is not implemented yet`);
  expect(result.stdout).not.toContain("Fixture server");
  expect(result.stdout).not.toContain("Launched browser");
});

it("exits non-zero for an unknown suite and names the registered suites", () => {
  const result = runner(["--suite", "fonts"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unknown suite "fonts"');
  expect(result.stderr).toContain("baseline");
  expect(result.stdout).not.toContain("Fixture server");
});

it("lists every planned suite with its implementation state", () => {
  const result = runner(["--list"]);
  expect(result.status).toBe(0);
  for (const suite of SUITES)
    expect(result.stdout).toContain(
      `${suite.name}\t${suite.run ? "implemented" : "pending"}\t${suite.owner}`,
    );
});

// --- the coverage closure's second layer (T7) --------------------------------------
// The browser suite proves the sizes; these cases prove the *list* the browser suite works
// from is complete. The role universe is not authored — the engine derives Scene kinds from
// the DSL's xtypes — so every xtype is rendered here through the real WASM engine and the
// kinds it produces are compared against the declared table. No browser is needed.
let wasm, bytes;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
});

const PROBE_SCRIPT = "fn init(state) { state }\nfn noted(s, e) { s }\n";

async function renderShape(shape) {
  const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
  engine.load(
    {
      version: 1,
      id: "xtype-probe",
      title: "xtype probe",
      script: "probe.rhai",
      state: XTYPE_PROBE_STATE,
      ui: {
        xtype: "container",
        layout: "vbox",
        items: [{ xtype: shape.xtype, ...shape.node }],
      },
    },
    shape.script ? `${PROBE_SCRIPT}${shape.script}\n` : PROBE_SCRIPT,
  );
  if (shape.dispatch) engine.dispatch(shape.dispatch);
  return engine.layout(900).widgets;
}

it("keeps the xtype, kind and state tables consistent with each other", () => {
  expect(xtypeTableProblems()).toEqual([]);
  expect(stateTableProblems()).toEqual([]);
  // Every kind is owned by exactly one table, and every owner says who checks it.
  for (const shape of XTYPE_SHAPES)
    for (const kind of shape.kinds) expect(kindOwner(kind), `kind ${kind}`).toBeTruthy();
});

it("produces exactly the declared Scene kinds for every xtype the engine accepts", async () => {
  const seen = new Set();
  const noName = new Map();
  for (const shape of XTYPE_SHAPES) {
    const widgets = await renderShape(shape);
    const kinds = [...new Set(widgets.map((widget) => widget.kind))].sort();
    expect(kinds, `${shapeLabel(shape)} の kind`).toEqual([...shape.kinds].sort());
    for (const kind of kinds) seen.add(kind);
    // "Paints no text" has to be measured, not assumed. A kind recorded as engine-empty
    // must carry nothing at all; the two recorded as renderer-skips must still carry their
    // accessible name, so the weaker claim cannot quietly be made for the wrong kind.
    for (const widget of widgets) {
      const owner = kindOwner(widget.kind);
      if (owner?.suite !== "none") continue;
      const content = [widget.text, widget.value, ...(widget.cells ?? [])].join("");
      if (owner.basis === "engine-empty")
        expect(content, `${shapeLabel(shape)} の ${widget.kind} は文字を持たないはず`).toBe("");
      else noName.set(widget.kind, (noName.get(widget.kind) ?? "") + content);
    }
  }
  // Every renderer-skips kind really does carry a name the renderers chose not to paint.
  for (const [kind, owner] of Object.entries(KIND_NO_TEXT))
    if (owner.basis === "renderer-skips")
      expect(noName.get(kind) ?? "", `${kind} の読み上げ名`).not.toBe("");
  // Both directions: no xtype without a shape, and no kind in a table nothing produces.
  for (const xtype of engineXtypes())
    expect(
      XTYPE_SHAPES.some((shape) => shape.xtype === xtype),
      `xtype ${xtype} の shape`,
    ).toBe(true);
  expect([...seen].sort().length).toBeGreaterThan(0);
});

it("accepts every authored alias and rejects an xtype that is not in the allowlist", async () => {
  const allowed = engineXtypes();
  for (const alias of Object.keys(XTYPE_ALIASES)) {
    expect(allowed, `別名 ${alias} の正規名`).toContain(canonicalXtype(alias));
    // The alias itself must not be in the allowlist: normalize resolves it before the
    // check runs, so an alias that also appears there would be a second, unaliased path.
    expect(allowed).not.toContain(alias);
  }
  await expect(renderShape({ xtype: "nosuchthing", node: {}, kinds: [] })).rejects.toThrow(
    "Unknown xtype: nosuchthing",
  );
});

it("records the two xtypes that render nothing instead of counting them as covered", () => {
  for (const [xtype, why] of Object.entries(XTYPE_RENDER_EXEMPT)) {
    expect(why.length).toBeGreaterThan(10);
    const shapes = XTYPE_SHAPES.filter((shape) => shape.xtype === xtype);
    expect(shapes.length, `${xtype} の shape`).toBeGreaterThan(0);
    for (const shape of shapes) expect(shape.kinds, `${xtype} の kind`).toEqual([]);
  }
});

it("gives every contracted state an owning suite and a reason", () => {
  expect(STATE_CONTRACT.length).toBeGreaterThan(10);
  for (const entry of STATE_CONTRACT) {
    expect(entry.why, `状態 ${entry.state}`).toBeTruthy();
    expect(["roles", "editing", "surfaces", "lifecycle"]).toContain(entry.suite);
    if (entry.suite === "roles") expect(typeof entry.detect).toBe("function");
    else expect(entry.evidence, `状態 ${entry.state} の証跡`).toBeTruthy();
  }
});
