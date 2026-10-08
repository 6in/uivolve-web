// usage: bun scripts/verify-instance-refactor.mjs [--base-commit <rev>] [--skip-mutations]
//
// component-instance-refactor の最終判定。既存の全検査を順に回したあと、base コミットの
// WASM と作業ツリーの WASM の応答を照合して差分 0 を要求し、components を宣言する画面を
// 候補のみの probe で確かめ、続けて変異 5 本をビルドして検査が差分を見つける（exit 1）ことを
// 要求する。変異で exit 0 になった場合は検査に歯が無いとして失敗にする。変異に `probe` が
// 付いていれば照合ではなくその probe で検査する（base には合成が無いため照合では見えない）。
// --skip-mutations は開発中の短縮用で最終判定では付けない。

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTATIONS } from "./build-engine-variant.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const SCRATCH = "target/engine-compare";

export const BASE_CHECKS = [
  ["bun", "run", "build:wasm"],
  ["bunx", "vp", "test", "run"],
  ["bun", "run", "test:rust"],
  ["bun", "run", "check"],
  ["bun", "run", "docs:check"],
  ["bun", "run", "build"],
];

function parseArgs(argv) {
  const options = { baseCommit: "main", skipMutations: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--skip-mutations") options.skipMutations = true;
    else if (argv[i] === "--base-commit" && argv[i + 1] !== undefined)
      options.baseCommit = argv[++i];
    else return null;
  }
  return options;
}

function shortRev(rev, runCommand = spawnSync) {
  const result = runCommand("git", ["rev-parse", "--short", rev], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function compareStep(label, baseWasm, candidate, evidence, expect) {
  return {
    label,
    expect,
    command: [
      "bun",
      "scripts/compare-engine-behavior.mjs",
      "--base",
      baseWasm,
      "--candidate",
      candidate,
      "--evidence",
      evidence,
    ],
  };
}

const PROBES = {
  composition: (candidate, evidence) => [
    "bun",
    "scripts/probe-composition.mjs",
    "--candidate",
    candidate,
    "--evidence",
    evidence,
  ],
};

function probeStep(label, probe, candidate, evidence, expect) {
  return { label, expect, command: PROBES[probe](candidate, evidence) };
}

export function buildSteps(options, { exists = existsSync, rev = shortRev } = {}) {
  const base = rev(options.baseCommit);
  if (!base) return null;
  const baseWasm = `${SCRATCH}/base-${base}.wasm`;
  const steps = BASE_CHECKS.map((command) => ({ label: command.join(" "), command, expect: 0 }));
  if (!exists(resolve(root, baseWasm)))
    steps.push({
      label: `build base ${base}`,
      expect: 0,
      command: [
        "bun",
        "scripts/build-engine-variant.mjs",
        "--commit",
        options.baseCommit,
        "--out",
        baseWasm,
      ],
    });
  steps.push(
    compareStep("compare candidate", baseWasm, "public/engine.wasm", `${SCRATCH}/compare.json`, 0),
  );
  steps.push(
    probeStep(
      "probe composition",
      "composition",
      "public/engine.wasm",
      `${SCRATCH}/composition.json`,
      0,
    ),
  );
  if (options.skipMutations) return steps;
  for (const mutation of MUTATIONS) {
    const out = `${SCRATCH}/mutant-${mutation.name}.wasm`;
    const evidence = `${SCRATCH}/mutant-${mutation.name}.json`;
    steps.push({
      label: `build ${mutation.name}`,
      expect: 0,
      command: [
        "bun",
        "scripts/build-engine-variant.mjs",
        "--mutation",
        mutation.name,
        "--out",
        out,
      ],
    });
    steps.push(
      mutation.probe
        ? probeStep(`probe ${mutation.name}`, mutation.probe, out, evidence, 1)
        : compareStep(`compare ${mutation.name}`, baseWasm, out, evidence, 1),
    );
  }
  return steps;
}

function terminateProcessGroup(child) {
  if (process.platform === "win32") child.kill("SIGTERM");
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

function formatReport(results, totalMs) {
  const width = Math.max(...results.map((result) => result.label.length), 4);
  const lines = [
    "",
    `${"手順".padEnd(width)}  期待  実際  秒`,
    `${"-".repeat(width)}  ----  ----  -----`,
  ];
  for (const result of results)
    lines.push(
      `${result.label.padEnd(width)}  ${String(result.expect).padStart(4)}  ` +
        `${String(result.code).padStart(4)}  ${(result.durationMs / 1000).toFixed(1).padStart(5)}`,
    );
  lines.push(
    `${"合計".padEnd(width)}  ${" ".repeat(12)}${(totalMs / 1000).toFixed(1).padStart(5)}`,
  );
  return lines.join("\n");
}

export async function runInstanceRefactorVerification({
  argv = [],
  spawnProcess = spawn,
  signalTarget = process,
  cwd = root,
  terminateChild = terminateProcessGroup,
  log = console.log,
} = {}) {
  const options = parseArgs(argv);
  if (!options) {
    log("usage: bun scripts/verify-instance-refactor.mjs [--base-commit <rev>] [--skip-mutations]");
    return 2;
  }
  const steps = buildSteps(options);
  if (!steps) {
    log(`base commit を解決できない: ${options.baseCommit}`);
    return 2;
  }

  let activeChild = null;
  let interruptedCode = 0;
  function interrupt(code) {
    if (interruptedCode) return;
    interruptedCode = code;
    if (activeChild) terminateChild(activeChild);
  }
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  signalTarget.on("SIGINT", onInterrupt);
  signalTarget.on("SIGTERM", onTerminate);

  const results = [];
  const started = Date.now();
  try {
    for (const step of steps) {
      if (interruptedCode) return interruptedCode;
      log(`\n### ${step.label}（期待する exit code ${step.expect}）`);
      const stepStarted = Date.now();
      const [command, ...args] = step.command;
      const code = await new Promise((done) => {
        try {
          activeChild = spawnProcess(command, args, {
            cwd,
            stdio: "inherit",
            detached: process.platform !== "win32",
          });
          activeChild.once("error", () => done(1));
          activeChild.once("close", (exitCode) => done(exitCode ?? 1));
        } catch {
          done(1);
        }
      });
      activeChild = null;
      results.push({ ...step, code, durationMs: Date.now() - stepStarted });
      if (interruptedCode) return interruptedCode;
      if (code !== step.expect) {
        log(formatReport(results, Date.now() - started));
        log(
          code === 0
            ? `\nFAIL ${step.label}: exit 0 だが ${step.expect} を期待した（照合に歯が無い）`
            : `\nFAIL ${step.label}: exit ${code}（期待 ${step.expect}）`,
        );
        return code === 0 ? 1 : code;
      }
    }
    log(formatReport(results, Date.now() - started));
    log("\nOK すべての手順が期待どおり（照合は差分 0、probe は期待どおり、変異 5 本は検出された）");
    return 0;
  } finally {
    signalTarget.removeListener("SIGINT", onInterrupt);
    signalTarget.removeListener("SIGTERM", onTerminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runInstanceRefactorVerification({ argv: process.argv.slice(2) });
}
