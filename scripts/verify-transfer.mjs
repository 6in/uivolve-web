import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export const TRANSFER_CHECKS = [
  ["bun", "run", "build:wasm"],
  ["bunx", "vp", "test", "run"],
  ["bun", "run", "test:rust"],
  ["bun", "run", "check"],
  ["bun", "run", "docs:check"],
  ["bun", "run", "build"],
  ["bun", "scripts/test-transfer-browser.mjs"],
];

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

export async function runTransferVerification({
  spawnProcess = spawn,
  signalTarget = process,
  cwd = root,
  terminateChild = terminateProcessGroup,
} = {}) {
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
  try {
    for (const [command, ...args] of TRANSFER_CHECKS) {
      if (interruptedCode) return interruptedCode;
      const exitCode = await new Promise((done) => {
        try {
          activeChild = spawnProcess(command, args, {
            cwd,
            stdio: "inherit",
            detached: process.platform !== "win32",
          });
          activeChild.once("error", () => done(1));
          activeChild.once("close", (code) => done(code === 0 ? 0 : (code ?? 1)));
        } catch {
          done(1);
        }
      });
      activeChild = null;
      if (interruptedCode) return interruptedCode;
      if (exitCode !== 0) return exitCode;
    }
    return 0;
  } finally {
    signalTarget.removeListener("SIGINT", onInterrupt);
    signalTarget.removeListener("SIGTERM", onTerminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runTransferVerification();
}
