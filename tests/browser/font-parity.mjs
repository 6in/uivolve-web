import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  const owners = scaled ? SURFACE_KINDS : TEXT_PAINTING_KINDS;
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
  const candidates = named.length ? named : inside;
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

async function instrument(context, url, viewport) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(canvasRecorder);
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
    screen: "screens/uivolve-gallery.json",
    cases: "single",
    steps: [{ surface: "dom", selector: '.ui-button[data-target="showToast"]' }],
  },
  // Charts reach the shared surface sprites, whose sizes T5 owns: the case is here so the
  // exemption is backed by measured draws instead of only being declared.
  {
    name: "gallery-chart",
    screen: "screens/uivolve-gallery.json",
    cases: "single",
    steps: [{ surface: "dom", selector: ".ui-tab:nth-of-type(3)" }],
  },
  {
    name: "dialogs",
    screen: "screens/dialogs.yaml",
    cases: "single",
    steps: [{ surface: "dom", selector: '.ui-button[data-target="showAlert"]' }],
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
          if (step.surface === "dom") await harness.clickDom(step.selector);
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
    (contract) => window.__fontParityHarness.roles(contract),
    roleSpecs(),
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
  // Fields paint their label and their value. T4 narrows the Grid editor to caption.
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

// Canvas text a later task owns. Recorded with the task and the reason instead of dropped,
// so an exemption is visible in the ledger rather than implied by a missing check.
const CANVAS_DEFERRED_KINDS = {
  figure: "T5: figure sprites の内容矩形換算",
  document: "T5: 文書 sprites の内容矩形換算",
  "dialog-icon": "T5: ダイアログ絵文字の 30px と maxWidth",
  image: "T5: media の空/エラー案内を DOM の 12px へ",
  video: "T5: media の空/エラー案内を DOM の 12px へ",
  iframe: "T5: media の空/エラー案内を DOM の 12px へ",
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
];
const CANVAS_COVERAGE_GAPS = {
  fieldset:
    "uivolve-forms の fieldset は collapsible で、タイトルは panel-toggle が描く。本体の描画は" +
    "空文字なので内容では対応付けられない。canvas-renderer では panel と同じ分岐（kind === " +
    '"panel" || kind === "fieldset"）なので panel の実測が同じコードを通る。T7 が kind 単位で閉じる',
};

for (const kind of REQUIRED_CANVAS_KINDS)
  if (!CANVAS_KIND_CONTRACT[kind]) throw new Error(`Required Canvas kind ${kind} has no contract`);
for (const kind of Object.keys(CANVAS_KIND_CONTRACT))
  if (!REQUIRED_CANVAS_KINDS.includes(kind) && !CANVAS_COVERAGE_GAPS[kind])
    throw new Error(`Canvas kind ${kind} is neither required nor recorded as a gap`);

// Used by attribute(): a draw belongs to a kind that paints characters, and a scaled draw
// belongs to the surface that scaled it.
const SURFACE_KINDS = new Set(["figure", "document"]);
const TEXT_PAINTING_KINDS = new Set([
  ...Object.keys(CANVAS_KIND_CONTRACT),
  ...Object.keys(CANVAS_DEFERRED_KINDS),
]);

const sizeRoleOf = (px) =>
  Object.entries(SIZE_CONTRACT).find(([, value]) => value === px)?.[0] ?? null;

// Every Canvas draw of a kind this task owns: its size must be one of that kind's roles,
// it must carry no local scaling, and it must use the family the stage resolved.
function assertCanvasRoles(capture, problems) {
  const where = `${capture.fixture}/${capture.mode}/host ${capture.hostFontSize}`;
  const note = (message) => problems.push(`${where}: canvas ${message}`);
  if (!capture.scene) {
    note("Scene が取得できなかった");
    return { asserted: [], deferred: [] };
  }
  if (!capture.canvasSurface?.draws.length) {
    note("描画が記録されなかった");
    return { asserted: [], deferred: [] };
  }
  const records = canvasRecords(capture.canvasSurface, capture.scene.widgets, capture.fixture);
  const family = capture.resolved.canvas.ok ? capture.resolved.canvas.family : null;
  const asserted = [];
  const deferred = [];
  for (const record of records) {
    if (record.kind && CANVAS_DEFERRED_KINDS[record.kind]) {
      deferred.push({ ...record, reason: CANVAS_DEFERRED_KINDS[record.kind] });
      continue;
    }
    if (!record.kind) {
      note(`"${record.text.slice(0, 18)}" (${record.x},${record.y}) を部品に対応付けられない`);
      continue;
    }
    const allowed = CANVAS_KIND_CONTRACT[record.kind];
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
  return { asserted, deferred, shapes: textShapes(records) };
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
        captures.push({ ...capture, image });
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
  log(
    `${captures.length} cases, ${asserted.length} DOM role samples, ` +
      `${canvasAsserted.length} Canvas draws over ` +
      `${new Set(canvasAsserted.map((record) => record.kind)).size} kinds ` +
      `(${canvasDeferred.length} deferred to T5), ` +
      `shapes ${Object.entries(shapes)
        .map(([name, count]) => `${name}=${count}`)
        .join(" ")}, ` +
      `contexts ${[...new Set(asserted.map((sample) => sample.context))].sort().join("/")}, ` +
      `host page ${bodySizes.join(",")}`,
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

// Every suite named by the plan is registered. Suites a later task owns have no runner
// and must fail loudly: an unimplemented check is never reported as a pass.
export const SUITES = [
  { name: "baseline", owner: "T1", run: runBaseline },
  // T2 covers the DOM declarations, the parent contexts and the shared size source;
  // T3 adds the Canvas draw/measure comparison for the same roles.
  { name: "roles", owner: "T2/T3", run: runRoles },
  { name: "editing", owner: "T4", run: null },
  { name: "surfaces", owner: "T5", run: null },
  { name: "lifecycle", owner: "T6", run: null },
  { name: "matrix", owner: "T8", run: null },
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
