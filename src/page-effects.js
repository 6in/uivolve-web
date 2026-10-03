import { httpUrl } from "./http-policy.js";

// Page downloads reuse the application's loader; the Rhai handler only emits a named intention.
export class PageEffects {
  #generation = 0;
  #base;

  constructor({ load, onError }) {
    this.load = load;
    this.onError = onError;
  }

  reset(base) {
    this.#generation++;
    this.#base = base;
  }

  async run(effects = []) {
    if (!effects.length) return;
    const generation = this.#generation;
    try {
      if (effects.length !== 1) throw new Error("画面遷移は1回の処理につき1件です");
      await this.load(httpUrl(effects[0].url, this.#base));
    } catch (exception) {
      if (generation === this.#generation && exception.name !== "AbortError")
        this.onError(exception);
    }
  }
}
