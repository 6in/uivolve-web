// Both adapters keep native controls alive while editing, including IME composition.
import { isBox } from "./widget-contract.js";
export { fieldKinds, isField, isBox, isEditor } from "./widget-contract.js";

export function createControl(widget, dispatch, prefix) {
  const input = document.createElement(
    widget.kind === "textarea"
      ? "textarea"
      : ["combobox", "listbox"].includes(widget.kind)
        ? "select"
        : "input",
  );
  const record = { input, widget, composing: false, optionsKey: "" };
  input.id = `${prefix}-${widget.key}`;
  input.dataset.target = widget.target;
  input.autocomplete = "off";
  if (input.tagName === "INPUT")
    input.type =
      {
        numberfield: "number",
        datefield: "date",
        checkbox: "checkbox",
        radio: "radio",
        slider: "range",
      }[widget.kind] ||
      widget.config.inputType ||
      "text";
  const update = () => {
    const w = record.widget;
    let value = input.value;
    if (w.kind === "checkbox") value = input.checked;
    else if (w.kind === "radio") {
      if (!input.checked) return;
      value = w.config.inputValue;
    } else if (["numberfield", "slider"].includes(w.kind))
      value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null;
    else if (w.kind === "listbox" && w.config.multiple)
      value = [...input.selectedOptions].map((option) => option.value);
    dispatch(w.target, { ...w.payload, value });
  };
  input.addEventListener("compositionstart", () => {
    record.composing = true;
  });
  input.addEventListener("compositionend", () => {
    record.composing = false;
    update();
  });
  input.addEventListener(
    ["combobox", "listbox", "checkbox", "radio"].includes(widget.kind) ? "change" : "input",
    (event) => {
      if (!record.composing && !event.isComposing) update();
    },
  );
  syncControl(record, widget);
  return record;
}

export function syncControl(record, widget) {
  record.widget = widget;
  const { input } = record;
  const config = widget.config;
  input.classList.toggle("code-input", Boolean(config.monospace));
  if (config.language) input.dataset.language = config.language;
  input.disabled = widget.disabled;
  input.readOnly = config.readOnly;
  input.required = config.required;
  input.placeholder = config.placeholder;
  input.setAttribute("aria-label", widget.text || config.boxLabel || widget.target);
  // Names are scoped to the adapter; radio groups share the engine's binding, not browser state.
  if (isBox(widget)) input.name = `${input.id.split("-")[0]}-${config.group || widget.target}`;
  for (const [attribute, value] of Object.entries({
    minlength: config.minLength,
    maxlength: config.maxLength,
    min: config.min ?? (widget.kind === "slider" ? 0 : null),
    max: config.max ?? (widget.kind === "slider" ? 100 : null),
    step: config.step,
  })) {
    if (value == null) input.removeAttribute(attribute);
    else input.setAttribute(attribute, String(value));
  }
  if (widget.kind === "textarea") input.rows = config.rows;
  if (input.tagName === "SELECT") {
    input.multiple = config.multiple;
    input.size = widget.kind === "listbox" ? config.size : 1;
    const key = JSON.stringify([config.options, config.placeholder, widget.kind]);
    if (key !== record.optionsKey) {
      const options =
        config.placeholder && widget.kind === "combobox"
          ? [{ value: "", text: config.placeholder }, ...config.options]
          : config.options;
      input.replaceChildren(...options.map((o) => new Option(o.text, o.value)));
      record.optionsKey = key;
    }
  }
  if (record.composing) return;
  if (isBox(widget)) input.checked = config.checked;
  else if (input.tagName === "SELECT" && input.multiple) {
    const selected = Array.isArray(config.rawValue) ? config.rawValue : [];
    for (const option of input.options) option.selected = selected.includes(option.value);
  } else if (input.value !== widget.value) input.value = widget.value;
}
