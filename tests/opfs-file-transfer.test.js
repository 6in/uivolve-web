import { expect, it, vi } from "vite-plus/test";
import { memoryOpfs } from "./helpers/opfs.js";
import { httpAdapter } from "../src/adapters/http.js";
import { FileClient } from "../src/file-client.js";
import { HostEffects } from "../src/host-effects.js";

function transferValidation(action = "http.download", options = {}) {
  const fs = memoryOpfs();
  const getDirectory = vi.spyOn(fs.storage, "getDirectory");
  const resources = { fetch: vi.fn(), transferRequest: vi.fn() };
  const adapter = httpAdapter({ resources, files: new FileClient({ storage: fs.storage }) });
  const operation = { action, options: { path: "items/{id}", ...options } };
  const connection = { adapter: "http", baseUrl: "https://example.test/api/" };
  const context = {
    scope: "transfer",
    files: { writable: { access: "readwrite" }, readable: { access: "read" } },
    signal: new AbortController().signal,
    connection,
  };
  const file = { volume: "writable", path: "日本語.csv" };
  const args = {
    path: { id: "one" },
    ...(action === "http.multipart" ? { parts: [{ name: "file", file }] } : { file }),
  };
  return { adapter, operation, connection, context, args, resources, getDirectory };
}

it("registers transfer actions and validates declaration methods, deadlines and download-only options", () => {
  expect(httpAdapter({ resources: {} }).actions).toEqual([
    "http.request",
    "http.download",
    "http.upload",
    "http.multipart",
  ]);
  for (const action of ["http.download", "http.upload", "http.multipart"]) {
    const { adapter, operation, connection } = transferValidation(action);
    adapter.validate(operation, connection, new URL("https://example.test/"));
    expect(operation.options).toMatchObject({
      method: action === "http.download" ? "GET" : "POST",
      timeout: 120,
    });
    for (const timeout of [1, 120, 300]) {
      operation.options.timeout = timeout;
      adapter.validate(operation, connection, new URL("https://example.test/"));
    }
    for (const options of [
      { method: "PATCH" },
      { method: null },
      { method: action === "http.download" ? "POST" : "GET" },
      { timeout: 0 },
      { timeout: 301 },
      { timeout: "120" },
      { timeout: null },
      { timeout: Infinity },
      { unknown: true },
      { transferLimit: 999999999 },
      { path: 1 },
      { response: null },
      { overwrite: action === "http.download" ? "yes" : true },
      { progressHandler: action === "http.download" ? 1 : "progress" },
      { headers: { authorization: "secret" } },
      { headers: { accept: 1 } },
      { path: "../outside" },
      { path: "https://evil.test/" },
      { path: "%2e%2e/outside" },
    ]) {
      const invalid = transferValidation(action, options);
      expect(() =>
        invalid.adapter.validate(
          invalid.operation,
          invalid.connection,
          new URL("https://example.test/"),
        ),
      ).toThrow();
    }
  }
  const download = transferValidation("http.download", {
    overwrite: true,
    progressHandler: "progress",
  });
  download.adapter.validate(
    download.operation,
    download.connection,
    new URL("https://example.test/"),
  );
  for (const action of ["http.upload", "http.multipart"]) {
    const put = transferValidation(action, { method: "PUT" });
    put.adapter.validate(put.operation, put.connection, new URL("https://example.test/"));
  }
  const multipart = transferValidation("http.multipart", {
    headers: { "CoNtEnT-TyPe": "multipart/form-data; boundary=x" },
  });
  expect(() =>
    multipart.adapter.validate(
      multipart.operation,
      multipart.connection,
      new URL("https://example.test/"),
    ),
  ).toThrow(/Content-Type/);
});

