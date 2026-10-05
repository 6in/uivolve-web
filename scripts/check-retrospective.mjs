import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const article = "blog/uivolve-web-retrospective/index.md";
const images = [
  "architecture.png",
  "event-flow.png",
  "host-effects.png",
  "dom-canvas.png",
  "orders.png",
  "ai-workflow.png",
];
const sections = [
  "出発点",
  "共通エンジン",
  "Hello World",
  "通信と保存",
  "WebMCP",
  "WorkerモックとUT",
  "AI開発の振り返り",
  "制限と次の実験",
  "参考リンク",
];

export function withoutFences(source) {
  let fence = null;
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (!fence && match) {
        fence = match[1];
        return false;
      }
      if (fence) {
        if (
          match &&
          match[1][0] === fence[0] &&
          match[1].length >= fence.length &&
          line.trim() === match[1]
        )
          fence = null;
        return false;
      }
      return true;
    })
    .join("\n");
}

export function countText(source) {
  const text = withoutFences(source)
    .replace(/^##\s+[^\n]*参考リンク[^\n]*\n[\s\S]*$/m, "")
    .replace(/!\[[^\]]*\]\([^\n]*?\)/g, "")
    .replace(/\[([^\]]+)\]\((?:<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/^\s*\[[^\]]+\]:[^\n]*$/gm, "")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_~`|]/g, "")
    .replace(/\s/gu, "");
  return [...text].length;
}

export function measureArticle(source) {
  const clean = withoutFences(source);
  const headings = [...clean.matchAll(/^##\s+(.+)$/gm)];
  if (headings.length !== sections.length || headings.some((h, i) => !h[1].includes(sections[i])))
    throw new Error(`Required ordered H2 sections: ${sections.join(" → ")}`);
  const counts = headings.slice(0, -1).map((h, i) => ({
    section: sections[i],
    characters: countText(clean.slice(h.index, headings[i + 1].index)),
  }));
  const total = countText(source);
  const ai = counts[6].characters;
  return { total, ai, aiRatio: ai / total, sections: counts };
}

export function assertLength({ total, aiRatio }) {
  if (total < 6000 || total > 9000) throw new Error(`Body length ${total}; expected 6000–9000`);
  if (aiRatio < 0.05 || aiRatio > 0.15) throw new Error(`AI ratio ${aiRatio}; expected 5–15%`);
}

// Decode ordinary non-interlaced 8-bit PNG scanlines; generated browser PNGs use this format.
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("Invalid PNG signature");
  let offset = 8;
  let header;
  let ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== bytes.readUInt32BE(offset + 8 + length))
      throw new Error(`PNG CRC mismatch: ${type}`);
    if (!header && type !== "IHDR") throw new Error("PNG must start with IHDR");
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("Invalid IHDR");
      header = data;
    }
    if (type === "IDAT") compressed.push(data);
    offset += length + 12;
    if (type === "IEND") {
      ended = length === 0;
      break;
    }
  }
  if (!header || !ended || offset !== bytes.length || !compressed.length)
    throw new Error("Incomplete PNG");
  const width = header.readUInt32BE(0),
    height = header.readUInt32BE(4);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header[9]];
  if (
    !width ||
    !height ||
    width > 10000 ||
    height > 10000 ||
    !channels ||
    header[8] !== 8 ||
    header[10] ||
    header[11] ||
    header[12]
  )
    throw new Error("Unsupported PNG dimensions/encoding");
  const stride = width * channels;
  const decoded = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: (stride + 1) * height,
  });
  if (decoded.length !== (stride + 1) * height) throw new Error("Invalid PNG scanline length");
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)];
    if (filter > 4) throw new Error("Invalid PNG filter");
    const row = decoded.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0,
        b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? Math.floor((a + b) / 2)
              : filter === 4
                ? pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
                : 0;
      row[x] = (row[x] + predictor) & 255;
    }
    previous = row;
  }
  return { width, height };
}

export async function checkArticle({ stage = "complete", cwd = root } = {}) {
  if (!["draft", "diagrams", "complete"].includes(stage))
    throw new Error(`Unknown stage: ${stage}`);
  const path = resolve(cwd, article),
    directory = dirname(path);
  const source = await readFile(path, "utf8");
  const measurement = measureArticle(source);
  assertLength(measurement);
  const fences = [...source.matchAll(/^\s*```(\w+)[^\n]*\n([\s\S]*?)^\s*```\s*$/gm)];
  for (const language of ["json", "rhai", "javascript"])
    if (!fences.some((f) => f[1] === language && f[2].trim()))
      throw new Error(`Missing ${language} excerpt`);
  if (!source.includes("抜粋")) throw new Error("Missing excerpt label");
  const clean = withoutFences(source);
  // Reference-style links and HTML images are intentionally outside this article's inline-link contract.
  if (
    /^\s*\[[^\]]+\]:/m.test(clean) ||
    /!?\[[^\]]+\]\s*\[[^\]]*\]/.test(clean) ||
    /<img\b/i.test(clean)
  )
    throw new Error("Use inline Markdown links/images");
  const links = [...clean.matchAll(/(!?)\[([^\]]*)\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)];
  for (const name of images) {
    const matches = links.filter((l) => l[1] && l[3] === `./${name}`);
    if (
      matches.length !== 1 ||
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(matches[0][2])
    )
      throw new Error(`Expected one relative image with Japanese alt: ${name}`);
  }
  for (const [, image, , raw] of links) {
    const target = raw.replace(/^<|>$/g, "");
    if (image && !images.some((name) => target === `./${name}`))
      throw new Error(`Unexpected image: ${target}`);
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
    if (target.startsWith("/")) throw new Error(`Absolute local link: ${target}`);
    const local = decodeURIComponent(target.split(/[?#]/, 1)[0]);
    if (!local) continue;
    if (image && (stage === "draft" || (stage === "diagrams" && local === "./dom-canvas.png")))
      continue;
    await access(resolve(directory, local));
  }
  for (const target of [
    "public/screens/hello-world.json",
    "public/screens/hello-world.rhai",
    "tests/engine.test.js",
    "tests/worker-mock.test.js",
  ])
    if (
      !links.some(
        (l) =>
          !l[1] &&
          (resolve(directory, l[3].split(/[?#]/, 1)[0]) === resolve(cwd, target) ||
            l[3].split(/[?#]/, 1)[0] ===
              `https://github.com/6in/uivolve-web/blob/main/${target}`),
      )
    )
      throw new Error(`Missing complete example link: ${target}`);
  const dimensions = {};
  for (const name of stage === "draft" ? [] : stage === "diagrams" ? images.slice(0, 3) : images)
    dimensions[name] = decodePng(await readFile(resolve(directory, name)));
  if (stage === "complete") {
    const actual = (await readdir(directory)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(["index.md", ...images].sort()))
      throw new Error(`Article directory must contain exactly ${images.length + 1} files`);
    const entry = withoutFences(await readFile(resolve(cwd, "docs/README.md"), "utf8"));
    const entries = [
      ...entry.matchAll(/(?<!!)\[[^\]]+\]\(\.\.\/blog\/uivolve-web-retrospective\/index\.md\)/g),
    ];
    if (entries.length !== 1) throw new Error("Expected exactly one docs entry");
  }
  return { stage, ...measurement, dimensions };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--stage"))
      throw new Error(
        "Usage: bun scripts/check-retrospective.mjs [--stage draft|diagrams|complete]",
      );
    console.log(JSON.stringify(await checkArticle({ stage: args[1] ?? "complete" }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
