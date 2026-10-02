// Capabilities of scene widgets, shared by DOM, Canvas and semantic tools.
export const fieldKinds = Object.freeze([
  "textfield",
  "textarea",
  "numberfield",
  "datefield",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "slider",
]);
export const buttonKinds = Object.freeze([
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
]);
export const isField = (widget) => fieldKinds.includes(widget.kind);
export const isButton = (widget) => buttonKinds.includes(widget.kind);
export const isBox = (widget) => ["checkbox", "radio"].includes(widget.kind);
export const isEditor = (widget) => isField(widget) && !isBox(widget) && widget.kind !== "slider";
export const isInteractive = (widget) => (isField(widget) || isButton(widget)) && !widget.disabled;

// Card exposes a semantic action but has no implicit pointer/keyboard control.
export function widgetActions(widget) {
  if (!isField(widget) && !isButton(widget) && widget.kind !== "card") return [];
  const actions = [widget.payload?.action || ""];
  if (widget.kind === "grid-cell" && widget.config.editable) actions.push("beginEdit");
  if (widget.config.gridEditor) actions.push("commitEdit", "cancelEdit");
  if (widget.kind === "menu-trigger") actions.push("close");
  return actions;
}

export function isBlocked(widget, scene) {
  return Boolean(
    widget.disabled ||
    widget.config.readOnly ||
    (scene.modal && widget.layer !== scene.modal.layer),
  );
}
