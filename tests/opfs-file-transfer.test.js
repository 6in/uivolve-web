import { expect, it, vi } from "vite-plus/test";
import { memoryOpfs } from "./helpers/opfs.js";

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
