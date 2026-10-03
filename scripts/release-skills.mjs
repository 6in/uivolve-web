import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleSkill, skillNames } from "./bundle-skills.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(version))
    throw new Error("Use a version such as 0.1.0 or 0.2.0-beta.1");
  return version;
}

export async function releaseSkills({ version, repository = "6in/uivolve-web", outputDirectory }) {
  validateVersion(version);
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
    throw new Error("Use a GitHub owner/repository");
  const output = resolve(outputDirectory || resolve(root, ".skill-release"));
  await mkdir(output, { recursive: true });
  const stage = await mkdtemp(resolve(output, ".plugin-"));
  const plugin = resolve(output, "uivolve-web");
  const archiveName = `uivolve-web-plugin-${version}.zip`;
  const archive = resolve(output, archiveName);
  try {
    const manifest = JSON.parse(
      await readFile(resolve(root, ".claude-plugin/plugin.json"), "utf8"),
    );
    manifest.version = version;
    manifest.repository = `https://github.com/${repository}`;
    await mkdir(resolve(stage, ".claude-plugin"), { recursive: true });
    await writeFile(
      resolve(stage, ".claude-plugin/plugin.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    for (const name of skillNames) await bundleSkill(name, resolve(stage, "skills"));
    await copyFile(
      resolve(root, "THIRD_PARTY_NOTICES.md"),
      resolve(stage, "THIRD_PARTY_NOTICES.md"),
    );
    await rm(plugin, { recursive: true, force: true });
    await rename(stage, plugin);
    await rm(archive, { force: true });
    const result = spawnSync("zip", ["-q", "-r", archive, "."], { cwd: plugin, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`zip failed: ${result.status}`);
    const sha256 = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    const tagName = `skills-v${version}`;
    const marketplace = {
      name: "uivolve-web-skills",
      owner: { name: "6in" },
      plugins: [
        {
          name: manifest.name,
          description: manifest.description,
          version,
          source: {
            source: "archive",
            url: `https://github.com/${repository}/releases/download/${tagName}/${archiveName}`,
            sha256,
          },
        },
      ],
    };
    await writeFile(
      resolve(output, "marketplace.json"),
      JSON.stringify(marketplace, null, 2) + "\n",
    );
    await writeFile(resolve(output, "SHA256SUMS"), `${sha256}  ${archiveName}\n`);
    const info = { version, tagName, archiveName, sha256, bytes: (await stat(archive)).size };
    await writeFile(resolve(output, "release-info.json"), JSON.stringify(info, null, 2) + "\n");
    return { ...info, outputDirectory: output };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const manifest = JSON.parse(await readFile(resolve(root, ".claude-plugin/plugin.json"), "utf8"));
  const result = await releaseSkills({
    version: process.argv[2] || manifest.version,
    repository: process.env.GITHUB_REPOSITORY || "6in/uivolve-web",
  });
  console.log(`${result.archiveName}: ${result.bytes} bytes; SHA-256 ${result.sha256}`);
}
