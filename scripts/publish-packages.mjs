import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREEN_CATALOG, screenFile } from "../src/screen-catalog.js";
import { parsePackage, packageFormat } from "../src/package-format.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function publishPackage(sourcePath, output = dirname(sourcePath)) {
  const source = await readFile(sourcePath);
  const screen = parsePackage(source.toString("utf8"), packageFormat(sourcePath));
  const readRelative = async (path) => {
    if (typeof path !== "string" || !path || /^(?:[a-z]+:|\/)/i.test(path))
      throw new Error("配信用ビルダーにはローカルの相対パスを指定してください");
    return readFile(resolve(dirname(sourcePath), path));
  };
  const script = await readRelative(screen.script);
  if (script.length > 100_000) throw new Error("Rhaiは100 KB以内にしてください");
  const descriptors = Object.create(null);
  for (const key of new Set(Object.values(screen.rpc ?? {}).map((r) => r.descriptor))) {
    const bytes = await readRelative(key);
    if (bytes.length > 1_000_000) throw new Error("Descriptorは1 MB以内にしてください");
    descriptors[key] = bytes;
  }
  const revision = hash(
    JSON.stringify([
      hash(source),
      hash(script),
      Object.entries(descriptors)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, bytes]) => [key, hash(bytes)]),
    ]),
  );
  const directory = resolve(output, "packages", revision);
  await mkdir(directory, { recursive: true });
  const entry = async (name, bytes) => {
    await writeFile(resolve(directory, name), bytes);
    return { url: `packages/${revision}/${name}`, sha256: hash(bytes), size: bytes.length };
  };
  const metadata = {
    version: 1,
    revision,
    source: await entry("source", source),
    script: await entry("script", script),
    descriptors: Object.create(null),
  };
  let i = 0;
  for (const [key, bytes] of Object.entries(descriptors))
    metadata.descriptors[key] = await entry(`descriptor-${i++}`, bytes);
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, `${basename(sourcePath)}.manifest.json`),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  return metadata;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2])
    await publishPackage(
      resolve(process.argv[2]),
      process.argv[3] ? resolve(process.argv[3]) : undefined,
    );
  else
    for (const screen of SCREEN_CATALOG)
      await publishPackage(
        fileURLToPath(new URL(`../public/screens/${screenFile(screen.id)}`, import.meta.url)),
      );
}
