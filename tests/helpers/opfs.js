// Faithful small host boundary: directory traversal, type errors and writes committed on close.
export function memoryOpfs() {
  const controls = { beforeClose: async () => {} };
  const missing = () => new DOMException("missing", "NotFoundError");
  function directory() {
    const children = new Map();
    return {
      kind: "directory",
      children,
      async getDirectoryHandle(name, { create = false } = {}) {
        if (!children.has(name) && create) children.set(name, directory());
        const entry = children.get(name);
        if (!entry) throw missing();
        if (entry.kind !== "directory") throw new DOMException("type", "TypeMismatchError");
        return entry;
      },
      async getFileHandle(name, { create = false } = {}) {
        if (!children.has(name) && create) children.set(name, file());
        const entry = children.get(name);
        if (!entry) throw missing();
        if (entry.kind !== "file") throw new DOMException("type", "TypeMismatchError");
        return entry;
      },
      async *entries() {
        yield* children.entries();
      },
      async removeEntry(name, { recursive = false } = {}) {
        const entry = children.get(name);
        if (!entry) throw missing();
        if (entry.kind === "directory" && entry.children.size && !recursive)
          throw new DOMException("not empty", "InvalidModificationError");
        children.delete(name);
      },
    };
  }
  function file() {
    let bytes = new Uint8Array();
    return {
      kind: "file",
      async getFile() {
        return {
          size: bytes.length,
          lastModified: 123,
          arrayBuffer: async () => bytes.slice().buffer,
        };
      },
      async createWritable() {
        let pending,
          aborted = false;
        return {
          async write(value) {
            pending = value.slice();
          },
          async close() {
            await controls.beforeClose();
            if (aborted) throw new DOMException("aborted", "AbortError");
            bytes = pending;
          },
          async abort() {
            aborted = true;
          },
        };
      },
    };
  }
  const root = directory();
  return { storage: { getDirectory: async () => root }, root, controls };
}
