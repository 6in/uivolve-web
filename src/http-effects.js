// The page describes named GET requests; WASM decides when to start and how to handle results.
export class HttpEffects {
  #generation = 0;
  #base;
  #controllers = new Set();

  constructor({ resources, complete, onError, timeout = 15_000 }) {
    this.resources = resources;
    this.complete = complete;
    this.onError = onError;
    this.timeout = timeout;
  }

  reset(base) {
    this.#generation++;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.#base = base;
  }

  run(effects = []) {
    return Promise.all(effects.map((effect) => this.#request(effect)));
  }

  async #request(effect) {
    const generation = this.#generation;
    const controller = new AbortController();
    this.#controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let result;
    try {
      const url = new URL(effect.url, this.#base);
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
      const next = this.complete(effect.id, result);
      await this.run(next.effects);
    } catch (exception) {
      this.onError(exception);
    }
  }
}
