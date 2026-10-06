import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { packageFormat, parsePackage } from "../../src/package-format.js";

// Browser-side Canvas observation. Installed through addInitScript so it is in place
// before the first paint, and every patched method delegates to the original: the
// recorded numbers come from the same calls that produced the visible pixels.
function canvasRecorder() {
  const proto = CanvasRenderingContext2D.prototype;
  const originalFillText = proto.fillText;
  const originalMeasureText = proto.measureText;
  const originalClearRect = proto.clearRect;
  const surfaces = new Map();
  const labelOf = (canvas) =>
    canvas.id || canvas.closest?.("[data-font-parity]")?.dataset.fontParity || "offscreen";
  const bucket = (canvas) => {
    let entry = surfaces.get(canvas);
    if (!entry) {
      entry = { label: labelOf(canvas), draws: [], measurements: [] };
      surfaces.set(canvas, entry);
    }
    return entry;
  };
  proto.fillText = function (text, x, y, maxWidth) {
    const entry = bucket(this.canvas);
    const transform = this.getTransform();
    const value = String(text);
    entry.draws.push({
      text: value,
      x,
      y,
      maxWidth: maxWidth ?? null,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      fillStyle: typeof this.fillStyle === "string" ? this.fillStyle : null,
      transform: {
        a: transform.a,
        b: transform.b,
        c: transform.c,
        d: transform.d,
        e: transform.e,
        f: transform.f,
      },
      measuredWidth: originalMeasureText.call(this, value).width,
      fontsStatus: document.fonts.status,
      devicePixelRatio: window.devicePixelRatio,
      bitmapWidth: this.canvas.width,
      bitmapHeight: this.canvas.height,
      cssWidth: Number.parseFloat(this.canvas.style.width) || null,
      cssHeight: Number.parseFloat(this.canvas.style.height) || null,
    });
    return originalFillText.apply(this, arguments);
  };
  proto.measureText = function (text) {
    const result = originalMeasureText.apply(this, arguments);
    bucket(this.canvas).measurements.push({
      text: String(text),
      font: this.font,
      width: result.width,
    });
    return result;
  };
  proto.clearRect = function (x, y, width) {
    // A full-surface clear starts a new frame; keep only the frame that is on screen.
    if (x === 0 && y === 0 && width >= this.canvas.width / (window.devicePixelRatio || 1)) {
      const entry = bucket(this.canvas);
      entry.draws = [];
      entry.measurements = [];
    }
    return originalClearRect.apply(this, arguments);
  };
  window.__fontParity = {
    // Buckets are keyed by the canvas element, so a page that builds a second surface with
    // the same id can still ask for exactly the one it owns instead of the first match.
    forCanvas(canvas) {
      const entry = surfaces.get(canvas);
      return entry
        ? { label: entry.label, draws: entry.draws, measurements: entry.measurements }
        : null;
    },
    reset() {
      for (const entry of surfaces.values()) {
        entry.draws = [];
        entry.measurements = [];
      }
    },
    snapshot() {
      return [...surfaces.values()].map((entry) => ({
        label: entry.label,
        draws: entry.draws,
        measurements: entry.measurements,
      }));
    },
  };
}

function fontSizeOf(font) {
  const match = /(-?\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number.parseFloat(match[1]) : null;
}

function weightOf(font) {
  const match = /^\s*(\d{3}|normal|bold|lighter|bolder)\s/.exec(font);
  return match ? match[1] : "400";
}

// Scene geometry is CSS px; the Canvas transform is CSS px -> bitmap px. Divide the
// transformed values by the device pixel ratio so Canvas and DOM are compared in the
// same CSS coordinate system, with the DPR bitmap scale removed.
function toCss(draw) {
  const { a, b, c, d, e, f } = draw.transform;
  const dpr = draw.devicePixelRatio || 1;
  const scale = Math.sqrt(Math.abs(a * d - b * c)) || 1;
  const size = fontSizeOf(draw.font);
  return {
    x: (a * draw.x + c * draw.y + e) / dpr,
    y: (b * draw.x + d * draw.y + f) / dpr,
    localScale: scale / dpr,
    declaredFontSize: size,
    effectiveFontSize: size === null ? null : (size * scale) / dpr,
    effectiveWidth: (draw.measuredWidth * scale) / dpr,
  };
}

// Glyphs the renderer paints itself. They appear in no widget's strings, so position alone
// would decide, and the matrix found the combobox arrow landing inside a neighbouring button's
// box at 720 CSS px. Naming the kinds that paint them keeps the attribution honest without
// inventing a string for the widget.
const DECORATIONS = [
  // src/canvas-renderer.js:1016 — the combobox arrow, at the field's own value size.
  { glyph: (text) => text === "▾", kinds: ["combobox"] },
  // src/canvas-renderer.js:923 — the checkbox tick.
  { glyph: (text) => text === "✓", kinds: ["checkbox"] },
];

// Duplicate strings are matched by position, key and role — never by the string alone.
//
// Three filters, in this order. A draw can only belong to a kind that paints characters, so
// a backdrop or a row background can never absorb another widget's text. A draw carrying a
// local scale can only have come from the shared surface sprites, which live on figure and
// document. Among what is left, a widget that can actually produce the string is preferred,
// and position (smallest box, then latest paint) decides between equals.
function attribute(draw, widgets) {
  const point = toCss(draw);
  const scaled = Math.abs(point.localScale - 1) > 0.001;
  // A text-free kind can still reach fillText with an empty string — the `card` box goes
  // through the generic label branch — so those kinds join the candidates for empty draws
  // only. Keeping them out of the candidates for real text is what stops a container box
  // from absorbing a smaller widget's characters.
  const owners = scaled
    ? SURFACE_KINDS
    : draw.text === ""
      ? TEXT_OR_FREE_KINDS
      : TEXT_PAINTING_KINDS;
  const inside = widgets.filter(
    (widget) =>
      owners.has(widget.kind) &&
      point.x >= widget.x - 1 &&
      point.x <= widget.x + widget.width + 1 &&
      point.y >= widget.y - 1 &&
      point.y <= widget.y + widget.height + 1,
  );
  const needle = draw.text.replace(/…+$/u, "").trim();
  const named = needle
    ? inside.filter((widget) => widget.strings?.some((value) => value.includes(needle)))
    : [];
  // Only when no widget declares the string: a decoration can then only have come from the kind
  // that paints it, and a widget of that kind that does not contain the point leaves the draw
  // unattributed rather than letting a neighbour claim it. A widget that does declare the glyph
  // (the tree toggle carries its own "▾") keeps winning by its string.
  const decoration = named.length ? null : DECORATIONS.find((entry) => entry.glyph(draw.text));
  const pool = decoration
    ? inside.filter((widget) => decoration.kinds.includes(widget.kind))
    : inside;
  const candidates = named.length ? named : pool;
  candidates.sort(
    (left, right) =>
      left.width * left.height - right.width * right.height || right.layer - left.layer,
  );
  return candidates[0] ?? null;
}

function canvasRecords(surface, widgets, label) {
  return surface.draws.map((draw, index) => {
    const geometry = toCss(draw);
    const widget = attribute(draw, widgets);
    return {
      surface: "canvas",
      stage: label,
      index,
      text: draw.text,
      key: widget?.key ?? null,
      target: widget?.target ?? null,
      kind: widget?.kind ?? null,
      role: `${widget?.kind ?? "unattributed"}:canvas-text:w${weightOf(draw.font)}`,
      gridEditor: widget?.gridEditor ?? null,
      font: draw.font,
      fontWeight: weightOf(draw.font),
      fontsStatus: draw.fontsStatus,
      declaredFontSize: geometry.declaredFontSize,
      effectiveFontSize: geometry.effectiveFontSize,
      localScale: geometry.localScale,
      transform: draw.transform,
      textAlign: draw.textAlign,
      textBaseline: draw.textBaseline,
      maxWidth: draw.maxWidth,
      measuredWidth: draw.measuredWidth,
      effectiveWidth: geometry.effectiveWidth,
      x: geometry.x,
      y: geometry.y,
      bitmapWidth: draw.bitmapWidth,
      cssWidth: draw.cssWidth,
      devicePixelRatio: draw.devicePixelRatio,
    };
  });
}

// Same widget key on both surfaces; a size gap here is what the milestone has to close.
function compare(dom, canvas) {
  const rows = [];
  for (const draw of canvas) {
    const matches = dom.filter((record) => record.key && record.key === draw.key && record.visible);
    const exact = matches.find((record) => record.text === draw.text);
    const peer = exact ?? matches[0] ?? null;
    rows.push({
      key: draw.key,
      kind: draw.kind,
      canvasRole: draw.role,
      canvasText: draw.text,
      canvasFontSize: draw.effectiveFontSize,
      canvasFontWeight: draw.fontWeight,
      domRole: peer?.role ?? null,
      domSelector: peer?.selector ?? null,
      domPart: peer?.part ?? null,
      domText: peer?.text ?? null,
      domFontSize: peer?.fontSize ?? null,
      domFontWeight: peer?.fontWeight ?? null,
      matchedBy: exact ? "key+text" : peer ? "key" : "none",
      delta:
        peer && draw.effectiveFontSize !== null ? draw.effectiveFontSize - peer.fontSize : null,
    });
  }
  return rows;
}

function japaneseRendered(font) {
  const japanese = font.rendered.japanese;
  const unmapped = font.rendered.unmapped;
  return japanese.pixels > 0 && japanese.inkWidth !== unmapped.inkWidth;
}

async function instrument(context, url, viewport, inits = []) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(canvasRecorder);
  for (const init of inits) await page.addInitScript(init);
  if (viewport) await page.setViewportSize(viewport);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { page, pageErrors };
}

const stageWidth = () => document.getElementById("dom-stage").clientWidth;

// The host does not repaint when a web font finishes loading (that gap belongs to a
// later task), so the frame on screen may predate the fonts. Force a genuine stage
// width change, then return to the baseline viewport, and fail loudly if no repaint
// could be provoked rather than recording a stale frame as the baseline.
async function repaintAfterFonts(page, viewport, measure) {
  // Clear the recorder *before* every resize: a frame painted between the resize and the
  // clear would be wiped and never replaced.
  const resizeAndRecord = async (size) => {
    await page.evaluate(() => window.__fontParity.reset());
    await page.setViewportSize(size);
    return measure();
  };
  const waitForFrame = async (label) => {
    try {
      await page.waitForFunction(
        () =>
          (window.__fontParity.snapshot().find((entry) => entry.label === "canvas")?.draws.length ??
            0) > 0,
        undefined,
        { timeout: 15000 },
      );
    } catch (error) {
      throw new Error(`No Canvas frame was painted at the ${label} width: ${error.message}`);
    }
  };
  const original = await measure();
  let intermediate = false;
  for (const width of [Math.round(viewport.width * 0.7), Math.round(viewport.width * 1.4)]) {
    if ((await resizeAndRecord({ width, height: viewport.height })) === original) continue;
    // Let the resize observation reach the host before going back, otherwise the box
    // returns to its old size before anything was broadcast and no repaint is scheduled.
    await waitForFrame("intermediate");
    intermediate = true;
    break;
  }
  if (!intermediate)
    throw new Error("Could not provoke a post-font repaint: the stage width never changed");
  if ((await resizeAndRecord(viewport)) !== original)
    throw new Error("Stage width did not return to its baseline value");
  await waitForFrame("baseline");
}

async function captureDemo({ context, origin, viewport, evidenceDir }) {
  const { page, pageErrors } = await instrument(context, `${origin}/pages/hello-world`, viewport);
  try {
    await page.locator('#dom-stage input[data-target="nameInput"]').waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    // Repaint after the fonts settled, without touching application state, so the
    // recorded Canvas frame is the one the fonts produced.
    await repaintAfterFonts(page, viewport, () => page.evaluate(stageWidth));
    const observed = await page.evaluate(async () => {
      const module = await import("/tests/browser/font-parity-harness.js");
      const stage = document.getElementById("dom-stage");
      const canvasStage = document.getElementById("canvas-stage");
      const canvas = document.getElementById("canvas");
      return {
        dom: module.observeDom(stage, "demo-dom"),
        font: module.fontEvidence(stage),
        environment: {
          domStage: module.environment(stage, null),
          canvasStage: module.environment(canvasStage, canvas),
        },
        surfaces: window.__fontParity.snapshot(),
      };
    });
    // The demo does not expose its Scene; both surfaces share one Scene geometry, so the
    // DOM widget boxes relative to #dom-stage give the Canvas roles their positions.
    const widgets = await page.evaluate(() => {
      const stage = document.getElementById("dom-stage");
      const origin = stage.getBoundingClientRect();
      return [...stage.querySelectorAll(".ui-widget")].map((element, index) => {
        const rect = element.getBoundingClientRect();
        const kind =
          [...element.classList]
            .find((name) => name.startsWith("ui-") && name !== "ui-widget")
            ?.slice(3) ?? null;
        return {
          key: element.dataset.key ?? null,
          target: element.dataset.target ?? null,
          kind,
          x: rect.x - origin.x,
          y: rect.y - origin.y,
          width: rect.width,
          height: rect.height,
          layer: index,
        };
      });
    });
    const surface = observed.surfaces.find((entry) => entry.label === "canvas");
    if (!surface) throw new Error("Comparison demo Canvas draw calls were not recorded");
    const canvas = canvasRecords(surface, widgets, "demo-canvas");
    const images = {
      comparison: resolve(evidenceDir, "baseline-demo-comparison.png"),
      canvas: resolve(evidenceDir, "baseline-demo-canvas.png"),
    };
    await page.locator(".comparison").screenshot({ path: images.comparison });
    await page.locator("#canvas").screenshot({ path: images.canvas });
    return {
      source: "comparison-demo",
      url: `${origin}/pages/hello-world`,
      pageErrors,
      dom: observed.dom,
      canvas,
      measurements: surface.measurements,
      widgets,
      font: observed.font,
      environment: observed.environment,
      images,
      comparisons: compare(observed.dom, canvas),
    };
  } finally {
    await page.close();
  }
}

async function captureStandalone({ context, origin, viewport, evidenceDir }) {
  const { page, pageErrors } = await instrument(
    context,
    `${origin}/tests/browser/font-parity.html`,
    viewport,
  );
  try {
    const observed = await page.evaluate(async () => {
      const module = await import("/tests/browser/font-parity-harness.js");
      try {
        const harness = await module.createFontParityHarness({
          screen: "screens/hello-world.json",
        });
        window.__fontParityHarness = harness;
        await harness.settle();
        return { ...harness.observe(), surfaces: window.__fontParity.snapshot() };
      } catch (error) {
        document.getElementById("font-parity-error").textContent = error.stack ?? String(error);
        throw error;
      }
    });
    const scene = observed.scenes[1];
    if (!scene) throw new Error("Standalone runtime produced no Canvas Scene");
    const surface = observed.surfaces.find((entry) => entry.label === "font-parity-canvas");
    if (!surface?.draws.length) throw new Error("Standalone Canvas draw calls were not recorded");
    const canvas = canvasRecords(surface, scene.widgets, "standalone-canvas");
    const images = { host: resolve(evidenceDir, "baseline-standalone.png") };
    await page.locator("#font-parity-host").screenshot({ path: images.host });
    const wasm = await page.evaluate(() => ({
      revision: window.__fontParityHarness.runtime.revision,
      screenId: window.__fontParityHarness.runtime.screen?.id ?? null,
      state: window.__fontParityHarness.runtime.state ?? null,
      sceneCount: window.__fontParityHarness.runtime.scenes.length,
    }));
    await page.evaluate(() => window.__fontParityHarness.dispose());
    return {
      source: "standalone-runtime",
      url: `${origin}/tests/browser/font-parity.html`,
      pageErrors,
      runtimeErrors: observed.errors,
      dom: observed.dom,
      canvas,
      measurements: surface.measurements,
      scenes: observed.scenes,
      font: observed.font,
      environment: observed.environment,
      wasm,
      images,
      comparisons: compare(observed.dom, canvas),
    };
  } finally {
    await page.close();
  }
}

function assertCaptured(capture) {
  const missing = [];
  if (!capture.dom.length) missing.push("no DOM text records");
  if (!capture.canvas.length) missing.push("no Canvas draw records");
  if (capture.pageErrors.length) missing.push(`page errors: ${capture.pageErrors.join("; ")}`);
  if (capture.runtimeErrors?.length)
    missing.push(`runtime errors: ${capture.runtimeErrors.join("; ")}`);
  if (capture.environment.domStage.fontsStatus !== "loaded")
    missing.push("document.fonts not loaded");
  if (!japaneseRendered(capture.font)) missing.push("no Japanese glyph evidence");
  if (!capture.environment.canvasStage.canvas?.bitmapWidth)
    missing.push(`no Canvas bitmap width (${JSON.stringify(capture.environment.canvasStage)})`);
  for (const record of capture.canvas)
    if (record.declaredFontSize === null) missing.push(`unparsed Canvas font: ${record.font}`);
  // Japanese has to reach the DOM too, not just the font probe canvas.
  const multibyte = (text) => [...text].some((character) => character.codePointAt(0) > 0xff);
  if (!capture.dom.some((record) => multibyte(record.text)))
    missing.push("no multibyte DOM text captured");
  if (missing.length) throw new Error(`${capture.source}: ${missing.join(", ")}`);
}

async function runBaseline({ context, origin, evidenceDir, viewport, log }) {
  const captures = [];
  const file = resolve(evidenceDir, "baseline.json");
  try {
    captures.push(await captureDemo({ context, origin, viewport, evidenceDir }));
    captures.push(await captureStandalone({ context, origin, viewport, evidenceDir }));
  } finally {
    // Keep whatever was captured even when the run fails; the ledger is the evidence.
    await writeFile(file, `${JSON.stringify({ captures }, null, 2)}\n`);
    log(`Baseline ledger: ${file}`);
  }
  for (const capture of captures) {
    assertCaptured(capture);
    const unattributed = capture.canvas.filter((record) => !record.key).length;
    const mismatched = capture.comparisons.filter(
      (row) => row.delta !== null && Math.abs(row.delta) > 0.01,
    );
    log(
      `${capture.source}: ${capture.dom.length} DOM records, ${capture.canvas.length} Canvas draws` +
        ` (${unattributed} unattributed), ${mismatched.length} size differences`,
    );
    // The baseline reports differences; it is the pre-fix ledger, not the gate.
    for (const row of mismatched.slice(0, 12))
      log(
        `  ${row.kind ?? "?"} ${row.key ?? "-"} "${row.canvasText.slice(0, 18)}" (${row.matchedBy}): ` +
          `canvas ${row.canvasFontSize}px/${row.canvasFontWeight} vs ` +
          `dom ${row.domFontSize}px/${row.domFontWeight} [${row.domPart}]`,
      );
  }
  return { captures: captures.map((capture) => capture.source), file };
}

// --- roles ------------------------------------------------------------------------
// The custom properties from DECISIONS, written as the numbers they must resolve to.
// src/font-metrics.js holds no numbers of its own, so this is the only place the
// contract is spelled out, and the browser has to reproduce it from the stylesheet.
const SIZE_CONTRACT = {
  meta: 9,
  label: 11,
  caption: 12,
  body: 13,
  close: 20,
  metric: 22,
  icon: 30,
};

// One line per role: its own declaration wins over the host's font-size and over the
// form-control reset, in every parent context and in both themes.
const ROLE_CONTRACT = [
  { role: "button", selector: ".ui-button", size: "caption", weight: "500" },
  // The panel box carries a size nothing inherits (its children are stage-level), so it
  // is checked as its own role rather than as a parent context.
  { role: "panel", selector: ".ui-panel", size: "caption", weight: "600" },
  { role: "panel-toggle", selector: ".ui-panel-toggle", size: "caption", weight: "600" },
  { role: "window-title", selector: ".window-title", size: "caption", weight: "600" },
  { role: "window-close", selector: ".ui-window-close", size: "close" },
  { role: "metric-caption", selector: ".ui-metric span", size: "label" },
  { role: "metric-value", selector: ".ui-metric strong", size: "metric", weight: "600" },
  // `.box-control` is a <label> child too, and it carries the value size, not the caption
  // size, so the field caption has to exclude it.
  {
    role: "field-label",
    selector: ".ui-field > label:not(.box-control)",
    size: "label",
    weight: "500",
  },
  { role: "field-input", selector: ".ui-field > input", size: "body" },
  { role: "label", selector: ".ui-label", size: "label" },
  { role: "canvas-editor", selector: ".canvas-editor", size: "body" },
  { role: "menu-trigger", selector: ".ui-menu-trigger", size: "caption" },
  { role: "menu-item", selector: ".ui-menu-item", size: "caption" },
  { role: "grid-column", selector: ".ui-grid-column", size: "caption" },
  { role: "grid-cell", selector: ".ui-grid-cell", size: "caption" },
  { role: "tab", selector: ".ui-tab", size: "caption" },
  // T3 adds the DOM counterpart of every Canvas role it connects, so each Canvas size has
  // a measured declaration to be equal to rather than only a number in SIZE_CONTRACT.
  { role: "field-select", selector: ".ui-field > select", size: "body" },
  { role: "field-textarea", selector: ".ui-field > textarea", size: "body" },
  { role: "box-control", selector: ".box-control", size: "body", weight: "400" },
  { role: "displayfield-label", selector: ".ui-displayfield > span", size: "label", weight: "500" },
  { role: "displayfield-value", selector: ".ui-displayfield > div", size: "body" },
  { role: "extra-button", selector: ".ui-extra-button", size: "caption" },
  { role: "grid-page", selector: ".ui-grid-page", size: "caption" },
  { role: "grid-select", selector: ".ui-grid-select", size: "caption" },
  { role: "grid-header", selector: ".ui-grid-header", size: "label", weight: "500" },
  { role: "row", selector: ".ui-row", size: "caption" },
  { role: "tree-shell", selector: ".ui-tree-shell", size: "caption", weight: "600" },
  { role: "tree-node", selector: ".ui-tree-node", size: "caption" },
  { role: "tree-toggle", selector: ".ui-tree-toggle", size: "caption" },
  { role: "toast", selector: ".ui-toast", size: "body" },
  { role: "dialog-message", selector: ".ui-dialog-message", size: "body" },
  { role: "progressbar", selector: ".ui-progressbar > span", size: "caption" },
  { role: "kanban-lane-title", selector: ".ui-kanban-lane > strong", size: "caption" },
  { role: "kanban-lane-count", selector: ".ui-kanban-lane > span", size: "label" },
  { role: "kanban-card-title", selector: ".ui-kanban-card > strong", size: "caption" },
  { role: "kanban-card-detail", selector: ".ui-kanban-card > span", size: "label" },
  // Generated content: the card id has no element, so it is measured on the pseudo-element.
  { role: "kanban-card-id", selector: ".ui-kanban-card", pseudo: "::after", size: "meta" },
  { role: "ghost-title", selector: ".kanban-drag-ghost > strong", size: "caption" },
  { role: "ghost-detail", selector: ".kanban-drag-ghost > span", size: "label" },
].map((entry) => ({ ...entry, px: SIZE_CONTRACT[entry.size] }));

for (const entry of ROLE_CONTRACT)
  if (entry.px === undefined) throw new Error(`Role ${entry.role} names an unknown size`);

// The parent contexts this task has to prove. A context nothing was measured in is a
// gap in the check, not a pass. `panel` is absent on purpose: the host gives panel
// children the stage as their CSS parent, so no DOM node ever has a panel parent.
const REQUIRED_CONTEXTS = [
  "root",
  "window",
  "popup",
  "canvas-stage",
  "grid-row",
  "grid-head",
  "tabbar",
];

const ROLE_THEMES = [
  { mode: "light", url: "/themes/light.json" },
  { mode: "dark", url: "/themes/dark.json" },
];
const ROLE_HOST_SIZES = ["16px", "20px"];

const GALLERY_SCREEN = "screens/uivolve-gallery.json";
const DIALOGS_SCREEN = "screens/dialogs.yaml";
const STATES_SCREEN = "/tests/browser/font-parity-states.json";
const ICON_SELECT = '.ui-field[data-target="dialogIcon"] select';

