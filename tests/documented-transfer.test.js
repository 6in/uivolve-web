import { expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { HostEffects } from "../src/host-effects.js";
import { ResourceClient } from "../src/resource-client.js";
import { FileClient } from "../src/file-client.js";
import { httpAdapter } from "../src/adapters/http.js";
import { memoryOpfs } from "./helpers/opfs.js";

it("executes the documented transfer chain and cancellation with real WASM", async () => {
  const document = await readFile(
    new URL("../docs/opfs-file-transfer.md", import.meta.url),
    "utf8",
  );
  const definition = parsePackage(document.match(/```yaml\n([\s\S]*?)\n```/)[1], "yaml");
  const script = document.match(/```rhai\n([\s\S]*?)\n```/)[1];
  const { instance } = await WebAssembly.instantiate(
    await readFile(new URL("../public/engine.wasm", import.meta.url)),
    {},
  );
  const engine = new WasmEngine(instance.exports);
  const fs = memoryOpfs();
  const files = new FileClient({ storage: fs.storage });
  const csv = "name,value\n日本語,1\n";
  const bytes = new TextEncoder().encode(csv);
  let finishDownload;
  let cancelDownload = false;
  const fetch = vi.fn(async (_url, options) => {
    if (options.method === "GET") {
      if (cancelDownload)
        return new Promise((_, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancel", "AbortError")),
            { once: true },
          );
        });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            finishDownload = () => controller.close();
          },
        }),
        { headers: { "Content-Length": String(bytes.length) } },
      );
    }
    return new Response("{}", { headers: { "Content-Type": "application/json" } });
  });
  const source = new URL("https://example.test/app/transfer.yaml");
  const resources = new ResourceClient({ baseUrl: source, fetch });
  let latest;
  const complete = vi.fn((id, result) => (latest = engine.completeHost(id, result)));
  const progress = vi.fn((id, result) => (latest = engine.progressHost(id, result)));
  const effects = new HostEffects({
    adapters: [httpAdapter({ resources, files })],
    connections: { api: { adapter: "http", baseUrl: "https://example.test/api/" } },
    complete,
    progress,
  });
  effects.reset(
    effects.prepare(definition.operations, source, {
      scope: definition.id,
      files: definition.files,
    }),
  );
  engine.load(definition, script);
  let pending;
  try {
    pending = effects.run(engine.dispatch("start").effects);
    await vi.waitFor(() => expect(progress).toHaveBeenCalled());
    expect(latest.state.received).toBe(bytes.length);
    finishDownload();
    finishDownload = undefined;
    await pending;
    expect(latest.state.phase).toBe("done");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url, options]) => [url.pathname, options.method])).toEqual([
      ["/api/csv", "GET"],
      ["/api/upload", "PUT"],
      ["/api/multipart", "POST"],
    ]);
    const upload = fetch.mock.calls[1][1].body;
    expect(upload).toBeInstanceOf(File);
    expect(await upload.text()).toBe(csv);
    const multipart = fetch.mock.calls[2][1].body;
    expect(multipart).toBeInstanceOf(FormData);
    const entries = [...multipart.entries()];
    expect(
      entries.map(([name, value]) => [
        name,
        typeof value === "string" ? value : { name: value.name, type: value.type },
      ]),
    ).toEqual([
      ["tag", "original"],
      ["file", { name: "source.csv", type: "" }],
      ["tag", "copy"],
      ["file", { name: "複製.csv", type: "text/csv" }],
    ]);
    for (const [, file] of entries.filter(([name]) => name === "file"))
      expect(await file.text()).toBe(csv);
    expect(
      await files.execute(definition.id, {
        operation: "read_text",
        volume: "work",
        path: "source.csv",
      }),
    ).toBe(csv);

    cancelDownload = true;
    pending = effects.run(engine.dispatch("start").effects);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    await effects.run(engine.dispatch("cancel").effects);
    await pending;
    expect(complete.mock.calls.at(-1)[1]).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      await files.execute(definition.id, {
        operation: "read_text",
        volume: "work",
        path: "source.csv",
      }),
    ).toBe(csv);
  } finally {
    finishDownload?.();
    effects.dispose();
    await pending;
  }
});
