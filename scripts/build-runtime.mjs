import { build } from "vite-plus";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function buildRuntime(outputDirectory = resolve(root, "runtime-dist")) {
  outputDirectory = resolve(outputDirectory);
  // Only remove our generated runtime directory; Vite must never empty a source tree.
  await mkdir(outputDirectory, { recursive: true });
  await build({
    configFile: false,
    root,
    // Keep Worker assets relative to index.js when runtime/ is deployed under any prefix.
    base: "./",
    publicDir: false,
    logLevel: "warn",
    build: {
      target: "es2022",
      outDir: outputDirectory,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, "src/runtime-entry.js"),
        formats: ["es"],
        fileName: "index",
        cssFileName: "index",
      },
    },
  });
  await copyFile(resolve(root, "public/engine.wasm"), join(outputDirectory, "engine.wasm"));
  await copyFile(
    resolve(root, "THIRD_PARTY_NOTICES.md"),
    join(outputDirectory, "THIRD_PARTY_NOTICES.txt"),
  );
  return outputDirectory;
}

export async function buildMinimal(outputDirectory = resolve(root, "app-dist")) {
  outputDirectory = resolve(outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const example = resolve(root, "examples/minimal");
  await cp(example, outputDirectory, { recursive: true });
  await buildRuntime(join(outputDirectory, "runtime"));
  const bootstrap = (await readFile(join(example, "boot.js"), "utf8"))
    .replace('"../../src/application.js"', '"./runtime/index.js"')
    .replace('"../../engine.wasm"', '"./runtime/engine.wasm"');
  await writeFile(join(outputDirectory, "boot.js"), bootstrap);
  const html = (await readFile(join(example, "index.html"), "utf8")).replace(
    "</head>",
    '<link rel="stylesheet" href="./runtime/index.css" />\n  </head>',
  );
  await writeFile(join(outputDirectory, "index.html"), html);
  const config = JSON.parse(await readFile(join(example, "app.json"), "utf8"));
  // Real entry files also work on static hosts without a SPA fallback rule.
  for (const page of config.pages) {
    const entry = join(outputDirectory, "pages", page.id, "index.html");
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(
      entry,
      html
        .replace('href="./runtime/index.css"', 'href="../../runtime/index.css"')
        .replace('src="./boot.js"', 'src="../../boot.js"'),
    );
  }
  return outputDirectory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv.includes("--minimal")
    ? await buildMinimal()
    : await buildRuntime();
  console.log(`Static files: ${directory}`);
}