// Steps are data, not functions: they cross into page.evaluate. Every overlay and popup
// is opened with a real click so the measured node is the one the host builds.
//
// `cases` picks the theme x host-font-size grid. The two fixtures T2 proved run the full
// grid, because that is what shows a component's own declaration beating the host's value.
// The kinds T3 adds get one light/16px case each: the Canvas sizes come from the same
// per-frame resolution those four cases already exercise, so repeating the grid for every
// new screen would add runtime without adding a way for a wrong role name to hide.
const ROLE_FIXTURES = [
  {
    name: "components",
    screen: "screens/components.json",
    cases: "grid",
    steps: [
      { surface: "dom", selector: '.ui-button[data-target="openEditor"]' },
      { surface: "canvas", target: "draftName" },
    ],
  },
  {
    name: "grid-lab",
    screen: "screens/grid-lab.json",
    cases: "grid",
    steps: [{ surface: "dom", selector: ".ui-menu-trigger" }],
  },
  // The tree and the memo textarea live on the second and third tab, so the tabs are
  // switched with real clicks instead of measuring whatever the first tab happens to show.
  {
    name: "grid-lab-tree",
    screen: "screens/grid-lab.json",
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(2)" }],
  },
  {
    name: "grid-lab-memo",
    screen: "screens/grid-lab.json",
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(3)" }],
  },
  { name: "forms", screen: "screens/uivolve-forms.json", cases: "single", steps: [] },
  // A real WASM screen whose only job is the text shapes the measure/draw agreement has to
  // hold for: the three alignments, empty, Japanese, long ASCII, both sides of a width
  // boundary, and wrapped monospace lines. The application screens contain none of these
  // together, and asserting the conditions needs them actually painted.
  {
    name: "text-shapes",
    screen: "/tests/browser/font-parity-text.json",
    cases: "single",
    steps: [],
  },
  { name: "kanban", screen: "screens/kanban.yaml", cases: "single", steps: [] },
  { name: "orders", screen: "screens/orders.json", cases: "single", steps: [] },
  {
    name: "gallery",
    screen: GALLERY_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: '.ui-button[data-target="showToast"]' }],
  },
  // Charts reach the shared surface sprites, whose sizes T5 owns: the case is here so the
  // exemption is backed by measured draws instead of only being declared.
  {
    name: "gallery-chart",
    screen: GALLERY_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(3)" }],
  },
  // The remaining four gallery tabs. A tab that is never opened renders no widgets at all,
  // so the editors, the graphs, the conversation log and the media notices its xtypes
  // author would otherwise stay authored-but-unrendered.
  {
    name: "gallery-edit",
    screen: GALLERY_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(2)" }],
  },
  {
    name: "gallery-graph",
    screen: GALLERY_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(4)" }],
  },
  {
    name: "gallery-chat",
    screen: GALLERY_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(5)" }],
  },
  {
    name: "gallery-media",
    screen: GALLERY_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(6)" }],
  },
  // The three dialog icon shapes, chosen the way a user does: the combobox first, then the
  // button. Only the character icon paints text; the other two have to be *measured* as
  // text-free rather than assumed to be.
  {
    name: "dialogs",
    screen: DIALOGS_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: '.ui-button[data-target="showAlert"]' }],
  },
  {
    name: "dialogs-image-icon",
    screen: DIALOGS_SCREEN,
    cases: "single",
    steps: [
      { surface: "dom", selector: ICON_SELECT, value: "custom-image" },
      { surface: "dom", selector: '.ui-button[data-target="showAlert"]' },
    ],
  },
  {
    name: "dialogs-text-icon",
    screen: DIALOGS_SCREEN,
    cases: "single",
    steps: [
      { surface: "dom", selector: ICON_SELECT, value: "custom-text" },
      { surface: "dom", selector: '.ui-button[data-target="showConfirm"]' },
    ],
  },
  // The states and the xtypes no application screen renders: a fieldset that keeps its own
  // title, a toolbar built from string items, a card layout, a paging toolbar and three
  // calendars (a normal month and both ends of the supported range).
  { name: "states", screen: STATES_SCREEN, cases: "single", steps: [] },
  {
    name: "states-month-shift",
    screen: STATES_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: '[data-key="monthPicker:next"]' }],
  },
  {
    name: "states-answer",
    screen: STATES_SCREEN,
    cases: "single",
    steps: [{ surface: "dom", selector: '.ui-button[data-target="barButton"]' }],
  },
  // The drag ghost only exists while a pointer is held down, and pointer capture needs
  // real input, so these two cases drive the mouse instead of dispatching events.
  {
    name: "kanban-drag-dom",
    screen: "screens/kanban.yaml",
    cases: "single",
    steps: [],
    drag: { surface: "dom", from: "kanban-card", to: "kanban-lane", toIndex: 2 },
  },
  {
    name: "kanban-drag-canvas",
    screen: "screens/kanban.yaml",
    cases: "single",
    steps: [],
    drag: { surface: "canvas", from: "kanban-card", to: "kanban-lane", toIndex: 2 },
  },
];

function roleCases(fixture) {
  if (fixture.cases === "single")
    return [{ theme: ROLE_THEMES[0], hostFontSize: ROLE_HOST_SIZES[0] }];
  return ROLE_THEMES.flatMap((theme) =>
    ROLE_HOST_SIZES.map((hostFontSize) => ({ theme, hostFontSize })),
  );
}

const roleSpecs = () =>
  ROLE_CONTRACT.map(({ role, selector, pseudo }) => ({ role, selector, pseudo: pseudo ?? null }));

// Hold a real drag open across the measurement: press at the card, move into another lane,
// measure, then cancel with Escape so the fixture state is left as it was found.
async function holdDrag(page, drag) {
  const at = (kind, index) =>
    page.evaluate((input) => window.__fontParityHarness.widgetPoint(input), {
      surface: drag.surface,
      kind,
      index,
    });
  const from = await at(drag.from, drag.fromIndex ?? 0);
  const to = await at(drag.to, drag.toIndex ?? 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  return async () => {
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.evaluate(() => window.__fontParityHarness.afterFrame());
  };
}

async function captureRoles(page, { fixture, theme, hostFontSize }) {
  await page.evaluate(
    async (input) => {
      const module = await import("/tests/browser/font-parity-harness.js");
      const harness = await module.createFontParityHarness({
        screen: input.screen,
        hostFontSize: input.hostFontSize,
        themeUrl: input.themeUrl,
      });
      window.__fontParityHarness = harness;
      try {
        await harness.settle();
        for (const step of input.steps)
          if (step.value !== undefined) await harness.selectDom(step.selector, step.value);
          else if (step.surface === "dom") await harness.clickDom(step.selector);
          else await harness.clickCanvas(step.target);
      } catch (error) {
        document.getElementById("font-parity-error").textContent = error.stack ?? String(error);
        throw error;
      }
    },
    {
      screen: fixture.screen,
      hostFontSize,
      themeUrl: theme.url,
      steps: fixture.steps,
    },
  );
  const release = fixture.drag ? await holdDrag(page, fixture.drag) : null;
  const observed = await page.evaluate(
    (input) => window.__fontParityHarness.roles(input.specs, input.noText),
    { specs: roleSpecs(), noText: Object.keys(KIND_NO_TEXT) },
  );
  return {
    capture: { fixture: fixture.name, mode: theme.mode, hostFontSize, ...observed },
    release,
  };
}

// --- Canvas side of the same roles ------------------------------------------------
// Which sizes each Canvas kind is allowed to paint, named as roles. The pixels come from
// SIZE_CONTRACT, which the DOM samples above are measured against as well, so a Canvas
// size and its DOM declaration cannot drift apart without one of the two checks failing.
const CANVAS_KIND_CONTRACT = {
  label: ["label"],
  empty: ["caption"],
  displayfield: ["label", "body"],
  metric: ["label", "metric"],
  button: ["caption"],
  "extra-button": ["caption"],
  panel: ["caption"],
  fieldset: ["caption"],
  window: ["caption"],
  "window-close": ["close"],
  "panel-toggle": ["caption"],
  "tree-shell": ["caption"],
  "tree-node": ["caption"],
  "tree-toggle": ["caption"],
  tab: ["caption"],
  "menu-trigger": ["caption"],
  "menu-item": ["caption"],
  "grid-column": ["caption"],
  "grid-cell": ["caption"],
  "grid-select": ["caption"],
  "grid-page": ["caption"],
  "grid-header": ["label"],
  row: ["caption"],
  progressbar: ["caption"],
  toast: ["body"],
  "dialog-message": ["body"],
  "kanban-lane": ["caption", "label"],
  // The drag ghost paints the card's own two roles at the pointer, so it needs no entry
  // of its own; it is attributed to whichever card or lane it is being held over.
  "kanban-card": ["caption", "label", "meta"],
  // Fields paint their label and their value. A Grid cell editor is the exception and is
  // handled below: its label strip is zero-height and its value takes the cell's caption.
  textfield: ["label", "body"],
  numberfield: ["label", "body"],
  datefield: ["label", "body"],
  textarea: ["label", "body"],
  combobox: ["label", "body"],
  listbox: ["label", "body"],
  checkbox: ["label", "body"],
  radio: ["label", "body"],
  slider: ["label"],
};

// Canvas text the `surfaces` suite owns instead of this one. Recorded with the reason
// rather than dropped, so an exemption is visible in the ledger instead of being implied
// by a missing check. These kinds do not paint one of the role sizes: the shared sprites
// carry their own sizes under a local scale, and the dialog icon and the media notice are
// compared against their DOM counterparts directly (see runSurfaces below).
const CANVAS_DEFERRED_KINDS = {
  figure: "surfaces suite: sprites の内容矩形換算（ローカル倍率あり）",
  document: "surfaces suite: 文書 sprites の内容矩形換算（ローカル倍率あり）",
  "dialog-icon": "surfaces suite: ダイアログの文字アイコン 30px と maxWidth",
  image: "surfaces suite: media の空/エラー案内を DOM の 12px と直接比較",
  video: "surfaces suite: media の空/エラー案内を DOM の 12px と直接比較",
  iframe: "surfaces suite: media の空/エラー案内を DOM の 12px と直接比較",
};

// Kinds these fixtures really render, and the ones they cannot reach. Both lists are
// asserted against CANVAS_KIND_CONTRACT so a kind can never fall out of the check by
// being forgotten in either direction.
const REQUIRED_CANVAS_KINDS = [
  "label",
  "displayfield",
  "metric",
  "button",
  "extra-button",
  "panel",
  "window",
  "window-close",
  "panel-toggle",
  "tree-shell",
  "tree-node",
  "tab",
  "menu-trigger",
  "menu-item",
  "grid-column",
  "grid-cell",
  "grid-header",
  "row",
  "toast",
  "dialog-message",
  "kanban-lane",
  "kanban-card",
  "textfield",
  "numberfield",
  "datefield",
  "textarea",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "slider",
  "progressbar",
  "grid-page",
  "grid-select",
  "tree-toggle",
  "empty",
  // T7 closes this one: the states fixture authors a fieldset that is *not* collapsible, so
  // the box keeps its own title instead of handing it to a panel-toggle.
  "fieldset",
];
// Every contracted kind is now reached by a fixture; the table is kept so a kind that
// stops being reachable has to be recorded with a reason instead of dropping out.
const CANVAS_COVERAGE_GAPS = {};

for (const kind of REQUIRED_CANVAS_KINDS)
  if (!CANVAS_KIND_CONTRACT[kind]) throw new Error(`Required Canvas kind ${kind} has no contract`);
for (const kind of Object.keys(CANVAS_KIND_CONTRACT))
  if (!REQUIRED_CANVAS_KINDS.includes(kind) && !CANVAS_COVERAGE_GAPS[kind])
    throw new Error(`Canvas kind ${kind} is neither required nor recorded as a gap`);

// --- the second layer: xtypes ------------------------------------------------------
// The contract above is the kind layer, and on its own it cannot answer whether the kind
// list is complete: kinds are not authored, the engine derives them from the DSL's xtypes.
// So the xtypes are enumerated from the engine's own allowlist and each one is rendered
// through the real WASM engine (tests/font-parity-runner.test.js). Three things fail there
// instead of quietly leaving a role unchecked: an xtype with no shape, a produced kind no
// table owns, and an owned kind nothing produces.

// Scene kinds that paint no characters on either surface, with how that is established.
// `engine-empty`: the engine leaves text/value/cells empty, so there is nothing to paint;
// the probe asserts it. `renderer-skips`: the widget does carry a string, but it is an
// accessible name — the DOM renderer puts it on an attribute and skips `textContent`, and
// the Canvas renderer draws only the box. Those two are the ones worth stating explicitly,
// because "has no text" and "paints no text" are different claims.
export const KIND_NO_TEXT = {
  backdrop: { basis: "engine-empty", why: "モーダルの背面。文字を持たない" },
  card: {
    basis: "engine-empty",
    why: "card レイアウトの面。engine が text を空にする（layouts::describe_card）",
  },
  "grid-head": { basis: "engine-empty", why: "Grid の見出し帯。文字は子の grid-column が描く" },
  "grid-row": { basis: "engine-empty", why: "Grid の行帯。文字は子の grid-cell が描く" },
  "grid-shell": {
    basis: "renderer-skips",
    why:
      "Grid の外枠。text は一覧の題だが DOM は aria-label に載せて textContent を飛ばし" +
      "（src/dom-renderer.js の除外一覧）、Canvas は枠だけを描く。文字は子の grid-cell が描く",
  },
  "menu-surface": {
    basis: "renderer-skips",
    why:
      "ポップアップの面。text は引き金の見出しだが DOM は role=menu の面に textContent を" +
      "入れず、Canvas も枠だけを描く。文字は子の menu-item が描く",
  },
  menuseparator: { basis: "engine-empty", why: "メニューの区切り線。文字を持たない" },
  separator: {
    basis: "engine-empty",
    why: "ツールバーの区切り線（tbseparator）。engine が text を空にする",
  },
  tabbar: { basis: "engine-empty", why: "タブ帯。文字は子の tab が描く" },
  toolbar: { basis: "engine-empty", why: "ツールバーの外枠。engine が text を空にする" },
};

// Authored alias -> canonical xtype. Used to canonicalise what a screen definition writes
// before it is matched against the allowlist; every key is asserted to load through the
// engine, and every value to be an allowlisted xtype.
export const XTYPE_ALIASES = {
  box: "component",
  tbar: "toolbar",
  imagecomponent: "image",
  uxiframe: "iframe",
  cartesian: "chart",
  polar: "chart",
  forcegraph: "networkgraph",
  chat: "chatpanel",
  console: "terminal",
  code: "textarea",
  codeeditor: "textarea",
  htmleditor: "textarea",
  diff: "diffeditor",
  msgbox: "window",
  messagebox: "window",
  splitbutton: "container",
  form: "panel",
  fieldcontainer: "container",
  textareafield: "textarea",
  checkboxfield: "checkbox",
  radiofield: "radio",
  combo: "combobox",
  multiselect: "listbox",
  sliderfield: "slider",
  progress: "progressbar",
  gridpanel: "grid",
  tree: "treepanel",
};

export const canonicalXtype = (xtype) => {
  let name = xtype;
  for (let hops = 0; hops < 8 && XTYPE_ALIASES[name]; hops += 1) name = XTYPE_ALIASES[name];
  return name;
};

// The allowlist the engine validates against, read out of its source so the shape table
// below cannot fall behind a new xtype. A parse that stops matching throws rather than
// silently shrinking the list it is compared against.
export function engineXtypes() {
  const source = readFileSync(new URL("../../engine/src/lib.rs", import.meta.url), "utf8");
  const block = source.match(/if !\[\n((?:\s+"[a-z]+",\n)+)\s*\]\n\s*\.contains\(&node\.xtype/);
  if (!block) throw new Error("engine/src/lib.rs の xtype 許可リストを読み取れない");
  return block[1].match(/"([a-z]+)"/g).map((quoted) => quoted.slice(1, -1));
}

// One row per xtype, plus one more wherever an xtype has a second rendering shape (a
// collapsible panel, the two Grid renderings, an open menu, a hidden toast). The nodes are
// the smallest thing that renders; `kinds` is the Scene kind set the real engine produces,
// asserted for exact equality. The three rows with a `handler` are the dialog surfaces and
// the alias expansions, which no xtype of their own reaches.
export const XTYPE_PROBE_STATE = {
  open: true,
  closed: false,
  num: 1,
  count: 100,
  text: "値",
  day: "2026-10-06",
  on: true,
  pick: "rb",
  ratio: 0.5,
  rows: [{ id: "1", name: "名前", qty: 2 }],
  none: [],
  cards: [{ id: "c1", title: "札", lane: "a", description: "説明" }],
  tree: [{ id: "a", text: "節", children: [{ id: "b", text: "子", children: [] }] }],
  month: "2026-10",
  page: 0,
  sort: { column: "name", direction: "asc" },
  editing: null,
  selectedIds: ["1"],
  expanded: ["a"],
};

const CHILD_LABEL = [{ xtype: "label", text: "子" }];
const PROBE_COLUMNS = [{ dataIndex: "name", text: "名前" }];

export const XTYPE_SHAPES = [
  { xtype: "container", node: { items: CHILD_LABEL }, kinds: ["label"] },
  {
    xtype: "panel",
    shape: "plain",
    node: { title: "枠", items: CHILD_LABEL },
    kinds: ["label", "panel"],
  },
  {
    xtype: "panel",
    shape: "collapsible",
    node: { itemId: "pc", title: "枠", collapsible: true, items: CHILD_LABEL },
    kinds: ["label", "panel", "panel-toggle"],
  },
  {
    xtype: "window",
    node: { itemId: "win", title: "窓", visibleBind: "open", items: CHILD_LABEL },
    kinds: ["backdrop", "label", "window", "window-close"],
  },
  { xtype: "label", node: { text: "文字" }, kinds: ["label"] },
  { xtype: "metric", node: { text: "指標", bind: "num" }, kinds: ["metric"] },
  {
    xtype: "textfield",
    node: { itemId: "tf", fieldLabel: "文字", bind: "text" },
    kinds: ["textfield"],
  },
  {
    xtype: "textarea",
    node: { itemId: "ta", fieldLabel: "複数行", bind: "text" },
    kinds: ["textarea"],
  },
  {
    xtype: "numberfield",
    node: { itemId: "nf", fieldLabel: "数値", bind: "num" },
    kinds: ["numberfield"],
  },
  {
    xtype: "datefield",
    node: { itemId: "df", fieldLabel: "日付", bind: "day" },
    kinds: ["datefield"],
  },
  { xtype: "checkbox", node: { itemId: "cb", boxLabel: "選択", bind: "on" }, kinds: ["checkbox"] },
  { xtype: "radio", node: { itemId: "rb", boxLabel: "単一", bind: "pick" }, kinds: ["radio"] },
  {
    xtype: "combobox",
    node: { itemId: "co", fieldLabel: "選択", bind: "text", options: [{ value: "a", text: "A" }] },
    kinds: ["combobox"],
  },
  {
    xtype: "listbox",
    node: { itemId: "lb", fieldLabel: "一覧", bind: "text", options: [{ value: "a", text: "A" }] },
    kinds: ["listbox"],
  },
  { xtype: "displayfield", node: { fieldLabel: "表示", value: "値" }, kinds: ["displayfield"] },
  { xtype: "slider", node: { itemId: "sl", fieldLabel: "量", bind: "num" }, kinds: ["slider"] },
  { xtype: "progressbar", node: { bind: "ratio", text: "進捗" }, kinds: ["progressbar"] },
  {
    xtype: "fieldset",
    shape: "plain",
    node: { title: "群", items: CHILD_LABEL },
    kinds: ["fieldset", "label"],
  },
  {
    xtype: "fieldset",
    shape: "collapsible",
    node: { itemId: "fc", title: "群", collapsible: true, items: CHILD_LABEL },
    kinds: ["fieldset", "label", "panel-toggle"],
  },
  { xtype: "button", node: { itemId: "bt", text: "押す" }, kinds: ["button"] },
  {
    xtype: "grid",
    shape: "basic",
    node: { itemId: "gr", bind: "rows", columns: PROBE_COLUMNS },
    kinds: ["grid-header", "row"],
  },
  {
    xtype: "grid",
    shape: "basic-empty",
    node: { itemId: "gre", bind: "none", columns: PROBE_COLUMNS },
    kinds: ["empty", "grid-header"],
  },
  {
    xtype: "grid",
    shape: "advanced",
    node: {
      itemId: "ga",
      bind: "rows",
      pageBind: "page",
      sortBind: "sort",
      editingBind: "editing",
      selectedBind: "selectedIds",
      multiSelect: true,
      pageSize: 1,
      columns: [
        { dataIndex: "name", text: "名前", editor: { xtype: "textfield" } },
        { dataIndex: "qty", text: "数量", align: "right" },
      ],
    },
    kinds: [
      "grid-cell",
      "grid-column",
      "grid-head",
      "grid-page",
      "grid-row",
      "grid-select",
      "grid-shell",
      "label",
    ],
  },
  {
    xtype: "grid",
    shape: "advanced-empty",
    node: {
      itemId: "gae",
      bind: "none",
      pageBind: "page",
      columns: [{ dataIndex: "name", text: "名前", editor: { xtype: "textfield" } }],
    },
    kinds: ["empty", "grid-column", "grid-head", "grid-page", "grid-shell", "label"],
  },
  {
    xtype: "kanban",
    node: { itemId: "kb", bind: "cards", lanes: [{ id: "a", title: "レーン" }] },
    kinds: ["kanban-card", "kanban-lane"],
  },
  {
    xtype: "tabpanel",
    node: { items: [{ xtype: "container", title: "タブ", items: [] }] },
    kinds: ["tab", "tabbar"],
  },
  {
    xtype: "treepanel",
    node: { itemId: "tp", bind: "tree" },
    kinds: ["tree-node", "tree-shell", "tree-toggle"],
  },
  {
    xtype: "menu",
    shape: "closed",
    node: {
      itemId: "mn",
      text: "メニュー",
      openBind: "closed",
      items: [{ xtype: "button", itemId: "mi", text: "項目" }],
    },
    kinds: ["menu-trigger"],
  },
  {
    xtype: "menu",
    shape: "open",
    node: {
      itemId: "mo",
      text: "メニュー",
      openBind: "open",
      items: [{ xtype: "button", itemId: "mi2", text: "項目" }, { xtype: "menuseparator" }],
    },
    kinds: ["menu-item", "menu-surface", "menu-trigger", "menuseparator"],
  },
  { xtype: "menuseparator", node: {}, kinds: ["menuseparator"] },
  {
    xtype: "toolbar",
    node: { items: [{ xtype: "button", itemId: "tbb", text: "押す" }] },
    kinds: ["button", "toolbar"],
  },
  { xtype: "tbfill", node: {}, kinds: [] },
  { xtype: "tbseparator", node: {}, kinds: ["separator"] },
  { xtype: "tbspacer", node: {}, kinds: [] },
  { xtype: "tbtext", node: { text: "帯の文字" }, kinds: ["label"] },
  {
    xtype: "radiogroup",
    node: { itemId: "rg", fieldLabel: "群", bind: "pick", items: [{ boxLabel: "甲" }] },
    kinds: ["label", "radio"],
  },
  {
    xtype: "checkboxgroup",
    node: { itemId: "cg", fieldLabel: "群", items: [{ boxLabel: "甲", bind: "on" }] },
    kinds: ["checkbox", "label"],
  },
  {
    xtype: "datepicker",
    node: { itemId: "dp", bind: "day", pageBind: "month", showToday: true, today: "2026-10-06" },
    kinds: ["extra-button", "label"],
  },
  {
    xtype: "pagingtoolbar",
    node: { itemId: "pt", bind: "count", pageBind: "page" },
    kinds: ["extra-button", "label"],
  },
  {
    xtype: "dialogbutton",
    node: { itemId: "db", text: "答", inputValue: "答" },
    kinds: ["button"],
  },
  {
    xtype: "toast",
    shape: "visible",
    node: { itemId: "ts", title: "通知", message: "本文", visibleBind: "open" },
    kinds: ["extra-button", "toast"],
  },
  {
    xtype: "toast",
    shape: "hidden",
    node: { itemId: "ts2", title: "通知", message: "本文", visibleBind: "closed" },
    kinds: [],
  },
  { xtype: "component", node: { value: "本文" }, kinds: ["document"] },
  { xtype: "markdown", node: { title: "文書", value: "# 見出し\n本文" }, kinds: ["document"] },
  { xtype: "diffeditor", node: { title: "差分", value: "- 旧\n+ 新" }, kinds: ["document"] },
  { xtype: "chatpanel", node: { title: "会話", items: [] }, kinds: ["document"] },
  { xtype: "terminal", node: { title: "端末", value: "$ echo" }, kinds: ["document"] },
  { xtype: "image", node: { itemId: "im", src: "/missing.png", alt: "画像" }, kinds: ["image"] },
  { xtype: "video", node: { itemId: "vd", src: "/missing.mp4", alt: "動画" }, kinds: ["video"] },
  {
    xtype: "iframe",
    node: { itemId: "ifr", src: "https://example.test/", alt: "枠" },
    kinds: ["iframe"],
  },
  {
    xtype: "chart",
    node: { title: "図", series: [{ type: "line", data: [1, 2] }] },
    kinds: ["figure"],
  },
  {
    xtype: "draw",
    node: { title: "描画", sprites: [{ type: "text", x: 4, y: 12, text: "文字" }] },
    kinds: ["figure"],
  },
  {
    xtype: "gitgraph",
    node: { title: "履歴", commits: [{ id: "a", message: "初回" }] },
    kinds: ["figure"],
  },
  {
    xtype: "networkgraph",
    node: { title: "網", nodes: [{ id: "a", label: "甲" }], edges: [] },
    kinds: ["figure"],
  },
  { xtype: "mermaid", node: { title: "図式", value: "graph TD; A-->B;" }, kinds: ["figure"] },
  // The `card` kind comes from a *layout*, not an xtype, so no row above reaches it.
  {
    xtype: "container",
    shape: "card-layout",
    node: {
      itemId: "deck",
      layout: "card",
      activeItem: 0,
      items: [
        { xtype: "container", title: "甲", items: CHILD_LABEL },
        { xtype: "container", title: "乙", items: [] },
      ],
    },
    kinds: ["card", "label"],
  },
  // The two alias expansions that do not simply rename: a messagebox becomes a window with
  // a document body and dialogbutton answers, a splitbutton becomes a button plus a menu.
  {
    xtype: "messagebox",
    node: {
      itemId: "mb",
      title: "確認",
      message: "本文",
      buttons: "okcancel",
      visibleBind: "open",
      handler: "noted",
    },
    kinds: ["backdrop", "button", "document", "window", "window-close"],
  },
  {
    xtype: "splitbutton",
    node: {
      itemId: "sb",
      text: "保存",
      handler: "noted",
      menu: { items: [{ xtype: "button", itemId: "sb1", text: "下書き" }] },
    },
    kinds: ["button", "menu-trigger"],
  },
  {
    xtype: "codeeditor",
    node: { itemId: "ce", fieldLabel: "コード", bind: "text", language: "javascript" },
    kinds: ["textarea"],
  },
  // The dialog surfaces: reached through the dialog API, never through an xtype. The icon
  // is a separate widget only when the operation has one, which is what makes the
  // "standard / image / emoji / none" states distinguishable in the ledger.
  {
    source: "dialogs.alert",
    node: { itemId: "ask", text: "開く", handler: "openIt" },
    xtype: "button",
    dispatch: "ask",
    script: 'fn openIt(s, e) { alert("本文のメッセージ", "noted"); s }',
    kinds: ["backdrop", "button", "dialog-icon", "dialog-message", "window", "window-close"],
  },
  {
    source: "dialogs.prompt",
    node: { itemId: "ask", text: "開く", handler: "openIt" },
    xtype: "button",
    dispatch: "ask",
    script: 'fn openIt(s, e) { prompt("入力のメッセージ", "noted"); s }',
    kinds: [
      "backdrop",
      "button",
      "dialog-icon",
      "dialog-message",
      "textfield",
      "window",
      "window-close",
    ],
  },
  {
    source: "dialogs.icon-none",
    node: { itemId: "ask", text: "開く", handler: "openIt" },
    xtype: "button",
    dispatch: "ask",
    script: 'fn openIt(s, e) { alert("案内", "noted", #{icon: "none"}); s }',
    kinds: ["backdrop", "button", "dialog-message", "window", "window-close"],
  },
];

export const shapeLabel = (shape) =>
  shape.source ?? (shape.shape ? `${shape.xtype}/${shape.shape}` : shape.xtype);

// Who checks a kind's painted size. Exactly one of the three, and the probe asserts the
// three tables together account for every kind the engine can produce.
export function kindOwner(kind) {
  if (CANVAS_KIND_CONTRACT[kind]) return { suite: "roles", roles: CANVAS_KIND_CONTRACT[kind] };
  if (CANVAS_DEFERRED_KINDS[kind]) return { suite: "surfaces", why: CANVAS_DEFERRED_KINDS[kind] };
  if (KIND_NO_TEXT[kind]) return { suite: "none", ...KIND_NO_TEXT[kind] };
  return null;
}

// The pure half of the closure: it needs no engine and no browser, so it runs in the unit
// tests as well as in the suite below.
export function xtypeTableProblems() {
  const problems = [];
  const allowed = engineXtypes();
  const shaped = new Set(XTYPE_SHAPES.map((shape) => shape.xtype));
  for (const xtype of allowed)
    if (!shaped.has(xtype)) problems.push(`xtype ${xtype} に shape が無い`);
  for (const shape of XTYPE_SHAPES)
    if (!allowed.includes(shape.xtype) && !XTYPE_ALIASES[shape.xtype])
      problems.push(`shape ${shapeLabel(shape)} の xtype は許可リストにも別名表にも無い`);
  for (const [alias, target] of Object.entries(XTYPE_ALIASES))
    if (!allowed.includes(target))
      problems.push(`別名 ${alias} の正規名 ${target} は許可リストに無い`);
  // No kind may be owned twice, and none of the three tables may hold a dead entry.
  const produced = new Set(XTYPE_SHAPES.flatMap((shape) => shape.kinds));
  for (const kind of produced)
    if (!kindOwner(kind)) problems.push(`kind ${kind} を担当する表が無い`);
  for (const table of [CANVAS_KIND_CONTRACT, CANVAS_DEFERRED_KINDS, KIND_NO_TEXT])
    for (const kind of Object.keys(table))
      if (!produced.has(kind)) problems.push(`kind ${kind} を生む shape が無い`);
  for (const kind of produced) {
    const tables = [CANVAS_KIND_CONTRACT, CANVAS_DEFERRED_KINDS, KIND_NO_TEXT].filter(
      (table) => table[kind],
    );
    if (tables.length > 1) problems.push(`kind ${kind} の担当が ${tables.length} 表に重なる`);
  }
  return problems;
}

// The kinds each xtype can produce, folded over its shapes.
export const XTYPE_KINDS = new Map(
  engineXtypes().map((xtype) => [
    xtype,
    [
      ...new Set(
        XTYPE_SHAPES.filter((shape) => shape.xtype === xtype).flatMap((shape) => shape.kinds),
      ),
    ],
  ]),
);

// What a screen definition authors: the canonical xtypes, and the itemId -> xtype map that
// lets a Scene widget be traced back to the node that asked for it (`widget.target` is the
// authoring node's itemId). The walk follows every key that can hold child nodes, so a
// component on an unopened tab counts as authored — the suite then has to prove it was
// actually *rendered*, which is what the per-tab fixtures are for.
const NODE_CHILD_KEYS = ["items", "columns", "menu", "tbar", "bbar", "buttons", "lanes"];

// The one slice of extras::normalize the walk has to reproduce: the xtypes a screen cannot
// write down. A toolbar's string items become four different nodes depending on the string
// and a messagebox's `buttons` become dialogbuttons, so without this the authored set would
// miss five xtypes and the kind-level proof for them would be vacuous (a `label` from any
// screen at all would "prove" tbtext).
function synthesizedFrom(node, into) {
  const xtype = canonicalXtype(node.xtype);
  if (xtype === "toolbar")
    for (const child of node.items ?? [])
      if (typeof child === "string")
        into.add(
          child === "->"
            ? "tbfill"
            : child === "-"
              ? "tbseparator"
              : child.trim() === ""
                ? "tbspacer"
                : "tbtext",
        );
  if (xtype === "menu")
    for (const child of node.items ?? [])
      if (typeof child === "string" && child === "-") into.add("menuseparator");
  // A messagebox always gets answer buttons, named or defaulted to a single OK.
  if (node.xtype === "messagebox" || node.xtype === "msgbox") into.add("dialogbutton");
}

export function screenCoverage(screen) {
  const path = screen.startsWith("/")
    ? new URL(`../..${screen}`, import.meta.url)
    : new URL(`../../public/${screen}`, import.meta.url);
  const definition = parsePackage(readFileSync(path, "utf8"), packageFormat(screen));
  const xtypes = new Set();
  const targets = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.xtype === "string" && node.xtype) {
      const canonical = canonicalXtype(node.xtype);
      xtypes.add(canonical);
      synthesizedFrom(node, xtypes);
      if (typeof node.itemId === "string" && node.itemId) targets.set(node.itemId, canonical);
    }
    for (const key of NODE_CHILD_KEYS) if (node[key] !== undefined) walk(node[key]);
  };
  walk(definition.ui);
  return { xtypes, targets };
}

