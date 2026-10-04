import { httpAdapter } from "../../src/adapters/http.js";
import { ResourceClient } from "../../src/resource-client.js";
import { FileClient } from "../../src/file-client.js";
import { withFileLocks, fileLockKey } from "../../src/opfs.js";

export function harness(api, scope) {
  const resources = new ResourceClient({ baseUrl: api });
  const files = new FileClient();
  const declarations = {
    a: { backend: "opfs", access: "readwrite", handler: "done" },
    b: { backend: "opfs", access: "readwrite", handler: "done" },
  };
  const adapter = httpAdapter({ resources, files });
  const connection = { adapter: "http", baseUrl: api };
  const reference = (volume, path, write = false) =>
    files.transferFile(scope, declarations, volume, path, { write });
  return {
    resources,
    reference,
    async transfer(action, path, args, options = {}, signal = new AbortController().signal) {
      const operation = { action: `http.${action}`, options: { path, ...options } };
      adapter.validate(operation, connection, location.href);
      return adapter.execute(operation, args, { connection, scope, files: declarations, signal });
    },
    async seed(volume, path, text) {
      const writer = await reference(volume, path, true).writable();
      await writer.write(text);
      await writer.close();
    },
    locks(volumes, action) {
      return withFileLocks(
        volumes.map((volume) => fileLockKey(scope, volume)),
        action,
      );
    },
    async cleanup() {
      const root = await navigator.storage.getDirectory();
      try {
        const ui = await root.getDirectoryHandle("uivolve-web");
        const fs = await ui.getDirectoryHandle("fs");
        await fs.removeEntry(scope, { recursive: true });
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
    },
    async guarded(action) {
      const originals = [];
      for (const [prototype, names] of [
        [Blob.prototype, ["arrayBuffer", "text"]],
        [Response.prototype, ["arrayBuffer", "text", "blob"]],
      ]) {
        for (const name of names) {
          originals.push([prototype, name, prototype[name]]);
          prototype[name] = () => {
            throw new Error(`Whole-body read forbidden: ${name}`);
          };
        }
      }
      try {
        return await action();
      } finally {
        for (const [prototype, name, original] of originals) prototype[name] = original;
      }
    },
  };
}
