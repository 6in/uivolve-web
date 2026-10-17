import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMinimal, buildRuntime } from "./build-runtime.mjs";
import { validateVersion } from "./release-skills.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

async function digest(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

// Reproducible tarball: sorted entries, no owner, mtime pinned when SOURCE_DATE_EPOCH is set.
function archive(directory, name, output) {
  const mtime = process.env.SOURCE_DATE_EPOCH ? [`--mtime=@${process.env.SOURCE_DATE_EPOCH}`] : [];
  const result = spawnSync(
    "tar",
    ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", ...mtime, "-czf", output, name],
    { cwd: directory, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar failed: ${result.status}`);
}

/**
 * Build the shared runtime (`runtime-dist`), the minimal static app (`app-dist`) and the bare
 * engine binary, then write release assets with their SHA-256 digests. Requires an up-to-date
 * `public/engine.wasm` (`bun run build:wasm`), exactly like `build:runtime`.
 */
export async function releaseRuntime({ version, outputDirectory }) {
  validateVersion(version);
  const output = resolve(outputDirectory || resolve(root, ".runtime-release"));
  await mkdir(output, { recursive: true });
  const names = {
    runtime: `uivolve-web-runtime-${version}`,
    app: `uivolve-web-minimal-app-${version}`,
    engine: `uivolve-web-engine-${version}.wasm`,
  };
  for (const name of Object.values(names))
    await rm(resolve(output, name), { recursive: true, force: true });
  for (const name of [names.runtime, names.app])
    await rm(resolve(output, `${name}.tar.gz`), { force: true });
  await buildRuntime(resolve(output, names.runtime));
  await buildMinimal(resolve(output, names.app));
  await copyFile(resolve(root, "public/engine.wasm"), resolve(output, names.engine));
  archive(output, names.runtime, resolve(output, `${names.runtime}.tar.gz`));
  archive(output, names.app, resolve(output, `${names.app}.tar.gz`));
  const assets = [];
  for (const name of [`${names.runtime}.tar.gz`, `${names.app}.tar.gz`, names.engine]) {
    const path = resolve(output, name);
    assets.push({ name, sha256: await digest(path), bytes: (await stat(path)).size });
  }
  await writeFile(
    resolve(output, "SHA256SUMS"),
    assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(""),
  );
  const info = { version, tagName: `runtime-v${version}`, assets };
  await writeFile(resolve(output, "release-info.json"), JSON.stringify(info, null, 2) + "\n");
  return { ...info, outputDirectory: output };
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) throw new Error("Usage: bun scripts/release-runtime.mjs <version>");
  const result = await releaseRuntime({ version });
  for (const asset of result.assets)
    console.log(`${asset.name}: ${asset.bytes} bytes; SHA-256 ${asset.sha256}`);
}