// xtypes normalize synthesises: a screen cannot author them, so a fixture authors the
// trigger instead. Named with that trigger, because the authored-xtype walk above will
// never see them and "not authored" must not read as "not covered".
export const XTYPE_SYNTHESIZED = {
  tbtext: 'toolbar の文字列項目（states fixture の "帯の文字"）',
  tbfill: 'toolbar の "->"',
  tbseparator: 'toolbar の "-"',
  tbspacer: "toolbar の空白だけの項目",
  dialogbutton: "messagebox の buttons（states fixture の answerBox）",
};

// The two xtypes no browser check can observe: they produce no Scene widget at all, so
// there is nothing on either surface to measure. The engine probe records that as the
// measured fact (kinds: []) rather than leaving it implied.
export const XTYPE_RENDER_EXEMPT = {
  tbfill: "widget を 1 つも生まない（残り幅の配分だけ）。probe が kinds:[] を実測する",
  tbspacer: "widget を 1 つも生まない（固定幅の間隔だけ）。probe が kinds:[] を実測する",
};

// An xtype counts as rendered when a widget traces back to one of its authored itemIds, or
// — for nodes the screen left unnamed and for the ids normalize rewrites — when the screen
// authors the xtype and one of its kinds is in the Scene. Both are recorded, so the ledger
// shows which xtypes only carry the weaker proof; the exact per-xtype kind proof is the
// engine probe in tests/font-parity-runner.test.js.
export function renderedXtypes(capture, coverage) {
  const byTarget = new Set();
  const byKind = new Set();
  const kinds = new Set(capture.scene?.widgets.map((widget) => widget.kind) ?? []);
  for (const widget of capture.scene?.widgets ?? []) {
    const xtype = coverage.targets.get(widget.target);
    if (xtype) byTarget.add(xtype);
  }
  for (const xtype of coverage.xtypes)
    if ((XTYPE_KINDS.get(xtype) ?? []).some((kind) => kinds.has(kind))) byKind.add(xtype);
  return { byTarget, byKind };
}

// --- state coverage ----------------------------------------------------------------
// The temporary and conditional states every role has to have been measured in at least
// once. A state nothing matched is a hole in the check, not a pass; a state another suite
// owns names that suite and its evidence instead of being measured twice.
//
// The month the calendar fixture starts on is 2026-10, so one real click on `›` has to
// land here; the longest heading the engine can format is the end of the supported range.
const CALENDAR_AFTER_SHIFT = "2026年 11月";
const CALENDAR_LONGEST_TITLE = "9999年 12月";

export const STATE_CONTRACT = [
  {
    state: "selected",
    suite: "roles",
    detect: ({ capture }) => capture.scene.widgets.some((widget) => widget.selected),
    why: "選択中でもサイズは変わらない（Grid 行・カレンダーの選択日・タブ）",
  },
  {
    state: "disabled",
    suite: "roles",
    detect: ({ capture }) => capture.scene.widgets.some((widget) => widget.disabled),
    why: "使用不可でもサイズは変わらない（disabled のボタン・カレンダーの前後月）",
  },
  {
    state: "collapsed-panel",
    suite: "roles",
    detect: ({ canvas }) => canvas.some((record) => record.kind === "panel-toggle"),
    why: "折りたたみの見出しは panel-toggle が描く",
  },
  {
    state: "popup-open",
    suite: "roles",
    detect: ({ samples }) => samples.some((sample) => sample.context === "popup"),
    why: "開いたメニューの中は親コンテキストが変わる",
  },
  {
    state: "toast",
    suite: "roles",
    detect: ({ canvas }) => canvas.some((record) => record.kind === "toast"),
    why: "一時通知。visibleBind が真のときだけ出る",
  },
  {
    state: "dialog-standard-icon",
    suite: "roles",
    detect: ({ capture, deferred }) =>
      capture.scene.widgets.some(
        (widget) => widget.kind === "dialog-icon" && typeof widget.icon === "string",
      ) && !deferred.some((record) => record.kind === "dialog-icon"),
    why: "組み込みの SVG アイコン。文字を描かないことを実測で確かめる",
  },
  {
    state: "dialog-image-icon",
    suite: "roles",
    detect: ({ capture, deferred }) =>
      capture.scene.widgets.some((widget) => widget.kind === "dialog-icon" && widget.icon?.src) &&
      !deferred.some((record) => record.kind === "dialog-icon"),
    why: "任意の画像アイコン。文字を描かないことを実測で確かめる",
  },
  {
    state: "dialog-text-icon",
    suite: "roles",
    detect: ({ capture, deferred }) =>
      capture.scene.widgets.some((widget) => widget.kind === "dialog-icon" && widget.icon?.text) &&
      deferred.some((record) => record.kind === "dialog-icon"),
    why: "絵文字・任意文字のアイコン。30px の実測は surfaces suite が持つ",
  },
  {
    state: "messagebox-answers",
    suite: "roles",
    detect: ({ capture }) =>
      capture.scene.widgets.some(
        (widget) => widget.kind === "button" && /-answer-\d+$/.test(widget.target ?? ""),
      ),
    why: "messagebox の応答ボタン。normalize が dialogbutton を合成し button として描く",
  },
  {
    state: "drag-ghost",
    suite: "roles",
    detect: ({ samples }) =>
      samples.some((sample) => sample.role === "ghost-title" || sample.role === "ghost-detail"),
    why: "押下中だけ存在する。実マウスで保持したまま計測する",
  },
  {
    state: "field-without-label",
    suite: "roles",
    detect: ({ capture }) =>
      capture.scene.widgets.some((widget) => widget.labelHeight === 0 && !widget.gridEditor),
    why: "ラベル帯が 0 の field（fieldLabel の無い checkbox / radio）",
  },
  {
    state: "grid-empty",
    suite: "roles",
    detect: ({ canvas }) => canvas.some((record) => record.kind === "empty"),
    why: "一致 0 件の案内文",
  },
  {
    state: "calendar-month-shift",
    suite: "roles",
    detect: ({ capture }) =>
      capture.scene.widgets.some((widget) => widget.text === CALENDAR_AFTER_SHIFT),
    why: "実クリックで月を送った後の見出し。初期の月とは別の月であること",
  },
  {
    state: "calendar-long-title",
    suite: "roles",
    detect: ({ capture }) =>
      capture.scene.widgets.some((widget) => widget.text === CALENDAR_LONGEST_TITLE),
    why: "対応範囲でいちばん長い月見出し",
  },
  {
    state: "calendar-month-edge",
    suite: "roles",
    detect: ({ capture }) =>
      capture.scene.widgets.some((widget) => widget.variant === "muted") &&
      capture.scene.widgets.some(
        (widget) => widget.kind === "extra-button" && widget.disabled && widget.text === "‹",
      ),
    why: "前後月のはみ出し日と、これ以上戻れない月での送りボタン",
  },
  {
    state: "editing-overlay",
    suite: "editing",
    evidence: "editing suite（T4）: Grid 編集中 11 件を含む 16 ケース",
    why: "編集中のサイズと下書き保持は editing suite が実操作で測る",
  },
  {
    state: "media-empty-or-error",
    suite: "surfaces",
    evidence: "surfaces suite（T5）: media 案内 46 件",
    why: "空・エラーの案内文は surfaces suite が DOM の 12px と直接比べる",
  },
  {
    state: "font-loaded",
    suite: "lifecycle",
    evidence: "lifecycle suite（T6）: 遅延配信の前後 5 ケース",
    why: "字体の読込完了・失敗後の再描画は lifecycle suite が測る",
  },
];

export function stateTableProblems() {
  const problems = [];
  const seen = new Set();
  for (const entry of STATE_CONTRACT) {
    if (seen.has(entry.state)) problems.push(`状態 ${entry.state} が重複している`);
    seen.add(entry.state);
    if (!entry.suite) problems.push(`状態 ${entry.state} に担当 suite が無い`);
    if (!entry.why) problems.push(`状態 ${entry.state} に理由が無い`);
    if (entry.suite === "roles" && !entry.detect)
      problems.push(`状態 ${entry.state} は roles suite 担当なのに判定が無い`);
    if (entry.suite !== "roles" && !entry.evidence)
      problems.push(`状態 ${entry.state} は他 suite 担当なのに証跡の指し先が無い`);
  }
  return problems;
}

// Used by attribute(): a draw belongs to a kind that paints characters, and a scaled draw
// belongs to the surface that scaled it.
const SURFACE_KINDS = new Set(["figure", "document"]);
const TEXT_PAINTING_KINDS = new Set([
  ...Object.keys(CANVAS_KIND_CONTRACT),
  ...Object.keys(CANVAS_DEFERRED_KINDS),
]);
const TEXT_OR_FREE_KINDS = new Set([...TEXT_PAINTING_KINDS, ...Object.keys(KIND_NO_TEXT)]);

const sizeRoleOf = (px) =>
  Object.entries(SIZE_CONTRACT).find(([, value]) => value === px)?.[0] ?? null;

// Every Canvas draw of a kind this task owns: its size must be one of that kind's roles,
// it must carry no local scaling, and it must use the family the stage resolved.
function assertCanvasRoles(capture, problems) {
  const where = `${capture.fixture}/${capture.mode}/host ${capture.hostFontSize}`;
  const note = (message) => problems.push(`${where}: canvas ${message}`);
  if (!capture.scene) {
    note("Scene が取得できなかった");
    return { asserted: [], deferred: [], textFree: [] };
  }
  if (!capture.canvasSurface?.draws.length) {
    note("描画が記録されなかった");
    return { asserted: [], deferred: [], textFree: [] };
  }
  const records = canvasRecords(capture.canvasSurface, capture.scene.widgets, capture.fixture);
  const family = capture.resolved.canvas.ok ? capture.resolved.canvas.family : null;
  const asserted = [];
  const deferred = [];
  const textFree = [];
  for (const record of records) {
    if (record.kind && CANVAS_DEFERRED_KINDS[record.kind]) {
      deferred.push({ ...record, reason: CANVAS_DEFERRED_KINDS[record.kind] });
      continue;
    }
    // A kind recorded as painting no characters may reach fillText, but only with an empty
    // string. A character here would mean the ledger's reason is wrong.
    if (record.kind && KIND_NO_TEXT[record.kind]) {
      if (record.text !== "")
        note(
          `文字を描かないはずの ${record.kind} が "${record.text.slice(0, 18)}" を描いた` +
            `（${record.declaredFontSize}px）`,
        );
      textFree.push({ ...record, reason: KIND_NO_TEXT[record.kind].why });
      continue;
    }
    if (!record.kind) {
      note(`"${record.text.slice(0, 18)}" (${record.x},${record.y}) を部品に対応付けられない`);
      continue;
    }
    // A Grid cell editor replaces the cell, so it paints at the cell's size instead of the
    // field's. The flag comes from the Scene widget, not from the kind.
    const allowed = record.gridEditor ? ["caption"] : CANVAS_KIND_CONTRACT[record.kind];
    if (!allowed) {
      note(`kind ${record.kind} に契約が無い（"${record.text.slice(0, 18)}"）`);
      continue;
    }
    asserted.push({ ...record, sizeRole: sizeRoleOf(record.declaredFontSize) });
    const role = sizeRoleOf(record.declaredFontSize);
    if (!role || !allowed.includes(role))
      note(
        `${record.kind} "${record.text.slice(0, 18)}" は ${record.declaredFontSize}px` +
          `（役割 ${role ?? "不明"}）。許可: ${allowed.map((name) => `${name}=${SIZE_CONTRACT[name]}px`).join(", ")}`,
      );
    // A local transform would make the painted size differ from the declared one.
    if (Math.abs(record.localScale - 1) > 0.001)
      note(`${record.kind} "${record.text.slice(0, 18)}" の localScale が ${record.localScale}`);
    if (Math.abs(record.effectiveFontSize - record.declaredFontSize) > 0.01)
      note(
        `${record.kind} の実効 ${record.effectiveFontSize}px が宣言 ${record.declaredFontSize}px と違う`,
      );
    // Monospace is the one family override the contract allows (textarea code input).
    if (family && !record.font.endsWith(family) && !record.font.endsWith("monospace"))
      note(`${record.kind} の font "${record.font}" がステージの字体 "${family}" ではない`);
  }
  // measureText and fillText must agree: an ellipsis or centring decision taken at one
  // size and painted at another is exactly the defect this milestone is about.
  const painted = new Set(records.map((record) => record.font));
  for (const measurement of capture.canvasSurface.measurements)
    if (!painted.has(measurement.font))
      note(`計測 font "${measurement.font}" ("${measurement.text.slice(0, 18)}") で描画していない`);
  return { asserted, deferred, textFree, shapes: textShapes(records) };
}

// The text shapes the measure/draw agreement has to be shown for. Counted over the real
// draws so the conditions are observed, not assumed: an empty run of one of them means the
// fixtures stopped producing it and the agreement above proves less than it claims.
const TEXT_SHAPES = {
  "align-left": (record) => record.textAlign === "left",
  "align-center": (record) => record.textAlign === "center",
  "align-right": (record) => record.textAlign === "right",
  empty: (record) => record.text === "",
  japanese: (record) => [...record.text].some((ch) => ch.codePointAt(0) > 0xff),
  "long-ascii": (record) => /^[\x20-\x7e]{24,}$/.test(record.text),
  // The ellipsis branch is the width boundary: it measured `${value}…` at the draw font.
  truncated: (record) => record.text.endsWith("…"),
  // Just inside the boundary: a full-width string that was not truncated.
  untruncated: (record) =>
    !record.text.endsWith("…") && record.measuredWidth > 0 && record.text.length >= 12,
  monospace: (record) => record.font.includes("monospace"),
};

function textShapes(records) {
  const counts = {};
  for (const [name, matches] of Object.entries(TEXT_SHAPES))
    counts[name] = records.filter(matches).length;
  return counts;
}

// Flatten the per-surface role measurements into one list of asserted samples.
function roleSamples(capture) {
  const samples = [];
  for (const [surface, measured] of [
    ["dom-stage", capture.dom],
    ["canvas-stage", capture.canvasStage],
  ])
    for (const entry of measured)
      for (const sample of entry.samples)
        samples.push({ surface, role: entry.role, selector: entry.selector, ...sample });
  return samples;
}

function assertRoleCase(capture, problems) {
  const where = `${capture.fixture}/${capture.mode}/host ${capture.hostFontSize}`;
  const note = (message) => problems.push(`${where}: ${message}`);
  if (capture.errors.length) note(`runtime errors: ${capture.errors.join("; ")}`);
  // The DOM half of the text-free claim: a kind recorded as painting no characters must
  // have put none into the document either. The Canvas half is the contract lookup in
  // assertCanvasRoles — a draw attributed to one of these kinds has no allowed role.
  for (const offender of capture.textFreeViolations ?? [])
    note(
      `文字を描かないはずの ${offender.kind} が ${offender.stage} に ` +
        `"${offender.text.slice(0, 18)}" を出している（${offender.selector}）`,
    );
  // The resolver must work on both stages and agree with the contract, or the Canvas
  // side would later read sizes nobody declared.
  for (const [surface, resolved] of Object.entries(capture.resolved)) {
    if (!resolved.ok) {
      note(`${surface} resolver failed: ${resolved.error}`);
      continue;
    }
    for (const [size, expected] of Object.entries(SIZE_CONTRACT))
      if (resolved.sizes[size] !== expected)
        note(`${surface} resolved ${size}=${resolved.sizes[size]}px, contract ${expected}px`);
  }
  // The runtime declares no root font-size, so the stage inherits the host's value;
  // that is what makes the local declarations the only thing holding the sizes.
  if (capture.environment.domStage.stageFontSize !== capture.hostFontSize)
    note(`DOM stage font-size ${capture.environment.domStage.stageFontSize}`);
  if (capture.hostFrame.hostFontSize !== capture.hostFontSize)
    note(`host font-size ${capture.hostFrame.hostFontSize}`);
  const asserted = [];
  for (const sample of roleSamples(capture)) {
    if (!sample.visible) continue;
    const entry = ROLE_CONTRACT.find((candidate) => candidate.role === sample.role);
    asserted.push(sample);
    if (sample.fontSize !== entry.px)
      note(
        `${sample.role} in ${sample.context} is ${sample.fontSize}px, expected ${entry.px}px` +
          ` (${sample.path})`,
      );
    if (entry.weight && sample.fontWeight !== entry.weight)
      note(
        `${sample.role} in ${sample.context} has weight ${sample.fontWeight},` +
          ` expected ${entry.weight} (${sample.path})`,
      );
  }
  if (!asserted.length) note("no visible role samples were measured");
  return asserted;
}

