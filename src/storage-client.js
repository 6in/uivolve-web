// Browser capability adapter. The engine declares records, operations and callbacks.
const limit = 1_000_000;
const safeKey = (key) => typeof key === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(key);
const capability = (read) => {
  try {
    return read();
  } catch {
    return undefined;
  }
};
const checkSize = (text) => {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > limit)
    throw new Error("保存JSONは1 MB以内にしてください");
  return text;
};

export class StorageClient {
  #active = new Set();
  constructor({
    indexedDB = capability(() => globalThis.indexedDB),
    storage = capability(() => globalThis.navigator?.storage),
  } = {}) {
    this.indexedDB = indexedDB;
    this.storage = storage;
  }

  async execute(scope, effect, { signal } = {}) {
    if (!safeKey(scope) || !safeKey(effect.key)) throw new Error("保存領域・キーが不正です");
    if (!["read", "write", "remove"].includes(effect.operation))
      throw new Error("保存操作が不正です");
    signal?.throwIfAborted();
    const record = JSON.stringify([scope, effect.backend, effect.key]);
    if (this.#active.has(record))
      throw new Error("前の保存操作が終了していません。完了後に再試行してください");
    this.#active.add(record);
    try {
      const text = effect.operation === "write" ? checkSize(JSON.stringify(effect.data)) : null;
      let result;
      if (effect.backend === "indexeddb")
        result = await this.#database(scope, effect, text, signal);
      else if (effect.backend === "opfs") result = await this.#files(scope, effect, text, signal);
      else throw new Error("未対応の保存方式です");
      signal?.throwIfAborted();
      return result === null || result === undefined ? null : JSON.parse(checkSize(result));
    } finally {
      this.#active.delete(record);
    }
  }

  async #database(scope, effect, text, signal) {
    if (!this.indexedDB) throw new Error("このブラウザではIndexedDBを利用できません");
    const db = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open("uivolve-web", 1);
      let cancelled = false;
      const abort = () => {
        cancelled = true;
        reject(signal.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      const clean = () => signal?.removeEventListener("abort", abort);
      request.onupgradeneeded = () => {
        if (cancelled) {
          request.transaction.abort();
          return;
        }
        if (!request.result.objectStoreNames.contains("pages"))
          request.result.createObjectStore("pages");
      };
      request.onsuccess = () => {
        clean();
        if (cancelled) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => {
        clean();
        reject(request.error);
      };
      request.onblocked = () => {
        cancelled = true;
        clean();
        reject(new Error("IndexedDBを開けません。他のタブを閉じて再試行してください"));
      };
    });
    db.onversionchange = () => db.close();
    try {
      signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(
          "pages",
          effect.operation === "read" ? "readonly" : "readwrite",
        );
        const abort = () => {
          try {
            transaction.abort();
          } catch {
            /* Already committed. */
          }
        };
        signal?.addEventListener("abort", abort, { once: true });
        const clean = () => signal?.removeEventListener("abort", abort);
        let result = null;
        transaction.oncomplete = () => {
          clean();
          resolve(result);
        };
        transaction.onabort = () => {
          clean();
          reject(transaction.error || signal?.reason || new Error("保存が中止されました"));
        };
        const store = transaction.objectStore("pages");
        const key = JSON.stringify([scope, effect.key]);
        const request =
          effect.operation === "read"
            ? store.get(key)
            : effect.operation === "write"
              ? store.put(text, key)
              : store.delete(key);
        request.onsuccess = () => {
          if (effect.operation === "read") result = request.result ?? null;
        };
        // Request errors abort the transaction by default. Completion means committed, not just request success.
      });
    } finally {
      db.close();
    }
  }

  async #files(scope, effect, text, signal) {
    if (!this.storage?.getDirectory)
      throw new Error("このブラウザではOPFSを利用できません（HTTPSまたはlocalhostが必要です）");
    const create = effect.operation === "write";
    let directory;
    try {
      directory = await this.storage.getDirectory();
      signal?.throwIfAborted();
      directory = await directory.getDirectoryHandle("uivolve-web", { create });
      signal?.throwIfAborted();
      directory = await directory.getDirectoryHandle(scope, { create });
      signal?.throwIfAborted();
      if (effect.operation === "remove") {
        await directory.removeEntry(`${effect.key}.json`);
        return null;
      }
      const file = await directory.getFileHandle(`${effect.key}.json`, { create });
      signal?.throwIfAborted();
      if (effect.operation === "read") {
        const blob = await file.getFile();
        if (blob.size > limit) throw new Error("保存JSONが1 MBを超えています");
        signal?.throwIfAborted();
        return await blob.text();
      }
      const writer = await file.createWritable();
      try {
        signal?.throwIfAborted();
        await writer.write(text);
        signal?.throwIfAborted();
        await writer.close();
      } catch (error) {
        try {
          await writer.abort();
        } catch {
          /* A completed close cannot be rolled back. */
        }
        throw error;
      }
      return null;
    } catch (error) {
      if (!create && error.name === "NotFoundError") return null;
      throw error;
    }
  }
}
