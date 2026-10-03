import { afterEach, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseSkills, validateVersion } from "../scripts/release-skills.mjs";
import { preparePages } from "../scripts/prepare-pages.mjs";
import { SCREEN_CATALOG } from "../src/screen-catalog.js";
import { readPageRoute } from "../src/page-router.js";
import { skillNames } from "../scripts/bundle-skills.mjs";

const temporary = [];
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "uivolve-distribution-"));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("packages only portable skills and links the catalog to the exact release ZIP digest", async () => {
  const output = await workspace();
  const release = await releaseSkills({ version: "0.1.0", outputDirectory: output });
  const archive = join(output, release.archiveName);
  const source = JSON.parse(await readFile(join(output, "marketplace.json"), "utf8"));
  expect(source.plugins).toHaveLength(1);
  expect(source.plugins[0].source).toEqual({
    source: "archive",
    url: "https://github.com/6in/uivolve-web/releases/download/skills-v0.1.0/uivolve-web-plugin-0.1.0.zip",
    sha256: createHash("sha256")
      .update(await readFile(archive))
      .digest("hex"),
  });
  const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  expect(listing.status).toBe(0);
  const entries = listing.stdout.trim().split("\n");
  expect(entries.some((path) => /(?:^|\/)(?:node_modules|target|\.git)\//.test(path))).toBe(false);
  expect(entries.some((path) => path.endsWith(".wasm"))).toBe(false);
  expect(entries.some((path) => /^(?:engine|src|public|tests)\//.test(path))).toBe(false);
  expect(entries.every((path) => !path.startsWith("/") && !path.split("/").includes(".."))).toBe(
    true,
  );
  const unpacked = await workspace();
  expect(spawnSync("unzip", ["-q", archive, "-d", unpacked]).status).toBe(0);
  expect((await readdir(join(unpacked, "skills"))).sort()).toEqual([...skillNames].sort());
  const plugin = JSON.parse(await readFile(join(unpacked, ".claude-plugin/plugin.json"), "utf8"));
  expect(plugin.name).toBe(source.plugins[0].name);
  expect(plugin.version).toBe(source.plugins[0].version);
  for (const name of skillNames) {
    expect(await readFile(join(unpacked, "skills", name, "SKILL.md"), "utf8")).toContain(
      `name: ${name}`,
    );
  }
});

it("rejects invalid release versions before creating files", async () => {
  const output = await workspace();
  for (const version of ["../escape", "1.0", "v1.0.0", "01.0.0", "1.0.0\n", "$(id)"]) {
    expect(() => validateVersion(version)).toThrow();
    await expect(releaseSkills({ version, outputDirectory: output })).rejects.toThrow();
  }
  expect(await readdir(output)).toEqual([]);
});

it("creates real HTML entrypoints for every deep route under the Pages base", async () => {
  const output = await workspace();
  const html = '<script type="module" src="/uivolve-web/assets/main.js"></script>';
  await writeFile(join(output, "index.html"), html);
  await preparePages(output);
  for (const { id } of SCREEN_CATALOG) {
    expect(await readFile(join(output, "pages", id, "index.html"), "utf8")).toBe(html);
    expect(
      readPageRoute(
        `https://6in.github.io/uivolve-web/pages/${id}/`,
        "https://6in.github.io/uivolve-web/",
        SCREEN_CATALOG.map((screen) => screen.id),
      ),
    ).toBe(id);
  }
  const catalog = JSON.parse(await readFile(join(output, "marketplace.json"), "utf8"));
  expect(catalog.plugins).toEqual([]);
  expect(await readFile(join(output, ".nojekyll"), "utf8")).toBe("");
});

it("publishes the released catalog unchanged and rejects a wrong catalog", async () => {
  const output = await workspace();
  await writeFile(join(output, "index.html"), "demo");
  const catalogPath = join(await workspace(), "marketplace.json");
  const catalog = {
    name: "uivolve-web-skills",
    owner: { name: "6in" },
    plugins: [{ name: "uivolve-web" }],
  };
  await writeFile(catalogPath, JSON.stringify(catalog));
  await preparePages(output, catalogPath);
  expect(await readFile(join(output, "marketplace.json"), "utf8")).toBe(JSON.stringify(catalog));
  await writeFile(catalogPath, JSON.stringify({ name: "wrong", plugins: [] }));
  await expect(preparePages(output, catalogPath)).rejects.toThrow(/Invalid/);
});