async function runRoles({ context, origin, evidenceDir, viewport, log }) {
  const { page, pageErrors } = await instrument(
    context,
    `${origin}/tests/browser/font-parity.html`,
    viewport,
  );
  const file = resolve(evidenceDir, "roles.json");
  const captures = [];
  const problems = [];
  let rejections = [];
  try {
    rejections = await page.evaluate(async () => {
      const module = await import("/tests/browser/font-parity-harness.js");
      return module.resolverRejections();
    });
    for (const fixture of ROLE_FIXTURES)
      for (const { theme, hostFontSize } of roleCases(fixture)) {
        const { capture, release } = await captureRoles(page, { fixture, theme, hostFontSize });
        const image = resolve(
          evidenceDir,
          `roles-${fixture.name}-${theme.mode}-host${hostFontSize.replace("px", "")}.png`,
        );
        await page.locator("#font-parity-host").screenshot({ path: image });
        await release?.();
        await page.evaluate(() => window.__fontParityHarness?.dispose());
        captures.push({ ...capture, screen: fixture.screen, image });
      }
  } finally {
    await writeFile(
      file,
      `${JSON.stringify({ rejections, gaps: CANVAS_COVERAGE_GAPS, captures, pageErrors }, null, 2)}\n`,
    );
    log(`Roles ledger: ${file}`);
    await page.close();
  }
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join("; ")}`);
  // A resolver that guesses instead of failing would make every later check meaningless.
  for (const rejection of rejections)
    if (!rejection.threw)
      problems.push(`resolver accepted ${rejection.label}: ${rejection.message}`);
  if (rejections.length !== 3) problems.push(`expected 3 resolver rejection probes`);
  const asserted = captures.flatMap((capture) => assertRoleCase(capture, problems));
  const canvas = captures.map((capture) => assertCanvasRoles(capture, problems));
  const canvasAsserted = canvas.flatMap((entry) => entry.asserted);
  const canvasDeferred = canvas.flatMap((entry) => entry.deferred);
  // Nothing may drop out silently: every contracted role and every required parent
  // context has to carry at least one real measurement.
  for (const entry of ROLE_CONTRACT)
    if (!asserted.some((sample) => sample.role === entry.role))
      problems.push(`role ${entry.role} (${entry.selector}) was never measured`);
  for (const parent of REQUIRED_CONTEXTS)
    if (!asserted.some((sample) => sample.context === parent))
      problems.push(`parent context ${parent} was never measured`);
  // The same rule on the Canvas side: a kind listed as required and never painted is a
  // hole in the check, not a pass. Gaps are declared above with the task that closes them.
  for (const kind of REQUIRED_CANVAS_KINDS)
    if (!canvasAsserted.some((record) => record.kind === kind))
      problems.push(`canvas kind ${kind} was never painted`);
  const shapes = {};
  for (const name of Object.keys(TEXT_SHAPES))
    shapes[name] = canvas.reduce((total, entry) => total + (entry.shapes?.[name] ?? 0), 0);
  for (const [name, count] of Object.entries(shapes))
    if (!count) problems.push(`text shape ${name} was never painted`);
  // The page outside the runtime must read the same before and after the fix.
  const bodySizes = [...new Set(captures.map((capture) => capture.hostFrame.bodyFontSize))];
  if (bodySizes.length !== 1) problems.push(`host page font-size moved: ${bodySizes.join(", ")}`);
  // --- the coverage closure (T7) ---------------------------------------------------
  // One bundle per case: what was measured, what was painted, and what was deferred. The
  // state detectors and the xtype trace both read these rather than re-querying the page.
  const bundles = captures.map((capture, index) => ({
    capture,
    samples: roleSamples(capture).filter((sample) => sample.visible),
    canvas: canvas[index].asserted,
    deferred: canvas[index].deferred,
    textFree: canvas[index].textFree,
  }));
  const canvasTextFree = bundles.flatMap((bundle) => bundle.textFree);
  problems.push(...xtypeTableProblems(), ...stateTableProblems());
  const stateCoverage = {};
  for (const entry of STATE_CONTRACT) {
    if (entry.suite !== "roles") {
      stateCoverage[entry.state] = { suite: entry.suite, evidence: entry.evidence };
      continue;
    }
    const matched = bundles.filter((bundle) => entry.detect(bundle));
    stateCoverage[entry.state] = {
      suite: "roles",
      cases: matched.map((bundle) => bundle.capture.fixture),
    };
    if (!matched.length) problems.push(`state ${entry.state} (${entry.why}) was never observed`);
  }
  const screens = new Map();
  for (const fixture of ROLE_FIXTURES)
    if (!screens.has(fixture.screen)) screens.set(fixture.screen, screenCoverage(fixture.screen));
  const xtypeCoverage = {};
  for (const bundle of bundles) {
    const { byTarget, byKind } = renderedXtypes(bundle.capture, screens.get(bundle.capture.screen));
    for (const xtype of new Set([...byTarget, ...byKind])) {
      const row = (xtypeCoverage[xtype] ??= { kinds: XTYPE_KINDS.get(xtype), proof: {} });
      row.proof[bundle.capture.fixture] = byTarget.has(xtype) ? "target" : "kind";
    }
  }
  for (const xtype of XTYPE_KINDS.keys()) {
    if (xtypeCoverage[xtype]) continue;
    if (XTYPE_RENDER_EXEMPT[xtype]) {
      xtypeCoverage[xtype] = { kinds: [], exempt: XTYPE_RENDER_EXEMPT[xtype] };
      continue;
    }
    const trigger = XTYPE_SYNTHESIZED[xtype];
    problems.push(
      `xtype ${xtype} was never rendered by a fixture` +
        (trigger ? `（合成の入口: ${trigger}）` : ""),
    );
  }
  await writeFile(
    resolve(evidenceDir, "roles-coverage.json"),
    `${JSON.stringify(
      {
        kinds: Object.fromEntries(
          [...XTYPE_KINDS.values()].flat().map((kind) => [kind, kindOwner(kind)]),
        ),
        xtypes: xtypeCoverage,
        synthesized: XTYPE_SYNTHESIZED,
        states: stateCoverage,
      },
      null,
      2,
    )}\n`,
  );
  log(
    `${captures.length} cases, ${asserted.length} DOM role samples, ` +
      `${canvasAsserted.length} Canvas draws over ` +
      `${new Set(canvasAsserted.map((record) => record.kind)).size} kinds ` +
      `(${canvasDeferred.length} deferred to the surfaces suite, ` +
      `${canvasTextFree.length} empty draws from text-free kinds), ` +
      `shapes ${Object.entries(shapes)
        .map(([name, count]) => `${name}=${count}`)
        .join(" ")}, ` +
      `contexts ${[...new Set(asserted.map((sample) => sample.context))].sort().join("/")}, ` +
      `${Object.keys(xtypeCoverage).length}/${XTYPE_KINDS.size} xtypes, ` +
      `${STATE_CONTRACT.length} states, host page ${bodySizes.join(",")}`,
  );
  if (problems.length)
    throw new Error(`roles: ${problems.length} problems\n- ${problems.join("\n- ")}`);
  return {
    cases: captures.length,
    samples: asserted.length,
    canvasDraws: canvasAsserted.length,
    file,
  };
}

// --- editing ----------------------------------------------------------------------
// The sizes an edit has to produce. A Grid cell keeps the cell's caption size in the cell,
// in the DOM editor and in the Canvas overlay; every other field keeps the body size. The
// two are measured on the same screen at the same moment, because the defect this closes is
// a size exception reaching the fields it was not meant for.
const EDIT_ROLE_CONTRACT = [
  { role: "field-input", selector: ".ui-field:not(.grid-editor) > input", size: "body" },
  { role: "field-select", selector: ".ui-field:not(.grid-editor) > select", size: "body" },
  { role: "field-textarea", selector: ".ui-field:not(.grid-editor) > textarea", size: "body" },
  { role: "field-box", selector: ".ui-field:not(.grid-editor) .box-control", size: "body" },
  { role: "field-option", selector: ".ui-field:not(.grid-editor) select option", size: "body" },
  { role: "grid-cell", selector: ".ui-grid-cell", size: "caption" },
  { role: "grid-editor-input", selector: ".ui-field.grid-editor > input", size: "caption" },
  { role: "grid-editor-select", selector: ".ui-field.grid-editor > select", size: "caption" },
  { role: "grid-editor-option", selector: ".ui-field.grid-editor select option", size: "caption" },
  { role: "grid-editor-box", selector: ".ui-field.grid-editor .box-control", size: "caption" },
  { role: "overlay", selector: ".canvas-editor:not(.grid-editor)", size: "body" },
  { role: "overlay-option", selector: ".canvas-editor:not(.grid-editor) option", size: "body" },
  { role: "overlay-grid", selector: ".canvas-editor.grid-editor", size: "caption" },
  { role: "overlay-grid-option", selector: ".canvas-editor.grid-editor option", size: "caption" },
].map((entry) => ({ ...entry, px: SIZE_CONTRACT[entry.size] }));

for (const entry of EDIT_ROLE_CONTRACT)
  if (entry.px === undefined) throw new Error(`Edit role ${entry.role} names an unknown size`);

const editRoleSpecs = () =>
  EDIT_ROLE_CONTRACT.map(({ role, selector }) => ({ role, selector, pseudo: null }));

const EDIT_FIXTURE_SCREEN = "/tests/browser/font-parity-edit.json";
const FORMS_SCREEN = "screens/uivolve-forms.json";

// One case per editor the engine lets a Grid column use (textfield / numberfield /
// datefield / combobox / checkbox), on both surfaces. grid-lab carries three of them next
// to an ordinary textfield, and the fixture screen carries the two no application screen
// uses. `requires` is the proof the case actually produced what it was added for.
const EDIT_FIXTURES = [
  {
    name: "grid-lab-textfield",
    screen: "screens/grid-lab.json",
    edit: { surface: "dom", column: "customer" },
    requires: ["grid-cell", "grid-editor-input", "field-input"],
  },
  {
    name: "grid-lab-numberfield",
    screen: "screens/grid-lab.json",
    edit: { surface: "dom", column: "quantity" },
    requires: ["grid-editor-input", "field-input"],
  },
  {
    name: "grid-lab-combobox",
    screen: "screens/grid-lab.json",
    edit: { surface: "dom", column: "status" },
    requires: ["grid-editor-select", "grid-editor-option", "field-input"],
  },
  {
    name: "grid-lab-textfield-canvas",
    screen: "screens/grid-lab.json",
    edit: { surface: "canvas", column: "customer" },
    requires: ["overlay-grid", "grid-cell", "field-input"],
  },
  {
    name: "grid-lab-combobox-canvas",
    screen: "screens/grid-lab.json",
    edit: { surface: "canvas", column: "status" },
    requires: ["overlay-grid", "overlay-grid-option"],
  },
  {
    name: "edit-datefield",
    screen: EDIT_FIXTURE_SCREEN,
    edit: { surface: "dom", column: "joined" },
    requires: ["grid-editor-input", "field-input", "field-textarea", "grid-cell"],
  },
  {
    name: "edit-datefield-canvas",
    screen: EDIT_FIXTURE_SCREEN,
    edit: { surface: "canvas", column: "joined" },
    requires: ["overlay-grid"],
  },
  // A checkbox editor puts its caption in `.box-control`, not in the input, so it needs its
  // own rule and its own measurement.
  {
    name: "edit-checkbox",
    screen: EDIT_FIXTURE_SCREEN,
    edit: { surface: "dom", column: "active" },
    requires: ["grid-editor-box", "field-input"],
  },
  // The Canvas overlay for an ordinary field: one case per editor kind, because openEditor
  // keeps a single overlay at a time. The DOM side of all six is measured in every case.
  ...[
    ["textfield", "personName", []],
    ["numberfield", "quantity", []],
    ["datefield", "due", []],
    ["textarea", "memo", []],
    ["combobox", "department", ["overlay-option"]],
    ["listbox", "languages", ["overlay-option"]],
  ].map(([kind, target, extra]) => ({
    name: `forms-overlay-${kind}`,
    screen: FORMS_SCREEN,
    steps: [{ surface: "canvas", target }],
    requires: [
      "overlay",
      "field-input",
      "field-select",
      "field-textarea",
      "field-box",
      "field-option",
      ...extra,
    ],
  })),
  // Monospace is the one family override the contract allows; the size must stay body.
  {
    name: "text-overlay-monospace",
    screen: "/tests/browser/font-parity-text.json",
    steps: [{ surface: "canvas", target: "codeArea" }],
    requires: ["overlay", "field-textarea"],
  },
  // The dialog prompt is an ordinary 13px field with a 22px label strip, inside a window.
  {
    name: "dialogs-prompt",
    screen: "screens/dialogs.yaml",
    steps: [{ surface: "dom", selector: '.ui-button[data-target="showPrompt"]' }],
    requires: ["field-input"],
    dialogPrompt: true,
  },
];

async function captureEditing(page, fixture) {
  await page.evaluate(
    async (input) => {
      const module = await import("/tests/browser/font-parity-harness.js");
      const harness = await module.createFontParityHarness({ screen: input.screen });
      window.__fontParityHarness = harness;
      try {
        await harness.settle();
        for (const step of input.steps ?? [])
          if (step.surface === "dom") await harness.clickDom(step.selector);
          else await harness.clickCanvas(step.target);
        if (input.edit) await harness.editCell(input.edit);
      } catch (error) {
        document.getElementById("font-parity-error").textContent = error.stack ?? String(error);
        throw error;
      }
    },
    { screen: fixture.screen, steps: fixture.steps, edit: fixture.edit },
  );
  const observed = await page.evaluate(
    (contract) => ({
      ...window.__fontParityHarness.roles(contract),
      snapshot: window.__fontParityHarness.editSnapshot(),
    }),
    editRoleSpecs(),
  );
  return {
    fixture: fixture.name,
    mode: "light",
    hostFontSize: "16px",
    requires: fixture.requires,
    dialogPrompt: Boolean(fixture.dialogPrompt),
    ...observed,
  };
}

// The engine marks the three label strips apart: 0 for a Grid editor and for a box with no
// field label, 22 for the dialog prompt, 24 for every other field.
function expectedLabelHeight(field) {
  if (field.gridEditor) return 0;
  if (field.dialog) return 22;
  if (["checkbox", "radio"].includes(field.kind) && !field.text) return 0;
  return 24;
}

function assertEditCase(capture, problems) {
  const note = (message) => problems.push(`${capture.fixture}: ${message}`);
  if (capture.errors.length) note(`runtime errors: ${capture.errors.join("; ")}`);
  const asserted = [];
  for (const sample of roleSamples(capture)) {
    const entry = EDIT_ROLE_CONTRACT.find((candidate) => candidate.role === sample.role);
    if (!entry) continue;
    asserted.push(sample);
    // An option in a closed combobox has no box, but it still carries the size the popup
    // list paints, so the size is asserted on every sample and visibility only recorded.
    if (sample.fontSize !== entry.px)
      note(`${sample.role} is ${sample.fontSize}px, expected ${entry.px}px (${sample.path})`);
  }
  for (const role of capture.requires)
    if (!asserted.some((sample) => sample.role === role)) note(`role ${role} was never measured`);
  // The same contract read off the live controls instead of off a selector: whatever markup
  // the host chose, a Grid editor is 12px and nothing else is.
  for (const editor of capture.snapshot.editors) {
    const expected = editor.gridEditor ? SIZE_CONTRACT.caption : SIZE_CONTRACT.body;
    if (editor.fontSize !== expected)
      note(
        `editor ${editor.id} (gridEditor=${editor.gridEditor}) is ${editor.fontSize}px,` +
          ` expected ${expected}px`,
      );
  }
  for (const field of capture.snapshot.fields) {
    const expected = expectedLabelHeight(field);
    if (field.labelHeight !== expected)
      note(`${field.kind} ${field.key} labelHeight ${field.labelHeight}, expected ${expected}`);
  }
  if (capture.dialogPrompt) {
    const prompt = capture.snapshot.fields.find((field) => field.dialog);
    if (!prompt) note("dialog prompt の field が Scene に現れなかった");
  }
  return asserted;
}

// --- editing operations -----------------------------------------------------------
// Real operations, not dispatches: focus, begin, type, confirm, re-edit, cancel, and the
// Rhai refusal. Each step records the engine's revision and the bound state so a size that
// only looks right in a still frame cannot pass.
const FIELD_OPERATIONS = [
  {
    name: "hello-world-dom",
    screen: "screens/hello-world.json",
    surface: "dom",
    target: "nameInput",
    paths: ["name"],
  },
  {
    name: "hello-world-canvas",
    screen: "screens/hello-world.json",
    surface: "canvas",
    target: "nameInput",
    paths: ["name"],
  },
  {
    name: "forms-canvas-textarea",
    screen: FORMS_SCREEN,
    surface: "canvas",
    target: "memo",
    paths: ["memo"],
    kind: "textarea",
  },
  {
    name: "orders-dom",
    screen: "screens/orders.json",
    surface: "dom",
    target: "customer",
    paths: ["draftCustomer"],
  },
  {
    name: "orders-canvas",
    screen: "screens/orders.json",
    surface: "canvas",
    target: "customer",
    paths: ["draftCustomer"],
  },
];

const GRID_OPERATIONS = [
  { name: "grid-lab-dom", surface: "dom" },
  { name: "grid-lab-canvas", surface: "canvas" },
];

const TYPED_TEXT = "日本語の入力";

// Only the Canvas stage's controls are overlays; the DOM stage's inputs are always there.
const overlays = (snapshot) => snapshot.editors.filter((editor) => editor.surface === "canvas");

async function openHarness(page, screen) {
  await page.evaluate(
    async (input) => {
      const module = await import("/tests/browser/font-parity-harness.js");
      const harness = await module.createFontParityHarness({ screen: input.screen });
      window.__fontParityHarness = harness;
      try {
        await harness.settle();
      } catch (error) {
        document.getElementById("font-parity-error").textContent = error.stack ?? String(error);
        throw error;
      }
    },
    { screen },
  );
}

const snapshotOf = (page, paths) =>
  page.evaluate((input) => window.__fontParityHarness.editSnapshot(input), paths);

// Type over whatever the control holds, with real key events, so the engine sees the same
// input stream a user produces.
async function retype(page, text) {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text, { delay: 10 });
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
}

async function runFieldOperation(page, operation, problems) {
  const note = (message) => problems.push(`${operation.name}: ${message}`);
  const steps = [];
  const record = async (label) => {
    const snapshot = await snapshotOf(page, operation.paths);
    steps.push({ label, ...snapshot });
    return snapshot;
  };
  await openHarness(page, operation.screen);
  const start = await record("loaded");
  await page.evaluate((input) => window.__fontParityHarness.focusField(input), {
    surface: operation.surface,
    target: operation.target,
  });
  const focused = await record("focused");
  if (!focused.active.present) note("focus が入力欄へ入らなかった");
  // The Canvas overlay only exists while the field is being edited; the DOM control is
  // always there. Either way the focused control is the one that takes the typing.
  if (operation.surface === "canvas" && !focused.active.classes.includes("canvas-editor"))
    note(`Canvas の編集オーバーレイが開かなかった（${focused.active.classes.join(".")}）`);
  if (focused.active.fontSize !== SIZE_CONTRACT.body)
    note(`編集中の入力欄が ${focused.active.fontSize}px（通常 field は ${SIZE_CONTRACT.body}px）`);
  await retype(page, TYPED_TEXT);
  const typed = await record("typed");
  if (typed.state[operation.paths[0]] !== TYPED_TEXT)
    note(`入力後の state が ${JSON.stringify(typed.state[operation.paths[0]])}`);
  if (!(typed.revision > start.revision)) note("入力で revision が増えていない");
  // Enter confirms. A textarea takes the newline instead, which is the host's own rule.
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const confirmed = await record("enter");
  if (confirmed.state[operation.paths[0]].replace(/\n$/u, "") !== TYPED_TEXT)
    note(`Enter 後の state が ${JSON.stringify(confirmed.state[operation.paths[0]])}`);
  if (operation.surface === "canvas" && operation.kind !== "textarea" && overlays(confirmed).length)
    note("Enter で Canvas のオーバーレイが閉じていない");
  // Re-edit, then Escape. For an ordinary field Escape closes the overlay; it does not undo
  // the value, because the value was already committed on input. That is existing behaviour.
  await page.evaluate((input) => window.__fontParityHarness.focusField(input), {
    surface: operation.surface,
    target: operation.target,
  });
  const reopened = await record("re-focused");
  if (operation.surface === "canvas" && !overlays(reopened).length)
    note("再編集でオーバーレイが開かなかった");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const cancelled = await record("escape");
  if (operation.surface === "canvas" && overlays(cancelled).length)
    note("Escape で Canvas のオーバーレイが閉じていない");
  if (cancelled.state[operation.paths[0]] !== confirmed.state[operation.paths[0]])
    note("Escape が確定済みの値を変えた");
  await page.evaluate(() => window.__fontParityHarness.dispose());
  return { operation: operation.name, surface: operation.surface, steps };
}

const GRID_PATHS = ["cellEdit", "records.1.customer", "records.1.quantity", "edited"];

async function runGridOperation(page, operation, problems) {
  const note = (message) => problems.push(`${operation.name}: ${message}`);
  const steps = [];
  const record = async (label) => {
    const snapshot = await snapshotOf(page, GRID_PATHS);
    steps.push({ label, ...snapshot });
    return snapshot;
  };
  const edit = (column) =>
    page.evaluate((input) => window.__fontParityHarness.editCell(input), {
      surface: operation.surface,
      column,
      index: 1,
    });
  await openHarness(page, "screens/grid-lab.json");
  const start = await record("loaded");
  await edit("customer");
  const opened = await record("begin-edit");
  if (!opened.active.present) note("編集開始で入力欄へ focus が移らなかった");
  if (opened.active.fontSize !== SIZE_CONTRACT.caption)
    note(`Grid 編集中の入力欄が ${opened.active.fontSize}px（セルは ${SIZE_CONTRACT.caption}px）`);
  if (!opened.state.cellEdit) note("編集開始で cellEdit が立たなかった");
  await retype(page, TYPED_TEXT);
  const drafted = await record("draft");
  if (drafted.state.cellEdit?.value !== TYPED_TEXT)
    note(`下書きが ${JSON.stringify(drafted.state.cellEdit?.value)}`);
  if (drafted.state["records.1.customer"] === TYPED_TEXT) note("確定前に行が書き換わっている");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const committed = await record("commit");
  if (committed.state["records.1.customer"] !== TYPED_TEXT)
    note(`Enter 確定後の行が ${JSON.stringify(committed.state["records.1.customer"])}`);
  if (committed.state.cellEdit !== null) note("確定後も cellEdit が残っている");
  if (!(committed.revision > drafted.revision)) note("確定で revision が増えていない");
  // Re-edit the same cell and cancel: the committed value must come back.
  await edit("customer");
  await retype(page, "取り消される値");
  const second = await record("re-edit");
  if (second.state["records.1.customer"] !== TYPED_TEXT) note("再編集中に行が書き換わっている");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const cancelled = await record("cancel");
  if (cancelled.state.cellEdit !== null) note("Escape 後も cellEdit が残っている");
  if (cancelled.state["records.1.customer"] !== TYPED_TEXT)
    note(`Escape 後の行が ${JSON.stringify(cancelled.state["records.1.customer"])}`);
  // The Rhai handler refuses a quantity over 500. The editor has to stay open with the
  // draft intact, and the row must not move.
  await edit("quantity");
  await retype(page, "600");
  const refusedDraft = await record("reject-draft");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const refused = await record("reject");
  if (refused.state["records.1.quantity"] !== start.state["records.1.quantity"])
    note(`拒否されたのに行が ${JSON.stringify(refused.state["records.1.quantity"])}`);
  if (refused.state.cellEdit === null) note("拒否で編集が閉じてしまった");
  if (String(refused.state.cellEdit?.value) !== "600")
    note(`拒否後の下書きが ${JSON.stringify(refused.state.cellEdit?.value)}`);
  if (refused.active.fontSize !== SIZE_CONTRACT.caption)
    note(`拒否後の入力欄が ${refused.active.fontSize}px`);
  if (String(refusedDraft.state.cellEdit?.value) !== "600") note("拒否前の下書きが残っていない");
  // The refusal has to reach the host as an error; a silently dropped commit would leave
  // the same state behind and pass every check above.
  if (refused.errors.length <= refusedDraft.errors.length)
    note(`拒否が報告されなかった（errors: ${JSON.stringify(refused.errors)}）`);
  else if (!refused.errors.at(-1).includes("500"))
    note(`拒否の報告が想定外の内容（${refused.errors.at(-1)}）`);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const closed = await record("close");
  if (closed.state.cellEdit !== null) note("最後の Escape で編集が閉じていない");
  await page.evaluate(() => window.__fontParityHarness.dispose());
  return { operation: operation.name, surface: operation.surface, steps };
}

// --- composition ------------------------------------------------------------------
// What a repaint during an unfinished conversion must not break. The events are the real
// ones in the real order, but they are dispatched from the page: a real IME cannot be
// driven here, so the two are kept apart in the ledger and in this constant.
const COMPOSITION = {
  text: "にほんご",
  method: "compositionstart → input(isComposing) → compositionend をページ内で dispatch する",
  realIme: false,
  realImeReason:
    "無人の headless Chromium では OS の IME を操作できない。実 IME での変換は手動確認の項目として" +
    "台帳に残し、ここでの結果を実 IME の確認として読み替えない",
};

const COMPOSITION_CASES = [
  { name: "composition-dom", surface: "dom" },
  { name: "composition-canvas", surface: "canvas" },
];

async function runCompositionCase(page, { name, surface }, problems) {
  const note = (message) => problems.push(`${name}: ${message}`);
  await openHarness(page, "screens/hello-world.json");
  const paths = ["name"];
  const before = await snapshotOf(page, paths);
  await page.evaluate((input) => window.__fontParityHarness.focusField(input), {
    surface,
    target: "nameInput",
  });
  await page.evaluate(() => window.__fontParityHarness.markActive());
  const composing = await page.evaluate(
    (text) => window.__fontParityHarness.startComposition(text),
    COMPOSITION.text,
  );
  if (!composing.same) note("変換開始の時点で入力欄が作り直されている");
  const steps = [{ label: "composing", active: composing }];
  // A repaint, a theme change and a resize, each while the conversion is unfinished.
  for (const [label, action] of [
    ["render", () => page.evaluate(() => window.__fontParityHarness.rerender())],
    [
      "theme",
      () => page.evaluate(() => window.__fontParityHarness.applyThemeUrl("/themes/dark.json")),
    ],
    ["resize", () => page.evaluate(() => window.__fontParityHarness.resizeHostTo("62%"))],
  ]) {
    await action();
    const snapshot = await snapshotOf(page, paths);
    steps.push({ label, ...snapshot });
    const active = snapshot.active;
    if (!active.same) note(`${label} で入力欄が別の要素に置き換わった`);
    if (!active.inside || !active.connected) note(`${label} で focus がステージの外へ出た`);
    if (active.value !== COMPOSITION.text) note(`${label} で未確定の値が ${active.value}`);
    if (active.selectionStart !== composing.selectionStart)
      note(`${label} で selection が ${active.selectionStart}/${active.selectionEnd}`);
    // The engine must not see the unfinished conversion.
    if (snapshot.state.name !== before.state.name)
      note(`${label} で未確定の値が state へ入った（${JSON.stringify(snapshot.state.name)}）`);
  }
  await page.evaluate(() => window.__fontParityHarness.endComposition());
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const committed = await snapshotOf(page, paths);
  steps.push({ label: "compositionend", ...committed });
  if (committed.state.name !== COMPOSITION.text)
    note(`変換確定後の state が ${JSON.stringify(committed.state.name)}`);
  if (!committed.active.same) note("変換確定で入力欄が作り直された");
  await page.evaluate(() => window.__fontParityHarness.dispose());
  return { case: name, surface, steps };
}

async function runEditing({ context, origin, evidenceDir, viewport, log }) {
  const { page, pageErrors } = await instrument(
    context,
    `${origin}/tests/browser/font-parity.html`,
    viewport,
  );
  const file = resolve(evidenceDir, "editing.json");
  const captures = [];
  const operations = [];
  const compositions = [];
  const problems = [];
  try {
    for (const fixture of EDIT_FIXTURES) {
      const capture = await captureEditing(page, fixture);
      const image = resolve(evidenceDir, `editing-${fixture.name}.png`);
      await page.locator("#font-parity-host").screenshot({ path: image });
      await page.evaluate(() => window.__fontParityHarness?.dispose());
      captures.push({ ...capture, image });
    }
    for (const operation of FIELD_OPERATIONS)
      operations.push(await runFieldOperation(page, operation, problems));
    for (const operation of GRID_OPERATIONS)
      operations.push(await runGridOperation(page, operation, problems));
    for (const probe of COMPOSITION_CASES)
      compositions.push(await runCompositionCase(page, probe, problems));
  } finally {
    await writeFile(
      file,
      `${JSON.stringify(
        { composition: COMPOSITION, captures, operations, compositions, pageErrors },
        null,
        2,
      )}\n`,
    );
    log(`Editing ledger: ${file}`);
    await page.close();
  }
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join("; ")}`);
  const asserted = captures.flatMap((capture) => assertEditCase(capture, problems));
  const canvas = captures.map((capture) => assertCanvasRoles(capture, problems));
  const canvasAsserted = canvas.flatMap((entry) => entry.asserted);
  // Every role in the edit contract has to be measured somewhere, and the Canvas side has
  // to have painted a Grid editor at the cell size: a check nothing reached is not a pass.
  for (const entry of EDIT_ROLE_CONTRACT)
    if (!asserted.some((sample) => sample.role === entry.role))
      problems.push(`edit role ${entry.role} (${entry.selector}) was never measured`);
  const gridDraws = canvasAsserted.filter((record) => record.gridEditor);
  if (!gridDraws.length) problems.push("Canvas で Grid 編集中の描画が 1 件も採れなかった");
  for (const record of gridDraws)
    if (record.declaredFontSize !== SIZE_CONTRACT.caption)
      problems.push(
        `canvas grid editor "${record.text.slice(0, 18)}" は ${record.declaredFontSize}px`,
      );
  // The three label strips and both font families have to appear, or the kinds the task
  // names were never actually on screen.
  const strips = new Set(
    captures.flatMap((capture) => capture.snapshot.fields.map((field) => field.labelHeight)),
  );
  for (const height of [0, 22, 24])
    if (!strips.has(height)) problems.push(`labelHeight ${height} の field を実測していない`);
  const families = asserted.map((sample) => sample.fontFamily ?? "");
  if (!families.some((family) => /monospace/u.test(family)))
    problems.push("等幅の入力欄を実測していない");
  if (!families.some((family) => !/monospace/u.test(family)))
    problems.push("等幅でない入力欄を実測していない");
  if (!asserted.some((sample) => sample.placeholder))
    problems.push("placeholder を持つ入力欄を実測していない");
  const kinds = new Set(
    captures.flatMap((capture) =>
      capture.snapshot.fields.filter((field) => field.gridEditor).map((field) => field.kind),
    ),
  );
  for (const kind of ["textfield", "numberfield", "datefield", "combobox", "checkbox"])
    if (!kinds.has(kind)) problems.push(`Grid 編集の ${kind} を実測していない`);
  log(
    `${captures.length} cases, ${asserted.length} DOM samples, ` +
      `${canvasAsserted.length} Canvas draws (${gridDraws.length} grid editor), ` +
      `grid editor kinds ${[...kinds].sort().join("/")}, ` +
      `labelHeight ${[...strips].sort((a, b) => a - b).join("/")}, ` +
      `${operations.length} operation scripts, ${compositions.length} composition probes ` +
      `(real IME: ${COMPOSITION.realIme})`,
  );
  if (problems.length)
    throw new Error(`editing: ${problems.length} problems\n- ${problems.join("\n- ")}`);
  return { cases: captures.length, samples: asserted.length, operations: operations.length, file };
}

