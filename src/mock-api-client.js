import { packageFormat, parsePackage } from "./package-format.js";

export async function createMockApi({ url, resources, workerFactory } = {}) {
  const definition = parsePackage(await resources.text(url), packageFormat(url));
  const worker = workerFactory
    ? workerFactory()
    : new Worker(new URL("./mock-api-worker.js", import.meta.url), { type: "module" });
  const pending = new Map();
  let sequence = 0;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    worker.terminate();
    for (const job of pending.values()) job.reject(new Error("Mock Worker closed"));
    pending.clear();
  };
  worker.addEventListener("message", ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.ok) job.resolve(data.result);
    else job.reject(new Error(data.error));
  });
  worker.addEventListener("error", dispose);
  worker.addEventListener("messageerror", dispose);
  function send(operation, payload = {}, signal) {
    if (disposed) return Promise.reject(new Error("Mock Worker closed"));
    signal?.throwIfAborted();
    if (pending.size >= 64) return Promise.reject(new Error("Mock Worker queue is full"));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => {
        pending.delete(id);
        cleanup();
        reject(signal.reason);
      };
      pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        worker.postMessage({ id, operation, ...payload });
      } catch (error) {
        pending.delete(id);
        cleanup();
        reject(error);
      }
    });
  }
  try {
    await send("init", { definition }, AbortSignal.timeout(15_000));
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    request: (request, signal) => send("request", { request }, signal),
    reset: () => send("reset"),
    dispose,
  };
}
