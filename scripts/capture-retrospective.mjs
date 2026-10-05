import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { platform, release } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:4174";
const url = `${origin}/pages/hello-world`;
const viewport = { width: 1440, height: 1000 };
const scratch = resolve(root, ".gsd-lite/logs/development-retrospective-blog/scratch");
const screenshot = resolve(root, "blog/uivolve-web-retrospective/dom-canvas.png");
const record = { url, viewport, os: `${platform()} ${release()}`, checks: [], cleanupErrors: [] };
let server;
let browser;
let failure;
let interrupted;
let serverError;
const interrupt = () => {
  interrupted = new Error("Capture interrupted");
  void browser?.close().catch(() => {});
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

try {
  await mkdir(scratch, { recursive: true });
  // Never attach to or terminate a server owned by another process.
  try {
    await fetch(origin, { signal: AbortSignal.timeout(500) });
    throw new Error(`Preview port already in use: ${origin}`);
  } catch (error) {
    if (error.message.startsWith("Preview port")) throw error;
  }
  server = spawn("bun", ["run", "preview"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let serverOutput = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      serverOutput += chunk;
    });
  server.once("error", (error) => {
    serverError = error;
  });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (interrupted) throw interrupted;
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Preview exited: ${serverOutput}`);
    try {
      ready = (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
    } catch {
      // Wait for the preview we just started.
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!ready) throw new Error(`Preview did not start: ${serverOutput}`);
  const executablePath =
    process.env.RETROSPECTIVE_BROWSER_PATH ??
    (existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined);
  browser = await chromium.launch({ headless: false, executablePath });
  record.browser = `Chromium ${browser.version()}`;
  record.executablePath = executablePath ?? "Playwright bundled Chromium";
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Observe real Canvas drawing without replacing pixels or application state.
  await page.addInitScript(() => {
    window.retrospectivePaint = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (this.canvas.id === "canvas") window.retrospectivePaint.push(String(args[0]));
      return original.apply(this, args);
    };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === "canvas") window.retrospectivePaint = [];
      return clear.apply(this, args);
    };
  });
  await page.goto(url, { waitUntil: "networkidle" });
  const input = page.locator('#dom-stage input[data-target="nameInput"]');
  const button = page.locator("#dom-stage button", { hasText: "挨拶する" });
  await input.waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  const check = async (label, name, greeting) => {
    await page.waitForFunction(
      ({ name, greeting }) => {
        const state = JSON.parse(document.querySelector("#state-view").textContent);
        return (
          state.name === name &&
          state.greeting === greeting &&
          window.retrospectivePaint.includes(greeting)
        );
      },
      { name, greeting },
    );
    assert.equal(await input.inputValue(), name);
    assert.ok((await page.locator("#dom-stage").innerText()).includes(greeting));
    assert.equal(await page.locator("#error").isVisible(), false);
    record.checks.push({ label, name, greeting, canvasFillText: true });
    console.log(`Capture check: ${label}`);
  };
  const initial = "名前を入力して「挨拶する」を押してください。";
  await check("initial", "", initial);
  await input.fill("太郎");
  await check("DOM input leaves greeting unchanged", "太郎", initial);
  await button.click();
  await check("DOM button updates both renderers", "太郎", "Hello 太郎");
  await input.fill("   ");
  await check("DOM whitespace input leaves greeting unchanged", "   ", "Hello 太郎");
  await button.click();
  await check("DOM whitespace resolves to World", "   ", "Hello World");
  const canvas = page.locator("#canvas");
  const clickCanvasAt = async (locator) => {
    const box = await locator.boundingBox();
    const domBox = await page.locator("#dom-stage").boundingBox();
    assert.ok(box && domBox);
    // Both surfaces use the same Scene geometry; use the DOM widget's position
    // relative to its stage to click the corresponding real Canvas location.
    await canvas.click({
      position: {
        x: box.x - domBox.x + box.width / 2,
        y: box.y - domBox.y + box.height / 2,
      },
    });
  };
  await clickCanvasAt(input);
  const editor = page.locator('#canvas-stage input[data-target="nameInput"]');
  await editor.fill("花子");
  await check("Canvas input updates DOM without changing greeting", "花子", "Hello World");
  await clickCanvasAt(button);
  await check("Canvas button updates both renderers", "花子", "Hello 花子");
  await clickCanvasAt(input);
  await editor.fill("   ");
  await check("Canvas whitespace input leaves greeting unchanged", "   ", "Hello 花子");
  await clickCanvasAt(button);
  await check("Canvas whitespace resolves to World", "   ", "Hello World");
  await clickCanvasAt(input);
  await editor.fill("太郎");
  await check("Canvas final input leaves greeting unchanged", "太郎", "Hello World");
  await clickCanvasAt(button);
  await check("Final both renderers show Taro", "太郎", "Hello 太郎");
  await page.locator(".card-heading").first().click();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  assert.deepEqual(pageErrors, []);
  record.clip = await page.locator(".comparison").boundingBox();
  await page.locator(".comparison").screenshot({ path: screenshot });
  record.screenshot = screenshot;
  record.method =
    "Unmodified comparison section locator screenshot; real Canvas pixels; deviceScaleFactor=1";
} catch (error) {
  failure = error;
  console.error(`Capture failure: ${error.stack ?? error}`);
} finally {
  try {
    await browser?.close();
  } catch (error) {
    record.cleanupErrors.push(`Browser: ${error.message}`);
  }
  if (server?.pid) {
    try {
      const closed = server.exitCode !== null || server.signalCode !== null;
      const closure = closed ? Promise.resolve() : once(server, "close");
      if (process.platform === "win32") server.kill("SIGTERM");
      else process.kill(-server.pid, "SIGTERM");
      await Promise.race([
        closure,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error("Preview cleanup timed out")), 5000);
          timer.unref();
        }),
      ]);
      record.serverStopped = true;
    } catch (error) {
      if (error.code === "ESRCH") record.serverStopped = true;
      else record.cleanupErrors.push(`Preview: ${error.message}`);
    }
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  failure ||= interrupted;
  record.failure = failure?.message ?? null;
  for (const error of record.cleanupErrors) console.error(`Cleanup failure: ${error}`);
  await mkdir(scratch, { recursive: true });
  const log = resolve(scratch, `capture-${Date.now()}.json`);
  await writeFile(log, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Capture evidence: ${log}`);
  process.exitCode = failure || record.cleanupErrors.length ? 1 : 0;
}