// --- surfaces ---------------------------------------------------------------------
// The shared sprites (figure / document), the dialog icon and the media notice. One
// sprite list feeds both renderers, so what could differ is never the list: it is the
// rectangle the list is fitted into, the family the Canvas text asks for, and the
// maxWidth the icon is condensed to. All three are compared here against the DOM.
//
// The DOM SVG is `width/height: 100%` inside the frame declared in src/runtime.css, so
// its viewport is the element's content box. Canvas has no element and insets by the same
// resolved border; every assertion below is on the *live* CTM and the *live* Canvas
// transform, never on a recomputed scale.

const SURFACE_FIXTURE_SCREEN = "/tests/browser/font-parity-surface.json";

// The document sizes from DECISIONS. Each painted sprite is checked against what the
// engine's own line flags say it must be, so this is the rule and not a copy of the output.
const DOCUMENT_SIZES = { title: 14, heading: 16, body: 12 };

// Both widths the task names. The sprites are scaled to fit, so a narrow viewport is a
// different scale factor on exactly the same sprite list.
const SURFACE_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "narrow", width: 390, height: 844 },
];

// What is out of scope, with the reason, so an exemption is in the ledger rather than in
// nobody's head.
const SURFACE_EXCLUSIONS = {
  "iframe-content":
    "iframe の中身は別文書（sandbox 済み）で、runtime の CSS もフォント解決も届かない。" +
    "枠と空/エラー案内だけを対象にする",
  "image-pixels":
    "画像の中に描かれている文字はビットマップの一部で font-size を持たない。両面とも同じ" +
    "画像を同じ内容矩形へ収めるため、サイズの比較対象にならない",
  "svg-icon-paths":
    "標準ダイアログアイコンは文字ではなく path（src/dialog-icons.js の 24 単位 viewBox）。" +
    "文字サイズを持たないので、文字アイコンだけを 30px の対象にする",
  "media-notice-text":
    "Canvas はビットマップへ widget の題名を描き、DOM は ::after の固定文「メディアを" +
    "読み込めません」を出す。文言の違いは既存の表現差で、今回揃えるのはサイズだけ",
  "text-icon-wrapping":
    "32px の枠に収まらない文字アイコンは、DOM では匿名 flex item として折り返され" +
    "（`.ui-dialog-icon` は inline-flex・overflow hidden）、Canvas では 1 行のまま横に" +
    "切られる。行分割の違いは既存の表現差で、サイズ（30px）と縮小しないことだけを揃える",
};

const SURFACE_FIXTURES = [
  {
    name: "fixture",
    screen: SURFACE_FIXTURE_SCREEN,
    steps: [],
    media: true,
    requires: ["document", "figure", "image", "video", "iframe"],
  },
  // A character icon far wider than its 32px box: the DOM clips it, so Canvas must clip
  // too instead of condensing the glyphs to the box width.
  {
    name: "fixture-wide-icon",
    screen: SURFACE_FIXTURE_SCREEN,
    steps: [{ surface: "dom", selector: '.ui-button[data-target="wideTextIcon"]' }],
    media: true,
    requires: ["dialog-icon"],
    textIcon: "clipped",
  },
  {
    name: "fixture-emoji-icon",
    screen: SURFACE_FIXTURE_SCREEN,
    steps: [{ surface: "dom", selector: '.ui-button[data-target="emojiIcon"]' }],
    media: true,
    requires: ["dialog-icon"],
    textIcon: "any",
  },
  // The application screens: markdown / diff / box documents, every figure kind, the chat
  // and terminal documents, and the media tab with real sources.
  {
    name: "gallery-documents",
    screen: GALLERY_SCREEN,
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(2)" }],
    requires: ["document"],
  },
  {
    name: "gallery-charts",
    screen: GALLERY_SCREEN,
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(3)" }],
    requires: ["figure"],
  },
  {
    name: "gallery-graphs",
    screen: GALLERY_SCREEN,
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(4)" }],
    requires: ["figure"],
  },
  {
    name: "gallery-chat",
    screen: GALLERY_SCREEN,
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(5)" }],
    requires: ["document"],
  },
  {
    name: "gallery-media",
    screen: GALLERY_SCREEN,
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(6)" }],
    media: true,
    requires: ["image", "video", "iframe"],
  },
  // The built-in SVG icon, recorded as the out-of-scope case it is: it must paint no text.
  {
    name: "dialogs-svg-icon",
    screen: "screens/dialogs.yaml",
    steps: [{ surface: "dom", selector: '.ui-button[data-target="showAlert"]' }],
    requires: ["dialog-icon"],
    textIcon: "none",
  },
];

// The conditions the surface text has to be measured under. Counted over the real sprites
// so an empty run means the fixtures stopped producing one, not that it passed.
const SURFACE_SHAPES = {
  japanese: (sprite) => /[぀-ヿ一-鿿]/u.test(sprite.text),
  ascii: (sprite) => /[A-Za-z0-9]/u.test(sprite.text),
  emoji: (sprite) => /\p{Extended_Pictographic}/u.test(sprite.text),
  empty: (sprite) => sprite.text === "",
  long: (sprite) => sprite.text.length >= 24,
  monospace: (sprite) => /monospace/u.test(sprite.fontFamily),
  "size-title": (sprite) => sprite.declaredFontSize === DOCUMENT_SIZES.title,
  "size-heading": (sprite) => sprite.declaredFontSize === DOCUMENT_SIZES.heading,
  "size-body": (sprite) => sprite.declaredFontSize === DOCUMENT_SIZES.body,
  "anchor-middle": (sprite) => sprite.textAnchor === "middle",
  "anchor-end": (sprite) => sprite.textAnchor === "end",
  // A sprite whose ink leaves the content box: the fit must not shrink the text to make
  // it fit, on either surface.
  overflowing: (sprite) => sprite.inkWidth > 0 && sprite.x + sprite.inkWidth > sprite.frameWidth,
};

// The size a painted sprite has to declare, taken from the engine's own data. A figure
// carries the completed fontSize on each sprite; a document carries the heading/code flags
// the shared builder turns into the title/heading/body sizes. Matching a document sprite by
// content instead of by index avoids restating the shared wrapping rule here, and an
// ambiguous chunk is reported rather than passed.
function expectedSpriteSize(widget, sprite, index) {
  if (widget.kind === "figure") {
    const texts = (widget.sprites ?? []).filter(
      (entry) => entry.type === "text" && entry.fillStyle !== "none",
    );
    const entry = texts[index];
    if (!entry) return { size: null, reason: "Scene の sprite 一覧に対応する text が無い" };
    if (typeof entry.fontSize !== "number")
      return { size: null, reason: "WASM が sprite の fontSize を補完していない" };
    return { size: entry.fontSize, monospace: Boolean(entry.monospace) };
  }
  if (index === 0 && widget.text && sprite.text === widget.text)
    return { size: DOCUMENT_SIZES.title, monospace: false };
  const matches = (widget.lines ?? []).filter((line) => {
    const text = line.text ?? "";
    return sprite.text === "" ? text === "" : text.includes(sprite.text);
  });
  if (!matches.length) return { size: null, reason: "どの行にも含まれない文字" };
  const sizes = new Set(
    matches.map((line) => (line.heading ? DOCUMENT_SIZES.heading : DOCUMENT_SIZES.body)),
  );
  if (sizes.size !== 1) return { size: null, reason: "見出しと本文の両方に一致する文字" };
  const monos = new Set(matches.map((line) => Boolean(line.code)));
  return { size: [...sizes][0], monospace: monos.size === 1 ? [...monos][0] : null };
}

const ANCHOR_TO_ALIGN = { start: "left", middle: "center", end: "right" };

// One figure or document: the DOM sprites it mounted against the Canvas draws it painted.
function assertSurfaceWidget({ frame, widget, domSprites, canvasSprites, resolved, note }) {
  if (domSprites.length !== canvasSprites.length) {
    note(
      `${frame.kind} ${frame.key} の描画数が DOM ${domSprites.length} 対 ` +
        `Canvas ${canvasSprites.length}`,
    );
    return [];
  }
  if (!domSprites.length) return [];
  const asserted = [];
  domSprites.forEach((dom, index) => {
    const canvas = canvasSprites[index];
    const label = `${frame.kind} ${frame.key}#${index} "${dom.text.slice(0, 14)}"`;
    const relativeX = canvas.x - widget.x;
    const relativeY = canvas.y - widget.y;
    asserted.push({ ...dom, frameWidth: frame.viewportWidth, canvas: { ...canvas } });
    if (dom.text !== canvas.text) note(`${label}: Canvas の文字が "${canvas.text.slice(0, 14)}"`);
    if (dom.declaredFontSize !== canvas.declaredFontSize)
      note(`${label}: 宣言サイズ DOM ${dom.declaredFontSize} 対 Canvas ${canvas.declaredFontSize}`);
    // The content rectangle, read as the scale each surface actually applied.
    if (Math.abs(dom.scale - canvas.localScale) > 0.001)
      note(`${label}: 倍率 DOM ${dom.scale} 対 Canvas ${canvas.localScale}`);
    if (Math.abs(dom.effectiveFontSize - canvas.effectiveFontSize) > 0.01)
      note(`${label}: 実効 DOM ${dom.effectiveFontSize}px 対 Canvas ${canvas.effectiveFontSize}px`);
    if (Math.abs(dom.x - relativeX) > 0.5 || Math.abs(dom.y - relativeY) > 0.5)
      note(
        `${label}: 位置 DOM (${dom.x.toFixed(2)},${dom.y.toFixed(2)}) 対 ` +
          `Canvas (${relativeX.toFixed(2)},${relativeY.toFixed(2)})`,
      );
    if (String(dom.fontWeight) !== String(canvas.fontWeight))
      note(`${label}: 太さ DOM ${dom.fontWeight} 対 Canvas ${canvas.fontWeight}`);
    if (ANCHOR_TO_ALIGN[dom.textAnchor] !== canvas.textAlign)
      note(`${label}: 寄せ DOM ${dom.textAnchor} 対 Canvas ${canvas.textAlign}`);
    // Monospace is the one family override the sprites allow; everything else has to use
    // the family the stage resolved, on both surfaces.
    const domMono = /monospace/u.test(dom.fontFamily);
    const canvasMono = canvas.font.includes("monospace");
    if (domMono !== canvasMono) note(`${label}: 等幅 DOM ${domMono} 対 Canvas ${canvasMono}`);
    if (!domMono) {
      if (dom.fontFamily !== resolved.family)
        note(`${label}: DOM の字体 "${dom.fontFamily}" がステージの "${resolved.family}" ではない`);
      if (!canvas.font.endsWith(resolved.family))
        note(`${label}: Canvas の font "${canvas.font}" がステージの字体ではない`);
    }
    const expected = expectedSpriteSize(widget, dom, index);
    if (expected.size === null) note(`${label}: ${expected.reason}`);
    else if (dom.declaredFontSize !== expected.size)
      note(`${label}: ${dom.declaredFontSize}px だが ${expected.size}px のはず`);
    if (
      expected.monospace !== null &&
      expected.monospace !== undefined &&
      expected.monospace !== domMono
    )
      note(`${label}: 等幅の指定が ${expected.monospace} なのに DOM は ${domMono}`);
  });
  return asserted;
}

function assertSurfaceCase(capture, problems) {
  const where = `${capture.fixture}/${capture.viewport}`;
  const note = (message) => problems.push(`${where}: ${message}`);
  const result = { kinds: new Set(), sprites: [], notices: 0, icons: 0, multiline: 0 };
  if (capture.errors.length) note(`runtime errors: ${capture.errors.join("; ")}`);
  if (!capture.scene) {
    note("Scene が取得できなかった");
    return result;
  }
  const resolved = capture.resolved.canvas;
  if (!resolved.ok) {
    note(`canvas resolver failed: ${resolved.error}`);
    return result;
  }
  if (capture.canvasStage.sprites.length)
    note(`Canvas 面に SVG sprite が ${capture.canvasStage.sprites.length} 件ある`);
  if (capture.icons.canvas.length)
    note(`Canvas 面に HTML のダイアログアイコンが ${capture.icons.canvas.length} 件ある`);
  const widgets = new Map(capture.scene.widgets.map((widget) => [widget.key, widget]));
  const draws = capture.canvasSurface
    ? canvasRecords(capture.canvasSurface, capture.scene.widgets, capture.fixture)
    : [];
  // --- figure / document -----------------------------------------------------------
  for (const frame of capture.dom.frames) {
    const widget = widgets.get(frame.key);
    if (!widget) {
      note(`DOM の ${frame.kind} ${frame.key} が Scene に無い`);
      continue;
    }
    result.kinds.add(frame.kind);
    // The frame the Canvas side insets by has to be the one the browser applied.
    if (Math.abs(frame.borderWidth - resolved.surfaceBorder) > 0.01)
      note(
        `${frame.kind} ${frame.key} の border ${frame.borderWidth}px が ` +
          `解決値 ${resolved.surfaceBorder}px と違う`,
      );
    // The SVG viewport is the content box: that is the rectangle both surfaces fit into.
    for (const [axis, viewport, box] of [
      ["幅", frame.viewportWidth, frame.width],
      ["高さ", frame.viewportHeight, frame.height],
    ])
      if (Math.abs(viewport - (box - frame.borderWidth * 2)) > 0.5)
        note(
          `${frame.kind} ${frame.key} の SVG viewport ${axis} ${viewport} が ` +
            `内容矩形 ${box - frame.borderWidth * 2} と違う`,
        );
    const domSprites = capture.dom.sprites.filter(
      (sprite) => sprite.key === frame.key && sprite.painted,
    );
    const canvasSprites = draws.filter((record) => record.key === frame.key);
    if (domSprites.length >= 2) result.multiline++;
    result.sprites.push(
      ...assertSurfaceWidget({
        frame,
        widget,
        domSprites,
        canvasSprites,
        resolved,
        note,
      }),
    );
  }
  // A sprite the DOM never mounted but Canvas painted (or the reverse) is caught above
  // per widget; a draw attributed to no widget at all is caught here.
  for (const record of draws)
    if (!record.key)
      note(`"${record.text.slice(0, 18)}" (${record.x},${record.y}) を部品に対応付けられない`);
  // --- media ------------------------------------------------------------------------
  for (const widget of capture.scene.widgets) {
    if (!["image", "video", "iframe"].includes(widget.kind)) continue;
    result.kinds.add(widget.kind);
    const domNotice = capture.media.dom.find((entry) => entry.key === widget.key);
    if (!domNotice) {
      note(`DOM に ${widget.kind} ${widget.key} のメディア枠が無い`);
      continue;
    }
    result.notices++;
    if (domNotice.shown && domNotice.fontSize !== SIZE_CONTRACT.caption)
      note(
        `${widget.kind} の DOM 案内が ${domNotice.fontSize}px` +
          `（${SIZE_CONTRACT.caption}px のはず）`,
      );
    // The Canvas surface keeps a native element for video and iframe; the image kind has
    // none, and its notice is painted onto the bitmap instead.
    // The Canvas overlays carry no widget key, so they are matched on the position the
    // renderer wrote into their style — which survives being hidden behind a modal.
    const native = capture.media.canvas.find(
      (entry) =>
        Math.abs(entry.styleLeft - widget.x) < 1.5 && Math.abs(entry.styleTop - widget.y) < 1.5,
    );
    if (widget.kind === "image") {
      if (native) note(`Canvas 面に image の native 要素がある`);
    } else if (!native) note(`Canvas 面に ${widget.kind} の native 要素が無い`);
    else {
      result.notices++;
      if (native.shown && native.fontSize !== SIZE_CONTRACT.caption)
        note(`${widget.kind} の native overlay が ${native.fontSize}px`);
      if (native.mediaKind !== widget.kind) note(`native overlay の kind が ${native.mediaKind}`);
    }
    const painted = draws.filter((record) => record.key === widget.key);
    if (!widget.src || domNotice.error) {
      if (!painted.length) note(`Canvas が ${widget.kind} ${widget.key} の案内を描いていない`);
      for (const record of painted) {
        if (record.declaredFontSize !== SIZE_CONTRACT.caption)
          note(`${widget.kind} の Canvas 案内が ${record.declaredFontSize}px`);
        if (Math.abs(record.localScale - 1) > 0.001)
          note(`${widget.kind} の Canvas 案内の localScale が ${record.localScale}`);
        if (!record.font.endsWith(resolved.family))
          note(`${widget.kind} の Canvas 案内の font "${record.font}" が字体と違う`);
      }
    } else if (painted.length)
      note(`src があるのに ${widget.kind} が ${painted.length} 件の文字を描いている`);
  }
  // --- dialog icon ------------------------------------------------------------------
  for (const widget of capture.scene.widgets) {
    if (widget.kind !== "dialog-icon") continue;
    result.kinds.add("dialog-icon");
    const domIcon = capture.icons.dom.find((entry) => entry.key === widget.key);
    if (!domIcon) {
      note(`DOM に dialog-icon ${widget.key} が無い`);
      continue;
    }
    result.icons++;
    const painted = draws.filter((record) => record.key === widget.key);
    if (domIcon.icon !== "text") {
      // Out of scope by SURFACE_EXCLUSIONS["svg-icon-paths"] / ["image-pixels"]: an icon
      // that is not a character must paint no character either.
      if (painted.length) note(`${domIcon.icon} アイコンが ${painted.length} 件の文字を描いている`);
      continue;
    }
    if (domIcon.fontSize !== SIZE_CONTRACT.icon)
      note(`文字アイコンの DOM が ${domIcon.fontSize}px（${SIZE_CONTRACT.icon}px のはず）`);
    if (domIcon.overflow !== "hidden")
      note(`文字アイコンの DOM の overflow が ${domIcon.overflow}`);
    if (painted.length !== 1) {
      note(`Canvas の文字アイコンの描画が ${painted.length} 件`);
      continue;
    }
    const [record] = painted;
    if (record.declaredFontSize !== SIZE_CONTRACT.icon)
      note(`Canvas の文字アイコンが ${record.declaredFontSize}px`);
    // The defect this closes: a maxWidth condenses the glyphs instead of clipping them.
    if (record.maxWidth !== null) note(`Canvas の文字アイコンに maxWidth ${record.maxWidth}`);
    if (Math.abs(record.localScale - 1) > 0.001)
      note(`Canvas の文字アイコンの localScale が ${record.localScale}`);
    if (!record.font.endsWith(resolved.family))
      note(`Canvas の文字アイコンの font "${record.font}" が字体と違う`);
    if (record.textAlign !== "center" || record.textBaseline !== "middle")
      note(`Canvas の文字アイコンの寄せが ${record.textAlign}/${record.textBaseline}`);
    if (record.text !== domIcon.text)
      note(`文字アイコンの文字が DOM "${domIcon.text}" 対 Canvas "${record.text}"`);
    // The same string at the same size lays out to the same advance width on both
    // surfaces — but only while the DOM keeps it on one line. A wide string is broken
    // across lines there (SURFACE_EXCLUSIONS["text-icon-wrapping"]), and a wrapped box is
    // narrower than the advance width without anything having been condensed.
    if (domIcon.lineCount === 1) {
      const tolerance = Math.max(2, domIcon.inkWidth * 0.08);
      if (Math.abs(record.measuredWidth - domIcon.inkWidth) > tolerance)
        note(
          `文字アイコンの幅が DOM ${domIcon.inkWidth.toFixed(2)}px 対 ` +
            `Canvas ${record.measuredWidth.toFixed(2)}px`,
        );
    }
    if (capture.textIcon === "clipped") {
      if (!domIcon.clipped) note("DOM の文字アイコンが枠内に収まっている（はみ出す指定のはず）");
      if (record.measuredWidth <= domIcon.boxWidth)
        note("Canvas の文字アイコンが枠内に収まっている（縮小された疑い）");
    }
  }
  if (capture.textIcon === "none" && capture.icons.dom.some((icon) => icon.icon === "text"))
    note("文字アイコンのないはずの画面に文字アイコンがある");
  if (["clipped", "any"].includes(capture.textIcon) && !result.icons)
    note("文字アイコンを実測していない");
  for (const kind of capture.requires ?? [])
    if (!result.kinds.has(kind)) note(`${kind} を実測していない`);
  return result;
}

