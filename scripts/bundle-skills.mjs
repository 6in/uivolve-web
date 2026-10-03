import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const skillNames = ["uivolve-web-app-dev", "uivolve-web-engine-dev"];

function inside(directory, path) {
  const offset = relative(directory, path);
  return (
    offset === "" || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`))
  );
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported skill resource: ${path}`);
  }
  return result;
}

function outsideFences(source, transform) {
  let result = "";
  let offset = 0;
  for (const fence of source.matchAll(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm)) {
    result += transform(source.slice(offset, fence.index)) + fence[0];
    offset = fence.index + fence[0].length;
  }
  return result + transform(source.slice(offset));
}

// Copy each linked source once, rewriting local links so the folder can stand alone.
// Contract documents stay canonical in docs/; only the generated bundle contains copies.
export async function bundleSkill(name, outputRoot) {
  if (!skillNames.includes(name)) throw new Error(`Unknown skill: ${name}`);
  const sourceDirectory = resolve(root, "skills", name);
  const destination = resolve(outputRoot, name);
  await mkdir(outputRoot, { recursive: true });
  const stage = await mkdtemp(resolve(outputRoot, `.${name}-`));
  const targetFor = (source) =>
    inside(sourceDirectory, source)
      ? resolve(stage, relative(sourceDirectory, source))
      : resolve(stage, "references/project", relative(root, source));
  const queue = await files(sourceDirectory);
  const copied = new Set();
  try {
    for (let index = 0; index < queue.length; index++) {
      const source = queue[index];
      if (copied.has(source)) continue;
      if (!inside(root, await realpath(source)))
        throw new Error(`Resource outside repository: ${source}`);
      copied.add(source);
      const target = targetFor(source);
      let content = await readFile(source);
      if (source.endsWith(".md")) {
        content = outsideFences(content.toString("utf8"), (text) =>
          text.replace(
            /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g,
            (match, rawTarget) => {
              const url = rawTarget.replace(/^<|>$/g, "");
              if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return match;
              const [path] = url.split(/[?#]/, 1);
              if (!path) return match;
              const linked = resolve(dirname(source), decodeURIComponent(path));
              if (!inside(root, linked))
                throw new Error(`Link outside repository: ${source} → ${url}`);
              queue.push(linked);
              const rewritten =
                relative(dirname(target), targetFor(linked))
                  .split(sep)
                  .map(encodeURIComponent)
                  .join("/") + url.slice(path.length);
              const next = rawTarget.startsWith("<") ? `<${rewritten}>` : rewritten;
              return match.replace(`(${rawTarget}`, `(${next}`);
            },
          ),
        );
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    // Only replace the named generated bundle; never remove unrelated output files.
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
    return { name, directory: destination, files: copied.size };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  for (const name of skillNames) {
    const result = await bundleSkill(name, resolve(root, ".skill-bundles"));
    console.log(`${result.name}: ${result.files} files → ${relative(root, result.directory)}`);
  }
}
