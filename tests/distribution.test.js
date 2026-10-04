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
import { buildMinimal } from "../scripts/build-runtime.mjs";

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

it("builds a standalone static app with real deep entries and no demo or build dependencies", async () => {
  const output = await workspace();
  await buildMinimal(output);
  async function files(dir, prefix = "") {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((entry) =>
          entry.isDirectory()
            ? files(join(dir, entry.name), prefix + entry.name + "/")
            : [prefix + entry.name],
        ),
      )
    ).flat();
  }
  const publishedFiles = await files(output);
  const workerAssets = publishedFiles.filter((path) =>
    /^runtime\/assets\/mock-api-worker-[\w-]+\.js$/.test(path),
  );
  expect(workerAssets).toHaveLength(1);
  expect(publishedFiles.sort()).toEqual(
    [
      "app.json",
      "boot.js",
      "index.html",
      "pages/home.rhai",
      "pages/home.yaml",
      "pages/home/index.html",
      "runtime/THIRD_PARTY_NOTICES.txt",
      "runtime/engine.wasm",
      "runtime/index.css",
      "runtime/index.js",
      ...workerAssets,
    ].sort(),
  );
  const entry = await readFile(join(output, "pages/home/index.html"), "utf8");
  expect(entry).toContain('src="../../boot.js"');
  expect(entry).toContain('href="../../runtime/index.css"');
  const bootstrap = await readFile(join(output, "boot.js"), "utf8");
  expect(bootstrap).toContain('"./runtime/index.js"');
  expect(bootstrap).not.toContain("../../src/");
  const runtime = await readFile(join(output, "runtime/index.js"), "utf8");
  expect(runtime).toContain(workerAssets[0].replace("runtime/", ""));
  expect(runtime).not.toContain('"/assets/mock-api-worker-');
  expect(runtime).not.toMatch(/SCREEN_CATALOG|screen-select|benchmark|import\.meta\.env/);
  const css = await readFile(join(output, "runtime/index.css"), "utf8");
  expect(css).toContain(".uivolve-runtime");
  expect(css).not.toMatch(/:root|\.topbar|\.comparison|\.source-panel/);
  // Exercise the Bun file server itself: directory route, assets and missing files.
  const handlerModule = new URL("../scripts/serve-minimal.mjs", import.meta.url).href;
  const probe = `import { createStaticHandler } from ${JSON.stringify(handlerModule)};
    const handle = createStaticHandler(${JSON.stringify(output)});
    const result = [];
    for (const path of ["/", "/pages/home", "/pages/home/", "/runtime/engine.wasm", "/pages/missing.yaml", "/runtime/missing.js"]) {
      const response = await handle(new Request("http://localhost" + path));
      result.push([response.status, response.headers.get("content-type")]);
    }
    const head = await handle(new Request("http://localhost/runtime/engine.wasm", { method: "HEAD" }));
    result.push([head.status, (await head.arrayBuffer()).byteLength]);
    console.log(JSON.stringify(result));`;
  const response = spawnSync("bun", ["-e", probe], { encoding: "utf8" });
  expect(response.status, response.stderr).toBe(0);
  expect(JSON.parse(response.stdout)).toEqual([
    [200, "text/html;charset=utf-8"],
    [308, null],
    [200, "text/html;charset=utf-8"],
    [200, "application/wasm"],
    [404, null],
    [404, null],
    [200, 0],
  ]);
}, 30_000);
