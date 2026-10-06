const defaults = Object.freeze({ alert: "info", confirm: "question", prompt: "input" });
const definitions = Object.freeze({
  info: { label: "情報", paths: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M12 11v6", "M12 7v.1"] },
  success: { label: "成功", paths: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "m8 12 3 3 5-6"] },
  warning: { label: "警告", paths: ["M12 3 2 21h20L12 3Z", "M12 9v5", "M12 17v.1"] },
  error: {
    label: "エラー",
    paths: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "m9 9 6 6", "m15 9-6 6"],
  },
  question: {
    label: "確認",
    paths: [
      "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
      "M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2",
      "M12 17v.1",
    ],
  },
  input: { label: "入力", paths: ["M13 5H4v15h15v-9", "m10 14 1-4 8-8 3 3-8 8-4 1Z", "m17 4 3 3"] },
});
const bytes = (value) => new TextEncoder().encode(value).length;

// URL resolution belongs to the host: relative icons use the downloaded screen URL.
export function resolveDialogIcon(icon, operation, baseUrl) {
  icon ??= defaults[operation];
  if (typeof icon === "string") {
    if (icon === "none" || Object.hasOwn(definitions, icon)) return icon;
    throw new Error("未対応のダイアログアイコンです");
  }
  if (!icon || typeof icon !== "object" || Array.isArray(icon))
    throw new Error("ダイアログアイコンの指定が不正です");
  const alt = icon.alt ?? "";
  if (typeof alt !== "string" || bytes(alt) > 160)
    throw new Error("アイコンのaltは160 UTF-8バイト以内で指定してください");
  if (Object.hasOwn(icon, "text") && Object.keys(icon).every((k) => ["text", "alt"].includes(k))) {
    if (typeof icon.text !== "string" || !icon.text.trim() || bytes(icon.text) > 64)
      throw new Error("アイコンの文字は1〜64 UTF-8バイトで指定してください");
    return { text: icon.text, alt };
  }
  if (Object.hasOwn(icon, "src") && Object.keys(icon).every((k) => ["src", "alt"].includes(k))) {
    if (
      typeof icon.src !== "string" ||
      !icon.src ||
      bytes(icon.src) > 2048 ||
      [...icon.src].some((c) => {
        const point = c.codePointAt(0);
        return c === "\\" || /\s/u.test(c) || point < 32 || (point >= 127 && point <= 159);
      })
    )
      throw new Error("アイコンの画像URLが不正です");
    const url = new URL(icon.src, baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("アイコンの画像は資格情報を含まないHTTP/HTTPS URLで指定してください");
    return { src: url.href, alt };
  }
  throw new Error("ダイアログアイコンにはtextかsrcを指定してください");
}

function builtin(doc, name) {
  const root = doc.createElement("span");
  root.className = "ui-dialog-icon";
  root.dataset.icon = name;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", definitions[name].label);
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of definitions[name].paths) {
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  root.append(svg);
  return root;
}

export function createDialogIcon(doc, icon) {
  if (icon === "none") return null;
  if (typeof icon === "string") return builtin(doc, icon);
  const root = doc.createElement("span");
  root.className = "ui-dialog-icon";
  root.setAttribute("role", "img");
  root.dataset.icon = icon.src ? "image" : "text";
  root.setAttribute("aria-label", icon.alt || icon.text || "カスタムアイコン");
  if (icon.src) {
    const img = doc.createElement("img");
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.referrerPolicy = "no-referrer";
    img.addEventListener(
      "error",
      () => {
        if (!root.isConnected) return;
        const fallback = builtin(doc, "info");
        root.replaceChildren(...fallback.childNodes);
        root.dataset.icon = "info";
        root.setAttribute(
          "aria-label",
          `${icon.alt || "カスタムアイコン"}（画像を表示できません）`,
        );
      },
      { once: true },
    );
    img.src = icon.src;
    root.append(img);
  } else root.textContent = icon.text;
  return root;
}

// Canvas owns its bitmap and image lifetime; it does not mount HTML dialog surfaces.
export class CanvasDialogIcons {
  constructor(invalidate) {
    this.invalidate = invalidate;
    this.records = new Map();
  }
  sync(widgets, baseUrl) {
    const keys = new Set();
    for (const widget of widgets.filter((w) => w.kind === "dialog-icon")) {
      keys.add(widget.key);
      const signature = JSON.stringify([widget.config, baseUrl]);
      if (this.records.get(widget.key)?.signature === signature) continue;
      let icon;
      try {
        icon = resolveDialogIcon(widget.config.icon, widget.config.operation, baseUrl);
      } catch {
        icon = "info";
      }
      const record = { signature, icon };
      this.records.set(widget.key, record);
      if (icon.src) {
        const img = document.createElement("img");
        img.referrerPolicy = "no-referrer";
        record.image = img;
        const refresh = () => {
          if (this.records.get(widget.key) === record) this.invalidate();
        };
        img.onload = refresh;
        img.onerror = refresh;
        img.src = icon.src;
      }
    }
    for (const key of this.records.keys()) if (!keys.has(key)) this.records.delete(key);
  }
  paint(ctx, widget, colors, fonts) {
    const record = this.records.get(widget.key);
    let icon = record?.icon ?? "info";
    const { x, y, width, height } = widget;
    if (icon === "none") return;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    if (icon.src) {
      const img = record.image;
      if (img.complete && img.naturalWidth) {
        const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
        ctx.drawImage(
          img,
          x + (width - img.naturalWidth * scale) / 2,
          y + (height - img.naturalHeight * scale) / 2,
          img.naturalWidth * scale,
          img.naturalHeight * scale,
        );
        return;
      }
      icon = "info";
    }
    const color =
      { success: colors.successText, warning: colors.warningText, error: colors.text }[icon] ??
      colors.infoText;
    if (icon.text) {
      ctx.fillStyle = colors.infoText;
      // The icon size and family come from the per-frame resolution, like every other
      // painted role. No maxWidth: the DOM icon is `overflow: hidden` at the same size, so
      // a wide character is clipped on both surfaces. Passing the box width here would
      // condense the glyphs instead and paint them smaller than the DOM's.
      ctx.font = fonts.font("icon");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(icon.text, x + width / 2, y + height / 2);
      return;
    }
    ctx.translate(x, y);
    ctx.scale(width / 24, height / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of definitions[icon].paths) ctx.stroke(new Path2D(path));
  }
  reset() {
    this.records.clear();
  }
}
