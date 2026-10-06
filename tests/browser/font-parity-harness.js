// The runtime-backed half of the browser-side observation. The pure DOM and Canvas
// readers live in ./font-parity-observe.js — that file imports nothing — so the
// distribution suite can serve it beside the generated artifacts and measure those
// instead of `src/`. They are re-exported here under the same names, so every suite that
// measures this repository's own sources calls them exactly as before.
import { createRuntime } from "../../src/runtime.js";
import { resolveFontMetrics, FONT_ROLES, FONT_SIZE_PROPERTIES } from "../../src/font-metrics.js";
import {
  controlBoxes,
  dialogIconSurfaces,
  environment,
  fontEvidence,
  hostFrame,
  measureRoles,
  mediaNotices,
  observeDom,
  surfaceSprites,
  textInk,
} from "./font-parity-observe.js";

export {
  contextOf,
  controlBoxes,
  dialogIconSurfaces,
  environment,
  fontEvidence,
  hostFrame,
  measureRoles,
  mediaNotices,
  observeDom,
  surfaceSprites,
  textInk,
} from "./font-parity-observe.js";

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

// The stage states a host can put a surface in, as a fixture. A Canvas stage that is not in
// the document, or one whose runtime stylesheet is gone, has no computed style to take its
// sizes from — so what this exists to show is that the rest of the runtime keeps going: the
// load settles, the effects run, the other surface gets the committed state, and the frame
// that cannot be drawn is skipped (and, when the sizes are merely broken, reported).
//
// Everything below drives the host's own code. The single instrument is the effect counter:
// whether the effect pass ran at all is exactly what a throwing paint used to take away, and
// no screen state can report its own absence.
export async function createStageStateHarness({
  order = "dom-first",
  attached = true,
  hostFontSize = "16px",
  host = document.getElementById("font-parity-host"),
} = {}) {
  host.textContent = "";
  host.style.fontSize = hostFontSize;
  const domStage = document.createElement("div");
  const canvasStage = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.id = "font-parity-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "UI Canvas");
  canvasStage.append(canvas);
  host.append(domStage);
  // The one difference from createFontParityHarness(): a host is allowed to build its stage
  // before mounting it, so the Canvas stage can start outside the document.
  if (attached) host.append(canvasStage);
  const errors = [];
  const counts = { effects: 0, load: 0 };
  const domSurface = { element: domStage, renderer: "dom" };
  const canvasSurface = { element: canvasStage, canvas, renderer: "canvas" };
  const runtime = await createRuntime({
    baseUrl: new URL("/", location.origin),
    wasmUrl: new URL("/engine.wasm", location.origin),
    surfaces: order === "dom-first" ? [domSurface, canvasSurface] : [canvasSurface, domSurface],
    onError: (error) => {
      if (error) errors.push(error.message);
    },
    onLoad: () => counts.load++,
  });
  const runEffects = runtime.runEffects.bind(runtime);
  runtime.runEffects = (effects) => {
    counts.effects++;
    return runEffects(effects);
  };
  let detachedSheets = [];
  const api = {
    runtime,
    errors,
    counts,
    host,
    domStage,
    canvasStage,
    canvas,
    async afterFrame() {
      await runtime.whenIdle();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    },
    // Reported rather than thrown: whether the load settled is the first thing each case asks.
    async loadScreen(screen) {
      try {
        await runtime.load(screen);
        await runtime.whenIdle();
        await this.afterFrame();
        return { settled: "resolved", error: null };
      } catch (error) {
        return { settled: "rejected", error: error.message };
      }
    },
    async attachCanvasStage() {
      host.append(canvasStage);
      await this.afterFrame();
    },
    async detachCanvasStage() {
      canvasStage.remove();
      await this.afterFrame();
    },
    async setCanvasStageDisplay(value) {
      canvasStage.style.display = value;
      await this.afterFrame();
    },
    // Remove the runtime's own stylesheet from the document the way a broken embedding would
    // (the nodes are kept so the next case starts from a working page again).
    async removeSizeStylesheets() {
      const property = FONT_SIZE_PROPERTIES.body;
      detachedSheets = [];
      // A snapshot on purpose: removing an owner node takes its sheet out of the live list.
      const sheets = [...document.styleSheets];
      for (const sheet of sheets) {
        let declares = false;
        try {
          declares = [...sheet.cssRules].some((rule) => rule.cssText.includes(property));
        } catch {
          // A stylesheet whose rules cannot be read is not one of ours.
          continue;
        }
        const node = sheet.ownerNode;
        if (!declares || !node) continue;
        detachedSheets.push({ node, parent: node.parentNode, next: node.nextSibling });
        node.remove();
      }
      await this.afterFrame();
      return detachedSheets.length;
    },
    async restoreSizeStylesheets() {
      for (const entry of detachedSheets.reverse())
        entry.parent.insertBefore(entry.node, entry.next);
      detachedSheets = [];
      await this.afterFrame();
    },
    // The other half of row 3: the stylesheet is there, but one role is declared as something
    // that is not a px length. Set on the stage itself, so only this surface loses its sizes.
    async declareRole(role, value) {
      canvasStage.style.setProperty(FONT_SIZE_PROPERTIES[role], value);
      await this.afterFrame();
      return { role, property: FONT_SIZE_PROPERTIES[role], value };
    },
    async clearRole(role) {
      canvasStage.style.removeProperty(FONT_SIZE_PROPERTIES[role]);
      await this.afterFrame();
    },
    async clickDom(selector) {
      const node = domStage.querySelector(selector);
      if (!node) throw new Error(`DOM側に ${selector} に一致する部品がありません`);
      node.click();
      await this.afterFrame();
    },
    // --- repaints that carry no Scene ------------------------------------------------
    // Each one lands in CanvasRenderer.paint() without going through UiRuntime.render(), so
    // an exception here would escape into an event handler instead of into a caller.
    async focusCanvas() {
      canvas.focus();
      await this.afterFrame();
    },
    async blurCanvas() {
      canvas.blur();
      await this.afterFrame();
    },
    // The real font set, with the completion delivered by hand: the browser only fires it when
    // a face actually settles, and these cases are about the state the stage is in, not about
    // the font. Same substitution as the ratio change below (see the ledger's limits).
    async fireFontsDone() {
      document.fonts.dispatchEvent(new Event("loadingdone"));
      await this.afterFrame();
    },
    async fireRatioChange() {
      const media = `(resolution: ${window.devicePixelRatio || 1}dppx)`;
      const fired = window.__fontParityMedia?.fire(media) ?? null;
      await this.afterFrame();
      return fired;
    },
    resetFrames() {
      window.__fontParity?.reset();
    },
    // What the Canvas actually put on its bitmap since the last resetFrames(), plus the state
    // the other surface is showing and the numbers a frame would have been painted from.
    probe() {
      const frame = window.__fontParity?.forCanvas(canvas) ?? null;
      return {
        revision: runtime.revision,
        errors: [...errors],
        counts: { ...counts },
        screen: runtime.screen?.id ?? null,
        domText: domStage.innerText.replace(/\s+/g, " ").trim(),
        domChildren: domStage.childElementCount,
        canvasConnected: canvasStage.isConnected,
        canvasDisplay: canvasStage.isConnected ? getComputedStyle(canvasStage).display : null,
        canvasDraws: frame?.draws.length ?? 0,
        canvasTexts: (frame?.draws ?? []).map((draw) => draw.text),
        bitmap: { width: canvas.width, height: canvas.height },
        scenes: runtime.scenes.map((scene) => ({ width: scene.width, height: scene.height })),
        resolved: { dom: resolvedMetrics(domStage), canvas: resolvedMetrics(canvasStage) },
        mediaNotices: { dom: mediaNotices(domStage), canvas: mediaNotices(canvasStage) },
      };
    },
    dispose() {
      runtime.dispose();
      host.textContent = "";
      host.style.removeProperty("font-size");
      host.style.removeProperty("width");
    },
  };
  return api;
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
    // The lifecycle probe plus the native control boxes and the DOM Scene: the width /
    // ratio / zoom / theme matrix has to show that no condition moves a declared size and
    // that no input leaves the widget box the engine laid out for it.
    matrix(probe) {
      return {
        ...this.lifecycle(probe),
        // The text-node sweep travels with every matrix case too: a width, a ratio or a
        // theme must not move a size on one surface without moving it on the other, and
        // that is a per-component comparison, not a per-surface one.
        domText: { dom: observeDom(domStage, "dom") },
        domScene: sceneRecord(runtime.scenes[0]),
        controls: [...controlBoxes(domStage, "dom"), ...controlBoxes(canvasStage, "canvas")],
        hostFrame: hostFrame(host),
      };
    },
    // Both sides of a width boundary, as numbers. The DOM clips with `text-overflow`, which
    // leaves the text's own advance width intact, so "was it cut" is the advance against the
    // box it was given — not something a screenshot has to be trusted for. The Scene value is
    // carried along because the Canvas side has to be compared with the full string.
    boundaryText(targets) {
      const widgets = sceneRecord(runtime.scenes[1])?.widgets ?? [];
      return targets.map((spec) => {
        const widget = widgets.find((entry) => entry.target === spec.target) ?? null;
        return {
          target: spec.target,
          key: widget?.key ?? null,
          value: widget?.value ?? null,
          ...textInk(domStage, [`[data-target="${spec.target}"] ${spec.valuePart}`])[0],
        };
      });
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
      //
      // `domText` is the full text-node sweep of both stages — children and generated
      // content included — which is what the per-widget comparison pairs the Canvas draws
      // against. The hand-written selector table (`specs`) is kept beside it: it names the
      // roles that must exist, while the sweep is what notices a node nobody named.
      const domText = {
        dom: observeDom(domStage, "dom"),
        canvasStage: observeDom(canvasStage, "canvas-stage"),
      };
      return {
        dom: measureRoles(domStage, specs),
        canvasStage: measureRoles(canvasStage, specs),
        domText,
        textFreeViolations: [...domText.dom, ...domText.canvasStage]
          .filter((record) => noText.includes(record.kind))
          .map(({ selector, kind, text, part, stage: where }) => ({
            stage: where,
            selector,
            kind,
            part,
            text,
          })),
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
