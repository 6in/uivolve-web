import { expect, it, vi } from "vite-plus/test";
import { memoryOpfs } from "./helpers/opfs.js";
import { httpAdapter } from "../src/adapters/http.js";
import { FileClient } from "../src/file-client.js";
import { HostEffects } from "../src/host-effects.js";

function transferValidation(action = "http.download", options = {}, transferLimit = 104_857_600) {
  const fs = memoryOpfs();
  const getDirectory = vi.spyOn(fs.storage, "getDirectory");
  const resources = {
    fetch: vi.fn(),
    transferRequest: vi.fn(async () => new Response(null, { status: 200 })),
  };
  const adapter = httpAdapter({
    resources,
    transferLimit,
    files: new FileClient({ storage: fs.storage }),
  });
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
  return { adapter, operation, connection, context, args, resources, getDirectory, fs };
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

it("accepts 32 ordered parts, eight file references and the exact UTF-8 args limit", async () => {
  const { adapter, operation, connection, context, args, fs } = transferValidation(
    "http.multipart",
    { response: "empty" },
  );
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
  const reference = new FileClient({ storage: fs.storage }).transferFile(
    "transfer",
    { readable: { access: "readwrite" } },
    "readable",
    "a",
    { write: true },
  );
  const writer = await reference.writable();
  await writer.close();
  await expect(adapter.execute(operation, args, context)).resolves.toMatchObject({
    files: Array.from({ length: 8 }, () => ({ volume: "readable", path: "a", size: 0 })),
  });
  args.parts = [{ name: "value", value: "あ" }];
  const size = new TextEncoder().encode(JSON.stringify(args)).length;
  args.parts[0].value += "a".repeat(100_000 - size);
  await expect(adapter.execute(operation, args, context)).resolves.toMatchObject({ files: [] });
  args.parts[0].value += "a";
  await expect(adapter.execute(operation, args, context)).rejects.toMatchObject({ code: "LIMIT" });
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
    expect.objectContaining({ ok: true, data: expect.objectContaining({ body: null }) }),
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

async function downloadFixture(options = {}, limit = 4) {
  const setup = transferValidation("http.download", options, limit);
  setup.adapter.validate(setup.operation, setup.connection, new URL("https://example.test/"));
  const reference = new FileClient({ storage: setup.fs.storage }).transferFile(
    setup.context.scope,
    setup.context.files,
    setup.args.file.volume,
    setup.args.file.path,
    { write: true },
  );
  const controller = new AbortController();
  setup.context.signal = controller.signal;
  return {
    ...setup,
    reference,
    controller,
    run: () => setup.adapter.execute(setup.operation, setup.args, setup.context),
    seed: async () => {
      const writer = await reference.writable();
      await writer.write("old");
      await writer.close();
    },
    stream: (chunks, headers = {}, status = 200) => {
      const read = vi.fn(async () =>
        chunks.length ? { value: new Uint8Array(chunks.shift()), done: false } : { done: true },
      );
      const cancel = vi.fn(async () => {});
      const releaseLock = vi.fn();
      const response = {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        body: { getReader: () => ({ read, cancel, releaseLock }) },
        blob: vi.fn(() => {
          throw new Error("whole body");
        }),
        arrayBuffer: vi.fn(() => {
          throw new Error("whole body");
        }),
        text: vi.fn(() => {
          throw new Error("whole body");
        }),
      };
      setup.resources.transferRequest.mockResolvedValue(response);
      return { read, cancel, releaseLock, response };
    },
  };
}

it.each([0, 3, 4, 5])("streams %s decoded bytes with an exact capacity boundary", async (size) => {
  const f = await downloadFixture();
  const chunks = size ? [Array.from({ length: Math.min(size, 3) }, () => 65)] : [];
  if (size > 3) chunks.push(Array.from({ length: size - 3 }, () => 66));
  const stream = f.stream(chunks);
  const writes = vi.fn();
  f.fs.controls.beforeWrite = writes;
  if (size > 4) {
    await expect(f.run()).rejects.toMatchObject({ code: "LIMIT", outcome: "failed" });
    expect(writes).toHaveBeenCalledTimes(1);
    await expect(f.reference.file()).rejects.toMatchObject({ name: "NotFoundError" });
    expect(stream.cancel).toHaveBeenCalledOnce();
  } else {
    await expect(f.run()).resolves.toEqual({
      status: 200,
      headers: {},
      body: null,
      files: [{ ...f.args.file, size }],
    });
    expect((await f.reference.file()).size).toBe(size);
  }
  expect(stream.response.blob).not.toHaveBeenCalled();
  expect(stream.response.arrayBuffer).not.toHaveBeenCalled();
  expect(stream.response.text).not.toHaveBeenCalled();
});

it.each([
  [{}, true],
  [{ "content-length": "4" }, true],
  [{ "content-length": "bad" }, true],
  [{ "content-length": "1" }, true],
  [{ "content-length": "5" }, false],
  [{ "content-length": "99", "content-encoding": "gzip" }, true],
])("uses decoded capacity regardless of response headers %j", async (headers, accepted) => {
  const f = await downloadFixture();
  const stream = f.stream(
    [
      [1, 2],
      [3, 4],
    ],
    headers,
  );
  if (accepted) await expect(f.run()).resolves.toMatchObject({ files: [{ size: 4 }] });
  else {
    await expect(f.run()).rejects.toMatchObject({ code: "LIMIT" });
    expect(stream.read).not.toHaveBeenCalled();
  }
});

it("rejects gzip decoded overflow and preserves the previous file", async () => {
  const f = await downloadFixture({ overwrite: true });
  await f.seed();
  f.stream(
    [
      [1, 2, 3],
      [4, 5],
    ],
    { "content-length": "2", "content-encoding": "gzip" },
  );
  await expect(f.run()).rejects.toMatchObject({ code: "LIMIT" });
  expect(await (await f.reference.file()).text()).toBe("old");
});

it("rejects overwrite by default, allows atomic replacement and requires existing parents", async () => {
  const f = await downloadFixture();
  await f.seed();
  await expect(f.run()).rejects.toMatchObject({ code: "ALREADY_EXISTS", outcome: "not-started" });
  expect(f.resources.transferRequest).not.toHaveBeenCalled();
  f.operation.options.overwrite = true;
  f.stream([[65, 66]], { "x-result": "yes" });
  f.operation.options.responseHeaders = ["x-result"];
  await expect(f.run()).resolves.toMatchObject({ headers: { "x-result": "yes" } });
  expect(await (await f.reference.file()).text()).toBe("AB");
  f.args.file.path = "missing/data";
  await expect(f.run()).rejects.toMatchObject({ code: "STORAGE" });
});

it.each([400, 401, 403, 500])("cancels non-2xx %s without creating a file", async (status) => {
  const f = await downloadFixture();
  const stream = f.stream([], {}, status);
  await expect(f.run()).rejects.toMatchObject({ code: `HTTP_${status}` });
  expect(stream.cancel).toHaveBeenCalledOnce();
  expect(stream.read).not.toHaveBeenCalled();
  await expect(f.reference.file()).rejects.toMatchObject({ name: "NotFoundError" });
});

it.each(["CreateWritable", "Write", "Close"])(
  "handles any %s exception and rolls back old/new files",
  async (stage) => {
    for (const existing of [false, true]) {
      for (const error of [
        new Error("host failure"),
        new DOMException("failure", "QuotaExceededError"),
        new DOMException("failure", "UnexpectedError"),
      ]) {
        const f = await downloadFixture({ overwrite: true });
        if (existing) await f.seed();
        f.stream([[1], [2]]);
        f.fs.controls[`before${stage}`] = async () => {
          throw error;
        };
        await expect(f.run()).rejects.toMatchObject({ code: "STORAGE", outcome: "failed" });
        if (existing) expect(await (await f.reference.file()).text()).toBe("old");
        else await expect(f.reference.file()).rejects.toMatchObject({ name: "NotFoundError" });
      }
    }
  },
);

it("handles reader failures without publishing bytes", async () => {
  const f = await downloadFixture({ overwrite: true });
  await f.seed();
  const stream = f.stream([[1]]);
  stream.read.mockRejectedValueOnce(new DOMException("read", "UnexpectedError"));
  await expect(f.run()).rejects.toMatchObject({ code: "NETWORK" });
  expect(stream.cancel).toHaveBeenCalledOnce();
  expect(await (await f.reference.file()).text()).toBe("old");
});

it.each(["Abort", "Remove"])(
  "reports %s cleanup failure after attempting all cleanup",
  async (stage) => {
    const f = await downloadFixture();
    const stream = f.stream([[1], [2, 3, 4, 5]]);
    const abort = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    f.fs.controls.beforeAbort = abort;
    f.fs.controls.beforeRemove = remove;
    f.fs.controls[`before${stage}`].mockRejectedValueOnce(new Error("cleanup"));
    await expect(f.run()).rejects.toMatchObject({ code: "CLEANUP", outcome: "failed" });
    expect(abort).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(stream.cancel).toHaveBeenCalledOnce();
  },
);

it("awaits reader cancellation, writer abort and removal while holding the lock", async () => {
  const f = await downloadFixture();
  const stream = f.stream([[1], [2, 3, 4, 5]]);
  const gates = [];
  for (const stage of [stream.cancel, "beforeAbort", "beforeRemove"]) {
    const wait = () => new Promise((resolve) => gates.push(resolve));
    if (typeof stage === "string") f.fs.controls[stage] = wait;
    else stage.mockImplementation(wait);
  }
  const done = vi.fn();
  const pending = f.run().catch(done);
  for (let i = 0; i < 3; i++) {
    await vi.waitFor(() => expect(gates).toHaveLength(i + 1));
    await expect(f.run()).rejects.toMatchObject({ code: "BUSY" });
    expect(done).not.toHaveBeenCalled();
    gates[i]();
  }
  await pending;
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ code: "LIMIT" }));
});

