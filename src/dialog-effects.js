// Dialogs run after the WASM request returns, one at a time.
export class DialogEffects {
  #generation = 0;
  #queue = [];
  #timer;
  #running = false;
  #controller;
  get busy() {
    return this.#running || this.#queue.length > 0;
  }
  constructor({ client, complete, runNext, onError } = {}) {
    this.client = client;
    this.complete = complete;
    this.runNext = runNext || ((effects) => this.run(effects));
    this.onError = onError || (() => {});
  }
  reset() {
    this.#generation++;
    this.#controller?.abort();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const job of this.#queue.splice(0)) job.resolve();
  }
  run(effects = []) {
    const promises = effects.map(
      (effect) =>
        new Promise((resolve) => {
          this.#queue.push({ effect, generation: this.#generation, resolve });
        }),
    );
    this.#schedule();
    return Promise.all(promises);
  }
  #schedule() {
    if (this.#running || this.#timer !== undefined || !this.#queue.length) return;
    this.#timer = setTimeout(() => this.#next(), 0);
  }
  async #next() {
    this.#timer = undefined;
    const job = this.#queue.shift();
    if (!job) return;
    this.#running = true;
    const controller = new AbortController();
    this.#controller = controller;
    try {
      if (job.generation !== this.#generation) return;
      let response;
      try {
        const { operation, message, defaultValue = "" } = job.effect;
        if (
          !["alert", "confirm", "prompt"].includes(operation) ||
          typeof message !== "string" ||
          typeof defaultValue !== "string" ||
          new TextEncoder().encode(message).length > 4096 ||
          new TextEncoder().encode(defaultValue).length > 4096
        )
          throw new Error("ダイアログの指定が不正です");
        if (!this.client?.execute) throw new Error("ダイアログを表示できません");
        const data = await this.client.execute(job.effect, { signal: controller.signal });
        if (
          (operation === "alert" && data !== null) ||
          (operation === "confirm" && typeof data !== "boolean") ||
          (operation === "prompt" &&
            data !== null &&
            (typeof data !== "string" || new TextEncoder().encode(data).length > 4096))
        )
          throw new Error("ダイアログの回答の型・サイズが不正です");
        response = { ok: true, data, error: "" };
      } catch (exception) {
        response = {
          ok: false,
          data: null,
          error: String(exception.message || "ダイアログに失敗しました").slice(0, 512),
        };
      }
      if (job.generation !== this.#generation) return;
      try {
        const next = this.complete(job.effect.id, response);
        // Never await a recursively queued dialog while draining the current one.
        Promise.resolve(this.runNext(next.effects)).catch(this.onError);
      } catch (exception) {
        this.onError(exception);
      }
    } finally {
      this.#running = false;
      this.#controller = undefined;
      job.resolve();
      this.#schedule();
    }
  }
}