it("rejects malformed transfer args before fetch or OPFS access", async () => {
  for (const action of ["http.download", "http.upload", "http.multipart"]) {
    const setup = transferValidation(action);
    const { adapter, operation, connection, context, args, resources, getDirectory } = setup;
    adapter.validate(operation, connection, new URL("https://example.test/"));
    const invalidArgs = [
      null,
      [],
      { ...args, body: "bypass" },
      { ...args, unknown: 1 },
      { ...args, path: { id: ".." } },
      { ...args, path: { id: "a/b" } },
      { ...args, query: { value: {} } },
      { ...args, query: { value: "あ".repeat(34_000) } },
    ];
    const badFiles = [
      null,
      {},
      { volume: "missing", path: "a" },
      { volume: 1, path: "a" },
      { volume: "writable", path: "../a" },
      { volume: "writable", path: "/a" },
      { volume: "writable", path: "a\\b" },
      { volume: "writable", path: 1 },
      { volume: "writable", path: "a", extra: true },
    ];
    if (action === "http.download") badFiles.push({ volume: "readable", path: "a" });
    for (const file of badFiles)
      invalidArgs.push(
        action === "http.multipart"
          ? { ...args, parts: [{ name: "file", file }] }
          : { ...args, file },
      );
    if (action === "http.multipart") {
      for (const parts of [
        undefined,
        {},
        [{ name: 1, value: "a" }],
        [{ name: "x", value: 1 }],
        [{ name: "x", file: args.parts[0].file, value: "a" }],
        [{ name: "x" }],
        [{ name: "x", value: "a", filename: "x" }],
        [{ name: "x", value: "a", extra: 1 }],
        [{ name: "x", file: args.parts[0].file, filename: 1 }],
        [{ name: "x", file: args.parts[0].file, contentType: 1 }],
        Array.from({ length: 33 }, () => ({ name: "x", value: "" })),
        Array.from({ length: 9 }, () => args.parts[0]),
      ])
        invalidArgs.push({ ...args, parts });
    }
    for (const invalid of invalidArgs) {
      await expect(adapter.execute(operation, invalid, context)).rejects.toMatchObject({
        code: expect.stringMatching(/^(INVALID_ARGUMENT|LIMIT)$/),
        outcome: "not-started",
      });
    }
    expect(resources.fetch).not.toHaveBeenCalled();
    expect(resources.transferRequest).not.toHaveBeenCalled();
    expect(getDirectory).not.toHaveBeenCalled();
  }
});

it("accepts 32 ordered parts, eight file references and the exact UTF-8 args limit without opening OPFS", async () => {
  const { adapter, operation, connection, context, args, getDirectory } =
    transferValidation("http.multipart");
  adapter.validate(operation, connection, new URL("https://example.test/"));
  args.parts = [
    ...Array.from({ length: 8 }, () => ({
      name: "same",
      file: { volume: "readable", path: "a" },
      filename: "日本語.csv",
      contentType: "text/csv",
    })),
    ...Array.from({ length: 24 }, () => ({ name: "same", value: "" })),
  ];
  // Execution is connected in T6/T7; reaching UNSUPPORTED proves validation accepted the boundary.
  await expect(adapter.execute(operation, args, context)).rejects.toMatchObject({
    code: "UNSUPPORTED",
  });
  args.parts = [{ name: "value", value: "あ" }];
  const size = new TextEncoder().encode(JSON.stringify(args)).length;
  args.parts[0].value += "a".repeat(100_000 - size);
  await expect(adapter.execute(operation, args, context)).rejects.toMatchObject({
    code: "UNSUPPORTED",
  });
  args.parts[0].value += "a";
  await expect(adapter.execute(operation, args, context)).rejects.toMatchObject({ code: "LIMIT" });
  expect(getDirectory).not.toHaveBeenCalled();
});

it("validates host transferLimit and snapshots file declarations in prepared context", async () => {
  expect(httpAdapter({ resources: {} }).transferLimit).toBe(104_857_600);
  for (const transferLimit of [1, 2048, Number.MAX_SAFE_INTEGER])
    expect(httpAdapter({ resources: {}, transferLimit }).transferLimit).toBe(transferLimit);
  for (const transferLimit of [0, -1, 1.5, NaN, Infinity, null, "100", Number.MAX_SAFE_INTEGER + 1])
    expect(() => httpAdapter({ resources: {}, transferLimit })).toThrow(/transferLimit/);
  const setup = transferValidation();
  const complete = vi.fn();
  const effects = new HostEffects({
    adapters: [setup.adapter],
    connections: { api: setup.connection },
    complete,
  });
  const context = { scope: setup.context.scope, files: setup.context.files };
  const prepared = effects.prepare(
    { download: { ...setup.operation, connection: "api", handler: "done" } },
    "https://example.test/",
    context,
  );
  context.files.writable.access = "read";
  context.scope = "changed";
  expect(prepared.get("download").context).toEqual({
    scope: "transfer",
    files: { writable: { access: "readwrite" }, readable: { access: "read" } },
  });
  effects.reset(prepared);
  await effects.run([
    {
      kind: "host",
      v: 1,
      id: 1,
      operation: "download",
      args: { file: { volume: "writable", path: "a" }, path: { id: "one" } },
    },
  ]);
  expect(complete).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ error: expect.objectContaining({ code: "UNSUPPORTED" }) }),
  );
  effects.dispose();
});

