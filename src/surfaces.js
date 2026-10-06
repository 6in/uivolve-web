const svgNS = "http://www.w3.org/2000/svg";
// The one family override the sprites allow, named once so the two surfaces cannot ask
// for different monospace families. Everything else uses the runtime's resolved family.
const monospaceFamily = "monospace";
// Both surfaces read a sprite's size and weight through the same accessor. The engine
// completes a text sprite that omits fontSize with 12 (engine/src/figures.rs), so the
// same value has to be written into the SVG attribute as well: leaving the attribute off
// would make the DOM inherit the host's size while Canvas painted 12px.
const spriteFontSize = (sprite) => sprite.fontSize ?? 12;
const spriteFontWeight = (sprite) => sprite.fontWeight ?? 400;
const color = (value, theme) =>
  theme.colors[value] ||
  { accent: theme.colors.primary, danger: "#b64646" }[value] ||
  value ||
  "none";
function documentSprites(widget) {
  const result = [];
  const width = widget.width;
  let y = widget.text ? 35 : 18;
  if (widget.text)
    result.push({
      type: "text",
      x: 12,
      y: 18,
      text: widget.text,
      fontSize: 14,
      fontWeight: 600,
      fillStyle: "text",
    });
  for (const line of widget.config.lines || []) {
    const size = line.heading ? 16 : 12;
    const limit = Math.max(8, Math.floor((width - 24) / size));
    // Shared wrapping keeps DOM SVG and Canvas text on the same rows.
    let text = line.text || "";
    const chunks = [];
    while (text.length > limit) {
      chunks.push(text.slice(0, limit));
      text = text.slice(limit);
    }
    chunks.push(text);
    for (const chunk of chunks) {
      if (y > widget.height - 8) return result;
      result.push({
        type: "text",
        x: 12,
        y,
        text: chunk,
        fontSize: size,
        fontWeight: line.heading ? 600 : 400,
        fillStyle: line.tone || "text",
        monospace: line.code,
      });
      y += size + 8;
    }
  }
  return result;
}
function surface(widget) {
  return widget.kind === "document"
    ? { viewWidth: widget.width, viewHeight: widget.height, sprites: documentSprites(widget) }
    : widget.config;
}
// The rectangle the sprites are fitted into, shared by both surfaces. The DOM SVG is
// `width/height: 100%` inside the frame declared in src/runtime.css, so its viewport is
// the element's content box; Canvas has no element to inherit that from and insets by the
// same resolved border. Fitting into the full widget box instead would leave the two
// scale factors apart by the border, and every sprite size and position with them.
function contentFit(widget, description, border) {
  const width = Math.max(0, widget.width - border * 2);
  const height = Math.max(0, widget.height - border * 2);
  const scale = Math.min(width / description.viewWidth, height / description.viewHeight);
  return {
    scale,
    x: border + (width - description.viewWidth * scale) / 2,
    y: border + (height - description.viewHeight * scale) / 2,
  };
}
function sectorPath(s) {
  const start = [s.cx + s.r * Math.cos(s.start), s.cy + s.r * Math.sin(s.start)];
  const end = [s.cx + s.r * Math.cos(s.end), s.cy + s.r * Math.sin(s.end)];
  if (s.end - s.start >= Math.PI * 2 - 0.00001)
    return `M ${s.cx - s.r} ${s.cy} a ${s.r} ${s.r} 0 1 0 ${s.r * 2} 0 a ${s.r} ${s.r} 0 1 0 ${-s.r * 2} 0`;
  return `M ${s.cx} ${s.cy} L ${start.join(" ")} A ${s.r} ${s.r} 0 ${s.end - s.start > Math.PI ? 1 : 0} 1 ${end.join(" ")} Z`;
}
export function renderSvg(record, widget, theme) {
  const description = surface(widget);
  const signature = JSON.stringify([description, theme.colors, widget.width]);
  if (record.surfaceSignature === signature) return;
  record.surfaceSignature = signature;
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${description.viewWidth} ${description.viewHeight}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", widget.text || widget.config.format || "内容");
  for (const s of description.sprites) {
    const type = s.type === "sector" ? "path" : s.type;
    const el = document.createElementNS(svgNS, type);
    const attributes = {
      rect: ["x", "y", "width", "height"],
      circle: ["cx", "cy", "r"],
      ellipse: ["cx", "cy", "rx", "ry"],
      text: ["x", "y"],
      path: [],
      line: [],
      polygon: [],
    }[type];
    if (!attributes) continue;
    for (const a of attributes) {
      if (s[a] !== undefined)
        el.setAttribute(
          a.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
          s[a],
        );
    }
    if (type === "rect" && s.radius) el.setAttribute("rx", s.radius);
    if (type === "line") {
      for (const [a, b] of [
        ["x1", "fromX"],
        ["y1", "fromY"],
        ["x2", "toX"],
        ["y2", "toY"],
      ])
        el.setAttribute(a, s[b]);
    }
    if (type === "polygon") el.setAttribute("points", s.points.map((p) => p.join(",")).join(" "));
    if (type === "path") el.setAttribute("d", s.type === "sector" ? sectorPath(s) : s.path || "");
    el.setAttribute("fill", color(s.fillStyle, theme));
    el.setAttribute("stroke", color(s.strokeStyle, theme));
    el.setAttribute("stroke-width", s.lineWidth || 1);
    el.setAttribute("opacity", s.opacity ?? 1);
    if (type === "text") {
      el.textContent = s.text || "";
      el.setAttribute("font-size", spriteFontSize(s));
      el.setAttribute("font-weight", spriteFontWeight(s));
      el.setAttribute("dominant-baseline", "middle");
      el.setAttribute("text-anchor", { center: "middle", right: "end" }[s.textAlign] || "start");
      if (s.monospace) el.style.fontFamily = monospaceFamily;
    }
    svg.append(el);
  }
  record.root.replaceChildren(svg);
}
// `fonts` is the per-frame resolution from src/font-metrics.js: it carries the frame width
// the DOM SVG is inset by and the family the stage resolved, so neither is a number or a
// font name of this module's own.
export function paintSurface(ctx, widget, theme, fonts) {
  const description = surface(widget);
  ctx.save();
  ctx.translate(widget.x, widget.y);
  ctx.beginPath();
  ctx.rect(0, 0, widget.width, widget.height);
  ctx.clip();
  ctx.fillStyle = theme.colors.surface;
  ctx.fillRect(0, 0, widget.width, widget.height);
  const fit = contentFit(widget, description, fonts.surfaceBorder);
  ctx.translate(fit.x, fit.y);
  ctx.scale(fit.scale, fit.scale);
  for (const s of description.sprites) {
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.fillStyle = color(s.fillStyle, theme);
    ctx.strokeStyle = color(s.strokeStyle, theme);
    ctx.lineWidth = s.lineWidth || 1;
    let path;
    try {
      if (s.type === "text" && s.fillStyle !== "none") {
        ctx.font = `${spriteFontWeight(s)} ${spriteFontSize(s)}px ${s.monospace ? monospaceFamily : fonts.family}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = { center: "center", right: "right" }[s.textAlign] || "left";
        ctx.fillText(s.text || "", s.x, s.y);
      } else {
        path = new Path2D();
        if (s.type === "rect")
          path.roundRect(
            s.x || 0,
            s.y || 0,
            Math.max(0, s.width || 0),
            Math.max(0, s.height || 0),
            Math.max(0, s.radius || 0),
          );
        else if (s.type === "circle") path.arc(s.cx, s.cy, Math.max(0, s.r), 0, Math.PI * 2);
        else if (s.type === "ellipse")
          path.ellipse(s.cx, s.cy, Math.max(0, s.rx), Math.max(0, s.ry), 0, 0, Math.PI * 2);
        else if (s.type === "line") {
          path.moveTo(s.fromX, s.fromY);
          path.lineTo(s.toX, s.toY);
        } else if (s.type === "path") path = new Path2D(s.path || "");
        else if (s.type === "sector") {
          path.moveTo(s.cx, s.cy);
          path.arc(s.cx, s.cy, s.r, s.start, s.end);
          path.closePath();
        } else if (s.type === "polygon") {
          s.points.forEach((p, i) => (i ? path.lineTo(...p) : path.moveTo(...p)));
          path.closePath();
        }
        if (s.fillStyle && s.fillStyle !== "none") ctx.fill(path);
        if (s.strokeStyle && s.strokeStyle !== "none") ctx.stroke(path);
      }
    } finally {
      ctx.restore();
    }
  }
  ctx.restore();
}
export const mediaKinds = ["image", "video", "iframe"];
export function syncMedia(record, widget, assetBase, onLoad = () => {}) {
  const c = widget.config;
  const src = c.src ? new URL(c.src, assetBase).href : "";
  if (!record.media) {
    const tag = widget.kind === "image" ? "img" : widget.kind;
    const el = document.createElement(tag);
    record.media = el;
    el.className = "native-media";
    if (widget.kind === "iframe") {
      el.setAttribute("sandbox", "");
      el.setAttribute("referrerpolicy", "no-referrer");
    }
    if (widget.kind === "image") {
      el.addEventListener("load", onLoad);
      el.addEventListener("error", () => {
        record.root.dataset.mediaError = "true";
        onLoad();
      });
    }
    record.root.append(el);
  }
  const el = record.media;
  record.root.dataset.mediaKind = widget.kind;
  record.root.setAttribute("aria-label", widget.text || c.alt || widget.kind);
  if (record.mediaSource !== src) {
    record.mediaSource = src;
    delete record.root.dataset.mediaError;
    if (src) el.src = src;
    else el.removeAttribute("src");
  }
  el.hidden = !src;
  record.root.dataset.empty = String(!src);
  if (widget.kind === "image") el.alt = c.alt || widget.text;
  else if (widget.kind === "iframe") el.title = widget.text || "埋め込みページ";
  else {
    el.controls = c.controls;
    el.muted = c.muted;
    el.loop = c.loop;
    el.autoplay = c.autoplay;
    el.preload = "metadata";
    el.playsInline = true;
    el.poster = c.poster ? new URL(c.poster, assetBase).href : "";
  }
  record.root.inert = widget.disabled;
}
export function disposeMedia(record) {
  if (record.media?.tagName === "VIDEO") {
    record.media.pause();
    record.media.removeAttribute("src");
    record.media.load();
  }
  record.root.remove();
}
