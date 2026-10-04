const safeName = /^[A-Za-z0-9_-]{1,80}$/;

export function hostError(code, message, outcome = "not-started") {
  return Object.assign(new Error(message), { code, outcome });
}

function failure(error) {
  return {
    ok: false,
    data: null,
    error: {
      code: typeof error?.code === "string" ? error.code.slice(0, 80) : "FAILED",
      message: String(error?.message || "ホスト操作に失敗しました").slice(0, 512),
      retryable: false,
      outcome: ["not-started", "failed", "committed", "unknown"].includes(error?.outcome)
        ? error.outcome
        : "unknown",
    },
  };
}

// One instance per UI host, shared by all rendering surfaces.
export class HostEffects {
  #adapters = new Map();
  #connections;
  #operations = new Map();
  #active = new Map();
  #lastId = 0;
  #generation = 0;
  #delivery = Promise.resolve();
  #disposed = false;

  constructor({ adapters = [], connections = {}, complete, onError, runNext, timeout = 15_000 }) {
    for (const adapter of adapters) {
      if (
        !safeName.test(adapter.name) ||
        this.#adapters.has(adapter.name) ||
        !Array.isArray(adapter.actions) ||
        typeof adapter.validate !== "function" ||
        typeof adapter.execute !== "function"
      )
        throw new Error("Invalid or duplicate host adapter");
      this.#adapters.set(adapter.name, adapter);
    }
    this.#connections = structuredClone(connections);
    this.complete = complete;
    this.onError = onError ?? (() => {});
    this.runNext = runNext ?? ((effects) => this.run(effects));
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300_000)
      throw new Error("Invalid host timeout");
    this.timeout = timeout;
  }

  // Pure validation, before engine.load replaces the active WASM state.
  prepare(definitions = {}, baseUrl) {
    const prepared = new Map();
    if (
      !definitions ||
      Array.isArray(definitions) ||
      typeof definitions !== "object" ||
      Object.keys(definitions).length > 64
    )
      throw new Error("Invalid host operations");
    for (const [name, value] of Object.entries(definitions)) {
      const operation = structuredClone(value);
      if (!safeName.test(name) || !safeName.test(operation.connection))
        throw new Error(`Invalid host operation: ${name}`);
      const connection = Object.hasOwn(this.#connections, operation.connection)
        ? structuredClone(this.#connections[operation.connection])
        : undefined;
      const adapter = this.#adapters.get(connection?.adapter);
      if (!adapter || !adapter.actions.includes(operation.action))
        throw new Error(`Unsupported host operation: ${name}`);
      operation.options ??= {};
      adapter.validate(operation, connection, new URL(baseUrl));
      prepared.set(name, { operation, connection, adapter });
    }
    return prepared;
  }

  reset(prepared = new Map()) {
    this.#generation++;
    for (const controller of this.#active.values()) controller.abort();
    this.#active.clear();
    this.#lastId = 0;
    this.#operations = prepared;
  }

  run(effects = []) {
    if (this.#disposed) return Promise.resolve();
    return Promise.all(effects.map((effect) => this.#request(effect)));
  }

  async #request(effect) {
    if (
      effect.kind !== "host" ||
      effect.v !== 1 ||
      !Number.isSafeInteger(effect.id) ||
      effect.id < 1
    ) {
      this.onError(new Error("Invalid host effect"));
      return;
    }
    if (effect.id <= this.#lastId) return;
    this.#lastId = effect.id;
    const generation = this.#generation;
    const controller = new AbortController();
    this.#active.set(effect.id, controller);
    let timer;
    let response;
    const resolved = this.#operations.get(effect.operation);
    try {
      if (!resolved) throw hostError("UNSUPPORTED", "ホスト操作が登録されていません");
      if (this.#active.size > 8) throw hostError("LIMIT", "同時ホスト操作は8件までです");
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(hostError("TIMEOUT", "ホスト操作がタイムアウトしました", "unknown"));
          controller.abort();
        }, this.timeout);
        controller.signal.addEventListener(
          "abort",
          () => {
            reject(hostError("CANCELLED", "ホスト操作が中止されました", "unknown"));
          },
          { once: true },
        );
      });
      const data = await Promise.race([
        resolved.adapter.execute(
          structuredClone(resolved.operation),
          structuredClone(effect.args),
          {
            signal: controller.signal,
            connection: structuredClone(resolved.connection),
          },
        ),
        timeout,
      ]);
      response = { ok: true, data: data ?? null, error: null };
      let serialized;
      try {
        serialized = JSON.stringify(response);
      } catch {
        throw hostError("INVALID_RESULT", "ホスト応答をJSONへ変換できません", "unknown");
      }
      if (new TextEncoder().encode(serialized).length > 1_000_000)
        throw hostError("LIMIT", "ホスト応答が1 MBを超えています", "unknown");
      response = JSON.parse(serialized);
    } catch (error) {
      response = failure(error);
    } finally {
      clearTimeout(timer);
      if (generation === this.#generation) this.#active.delete(effect.id);
    }
    // Delivery is serialized, but child effects are run outside this queue to avoid deadlock.
    const delivery = this.#delivery.then(() => {
      if (this.#disposed || generation !== this.#generation) return;
      try {
        return this.complete(effect.id, response);
      } catch (error) {
        this.onError(
          Object.assign(new Error(`ホスト完了handlerに失敗しました: ${error.message}`), {
            cause: error,
            operation: effect.operation,
            externalResult: response,
          }),
        );
      }
    });
    this.#delivery = delivery.catch(() => {});
    const next = await delivery;
    if (next && generation === this.#generation && !this.#disposed)
      await this.runNext(next.effects ?? []);
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.reset();
    for (const adapter of this.#adapters.values()) {
      void Promise.resolve()
        .then(() => adapter.dispose?.())
        .catch(this.onError);
    }
  }
}