async function captureSurfaces(page, fixture, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.evaluate(
    async (input) => {
      const module = await import("/tests/browser/font-parity-harness.js");
      const harness = await module.createFontParityHarness({ screen: input.screen });
      window.__fontParityHarness = harness;
      try {
        await harness.settle();
        for (const step of input.steps)
          if (step.surface === "dom") await harness.clickDom(step.selector);
          else await harness.clickCanvas(step.target);
      } catch (error) {
        document.getElementById("font-parity-error").textContent = error.stack ?? String(error);
        throw error;
      }
    },
    { screen: fixture.screen, steps: fixture.steps },
  );
  if (fixture.media) {
    // An image reports its failure asynchronously. Wait for every media root to have
    // settled (loaded, empty or failed) before measuring, then repaint: recording the
    // frame from before the error would measure a notice that is not on screen yet.
    await page.waitForFunction(() => {
      const stage = window.__fontParityHarness?.domStage;
      const roots = [...(stage?.querySelectorAll("[data-media-kind]") ?? [])];
      return (
        roots.length > 0 &&
        roots.every((root) => {
          if (root.dataset.empty === "true" || root.dataset.mediaError === "true") return true;
          const native = root.querySelector(".native-media");
          return native?.complete !== false;
        })
      );
    });
    await page.evaluate(() => window.__fontParityHarness.afterFrame());
  }
  const observed = await page.evaluate(() => window.__fontParityHarness.surfaces());
  return {
    fixture: fixture.name,
    viewport: viewport.name,
    viewportSize: { width: viewport.width, height: viewport.height },
    requires: fixture.requires ?? [],
    textIcon: fixture.textIcon ?? null,
    ...observed,
  };
}

async function runSurfaces({ context, origin, evidenceDir, viewport, log }) {
  const { page, pageErrors } = await instrument(
    context,
    `${origin}/tests/browser/font-parity.html`,
    viewport,
  );
  const file = resolve(evidenceDir, "surfaces.json");
  const captures = [];
  const problems = [];
  try {
    for (const size of SURFACE_VIEWPORTS)
      for (const fixture of SURFACE_FIXTURES) {
        const capture = await captureSurfaces(page, fixture, size);
        const image = resolve(evidenceDir, `surfaces-${fixture.name}-${size.name}.png`);
        await page.locator("#font-parity-host").screenshot({ path: image });
        await page.evaluate(() => window.__fontParityHarness?.dispose());
        captures.push({ ...capture, image });
      }
  } finally {
    // Leave the page on the viewport the runner handed over, whatever happened above.
    await page.setViewportSize(viewport).catch(() => {});
    await writeFile(
      file,
      `${JSON.stringify({ exclusions: SURFACE_EXCLUSIONS, captures, pageErrors }, null, 2)}\n`,
    );
    log(`Surfaces ledger: ${file}`);
    await page.close();
  }
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join("; ")}`);
  const results = captures.map((capture) => assertSurfaceCase(capture, problems));
  const sprites = results.flatMap((result) => result.sprites);
  const kinds = new Set(results.flatMap((result) => [...result.kinds]));
  for (const kind of ["figure", "document", "image", "video", "iframe", "dialog-icon"])
    if (!kinds.has(kind)) problems.push(`kind ${kind} を一度も実測していない`);
  const shapes = {};
  for (const [name, matches] of Object.entries(SURFACE_SHAPES))
    shapes[name] = sprites.filter(matches).length;
  for (const [name, count] of Object.entries(shapes))
    if (!count) problems.push(`surface text shape ${name} was never painted`);
  if (!results.some((result) => result.multiline)) problems.push("複数行の図表を実測していない");
  // Both widths have to have produced measurements, and the narrow one has to have scaled
  // the sprites differently: the same numbers at both widths would mean the fit never ran.
  const byViewport = new Map();
  for (const [index, result] of results.entries())
    byViewport.set(
      captures[index].viewport,
      (byViewport.get(captures[index].viewport) ?? 0) + result.sprites.length,
    );
  for (const size of SURFACE_VIEWPORTS)
    if (!byViewport.get(size.name)) problems.push(`${size.name} で sprite を実測していない`);
  const scales = new Set(sprites.map((sprite) => sprite.scale.toFixed(4)));
  if (scales.size < 2) problems.push("倍率が 1 種類しかない（幅による縮尺が効いていない）");
  log(
    `${captures.length} cases, ${sprites.length} sprite pairs over ` +
      `${[...kinds].sort().join("/")}, ` +
      `${results.reduce((total, result) => total + result.notices, 0)} media notices, ` +
      `${results.reduce((total, result) => total + result.icons, 0)} dialog icons, ` +
      `${scales.size} distinct scales, ` +
      `shapes ${Object.entries(shapes)
        .map(([name, count]) => `${name}=${count}`)
        .join(" ")}`,
  );
  if (problems.length)
    throw new Error(`surfaces: ${problems.length} problems\n- ${problems.join("\n- ")}`);
  return { cases: captures.length, sprites: sprites.length, file };
}

// --- lifecycle ----------------------------------------------------------------------
// What has to stay correct when the font the frame was measured with arrives late, fails,
// or when the device pixel ratio moves underneath a painted frame. The DOM reflows itself
// for all three; the Canvas bitmap does none of it, so this suite is about the host's two
// subscriptions and about the bitmap the ratio scales.
//
// The probe font is a real font file on this machine (its path, size and digest are written
// to the ledger), declared from the page and delivered over the fixture server's origin by
// the runner's own route, which is what holds the bytes back until the suite lets them
// through. Nothing is added to the product for it: the stage's family is overridden from the
// page, exactly where the host lets an embedding application override it.

const TEST_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/freefont/FreeMono.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
];

// A monospaced face on purpose: equal advances for "iiiii" and "WWWWW" are what tells the
// probe font apart from the proportional fallback, with no hard-coded width anywhere.
function testFontPath() {
  const named = process.env.FONT_PARITY_TEST_FONT;
  if (named) {
    if (!existsSync(named)) throw new Error(`FONT_PARITY_TEST_FONT=${named} は存在しません`);
    return named;
  }
  const found = TEST_FONT_CANDIDATES.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      "遅延配信するテスト字体が見つかりません。等幅の実フォントファイルを " +
        `FONT_PARITY_TEST_FONT で指定してください（既定の候補: ${TEST_FONT_CANDIDATES.join(", ")}）`,
    );
  return found;
}

// Installed before the first script on the page: it records every media query the host
// arms, so the suite can reach the real MediaQueryList the runtime subscribed to.
function mediaRecorder() {
  const original = window.matchMedia.bind(window);
  const queries = [];
  window.matchMedia = (media) => {
    const query = original(media);
    queries.push({ media, query });
    return query;
  };
  window.__fontParityMedia = {
    list: () => queries.map((entry) => entry.media),
    // Chromium updates window.devicePixelRatio (and MediaQueryList.matches) under a CDP
    // metrics override but delivers no `change` event for it, so the event is fired here on
    // the query the host is actually listening to. Only the delivery is synthetic: the
    // ratio, the bitmap, the transform and every number measured afterwards are the
    // browser's own.
    fire(media) {
      const entry = [...queries].reverse().find((candidate) => candidate.media === media);
      if (!entry) throw new Error(`matchMedia(${media}) は一度も問い合わされていません`);
      entry.query.dispatchEvent(new Event("change"));
      return { media, matches: entry.query.matches };
    },
  };
}

const LIFECYCLE_SCREEN = "screens/hello-world.json";
// The arrival case needs Latin text on screen: the probe font has no CJK glyphs, so a
// Japanese-only screen keeps the per-codepoint fallback and nothing it paints would move.
// T3's text fixture carries both, plus an editable field for the draft.
const ARRIVAL_SCREEN = "/tests/browser/font-parity-text.json";
// `moves` says whether the probe font covers these codepoints. Both answers are checked: a
// covered sample has to change, an uncovered one has to stay exactly where it was.
const FONT_SAMPLES = [
  { text: "iiiii", moves: true },
  { text: "WWWWW", moves: true },
  { text: "ABCDEFGHIJ", moves: true },
  { text: "日本語テキスト", role: "caption", moves: false },
];
const LIFECYCLE_SELECTORS = [
  { selector: ".ui-displayfield > div", moves: true },
  { selector: ".ui-label", moves: false },
];
const LIFECYCLE_ROLES = ROLE_CONTRACT.filter((entry) =>
  [
    "label",
    "button",
    "field-input",
    "field-label",
    "canvas-editor",
    "displayfield-label",
    "displayfield-value",
  ].includes(entry.role),
);
const LIFECYCLE_PROBE = {
  samples: FONT_SAMPLES,
  specs: LIFECYCLE_ROLES,
  selectors: LIFECYCLE_SELECTORS.map((entry) => entry.selector),
};
// An advance width is a float: anything above this is a change, anything below is the same
// number measured twice.
const SAME_WIDTH = 0.01;
const PIXEL_RATIOS = [2, 1, 2.5, 1];
const DRAFT = "下書き";

const observeLifecycle = (page) =>
  page.evaluate((input) => window.__fontParityHarness.lifecycle(input), LIFECYCLE_PROBE);

// Always the canvas the current harness owns: a disposed harness leaves its own bucket
// behind under the same element id.
const recordedDraws = (page) =>
  page.evaluate(
    () => window.__fontParity.forCanvas(window.__fontParityHarness.canvas)?.draws ?? [],
  );

// A frame recorded after the bytes were released: every draw in it saw a settled font set.
const loadedFrame = (page) =>
  page.waitForFunction(
    () => {
      const draws = window.__fontParity.forCanvas(window.__fontParityHarness.canvas)?.draws ?? [];
      return draws.length > 0 && draws.every((draw) => draw.fontsStatus === "loaded");
    },
    undefined,
    { timeout: 15000 },
  );

const ratioFrame = (page, ratio) =>
  page.waitForFunction(
    (expected) => {
      const draws = window.__fontParity.forCanvas(window.__fontParityHarness.canvas)?.draws ?? [];
      return draws.length > 0 && draws.every((draw) => draw.devicePixelRatio === expected);
    },
    ratio,
    { timeout: 15000 },
  );

// Equal advances for the narrow and the wide sample: true only while the monospaced probe
// font is the one being measured.
function uniformAdvance(advances) {
  const narrow = advances.find((entry) => entry.text === "iiiii");
  const wide = advances.find((entry) => entry.text === "WWWWW");
  if (!narrow || !wide) return null;
  return Math.abs(narrow.width - wide.width) < 0.01;
}

// Every role that is on screen still carries its declared size. A font or a ratio may
// change what a glyph measures; it may never change which size was declared.
function assertSizesHeld(label, capture, note) {
  let measured = 0;
  for (const [surface, groups] of Object.entries(capture.roles))
    for (const group of groups) {
      const spec = LIFECYCLE_ROLES.find((entry) => entry.selector === group.selector);
      for (const sample of group.samples.filter((entry) => entry.visible)) {
        measured++;
        if (sample.fontSize !== spec.px)
          note(`${label}/${surface} ${group.role} が ${sample.fontSize}px（宣言は ${spec.px}px）`);
      }
    }
  const sizes = new Set(Object.values(SIZE_CONTRACT));
  for (const draw of capture.canvasSurface?.draws ?? []) {
    const declared = fontSizeOf(draw.font);
    if (!sizes.has(declared))
      note(`${label} のCanvas描画 "${draw.text.slice(0, 12)}" が役割外の ${declared}px`);
  }
  return measured;
}

// `locator.screenshot()` waits for the web fonts to settle, which is precisely the state
// these cases hold on purpose, so a frame with bytes still in flight is grabbed through CDP.
async function captureHeldFrame(page, context, path) {
  const box = await page.locator("#font-parity-host").boundingBox();
  const cdp = await context.newCDPSession(page);
  try {
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
      captureBeyondViewport: true,
    });
    await writeFile(path, Buffer.from(shot.data, "base64"));
  } finally {
    await cdp.detach().catch(() => {});
  }
  return path;
}

async function declareProbeFont(page, { id, family }) {
  await page.addStyleTag({
    content:
      `@font-face { font-family: "${family}"; ` +
      `src: url("/tests/browser/font-parity-probe-${id}.ttf") format("truetype"); ` +
      // `swap` keeps the fallback visible while the bytes are held back, so the "before"
      // frame is a real frame instead of Chromium's invisible block period.
      "font-display: swap; }",
  });
}

// One route for every probe font, with the bytes held until the case opens its gate.
async function serveProbeFonts(page, bytes) {
  const gates = new Map();
  const requests = [];
  await page.route("**/font-parity-probe-*.ttf", async (route) => {
    const url = route.request().url();
    const id = /font-parity-probe-([a-z0-9-]+)\.ttf/.exec(url)?.[1];
    const gate = gates.get(id);
    requests.push({ id: id ?? null, url, mode: gate?.mode ?? "unknown" });
    if (!gate)
      return route.fulfill({ status: 404, contentType: "text/plain", body: "unknown probe" });
    await gate.opened;
    if (gate.mode === "broken")
      return route.fulfill({
        status: 200,
        contentType: "font/ttf",
        body: "これはフォントのバイト列ではありません",
      });
    return route.fulfill({ status: 200, contentType: "font/ttf", body: bytes });
  });
  return {
    requests,
    gate(id, mode = "good") {
      let open;
      const opened = new Promise((done) => {
        open = done;
      });
      gates.set(id, { mode, opened });
      return { id, family: `FontParityProbe-${id}`, mode, open };
    },
  };
}

// Open an edit and type a draft into it, so a repaint can be checked for keeping the very
// node, selection and uncommitted text the user is working in. The Canvas overlay is the
// default because that is the control a repaint can destroy; the matrix suite also opens the
// DOM stage's own control through the same helper.
async function openDraft(page, note, { surface = "canvas", target = "nameInput" } = {}) {
  await page.evaluate((input) => window.__fontParityHarness.focusField(input), { surface, target });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(DRAFT, { delay: 10 });
  await page.evaluate(() => window.__fontParityHarness.afterFrame());
  const marked = await page.evaluate(() => window.__fontParityHarness.markActive());
  if (!marked.present) note("編集を開始できなかった");
  if (marked.value !== DRAFT) note(`下書きが "${marked.value}" になった`);
  return marked;
}

function assertDraftHeld(label, marked, capture, note) {
  const active = capture.active;
  if (!active.present) return note(`${label}: 再描画後に焦点が失われた`);
  if (!active.same) return note(`${label}: 再描画で編集中の入力欄が作り直された`);
  if (active.value !== marked.value)
    note(`${label}: 下書きが "${marked.value}" から "${active.value}" になった`);
  if (
    active.selectionStart !== marked.selectionStart ||
    active.selectionEnd !== marked.selectionEnd
  )
    note(`${label}: 選択位置が ${marked.selectionStart}-${marked.selectionEnd} から動いた`);
}

// Case 1: the font arrives after the frame was painted. Nothing in the page resizes,
// clicks or re-renders after the bytes are released, so any frame recorded from that
// point on was scheduled by the host's own font subscription.
async function runFontArrival(page, context, { gate, evidenceDir, problems }) {
  const note = (message) => problems.push(`fonts-arrival: ${message}`);
  await openHarness(page, ARRIVAL_SCREEN);
  await declareProbeFont(page, gate);
  const marked = await openDraft(page, note, { target: "longAscii" });
  const before = await page.evaluate(
    (input) => window.__fontParityHarness.useFontFamily(input.family, input.probe),
    { family: gate.family, probe: LIFECYCLE_PROBE },
  );
  const beforeImage = await captureHeldFrame(
    page,
    context,
    resolve(evidenceDir, "lifecycle-font-before.png"),
  );
  if (before.fonts.status !== "loading")
    note(`字体を要求した直後の font set が ${before.fonts.status}（loading を期待）`);
  if (uniformAdvance(before.advances.canvas) !== false)
    note("読込前から等幅で測れている（fallback を測れていない）");
  const beforeDraws = before.canvasSurface?.draws ?? [];
  if (!beforeDraws.length) note("読込前のCanvasフレームが記録されていない");
  if (!beforeDraws.some((draw) => draw.font.includes(gate.family)))
    note("読込前のCanvas描画が probe 字体を指していない");
  // The monospace roles keep their own family on purpose (that is the one override the
  // renderer makes), so they are the only draws allowed not to name the stage's family.
  const strayFamily = beforeDraws.filter(
    (draw) => !draw.font.includes(gate.family) && !draw.font.includes("monospace"),
  );
  if (strayFamily.length)
    note(
      `読込前のCanvas描画 ${strayFamily.length} 件が probe 字体も monospace も指していない` +
        `（例: ${strayFamily[0].font}）`,
    );
  assertSizesHeld("読込前", before, note);
  await page.evaluate(() => window.__fontParity.reset());
  gate.open();
  let repainted = true;
  await loadedFrame(page).catch((error) => {
    repainted = false;
    note(`字体の読込完了でCanvasが再描画されなかった: ${error.message}`);
  });
  const after = await observeLifecycle(page);
  const afterImage = await captureHeldFrame(
    page,
    context,
    resolve(evidenceDir, "lifecycle-font-after.png"),
  );
  const face = after.fonts.faces.find((entry) => entry.family === gate.family);
  if (face?.status !== "loaded") note(`probe 字体の状態が ${face?.status ?? "未登録"}`);
  for (const surface of ["canvas", "dom"]) {
    if (uniformAdvance(after.advances[surface]) !== true)
      note(`${surface} 側が読込後も等幅で測れていない（字体が効いていない）`);
    for (const [index, sample] of after.advances[surface].entries()) {
      const was = before.advances[surface][index];
      const moved = Math.abs(sample.width - was.width) >= SAME_WIDTH;
      const spec = FONT_SAMPLES[index];
      if (spec.moves && !moved)
        note(`${surface} の "${sample.text}" の送り幅が変わらない（${was.width}）`);
      // A codepoint the probe font does not cover keeps the browser's own fallback, so its
      // advance must be the same number before and after.
      if (!spec.moves && moved)
        note(`${surface} の "${sample.text}" が動いた（${was.width} → ${sample.width}）`);
    }
  }
  const inkShape = (record) => `${record.width}/${record.scrollWidth}/${record.lineCount}`;
  for (const [index, entry] of after.ink.entries()) {
    const spec = LIFECYCLE_SELECTORS[index];
    const was = before.ink[index];
    if (!entry.found || !was.found) {
      note(`DOM の ${spec.selector} が見つからない`);
      continue;
    }
    const moved = inkShape(entry) !== inkShape(was);
    if (spec.moves && !moved)
      note(`DOM の ${spec.selector} が再レイアウトされていない（${inkShape(was)}）`);
    if (!spec.moves && moved)
      note(`DOM の ${spec.selector} が動いた（${inkShape(was)} → ${inkShape(entry)}）`);
  }
  // The frame was measured again, not only declared again: the same text's recorded
  // measureText width has to have moved with the font.
  const afterDraws = after.canvasSurface?.draws ?? [];
  let remeasured = 0;
  for (const draw of afterDraws) {
    const was = beforeDraws.find((entry) => entry.text === draw.text);
    if (was && Math.abs(was.measuredWidth - draw.measuredWidth) >= SAME_WIDTH) remeasured++;
  }
  if (!remeasured) note("再描画後のCanvas計測値が1件も変わっていない");
  if (afterDraws.some((draw) => draw.fontsStatus !== "loaded"))
    note("読込後のフレームに読込中の描画が混ざっている");
  const measured = assertSizesHeld("読込後", after, note);
  if (!measured) note("役割のサイズを1件も実測できていない");
  assertDraftHeld("fonts-arrival", marked, after, note);
  if (after.errors.length) note(`runtime エラー: ${after.errors.join("; ")}`);
  return {
    name: "fonts-arrival",
    family: gate.family,
    repainted,
    remeasured,
    images: [beforeImage, afterImage],
    before,
    after,
  };
}

// Case 2: the bytes never parse. The face fails, the host still repaints, and the frame
// that lands is the fallback one — not an exception and not a half-updated frame.
async function runFontFailure(page, { gate, problems }) {
  const note = (message) => problems.push(`fonts-error: ${message}`);
  await page.evaluate(() => window.__fontParityHarness.dispose());
  await openHarness(page, LIFECYCLE_SCREEN);
  await declareProbeFont(page, gate);
  const before = await page.evaluate(
    (input) => window.__fontParityHarness.useFontFamily(input.family, input.probe),
    { family: gate.family, probe: LIFECYCLE_PROBE },
  );
  await page.evaluate(() => window.__fontParity.reset());
  gate.open();
  let repainted = true;
  await loadedFrame(page).catch((error) => {
    repainted = false;
    note(`読込失敗で再描画されなかった: ${error.message}`);
  });
  const after = await observeLifecycle(page);
  const face = after.fonts.faces.find((entry) => entry.family === gate.family);
  if (face?.status !== "error")
    note(`壊れた字体の状態が ${face?.status ?? "未登録"}（error を期待）`);
  if (uniformAdvance(after.advances.canvas) !== false)
    note("読込失敗後に等幅で測れている（壊れた字体が使われた）");
  for (const [index, sample] of after.advances.canvas.entries())
    if (Math.abs(sample.width - before.advances.canvas[index].width) >= SAME_WIDTH)
      note(`失敗後に "${sample.text}" の送り幅が変わった（fallback が維持されていない）`);
  const draws = after.canvasSurface?.draws ?? [];
  if (!draws.length) note("失敗後のフレームが記録されていない");
  if (!draws.some((draw) => draw.text.trim())) note("失敗後のフレームに文字が描かれていない");
  assertSizesHeld("読込失敗", after, note);
  if (after.errors.length) note(`runtime エラー: ${after.errors.join("; ")}`);
  return { name: "fonts-error", family: gate.family, repainted, before, after };
}

// Case 3: a theme change and a width change race the font. The frame that finally lands has
// to carry all three, and the open edit has to come through unharmed.
async function runFontRace(page, { gate, problems }) {
  const note = (message) => problems.push(`fonts-race: ${message}`);
  await page.evaluate(() => window.__fontParityHarness.dispose());
  await openHarness(page, LIFECYCLE_SCREEN);
  await declareProbeFont(page, gate);
  const marked = await openDraft(page, note);
  const before = await page.evaluate(
    (input) => window.__fontParityHarness.useFontFamily(input.family, input.probe),
    { family: gate.family, probe: LIFECYCLE_PROBE },
  );
  await page.evaluate(() => window.__fontParityHarness.applyThemeUrl("/themes/dark.json"));
  await page.evaluate(() => window.__fontParityHarness.resizeHostTo("760px"));
  await page.evaluate(() => window.__fontParity.reset());
  gate.open();
  let repainted = true;
  await loadedFrame(page).catch((error) => {
    repainted = false;
    note(`テーマ・幅の変更と競合したときに再描画されなかった: ${error.message}`);
  });
  const after = await observeLifecycle(page);
  if (after.scene?.theme.mode !== "dark")
    note(`テーマが ${after.scene?.theme.mode}（dark を期待）`);
  if (uniformAdvance(after.advances.canvas) !== true) note("競合後に字体が効いていない");
  if (
    after.environment.canvasStage.canvas.cssWidth === before.environment.canvasStage.canvas.cssWidth
  )
    note("幅の変更がCanvasに届いていない");
  const scales = new Set((after.canvasSurface?.draws ?? []).map((draw) => draw.devicePixelRatio));
  if (scales.size !== 1) note(`1フレームに複数の倍率が混ざった: ${[...scales].join(", ")}`);
  assertSizesHeld("競合後", after, note);
  assertDraftHeld("fonts-race", marked, after, note);
  if (after.errors.length) note(`runtime エラー: ${after.errors.join("; ")}`);
  return { name: "fonts-race", family: gate.family, repainted, before, after };
}

// Case 4: the runtime is disposed while the font is still in flight. The completion must
// not revive the surface, and it must not take the next runtime's subscription with it.
async function runDisposeDuringLoad(page, { gate, next, problems }) {
  const note = (message) => problems.push(`fonts-dispose: ${message}`);
  await page.evaluate(() => window.__fontParityHarness.dispose());
  await openHarness(page, LIFECYCLE_SCREEN);
  await declareProbeFont(page, gate);
  const before = await page.evaluate(
    (input) => window.__fontParityHarness.useFontFamily(input.family, input.probe),
    { family: gate.family, probe: LIFECYCLE_PROBE },
  );
  await page.evaluate(() => window.__fontParityHarness.dispose());
  await page.evaluate(() => window.__fontParity.reset());
  gate.open();
  await page
    .waitForFunction(() => document.fonts.status === "loaded", undefined, { timeout: 15000 })
    .catch((error) => note(`字体の読込が終わらなかった: ${error.message}`));
  // Give a stray repaint time to land before deciding that none did.
  await page.waitForTimeout(500);
  const afterDispose = await recordedDraws(page);
  if (afterDispose.length) note(`dispose 後に ${afterDispose.length} 件の描画が起きた`);
  // The next runtime on the same document still has to repaint on its own font load.
  await openHarness(page, LIFECYCLE_SCREEN);
  await declareProbeFont(page, next);
  const fresh = await page.evaluate(
    (input) => window.__fontParityHarness.useFontFamily(input.family, input.probe),
    { family: next.family, probe: LIFECYCLE_PROBE },
  );
  await page.evaluate(() => window.__fontParity.reset());
  next.open();
  let repainted = true;
  await loadedFrame(page).catch((error) => {
    repainted = false;
    note(`dispose の後に作った runtime が再描画されなかった: ${error.message}`);
  });
  const after = await observeLifecycle(page);
  if (uniformAdvance(fresh.advances.canvas) !== false)
    note("次の runtime が読込前から等幅で測れている");
  if (uniformAdvance(after.advances.canvas) !== true) note("次の runtime で字体が効いていない");
  assertSizesHeld("dispose 後の runtime", after, note);
  if (after.errors.length) note(`runtime エラー: ${after.errors.join("; ")}`);
  return {
    name: "fonts-dispose",
    families: [gate.family, next.family],
    drawsAfterDispose: afterDispose.length,
    repainted,
    before,
    after,
  };
}

// Case 5: the device pixel ratio changes while every CSS size stays exactly as it was. The
// bitmap and the transform have to follow, a round trip must not accumulate, and the font
// sizes must not be touched by the ratio at all.
async function runPixelRatio(page, context, { evidenceDir, problems }) {
  const note = (message) => problems.push(`pixel-ratio: ${message}`);
  await page.evaluate(() => window.__fontParityHarness.dispose());
  await openHarness(page, LIFECYCLE_SCREEN);
  const marked = await openDraft(page, note);
  const cdp = await context.newCDPSession(page);
  const phases = [];
  const images = [];
  const capture = async (ratio) => {
    const observed = await observeLifecycle(page);
    const image = resolve(evidenceDir, `lifecycle-dpr-${String(ratio).replace(".", "_")}.png`);
    await page.locator("#font-parity-host").screenshot({ path: image });
    images.push(image);
    phases.push({ ratio, image, observed });
    return observed;
  };
  let armed = 1;
  try {
    if ((await page.evaluate(() => window.devicePixelRatio)) !== 1)
      note("開始時の devicePixelRatio が 1 ではない");
    await capture(1);
    for (const ratio of PIXEL_RATIOS) {
      // A real ratio change: width/height 0 leaves the viewport override alone, so no CSS
      // size moves and the resize observation has nothing to report.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 0,
        height: 0,
        deviceScaleFactor: ratio,
        mobile: false,
      });
      const live = await page.evaluate(() => window.devicePixelRatio);
      if (live !== ratio) note(`devicePixelRatio が ${live}（${ratio} を要求）`);
      await page.evaluate(() => window.__fontParity.reset());
      const fired = await page.evaluate(
        (media) => window.__fontParityMedia.fire(media),
        `(resolution: ${armed}dppx)`,
      );
      if (fired.matches)
        note(`(resolution: ${armed}dppx) がまだ一致している（倍率が変わっていない）`);
      await ratioFrame(page, ratio).catch((error) =>
        note(`倍率 ${ratio} で再描画されなかった: ${error.message}`),
      );
      const queries = await page.evaluate(() => window.__fontParityMedia.list());
      if (!queries.includes(`(resolution: ${ratio}dppx)`))
        note(
          `倍率 ${ratio} で解像度クエリが張り直されていない（${queries.slice(-3).join(" / ")}）`,
        );
      armed = ratio;
      await capture(ratio);
    }
  } finally {
    await cdp
      .send("Emulation.setDeviceMetricsOverride", {
        width: 0,
        height: 0,
        deviceScaleFactor: 1,
        mobile: false,
      })
      .catch(() => {});
    await cdp.detach().catch(() => {});
  }
  const base = phases[0];
  const baseCanvas = base.observed.environment.canvasStage.canvas;
  for (const phase of phases) {
    const label = `倍率 ${phase.ratio}`;
    const { observed } = phase;
    const canvas = observed.environment.canvasStage.canvas;
    if (observed.pixelRatio !== phase.ratio) note(`${label}: 観測値が ${observed.pixelRatio}`);
    if (canvas.cssWidth !== baseCanvas.cssWidth || canvas.cssHeight !== baseCanvas.cssHeight)
      note(
        `${label}: CSS寸法が ${canvas.cssWidth}x${canvas.cssHeight} に変わった（倍率だけを変えている）`,
      );
    if (canvas.bitmapWidth !== Math.round(canvas.cssWidth * phase.ratio))
      note(
        `${label}: bitmap 幅が ${canvas.bitmapWidth}（${Math.round(canvas.cssWidth * phase.ratio)} を期待）`,
      );
    if (canvas.bitmapHeight !== Math.round(canvas.cssHeight * phase.ratio))
      note(`${label}: bitmap 高さが ${canvas.bitmapHeight}`);
    const draws = observed.canvasSurface?.draws ?? [];
    if (!draws.length) note(`${label}: フレームが記録されていない`);
    const plain = draws.filter((draw) => Math.abs(toCss(draw).localScale - 1) < 0.001);
    if (!plain.length) note(`${label}: 倍率1の描画が1件もない`);
    for (const draw of plain) {
      const { a, b, c, d } = draw.transform;
      if (
        Math.abs(a - phase.ratio) > 1e-6 ||
        Math.abs(d - phase.ratio) > 1e-6 ||
        b !== 0 ||
        c !== 0
      )
        note(`${label}: 変形が a=${a} b=${b} c=${c} d=${d}（${phase.ratio} 倍の等倍を期待）`);
      if (draw.devicePixelRatio !== phase.ratio)
        note(`${label}: 描画時の倍率が ${draw.devicePixelRatio}`);
    }
    // The ratio scales the bitmap, never the type: the same text keeps the same CSS size.
    for (const draw of plain) {
      const was = (base.observed.canvasSurface?.draws ?? []).find(
        (entry) => entry.text === draw.text,
      );
      if (!was) continue;
      const now = toCss(draw).effectiveFontSize;
      const then = toCss(was).effectiveFontSize;
      if (Math.abs(now - then) > 1e-6)
        note(`${label}: "${draw.text.slice(0, 12)}" の実効サイズが ${then} から ${now} へ動いた`);
    }
    if (
      JSON.stringify(observed.resolved.canvas.sizes) !==
      JSON.stringify(base.observed.resolved.canvas.sizes)
    )
      note(`${label}: 解決したサイズ表が変わった`);
    assertSizesHeld(label, observed, note);
    assertDraftHeld(`pixel-ratio ${phase.ratio}`, marked, observed, note);
    if (observed.errors.length) note(`${label}: runtime エラー: ${observed.errors.join("; ")}`);
  }
  // 1 -> 2 -> 1 must come back to exactly the first frame, not to a frame that kept a
  // leftover factor: `setTransform` is what makes the round trip exact.
  const returned = phases.filter((phase) => phase.ratio === 1).at(-1);
  const shape = (phase) =>
    (phase.observed.canvasSurface?.draws ?? []).map((draw) => ({
      text: draw.text,
      font: draw.font,
      a: draw.transform.a,
      d: draw.transform.d,
      bitmap: draw.bitmapWidth,
    }));
  if (JSON.stringify(shape(returned)) !== JSON.stringify(shape(base)))
    note("倍率を戻したフレームが最初のフレームと一致しない（倍率が累積している）");
  const bitmaps = new Set(
    phases.map((phase) => phase.observed.environment.canvasStage.canvas.bitmapWidth),
  );
  if (bitmaps.size < 3) note(`bitmap 幅が ${bitmaps.size} 種類しかない（倍率が効いていない）`);
  return { name: "pixel-ratio", phases, images, ratios: PIXEL_RATIOS };
}

async function runLifecycle({ context, origin, evidenceDir, viewport, log }) {
  const fontPath = testFontPath();
  const bytes = await readFile(fontPath);
  const font = {
    path: fontPath,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    delivery:
      "fixtureサーバーのoriginのURLで、runnerのrouteがバイト列を保留してから配信する" +
      "（遅延はrunner側。サーバーにテスト専用の経路は足していない）",
    realBrowserZoom: false,
    note:
      "CDPのdeviceScaleFactor上書きは devicePixelRatio と MediaQueryList.matches を更新するが " +
      "change イベントを配信しないため、購読済みの実MediaQueryList上でイベントだけを発火している",
  };
  const { page, pageErrors } = await instrument(
    context,
    `${origin}/tests/browser/font-parity.html`,
    viewport,
    [mediaRecorder],
  );
  const fonts = await serveProbeFonts(page, bytes);
  const cases = [];
  const problems = [];
  try {
    cases.push(
      await runFontArrival(page, context, { gate: fonts.gate("arrival"), evidenceDir, problems }),
    );
    cases.push(await runFontFailure(page, { gate: fonts.gate("broken", "broken"), problems }));
    cases.push(await runFontRace(page, { gate: fonts.gate("race"), problems }));
    cases.push(
      await runDisposeDuringLoad(page, {
        gate: fonts.gate("disposed"),
        next: fonts.gate("successor"),
        problems,
      }),
    );
    cases.push(await runPixelRatio(page, context, { evidenceDir, problems }));
  } finally {
    const file = resolve(evidenceDir, "lifecycle.json");
    await writeFile(
      file,
      `${JSON.stringify({ font, requests: fonts.requests, cases, pageErrors }, null, 2)}\n`,
    );
    log(`Lifecycle ledger: ${file}`);
    await page.close();
  }
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join("; ")}`);
  for (const name of ["fonts-arrival", "fonts-error", "fonts-race", "fonts-dispose", "pixel-ratio"])
    if (!cases.some((entry) => entry.name === name)) problems.push(`case ${name} を実行していない`);
  if (!fonts.requests.length) problems.push("テスト字体が一度も要求されていない");
  for (const request of fonts.requests)
    if (request.mode === "unknown") problems.push(`未宣言の字体が要求された: ${request.url}`);
  log(
    `${cases.length} cases, test font ${fontPath} (${bytes.length} bytes), ` +
      `${fonts.requests.length} font requests, ` +
      `ratios ${PIXEL_RATIOS.join("/")}, real browser zoom: ${font.realBrowserZoom}`,
  );
  if (problems.length)
    throw new Error(`lifecycle: ${problems.length} problems\n- ${problems.join("\n- ")}`);
  return { cases: cases.length, file: resolve(evidenceDir, "lifecycle.json") };
}

