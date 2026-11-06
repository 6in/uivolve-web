import { afterEach, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSkillsVersion, compareVersions } from "../scripts/check-skills-version.mjs";
import { skillNames } from "../scripts/bundle-skills.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function git(repository, ...args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

async function setVersion(repository, version) {
  await writeFile(
    join(repository, ".claude-plugin/plugin.json"),
    JSON.stringify({ name: "uivolve-web", version, repository: "https://example.test" }) + "\n",
  );
}

// A minimal repository with the real bundler, so the check runs the same code path as CI.
async function repository() {
  const path = await mkdtemp(join(tmpdir(), "uivolve-skills-version-"));
  temporary.push(path);
  await mkdir(join(path, "scripts"));
  await copyFile(join(root, "scripts/bundle-skills.mjs"), join(path, "scripts/bundle-skills.mjs"));
  await mkdir(join(path, ".claude-plugin"));
  await setVersion(path, "0.1.0");
  await writeFile(join(path, "THIRD_PARTY_NOTICES.md"), "notices\n");
  await writeFile(join(path, "guide.md"), "linked guide\n");
  for (const name of skillNames) {
    await mkdir(join(path, "skills", name), { recursive: true });
    await writeFile(
      join(path, "skills", name, "SKILL.md"),
      `---\nname: ${name}\n---\n[guide](../../guide.md)\n`,
    );
  }
  git(path, "init", "-q");
  git(path, "add", ".");
  git(path, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "init");
  git(path, "tag", "skills-v0.1.0");
  return path;
}

it("orders release versions with prereleases before their release", () => {
  expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
  expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
  expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBe(-1);
  expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
  expect(() => compareVersions("v0.2.0", "0.2.0")).toThrow();
});

it("passes while the plugin contents match the released tag of the same version", async () => {
  const path = await repository();
  expect(await checkSkillsVersion({ repository: path })).toMatchObject({ ok: true });
});

it("fails when skills change but the plugin version still names a released tag", async () => {
  const path = await repository();
  await writeFile(join(path, "skills", skillNames[0], "SKILL.md"), `---\nname: x\n---\nnew\n`);
  const result = await checkSkillsVersion({ repository: path });
  expect(result.ok).toBe(false);
  expect(result.message).toContain(`${skillNames[0]}/SKILL.md`);
});

it("fails when a linked document bundled into the plugin changes", async () => {
  const path = await repository();
  await writeFile(join(path, "guide.md"), "changed guide\n");
  const result = await checkSkillsVersion({ repository: path });
  expect(result.ok).toBe(false);
  expect(result.message).toContain("references/project/guide.md");
});

it("ignores the version field itself and accepts a newer unreleased version", async () => {
  const path = await repository();
  await writeFile(join(path, "guide.md"), "changed guide\n");
  await setVersion(path, "0.2.0");
  expect(await checkSkillsVersion({ repository: path })).toMatchObject({ ok: true });
});

it("rejects a version that is not newer than the latest released tag", async () => {
  const path = await repository();
  git(path, "tag", "skills-v0.3.0");
  await setVersion(path, "0.2.0");
  const result = await checkSkillsVersion({ repository: path });
  expect(result.ok).toBe(false);
  expect(result.message).toContain("0.3.0");
});