it.each(["Write", "Close"])(
  "waits for %s on cancellation and respects close commit",
  async (stage) => {
    const f = await downloadFixture({ overwrite: true });
    await f.seed();
    f.stream([[65]]);
    let release;
    f.fs.controls[`before${stage}`] = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = f.run();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    f.controller.abort();
    await expect(f.run()).rejects.toBeDefined();
    release();
    if (stage === "Close") {
      await expect(pending).resolves.toMatchObject({ files: [{ size: 1 }] });
      expect(await (await f.reference.file()).text()).toBe("A");
    } else {
      await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
      expect(await (await f.reference.file()).text()).toBe("old");
    }
  },
);

it("cancels a pending reader and removes only the new uncommitted entry", async () => {
  const f = await downloadFixture();
  const stream = f.stream([]);
  let finish;
  stream.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  stream.cancel.mockImplementation(async () => {
    finish({ done: true });
  });
  const pending = f.run();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  expect(stream.cancel).toHaveBeenCalledOnce();
  await expect(f.reference.file()).rejects.toMatchObject({ name: "NotFoundError" });
});

it("awaits each write before reading another chunk", async () => {
  const f = await downloadFixture();
  const stream = f.stream([[1], [2]]);
  let release;
  f.fs.controls.beforeWrite = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = f.run();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(stream.read).toHaveBeenCalledTimes(1);
  f.fs.controls.beforeWrite = async () => {};
  release();
  await pending;
  expect(stream.read).toHaveBeenCalledTimes(3);
});

