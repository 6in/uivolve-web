import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { chromium } from "playwright";
import { transferFixture } from "./transfer-server.mjs";
import { runBrowserTests } from "../tests/browser/opfs-file-transfer.mjs";

let browser;
let context;
let dev;
let fixture;
const requests = [];
const stop = () => {
  void browser?.close();
  dev?.kill("SIGTERM");
  fixture?.stop(true);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 128 * 1024 * 1024,
    idleTimeout: 255,
    fetch(request) {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        authorization: request.headers.has("authorization"),
      });
      return transferFixture(request);
    },
  });
  // Ask the OS for an unused port; fail if another process wins the subsequent bind.
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  dev = spawn(
    "bunx",
    ["vp", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { stdio: "inherit" },
  );
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (dev.exitCode !== null) throw new Error("Browser fixture server exited");
    try {
      ready = (await fetch(`${origin}/tests/browser/index.html`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Browser fixture server did not start");
  const executablePath =
    process.env.TRANSFER_BROWSER_PATH ??
    (existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined);
  browser = await chromium.launch({ headless: true, executablePath });
  context = await browser.newContext();
  await runBrowserTests({ context, origin, api: `${fixture.url}api/`, requests });
  console.log(`Real browser transfer checks passed (${browser.version()})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  fixture?.stop(true);
  if (dev && dev.exitCode === null) {
    const closed = once(dev, "close");
    dev.kill("SIGTERM");
    await closed;
  }
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
