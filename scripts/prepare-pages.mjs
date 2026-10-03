import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREEN_CATALOG } from "../src/screen-catalog.js";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function preparePages(directory, marketplacePath) {
  const html = await readFile(resolve(directory, "index.html"), "utf8");
  // Pages has no SPA rewrite rule. Known routes get real entry files, including on reload.
  for (const { id } of SCREEN_CATALOG) {
    const route = resolve(directory, "pages", id);
    await mkdir(route, { recursive: true });
    await writeFile(resolve(route, "index.html"), html);
  }
  await writeFile(resolve(directory, ".nojekyll"), "");
  if (marketplacePath) {
    const catalog = JSON.parse(await readFile(marketplacePath, "utf8"));
    if (catalog.name !== "uivolve-web-skills" || !Array.isArray(catalog.plugins))
      throw new Error("Invalid uivolve-web marketplace");
    await copyFile(marketplacePath, resolve(directory, "marketplace.json"));
  } else {
    // A fresh repository can publish its demo before the first skills release.
    await writeFile(
      resolve(directory, "marketplace.json"),
      JSON.stringify(
        {
          name: "uivolve-web-skills",
          owner: { name: "6in" },
          plugins: [],
        },
        null,
        2,
      ) + "\n",
    );
  }
  return SCREEN_CATALOG.map(({ id }) => id);
}

if (import.meta.main) {
  const routes = await preparePages(resolve(root, "dist"), process.argv[2]);
  console.log(`GitHub Pages: ${routes.length} direct screen routes and marketplace.json`);
}
