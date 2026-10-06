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
function attribute(draw, widgets) {
  const point = toCss(draw);
  const candidates = widgets.filter(
    (widget) =>
      point.x >= widget.x - 1 &&
      point.x <= widget.x + widget.width + 1 &&
      point.y >= widget.y - 1 &&
      point.y <= widget.y + widget.height + 1,
  );
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

// Every suite named by the plan is registered. Suites a later task owns have no runner
// and must fail loudly: an unimplemented check is never reported as a pass.
export const SUITES = [
  { name: "baseline", owner: "T1", run: runBaseline },
  { name: "roles", owner: "T2/T3", run: null },
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