it("retains the old file on fetch failure and checks host exceptions before fetch", async () => {
  const f = await downloadFixture({ overwrite: true });
  await f.seed();
  f.resources.transferRequest.mockRejectedValueOnce(new Error("secret"));
  await expect(f.run()).rejects.toMatchObject({
    code: "NETWORK",
    message: "HTTP通信・認証に失敗しました",
  });
  expect(await (await f.reference.file()).text()).toBe("old");
  f.resources.transferRequest.mockClear();
  f.fs.controls.beforeGetFileHandle = async () => {
    throw new DOMException("host", "UnexpectedError");
  };
  await expect(f.run()).rejects.toMatchObject({ code: "STORAGE" });
  expect(f.resources.transferRequest).not.toHaveBeenCalled();
});

it("reports reader cancel errors and still aborts and removes the new file", async () => {
  const f = await downloadFixture();
  const stream = f.stream([[1], [2, 3, 4, 5]]);
  stream.cancel.mockRejectedValueOnce(new Error("cancel"));
  const aborted = vi.fn();
  f.fs.controls.beforeAbort = aborted;
  await expect(f.run()).rejects.toMatchObject({ code: "CLEANUP" });
  expect(aborted).toHaveBeenCalledOnce();
  await expect(f.reference.file()).rejects.toMatchObject({ name: "NotFoundError" });
});

