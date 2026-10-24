import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntime } from "./build-runtime.mjs";
import { createStaticHandler } from "./serve-minimal.mjs";

// Opens the runtime over plain HTTP on this machine's IP (not localhost), so the page is not a
// secure context: no crypto.subtle, no crypto.randomUUID.
const root = fileURLToPath(new URL("../", import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(root, ".cache/ms-playwright");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hostAddress() {
  const host =
    option("--host") ??
    Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
  if (!host) throw new Error("No non-internal IPv4 address found; pass --host <ip>");
  if (host === "localhost" || host.startsWith("127."))
    throw new Error(`${host} is a secure context; pass a non-loopback IP`);
  return host;
}

async function install() {
  const child = spawn("bunx", ["playwright", "install", "chromium"], { stdio: "inherit" });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`playwright install chromium failed (exit ${code})`);
}

function browserPath(chromium) {
  const explicit = option("--browser-path");
  if (explicit) return explicit;
  const managed = chromium.executablePath();
  if (managed && existsSync(managed)) return managed;
  if (existsSync("/usr/bin/chromium-browser")) return "/usr/bin/chromium-browser";
  throw new Error("Chromium not found; run with --install to fetch it into .cache/ms-playwright");
}

async function waitForText(page, text) {
  await page.waitForFunction(
    (expected) => document.getElementById("app")?.innerText.includes(expected),
    text,
    { timeout: 15_000 },
  );
}

let server;
let browser;
const consoleErrors = [];
const consoleLog = [];
const pageErrors = [];
const stop = () => {
  void browser?.close();
  server?.stop(true);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const host = hostAddress();
  if (args.includes("--install")) await install();
  // Load playwright after PLAYWRIGHT_BROWSERS_PATH is set.
  const { chromium } = await import("playwright");
  const runtime = await buildRuntime();
  const handlers = {
    runtime: createStaticHandler(runtime),
    public: createStaticHandler(resolve(root, "public")),
    page: createStaticHandler(resolve(root, "tests/browser/insecure-context")),
  };
  server = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/runtime/")) {
        url.pathname = url.pathname.slice("/runtime".length);
        return handlers.runtime(new Request(url, request));
      }
      if (url.pathname.startsWith("/screens/") || url.pathname.startsWith("/mock/"))
        return handlers.public(request);
      return handlers.page(request);
    },
  });
  const origin = `http://${host}:${server.port}`;
  browser = await chromium.launch({ headless: true, executablePath: browserPath(chromium) });
  console.log(`Browser: ${browser.version()}`);
  console.log(`URL: ${origin}/`);
  const page = await browser.newPage();
  page.on("console", (message) => {
    consoleLog.push(`[${message.type()}] ${message.text()}`);
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) consoleLog.push(`[http] ${response.status()} ${response.url()}`);
  });
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => globalThis.insecureContext, null, { timeout: 15_000 });

  const context = await page.evaluate(() => ({
    isSecureContext: globalThis.isSecureContext,
    randomUUID: typeof globalThis.crypto?.randomUUID,
    subtle: typeof globalThis.crypto?.subtle,
  }));
  console.log(`Context: ${JSON.stringify(context)}`);
  if (context.isSecureContext !== false) throw new Error("Page is a secure context");
  if (context.randomUUID !== "undefined") throw new Error("crypto.randomUUID is available");
  if (context.subtle !== "undefined") throw new Error("crypto.subtle is available");

  const first = await page.evaluate(() =>
    globalThis.insecureContext.load("screens/worker-orders.yaml"),
  );
  await waitForText(page, "山田商店");
  console.log("Worker mock screen: listed 山田商店");
  const second = await page.evaluate(() =>
    globalThis.insecureContext.load("screens/order-dashboard.json"),
  );
  await waitForText(page, "SO-001");
  console.log("Component screen: child order-list shows SO-001");
  console.log(`screenToken: ${first} / ${second}`);
  if (!UUID_V4.test(first) || !UUID_V4.test(second))
    throw new Error("screenToken is not a UUID v4");
  if (first === second) throw new Error("screenToken did not change between loads");

  const runtimeErrors = await page.evaluate(() => globalThis.insecureContext.errors);
  console.log(
    `Errors: console ${consoleErrors.length} / pageerror ${pageErrors.length} / onError ${runtimeErrors.length}`,
  );
  if (consoleErrors.length || pageErrors.length || runtimeErrors.length)
    throw new Error(JSON.stringify({ consoleErrors, pageErrors, runtimeErrors }));
  console.log("Insecure context browser checks passed");
} catch (error) {
  console.error(error);
  if (consoleLog.length) console.error(`Console:\n${consoleLog.join("\n")}`);
  if (pageErrors.length) console.error(`Page errors:\n${pageErrors.join("\n")}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.stop(true);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
