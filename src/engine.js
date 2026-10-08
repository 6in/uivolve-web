// Browser boundary only: UTF-8 memory exchange and the native Wasm API.
import { browserClock, validateClock } from "./clock.js";

const clockOperations = new Set([
  "load",
  "event",
  "host_result",
  "host_progress",
  "http_result",
  "storage_result",
  "file_result",
  "rpc_result",
  "dialog_result",
]);

// `instance` is the path of the child Instance a completion belongs to; the root reports none.
// The key is added only when one was given, so a completion the host could not attribute never
// reaches the engine as `instance: null`.
function withInstance(request, instance) {
  return instance === undefined ? request : { ...request, instance };
}

export class WasmEngine {
  constructor(exports, bytes, { clockProvider = browserClock } = {}) {
    if (typeof clockProvider !== "function") throw new Error("clockProviderには関数が必要です");
    this.clockProvider = clockProvider;
    this.exports = exports;
    this.bytes = bytes;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
  }

  static async create(url, { resources, signal, theme, clockProvider } = {}) {
    signal?.throwIfAborted();
    const response = resources
      ? await resources.fetch(url, { signal })
      : await fetch(url, { signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`WASM取得失敗: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    signal?.throwIfAborted();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    signal?.throwIfAborted();
    const engine = new WasmEngine(instance.exports, bytes.byteLength, { clockProvider });
    if (theme !== undefined) engine.theme(theme);
    return engine;
  }

  readClock() {
    return validateClock(this.clockProvider());
  }

  call(request) {
    if (clockOperations.has(request.op)) {
      const clock = Object.hasOwn(request, "clock")
        ? validateClock(request.clock)
        : this.readClock();
      request = { ...request, clock };
    }
    const bytes = this.encoder.encode(JSON.stringify(request));
    if (bytes.length > 2_000_000) throw new Error("リクエストが2 MBを超えています");
    const pointer = this.exports.input_alloc(bytes.length);
    try {
      new Uint8Array(this.exports.memory.buffer, pointer, bytes.length).set(bytes);
      const output = this.exports.request(pointer, bytes.length);
      const result = JSON.parse(
        this.decoder.decode(
          new Uint8Array(this.exports.memory.buffer, output, this.exports.response_len()),
        ),
      );
      if (!result.ok) throw new Error(result.error);
      return result.data;
    } finally {
      this.exports.input_free(pointer, bytes.length);
    }
  }

  load(screen, script, descriptors = {}, options = {}) {
    // Every buffer taken for the root or for a child is released by the one `finally` below,
    // so the same descriptor url bundled with two packages is held — and freed — twice.
    const allocated = [];
    const store = (definition, available) => {
      const ids = Object.create(null);
      for (const key of new Set(Object.values(definition.rpc ?? {}).map((r) => r.descriptor))) {
        if (!(available[key] instanceof Uint8Array))
          throw new Error(`Descriptorがありません: ${key}`);
        ids[key] = this.storeBuffer(available[key]);
        allocated.push(ids[key]);
      }
      return ids;
    };
    try {
      const ids = store(screen, descriptors);
      const entries = Object.entries(options.components ?? {}).map(([href, child]) => {
        const childIds = store(child.screen, child.descriptors ?? {});
        return [
          href,
          {
            package: child.screen,
            script: child.script,
            ...(Object.keys(childIds).length ? { descriptors: childIds } : {}),
          },
        ];
      });
      const request = {
        op: "load",
        package: screen,
        script,
        descriptors: ids,
        ...(entries.length ? { components: Object.fromEntries(entries) } : {}),
        ...(Object.hasOwn(options, "clock") ? { clock: options.clock } : {}),
      };
      // The bundled children share the one request `call` sends, so the limit is reported here
      // with the size they added and the largest of them: `call` only knows the total.
      if (entries.length) {
        const total = this.encoder.encode(JSON.stringify(request)).length;
        if (total > 2_000_000) {
          const sizes = entries.map(([href, entry]) => [
            href,
            this.encoder.encode(JSON.stringify(entry)).length,
          ]);
          const [href, size] = sizes.reduce((a, b) => (b[1] > a[1] ? b : a));
          throw new Error(
            `リクエストが2 MBを超えています（同梱後 ${total} バイト。最大の子: ${href} ${size} バイト）`,
          );
        }
      }
      return this.call(request);
    } finally {
      for (const id of allocated) this.releaseBuffer(id);
    }
  }
  dispatch(target, payload = {}) {
    return this.call({ op: "event", target, payload });
  }
  progressHost(id, data, instance) {
    return this.call(withInstance({ op: "host_progress", id, data }, instance));
  }
  completeHost(id, response, instance) {
    return this.call(withInstance({ ...response, op: "host_result", id }, instance));
  }
  completeHttp(id, response, instance) {
    return this.call(withInstance({ op: "http_result", id, ...response }, instance));
  }
  completeStorage(id, response, instance) {
    return this.call(withInstance({ op: "storage_result", id, ...response }, instance));
  }
  completeDialog(id, response, instance) {
    return this.call(withInstance({ op: "dialog_result", id, ...response }, instance));
  }
  storeBuffer(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 1_000_000)
      throw new Error("バイナリは1 MB以内のUint8Arrayで指定してください");
    const pointer = this.exports.input_alloc(bytes.length);
    try {
      new Uint8Array(this.exports.memory.buffer, pointer, bytes.length).set(bytes);
      const id = this.exports.buffer_store(pointer, bytes.length);
      if (!id) throw new Error("バイナリバッファの容量を超えています");
      return id;
    } finally {
      this.exports.input_free(pointer, bytes.length);
    }
  }
  readBuffer(id) {
    const pointer = this.exports.buffer_ptr(id);
    if (!pointer) throw new Error("無効なバイナリバッファです");
    return new Uint8Array(this.exports.memory.buffer, pointer, this.exports.buffer_len(id)).slice();
  }
  releaseBuffer(id) {
    this.exports.buffer_free(id);
  }
  completeFile(id, response, instance) {
    return this.completeBinary("file_result", id, response, instance);
  }
  completeRpc(id, response, instance) {
    return this.completeBinary("rpc_result", id, response, instance);
  }
  completeBinary(op, id, response, instance) {
    const buffer =
      response.data instanceof Uint8Array ? this.storeBuffer(response.data) : undefined;
    try {
      return this.call(
        withInstance({ op, id, ...response, ...(buffer ? { data: null, buffer } : {}) }, instance),
      );
    } finally {
      if (buffer) this.releaseBuffer(buffer);
    }
  }
  layout(width) {
    return this.call({ op: "layout", width });
  }
  theme(theme) {
    return this.call(theme === undefined ? { op: "theme" } : { op: "theme", theme });
  }
}
