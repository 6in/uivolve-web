import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

export async function runBrowserTests({ context, origin, api, requests }) {
  const scope = `transfer-test-${randomUUID()}`;
  const pages = [];
  const open = async () => {
    const page = await context.newPage();
    pages.push(page);
    await page.goto(`${origin}/tests/browser/index.html`);
    await page.evaluate(
      async ({ api, scope }) => {
        const { harness } = await import("./transfer-harness.js");
        window.transfer = harness(api, scope);
      },
      { api, scope },
    );
    return page;
  };
  const page = await open();
  try {
    for (const renderer of ["dom", "canvas"]) {
      const sample = await context.newPage();
      pages.push(sample);
      await sample.goto(
        `${origin}/examples/opfs-file-transfer/?renderer=${renderer}&api=${encodeURIComponent(api)}&testScope=${scope}`,
      );
      await sample.waitForFunction(
        () => window.transferTestRuntime || document.querySelector("#error")?.textContent,
      );
      assert.equal(await sample.locator("#error").textContent(), "");
      if (renderer === "canvas") assert.equal((await sample.locator("canvas").count()) > 0, true);
      else
        assert.equal(
          await sample
            .getByRole("button", { name: "CSV取得・加工・複数ファイル送信", exact: true })
            .count(),
          1,
        );
      await sample.evaluate(() => window.transferTestRuntime.dispatch("csv"));
      await sample.waitForFunction(() =>
        window.transferTestRuntime.state.notice.startsWith("完了:"),
      );
      const state = await sample.evaluate(() => window.transferTestRuntime.snapshot().state);
      assert.match(state.notice, /加工.csv/);
      assert.match(state.notice, /processed/);
      const csv = await sample.evaluate(async (scope) => {
        const root = await navigator.storage.getDirectory();
        let dir = root;
        for (const name of ["uivolve-web", "fs", scope, "workspace"])
          dir = await dir.getDirectoryHandle(name);
        return (await (await dir.getFileHandle("processed.csv")).getFile()).text();
      }, scope);
      assert.match(csv, /apple,4/);
      await sample.evaluate(() => window.transferTestRuntime.dispatch("slow"));
      await sample.waitForFunction(
        () =>
          /bytes/.test(window.transferTestRuntime.state.progress) &&
          !window.transferTestRuntime.state.progress.includes("なし"),
      );
      await sample.evaluate(() => window.transferTestRuntime.dispatch("cancel"));
      await sample.waitForFunction(() =>
        window.transferTestRuntime.state.notice.startsWith("CANCELLED"),
      );
      // Recompile the screen while a transfer is active; old callbacks cannot change new state.
      await sample.evaluate(async () => {
        const runtime = window.transferTestRuntime;
        runtime.dispatch("slow");
        await runtime.load("home.yaml", { replacePending: true });
      });
      await sample.waitForFunction(async (scope) => {
        const { withFileLock, fileLockKey } = await import("/src/opfs.js");
        try {
          return await withFileLock(fileLockKey(scope, "workspace"), () => true);
        } catch {
          return false;
        }
      }, scope);
      assert.equal(await sample.evaluate(() => window.transferTestRuntime.state.busy), false);
      await sample.evaluate(() => window.transferTestRuntime.dispose());
      await sample.close();
      console.log(`${renderer}: CSV, multipart, progress, cancel, screen replacement passed`);
    }
    const size = 104857600;
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(65536, 97);
    for (let i = 0; i < 1600; i++) hash.update(chunk);
    const expected = hash.digest("hex");
    const large = await page.evaluate(async (size) => {
      const t = window.transfer;
      return t.guarded(async () => {
        const file = { volume: "a", path: "large.bin" };
        const downloaded = await t.transfer(
          "download",
          "download",
          { query: { size: String(size) }, file },
          { responseHeaders: ["Content-Length", "X-Transfer-Fixture"] },
        );
        const upload = await t.transfer("upload", "upload", { file }, { method: "PUT" });
        const multipart = await t.transfer("multipart", "multipart", {
          parts: [
            { name: "tag", value: "" },
            { name: "file", file, filename: "大容量.bin", contentType: "application/octet-stream" },
            { name: "tag", value: "done" },
          ],
        });
        return {
          downloaded,
          upload,
          multipart,
          storedSize: (await t.reference("a", "large.bin").file()).size,
        };
      });
    }, size);
    assert.equal(large.storedSize, size);
    assert.equal(large.downloaded.files[0].size, size);
    assert.equal(large.downloaded.headers["Content-Length"], String(size));
    assert.equal(large.downloaded.headers["X-Transfer-Fixture"], "localhost");
    assert.equal(large.upload.body.size, size);
    assert.equal(large.upload.body.sha256, expected);
    assert.deepEqual(large.multipart.body.entries, [
      { name: "tag", value: "" },
      {
        name: "file",
        filename: "大容量.bin",
        type: "application/octet-stream",
        size,
        sha256: expected,
      },
      { name: "tag", value: "done" },
    ]);
    console.log("100 MiB GET/File/FormData: size/hash and whole-body read guard passed");
    const boundaries = await page.evaluate(async (api) => {
      const t = window.transfer;
      const capture = async (action) => {
        try {
          await action();
          return "unexpected-success";
        } catch (error) {
          return error.code;
        }
      };
      const file = { volume: "a", path: "small.txt" };
      await t.seed("a", file.path, "old");
      const overwrite = await capture(() => t.transfer("download", "csv", { file }));
      const before = await (await t.reference("a", file.path).file()).text();
      await t.transfer("download", "csv", { file }, { overwrite: true });
      const after = await (await t.reference("a", file.path).file()).text();
      const limit = await capture(() =>
        t.transfer("download", "download", {
          file: { volume: "a", path: "oversized.bin" },
          query: { size: "104857601" },
        }),
      );
      const status = await capture(() =>
        t.transfer("download", "status", { file: { volume: "a", path: "error.bin" } }),
      );
      const invalid = await capture(() =>
        t.transfer("upload", "upload", { file: { volume: "a", path: "../escape" } }),
      );
      const controller = new AbortController();
      const pending = t.transfer(
        "download",
        "download",
        { file, query: { size: "1048576", chunkDelay: "100", length: "no" } },
        { overwrite: true },
        controller.signal,
      );
      setTimeout(() => controller.abort(), 250);
      const cancelled = await capture(() => pending);
      const preserved = await (await t.reference("a", file.path).file()).text();
      const uploadFile = { volume: "a", path: "small" };
      await t.seed("a", uploadFile.path, preserved);
      const uploadType = (await t.reference("a", uploadFile.path).file()).type;
      const contentTypes = [];
      for (const method of ["POST", "PUT"]) {
        contentTypes.push(
          await t.guarded(async () => {
            const defaultUpload = await t.transfer(
              "upload",
              "upload",
              { file: uploadFile },
              { method },
            );
            const explicitUpload = await t.transfer(
              "upload",
              "upload",
              { file: uploadFile },
              {
                method,
                headers: { "cOnTeNt-TyPe": "text/csv; charset=utf-8" },
              },
            );
            const multipart = await t.transfer(
              "multipart",
              "multipart",
              {
                parts: [
                  { name: "tag", value: "first" },
                  { name: "file", file: uploadFile },
                  { name: "tag", value: "last" },
                ],
              },
              { method },
            );
            return { method, defaultUpload, explicitUpload, multipart };
          }),
        );
      }
      t.resources.setAuthentication({
        mode: "jwt",
        token: "transfer-fixture",
        allowedOrigins: [new URL(api).origin],
      });
      const auth = await t.transfer("upload", "auth", { file });
      t.resources.setAuthentication({
        mode: "jwt",
        token: "wrong-token",
        allowedOrigins: [new URL(api).origin],
      });
      const unauthorized = await capture(() => t.transfer("upload", "auth", { file }));
      return {
        overwrite,
        before,
        after,
        limit,
        status,
        invalid,
        cancelled,
        preserved,
        auth,
        unauthorized,
        contentTypes,
        uploadType,
      };
    }, api);
    assert.equal(boundaries.overwrite, "ALREADY_EXISTS");
    assert.equal(boundaries.before, "old");
    assert.match(boundaries.after, /apple,2/);
    assert.equal(boundaries.limit, "LIMIT");
    assert.equal(boundaries.status, "HTTP_503");
    assert.equal(boundaries.invalid, "INVALID_ARGUMENT");
    assert.equal(boundaries.cancelled, "CANCELLED");
    assert.equal(boundaries.preserved, boundaries.after);
    assert.equal(boundaries.auth.body.authenticated, true);
    assert.equal(boundaries.unauthorized, "HTTP_401");
    const smallHash = createHash("sha256").update(boundaries.preserved).digest("hex");
    assert.equal(boundaries.uploadType, "");
    for (const { method, defaultUpload, explicitUpload, multipart } of boundaries.contentTypes) {
      assert.equal(defaultUpload.body.method, method);
      assert.equal(defaultUpload.body.contentType, "application/octet-stream");
      assert.equal(explicitUpload.body.contentType, "text/csv; charset=utf-8");
      for (const result of [defaultUpload, explicitUpload]) {
        assert.equal(result.body.sha256, smallHash);
        assert.equal(result.body.size, Buffer.byteLength(boundaries.preserved));
      }
      assert.equal(multipart.body.method, method);
      assert.match(multipart.body.contentType, /^multipart\/form-data; boundary=.+/);
      assert.deepEqual(multipart.body.entries, [
        { name: "tag", value: "first" },
        {
          name: "file",
          filename: "small",
          type: "application/octet-stream",
          size: Buffer.byteLength(boundaries.preserved),
          sha256: smallHash,
        },
        { name: "tag", value: "last" },
      ]);
    }
    assert.ok(requests.some((r) => r.method === "OPTIONS"));
    assert.equal(requests.filter((r) => r.path === "/api/auth" && r.method === "POST").length, 2);
    assert.ok(
      requests
        .filter((r) => r.path === "/api/auth" && r.method === "POST")
        .every((r) => r.authorization),
    );
    console.log("CORS/authentication, overwrite, capacity, cancellation and methods passed");
    const second = await open();
    for (const order of [
      ["a", "b"],
      ["b", "a"],
      ["a", "a"],
    ]) {
      await page.evaluate((order) => {
        window.lockEntered = false;
        window.lockPending = window.transfer.locks(
          order,
          () =>
            new Promise((resolve) => {
              window.lockEntered = true;
              window.releaseLock = resolve;
            }),
        );
      }, order);
      await page.waitForFunction(() => window.lockEntered);
      assert.equal(
        await second.evaluate(async () => {
          try {
            await window.transfer.locks(["b", "a"], () => "entered");
            return "unexpected-success";
          } catch (error) {
            return error.code;
          }
        }),
        "BUSY",
      );
      await page.evaluate(async () => {
        window.releaseLock();
        await window.lockPending;
      });
      assert.equal(
        await second.evaluate(() => window.transfer.locks(["b", "a"], () => "released")),
        "released",
      );
    }
    // Failure on the second key must release the first key without entering the action.
    await page.evaluate(() => {
      window.lockEntered = false;
      window.lockPending = window.transfer.locks(
        ["b"],
        () =>
          new Promise((resolve) => {
            window.lockEntered = true;
            window.releaseLock = resolve;
          }),
      );
    });
    await page.waitForFunction(() => window.lockEntered);
    assert.equal(
      await second.evaluate(async () => {
        try {
          await window.transfer.locks(["a", "b"], () => "entered");
          return "unexpected-success";
        } catch (error) {
          return error.code;
        }
      }),
      "BUSY",
    );
    assert.equal(await page.evaluate(() => window.transfer.locks(["a"], () => "free")), "free");
    await page.evaluate(async () => {
      window.releaseLock();
      await window.lockPending;
    });
    console.log("Two-tab Web Locks A+B/B+A/A+A, second-key failure and release passed");
  } finally {
    await page.evaluate(async () => {
      window.releaseLock?.();
      await window.lockPending;
      await window.transfer?.cleanup();
    });
    for (const sample of pages) if (!sample.isClosed()) await sample.close();
  }
}
