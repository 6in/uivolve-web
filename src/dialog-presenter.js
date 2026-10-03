import { resolveDialogIcon, createDialogIcon } from "./dialog-icons.js";

// Patterns describe content and answers; the shared shell owns modality and focus.
const patterns = Object.freeze({
  alert: { title: "お知らせ", buttons: [{ label: "OK", value: null }], cancel: null },
  confirm: {
    title: "確認",
    buttons: [
      { label: "キャンセル", value: false },
      { label: "OK", value: true },
    ],
    cancel: false,
  },
  prompt: {
    title: "入力",
    input: true,
    buttons: [
      { label: "キャンセル", value: null },
      { label: "OK", submit: true },
    ],
    cancel: null,
  },
});
export class DialogPresenter {
  #current;
  constructor({ document = globalThis.document, getAssetBase } = {}) {
    this.document = document;
    this.getAssetBase = getAssetBase || (() => this.document.baseURI);
  }
  snapshot() {
    if (!this.#current) return null;
    const { effect, pattern, input, icon } = this.#current;
    return {
      id: effect.id,
      operation: effect.operation,
      title: pattern.title,
      message: effect.message,
      icon,
      ...(input ? { value: input.value } : {}),
    };
  }
  execute(effect, { signal } = {}) {
    signal?.throwIfAborted();
    if (this.#current) throw new Error("ダイアログはすでに表示中です");
    if (!Object.hasOwn(patterns, effect.operation)) throw new Error("未対応のダイアログです");
    const pattern = patterns[effect.operation];
    const doc = this.document;
    if (!doc?.body) throw new Error("ダイアログの表示先がありません");
    const icon = resolveDialogIcon(effect.icon, effect.operation, this.getAssetBase());
    const modal = doc.createElement("dialog");
    modal.className = "ui-dialog";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "ui-dialog-title");
    modal.setAttribute("aria-describedby", "ui-dialog-message");
    const title = doc.createElement("h2");
    title.id = "ui-dialog-title";
    title.textContent = pattern.title;
    const header = doc.createElement("div");
    header.className = "ui-dialog-header";
    const iconElement = createDialogIcon(doc, icon);
    if (iconElement) header.append(iconElement);
    header.append(title);
    const message = doc.createElement("p");
    message.id = "ui-dialog-message";
    message.textContent = effect.message;
    const form = doc.createElement("form");
    form.method = "dialog";
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "ui-dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "閉じる");
    modal.append(close, header, message, form);
    let input;
    if (pattern.input) {
      const label = doc.createElement("label");
      label.className = "ui-dialog-label";
      label.textContent = "入力内容";
      input = doc.createElement("input");
      input.type = "text";
      input.value = effect.defaultValue ?? "";
      input.autocomplete = "off";
      input.className = "ui-dialog-input";
      input.maxLength = 4096;
      label.append(input);
      form.append(label);
    }
    const actions = doc.createElement("div");
    actions.className = "ui-dialog-actions";
    form.append(actions);
    return new Promise((resolve, reject) => {
      let finished = false;
      const originalFocus = doc.activeElement;
      const finish = (value, error) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", abort);
        this.#current = undefined;
        if (modal.open) modal.close();
        modal.remove();
        if (error) reject(error);
        else resolve(value);
        // Let the completion handler enable the opener before restoring focus.
        queueMicrotask(() => {
          if (
            originalFocus?.isConnected &&
            !originalFocus.disabled &&
            !doc.querySelector("dialog[open]") &&
            typeof originalFocus.focus === "function"
          )
            originalFocus.focus({ preventScroll: true });
        });
      };
      const abort = () => finish(null, signal.reason || new DOMException("Aborted", "AbortError"));
      const answer = (button) => finish(button.submit ? input.value : button.value);
      for (const [i, button] of pattern.buttons.entries()) {
        const element = doc.createElement("button");
        element.type = "button";
        element.textContent = button.label;
        element.className =
          i === pattern.buttons.length - 1 ? "ui-dialog-button primary" : "ui-dialog-button";
        element.addEventListener("click", () => answer(button));
        actions.append(element);
      }
      let composing = false;
      input?.addEventListener("compositionstart", () => {
        composing = true;
      });
      input?.addEventListener("compositionend", () => {
        composing = false;
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!composing) answer(pattern.buttons.at(-1));
      });
      modal.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...modal.querySelectorAll("button:not([disabled]), input:not([disabled])"),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && doc.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && doc.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
      // Escape / close use the same cancellation value as the Cancel button.
      modal.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (!composing) finish(pattern.cancel);
      });
      modal.addEventListener("close", () => finish(pattern.cancel));
      close.addEventListener("click", () => finish(pattern.cancel));
      signal?.addEventListener("abort", abort, { once: true });
      this.#current = { effect, pattern, input, icon };
      doc.body.append(modal);
      try {
        signal?.throwIfAborted();
        modal.showModal();
        (input || actions.lastElementChild).focus();
        input?.select();
      } catch (error) {
        finish(null, error);
      }
    });
  }
}