it("appends chunks and exposes a File snapshot only after close", async () => {
  const fs = memoryOpfs();
  const handle = await fs.root.getFileHandle("日本語.csv", { create: true });
  const initial = await handle.getFile();
  const writer = await handle.createWritable();
  await writer.write(new Uint8Array([65, 66]));
  await writer.write(new Blob(["C"]));
  expect((await handle.getFile()).size).toBe(0);
  await writer.close();
  const file = await handle.getFile();
  expect(file).toBeInstanceOf(File);
  expect(file.name).toBe("日本語.csv");
  expect(file.size).toBe(3);
  expect(await file.text()).toBe("ABC");
  expect(await new Response(file.stream()).text()).toBe("ABC");
  expect(await file.slice(1).text()).toBe("BC");
  expect(initial.size).toBe(0);
});

it("abort discards staged bytes and empty close commits zero bytes", async () => {
  const fs = memoryOpfs();
  const handle = await fs.root.getFileHandle("data", { create: true });
  const first = await handle.createWritable();
  await first.write("old");
  await first.close();
  const aborted = await handle.createWritable();
  await aborted.write("replacement");
  await aborted.abort();
  expect(await (await handle.getFile()).text()).toBe("old");
  await expect(aborted.close()).rejects.toMatchObject({ name: "InvalidStateError" });
  await (await handle.createWritable()).close();
  expect((await handle.getFile()).size).toBe(0);
});

it.each(["CreateWritable", "Write", "Close", "Abort", "GetFile", "Remove"])(
  "injects %s failures without publishing staged bytes",
  async (stage) => {
    const fs = memoryOpfs();
    const handle = await fs.root.getFileHandle("data", { create: true });
    const seed = await handle.createWritable();
    await seed.write("old");
    await seed.close();
    const writer = await handle.createWritable();
    await writer.write("new");
    const error = new DOMException(stage, "UnknownError");
    fs.controls[`before${stage}`] = async () => {
      throw error;
    };
    const actions = {
      CreateWritable: () => handle.createWritable(),
      Write: () => writer.write("more"),
      Close: () => writer.close(),
      Abort: () => writer.abort(),
      GetFile: () => handle.getFile(),
      Remove: () => fs.root.removeEntry("data"),
    };
    await expect(actions[stage]()).rejects.toBe(error);
    fs.controls[`before${stage}`] = async () => {};
    expect(await (await handle.getFile()).text()).toBe("old");
  },
);

it.each(["Write", "Close", "Abort"])("waits for the %s gate", async (stage) => {
  const fs = memoryOpfs();
  const handle = await fs.root.getFileHandle("data", { create: true });
  const writer = await handle.createWritable();
  let release;
  fs.controls[`before${stage}`] = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const completed = vi.fn();
  const action =
    stage === "Write" ? writer.write("x") : stage === "Close" ? writer.close() : writer.abort();
  const pending = action.then(completed);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(completed).not.toHaveBeenCalled();
  expect((await handle.getFile()).size).toBe(0);
  release();
  await pending;
  expect(completed).toHaveBeenCalledOnce();
});

it("runs verification in order and propagates a missing browser check", async () => {
  const { EventEmitter } = await import("node:events");
  const { TRANSFER_CHECKS, runTransferVerification } =
    await import("../scripts/verify-transfer.mjs");
  const signals = new EventEmitter();
  const calls = [];
  const spawnProcess = (command, args) => {
    calls.push([command, ...args]);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", calls.length === 7 ? 1 : 0));
    return child;
  };
  expect(await runTransferVerification({ spawnProcess, signalTarget: signals })).toBe(1);
  expect(calls).toEqual(TRANSFER_CHECKS);
  expect(signals.eventNames()).toEqual([]);
});

it("stops on a failed child and cleans signal handlers", async () => {
  const { EventEmitter } = await import("node:events");
  const { runTransferVerification } = await import("../scripts/verify-transfer.mjs");
  const signals = new EventEmitter();
  const spawnProcess = vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 9));
    return child;
  });
  expect(await runTransferVerification({ spawnProcess, signalTarget: signals })).toBe(9);
  expect(spawnProcess).toHaveBeenCalledOnce();
  expect(signals.eventNames()).toEqual([]);
});

it("terminates and waits for the active child when interrupted", async () => {
  const { EventEmitter } = await import("node:events");
  const { runTransferVerification } = await import("../scripts/verify-transfer.mjs");
  const signals = new EventEmitter();
  const child = new EventEmitter();
  const terminateChild = vi.fn();
  const spawnProcess = vi.fn(() => child);
  const done = vi.fn();
  const pending = runTransferVerification({
    spawnProcess,
    signalTarget: signals,
    terminateChild,
  }).then(done);
  signals.emit("SIGINT");
  expect(terminateChild).toHaveBeenCalledWith(child);
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  child.emit("close", null);
  await pending;
  expect(done).toHaveBeenCalledWith(130);
  expect(spawnProcess).toHaveBeenCalledOnce();
  expect(signals.eventNames()).toEqual([]);
});

