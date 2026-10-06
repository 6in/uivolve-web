import { createRuntime } from "../../src/runtime.js";
import { resolveFontMetrics, FONT_ROLES } from "../../src/font-metrics.js";

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

// The CSS parent context a text node was measured in. The reset defect was a context
// defect — a component's own declaration losing to an inherited value — so every record
// carries its context and the role checks assert each context separately.
//
// Only the containers the host really nests in the DOM can appear here. Panels and
// fieldsets position their children absolutely at the stage/layer level (no parentKey in
// the Scene), so a widget "inside a panel" has the stage as its CSS parent and reports
// `root`; the panel's own box is measured as its own role instead.
const CONTEXT_MARKERS = [
  ["popup", "ui-menu-surface"],
  ["grid-row", "ui-grid-row"],
  ["grid-head", "ui-grid-head"],
  ["grid-shell", "ui-grid-shell"],
  ["tree-shell", "ui-tree-shell"],
  ["kanban-lane", "ui-kanban-lane"],
  ["tabbar", "ui-tabbar"],
  ["panel", "ui-panel"],
  ["panel", "ui-fieldset"],
  ["window", "ui-window"],
];

// The context is where the element *inherits from*, so the walk starts at the parent:
// an element is never its own context. Sitting directly under the Canvas stage is the
// one case the stage itself names, because that is where the editor overlay lives.
export function contextOf(element, stage) {
  if (element !== stage && element.parentElement === stage)
    return stage.classList.contains("canvas-stage") ? "canvas-stage" : "root";
  for (let node = element.parentElement; node && node !== stage; node = node.parentElement) {
    const hit = CONTEXT_MARKERS.find(([, className]) => node.classList.contains(className));
    if (hit) return hit[0];
  }
  return "root";
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
    context: contextOf(element, stage),
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

// Measure one named role everywhere it appears, queried by selector so a role the
// fixture does not render comes back with `found: 0` instead of quietly disappearing.
export function measureRoles(stage, specs) {
  return specs.map((spec) => ({
    role: spec.role,
    selector: spec.selector,
    samples: [...stage.querySelectorAll(spec.selector)].map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        context: contextOf(element, stage),
        path: cssPath(element, stage),
        text: (element.value ?? directText(element) ?? "").slice(0, 24),
        placeholder: element.placeholder ?? null,
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0,
      };
    }),
  }));
}

// What the Canvas side will resolve from the same stage. Reported as data — including
// the failure message — so the suite decides, instead of a fallback hiding missing CSS.
export function resolvedMetrics(stage) {
  try {
    const metrics = resolveFontMetrics(stage);
    return {
      ok: true,
      family: metrics.family,
      sizes: metrics.sizes,
      fonts: Object.fromEntries(FONT_ROLES.map((role) => [role, metrics.font(role)])),
      error: null,
    };
  } catch (error) {
    return { ok: false, family: null, sizes: null, fonts: null, error: error.message };
  }
}

// The resolver has to fail loudly, not guess. Three ways to lose the sizes: no element,
// an element outside the runtime stylesheet, and an unusable declared value.
export function resolverRejections() {
  const attempt = (label, build) => {
    const probe = build();
    try {
      const metrics = resolveFontMetrics(probe?.element ?? probe);
      return {
        label,
        threw: false,
        message: `解決できてしまった: ${JSON.stringify(metrics.sizes)}`,
      };
    } catch (error) {
      return { label, threw: true, message: error.message };
    } finally {
      probe?.element?.remove?.();
    }
  };
  return [
    attempt("no-element", () => null),
    attempt("outside-runtime", () => {
      const element = document.createElement("div");
      document.body.append(element);
      return { element };
    }),
    attempt("invalid-value", () => {
      const element = document.createElement("div");
      element.className = "uivolve-runtime";
      element.style.setProperty("--ui-font-size-body", "1.1em");
      document.body.append(element);
      return { element };
    }),
  ];
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

// The page outside the runtime. Fixing the reset must not reach past the mounted
// surface, so the host element and the document body are measured alongside it.
export function hostFrame(host) {
  const style = getComputedStyle(host);
  const body = getComputedStyle(document.body);
  return {
    hostFontSize: style.fontSize,
    hostFontFamily: style.fontFamily,
    bodyFontSize: body.fontSize,
    bodyFontFamily: body.fontFamily,
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
  themeUrl,
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
  let definition = theme;
  if (!definition && themeUrl) {
    const response = await fetch(themeUrl);
    if (!response.ok) throw new Error(`テーマ ${themeUrl} を取得できません (${response.status})`);
    definition = await response.json();
  }
  if (definition) runtime.theme(definition);
  await runtime.load(screen);
  await runtime.whenIdle();
  await document.fonts.ready;
  return {
    runtime,
    errors,
    host,
    domStage,
    canvasStage,
    canvas,
    // Open overlays and popups the way a user does. Building the element by hand would
    // measure a node the host never produced, which is exactly what has to be checked.
    async clickDom(selector) {
      const node = domStage.querySelector(selector);
      if (!node) throw new Error(`DOM側に ${selector} に一致する部品がありません`);
      node.click();
      await runtime.whenIdle();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    },
    async clickCanvas(target) {
      const scene = runtime.scenes[1];
      const widget = scene?.widgets.find((entry) => entry.target === target);
      if (!widget)
        throw new Error(
          `Canvas側に target="${target}" の部品がありません` +
            `（候補: ${[...new Set(scene?.widgets.map((entry) => entry.target) ?? [])].join(", ")}）`,
        );
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: rect.left + ((widget.x + widget.width / 2) * rect.width) / scene.width,
          clientY: rect.top + ((widget.y + widget.height / 2) * rect.height) / scene.height,
        }),
      );
      await runtime.whenIdle();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    },
    roles(specs) {
      return {
        dom: measureRoles(domStage, specs),
        canvasStage: measureRoles(canvasStage, specs),
        resolved: { dom: resolvedMetrics(domStage), canvas: resolvedMetrics(canvasStage) },
        hostFrame: hostFrame(host),
        environment: {
          domStage: environment(domStage, null),
          canvasStage: environment(canvasStage, canvas),
        },
        errors: [...errors],
      };
    },
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