it("waits for cancellation during a successful close without deleting committed bytes", async () => {
  const f = await downloadFixture();
  const stream = f.stream([[65]]);
  let close;
  let cancel;
  f.fs.controls.beforeClose = () =>
    new Promise((resolve) => {
      close = resolve;
    });
  stream.cancel.mockImplementation(
    () =>
      new Promise((resolve) => {
        cancel = resolve;
      }),
  );
  const done = vi.fn();
  const pending = f.run().then(done);
  await vi.waitFor(() => expect(close).toBeTypeOf("function"));
  f.controller.abort();
  close();
  await vi.waitFor(async () => expect(await (await f.reference.file()).text()).toBe("A"));
  expect(done).not.toHaveBeenCalled();
  cancel();
  await pending;
  expect(done).toHaveBeenCalledWith(
    expect.objectContaining({ files: [{ ...f.args.file, size: 1 }] }),
  );
});

async function uploadFixture(action = "http.upload", options = {}, limit = 4) {
  const f = transferValidation(action, options, limit);
  f.adapter.validate(f.operation, f.connection, new URL("https://example.test/"));
  const client = new FileClient({ storage: f.fs.storage });
  const seed = async (volume, path, value) => {
    const reference = client.transferFile(f.context.scope, f.context.files, volume, path, {
      write: true,
    });
    const writer = await reference.writable();
    await writer.write(value);
    await writer.close();
  };
  await seed("writable", "日本語.csv", "abc");
  f.resources.transferRequest.mockResolvedValue(
    new Response('{"saved":true}', { headers: { "x-result": "yes", "x-secret": "hidden" } }),
  );
  return { ...f, client, seed, run: () => f.adapter.execute(f.operation, f.args, f.context) };
}

it("sends File bodies for POST/PUT and returns bounded json/text/empty metadata", async () => {
  for (const method of ["POST", "PUT"]) {
    for (const response of ["json", "text", "empty"]) {
      const f = await uploadFixture("http.upload", {
        method,
        response,
        responseHeaders: ["x-result"],
      });
      const result = await f.run();
      const request = f.resources.transferRequest.mock.calls[0][1];
      expect(request.method).toBe(method);
      expect(request.body).toBeInstanceOf(File);
      expect(request.body.name).toBe("日本語.csv");
      expect(request.body.size).toBe(3);
      expect(request.body.type).toBe("");
      expect(request.headers.has("content-type")).toBe(false);
      expect(result).toEqual({
        status: 200,
        headers: { "x-result": "yes" },
        body:
          response === "empty" ? null : response === "text" ? '{"saved":true}' : { saved: true },
        files: [{ ...f.args.file, size: 3 }],
      });
    }
  }
});

it("appends ordered multipart values and files with default and explicit filenames/types", async () => {
  for (const method of ["POST", "PUT"]) {
    const f = await uploadFixture("http.multipart", { method }, 6);
    f.args.parts = [
      { name: "same", value: "" },
      { name: "same", file: { volume: "writable", path: "日本語.csv" } },
      { name: "same", value: "日本語" },
      {
        name: "other",
        file: { volume: "writable", path: "日本語.csv" },
        filename: "別名.csv",
        contentType: "text/csv",
      },
    ];
    const result = await f.run();
    const request = f.resources.transferRequest.mock.calls[0][1];
    const entries = [...request.body.entries()];
    expect(entries.map(([name]) => name)).toEqual(["same", "same", "same", "other"]);
    expect(entries[0][1]).toBe("");
    expect(entries[2][1]).toBe("日本語");
    expect(entries[1][1].name).toBe("日本語.csv");
    expect(entries[1][1].type).toBe("");
    expect(entries[3][1].name).toBe("別名.csv");
    expect(entries[3][1].type).toBe("text/csv");
    expect(request.headers.has("content-type")).toBe(false);
    expect(result.files).toHaveLength(2);
  }
});

