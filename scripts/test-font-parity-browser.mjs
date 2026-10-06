import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SUITES, selectSuites, prepareEvidenceDir } from "../tests/browser/font-parity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function parseArguments(argv) {
  const options = {
    suites: [],
    browserPath: process.env.FONT_PARITY_BROWSER_PATH,
    browserEndpoint: process.env.FONT_PARITY_BROWSER_ENDPOINT,
    evidenceDir: ".gsd-lite/logs/renderer-font-size-parity",
    viewport: { width: 1440, height: 1000 },
    list: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    const take = () => {
      if (value === undefined) throw new Error(`${flag} needs a value`);
      index++;
      return value;
    };
    if (flag === "--suite") options.suites.push(take());
    else if (flag === "--browser-path") options.browserPath = take();
    else if (flag === "--browser-endpoint") options.browserEndpoint = take();
    else if (flag === "--evidence") options.evidenceDir = take();
    else if (flag === "--viewport") {
      const match = /^(\d+)x(\d+)$/.exec(take());
      if (!match) throw new Error("--viewport needs WIDTHxHEIGHT");
      options.viewport = { width: Number(match[1]), height: Number(match[2]) };
    } else if (flag === "--list") options.list = true;
    else throw new Error(`Unknown argument "${flag}"`);
  }
  if (options.browserPath && options.browserEndpoint)
    throw new Error("Choose either --browser-path or --browser-endpoint, not both");
  return options;
}

function defaultBrowserPath() {
  return ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium"].find((path) =>
    existsSync(path),
  );
}

async function startServer({ log }) {
  // Ask the OS for an unused port; never adopt or stop a server owned by someone else.
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  const server = spawn(
    "bunx",
    ["vp", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    // `bunx vp dev` runs the server in a grandchild; own the whole group so cleanup
    // reaches the process that actually holds the port.
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" },
  );
  let output = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      output += chunk;
    });
  let failure;
  server.once("error", (error) => {
    failure = error;
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (failure) throw failure;
    if (server.exitCode !== null) throw new Error(`Fixture server exited: ${output}`);
    try {
      if ((await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(500) })).ok) {
        log(`Fixture server: ${origin}`);
        return { server, origin };
      }
    } catch {
      // Wait for the server this process just started.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Fixture server did not start: ${output}`);
}

async function stopServer(server) {
  if (!server?.pid || server.exitCode !== null) return;
  const closed = once(server, "close");
  try {
    if (process.platform === "win32") server.kill("SIGTERM");
    else process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  await Promise.race([
    closed,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture server cleanup timed out")), 10000);
      timer.unref();
    }),
  ]);
}

export async function main(argv, log = console.log) {
  const options = parseArguments(argv);
  if (options.list) {
    for (const suite of SUITES)
      log(`${suite.name}\t${suite.run ? "implemented" : "pending"}\t${suite.owner}`);
    return;
  }
  // Reject unknown and not-yet-implemented suites before any server or browser starts.
  const suites = selectSuites(options.suites);
  const evidenceDir = await prepareEvidenceDir(resolve(root, options.evidenceDir));
  let interrupted;
  let server;
  let browser;
  let context;
  let ownsBrowser = false;
  const interrupt = (signal) => {
    interrupted ??= new Error(`Font parity run interrupted by ${signal}`);
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const cleanupErrors = [];
  let failure;
  try {
    ({ server, origin: options.origin } = await startServer({ log }));
    if (options.browserEndpoint) {
      // An externally owned browser: use it, and never close it.
      browser = await chromium.connectOverCDP(options.browserEndpoint);
      log(`Connected browser: ${browser.version()} via ${options.browserEndpoint}`);
    } else {
      const executablePath = options.browserPath ?? defaultBrowserPath();
      browser = await chromium.launch({ headless: true, executablePath, timeout: 60000 });
      ownsBrowser = true;
      log(`Launched browser: ${browser.version()} (${executablePath ?? "Playwright bundled"})`);
    }
    context = await browser.newContext({
      viewport: options.viewport,
      deviceScaleFactor: 1,
      locale: "ja-JP",
    });
    for (const suite of suites) {
      if (interrupted) throw interrupted;
      log(`Suite ${suite.name} (${suite.owner})`);
      await suite.run({
        context,
        origin: options.origin,
        evidenceDir,
        viewport: options.viewport,
        log,
      });
      log(`Suite ${suite.name}: passed`);
    }
    if (interrupted) throw interrupted;
  } catch (error) {
    failure = error;
  } finally {
    // Close only what this process owns, and keep the original failure visible.
    for (const [label, close] of [
      ["context", () => context?.close()],
      ["browser", () => (ownsBrowser ? browser?.close() : undefined)],
      ["server", () => stopServer(server)],
    ]) {
      try {
        await close();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error.message}`);
      }
    }
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  }
  failure ??= interrupted;
  for (const error of cleanupErrors) console.error(`Cleanup failure: ${error}`);
  if (failure) throw failure;
  if (cleanupErrors.length) throw new Error(`Cleanup failed: ${cleanupErrors.join("; ")}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
    console.log("Font parity suites passed");
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exit(1);
  }
}
