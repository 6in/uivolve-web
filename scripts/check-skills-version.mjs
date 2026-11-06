import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-z0-9]+(?:[.-][a-z0-9]+)*))?$/;

// Semver order for the subset release-skills accepts; a prerelease sorts before its release.
export function compareVersions(left, right) {
  const [a, b] = [left, right].map((version) => {
    const match = VERSION.exec(version);
    if (!match) throw new Error(`Invalid version: ${version}`);
    return match;
  });
  for (let index = 1; index <= 3; index++) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return Math.sign(difference);
  }
  if (a[4] === b[4]) return 0;
  if (!a[4]) return 1;
  if (!b[4]) return -1;
  return a[4] < b[4] ? -1 : 1;
}

function git(repository, args, options = {}) {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 1 << 30, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.toString().trim()}`);
  return result.stdout;
}

async function digests(directory, base = directory, result = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await digests(path, base, result);
    else
      result.set(
        relative(base, path),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      );
  }
  return result;
}

// Fingerprint what the plugin ZIP would carry, using the bundler that belongs to the tree.
// The version and repository fields are excluded because release-skills rewrites them.
export async function pluginContents(tree) {
  const { bundleSkill, skillNames } = await import(
    pathToFileURL(resolve(tree, "scripts/bundle-skills.mjs")).href
  );
  const output = await mkdtemp(join(tmpdir(), "uivolve-skill-check-"));
  try {
    for (const name of skillNames) await bundleSkill(name, output);
    const result = await digests(output);
    const manifest = JSON.parse(
      await readFile(resolve(tree, ".claude-plugin/plugin.json"), "utf8"),
    );
    delete manifest.version;
    delete manifest.repository;
    result.set(".claude-plugin/plugin.json", JSON.stringify(manifest));
    result.set(
      "THIRD_PARTY_NOTICES.md",
      createHash("sha256")
        .update(await readFile(resolve(tree, "THIRD_PARTY_NOTICES.md")))
        .digest("hex"),
    );
    return result;
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

export async function checkSkillsVersion({ repository = root } = {}) {
  const manifest = JSON.parse(
    await readFile(resolve(repository, ".claude-plugin/plugin.json"), "utf8"),
  );
  const version = manifest.version;
  if (!VERSION.test(version ?? ""))
    return { ok: false, message: `.claude-plugin/plugin.json の version が不正です: ${version}` };
  const released = git(repository, ["tag", "--list", "skills-v*"])
    .toString()
    .split("\n")
    .map((tag) => tag.trim().replace(/^skills-v/, ""))
    .filter((tag) => VERSION.test(tag))
    .sort(compareVersions);
  if (!released.length)
    return { ok: true, message: `skills-v* のタグがありません（版 ${version}）` };
  const latest = released.at(-1);

  if (!released.includes(version)) {
    if (compareVersions(version, latest) <= 0)
      return {
        ok: false,
        message: `plugin.json の版 ${version} が公開済みの最新 ${latest} より新しくありません`,
      };
    return { ok: true, message: `未公開の版 ${version}（公開済みの最新は ${latest}）` };
  }

  const tree = await mkdtemp(join(tmpdir(), "uivolve-skill-tag-"));
  try {
    const archive = git(repository, ["archive", "--format=tar", `skills-v${version}`]);
    const extracted = spawnSync("tar", ["-x", "-C", tree], { input: archive });
    if (extracted.status !== 0) throw new Error(`tar failed: ${extracted.stderr?.toString()}`);
    const changed = changedPaths(await pluginContents(tree), await pluginContents(repository));
    if (!changed.length)
      return { ok: true, message: `プラグインの中身は skills-v${version} と同じです` };
    return {
      ok: false,
      message: [
        `プラグインの中身が skills-v${version} から変わっているのに、plugin.json の版が ${version} のままです。`,
        `.claude-plugin/plugin.json の version を ${latest} より新しい版に上げてください。`,
        `変わったファイル（${changed.length} 件）:`,
        ...changed.slice(0, 20).map((path) => `  ${path}`),
        ...(changed.length > 20 ? [`  ほか ${changed.length - 20} 件`] : []),
      ].join("\n"),
    };
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const result = await checkSkillsVersion();
  if (result.ok) console.log(result.message);
  else {
    console.error(result.message);
    process.exitCode = 1;
  }
}
