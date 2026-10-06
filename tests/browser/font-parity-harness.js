import { createRuntime } from "../../src/runtime.js";

// Browser-side observation for the renderer font-size ledger. Everything here only
// reads: no font declaration is added, no painted pixel is replaced. The Canvas side
// is recorded by the init script installed from tests/browser/font-parity.mjs, which
// delegates to the original fillText / measureText.

function cssPath(element, root) {
  const parts = [];
  for (let node = element; node && node !== root; node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    if (node.classList.length) part += `.${[...node.classList].join(".")}`;
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter((child) => child.tagName === node.tagName)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    parts.unshift(part);
  }
  return parts.join(" > ");
}

function widgetOf(element) {
  const widget = element.closest(".ui-widget");
  if (!widget) return { key: null, target: null, kind: null };
  const kind =
    [...widget.classList]
      .find((name) => name.startsWith("ui-") && name !== "ui-widget")
      ?.slice(3) ?? null;
  return { key: widget.dataset.key ?? null, target: widget.dataset.target ?? null, kind };
}

function roleOf(element, kind, part) {
  const own = [...element.classList].filter(
    (name) => !name.startsWith("ui-") && name !== "selected",
  );
  const head = own[0] ?? element.tagName.toLowerCase();
  return [kind ?? "stage", head, part].filter(Boolean).join(":");
}

function directText(element) {
  let text = "";
  for (const node of element.childNodes)
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue;
  return text.trim();
}

function metrics(element, stage, part, text) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const origin = stage.getBoundingClientRect();
  const widget = widgetOf(element);
  return {
    surface: "dom",
    selector: cssPath(element, stage),
    tag: element.tagName.toLowerCase(),
    classes: [...element.classList],
    key: widget.key,
    target: widget.target,
    kind: widget.kind,
    role: roleOf(element, widget.kind, part),
    part: part ?? "text",
    text,
    visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0,
    fontSize: Number.parseFloat(style.fontSize),
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily,
    lineHeight: style.lineHeight,
    cssWidth: rect.width,
    cssHeight: rect.height,
    x: rect.x - origin.x,
    y: rect.y - origin.y,
  };
}

// Every DOM node that shows characters, including native control values, placeholders
// and select options. Duplicate strings stay distinguishable through selector/key/role.
export function observeDom(stage, label) {
  const records = [];
  for (const element of [stage, ...stage.querySelectorAll("*")]) {
    const text = directText(element);
    if (text) records.push({ stage: label, ...metrics(element, stage, "text", text) });
    const tag = element.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (element.value)
        records.push({ stage: label, ...metrics(element, stage, "value", element.value) });
      if (element.placeholder)
        records.push({
          stage: label,
          ...metrics(element, stage, "placeholder", element.placeholder),
        });
    }
    if (tag === "SELECT")
      for (const option of element.options)
        records.push({
          stage: label,
          ...metrics(element, stage, `option[${option.index}]`, option.textContent ?? ""),
          selected: option.selected,
        });
  }
  return records;
}

function ink(text, font) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 48;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 2, 24);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let pixels = 0;
  let left = canvas.width;
  let right = -1;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
      pixels++;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  return {
    pixels,
    inkWidth: right < 0 ? 0 : right - left + 1,
    measured: ctx.measureText(text).width,
  };
}

