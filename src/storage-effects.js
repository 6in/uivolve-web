import { StorageClient } from "./storage-client.js";

export class StorageEffects {
  #generation = 0;
  #scope;
  #controllers = new Set();
  constructor({
    client = new StorageClient(),
    complete,
    onError,
    runNext,
    timeout = 15_000,
    label = "保存操作",
  }) {
    this.client = client;
    this.complete = complete;
    this.onError = onError;
    this.runNext = runNext || ((effects) => this.run(effects));
    this.timeout = timeout;
    this.label = label;
  }
  reset(scope) {
    this.#generation++;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.#scope = scope;
  }
  run(effects = []) {
    return Promise.all(effects.map((effect) => this.#request(effect)));
  }
  async #request(effect) {
    const generation = this.#generation;
    const controller = new AbortController();
    this.#controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    let response;
    try {
      const data = await Promise.race([
        this.client.execute(this.#scope, effect, { signal: controller.signal }),
        cancelled,
      ]);
      controller.signal.throwIfAborted();
      response = { ok: true, data, error: "" };
    } catch (exception) {
      response = {
        ok: false,
        data: null,
        error: controller.signal.aborted
          ? `${this.label}がタイムアウトしました`
          : String(exception.message || `${this.label}に失敗しました`).slice(0, 512),
      };
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      this.#controllers.delete(controller);
    }
    if (generation !== this.#generation) return;
    try {
      const next = this.complete(effect.id, response);
      await this.runNext(next.effects);
    } catch (exception) {
      this.onError(exception);
    }
  }
}
