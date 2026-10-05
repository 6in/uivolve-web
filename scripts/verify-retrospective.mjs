import { spawn } from "node:child_process";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const RETROSPECTIVE_CHECKS = [
  ["bun", "install", "--frozen-lockfile"],
  ["bun", "run", "build:wasm"],
  ["bunx", "vp", "test", "run", "tests/engine.test.js", "tests/worker-mock.test.js"],
  ["bun", "run", "check"],
  ["bun", "run", "docs:check"],
  ["bun", "run", "build"],
  ["bun", "scripts/check-retrospective.mjs", "--stage", "complete"],
  ["bun", "scripts/capture-retrospective.mjs"],
];

export async function runVerification({
  cwd = root,
  spawnProcess = spawn,
  signalTarget = process,
} = {}) {
  const directory = resolve(cwd, ".gsd-lite/logs/development-retrospective-blog");
  await mkdir(directory, { recursive: true });
  const log = resolve(directory, `verification-${Date.now()}.log`);
  await writeFile(log, `Started: ${new Date().toISOString()}\n`);
  let child;
  let interrupted = 0;
  const cleanupErrors = [];
  const stop = (code) => {
    interrupted ||= code;
    if (!child) return;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") cleanupErrors.push(error.message);
    }
  };
  const interrupt = () => stop(130),
    terminate = () => stop(143);
  signalTarget.on("SIGINT", interrupt);
  signalTarget.on("SIGTERM", terminate);
  let result = 0;
  try {
    for (const [command, ...args] of RETROSPECTIVE_CHECKS) {
      if (interrupted) {
        result = interrupted;
        break;
      }
      const label = [command, ...args].join(" ");
      console.log(`Verify: ${label}`);
      await appendFile(log, `\n$ ${label}\n`);
      const output = [];
      const code = await new Promise((done) => {
        try {
          child = spawnProcess(command, args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
          });
          for (const [stream, destination] of [
            [child.stdout, process.stdout],
            [child.stderr, process.stderr],
          ])
            stream.on("data", (chunk) => {
              output.push(chunk);
              destination.write(chunk);
            });
          child.once("error", (error) => {
            output.push(Buffer.from(`${error.message}\n`));
            done(1);
          });
          child.once("close", (status, signal) => {
            if (signal) output.push(Buffer.from(`Terminated by ${signal}\n`));
            done(status ?? 1);
          });
        } catch (error) {
          output.push(Buffer.from(`${error.message}\n`));
          done(1);
        }
      });
      child = null;
      await appendFile(log, Buffer.concat(output));
      await appendFile(log, `Exit: ${code}\n`);
      result = interrupted || code;
      if (result) break;
    }
  } finally {
    signalTarget.removeListener("SIGINT", interrupt);
    signalTarget.removeListener("SIGTERM", terminate);
    for (const error of cleanupErrors) console.error(`Cleanup failure: ${error}`);
    await appendFile(
      log,
      `Result: ${result}\nCleanup failures: ${JSON.stringify(cleanupErrors)}\n`,
    );
    console.log(`Verification log: ${log}`);
  }
  return result || (cleanupErrors.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runVerification();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