// --- matrix -------------------------------------------------------------------------
// The grid of conditions a user meets, over the screens the task names plus the dialog that
// owns the 30px character icon: both surfaces (the comparison demo and a standalone
// UiRuntime), a desktop and a ~390px width, device pixel ratio 1 and 2, light and dark, and
// browser zoom 100% / 200%. No new role is measured here. What this suite proves is that none
// of those conditions moves a declared size, and that the native controls keep sitting on the
// box the Scene laid out for them.

const NARROW_VIEWPORT = { width: 390, height: 844 };
const MATRIX_RATIOS = [1, 2];

// Zoom is not "a narrower viewport": Chromium's page zoom Z divides the CSS viewport by Z and
// multiplies devicePixelRatio by Z, so it is applied as both at once. The two methods that are
// deliberately not used are recorded beside it, because reading an emulated zoom as a real
// zoom is exactly what the requirement forbids.
const MATRIX_ZOOM = {
  method: "metrics-override",
  how:
    "CDP Emulation.setDeviceMetricsOverride に CSS 幅・高さ（基準 ÷ Z）と " +
    "deviceScaleFactor（DPR × Z）を 1 回で指定する",
  conversion:
    "CSS px の定義は変えない。レイアウト viewport が 1/Z（1440→720 CSS px）、物理px ÷ CSS px が " +
    "DPR×Z（1→2）。役割サイズは CSS px のまま比べ、bitmap だけが DPR×Z 倍になる",
  realBrowserZoom: false,
  realBrowserZoomWhy:
    "実ブラウザのズーム操作は headless Chromium では実行できない（CDP にページズームの命令はなく、" +
    "Emulation.setPageScaleFactor はピンチズームで再レイアウトしない）。実ズーム 100→200→100% は" +
    "手動確認の項目として台帳に残し、ここでの結果を実ズームの確認として読み替えない",
  cssZoom: false,
  cssZoomWhy:
    "CSS の zoom は埋め込み側が書いたときだけ現れるもので、利用者のズームとは別物。要件が求めるのは" +
    "利用者のズームなので上の同値変換で実施した",
};

const MATRIX_LIMITS = {
  zoom: MATRIX_ZOOM,
  realIme: { used: COMPOSITION.realIme, why: COMPOSITION.realImeReason },
  demoScene:
    "比較デモは Scene を公開していないため、デモ面では描画の部品対応付けと入力位置の照合を行わず、" +
    "宣言サイズの集合・字体・描画時の倍率を独立 runtime の結果と突き合わせる",
  visual:
    "目視結果は docs/renderer-font-parity.md に記録する（この JSON は自動数値結果と画像パスだけ）",
};

const MATRIX_SCREENS = [
  { name: "hello-world", screen: LIFECYCLE_SCREEN, page: "hello-world" },
  { name: "uivolve-forms", screen: FORMS_SCREEN, page: "uivolve-forms" },
  { name: "orders", screen: "screens/orders.json", page: "orders" },
  { name: "grid-lab", screen: "screens/grid-lab.json", page: "grid-lab" },
  { name: "components", screen: "screens/components.json", page: "components" },
  { name: "uivolve-gallery", screen: GALLERY_SCREEN, page: "uivolve-gallery" },
  // The 30px character icon and the dialog message only exist while a dialog is open, and the
  // visual check this task owns is about exactly those at 390px.
  {
    name: "dialog-text-icon",
    screen: DIALOGS_SCREEN,
    page: "dialogs",
    steps: [
      { selector: ICON_SELECT, value: "custom-text" },
      { selector: '.ui-button[data-target="showConfirm"]' },
    ],
  },
];

// The roles these screens have to produce somewhere in the matrix. A run that measured none of
// them would pass every size check by measuring nothing.
const MATRIX_REQUIRED_ROLES = [
  "button",
  "label",
  "panel",
  "field-label",
  "field-input",
  "grid-column",
  "grid-cell",
  "tab",
  "metric-caption",
  "metric-value",
  "window-title",
  "dialog-message",
];

// One edit per surface, held open across a theme change, two resizes and the zoom round trip.
const MATRIX_JOURNEYS = [
  { name: "journey-canvas", surface: "canvas", target: "nameInput" },
  { name: "journey-dom", surface: "dom", target: "nameInput" },
];

// Each step changes exactly one thing while the edit is open. The last two are the round trip:
// 100% -> 200% -> 100% has to come back to the frame it started from.
const JOURNEY_STEPS = [
  { label: "theme-dark", theme: ROLE_THEMES[1] },
  { label: "resize-narrow", width: "narrow" },
  { label: "resize-desktop", width: "desktop" },
  { label: "zoom-200", zoom: 2 },
  { label: "zoom-100", zoom: 1 },
];

const MATRIX_PROBE = { specs: roleSpecs(), samples: [], selectors: [] };

const matrixCondition = (width, size, ratio, zoom) => ({
  name: `${width}-dpr${ratio}-zoom${zoom * 100}`,
  width,
  ratio,
  zoom,
  base: size,
  css: { width: Math.round(size.width / zoom), height: Math.round(size.height / zoom) },
  pixelRatio: ratio * zoom,
});

// zoom 100%: the full width x ratio grid. zoom 200%: both widths at ratio 1, because the zoom
// already doubles the device pixel ratio — 2 x 2 would only repeat the bitmap arithmetic the
// lifecycle suite owns.
function matrixConditions(viewport) {
  const widths = [
    ["desktop", viewport],
    ["narrow", NARROW_VIEWPORT],
  ];
  const conditions = [];
  for (const zoom of [1, 2])
    for (const ratio of zoom === 1 ? MATRIX_RATIOS : [1])
      for (const [width, size] of widths)
        conditions.push(matrixCondition(width, size, ratio, zoom));
  return conditions;
}

// The CSS size and the ratio are set in one metrics override, because that is what a zoom is:
// both at once. `page.setViewportSize` is deliberately not used — it writes its own override,
// so the two calls raced and left the viewport one step behind the ratio.
async function applyCondition(page, cdp, condition) {
  const problems = [];
  await page.evaluate(() => window.__fontParity?.reset());
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: condition.css.width,
    height: condition.css.height,
    deviceScaleFactor: condition.pixelRatio,
    mobile: false,
  });
  // The page learns its new metrics asynchronously; a measurement taken before it does would
  // belong to the previous condition.
  await page
    .waitForFunction(
      (expected) =>
        window.devicePixelRatio === expected.ratio && window.innerWidth === expected.width,
      { ratio: condition.pixelRatio, width: condition.css.width },
      { timeout: 10000 },
    )
    .catch(() => problems.push(`条件 ${condition.name} が適用されなかった`));
  const live = await page.evaluate(() => ({
    ratio: window.devicePixelRatio,
    width: window.innerWidth,
  }));
  if (live.ratio !== condition.pixelRatio)
    problems.push(`devicePixelRatio が ${live.ratio}（${condition.pixelRatio} を要求）`);
  if (live.width !== condition.css.width)
    problems.push(`CSS viewport 幅が ${live.width}（${condition.css.width} を要求）`);
  return problems;
}

// Screenshots go through CDP: `locator.screenshot()` restores Playwright's own metrics when it
// is done, which silently dropped the emulated ratio for every case after the first. Shooting
// beyond the viewport matters at 390px, where the demo stacks its two stages.
async function shootMatrix(page, cdp, selector, path) {
  const clip = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      // Page coordinates: the clip is in document space while a bounding box is relative to
      // the viewport, and opening an overlay scrolls the page.
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      // The narrow conditions overflow their host — both pages floor the stage at 240 CSS px —
      // so the image is as wide as the content, not as wide as the box.
      width: Math.max(rect.width, element.scrollWidth),
      height: Math.max(rect.height, element.scrollHeight),
      scale: 1,
    };
  });
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip,
    captureBeyondViewport: true,
  });
  await writeFile(path, Buffer.from(shot.data, "base64"));
  return path;
}

// Every visible role sample keeps its declared size and weight, the resolver agrees with the
// contract on both stages, and the bitmap follows the ratio. Nothing here may depend on the
// condition except the bitmap: that is the whole claim.
function assertMatrixCase(capture, problems) {
  const note = (message) => problems.push(`${capture.label}: ${message}`);
  if (capture.errors?.length) note(`runtime errors: ${capture.errors.join("; ")}`);
  for (const [surface, resolved] of Object.entries(capture.resolved)) {
    if (!resolved.ok) {
      note(`${surface} resolver failed: ${resolved.error}`);
      continue;
    }
    for (const [size, expected] of Object.entries(SIZE_CONTRACT))
      if (resolved.sizes[size] !== expected)
        note(`${surface} resolved ${size}=${resolved.sizes[size]}px, contract ${expected}px`);
  }
  if (capture.pixelRatio !== capture.condition.pixelRatio)
    note(`devicePixelRatio が ${capture.pixelRatio}`);
  const canvas = capture.environment.canvasStage.canvas;
  if (canvas?.bitmapWidth !== Math.round((canvas?.cssWidth ?? 0) * capture.pixelRatio))
    note(
      `bitmap 幅が ${canvas?.bitmapWidth}（CSS ${canvas?.cssWidth} × ${capture.pixelRatio} を期待）`,
    );
  if (canvas?.bitmapHeight !== Math.round((canvas?.cssHeight ?? 0) * capture.pixelRatio))
    note(`bitmap 高さが ${canvas?.bitmapHeight}`);
  const roles = new Set();
  let measured = 0;
  for (const [surface, groups] of Object.entries(capture.roles))
    for (const group of groups) {
      const entry = ROLE_CONTRACT.find((candidate) => candidate.role === group.role);
      for (const sample of group.samples.filter((candidate) => candidate.visible)) {
        measured++;
        roles.add(group.role);
        if (sample.fontSize !== entry.px)
          note(
            `${surface}/${group.role} が ${sample.fontSize}px（宣言は ${entry.px}px・${sample.path}）`,
          );
        if (entry.weight && sample.fontWeight !== entry.weight)
          note(
            `${surface}/${group.role} の weight が ${sample.fontWeight}（${entry.weight}を期待）`,
          );
      }
    }
  if (!measured) note("可視の役割サンプルが 1 件も無い");
  return { measured, roles };
}

// The input positions: every control the stage mounted has to sit inside the widget box the
// engine laid out for it, at every width, ratio and zoom. The comparison demo exposes no
// Scene, so there the check is skipped rather than faked (MATRIX_LIMITS.demoScene).
// A native control carries its own UA margins — Chromium gives `input[type="range"]` a 2px
// margin, which src/runtime.css:407-411 does not reset — so "on its widget" is the centre inside
// the box and the edges within this much of it. A control that lost its position is off by the
// pitch of the layout (tens of px), not by two.
const CONTROL_SLACK = 4;

