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
// A spec may name a pseudo-element: the Kanban card id is generated content, so it has
// no element of its own and would otherwise be invisible to this check.
export function measureRoles(stage, specs) {
  return specs.map((spec) => ({
    role: spec.role,
    selector: spec.selector,
    pseudo: spec.pseudo ?? null,
    samples: [...stage.querySelectorAll(spec.selector)].map((element) => {
      const style = getComputedStyle(element, spec.pseudo ?? undefined);
      const rect = element.getBoundingClientRect();
      const box = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
      return {
        context: contextOf(element, stage),
        path: spec.pseudo ? `${cssPath(element, stage)}${spec.pseudo}` : cssPath(element, stage),
        text: (spec.pseudo ? style.content : (element.value ?? directText(element) ?? "")).slice(
          0,
          24,
        ),
        placeholder: spec.pseudo ? null : (element.placeholder ?? null),
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        visible: spec.pseudo ? box && style.content !== "none" : box,
      };
    }),
  }));
}

// --- shared surface sprites (figure / document) -------------------------------------
// The DOM side of the sprites both renderers paint. The effective size is the declared
// sprite size times the SVG's live CTM scale — read off the element instead of
// recomputed — because the viewBox is fitted inside the element's *content* box, and
// reproducing that rectangle is exactly what the Canvas side has to get right.
//
// Positions come back relative to the widget's own box, so the two surfaces can be
// compared even if the two stages are not the same width.
export function surfaceSprites(stage) {
  const origin = stage.getBoundingClientRect();
  const frames = [];
  const sprites = [];
  for (const root of stage.querySelectorAll(".ui-figure, .ui-document")) {
    const widget = widgetOf(root);
    const box = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const svg = root.querySelector("svg");
    const viewport = svg?.getBoundingClientRect() ?? null;
    frames.push({
      surface: "dom",
      key: widget.key,
      target: widget.target,
      kind: widget.kind,
      x: box.x - origin.x,
      y: box.y - origin.y,
      width: box.width,
      height: box.height,
      borderWidth: Number.parseFloat(style.borderTopWidth),
      viewBox: svg?.getAttribute("viewBox") ?? null,
      preserveAspectRatio: svg?.getAttribute("preserveAspectRatio") ?? null,
      // The SVG viewport, relative to the widget box: the content box the border leaves.
      viewportX: viewport ? viewport.x - box.x : null,
      viewportY: viewport ? viewport.y - box.y : null,
      viewportWidth: viewport?.width ?? null,
      viewportHeight: viewport?.height ?? null,
      textCount: svg ? svg.querySelectorAll("text").length : null,
    });
    if (!svg) continue;
    let order = 0;
    for (const node of svg.querySelectorAll("text")) {
      const matrix = node.getScreenCTM();
      const scale = matrix ? Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) : null;
      const spriteX = Number.parseFloat(node.getAttribute("x"));
      const spriteY = Number.parseFloat(node.getAttribute("y"));
      const declared = Number.parseFloat(node.getAttribute("font-size"));
      // `fill="none"` paints nothing on either surface; it is recorded, not ordered, so
      // the two paint orders stay comparable.
      const painted = node.getAttribute("fill") !== "none";
      const text = node.textContent ?? "";
      sprites.push({
        surface: "dom",
        key: widget.key,
        kind: widget.kind,
        order: painted ? order++ : null,
        painted,
        text,
        declaredFontSize: declared,
        scale,
        effectiveFontSize: scale === null ? null : declared * scale,
        fontWeight: node.getAttribute("font-weight"),
        fontFamily: getComputedStyle(node).fontFamily,
        textAnchor: node.getAttribute("text-anchor"),
        inkWidth: text && scale !== null ? node.getComputedTextLength() * scale : 0,
        x: matrix ? matrix.a * spriteX + matrix.c * spriteY + matrix.e - box.x : null,
        y: matrix ? matrix.b * spriteX + matrix.d * spriteY + matrix.f - box.y : null,
      });
    }
  }
  return { frames, sprites };
}

