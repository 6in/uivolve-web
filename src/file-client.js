import { OpfsDirectory, relativePath, safeName, withFileLock } from "./opfs.js";

export class FileClient {
  constructor({ engine, storage, locks } = {}) {
    this.engine = engine;
    this.storage = storage;
    this.locks = locks;
  }
  async execute(scope, effect, { signal } = {}) {
    if (!safeName(scope) || !safeName(effect.volume)) throw new Error("ファイル領域が不正です");
    const { operation, path } = effect;
    if (
      ![
        "read_text",
        "write_text",
        "read_bytes",
        "write_bytes",
        "mkdir",
        "list",
        "stat",
        "remove",
      ].includes(operation)
    )
      throw new Error("未対応のファイル操作です");
    relativePath(path, { root: ["list", "stat"].includes(operation) });
    const directory = new OpfsDirectory(["uivolve-web", "fs", scope, effect.volume], {
      storage: this.storage,
    });
    return withFileLock(
      `uivolve-web:file:${scope}:${effect.volume}`,
      async () => {
        const options = { signal };
        if (operation === "read_text") {
          const bytes = await directory.read(path, options);
          if (bytes.length > 100_000) throw new Error("テキストは100 KB以内にしてください");
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        }
        if (operation === "read_bytes") return directory.read(path, options);
        if (operation === "write_text" || operation === "write_bytes") {
          let bytes;
          if (operation === "write_text") {
            if (typeof effect.data !== "string") throw new Error("テキストを指定してください");
            bytes = new TextEncoder().encode(effect.data);
            if (bytes.length > 100_000) throw new Error("テキストは100 KB以内にしてください");
          } else bytes = this.engine.readBuffer(effect.buffer);
          await directory.write(path, bytes, options);
          return null;
        }
        const result = await directory[operation](path, options);
        return result ?? null;
      },
      { signal, locks: this.locks },
    );
  }
}
