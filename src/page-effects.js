import { httpUrl } from "./http-policy.js";

// Page downloads reuse the application's loader; the Rhai handler only emits a named intention.
export class PageEffects {
  #generation = 0;
  // Instance path ("" is root) -> base URL. Only the base is per-Instance; navigation stays one per dispatch.
  #bases = new Map();

  constructor({ load, onError }) {
    this.load = load;
    this.onError = onError;
  }

  resetInstances(bases) {
    this.#generation++;
    this.#bases = bases;
  }

  reset(base) {
    this.resetInstances(new Map([["", base]]));
  }

  async run(effects = []) {
    if (!effects.length) return;
    const generation = this.#generation;
    try {
      if (effects.length !== 1) throw new Error("画面遷移は1回の処理につき1件です");
      const instance = effects[0].instance ?? "";
      const base = this.#bases.get(instance);
      // An unregistered Instance means the screen was replaced or the table is stale; never load.
      if (base === undefined) throw new Error(`コンポーネント ${instance} の配送先が未登録です`);
      await this.load(httpUrl(effects[0].url, base));
    } catch (exception) {
      if (generation === this.#generation && exception.name !== "AbortError")
        this.onError(exception);
    }
  }
}