// The media notice is generated content, so it has no element of its own and is read off
// the ::after pseudo-element. On the Canvas stage the same markup is the *native* overlay
// (video and iframe keep a real element); the image kind has none and is painted instead.
export function mediaNotices(stage) {
  const origin = stage.getBoundingClientRect();
  return [...stage.querySelectorAll("[data-media-kind]")].map((root) => {
    const after = getComputedStyle(root, "::after");
    const rect = root.getBoundingClientRect();
    const widget = widgetOf(root);
    const native = root.querySelector(".native-media");
    return {
      surface: root.classList.contains("canvas-media") ? "canvas-native" : "dom",
      mediaKind: root.dataset.mediaKind ?? null,
      key: widget.key,
      target: widget.target,
      empty: root.dataset.empty === "true",
      error: root.dataset.mediaError === "true",
      nativeTag: native?.tagName.toLowerCase() ?? null,
      nativeHidden: native ? native.hidden : null,
      // A Canvas overlay is hidden behind a modal, so its box collapses. The position the
      // renderer wrote stays readable and is what the Scene widget is matched against.
      hidden: root.hidden,
      styleLeft: Number.parseFloat(root.style.left),
      styleTop: Number.parseFloat(root.style.top),
      content: after.content,
      shown: !root.hidden && after.content !== "none" && after.content !== "normal",
      fontSize: Number.parseFloat(after.fontSize),
      fontFamily: after.fontFamily,
      x: rect.x - origin.x,
      y: rect.y - origin.y,
      width: rect.width,
      height: rect.height,
    };
  });
}

// The DOM dialog icon. A character icon is a text node inside a fixed 32px box with
// `overflow: hidden`, so the laid-out width is measured with a Range: the Canvas side has
// to clip the same way instead of condensing the glyphs to the box.
// `[data-icon]` picks the icon the host built: the widget root carries the same class
// (`ui-${kind}`) but none of the content, and would otherwise be measured as a second icon.
export function dialogIconSurfaces(stage) {
  return [...stage.querySelectorAll(".ui-dialog-icon[data-icon]")].map((root) => {
    const style = getComputedStyle(root);
    const rect = root.getBoundingClientRect();
    const widget = widgetOf(root);
    const text = directText(root);
    let inkWidth = 0;
    let inkHeight = 0;
    let lineCount = 0;
    if (text) {
      const range = root.ownerDocument.createRange();
      range.selectNodeContents(root);
      const ink = range.getBoundingClientRect();
      inkWidth = ink.width;
      inkHeight = ink.height;
      // A bare text node in this inline-flex box is an anonymous flex item, so a wide
      // string is broken across lines instead of overflowing on one. The count tells the
      // two cases apart: only a single line can be compared with the Canvas advance width.
      lineCount = range.getClientRects().length;
      range.detach?.();
    }
    return {
      surface: "dom",
      key: widget.key,
      target: widget.target,
      icon: root.dataset.icon ?? null,
      label: root.getAttribute("aria-label"),
      text,
      fontSize: Number.parseFloat(style.fontSize),
      fontFamily: style.fontFamily,
      overflow: style.overflow,
      inkWidth,
      inkHeight,
      lineCount,
      clipped: inkWidth > rect.width + 0.5 || inkHeight > rect.height + 0.5 || lineCount > 1,
      boxWidth: rect.width,
      boxHeight: rect.height,
      hasSvg: Boolean(root.querySelector("svg")),
      hasImage: Boolean(root.querySelector("img")),
    };
  });
}

// Advance widths measured with the font the Canvas renderer resolves for this stage, so a
// font that finished loading shows up as a different number instead of only a different
// name. The probe strings identify the face rather than its size: a monospaced font gives
// "iiiii" and "WWWWW" the same advance, a proportional one cannot.
export function advanceWidths(stage, samples) {
  const resolved = resolveFontMetrics(stage);
  const ctx = document.createElement("canvas").getContext("2d");
  return samples.map((sample) => {
    const role = sample.role ?? "body";
    ctx.font = resolved.font(role);
    return { text: sample.text, role, font: ctx.font, width: ctx.measureText(sample.text).width };
  });
}