function assertMatrixControls(capture, problems) {
  if (!capture.domScene && !capture.scene) return null;
  const note = (message) => problems.push(`${capture.label}: ${message}`);
  let checked = 0;
  let slack = 0;
  for (const control of capture.controls.filter((entry) => entry.visible && !entry.overlay)) {
    const scene = control.surface === "dom" ? capture.domScene : capture.scene;
    const widget = scene?.widgets.find((entry) => entry.key === control.key);
    if (!widget) {
      note(`入力欄 ${control.key ?? control.tag} に対応する Scene の部品が無い`);
      continue;
    }
    checked++;
    const over = Math.max(
      widget.x - control.x,
      widget.y - control.y,
      control.x + control.width - (widget.x + widget.width),
      control.y + control.height - (widget.y + widget.height),
    );
    slack = Math.max(slack, over);
    const centre = { x: control.x + control.width / 2, y: control.y + control.height / 2 };
    const inside =
      centre.x >= widget.x &&
      centre.x <= widget.x + widget.width &&
      centre.y >= widget.y &&
      centre.y <= widget.y + widget.height;
    if (!inside || over > CONTROL_SLACK)
      note(
        `入力欄 ${control.key} の位置 (${control.x.toFixed(1)}, ${control.y.toFixed(1)}, ` +
          `${control.width.toFixed(1)}x${control.height.toFixed(1)}) が部品の矩形 ` +
          `(${widget.x}, ${widget.y}, ${widget.width}x${widget.height}) から ` +
          `${over.toFixed(1)}px はみ出している`,
      );
  }
  return { checked, slack: Number(slack.toFixed(2)) };
}

// The Canvas editing overlay has no widget ancestor: the renderer positions it from the Scene
// box, so the box it was given is compared with the widget it belongs to.
function assertOverlayBox(capture, target, note) {
  const overlay = capture.controls.find((control) => control.overlay);
  if (!overlay) return null;
  const widget = capture.scene?.widgets.find((entry) => entry.target === target);
  if (!widget) {
    note(`Scene に target="${target}" の部品が無い`);
    return overlay;
  }
  const strip = widget.labelHeight ?? 0;
  for (const [name, written, expected] of [
    ["left", overlay.styleLeft, widget.x],
    ["top", overlay.styleTop, widget.y + strip],
    ["width", overlay.styleWidth, widget.width],
    ["height", overlay.styleHeight, widget.height - strip],
  ])
    if (Math.abs(written - expected) > 0.01)
      note(`オーバーレイの ${name} が ${written}（部品は ${expected}）`);
  if (Math.abs(overlay.x - widget.x) > 1 || Math.abs(overlay.y - (widget.y + strip)) > 1)
    note(
      `オーバーレイの実測位置が (${overlay.x.toFixed(1)}, ${overlay.y.toFixed(1)})` +
        `（指定は (${widget.x}, ${widget.y + strip})）`,
    );
  return overlay;
}

// Text that reaches past its own widget box without being truncated: the pointers the visual
// check follows. Recorded as data, not asserted — a narrower viewport legitimately truncates
// more, and which of those is acceptable is what the eyes in the ledger decide.
function matrixOverflow(records, scene) {
  const widgets = new Map((scene?.widgets ?? []).map((widget) => [widget.key, widget]));
  const rows = [];
  for (const record of records) {
    const widget = widgets.get(record.key);
    if (!widget || record.text === "" || record.text.endsWith("…")) continue;
    const over = record.x + record.effectiveWidth - (widget.x + widget.width);
    if (over > 1)
      rows.push({
        kind: record.kind,
        text: record.text.slice(0, 24),
        fontSize: record.declaredFontSize,
        over: Number(over.toFixed(2)),
      });
  }
  return rows;
}

const declaredSizes = (records) =>
  [...new Set(records.map((record) => record.declaredFontSize))].sort((a, b) => a - b);

const frameShape = (capture) =>
  (capture.canvasSurface?.draws ?? []).map((draw) => ({
    text: draw.text,
    font: draw.font,
    a: draw.transform.a,
    d: draw.transform.d,
    bitmap: draw.bitmapWidth,
  }));

// One image per screen, width and theme at 100% / ratio 1 — the set the pre-fix captures are
// paired with — plus Hello World's zoomed and ratio-2 desktop frames, where a second condition
// is what makes the before/after comparison readable.
const matrixShoots = (screen, condition) =>
  (condition.zoom === 1 && condition.ratio === 1) ||
  (screen.name === "hello-world" && condition.width === "desktop");

const matrixImage = (evidenceDir, surface, screen, condition, mode) =>
  resolve(evidenceDir, `matrix-${surface}-${screen.name}-${condition.name}-${mode}.png`);

async function openMatrixHarness(page, screen, theme) {
  await page.evaluate(
    async (input) => {
      const module = await import("/tests/browser/font-parity-harness.js");
      const harness = await module.createFontParityHarness({
        screen: input.screen,
        hostFontSize: input.hostFontSize,
        themeUrl: input.themeUrl,
      });
      window.__fontParityHarness = harness;
      try {
        await harness.settle();
        for (const step of input.steps)
          if (step.value !== undefined) await harness.selectDom(step.selector, step.value);
          else await harness.clickDom(step.selector);
      } catch (error) {
        document.getElementById("font-parity-error").textContent = error.stack ?? String(error);
        throw error;
      }
    },
    {
      screen: screen.screen,
      hostFontSize: ROLE_HOST_SIZES[0],
      themeUrl: theme.url,
      steps: screen.steps ?? [],
    },
  );
}

const observeMatrix = (page) =>
  page.evaluate((probe) => window.__fontParityHarness.matrix(probe), MATRIX_PROBE);

// One row per case: counts, the sizes that were painted and the overflow pointers. The raw
// per-draw dump stays in the browser — 168 full captures would bury the answer the ledger has
// to give.
function matrixRow({ surface, screen, condition, mode, capture, canvas, image, problems }) {
  const before = problems.length;
  const sizes = assertMatrixCase(capture, problems);
  const boxes = assertMatrixControls(capture, problems);
  return {
    surface,
    screen: screen.name,
    condition: condition.name,
    width: condition.width,
    zoom: condition.zoom,
    ratio: condition.ratio,
    theme: mode,
    cssViewport: capture.environment.domStage.viewport,
    pixelRatio: capture.pixelRatio,
    hostFontSize: capture.hostFrame?.hostFontSize ?? null,
    bitmap: capture.environment.canvasStage.canvas,
    domSamples: sizes.measured,
    roles: [...sizes.roles].sort(),
    controls: boxes?.checked ?? null,
    controlSlack: boxes?.slack ?? null,
    ...canvas,
    image,
    problems: problems.length - before,
  };
}

async function runMatrixJourney(page, cdp, { journey, viewport, evidenceDir, problems }) {
  const note = (message) => problems.push(`${journey.name}: ${message}`);
  const sizeOf = (width) => (width === "desktop" ? viewport : NARROW_VIEWPORT);
  let current = matrixCondition("desktop", viewport, 1, 1);
  let armed = current.pixelRatio;
  let mode = ROLE_THEMES[0].mode;
  for (const message of await applyCondition(page, cdp, current)) note(`start: ${message}`);
  await openMatrixHarness(page, { screen: LIFECYCLE_SCREEN }, ROLE_THEMES[0]);
  const marked = await openDraft(page, note, { surface: journey.surface, target: journey.target });
  const steps = [];
  const frames = new Map();
  const record = async (label) => {
    const observed = await observeMatrix(page);
    const capture = {
      ...observed,
      label: `${journey.name}/${label}`,
      fixture: `${journey.name}/${label}`,
      mode,
      hostFontSize: ROLE_HOST_SIZES[0],
      condition: current,
    };
    assertMatrixCase(capture, problems);
    assertCanvasRoles(capture, problems);
    assertMatrixControls(capture, problems);
    assertDraftHeld(`${journey.name}/${label}`, marked, observed, note);
    if (journey.surface === "canvas" && !assertOverlayBox(capture, journey.target, note))
      note(`${label}: Canvas の編集オーバーレイが無くなっている`);
    frames.set(label, frameShape(observed));
    const image = resolve(evidenceDir, `matrix-${journey.name}-${label}.png`);
    await shootMatrix(page, cdp, "#font-parity-host", image);
    steps.push({
      label,
      condition: current.name,
      theme: mode,
      pixelRatio: observed.pixelRatio,
      viewport: observed.environment.domStage.viewport,
      bitmap: observed.environment.canvasStage.canvas,
      active: {
        same: observed.active.same,
        value: observed.active.value,
        selectionStart: observed.active.selectionStart,
        selectionEnd: observed.active.selectionEnd,
        fontSize: observed.active.fontSize,
        classes: observed.active.classes,
      },
      overlay: observed.controls.find((control) => control.overlay) ?? null,
      image,
    });
    return observed;
  };
  await record("start");
  for (const step of JOURNEY_STEPS) {
    if (step.theme) {
      await page.evaluate((url) => window.__fontParityHarness.applyThemeUrl(url), step.theme.url);
      mode = step.theme.mode;
    } else {
      const width = step.width ?? current.width;
      const next = matrixCondition(width, sizeOf(width), 1, step.zoom ?? current.zoom);
      for (const message of await applyCondition(page, cdp, next))
        note(`${step.label}: ${message}`);
      current = next;
      if (next.pixelRatio !== armed) {
        const fired = await page.evaluate(
          (media) => window.__fontParityMedia.fire(media),
          `(resolution: ${armed}dppx)`,
        );
        if (fired.matches)
          note(
            `${step.label}: (resolution: ${armed}dppx) がまだ一致している（倍率が変わっていない）`,
          );
        await ratioFrame(page, next.pixelRatio).catch((error) =>
          note(`${step.label}: 倍率 ${next.pixelRatio} で再描画されなかった: ${error.message}`),
        );
        armed = next.pixelRatio;
      } else {
        await page.evaluate(() => window.__fontParityHarness.afterFrame());
      }
    }
    await record(step.label);
  }
  if (JSON.stringify(frames.get("zoom-100")) !== JSON.stringify(frames.get("resize-desktop")))
    note("ズームを戻したフレームが拡大前のフレームと一致しない（倍率が累積している）");
  await page.evaluate(() => window.__fontParityHarness?.dispose());
  return { journey: journey.name, surface: journey.surface, draft: DRAFT, steps };
}

async function runMatrixStandalone({
  context,
  origin,
  evidenceDir,
  viewport,
  conditions,
  problems,
}) {
  const { page, pageErrors } = await instrument(
    context,
    `${origin}/tests/browser/font-parity.html`,
    viewport,
    [mediaRecorder],
  );
  const cdp = await context.newCDPSession(page);
  const rows = [];
  const images = [];
  const journeys = [];
  try {
    for (const condition of conditions) {
      for (const message of await applyCondition(page, cdp, condition))
        problems.push(`standalone/${condition.name}: ${message}`);
      for (const screen of MATRIX_SCREENS) {
        await openMatrixHarness(page, screen, ROLE_THEMES[0]);
        for (const theme of ROLE_THEMES) {
          if (theme !== ROLE_THEMES[0])
            await page.evaluate((url) => window.__fontParityHarness.applyThemeUrl(url), theme.url);
          const observed = await observeMatrix(page);
          const capture = {
            ...observed,
            label: `standalone/${screen.name}/${condition.name}/${theme.mode}`,
            fixture: `${screen.name}/${condition.name}`,
            mode: theme.mode,
            hostFontSize: ROLE_HOST_SIZES[0],
            condition,
          };
          if (capture.environment.domStage.themeMode !== theme.mode)
            problems.push(`${capture.label}: テーマが ${capture.environment.domStage.themeMode}`);
          const canvas = assertCanvasRoles(capture, problems);
          let image = null;
          if (matrixShoots(screen, condition)) {
            image = matrixImage(evidenceDir, "standalone", screen, condition, theme.mode);
            await shootMatrix(page, cdp, "#font-parity-host", image);
            images.push(image);
          }
          rows.push(
            matrixRow({
              surface: "standalone",
              screen,
              condition,
              mode: theme.mode,
              capture,
              canvas: {
                canvasDraws: canvas.asserted.length,
                canvasKinds: [...new Set(canvas.asserted.map((record) => record.kind))].sort(),
                declaredSizes: declaredSizes([...canvas.asserted, ...canvas.deferred]),
                truncated: canvas.asserted.filter((record) => record.text.endsWith("…")).length,
                overflow: matrixOverflow(canvas.asserted, capture.scene),
              },
              image,
              problems,
            }),
          );
        }
        await page.evaluate(() => window.__fontParityHarness?.dispose());
      }
    }
    for (const journey of MATRIX_JOURNEYS)
      journeys.push(
        await runMatrixJourney(page, cdp, { journey, viewport, evidenceDir, problems }),
      );
  } finally {
    // Hand the page back the way it was found, then close what this suite owns.
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await cdp.detach().catch(() => {});
    await page.close();
  }
  return { rows, images, journeys, pageErrors };
}

// A frame the demo painted after its fonts settled. The host subscribes to the font set (T6),
// so this waits for that repaint instead of forcing one.
const demoFrame = (page) =>
  page.waitForFunction(
    () => {
      const entry = window.__fontParity.snapshot().find((bucket) => bucket.label === "canvas");
      return (
        (entry?.draws.length ?? 0) > 0 && entry.draws.every((draw) => draw.fontsStatus === "loaded")
      );
    },
    undefined,
    { timeout: 20000 },
  );

async function openMatrixDemo(page, origin, screen) {
  await page.goto(`${origin}/pages/${screen.page}`, { waitUntil: "domcontentloaded" });
  await page.locator("#dom-stage .ui-widget").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await demoFrame(page);
  for (const step of screen.steps ?? []) {
    await page.evaluate(() => window.__fontParity.reset());
    if (step.value !== undefined)
      await page.selectOption(`#dom-stage ${step.selector}`, step.value);
    else await page.click(`#dom-stage ${step.selector}`);
    await demoFrame(page);
  }
}

// The demo's own theme control, used the way a user does.
async function setDemoTheme(page, mode) {
  if ((await page.getAttribute("#dom-stage", "data-theme-mode")) === mode) return;
  await page.evaluate(() => window.__fontParity.reset());
  await page.selectOption("#theme-select", mode);
  await page.waitForFunction(
    (expected) => document.getElementById("dom-stage").dataset.themeMode === expected,
    mode,
    { timeout: 20000 },
  );
  await demoFrame(page);
}

const observeDemo = (page) =>
  page.evaluate(async (probe) => {
    const module = await import("/tests/browser/font-parity-harness.js");
    const stage = document.getElementById("dom-stage");
    const canvasStage = document.getElementById("canvas-stage");
    const canvas = document.getElementById("canvas");
    return {
      roles: {
        dom: module.measureRoles(stage, probe.specs),
        canvasStage: module.measureRoles(canvasStage, probe.specs),
      },
      controls: [
        ...module.controlBoxes(stage, "dom"),
        ...module.controlBoxes(canvasStage, "canvas"),
      ],
      resolved: { dom: module.resolvedMetrics(stage), canvas: module.resolvedMetrics(canvasStage) },
      environment: {
        domStage: module.environment(stage, null),
        canvasStage: module.environment(canvasStage, canvas),
      },
      hostFrame: module.hostFrame(stage.parentElement),
      canvasSurface: window.__fontParity.forCanvas(canvas),
      pixelRatio: window.devicePixelRatio,
      scene: null,
      domScene: null,
      errors: [],
    };
  }, MATRIX_PROBE);

// The demo page exposes no Scene, so a draw cannot be attributed to a widget there. What the
// demo has to show is that the sizes it paints are the sizes the standalone runtime paints for
// the same screen: the fix lives in the runtime, not in either host page.
function assertDemoCanvas(capture, allowed, problems) {
  const note = (message) => problems.push(`${capture.label}: canvas ${message}`);
  const draws = capture.canvasSurface?.draws ?? [];
  if (!draws.length) note("描画が記録されなかった");
  const family = capture.resolved.canvas.ok ? capture.resolved.canvas.family : null;
  const sizes = new Set();
  for (const draw of draws) {
    const size = fontSizeOf(draw.font);
    if (size === null) {
      note(`解釈できない font "${draw.font}"`);
      continue;
    }
    sizes.add(size);
    if (draw.devicePixelRatio !== capture.pixelRatio)
      note(`描画時の倍率が ${draw.devicePixelRatio}（${capture.pixelRatio} を期待）`);
    if (family && !draw.font.endsWith(family) && !draw.font.endsWith("monospace"))
      note(`font "${draw.font}" がステージの字体 "${family}" ではない`);
  }
  for (const size of sizes)
    if (!allowed.has(size)) note(`${size}px は独立 runtime が同じ画面で描かなかったサイズ`);
  const painted = new Set(draws.map((draw) => draw.font));
  for (const measurement of capture.canvasSurface?.measurements ?? [])
    if (!painted.has(measurement.font))
      note(`計測 font "${measurement.font}" ("${measurement.text.slice(0, 18)}") で描画していない`);
  return { draws, sizes: [...sizes].sort((a, b) => a - b) };
}

async function runMatrixDemo({
  context,
  origin,
  evidenceDir,
  viewport,
  conditions,
  problems,
  sizesByScreen,
}) {
  const { page, pageErrors } = await instrument(
    context,
    `${origin}/pages/${MATRIX_SCREENS[0].page}`,
    viewport,
  );
  const cdp = await context.newCDPSession(page);
  const rows = [];
  const images = [];
  try {
    for (const condition of conditions) {
      for (const message of await applyCondition(page, cdp, condition))
        problems.push(`demo/${condition.name}: ${message}`);
      for (const screen of MATRIX_SCREENS) {
        await openMatrixDemo(page, origin, screen);
        for (const theme of ROLE_THEMES) {
          await setDemoTheme(page, theme.mode);
          const observed = await observeDemo(page);
          const capture = {
            ...observed,
            label: `demo/${screen.name}/${condition.name}/${theme.mode}`,
            mode: theme.mode,
            condition,
          };
          const canvas = assertDemoCanvas(capture, sizesByScreen.get(screen.name), problems);
          let image = null;
          if (matrixShoots(screen, condition)) {
            image = matrixImage(evidenceDir, "demo", screen, condition, theme.mode);
            await shootMatrix(page, cdp, ".comparison", image);
            images.push(image);
          }
          rows.push(
            matrixRow({
              surface: "demo",
              screen,
              condition,
              mode: theme.mode,
              capture,
              canvas: {
                canvasDraws: canvas.draws.length,
                canvasKinds: null,
                declaredSizes: canvas.sizes,
                truncated: canvas.draws.filter((draw) => draw.text.endsWith("…")).length,
                overflow: null,
              },
              image,
              problems,
            }),
          );
        }
      }
    }
  } finally {
    // Hand the page back the way it was found, then close what this suite owns.
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await cdp.detach().catch(() => {});
    await page.close();
  }
  return { rows, images, pageErrors };
}

async function runMatrix({ context, origin, evidenceDir, viewport, log }) {
  const conditions = matrixConditions(viewport);
  const file = resolve(evidenceDir, "matrix.json");
  const problems = [];
  const rows = [];
  const images = [];
  const journeys = [];
  const pageErrors = [];
  try {
    const standalone = await runMatrixStandalone({
      context,
      origin,
      evidenceDir,
      viewport,
      conditions,
      problems,
    });
    rows.push(...standalone.rows);
    images.push(...standalone.images);
    journeys.push(...standalone.journeys);
    pageErrors.push(...standalone.pageErrors);
    // The sizes the runtime paints per screen, which the demo page then has to match.
    const sizesByScreen = new Map();
    for (const row of standalone.rows) {
      const set = sizesByScreen.get(row.screen) ?? new Set();
      for (const size of row.declaredSizes) set.add(size);
      sizesByScreen.set(row.screen, set);
    }
    const demo = await runMatrixDemo({
      context,
      origin,
      evidenceDir,
      viewport,
      conditions,
      problems,
      sizesByScreen,
    });
    rows.push(...demo.rows);
    images.push(...demo.images);
    pageErrors.push(...demo.pageErrors);
    // Reported, never asserted: a size the demo did not paint is a narrower stage, not a
    // parity defect.
    for (const [screen, set] of sizesByScreen) {
      const painted = new Set(
        rows
          .filter((row) => row.surface === "demo" && row.screen === screen)
          .flatMap((r) => r.declaredSizes),
      );
      const missing = [...set].filter((size) => !painted.has(size));
      if (missing.length)
        log(`demo/${screen}: 独立 runtime だけが描いたサイズ ${missing.join("/")}`);
    }
  } finally {
    await writeFile(
      file,
      `${JSON.stringify(
        { limits: MATRIX_LIMITS, conditions, cases: rows, journeys, images, pageErrors },
        null,
        2,
      )}\n`,
    );
    log(`Matrix ledger: ${file}`);
  }
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join("; ")}`);
  const expected = MATRIX_SCREENS.length * conditions.length * ROLE_THEMES.length * 2;
  if (rows.length !== expected) problems.push(`ケース数が ${rows.length}（${expected} を期待）`);
  const roleUnion = new Set(rows.flatMap((row) => row.roles));
  for (const role of MATRIX_REQUIRED_ROLES)
    if (!roleUnion.has(role)) problems.push(`役割 ${role} をどの条件でも実測していない`);
  const widths = new Set(rows.map((row) => row.cssViewport.width));
  if (widths.size < 4)
    problems.push(`CSS viewport 幅が ${[...widths].join("/")} の ${widths.size} 種類しかない`);
  const bitmaps = new Set(rows.map((row) => row.bitmap?.bitmapWidth));
  if (bitmaps.size < 4) problems.push(`bitmap 幅が ${bitmaps.size} 種類しかない`);
  for (const theme of ROLE_THEMES)
    if (!rows.some((row) => row.theme === theme.mode))
      problems.push(`テーマ ${theme.mode} のケースが無い`);
  if (journeys.length !== MATRIX_JOURNEYS.length)
    problems.push(`編集中の条件変更が ${journeys.length} 本（${MATRIX_JOURNEYS.length} 本を期待）`);
  if (!images.length) problems.push("代表画像を 1 枚も撮っていない");
  log(
    `${rows.length} cases (${MATRIX_SCREENS.length} screens × ${conditions.length} conditions × ` +
      `${ROLE_THEMES.length} themes × 2 surfaces), ` +
      `${rows.reduce((total, row) => total + row.domSamples, 0)} DOM role samples, ` +
      `${rows.reduce((total, row) => total + row.canvasDraws, 0)} Canvas draws, ` +
      `${roleUnion.size} roles, viewports ${[...widths].sort((a, b) => a - b).join("/")}, ` +
      `bitmap widths ${bitmaps.size}, ${journeys.length} edit journeys, ${images.length} images, ` +
      `zoom ${MATRIX_ZOOM.method} (real browser zoom: ${MATRIX_ZOOM.realBrowserZoom})`,
  );
  if (problems.length)
    throw new Error(`matrix: ${problems.length} problems\n- ${problems.join("\n- ")}`);
  return { cases: rows.length, images: images.length, journeys: journeys.length, file };
}

// Every suite named by the plan is registered. Suites a later task owns have no runner
// and must fail loudly: an unimplemented check is never reported as a pass.
export const SUITES = [
  { name: "baseline", owner: "T1", run: runBaseline },
  // T2 covers the DOM declarations, the parent contexts and the shared size source;
  // T3 adds the Canvas draw/measure comparison for the same roles; T7 closes the kind and
  // xtype layers and the state list over the same cases.
  { name: "roles", owner: "T2/T3/T7", run: runRoles },
  { name: "editing", owner: "T4", run: runEditing },
  { name: "surfaces", owner: "T5", run: runSurfaces },
  { name: "lifecycle", owner: "T6", run: runLifecycle },
  // T8 holds the same roles over the width / zoom / ratio / theme grid, on both surfaces.
  { name: "matrix", owner: "T8", run: runMatrix },
  { name: "distribution", owner: "T9", run: null },
];

export function selectSuites(names) {
  if (!names.length) throw new Error("Pass at least one --suite <name>");
  const known = SUITES.map((suite) => suite.name);
  const selected = [];
  for (const name of names) {
    const suite = SUITES.find((entry) => entry.name === name);
    if (!suite) throw new Error(`Unknown suite "${name}". Known suites: ${known.join(", ")}`);
    if (!suite.run)
      throw new Error(
        `Suite "${name}" is not implemented yet (owner ${suite.owner}); it must not be reported as a pass`,
      );
    selected.push(suite);
  }
  return selected;
}

export async function prepareEvidenceDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}
