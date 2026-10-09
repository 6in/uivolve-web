import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, basename, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCREEN_CATALOG, screenFile } from "../src/screen-catalog.js";
import { parsePackage, packageFormat } from "../src/package-format.js";
import { manifestRevision } from "../src/application-loader.js";
import { instanceTable } from "../src/component-tree.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
const localRelative = (path) => {
  if (typeof path !== "string" || !path || /^(?:[a-z]+:|\/)/i.test(path))
    throw new Error("配信用ビルダーにはローカルの相対パスを指定してください");
  return path;
};
// One package read against the directory of the file that declares it, so a child resolves its own
// script and descriptors the way the delivered child will. The root and every child share the gate.
async function readPackage(filePath) {
  const source = await readFile(filePath);
  const screen = parsePackage(source.toString("utf8"), packageFormat(filePath));
  const readRelative = (path) => readFile(resolve(dirname(filePath), localRelative(path)));
  const script = await readRelative(screen.script);
  if (script.length > 100_000) throw new Error("Rhaiは100 KB以内にしてください");
  const descriptors = Object.create(null);
  for (const key of new Set(Object.values(screen.rpc ?? {}).map((r) => r.descriptor))) {
    const bytes = await readRelative(key);
    if (bytes.length > 1_000_000) throw new Error("Descriptorは1 MB以内にしてください");
    descriptors[key] = bytes;
  }
  return { source, screen, script, descriptors };
}
export async function publishPackage(sourcePath, output = dirname(sourcePath)) {
  const root = await readPackage(sourcePath);
  // The declarations are walked depth first exactly as the loader walks them, each declared url
  // rewritten to the absolute file it resolves to. The rewrite lands on a clone so the Instance
  // count can be judged by `instanceTable` without the published screen ever seeing it.
  const rootClone = structuredClone(root.screen);
  const packages = Object.create(null);
  const visit = async (parent, declaringFile, depth, stack) => {
    for (const [name, declaration] of Object.entries(parent.components ?? {})) {
      if (typeof declaration?.url !== "string")
        throw new Error(
          `コンポーネント ${name} の宣言が不正です（url を文字列で指定してください）`,
        );
      const childPath = fileURLToPath(
        new URL(localRelative(declaration.url), pathToFileURL(declaringFile)),
      );
      declaration.url = childPath;
      if (stack.includes(childPath))
        throw new Error(`コンポーネント ${name} の循環参照: ${childPath}`);
      if (depth + 1 > 3) throw new Error(`コンポーネントの入れ子が3段を超えています: ${childPath}`);
      if (packages[childPath]) continue;
      const child = await readPackage(childPath);
      packages[childPath] = child;
      await visit(child.screen, childPath, depth + 1, [...stack, childPath]);
    }
  };
  await visit(rootClone, sourcePath, 1, [sourcePath]);
  instanceTable(rootClone, sourcePath, packages);
  // Children are keyed by their path relative to the root screen in posix form, so the loader
  // resolves the key of a manifest entry to the same href the declaration resolves to.
  const children = Object.entries(packages)
    .map(([childPath, read]) => [
      relative(dirname(sourcePath), childPath).split(sep).join("/"),
      read,
    ])
    .sort(byKey);
  // Descriptors travel over the buffer ABI rather than the request, so only bodies and scripts
  // count here; the loader repeats the same sum over the sizes the manifest names.
  const weight = (read) => read.source.length + read.script.length;
  const total = children.reduce((sum, [, read]) => sum + weight(read), weight(root));
  if (total > 2_000_000) {
    // `parsePackage` refuses a body over 1 MB and `readPackage` a script over 100 KB, so the root
    // alone tops out at 1.1 MB and cannot reach the limit: a child is always there to be named.
    const [key, bytes] = children
      .map(([key, read]) => [key, weight(read)])
      .sort((a, b) => b[1] - a[1] || byKey(a, b))[0];
    throw new Error(
      `配信ファイルの合計が2 MBを超えています（合計 ${total} バイト。最大の子: ${key} ${bytes} バイト）`,
    );
  }
  // The revision covers the hashes alone, so the whole tree is composed and hashed before anything
  // is written: the url every entry carries names the directory the revision just decided, and a
  // refusal above leaves no `packages/` directory and no sidecar behind.
  const file = (name, bytes) => ({ name, bytes, sha256: hash(bytes), size: bytes.length });
  const hashed = (read, prefix) => {
    const descriptors = Object.create(null);
    const keys = Object.keys(read.descriptors).sort();
    for (let n = 0; n < keys.length; n++)
      descriptors[keys[n]] = file(`${prefix}descriptor-${n}`, read.descriptors[keys[n]]);
    return {
      source: file(`${prefix}source`, read.source),
      script: file(`${prefix}script`, read.script),
      descriptors,
    };
  };
  const tree = { version: 2, ...hashed(root, ""), components: Object.create(null) };
  for (const [i, [key, read]] of children.entries())
    tree.components[key] = hashed(read, `component-${i}-`);
  const revision = await manifestRevision(tree);
  const delivered = ({ name, sha256, size }) => ({
    url: `packages/${revision}/${name}`,
    sha256,
    size,
  });
  const deliveredPackage = (value) => {
    const descriptors = Object.create(null);
    for (const [key, entry] of Object.entries(value.descriptors))
      descriptors[key] = delivered(entry);
    return { source: delivered(value.source), script: delivered(value.script), descriptors };
  };
  const components = Object.create(null);
  for (const [key, child] of Object.entries(tree.components))
    components[key] = deliveredPackage(child);
  const metadata = { version: 2, revision, ...deliveredPackage(tree), components };
  const directory = resolve(output, "packages", revision);
  await mkdir(directory, { recursive: true });
  for (const value of [tree, ...Object.values(tree.components)])
    for (const entry of [value.source, value.script, ...Object.values(value.descriptors)])
      await writeFile(resolve(directory, entry.name), entry.bytes);
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
