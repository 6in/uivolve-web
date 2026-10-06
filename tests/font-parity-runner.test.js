import { expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SUITES, selectSuites } from "./browser/font-parity.mjs";
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
