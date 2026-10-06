import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const parity = (suite) => ({
  label: `font-parity:${suite}`,
  command: "bun",
  args: ["scripts/test-font-parity-browser.mjs", "--suite", suite],
});

// The single final gate for this milestone, in the order the plan fixes. The baseline
// suite is the pre-fix ledger, so it is deliberately absent; the distribution suite is
// the independent runtime / minimal check that runs against the generated artifacts.
export const STEPS = [
  { label: "build:wasm", command: "bun", args: ["run", "build:wasm"] },
  { label: "vitest", command: "bunx", args: ["vp", "test", "run"] },
  { label: "test:rust", command: "bun", args: ["run", "test:rust"] },
  { label: "check", command: "bun", args: ["run", "check"] },
  { label: "docs:check", command: "bun", args: ["run", "docs:check"] },
  { label: "build", command: "bun", args: ["run", "build"] },
  { label: "build:runtime", command: "bun", args: ["run", "build:runtime"] },
  { label: "build:minimal", command: "bun", args: ["run", "build:minimal"] },
  parity("roles"),
  parity("editing"),
  parity("surfaces"),
  parity("lifecycle"),
  parity("matrix"),
  parity("distribution"),
];

// Sequential, fail-fast, and interruption is a failure: a step that never finished is
// never reported as a pass.
export async function runSteps(steps, { cwd = root, log = console.log } = {}) {
  let interrupted;
  let child;
  const interrupt = (signal) => {
    interrupted ??= new Error(`Interrupted by ${signal}`);
    child?.kill("SIGTERM");
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const results = [];
  try {
    for (const step of steps) {
      if (interrupted) throw interrupted;
      log(`→ ${step.label}: ${step.command} ${step.args.join(" ")}`);
      child = spawn(step.command, step.args, { cwd, stdio: "inherit" });
      const [code, signal] = await new Promise((done, fail) => {
        child.once("error", fail);
        child.once("close", (exitCode, closeSignal) => done([exitCode, closeSignal]));
      });
      child = undefined;
      results.push({ label: step.label, code, signal });
      if (interrupted) throw interrupted;
      if (code !== 0)
        throw new Error(`${step.label} failed (exit ${code}${signal ? ` ${signal}` : ""})`);
      log(`✓ ${step.label}`);
    }
    return results;
  } finally {
    child?.kill("SIGTERM");
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--print-plan"))
    console.log(
      JSON.stringify(
        STEPS.map((step) => step.label),
        null,
        2,
      ),
    );
  else {
    try {
      await runSteps(STEPS);
      console.log(`Font parity verification passed (${STEPS.length} steps)`);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }
}