async function lockFixture(web) {
  const { withFileLocks } = await import("../src/opfs.js");
  const held = new Set();
  const calls = [];
  const locks = web
    ? {
        request: async (key, options, callback) => {
          calls.push([key, options]);
          if (held.has(key)) return callback(null);
          held.add(key);
          try {
            return await callback({ name: key });
          } finally {
            held.delete(key);
          }
        },
      }
    : null;
  return {
    run: (keys, action, options = {}) => withFileLocks(keys, action, { ...options, locks }),
    calls,
  };
}
it.each([false, true])(
  "acquires sorted unique locks without waiting (Web Locks=%s)",
  async (web) => {
    const { run, calls } = await lockFixture(web);
    let release;
    const started = vi.fn();
    const pending = run(
      ["T3:B", "T3:A", "T3:A"],
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(run(["T3:A", "T3:B"], started)).rejects.toMatchObject({ code: "BUSY" });
    expect(started).not.toHaveBeenCalled();
    release();
    await pending;
    await run(["T3:A", "T3:A"], started);
    expect(started).toHaveBeenCalledOnce();
    if (web) {
      expect(calls.slice(0, 2).map(([key]) => key)).toEqual(["T3:A", "T3:B"]);
      for (const [, options] of calls)
        expect(options).toEqual({ mode: "exclusive", ifAvailable: true });
    }
  },
);
it.each([false, true])(
  "releases earlier locks on second-region contention and holds aborted work until settle (%s)",
  async (web) => {
    const { run } = await lockFixture(web);
    let release;
    const controller = new AbortController();
    const pending = run(
      ["T3:D"],
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const action = vi.fn();
    await expect(run(["T3:C", "T3:D"], action)).rejects.toMatchObject({ code: "BUSY" });
    expect(action).not.toHaveBeenCalled();
    await run(["T3:C"], action);
    controller.abort();
    await expect(run(["T3:D"], action)).rejects.toMatchObject({ code: "BUSY" });
    release();
    await pending;
    await run(["T3:D"], action);
  },
);
it("limits transfer handles by declaration/path/parents and shares ordinary file locks and limits", async () => {
  const { FileClient } = await import("../src/file-client.js");
  const { withFileLocks, fileLockKey, OpfsDirectory } = await import("../src/opfs.js");
  const fs = memoryOpfs();
  const client = new FileClient({ storage: fs.storage, locks: null });
  const declarations = { work: { access: "readwrite" }, input: { access: "read" } };
  const directory = new OpfsDirectory(["uivolve-web", "fs", "transfer", "work"], {
    storage: fs.storage,
  });
  expect(() => client.transferFile("transfer", declarations, "missing", "x")).toThrow(/未宣言/);
  expect(() =>
    client.transferFile("transfer", declarations, "input", "x", { write: true }),
  ).toThrow(/read-only/);
  expect(() => client.transferFile("transfer", declarations, "work", "../x")).toThrow(/相対/);
  await expect(
    client.transferFile("transfer", declarations, "work", "missing/x", { write: true }).writable(),
  ).rejects.toMatchObject({ name: "NotFoundError" });
  await directory.mkdir("parent");
  const transfer = client.transferFile("transfer", declarations, "work", "parent/large", {
    write: true,
  });
  const writer = await transfer.writable();
  await writer.write(new Uint8Array(1_000_001));
  await writer.close();
  expect((await transfer.file()).size).toBe(1_000_001);
  await expect(directory.read("parent/large")).rejects.toThrow(/上限/);
  await expect(directory.write("small", new Uint8Array(1_000_001))).rejects.toThrow(/上限/);
  const readOnly = client.transferFile("transfer", declarations, "work", "parent/large");
  expect((await readOnly.file()).size).toBe(1_000_001);
  expect(() => readOnly.handle()).toThrow(/read-only/);
  expect(() => readOnly.writable()).toThrow(/read-only/);
  expect(() => readOnly.remove()).toThrow(/read-only/);
  await withFileLocks(
    [fileLockKey("transfer", "work")],
    async () => {
      for (const operation of ["read_text", "write_text", "remove"]) {
        await expect(
          client.execute("transfer", { volume: "work", path: "x", operation, data: "x" }),
        ).rejects.toMatchObject({ code: "BUSY" });
      }
      await client.execute("transfer", { volume: "input", path: "", operation: "stat" });
    },
    { locks: null },
  );
});