// Font *name* evidence (what the stylesheet asks for) is kept apart from font *glyph*
// evidence (what this machine actually painted). An unmapped private-use codepoint gives
// the tofu reference, so "the family name resolved" is never read as "the glyphs exist".
export function fontEvidence(stage) {
  const style = getComputedStyle(stage);
  const family = style.fontFamily;
  const names = family.split(",").map((name) => name.trim().replace(/^["']|["']$/g, ""));
  const samples = { latin: "Abc123", japanese: "日本語テキスト", unmapped: "" };
  return {
    declared: {
      cssFontFamily: family,
      cssFontSize: style.fontSize,
      canvasFont: `400 13px ${family}`,
    },
    available: Object.fromEntries(
      names.map((name) => [
        name,
        Object.fromEntries(
          Object.entries(samples).map(([key, text]) => [
            key,
            document.fonts.check(`13px "${name}"`, text),
          ]),
        ),
      ]),
    ),
    rendered: Object.fromEntries(
      Object.entries(samples).map(([key, text]) => [key, ink(text, `400 13px ${family}`)]),
    ),
    loadedFaces: [...document.fonts].map((face) => ({
      family: face.family,
      status: face.status,
      weight: face.weight,
    })),
  };
}

export function environment(stage, canvas) {
  return {
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    hostFontSize: getComputedStyle(stage.parentElement ?? stage).fontSize,
    stageFontSize: getComputedStyle(stage).fontSize,
    themeMode: stage.dataset.themeMode ?? null,
    themeName: stage.dataset.themeName ?? null,
    prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    fontsStatus: document.fonts.status,
    canvas: canvas
      ? {
          cssWidth: Number.parseFloat(canvas.style.width) || canvas.getBoundingClientRect().width,
          cssHeight:
            Number.parseFloat(canvas.style.height) || canvas.getBoundingClientRect().height,
          bitmapWidth: canvas.width,
          bitmapHeight: canvas.height,
        }
      : null,
  };
}

function sceneRecord(scene) {
  if (!scene) return null;
  return {
    width: scene.width,
    height: scene.height,
    theme: { mode: scene.theme?.mode ?? null, name: scene.theme?.name ?? null },
    widgets: scene.widgets.map((widget) => ({
      key: widget.key,
      target: widget.target,
      kind: widget.kind,
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      layer: widget.layer,
      text: widget.text ?? null,
      value: widget.value ?? null,
      variant: widget.variant ?? null,
      selected: Boolean(widget.selected),
      disabled: Boolean(widget.disabled),
      gridEditor: Boolean(widget.config?.gridEditor),
      monospace: Boolean(widget.config?.monospace),
      align: widget.config?.align ?? null,
    })),
  };
}

// A standalone UiRuntime with its own DOM and Canvas surface: the same host code an
// embedding application runs, without the comparison demo's page chrome.
export async function createFontParityHarness({
  screen = "screens/hello-world.json",
  hostFontSize = "16px",
  theme,
  host = document.getElementById("font-parity-host"),
} = {}) {
  host.textContent = "";
  host.style.fontSize = hostFontSize;
  const domStage = document.createElement("div");
  const canvasStage = document.createElement("div");
  // The recorder keys its buckets on the canvas id, so name the bitmap before the
  // runtime takes ownership of it and paints the first frame.
  const canvas = document.createElement("canvas");
  canvas.id = "font-parity-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "UI Canvas");
  canvasStage.append(canvas);
  host.append(domStage, canvasStage);
  const errors = [];
  const runtime = await createRuntime({
    baseUrl: new URL("/", location.origin),
    wasmUrl: new URL("/engine.wasm", location.origin),
    surfaces: [
      { element: domStage, renderer: "dom" },
      { element: canvasStage, canvas, renderer: "canvas" },
    ],
    onError: (error) => {
      if (error) errors.push(error.message);
    },
  });
  if (theme) runtime.theme(theme);
  await runtime.load(screen);
  await runtime.whenIdle();
  await document.fonts.ready;
  return {
    runtime,
    errors,
    // Repaint after the fonts settled so the recorded Canvas draw calls are the ones
    // the user finally sees, then hand back one JSON record per surface.
    async settle() {
      window.__fontParity?.reset();
      runtime.render();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      await document.fonts.ready;
    },
    observe() {
      return {
        dom: observeDom(domStage, "standalone-dom"),
        scenes: runtime.scenes.map(sceneRecord),
        font: fontEvidence(domStage),
        environment: {
          domStage: environment(domStage, null),
          canvasStage: environment(canvasStage, canvas),
        },
        errors: [...errors],
      };
    },
    dispose() {
      runtime.dispose();
      host.textContent = "";
      host.style.removeProperty("font-size");
    },
  };
}
