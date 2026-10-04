import { applyTheme } from "./theme.js";
import { createControl, syncControl } from "./field-control.js";
import { isButton, isField, isBox } from "./widget-contract.js";
import { renderSvg, syncMedia, mediaKinds, disposeMedia } from "./surfaces.js";
import { resolveDialogIcon, createDialogIcon } from "./dialog-icons.js";
import { KanbanDrag, keyboardMove } from "./kanban-interaction.js";

function position(element, widget, origin = { x: 0, y: 0 }) {
  Object.assign(element.style, {
    left: `${widget.x - origin.x}px`,
    top: `${widget.y - origin.y}px`,
    width: `${widget.width}px`,
    height: `${widget.height}px`,
  });
}

export class DomRenderer {
  constructor(stage, dispatch) {
    this.stage = stage;
    this.dispatch = dispatch;
    this.nodes = new Map();
    this.modal = null;
    this.returnFocus = new Map();
    this.events = new AbortController();
    this.kanban = new KanbanDrag(stage, {
      dispatch,
      focus: (widget) => this.nodes.get(widget.key)?.root.focus({ preventScroll: true }),
      change: (drag) => this.paintDrag(drag),
    });
    stage.addEventListener(
      "pointerdown",
      (event) => {
        if (this.popup && event.target.closest("[data-menu]")?.dataset.menu !== this.popup.target)
          this.dispatch(this.popup.target, { action: "close" });
        if (this.modal && event.target.classList.contains("ui-backdrop")) event.preventDefault();
      },
      { signal: this.events.signal },
    );
    stage.addEventListener(
      "keydown",
      (event) => {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        const key = event.target.closest(".ui-widget")?.dataset.key;
        if (this.nodes.get(key)?.control?.composing) return;
        if (event.key === "Escape" && this.popup) {
          event.preventDefault();
          this.dispatch(this.popup.target, { action: "close" });
          return;
        }
        if (!this.modal) return;
        if (event.key === "Escape") {
          event.preventDefault();
          this.dispatch(this.modal.target, { action: "close" });
        } else if (event.key === "Tab") {
          const root = this.nodes.get(this.modal.key)?.root;
          const controls = [
            ...root.querySelectorAll(
              "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
            ),
          ];
          if (!controls.length) return;
          const i = controls.indexOf(document.activeElement);
          const next = (i + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
          event.preventDefault();
          controls[next].focus();
        }
      },
      { signal: this.events.signal },
    );
  }

  create(widget) {
    const root = document.createElement(isButton(widget) ? "button" : "div");
    const record = { root, widget, cells: [] };
    root.dataset.key = widget.key;
    root.dataset.target = widget.target;
    if (isButton(widget)) {
      root.type = "button";
      root.addEventListener("click", (event) => {
        if (record.widget.kind === "kanban-card") return;
        this.dispatch(record.widget.target, {
          ...record.widget.payload,
          additive: event.ctrlKey || event.metaKey,
          range: event.shiftKey,
        });
      });
      if (widget.kind === "grid-cell") {
        const edit = () => {
          if (record.widget.config.editable)
            this.dispatch(record.widget.target, { ...record.widget.payload, action: "beginEdit" });
        };
        root.addEventListener("dblclick", edit);
        root.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === "F2") {
            event.preventDefault();
            edit();
          }
        });
      }
      root.addEventListener("keydown", (event) => {
        const w = record.widget;
        if (
          w.kind === "kanban-card" &&
          event.altKey &&
          !event.isComposing &&
          event.key.startsWith("Arrow")
        ) {
          event.preventDefault();
          const payload = keyboardMove(this.scene, w, event.key);
          if (payload) this.dispatch(w.target, payload);
          return;
        }
        if (
          w.kind === "grid-cell" &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
        ) {
          event.preventDefault();
          const cells = this.scene.widgets.filter(
            (cell) => cell.kind === "grid-cell" && cell.target === w.target && !cell.disabled,
          );
          const columns = new Set(cells.map((cell) => cell.payload.column)).size;
          const delta = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -columns,
            ArrowDown: columns,
          }[event.key];
          const next = cells[cells.findIndex((cell) => cell.key === w.key) + delta];
          if (next) this.nodes.get(next.key)?.root.focus();
        } else if (w.kind === "menu-trigger" && event.key === "ArrowDown") {
          event.preventDefault();
          if (!w.selected) this.dispatch(w.target, w.payload);
          this.stage.querySelector(".ui-menu-item:not(:disabled)")?.focus();
        } else if (w.kind === "menu-item" && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const choices = [...this.stage.querySelectorAll(".ui-menu-item:not(:disabled)")];
          choices[
            (choices.indexOf(root) + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
              choices.length
          ]?.focus();
        } else if (
          w.kind === "tab" &&
          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const tabs = [...root.parentElement.querySelectorAll(".ui-tab:not(:disabled)")];
          const i =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (tabs.indexOf(root) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                  tabs.length;
          tabs[i]?.focus();
          tabs[i]?.click();
        }
      });
    }
    if (widget.kind === "kanban-lane" || widget.kind === "kanban-card") {
      record.title = document.createElement("strong");
      record.detail = document.createElement("span");
      root.append(record.title, record.detail);
    } else if (widget.kind === "window" || widget.kind === "tree-shell") {
      record.title = document.createElement("span");
      record.title.className = "window-title";
      if (widget.kind === "window") root.setAttribute("role", "dialog");
      root.append(record.title);
    } else if (isField(widget)) {
      const label = document.createElement("label");
      const control = createControl(widget, this.dispatch, "dom");
      const input = control.input;
      input.addEventListener("keydown", (event) => {
        if (control.widget.config.dialog && event.key === "Enter") {
          if (control.composing || event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          this.dispatch(control.widget.target, { action: "accept", value: input.value });
          return;
        }
        if (
          !control.widget.config.gridEditor ||
          control.composing ||
          event.isComposing ||
          event.keyCode === 229
        )
          return;
        if (["Enter", "Escape", "Tab"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          this.dispatch(control.widget.target, {
            action: event.key === "Escape" ? "cancelEdit" : "commitEdit",
          });
        }
      });
      label.htmlFor = input.id;
      root.append(label);
      if (isBox(widget)) {
        const box = document.createElement("label");
        const caption = document.createElement("span");
        box.className = "box-control";
        box.append(input, caption);
        root.append(box);
        record.caption = caption;
      } else root.append(input);
      Object.assign(record, { label, input, control });
    } else if (widget.kind === "displayfield") {
      record.label = document.createElement("span");
      record.value = document.createElement("div");
      root.append(record.label, record.value);
    } else if (widget.kind === "progressbar") {
      record.fill = document.createElement("div");
      record.caption = document.createElement("span");
      root.setAttribute("role", "progressbar");
      root.setAttribute("aria-valuemin", "0");
      root.setAttribute("aria-valuemax", "100");
      root.append(record.fill, record.caption);
    } else if (widget.kind === "metric") {
      const label = document.createElement("span");
      const value = document.createElement("strong");
      root.append(label, value);
      Object.assign(record, { label, value });
    }
    this.stage.append(root);
    return record;
  }

  render(scene) {
    this.kanban.setScene(scene);
    this.scene = scene;
    applyTheme(this.stage, scene.theme);
    const active = document.activeElement;
    const ownsFocus = this.stage.contains(active);
    const focusedKey = active?.closest(".ui-widget")?.dataset.key;
    const focusedTarget = active?.closest(".ui-widget")?.dataset.target;
    const oldPopup = this.popup;
    this.popup = scene.popup;
    const oldModal = this.modal;
    const changedModal = oldModal?.key !== scene.modal?.key;
    if (changedModal && scene.modal && ownsFocus && !this.returnFocus.has(scene.modal.key)) {
      const origin = oldModal?.key.startsWith(":dialog:") && this.returnFocus.get(oldModal.key);
      this.returnFocus.set(scene.modal.key, origin || active);
    }
    this.modal = scene.modal;
    this.stage.style.height = `${scene.height}px`;
    const keys = new Set();
    const layers = new Map();
    for (const widget of scene.widgets) {
      keys.add(widget.key);
      let record = this.nodes.get(widget.key);
      if (record && record.widget.kind !== widget.kind) {
        if (record.media) disposeMedia(record);
        else record.root.remove();
        this.nodes.delete(widget.key);
        record = null;
      }
      if (!record) {
        record = this.create(widget);
        this.nodes.set(widget.key, record);
      }
      record.widget = widget;
      const { root } = record;
      const parent = this.nodes.get(widget.config.parentKey) || layers.get(widget.layer);
      const host =
        widget.kind === "backdrop" || widget.kind === "window" || widget.kind === "menu-surface"
          ? this.stage
          : parent?.root || this.stage;
      if (root.parentElement !== host) host.append(root);
      position(root, widget, host === this.stage ? undefined : parent.widget);
      if (widget.kind === "window") layers.set(widget.layer, record);
      root.style.zIndex =
        widget.kind === "backdrop"
          ? String(widget.layer * 2)
          : widget.kind === "window" || widget.kind === "menu-surface"
            ? String(widget.layer * 2 + 1)
            : widget.config.popup
              ? "1"
              : "";
      root.inert = Boolean(scene.modal && widget.layer !== scene.modal.layer);
      root.className = `ui-widget ui-${widget.kind} ${widget.variant ? `variant-${widget.variant}` : ""} ${widget.selected ? "selected" : ""}`;
      root.dataset.target = widget.target;
      if (widget.config.menu) root.dataset.menu = widget.config.menu;
      else delete root.dataset.menu;
      root.style.textAlign =
        isField(widget) || widget.kind === "displayfield" ? "" : widget.config.align || "";
      const roles = {
        "grid-shell": "grid",
        "grid-head": "row",
        "grid-row": "row",
        "grid-column": "columnheader",
        "grid-cell": "gridcell",
        "grid-select": "gridcell",
        tabbar: "tablist",
        tab: "tab",
        "tree-shell": "tree",
        "tree-node": "treeitem",
        "menu-surface": "menu",
        "menu-item": "menuitem",
        menuseparator: "separator",
      };
      if (roles[widget.kind]) root.setAttribute("role", roles[widget.kind]);
      if (widget.kind === "grid-shell") {
        root.setAttribute("aria-label", widget.text);
        root.setAttribute("aria-rowcount", String(widget.config.rowCount + 1));
        root.setAttribute("aria-colcount", String(widget.config.columnCount));
        root.setAttribute("aria-multiselectable", String(widget.config.multiple));
      }
      if (widget.kind === "grid-column")
        root.setAttribute(
          "aria-sort",
          widget.config.direction === "asc"
            ? "ascending"
            : widget.config.direction === "desc"
              ? "descending"
              : "none",
        );
      if (["grid-row", "tab", "tree-node"].includes(widget.kind))
        root.setAttribute("aria-selected", String(widget.selected));
      if (widget.kind === "grid-row")
        root.setAttribute("aria-rowindex", String(widget.config.rowIndex));
      if (widget.kind === "grid-cell") root.classList.toggle("editable", widget.config.editable);
      if (widget.kind === "menu-trigger") {
        root.setAttribute("aria-haspopup", "menu");
        root.setAttribute("aria-expanded", String(widget.selected));
      }
      if (widget.kind === "tree-node") {
        root.setAttribute("aria-level", String(widget.config.depth + 1));
        if (widget.config.branch)
          root.setAttribute("aria-expanded", String(widget.config.expanded));
      }
      if (widget.kind === "kanban-lane" || widget.kind === "kanban-card") {
        record.title.textContent = widget.text;
        record.detail.textContent =
          widget.kind === "kanban-lane" ? String(widget.config.count) : widget.value;
        if (widget.kind === "kanban-card") root.dataset.cardId = widget.payload.id;
        root.setAttribute(
          "aria-label",
          widget.kind === "kanban-card"
            ? `${widget.text}（${widget.config.laneTitle}）。Alt＋方向キーで移動`
            : widget.text,
        );
        if (widget.kind === "kanban-lane") root.setAttribute("role", "group");
      } else if (widget.kind === "window" || widget.kind === "tree-shell") {
        record.title.textContent = widget.text;
        root.setAttribute("aria-label", widget.text);
        record.title.style.paddingLeft =
          widget.config.dialog && widget.config.icon ? "58px" : "14px";
      } else if (widget.kind === "dialog-icon") {
        const signature = JSON.stringify([widget.config, scene.assetBase]);
        if (record.iconSignature !== signature) {
          let icon;
          try {
            icon = resolveDialogIcon(widget.config.icon, widget.config.operation, scene.assetBase);
          } catch {
            icon = "info";
          }
          const element = createDialogIcon(document, icon);
          root.replaceChildren(...(element ? [element] : []));
          record.iconSignature = signature;
        }
      } else if (widget.kind === "dialog-message") {
        root.textContent = widget.config.lines.join("\n");
      } else if (isField(widget)) {
        root.classList.add("ui-field");
        record.label.textContent = widget.text;
        record.label.style.height = `${widget.config.labelHeight}px`;
        record.label.hidden = widget.config.labelHeight === 0;
        if (record.caption) record.caption.textContent = widget.config.boxLabel || widget.text;
        else record.input.style.height = `${widget.height - widget.config.labelHeight}px`;
        syncControl(record.control, widget);
      } else if (widget.kind === "displayfield") {
        record.label.textContent = widget.text;
        record.value.textContent = widget.value;
        record.value.style.textAlign = widget.config.align || "left";
      } else if (widget.kind === "progressbar") {
        record.fill.style.width = `${widget.config.fraction * 100}%`;
        record.caption.textContent = widget.text;
        root.setAttribute("aria-valuenow", String(Math.round(widget.config.fraction * 100)));
        root.setAttribute("aria-label", widget.text);
      } else if (widget.kind === "metric") {
        record.label.textContent = widget.text;
        record.value.textContent = widget.value;
      } else if (["figure", "document"].includes(widget.kind)) {
        renderSvg(record, widget, scene.theme);
      } else if (mediaKinds.includes(widget.kind)) {
        syncMedia(record, widget, scene.assetBase);
        root.inert = widget.disabled || Boolean(scene.modal && widget.layer !== scene.modal.layer);
      } else if (widget.kind === "toast") {
        root.textContent = widget.text;
        root.setAttribute("role", "status");
      } else if (widget.cells.length) {
        while (record.cells.length > widget.cells.length) record.cells.pop().remove();
        while (record.cells.length < widget.cells.length) {
          const cell = document.createElement("span");
          root.append(cell);
          record.cells.push(cell);
        }
        widget.cells.forEach((text, i) => {
          record.cells[i].textContent = text;
          record.cells[i].style.width = `${widget.fractions[i] * 100}%`;
        });
        if (widget.kind === "row") {
          root.setAttribute("aria-pressed", String(widget.selected));
          root.setAttribute("aria-label", widget.cells.join("、"));
        }
      } else if (
        !["grid-shell", "grid-row", "grid-head", "tabbar", "menu-surface"].includes(widget.kind)
      ) {
        root.textContent = widget.text;
      }
      if (isButton(widget)) root.disabled = widget.disabled;
      if (widget.kind === "panel-toggle")
        root.setAttribute("aria-expanded", String(!widget.selected));
      if (widget.kind === "window-close") root.setAttribute("aria-label", "ウィンドウを閉じる");
    }
    // Keep the DOM reading/Tab order aligned with the visual card order too.
    const previousCards = new Map();
    for (const widget of scene.widgets.filter((w) => w.kind === "kanban-card")) {
      const parent = this.nodes.get(widget.config.parentKey);
      const root = this.nodes.get(widget.key).root;
      const previous = previousCards.get(widget.config.parentKey) || parent.detail;
      if (previous.nextElementSibling !== root) previous.after(root);
      previousCards.set(widget.config.parentKey, root);
    }
    for (const [key, record] of this.nodes) {
      if (!keys.has(key)) {
        if (record.media) disposeMedia(record);
        else record.root.remove();
        this.nodes.delete(key);
      }
    }
    if (ownsFocus && (!active.isConnected || !this.stage.contains(document.activeElement))) {
      const record =
        this.nodes.get(focusedKey) ||
        [...this.nodes.values()].find(
          (r) => r.widget.target === focusedTarget && isButton(r.widget) && !r.widget.disabled,
        );
      (record?.input || record?.root)?.focus({ preventScroll: true });
    }
    if (ownsFocus && oldPopup?.target !== scene.popup?.target) {
      if (scene.popup) this.stage.querySelector(".ui-menu-item:not(:disabled)")?.focus();
      else if (oldPopup) this.nodes.get(oldPopup.target)?.root.focus();
    }
    if (changedModal && ownsFocus) {
      if (scene.modal) {
        const root = this.nodes.get(scene.modal.key).root;
        const restore = oldModal && this.returnFocus.get(oldModal.key);
        const next =
          restore && root.contains(restore) && !restore.disabled
            ? restore
            : root.querySelector(
                "input:not(:disabled), textarea:not(:disabled), select:not(:disabled), .ui-button:not(:disabled)",
              ) || root.querySelector("button:not(:disabled)");
        next?.focus();
      } else {
        const candidates = [
          this.returnFocus.get(oldModal?.key),
          ...[...this.returnFocus.values()].reverse(),
        ];
        const restore = candidates.find(
          (el) => el?.isConnected && !el.disabled && !el.closest("[inert]"),
        );
        restore?.focus();
      }
    }
    for (const key of this.returnFocus.keys()) {
      if (!scene.widgets.some((w) => w.kind === "window" && w.key === key))
        this.returnFocus.delete(key);
    }
  }

  reset() {
    this.kanban.setScene(null);
    for (const node of this.nodes.values()) {
      if (node.media) disposeMedia(node);
      else node.root.remove();
    }
    this.nodes.clear();
    this.modal = null;
    this.returnFocus.clear();
  }

  dispose() {
    this.reset();
    this.kanban.dispose();
    this.events.abort();
  }

  paintDrag(drag) {
    this.dragGhost?.remove();
    this.dragMarker?.remove();
    for (const { root } of this.nodes.values()) {
      root.classList.remove("kanban-drag-source", "kanban-drop-target");
    }
    if (!drag?.active) return;
    this.nodes.get(drag.card.key)?.root.classList.add("kanban-drag-source");
    const ghost = document.createElement("div");
    ghost.className = "kanban-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = drag.card.text;
    detail.textContent = drag.card.value;
    ghost.append(title, detail);
    position(ghost, { ...drag.card, x: drag.x, y: drag.y });
    this.stage.append(ghost);
    this.dragGhost = ghost;
    if (drag.drop) {
      this.nodes.get(drag.drop.lane.key)?.root.classList.add("kanban-drop-target");
      const marker = document.createElement("div");
      marker.className = "kanban-drop-marker";
      position(marker, {
        x: drag.drop.lane.x + 10,
        y: drag.drop.lineY,
        width: drag.drop.lane.width - 20,
        height: 3,
      });
      this.stage.append(marker);
      this.dragMarker = marker;
    }
  }
}
