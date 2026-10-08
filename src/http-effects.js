// The page describes named GET requests; WASM decides when to start and how to handle results.
export class HttpEffects {
  #generation = 0;
  // Instance path ("" is root) -> base URL. Child components resolve relative URLs against their own package.
  #bases = new Map();
  #controllers = new Set();

  constructor({ resources, complete, onError, runNext, timeout = 15_000 }) {
    this.resources = resources;
    this.complete = complete;
    this.onError = onError;
    this.timeout = timeout;
    this.runNext = runNext || ((effects) => this.run(effects));
  }

  resetInstances(bases) {
    this.#generation++;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.#bases = bases;
  }

  reset(base) {
    this.resetInstances(new Map([["", base]]));
  }

  run(effects = []) {
    return Promise.all(effects.map((effect) => this.#request(effect)));
  }

  async #request(effect) {
    const instance = effect.instance ?? "";
    const base = this.#bases.get(instance);
    // An unregistered Instance means the screen was replaced or the table is stale; never hand it to WASM.
    if (base === undefined) {
      this.onError(new Error(`コンポーネント ${instance} の配送先が未登録です`));
      return;
    }
    const generation = this.#generation;
    const controller = new AbortController();
    this.#controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let result;
    try {
      const url = new URL(effect.url, base);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("HTTP / HTTPSのURLを指定してください");
      const text = await this.resources.text(url, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (new TextEncoder().encode(text).length > 1_000_000)
        throw new Error("JSONが1 MBを超えています");
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("応答が有効なJSONではありません");
      }
      result = { ok: true, data, error: "" };
    } catch (exception) {
      result = {
        ok: false,
        data: null,
        error: controller.signal.aborted
          ? "HTTP取得がタイムアウトしました"
          : String(exception.message || "HTTP取得に失敗しました").slice(0, 512),
      };
    } finally {
      clearTimeout(timer);
      this.#controllers.delete(controller);
    }
    // Switching/recompiling screens cancels work and discards even already resolved responses.
    if (generation !== this.#generation) return;
    try {
      const next = this.complete(effect.id, result, effect.instance);
      await this.runNext(next.effects);
    } catch (exception) {
      this.onError(exception);
    }
  }
}
