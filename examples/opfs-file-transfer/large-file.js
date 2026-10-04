import { FileClient } from "../../src/file-client.js";
import { withFileLock } from "../../src/opfs.js";

export async function generateLargeFile({ storage, locks } = {}) {
  const files = new FileClient({ storage, locks });
  const ref = files.transferFile(
    "opfs-file-transfer",
    { workspace: { access: "readwrite" } },
    "workspace",
    "large.bin",
    { write: true },
  );
  return withFileLock(
    ref.key,
    async () => {
      const writer = await ref.writable();
      try {
        const chunk = new Uint8Array(65536).fill(97);
        for (let i = 0; i < 1600; i++) await writer.write(chunk);
        await writer.close();
      } catch (error) {
        await writer.abort();
        throw error;
      }
      return 104857600;
    },
    { locks },
  );
}
