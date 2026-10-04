const safeName = (name) => typeof name === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(name);
export { safeName };
export function relativePath(path, { root = false } = {}) {
  if (root && path === "") return [];
  if (
    typeof path !== "string" ||
    !path ||
    new TextEncoder().encode(path).length > 1024 ||
    /[\\\0]/.test(path)
  )
    throw new Error("領域内の相対ファイルパスを指定してください");
  const parts = path.split("/");
  if (
    parts.length > 16 ||
    parts.some((p) => !p || p === "." || p === ".." || new TextEncoder().encode(p).length > 255)
  )
    throw new Error("領域内の相対ファイルパスを指定してください");
  return parts;
}
function storageCapability() {
  try {
    return globalThis.navigator?.storage;
  } catch {
    return undefined;
  }
}
function lockCapability() {
  try {
    return globalThis.navigator?.locks;
  } catch {
    return undefined;
  }
}
const active = new Set();
export function fileLockKey(scope, volume) {
  if (!safeName(scope) || !safeName(volume)) throw new Error("ファイル領域が不正です");
  return `uivolve-web:file:${scope}:${volume}`;
}
function busy() {
  return Object.assign(new Error("前のファイル操作が終了していません"), { code: "BUSY" });
}
export async function withFileLocks(keys, action, { signal, locks = lockCapability() } = {}) {
  const ordered = [...new Set(keys)].sort();
  const acquire = async (index) => {
    signal?.throwIfAborted();
    if (index === ordered.length) return action();
    const key = ordered[index];
    const run = async () => {
      signal?.throwIfAborted();
      if (active.has(key)) throw busy();
      active.add(key);
      try {
        return await acquire(index + 1);
      } finally {
        active.delete(key);
      }
    };
    return locks?.request
      ? locks.request(key, { mode: "exclusive", ifAvailable: true }, (lock) => {
          if (!lock) throw busy();
          return run();
        })
      : run();
  };
  return acquire(0);
}
export function withFileLock(key, action, options = {}) {
  return withFileLocks([key], action, options);
}

// Shared host adapter for page volumes and the loader's separate cache namespace.
export class OpfsDirectory {
  constructor(parts, { storage = storageCapability(), limit = 1_000_000 } = {}) {
    this.parts = parts;
    this.storage = storage;
    this.limit = limit;
  }
  async directory(parts = [], { create = false, signal } = {}) {
    if (!this.storage?.getDirectory)
      throw new Error("このブラウザではOPFSを利用できません（HTTPSまたはlocalhostが必要です）");
    signal?.throwIfAborted();
    let handle = await this.storage.getDirectory();
    for (const name of [...this.parts, ...parts]) {
      signal?.throwIfAborted();
      handle = await handle.getDirectoryHandle(name, { create });
    }
    signal?.throwIfAborted();
    return handle;
  }
  async fileHandle(path, { create = false, signal } = {}) {
    const parts = relativePath(path);
    const name = parts.pop();
    let directory = await this.directory([], { create, signal });
    for (const part of parts) {
      signal?.throwIfAborted();
      directory = await directory.getDirectoryHandle(part);
    }
    signal?.throwIfAborted();
    const handle = await directory.getFileHandle(name, { create });
    signal?.throwIfAborted();
    return handle;
  }
  async file(path, options = {}) {
    const handle = await this.fileHandle(path, options);
    const file = await handle.getFile();
    options.signal?.throwIfAborted();
    return file;
  }
  async writable(path, options = {}) {
    const handle = await this.fileHandle(path, { ...options, create: true });
    return handle.createWritable();
  }
  async read(path, { signal } = {}) {
    const parts = relativePath(path);
    const name = parts.pop();
    const directory = await this.directory(parts, { signal });
    const handle = await directory.getFileHandle(name);
    signal?.throwIfAborted();
    const file = await handle.getFile();
    if (file.size > this.limit) throw new Error("ファイルのサイズ上限を超えています");
    const data = new Uint8Array(await file.arrayBuffer());
    signal?.throwIfAborted();
    return data;
  }
  async write(path, data, { signal } = {}) {
    const parts = relativePath(path);
    if (!(data instanceof Uint8Array) || data.length > this.limit)
      throw new Error("ファイルのサイズ上限を超えています");
    const name = parts.pop();
    // Create the namespace, but require explicitly created parent directories.
    let directory = await this.directory([], { create: true, signal });
    for (const part of parts) {
      signal?.throwIfAborted();
      directory = await directory.getDirectoryHandle(part);
    }
    const handle = await directory.getFileHandle(name, { create: true });
    signal?.throwIfAborted();
    const writer = await handle.createWritable();
    try {
      signal?.throwIfAborted();
      await writer.write(data);
      signal?.throwIfAborted();
      await writer.close();
      signal?.throwIfAborted();
    } catch (error) {
      try {
        await writer.abort();
      } catch {
        /* close may already have committed. */
      }
      throw error;
    }
  }
  async mkdir(path, options = {}) {
    await this.directory(relativePath(path), { ...options, create: true });
  }
  async list(path, options = {}) {
    const directory = await this.directory(relativePath(path, { root: true }), options);
    const result = [];
    for await (const [name, handle] of directory.entries()) {
      options.signal?.throwIfAborted();
      if (result.length >= 256) throw new Error("ディレクトリの一覧は256件以内にしてください");
      result.push({ name, kind: handle.kind });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  async stat(path, options = {}) {
    const parts = relativePath(path, { root: true });
    if (!parts.length) {
      try {
        await this.directory([], options);
        return { exists: true, kind: "directory" };
      } catch (e) {
        if (e.name === "NotFoundError") return { exists: false };
        throw e;
      }
    }
    const name = parts.pop();
    try {
      const directory = await this.directory(parts, options);
      let handle;
      try {
        handle = await directory.getFileHandle(name);
      } catch (e) {
        if (e.name !== "TypeMismatchError") throw e;
        await directory.getDirectoryHandle(name);
        return { exists: true, kind: "directory" };
      }
      const file = await handle.getFile();
      options.signal?.throwIfAborted();
      return { exists: true, kind: "file", size: file.size, lastModified: file.lastModified };
    } catch (e) {
      if (e.name === "NotFoundError") return { exists: false };
      throw e;
    }
  }
  async remove(path, options = {}) {
    const parts = relativePath(path);
    const name = parts.pop();
    const directory = await this.directory(parts, options);
    options.signal?.throwIfAborted();
    await directory.removeEntry(name); // Empty directories only; no recursive page deletion.
    options.signal?.throwIfAborted();
  }
}