// The laid-out width of DOM text, measured with a Range so it is the text's own advance
// rather than the box the layout handed it: this is the DOM half of "the font changed and
// both surfaces were measured again".
export function textInk(stage, selectors) {
  return selectors.map((selector) => {
    const element = stage.querySelector(selector);
    if (!element)
      return { selector, found: false, text: null, width: null, scrollWidth: null, lineCount: 0 };
    const range = stage.ownerDocument.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    // Three numbers, because one is not enough to notice every reflow: a wrapping text
    // saturates at its container's width and shows the change in its line count instead,
    // and a clipped one shows it in the scroll width.
    const lineCount = range.getClientRects().length;
    range.detach?.();
    const style = getComputedStyle(element);
    return {
      selector,
      found: true,
      text: (element.textContent ?? "").slice(0, 24),
      width: rect.width,
      scrollWidth: element.scrollWidth,
      lineCount,
      fontSize: Number.parseFloat(style.fontSize),
      fontFamily: style.fontFamily,
    };
  });
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
      surfaceBorder: metrics.surfaceBorder,
      fonts: Object.fromEntries(FONT_ROLES.map((role) => [role, metrics.font(role)])),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      family: null,
      sizes: null,
      surfaceBorder: null,
      fonts: null,
      error: error.message,
    };
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
      // The label strip is what tells a Grid editor (0) and a dialog prompt (22) apart
      // from an ordinary field (24) without reading the size back out of the CSS.
      labelHeight: widget.config?.labelHeight ?? null,
      dialog: Boolean(widget.config?.dialog),
      placeholder: widget.config?.placeholder ?? null,
      column: widget.payload?.column ?? null,
      // The engine's own surface numbers, carried only by the kinds that have them: the
      // sprite sizes are checked against these rather than against a second table, so a
      // renderer substituting its own value for an omitted one shows up as a difference.
      ...(["figure", "document"].includes(widget.kind)
        ? {
            sprites: widget.config?.sprites ?? null,
            lines: widget.config?.lines ?? null,
            viewWidth: widget.config?.viewWidth ?? null,
            viewHeight: widget.config?.viewHeight ?? null,
          }
        : null),
      ...(["image", "video", "iframe"].includes(widget.kind)
        ? { src: widget.config?.src ?? null, alt: widget.config?.alt ?? null }
        : null),
      ...(widget.kind === "dialog-icon" ? { icon: widget.config?.icon ?? null } : null),
      // Every string this widget can paint. Attribution uses it together with the draw
      // position, never on its own, so repeated strings stay distinguishable.
      strings: [
        widget.text,
        widget.value,
        ...(widget.cells ?? []),
        widget.payload?.id,
        widget.config?.boxLabel,
        widget.config?.placeholder,
        widget.config?.count === undefined ? null : String(widget.config.count),
        // A dialog message carries plain strings; a document's lines are objects, and a
        // figure keeps its text in the sprites. All three feed the same attribution.
        ...(widget.config?.lines ?? []).map((line) =>
          typeof line === "string" ? line : line?.text,
        ),
        ...(widget.config?.sprites ?? []).map((sprite) => sprite?.text),
        // A character dialog icon paints its own string. Without it the icon's draw would
        // be attributed to whichever widget happens to contain the same character.
        widget.config?.icon?.text,
        ...(widget.config?.options?.map((option) => option.text) ?? []),
      ].filter((value) => typeof value === "string" && value !== ""),
    })),
  };
}

