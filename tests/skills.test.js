import { afterEach, expect, it } from "vite-plus/test";
import { access, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { bundleSkill, skillNames } from "../scripts/bundle-skills.mjs";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";

const temporary = [];
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "uivolve-skills-"));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function markdown(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await markdown(path)));
    else if (entry.name.endsWith(".md")) result.push(path);
  }
  return result;
}

it.each(skillNames)(
  "makes %s usable after moving it outside the source repository",
  async (name) => {
    const output = await workspace();
    const bundle = await bundleSkill(name, output);
    const detached = join(await workspace(), name);
    await rename(bundle.directory, detached);
    const entry = await readFile(join(detached, "SKILL.md"), "utf8");
    const frontmatter = parse(entry.match(/^---\n([\s\S]*?)\n---/)[1]);
    expect(frontmatter.name).toBe(name);
    expect(frontmatter.description.length).toBeGreaterThan(0);
    const metadata = parse(await readFile(join(detached, "agents/openai.yaml"), "utf8"));
    expect(metadata.interface.default_prompt).toContain(`$${name}`);
    expect(metadata.policy?.allow_implicit_invocation).not.toBe(false);
    for (const file of await markdown(detached)) {
      const source = (await readFile(file, "utf8")).replace(
        /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm,
        "",
      );
      for (const match of source.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g)) {
        const target = match[1].replace(/^<|>$/g, "");
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
        const path = resolve(dirname(file), decodeURIComponent(target.split(/[?#]/, 1)[0]));
        const offset = relative(detached, path);
        expect(isAbsolute(offset) || offset.startsWith("..")).toBe(false);
        await access(path);
      }
    }
  },
);

it("runs the distributed YAML/Rhai starter through the actual engine and its state validation", async () => {
  const { directory } = await bundleSkill("uivolve-web-app-dev", await workspace());
  const sample = join(directory, "assets/hello-world");
  const screen = parsePackage(await readFile(join(sample, "hello-world.yaml"), "utf8"), "yaml");
  const script = await readFile(join(sample, screen.script), "utf8");
  const bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const engine = new WasmEngine(instance.exports, bytes.length);
  engine.load(screen, script);
  engine.dispatch("nameInput", { value: "  太郎  " });
  const greeting = engine.dispatch("helloButton");
  expect(greeting.state.greeting).toBe("Hello 太郎");
  for (const width of [320, 640]) {
    expect(engine.layout(width).widgets.find((widget) => widget.key === "greetingLabel").text).toBe(
      "Hello 太郎",
    );
  }
  expect(() => engine.dispatch("nameInput", { value: "a".repeat(81) })).toThrow(/stateSchema/);
  expect(engine.dispatch("helloButton").state).toEqual(greeting.state);
  engine.dispatch("nameInput", { value: " \t " });
  expect(engine.dispatch("helloButton").state.greeting).toBe("Hello World");
});

it("regenerates only its own bundle and retains sibling output files", async () => {
  const output = await workspace();
  await writeFile(join(output, "keep.txt"), "keep");
  const first = await bundleSkill("uivolve-web-app-dev", output);
  await writeFile(join(first.directory, "obsolete.txt"), "old generated file");
  const second = await bundleSkill("uivolve-web-app-dev", output);
  await expect(access(join(second.directory, "obsolete.txt"))).rejects.toThrow();
  expect(await readFile(join(output, "keep.txt"), "utf8")).toBe("keep");
  expect(await readFile(join(second.directory, "SKILL.md"), "utf8")).toContain(
    "name: uivolve-web-app-dev",
  );
});
