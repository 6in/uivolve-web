import { applyTheme } from "./theme.js";
import { createControl, syncControl, isField, isBox, isEditor } from "./field-control.js";
import { paintSurface, syncMedia, mediaKinds, disposeMedia } from "./surfaces.js";

const FONT = '"Inter", "Noto Sans JP", system-ui, sans-serif';
const interactive = (w) =>
  (isField(w) ||
    [
      "button",
      "extra-button",
      "row",
      "panel-toggle",
      "window-close",
      "tab",
      "tree-node",
      "tree-toggle",
      "menu-trigger",
      "menu-item",
      "grid-column",
      "grid-cell",
      "grid-select",
      "grid-page",
    ].includes(w.kind)) &&
  !w.disabled;

export class CanvasRenderer {
  constructor(stage, canvas, dispatch) {
    this.stage = stage;
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    if (!this.context) throw new Error("Canvas 2Dを利用できません");
    this.dispatch = dispatch;
    this.scene = null;
    this.focusKey = null;
    this.editor = null;
    this.media = new Map();
    this.returnFocus = new Map();
    this.events = new AbortController();
    const options = { signal: this.events.signal };
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.scene) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) * this.scene.width) / rect.width;
        const y = ((event.clientY - rect.top) * this.scene.height) / rect.height;
        const hit = [...this.scene.widgets]
          .reverse()
          .find(
            (w) =>
              interactive(w) && x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height,
          );
        if (this.scene.popup && hit?.config.menu !== this.scene.popup.target)
          this.dispatch(this.scene.popup.target, { action: "close" });
        if (hit) {
          // Keep browser pointer focus from immediately stealing focus from the IME input overlay.
          event.preventDefault();
          this.activate(hit);
          if (hit.kind === "slider") {
            this.dragKey = hit.key;
            canvas.setPointerCapture(event.pointerId);
            this.slide(hit, x);
          }
        } else {
          if (this.scene.modal) {
            event.preventDefault();
            return;
          }
          this.closeEditor();
          canvas.focus();
          if (!this.scene.modal) this.focusKey = null;
          this.paint();
        }
      },
      options,
    );
    canvas.addEventListener(
      "dblclick",
      (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) * this.scene.width) / rect.width;
        const y = ((event.clientY - rect.top) * this.scene.height) / rect.height;
        const cell = this.scene.widgets.find(
          (w) =>
            w.kind === "grid-cell" &&
            !w.disabled &&
            w.config.editable &&
            x >= w.x &&
            x < w.x + w.width &&
            y >= w.y &&
            y < w.y + w.height,
        );
        if (cell) this.editCell(cell);
      },
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (!this.scene) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) * this.scene.width) / rect.width;
        const y = ((event.clientY - rect.top) * this.scene.height) / rect.height;
        if (this.dragKey) {
          const slider = this.scene.widgets.find((w) => w.key === this.dragKey && interactive(w));
          if (slider) this.slide(slider, x);
          return;
        }
        const hit = this.scene.widgets.find(
          (w) => interactive(w) && x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height,
        );
        canvas.style.cursor = hit ? (isEditor(hit) ? "text" : "pointer") : "default";
      },
      options,
    );
    canvas.addEventListener(
      "lostpointercapture",
      () => {
        this.dragKey = null;
      },
      options,
    );
    canvas.addEventListener(
      "pointerup",
      () => {
        this.dragKey = null;
      },
      options,
    );
    canvas.addEventListener(
      "keydown",
      (event) => {
        if (!this.scene) return;
        const current = this.scene.widgets.find((w) => w.key === this.focusKey);
        if (this.scene.popup && event.key === "Escape") {
          event.preventDefault();
          this.dispatch(this.scene.popup.target, { action: "close" });
          return;
        }
        if (current?.config.gridEditor && ["Enter", "Escape"].includes(event.key)) {
          event.preventDefault();
          this.dispatch(current.target, {
            action: event.key === "Escape" ? "cancelEdit" : "commitEdit",
          });
          return;
        }
        if (
          current?.kind === "grid-cell" &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
        ) {
          event.preventDefault();
          const cells = this.scene.widgets.filter(
            (w) => w.kind === "grid-cell" && w.target === current.target && !w.disabled,
          );
          const columns = new Set(cells.map((w) => w.payload.column)).size;
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[
            event.key
          ];
          const next = cells[cells.indexOf(current) + delta];
          if (next) this.focus(next);
          return;
        }
        if (
          current?.kind === "tab" &&
          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const tabs = this.scene.widgets.filter(
            (w) => w.kind === "tab" && w.target === current.target && !w.disabled,
          );
          const i =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (tabs.indexOf(current) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                  tabs.length;
          if (tabs[i]) this.activate(tabs[i]);
          return;
        }
        if (current?.kind === "menu-item" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const items = this.scene.widgets.filter((w) => w.kind === "menu-item" && !w.disabled);
          const i =
            (items.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
          if (items[i]) this.focus(items[i]);
          return;
        }
        if (current?.kind === "menu-trigger" && event.key === "ArrowDown") {
          event.preventDefault();
          if (!current.selected) this.activate(current);
          else {
            const first = this.scene.widgets.find((w) => w.kind === "menu-item" && !w.disabled);
            if (first) this.focus(first);
          }
          return;
        }
        if (
          current?.kind === "grid-cell" &&
          current.config.editable &&
          ["Enter", "F2"].includes(event.key)
        ) {
          event.preventDefault();
          this.editCell(current);
          return;
        }
        const slider = this.scene.widgets.find(
          (w) => w.key === this.focusKey && w.kind === "slider" && interactive(w),
        );
        if (
          slider &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const min = slider.config.min ?? 0;
          const max = slider.config.max ?? 100;
          const n =
            event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : Number(slider.value) +
                  (slider.config.step || 1) *
                    (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1);
          this.dispatch(slider.target, { value: Math.min(max, Math.max(min, n)) });
          return;
        }
        if (event.key === "Tab") {
          const target = this.nextFocus(event.shiftKey ? -1 : 1);
          if (target) {
            event.preventDefault();
            this.focus(target);
          }
        } else if (event.key === "Escape" && this.scene.modal) {
          event.preventDefault();
          this.dispatch(this.scene.modal.target, { action: "close" });
        } else if (event.key === "Enter" || event.key === " ") {
          const target = this.scene.widgets.find((w) => w.key === this.focusKey);
          if (target) {
            event.preventDefault();
            this.activate(target);
          }
        }
      },
      options,
    );
    canvas.addEventListener("focus", () => this.paint(), options);
    canvas.addEventListener("blur", () => this.paint(), options);
  }

  nextFocus(direction) {
    const controls = this.scene.widgets.filter(interactive);
    const current = controls.findIndex((w) => w.key === this.focusKey);
    const next = current < 0 ? (direction > 0 ? 0 : controls.length - 1) : current + direction;
    if ((next < 0 || next >= controls.length) && this.scene.modal) {
      return controls[(next + controls.length) % controls.length];
    }
    if (next < 0 || next >= controls.length) {
      this.focusKey = null;
      this.paint();
      return null;
    }
    return controls[next];
  }

  focus(widget) {
    this.focusKey = widget.key;
    if (isEditor(widget)) this.openEditor(widget);
    else {
      this.closeEditor();
      this.canvas.focus();
      this.paint();
    }
  }

  activate(widget) {
    this.focus(widget);
    if (isBox(widget))
      this.dispatch(widget.target, {
        ...widget.payload,
        value: widget.kind === "checkbox" ? !widget.config.checked : widget.config.inputValue,
      });
    else if (!isField(widget)) this.dispatch(widget.target, widget.payload);
  }

  slide(widget, x) {
    const min = widget.config.min ?? 0;
    const max = widget.config.max ?? 100;
    const fraction = Math.max(0, Math.min(1, (x - widget.x - 10) / Math.max(1, widget.width - 20)));
    this.dispatch(widget.target, { value: min + fraction * (max - min) });
  }

  editCell(widget) {
    this.focusKey = widget.key;
    this.dispatch(widget.target, { ...widget.payload, action: "beginEdit" });
    const editor = this.scene.widgets.find((w) => w.key === widget.key);
    if (editor?.config.gridEditor) this.focus(editor);
  }

  openEditor(widget) {
    if (this.editor?.key === widget.key) {
      this.editor.input.focus();
      return;
    }
    this.closeEditor();
    const record = createControl(widget, this.dispatch, "canvas");
    const { input } = record;
    input.className = "canvas-editor";
    record.key = widget.key;
    input.addEventListener("keydown", (event) => {
      if (record.composing || event.isComposing || event.keyCode === 229) return;
      if (record.widget.config.gridEditor && ["Enter", "Escape", "Tab"].includes(event.key)) {
        event.preventDefault();
        const ok = this.dispatch(record.widget.target, {
          action: event.key === "Escape" ? "cancelEdit" : "commitEdit",
        });
        if (ok !== false) {
          this.closeEditor();
          this.canvas.focus();
          this.paint();
        }
        return;
      }
      if (event.key === "Escape" && this.scene.modal) {
        event.preventDefault();
        this.dispatch(this.scene.modal.target, { action: "close" });
      } else if (event.key === "Escape" || (event.key === "Enter" && widget.kind !== "textarea")) {
        event.preventDefault();
        this.closeEditor();
        this.canvas.focus();
        this.paint();
      }
      if (event.key === "Tab") {
        const next = this.nextFocus(event.shiftKey ? -1 : 1);
        if (next) {
          event.preventDefault();
          this.focus(next);
        } else {
          this.closeEditor();
          this.canvas.focus();
        }
      }
    });
    input.addEventListener("blur", () => {
      if (this.editor === record) {
        this.editor = null;
        input.remove();
        this.paint();
      }
    });
    this.editor = record;
    this.stage.append(input);
    this.positionEditor(widget);
    input.focus();
    if (widget.config.gridEditor && ["textfield", "numberfield"].includes(widget.kind))
      input.select();
  }

  positionEditor(widget) {
    Object.assign(this.editor.input.style, {
      left: `${widget.x}px`,
      top: `${widget.y + widget.config.labelHeight}px`,
      width: `${widget.width}px`,
      height: `${widget.height - widget.config.labelHeight}px`,
    });
  }

  closeEditor() {
    const editor = this.editor;
    this.editor = null;
    editor?.input.remove();
  }

  render(scene) {
    applyTheme(this.stage, scene.theme);
    const ownsFocus = this.stage.contains(document.activeElement);
    const oldModal = this.scene?.modal;
    const oldPopup = this.scene?.popup;
    const changedModal = oldModal?.key !== scene.modal?.key;
    if (changedModal && scene.modal && ownsFocus && !this.returnFocus.has(scene.modal.key)) {
      this.returnFocus.set(scene.modal.key, this.focusKey);
    }
    this.scene = scene;
    const mediaKeys = new Set();
    for (const w of scene.widgets.filter((widget) => mediaKinds.includes(widget.kind))) {
      mediaKeys.add(w.key);
      let record = this.media.get(w.key);
      if (record && record.kind !== w.kind) {
        disposeMedia(record);
        this.media.delete(w.key);
        record = null;
      }
      if (!record) {
        const root = document.createElement("div");
        root.className = "canvas-media";
        record = { root, kind: w.kind };
        this.media.set(w.key, record);
        if (w.kind !== "image") this.stage.append(root);
      }
      syncMedia(record, w, scene.assetBase, () => this.paint());
      // Canvas overlays are painted on the bitmap; keep native surfaces below them.
      record.root.hidden = Boolean(scene.popup || (scene.modal && w.layer !== scene.modal.layer));
      record.root.inert = w.disabled || record.root.hidden;
      Object.assign(record.root.style, {
        left: `${w.x}px`,
        top: `${w.y}px`,
        width: `${w.width}px`,
        height: `${w.height}px`,
        zIndex: String(w.layer * 2 + 1),
      });
    }
    for (const [key, record] of this.media)
      if (!mediaKeys.has(key)) {
        disposeMedia(record);
        this.media.delete(key);
      }
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(scene.width * scale);
    const height = Math.round(scene.height * scale);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.stage.style.height = `${scene.height}px`;
    this.canvas.style.width = `${scene.width}px`;
    this.canvas.style.height = `${scene.height}px`;
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    if (this.editor) {
      const widget = scene.widgets.find((w) => w.key === this.editor.key);
      if (
        !widget ||
        widget.disabled ||
        !isEditor(widget) ||
        widget.kind !== this.editor.widget.kind
      )
        this.closeEditor();
      else {
        this.positionEditor(widget);
        syncControl(this.editor, widget);
      }
    }
    if (!scene.widgets.some((w) => w.key === this.focusKey)) this.focusKey = null;
    if (ownsFocus && oldPopup?.target !== scene.popup?.target) {
      const target = scene.popup
        ? scene.widgets.find((w) => w.kind === "menu-item" && !w.disabled)
        : scene.widgets.find((w) => w.key === oldPopup?.target && !w.disabled);
      if (target) this.focus(target);
    }
    if (changedModal && ownsFocus) {
      const restoreKey = oldModal && this.returnFocus.get(oldModal.key);
      const candidates = [restoreKey, ...[...this.returnFocus.values()].reverse()];
      const restore = candidates
        .map((key) => scene.widgets.find((w) => w.key === key && interactive(w)))
        .find(Boolean);
      const target =
        restore ||
        (scene.modal &&
          (scene.widgets.find((w) => w.kind === "textfield" && interactive(w)) ||
            scene.widgets.find(interactive)));
      if (target) this.focus(target);
      else this.canvas.focus();
    }
    for (const key of this.returnFocus.keys()) {
      if (!scene.widgets.some((w) => w.kind === "window" && w.key === key))
        this.returnFocus.delete(key);
    }
    this.paint();
  }

  box(x, y, width, height, fill, border, radius = 7) {
    const ctx = this.context;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, width - 1, height - 1, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  text(
    text,
    x,
    y,
    width,
    color = this.scene.theme.colors.text,
    size = 13,
    weight = 400,
    family = FONT,
  ) {
    const ctx = this.context;
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    let value = text;
    if (ctx.measureText(value).width > width) {
      while (value.length && ctx.measureText(`${value}…`).width > width) value = value.slice(0, -1);
      value += "…";
    }
    ctx.fillText(value, x, y);
  }

  paint() {
    if (!this.scene) return;
    const ctx = this.context;
    const colors = this.scene.theme.colors;
    ctx.clearRect(0, 0, this.scene.width, this.scene.height);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);
    for (const widget of this.scene.widgets) {
      const { x, y, width, height, kind, text, value } = widget;
      ctx.save();
      if (
        widget.disabled &&
        (isField(widget) || ["button", "row", "panel-toggle", "window-close"].includes(kind))
      )
        ctx.globalAlpha = 0.5;
      if (["figure", "document"].includes(kind)) {
        paintSurface(ctx, widget, this.scene.theme);
      } else if (mediaKinds.includes(kind)) {
        this.box(x, y, width, height, colors.surface, colors.border);
        const record = this.media.get(widget.key);
        if (kind === "image" && record?.media.complete && record.media.naturalWidth) {
          const img = record.media;
          const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
          ctx.drawImage(
            img,
            x + (width - img.naturalWidth * scale) / 2,
            y + (height - img.naturalHeight * scale) / 2,
            img.naturalWidth * scale,
            img.naturalHeight * scale,
          );
        } else if (!widget.config.src || record?.root.dataset.mediaError)
          this.text(widget.text || kind, x + 12, y + height / 2, width - 24, colors.muted);
      } else if (kind === "toast") {
        this.box(x, y, width, height, colors.selected, colors.border);
        text
          .split("\n")
          .forEach((line, i) => this.text(line, x + 12, y + 22 + i * 26, width - 52, colors.text));
      } else if (kind === "toolbar") {
        this.box(x, y, width, height, colors.subtle, colors.border, 4);
      } else if (kind === "separator") {
        ctx.fillStyle = colors.border;
        ctx.fillRect(x + width / 2, y + 5, 1, height - 10);
      } else if (kind === "backdrop") {
        ctx.fillStyle = colors.overlay;
        ctx.fillRect(x, y, width, height);
      } else if (kind === "window") {
        ctx.save();
        ctx.shadowColor = colors.shadow;
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 8;
        this.box(x, y, width, height, colors.background, colors.border, 9);
        ctx.restore();
        this.text(text, x + 14, y + 22, width - 64, colors.text, 12, 600);
      } else if (kind === "panel-toggle") {
        this.text(text, x + 13, y + 21, width - 26, colors.text, 12, 600);
      } else if (kind === "window-close") {
        this.box(x, y, width, height, colors.subtle, null, 6);
        this.text(text, x + 9, y + height / 2, width - 12, colors.muted, 20);
      } else if (kind === "panel" || kind === "fieldset") {
        this.box(x, y, width, height, colors.surface, colors.border);
        this.text(text, x + 14, y + 22, width - 28, colors.text, 12, 600);
      } else if (kind === "grid-shell" || kind === "menu-surface" || kind === "tree-shell") {
        this.box(
          x,
          y,
          width,
          height,
          colors.background,
          colors.border,
          kind === "menu-surface" ? 7 : 0,
        );
        if (kind === "tree-shell")
          this.text(text, x + 10, y + 21, width - 20, colors.muted, 12, 600);
      } else if (["grid-head", "grid-row", "tabbar"].includes(kind)) {
        ctx.fillStyle =
          kind === "grid-row"
            ? widget.selected
              ? colors.selected
              : colors.background
            : colors.subtle;
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = colors.border;
        ctx.beginPath();
        ctx.moveTo(x, y + height - 0.5);
        ctx.lineTo(x + width, y + height - 0.5);
        ctx.stroke();
      } else if (
        [
          "grid-column",
          "grid-cell",
          "grid-select",
          "tab",
          "tree-node",
          "tree-toggle",
          "menu-trigger",
          "menu-item",
          "grid-page",
        ].includes(kind)
      ) {
        const background =
          kind === "grid-column"
            ? colors.subtle
            : widget.selected && kind !== "tree-toggle"
              ? colors.selected
              : colors.background;
        this.box(
          x,
          y,
          width,
          height,
          background,
          ["menu-trigger", "grid-page"].includes(kind) ? colors.border : null,
          ["menu-trigger", "grid-page"].includes(kind) ? 6 : 0,
        );
        const align =
          widget.config.align ||
          (["tab", "grid-select", "tree-toggle", "grid-page"].includes(kind) ? "center" : "left");
        ctx.font = `400 12px ${FONT}`;
        const tw = Math.min(width - 16, ctx.measureText(text).width);
        const tx =
          align === "right"
            ? x + width - tw - 8
            : align === "center"
              ? x + (width - tw) / 2
              : x + 8;
        this.text(
          text,
          tx,
          y + height / 2,
          Math.max(1, width - 16),
          widget.disabled ? colors.muted : colors.text,
          12,
        );
        if (kind === "tab" && widget.selected) {
          ctx.fillStyle = colors.primary;
          ctx.fillRect(x, y + height - 3, width, 3);
        }
      } else if (kind === "menuseparator") {
        ctx.fillStyle = colors.border;
        ctx.fillRect(x, y + height / 2, width, 1);
      } else if (kind === "metric") {
        const themes = {
          blue: [colors.infoBackground, colors.infoText],
          green: [colors.successBackground, colors.successText],
          amber: [colors.warningBackground, colors.warningText],
        };
        const [bg, fg] = themes[widget.variant] || themes.blue;
        this.box(x, y, width, height, bg);
        this.text(text, x + 14, y + 22, width - 28, colors.muted, 11);
        this.text(value, x + 14, y + 53, width - 28, fg, 22, 600);
      } else if (isField(widget) || kind === "displayfield") {
        this.paintField(widget);
      } else if (kind === "progressbar") {
        this.box(x, y, width, height, colors.subtle, colors.border);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, width - 2, height - 2, 6);
        ctx.clip();
        ctx.fillStyle = colors.selected;
        ctx.fillRect(x, y, width * widget.config.fraction, height);
        ctx.restore();
        this.text(text, x + 10, y + height / 2, width - 20, colors.text, 12);
      } else if (kind === "button" || kind === "extra-button") {
        const primary = widget.variant === "primary";
        this.box(
          x,
          y,
          width,
          height,
          primary ? colors.primary : widget.selected ? colors.selected : colors.background,
          primary ? colors.primary : colors.border,
        );
        ctx.font = `500 12px ${FONT}`;
        const tx = x + Math.max(10, (width - ctx.measureText(text).width) / 2);
        this.text(
          text,
          tx,
          y + height / 2,
          width - 20,
          primary ? colors.onPrimary : widget.variant === "muted" ? colors.muted : colors.text,
          12,
          500,
        );
      } else if (kind === "grid-header" || kind === "row") {
        ctx.fillStyle =
          kind === "grid-header"
            ? colors.subtle
            : widget.selected
              ? colors.selected
              : colors.background;
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + height - 0.5);
        ctx.lineTo(x + width, y + height - 0.5);
        ctx.stroke();
        if (widget.selected) {
          ctx.fillStyle = colors.focus;
          ctx.fillRect(x, y, 3, height);
        }
        let offset = 0;
        widget.cells.forEach((cell, i) => {
          const cellWidth = widget.fractions[i] * width;
          this.text(
            cell,
            x + offset + 10,
            y + height / 2,
            cellWidth - 20,
            kind === "grid-header" ? colors.muted : colors.text,
            kind === "grid-header" ? 11 : 12,
            kind === "grid-header" ? 500 : 400,
          );
          offset += cellWidth;
        });
      } else if (kind === "empty") {
        this.text(text, x + 10, y + height / 2, width - 20, colors.muted, 12);
      } else {
        this.text(
          text,
          x,
          y + height / 2,
          width,
          widget.variant === "muted" ? colors.muted : colors.text,
          11,
        );
      }
      if (widget.key === this.focusKey && document.activeElement === this.canvas) {
        ctx.strokeStyle = colors.focus;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, width - 4, height - 4);
      }
      ctx.restore();
    }
  }

  paintField(widget) {
    const { x, y, width, height, kind, text, value, config: c } = widget;
    const ctx = this.context;
    const colors = this.scene.theme.colors;
    const label = c.labelHeight ?? 24;
    if (label) this.text(text, x, y + 10, width, colors.muted, 11, 500);
    const top = y + label;
    const h = height - label;
    const border = this.focusKey === widget.key ? colors.focus : colors.border;
    if (kind === "displayfield") {
      this.text(value, x, top + h / 2, width);
    } else if (isBox(widget)) {
      const cy = top + h / 2;
      if (kind === "checkbox") {
        this.box(x, cy - 8, 17, 17, c.checked ? colors.primary : colors.background, border, 3);
        if (c.checked) this.text("✓", x + 2, cy, 14, colors.onPrimary, 13, 600);
      } else {
        ctx.beginPath();
        ctx.arc(x + 8, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = colors.background;
        ctx.fill();
        ctx.strokeStyle = border;
        ctx.stroke();
        if (c.checked) {
          ctx.beginPath();
          ctx.arc(x + 8, cy, 4, 0, Math.PI * 2);
          ctx.fillStyle = colors.primary;
          ctx.fill();
        }
      }
      this.text(c.boxLabel || text, x + 25, cy, width - 25);
    } else if (kind === "slider") {
      const min = c.min ?? 0;
      const max = c.max ?? 100;
      const f = Math.max(0, Math.min(1, (Number(value) - min) / (max - min)));
      const cy = top + h / 2;
      ctx.fillStyle = colors.border;
      ctx.fillRect(x + 10, cy - 2, width - 20, 4);
      ctx.fillStyle = colors.primary;
      ctx.fillRect(x + 10, cy - 2, (width - 20) * f, 4);
      ctx.beginPath();
      ctx.arc(x + 10 + (width - 20) * f, cy, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      this.box(x, top, width, h, colors.background, border);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 1, top + 1, width - 2, h - 2);
      ctx.clip();
      if (kind === "listbox") {
        const selected = Array.isArray(c.rawValue) ? c.rawValue : [value];
        c.options.slice(0, c.size).forEach((o, i) => {
          const rowY = top + i * 28;
          if (selected.includes(o.value)) {
            ctx.fillStyle = colors.selected;
            ctx.fillRect(x + 1, rowY + 1, width - 2, 28);
          }
          this.text(o.text, x + 11, rowY + 15, width - 22);
        });
      } else if (kind === "textarea") {
        const lines = [];
        ctx.font = `400 13px ${c.monospace ? "monospace" : FONT}`;
        for (const paragraph of value.split("\n")) {
          let line = "";
          for (const char of paragraph) {
            if (line && ctx.measureText(line + char).width > width - 22) {
              lines.push(line);
              line = "";
            }
            line += char;
          }
          lines.push(line);
        }
        if (!value) lines.push(c.placeholder);
        lines
          .slice(0, c.rows)
          .forEach((line, i) =>
            this.text(
              line,
              x + 11,
              top + 17 + i * 20,
              width - 22,
              value ? colors.text : colors.muted,
              13,
              400,
              c.monospace ? "monospace" : FONT,
            ),
          );
      } else {
        const shown =
          kind === "combobox"
            ? c.options.find((o) => o.value === value)?.text || c.placeholder
            : c.inputType === "password"
              ? "•".repeat([...value].length)
              : value || c.placeholder;
        this.text(
          shown,
          x + 11,
          top + h / 2,
          width - (kind === "combobox" ? 42 : 22),
          value ? colors.text : colors.muted,
        );
        if (kind === "combobox") this.text("▾", x + width - 24, top + h / 2, 16, colors.muted);
      }
      ctx.restore();
    }
  }

  reset() {
    for (const record of this.media.values()) disposeMedia(record);
    this.media.clear();
    this.closeEditor();
    this.focusKey = null;
    this.dragKey = null;
    this.scene = null;
    this.returnFocus.clear();
  }
  dispose() {
    for (const record of this.media.values()) disposeMedia(record);
    this.media.clear();
    this.closeEditor();
    this.events.abort();
  }
}
