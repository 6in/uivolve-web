import { readdir, readFile, access } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// The transfer guide is a required entry point, even if removed from the link graph.
await access(resolve(root, "docs/opfs-file-transfer.md"));
async function markdown(directory) {
  const files = await Promise.all(
    (await readdir(directory, { withFileTypes: true })).map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? markdown(path) : entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return files.flat();
}
const files = [
  ...["README.md", "CONTRIBUTING.md", "THIRD_PARTY_NOTICES.md"].map((file) => resolve(root, file)),
  ...(await markdown(resolve(root, "docs"))),
  ...(await markdown(resolve(root, "skills"))),
];
const failures = [];
let checked = 0;
for (const file of files) {
  // Fenced examples are source material, not live Markdown links.
  const source = (await readFile(file, "utf8")).replace(
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm,
    "",
  );
  for (const match of source.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
    const path = target.split(/[?#]/, 1)[0];
    if (!path) continue;
    checked++;
    try {
      await access(resolve(dirname(file), decodeURIComponent(path)));
    } catch {
      failures.push(`${relative(root, file)} → ${target}`);
    }
  }
}
if (failures.length) {
  console.error(
    `Missing local documentation targets (${failures.length}):\n${failures.join("\n")}`,
  );
  process.exitCode = 1;
} else
  console.log(
    `Documentation links: ${checked} local targets checked in ${files.length} Markdown files.`,
  );