// The control that currently has focus, plus the state an ongoing edit must not lose.
// `same` compares against the node remembered by markActive(): a repaint that rebuilds
// the input would pass a value comparison and fail this one.
function activeControl(host) {
  const element = host.ownerDocument.activeElement;
  if (!element || !host.contains(element))
    return { present: false, inside: false, same: false, tag: null };
  const style = getComputedStyle(element);
  return {
    present: true,
    inside: true,
    same: element === window.__fontParityProbe,
    connected: element.isConnected,
    tag: element.tagName.toLowerCase(),
    id: element.id,
    classes: [...element.classList],
    type: element.type ?? null,
    value: element.value ?? null,
    selectionStart: (() => {
      try {
        return element.selectionStart ?? null;
      } catch {
        // Date and number inputs refuse selection access; that is data, not a failure.
        return null;
      }
    })(),
    selectionEnd: (() => {
      try {
        return element.selectionEnd ?? null;
      } catch {
        return null;
      }
    })(),
    fontSize: Number.parseFloat(style.fontSize),
    fontFamily: style.fontFamily,
  };
}

function lookupPath(state, path) {
  let value = state;
  for (const part of path.split(".")) {
    if (value == null) return null;
    value = Array.isArray(value) ? value[Number(part)] : value[part];
  }
  return value === undefined ? null : value;
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
  // The stylesheet's own family, kept so a probe font can be put in front of it without
  // the fallback list growing every time useFontFamily() is called.
  let stageFamily = null;
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
    // Choose a combobox option the way a user does: set the native select's value and let
    // the host's own change listener run. Building the state change by hand would skip the
    // renderer path that produces the widget being measured.
    async selectDom(selector, value) {
      const node = domStage.querySelector(selector);
      if (!node) throw new Error(`DOM側に ${selector} に一致する選択欄がありません`);
      if (![...node.options].some((option) => option.value === value))
        throw new Error(
          `${selector} に value="${value}" の選択肢がありません` +
            `（候補: ${[...node.options].map((option) => option.value).join(", ")}）`,
        );
      node.value = value;
      node.dispatchEvent(new Event("change", { bubbles: true }));
      await this.afterFrame();
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
    // --- editing -------------------------------------------------------------------
    // Everything an editing step has to compare: the engine's own numbers, the control
    // that has focus, and the overlay classes the sizes hang off. Only the state paths the
    // caller names are read, so a 500-row fixture does not travel through the ledger.
    editSnapshot(paths = []) {
      return {
        revision: runtime.revision,
        errors: [...errors],
        state: Object.fromEntries(paths.map((path) => [path, lookupPath(runtime.state, path)])),
        active: activeControl(host),
        // Every editor on screen, by surface, with the class that decides its size.
        editors: ["dom", "canvas"].flatMap((surface) =>
          [
            ...(surface === "dom" ? domStage : canvasStage).querySelectorAll(
              "input,select,textarea",
            ),
          ]
            .filter((element) => element.closest(".ui-field, .canvas-editor"))
            .map((element) => ({
              surface,
              id: element.id,
              tag: element.tagName.toLowerCase(),
              gridEditor: element.closest(".grid-editor") !== null,
              value: element.value,
              fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
            })),
        ),
        fields: (sceneRecord(runtime.scenes[1])?.widgets ?? [])
          .filter((widget) => widget.labelHeight !== null)
          .map(({ key, kind, text, gridEditor, labelHeight, dialog, value, monospace }) => ({
            key,
            kind,
            text,
            gridEditor,
            labelHeight,
            dialog,
            value,
            monospace,
          })),
      };
    },
    // Put focus where a click would: on the DOM control itself, or on the Canvas overlay the
    // host opens when the painted field is pressed. Typing is done with real keys afterwards.
    async focusField({ surface, target }) {
      if (surface === "canvas") {
        await this.clickCanvas(target);
      } else {
        const node = domStage.querySelector(
          `.ui-field[data-target="${target}"] :is(input, select, textarea)`,
        );
        if (!node) throw new Error(`DOM側に target="${target}" の入力欄がありません`);
        node.focus();
        node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        await this.afterFrame();
      }
      return activeControl(host);
    },
    // Begin editing a Grid cell the way a user does: press the cell, then double click it.
    // The events are dispatched in the page rather than driven by the mouse because the
    // fixture stacks both surfaces and the lower one sits below the fold; the hit test, the
    // listener and the resulting dispatch are all the host's own.
    async editCell({ surface, column, index = 0 }) {
      const scene = runtime.scenes[surface === "canvas" ? 1 : 0];
      const cell = (scene?.widgets ?? []).filter(
        (widget) => widget.kind === "grid-cell" && widget.payload?.column === column,
      )[index];
      if (!cell) throw new Error(`${surface}側に列 ${column} の grid-cell がありません`);
      if (surface === "canvas") {
        const rect = canvas.getBoundingClientRect();
        const at = {
          clientX: rect.left + ((cell.x + cell.width / 2) * rect.width) / scene.width,
          clientY: rect.top + ((cell.y + cell.height / 2) * rect.height) / scene.height,
        };
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, ...at }),
        );
        await this.afterFrame();
        canvas.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true, ...at }),
        );
      } else {
        const node = domStage.querySelector(`[data-key="${CSS.escape(cell.key)}"]`);
        if (!node) throw new Error(`DOM側に key ${cell.key} の節点がありません`);
        node.focus();
        node.click();
        await this.afterFrame();
        node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      }
      await this.afterFrame();
      return activeControl(host);
    },
    markActive() {
      window.__fontParityProbe = host.ownerDocument.activeElement;
      return activeControl(host);
    },
    activeControl() {
      return activeControl(host);
    },
    // A synthetic composition: the real events in the real order, with the value set the
    // way an IME sets it. This is NOT a real IME run — see the ledger's limits table.
    startComposition(text) {
      const input = host.ownerDocument.activeElement;
      if (!input || !host.contains(input)) throw new Error("変換を始める入力欄に焦点がありません");
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      input.value = text;
      input.setSelectionRange(text.length, text.length);
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, isComposing: true, data: text }),
      );
      return activeControl(host);
    },
    endComposition() {
      const input = host.ownerDocument.activeElement;
      if (!input || !host.contains(input)) throw new Error("変換を終える入力欄に焦点がありません");
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: input.value }),
      );
      return activeControl(host);
    },
    async applyThemeUrl(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`テーマ ${url} を取得できません (${response.status})`);
      runtime.theme(await response.json());
      await this.afterFrame();
      return activeControl(host);
    },
    async resizeHostTo(width) {
      host.style.width = width;
      await this.afterFrame();
      return activeControl(host);
    },
    async rerender() {
      runtime.render();
      await this.afterFrame();
      return activeControl(host);
    },
    // Point both stages at a font the fixture delivers on demand. The inline declaration
    // beats the runtime stylesheet's own family (specificity 0,1,0), so the probe face is
    // what the DOM text inherits and what the Canvas resolves, with the runtime's list left
    // behind it as the fallback the browser uses until the bytes arrive.
    async useFontFamily(family, probe = {}) {
      stageFamily ??= getComputedStyle(domStage).fontFamily;
      for (const element of [domStage, canvasStage])
        element.style.fontFamily = family ? `"${family}", ${stageFamily}` : stageFamily;
      // Repaint once with the font merely requested: the frame recorded now is the "before"
      // reference, and the automatic repaint after the load is what has to replace it.
      runtime.render();
      await this.afterFrame();
      return this.lifecycle(probe);
    },
    // Everything a font completion or a device pixel ratio change has to leave correct: the
    // font set's own status, the advances both stages measure, the frame the Canvas actually
    // painted (with its transform and bitmap), and the control an open edit is sitting in.
    lifecycle({ samples = [], specs = [], selectors = [] } = {}) {
      return {
        fonts: {
          status: document.fonts.status,
          faces: [...document.fonts].map((face) => ({
            family: face.family,
            status: face.status,
          })),
        },
        advances: {
          dom: advanceWidths(domStage, samples),
          canvas: advanceWidths(canvasStage, samples),
        },
        ink: textInk(domStage, selectors),
        roles: {
          dom: measureRoles(domStage, specs),
          canvasStage: measureRoles(canvasStage, specs),
        },
        canvasSurface: window.__fontParity?.forCanvas(canvas) ?? null,
        scene: sceneRecord(runtime.scenes[1]),
        resolved: { dom: resolvedMetrics(domStage), canvas: resolvedMetrics(canvasStage) },
        environment: {
          domStage: environment(domStage, null),
          canvasStage: environment(canvasStage, canvas),
        },
        active: activeControl(host),
        pixelRatio: window.devicePixelRatio,
        disposed: runtime.disposed,
        errors: [...errors],
      };
    },
    // Page coordinates for the centre of a Scene widget. Dragging needs pointer capture,
    // which only real browser input grants, so the caller drives the mouse from outside
    // the page and asks here where to put it.
    // `column` picks one Grid cell out of a row: the sizes differ per column editor, so a
    // step has to be able to say which cell it means instead of taking the first one.
    widgetPoint({ surface, kind, column = null, index = 0 }) {
      const scene = runtime.scenes[surface === "canvas" ? 1 : 0];
      const matches =
        scene?.widgets.filter(
          (entry) => entry.kind === kind && (column === null || entry.payload?.column === column),
        ) ?? [];
      const widget = matches[index];
      if (!widget)
        throw new Error(
          `${surface}側の ${kind}${column ? `（列 ${column}）` : ""} は ${matches.length} 個しか` +
            `ありません（index ${index} を要求）`,
        );
      const box = (surface === "canvas" ? canvas : domStage).getBoundingClientRect();
      return {
        key: widget.key,
        x: box.left + (widget.x + widget.width / 2) * (box.width / scene.width),
        y: box.top + (widget.y + widget.height / 2) * (box.height / scene.height),
      };
    },
    async afterFrame() {
      await runtime.whenIdle();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    },
    // `noText` names the kinds that must paint no characters. Only the offending nodes
    // travel back: the question is whether any of them put a character on screen, and
    // shipping the whole DOM text dump per case would bury the answer.
    roles(specs, noText = []) {
      // The Canvas frame currently on screen, recorded by the init script through the
      // original fillText/measureText, paired with the Scene those calls were painted from.
      // Asked for by element: earlier harnesses left behind buckets under the same id.
      return {
        dom: measureRoles(domStage, specs),
        canvasStage: measureRoles(canvasStage, specs),
        textFreeViolations: [domStage, canvasStage].flatMap((stage) =>
          observeDom(stage, "roles")
            .filter((record) => noText.includes(record.kind))
            .map(({ selector, kind, text, part, stage: where }) => ({
              stage: where,
              selector,
              kind,
              part,
              text,
            })),
        ),
        canvasSurface: window.__fontParity?.forCanvas(canvas) ?? null,
        scene: sceneRecord(runtime.scenes[1]),
        resolved: { dom: resolvedMetrics(domStage), canvas: resolvedMetrics(canvasStage) },
        hostFrame: hostFrame(host),
        environment: {
          domStage: environment(domStage, null),
          canvasStage: environment(canvasStage, canvas),
        },
        errors: [...errors],
      };
    },
    // The shared surfaces: the SVG sprites the DOM mounted, the notices the media roots
    // generate on each stage, the dialog icons, and the Canvas frame those same sprites
    // were painted into. Both Scenes come back because the comparison is per widget box.
    surfaces() {
      return {
        dom: surfaceSprites(domStage),
        // Must stay empty: the Canvas surface paints the sprites onto its bitmap and
        // mounts no SVG of its own. Recorded so that stops being an assumption.
        canvasStage: surfaceSprites(canvasStage),
        media: { dom: mediaNotices(domStage), canvas: mediaNotices(canvasStage) },
        icons: { dom: dialogIconSurfaces(domStage), canvas: dialogIconSurfaces(canvasStage) },
        canvasSurface: window.__fontParity?.forCanvas(canvas) ?? null,
        scene: sceneRecord(runtime.scenes[1]),
        domScene: sceneRecord(runtime.scenes[0]),
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
      // The composition probes resize the host; the next case must start from the default.
      host.style.removeProperty("width");
      window.__fontParityProbe = null;
    },
  };
}
