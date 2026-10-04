// Faithful small host boundary: directory traversal, type errors and writes committed on close.
export function memoryOpfs() {
  const controls = Object.fromEntries(
    [
      "GetDirectory",
      "GetDirectoryHandle",
      "GetFileHandle",
      "GetFile",
      "CreateWritable",
      "Write",
      "Close",
      "Abort",
      "Remove",
    ].map((stage) => [`before${stage}`, async () => {}]),
  );
  const missing = () => new DOMException("missing", "NotFoundError");
  function directory() {
    const children = new Map();
    return {
      kind: "directory",
      children,
      async getDirectoryHandle(name, { create = false } = {}) {
        await controls.beforeGetDirectoryHandle(name);
        if (!children.has(name) && create) children.set(name, directory());
        const entry = children.get(name);
        if (!entry) throw missing();
        if (entry.kind !== "directory") throw new DOMException("type", "TypeMismatchError");
        return entry;
      },
      async getFileHandle(name, { create = false } = {}) {
        await controls.beforeGetFileHandle(name);
        if (!children.has(name) && create) children.set(name, file(name));
        const entry = children.get(name);
        if (!entry) throw missing();
        if (entry.kind !== "file") throw new DOMException("type", "TypeMismatchError");
        return entry;
      },
      async *entries() {
        yield* children.entries();
      },
      async removeEntry(name, { recursive = false } = {}) {
        await controls.beforeRemove(name);
        const entry = children.get(name);
        if (!entry) throw missing();
        if (entry.kind === "directory" && entry.children.size && !recursive)
          throw new DOMException("not empty", "InvalidModificationError");
        children.delete(name);
      },
    };
  }
  function file(name) {
    let bytes = new Uint8Array();
    return {
      kind: "file",
      async getFile() {
        await controls.beforeGetFile(name);
        return new File([bytes], name, { lastModified: 123 });
      },
      async createWritable() {
        await controls.beforeCreateWritable(name);
        const chunks = [];
        let ended = false;
        const checkOpen = () => {
          if (ended) throw new DOMException("closed", "InvalidStateError");
        };
        return {
          async write(value) {
            checkOpen();
            await controls.beforeWrite(value, name);
            checkOpen();
            chunks.push(new Uint8Array(await new Blob([value]).arrayBuffer()));
          },
          async close() {
            checkOpen();
            await controls.beforeClose(name);
            checkOpen();
            bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
            ended = true;
          },
          async abort() {
            await controls.beforeAbort(name);
            ended = true;
            chunks.length = 0;
          },
        };
      },
    };
  }
  const root = directory();
  return {
    storage: {
      getDirectory: async () => {
        await controls.beforeGetDirectory();
        return root;
      },
    },
    root,
    controls,
  };
}