it("counts repeated file parts and refuses excess or missing files before sending", async () => {
  const f = await uploadFixture("http.multipart", {}, 5);
  f.args.parts = Array.from({ length: 2 }, () => ({
    name: "f",
    file: { volume: "writable", path: "日本語.csv" },
  }));
  await expect(f.run()).rejects.toMatchObject({ code: "LIMIT", outcome: "not-started" });
  f.args.parts = [{ name: "f", file: { volume: "writable", path: "missing" } }];
  await expect(f.run()).rejects.toMatchObject({ code: "STORAGE", outcome: "not-started" });
  expect(f.resources.transferRequest).not.toHaveBeenCalled();
});

it("preserves send outcomes and cancels non-success bodies", async () => {
  const f = await uploadFixture();
  f.resources.transferRequest.mockRejectedValueOnce(new Error("secret"));
  await expect(f.run()).rejects.toMatchObject({ code: "NETWORK", outcome: "unknown" });
  f.resources.transferRequest.mockRejectedValueOnce(
    Object.assign(new Error("secret"), { outcome: "not-started" }),
  );
  await expect(f.run()).rejects.toMatchObject({ outcome: "not-started" });
  const cancel = vi.fn(async () => {});
  f.resources.transferRequest.mockResolvedValueOnce({ ok: false, status: 403, body: { cancel } });
  await expect(f.run()).rejects.toMatchObject({ code: "HTTP_403", outcome: "unknown" });
  expect(cancel).toHaveBeenCalledOnce();
  for (const body of ["invalid json", new Uint8Array([255]), "x".repeat(900001)]) {
    f.resources.transferRequest.mockResolvedValueOnce(new Response(body));
    await expect(f.run()).rejects.toMatchObject({ code: "INVALID_RESPONSE", outcome: "committed" });
  }
  expect(f.resources.transferRequest).toHaveBeenCalledTimes(6);
});

it("keeps the volume locked through response parsing without reading file bytes in JS", async () => {
  const f = await uploadFixture();
  const arrayBuffer = vi.spyOn(Blob.prototype, "arrayBuffer");
  const text = vi.spyOn(Blob.prototype, "text");
  let release;
  f.resources.transferRequest.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          release = () => {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          };
        },
      }),
    ),
  );
  const pending = f.run();
  await vi.waitFor(() => expect(f.resources.transferRequest).toHaveBeenCalledOnce());
  await expect(
    f.client.execute(f.context.scope, {
      volume: "writable",
      path: "日本語.csv",
      operation: "read_text",
    }),
  ).rejects.toMatchObject({ code: "BUSY" });
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(text).not.toHaveBeenCalled();
  release();
  await pending;
  expect(
    await f.client.execute(f.context.scope, {
      volume: "writable",
      path: "日本語.csv",
      operation: "read_text",
    }),
  ).toBe("abc");
  arrayBuffer.mockRestore();
  text.mockRestore();
});

it.each([
  [{ "content-length": "4" }, [4, 4]],
  [{}, [null, null]],
  [{ "content-length": "bad" }, [null, null]],
  [{ "content-length": "4", "content-encoding": "gzip" }, [null, null]],
  [{ "content-length": "1" }, [null, null]],
])("reports stored download bytes with trustworthy totals %j", async (headers, totals) => {
  const fixture = await downloadFixture();
  fixture.context.progress = vi.fn();
  fixture.stream(
    [
      [65, 66],
      [67, 68],
    ],
    headers,
  );
  await fixture.run();
  expect(fixture.context.progress.mock.calls.map(([data]) => data)).toEqual([
    { transferred: 2, total: totals[0] },
    { transferred: 4, total: totals[1] },
  ]);
});
