// Browser-side observation for the renderer font-size ledger, with no dependency on
// `src/`. Everything here only reads: no font declaration is added, no painted pixel is
// replaced. The Canvas side is recorded by the init script installed from
// tests/browser/font-parity.mjs, which delegates to the original fillText / measureText.
//
// This file is deliberately import-free so the distribution suite can serve it next to
// the generated runtime-dist / app-dist artifacts and measure *those* without pulling
// src/runtime.js or src/runtime.css into the page. tests/browser/font-parity-harness.js
// re-exports every function below under the same name, so the suites that measure the
// repository's own sources call them exactly as before.

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

// Generated content is text a component shows without an element of its own (the Kanban
// card id, the media notice), so the per-widget comparison has to measure it beside the
// real text nodes. Only a literal string counts: url() and counter() contents are not
// something a Canvas draw can be equal to.
function pseudoText(style) {
  const content = style.content;
  if (!content || content === "none" || content === "normal") return "";
  if (!/^"(?:[^"\\]|\\.)*"$/.test(content)) return "";
  return content.slice(1, -1).replace(/\\(.)/g, "$1").trim();
}

function metrics(element, stage, part, text, pseudo = null) {
  const style = getComputedStyle(element, pseudo ?? undefined);
  const rect = element.getBoundingClientRect();
  const origin = stage.getBoundingClientRect();
  const widget = widgetOf(element);
  return {
    surface: "dom",
    pseudo,
    selector: pseudo ? `${cssPath(element, stage)}${pseudo}` : cssPath(element, stage),
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
    // Whether this string is the one the component is *showing*. A control keeps a value
    // and a placeholder at the same time, a tick has a value that is never text, and a
    // closed dropdown shows one of its options; counting all of them as shown text would
    // invent slots no renderer paints. Overridden by the caller where it is not plain text.
    displayed: true,
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

// Controls whose `value` is never characters on screen: a tick, a dot, a thumb, a swatch,
// a file picker. Their value is still recorded, with `displayed: false`.
const VALUELESS_INPUT_TYPES = new Set(["checkbox", "radio", "range", "color", "file"]);

// Every DOM node that shows characters, including native control values, placeholders,
// select options and generated content. Duplicate strings stay distinguishable through
// selector/key/role.
//
// The walk is recursive rather than a flat querySelectorAll sweep so the records come back
// in the order the characters appear: `::before`, the element's own text, its descendants,
// then `::after`. That order is what lets a Canvas draw be paired with the DOM node of the
// same slot — the Kanban card id is an `::after` *below* the card's title and detail, and a
// parent-before-children sweep would put it first.
export function observeDom(stage, label) {
  const records = [];
  const push = (element, part, text, pseudo = null, extra = null) =>
    records.push({ stage: label, ...metrics(element, stage, part, text, pseudo), ...extra });
  const visit = (element) => {
    const before = pseudoText(getComputedStyle(element, "::before"));
    if (before) push(element, "::before", before, "::before");
    const text = directText(element);
    if (text) push(element, "text", text);
    const tag = element.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const showsValue = !VALUELESS_INPUT_TYPES.has(element.type);
      if (element.value) push(element, "value", element.value, null, { displayed: showsValue });
      if (element.placeholder)
        push(element, "placeholder", element.placeholder, null, {
          displayed: showsValue && element.value === "",
        });
    }
    // An expanded list box lays every option out as its own element, which the recursion
    // below measures; a closed dropdown shows only the chosen option's text, and it shows
    // it in the select's own box, which is why the option is measured on the select.
    if (tag === "SELECT") {
      const expanded = element.multiple || element.size > 1;
      for (const option of element.options)
        push(element, `option[${option.index}]`, option.textContent ?? "", null, {
          selected: option.selected,
          displayed: !expanded && option.selected,
        });
    }
    for (const child of element.children) visit(child);
    const after = pseudoText(getComputedStyle(element, "::after"));
    if (after) push(element, "::after", after, "::after");
  };
  visit(stage);
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

// Every native control a stage mounts, with the box it is sitting in. The DOM stage lays
// its controls out inside the field widget; the Canvas stage positions the editing overlay
// by hand from the Scene box. A width, a ratio or a zoom change that moves one of them off
// its widget shows up here as a number instead of only in a screenshot.
export function controlBoxes(stage, label) {
  const origin = stage.getBoundingClientRect();
  return [...stage.querySelectorAll("input, select, textarea")]
    .filter(
      (element) => element.closest(".ui-field") || element.classList.contains("canvas-editor"),
    )
    .map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const widget = widgetOf(element);
      return {
        surface: label,
        // The Canvas overlay has no widget ancestor, so it carries no key: the caller knows
        // which field it opened and matches it against that widget.
        overlay: element.classList.contains("canvas-editor"),
        gridEditor:
          element.closest(".grid-editor") !== null || element.classList.contains("grid-editor"),
        key: widget.key,
        target: widget.target,
        tag: element.tagName.toLowerCase(),
        type: element.type ?? null,
        fontSize: Number.parseFloat(style.fontSize),
        visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0,
        x: rect.x - origin.x,
        y: rect.y - origin.y,
        width: rect.width,
        height: rect.height,
        // What the renderer wrote, kept apart from what the layout produced.
        styleLeft: Number.parseFloat(element.style.left),
        styleTop: Number.parseFloat(element.style.top),
        styleWidth: Number.parseFloat(element.style.width),
        styleHeight: Number.parseFloat(element.style.height),
      };
    });
}

// The laid-out width of DOM text, measured with a Range so it is the text's own advance
// rather than the box the layout handed it: this is the DOM half of "the font changed and
// both surfaces were measured again".
export function textInk(stage, selectors) {
  return selectors.map((selector) => {
    const element = stage.querySelector(selector);
    if (!element)
      return {
        selector,
        found: false,
        text: null,
        width: null,
        scrollWidth: null,
        clientWidth: null,
        lineCount: 0,
      };
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
      // The box the text was given. `text-overflow: ellipsis` is a paint-time effect, so
      // the advance width above keeps its full value and only the comparison with this
      // tells "fits" and "was cut" apart.
      clientWidth: element.clientWidth,
      lineCount,
      fontSize: Number.parseFloat(style.fontSize),
      fontFamily: style.fontFamily,
    };
  });
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
