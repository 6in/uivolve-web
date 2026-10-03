// Browser boundary only: UTF-8 memory exchange and the native Wasm API.
export class WasmEngine {
  constructor(exports, bytes) {
    this.exports = exports;
    this.bytes = bytes;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
  }

  static async create(url, { resources, signal } = {}) {
    const response = resources
      ? await resources.fetch(url, { signal })
      : await fetch(url, { signal });
    if (!response.ok) throw new Error(`WASM取得失敗: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new WasmEngine(instance.exports, bytes.byteLength);
  }

  call(request) {
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

  load(screen, script, descriptors = {}) {
    const ids = Object.create(null);
    try {
      for (const key of new Set(Object.values(screen.rpc ?? {}).map((r) => r.descriptor))) {
        if (!(descriptors[key] instanceof Uint8Array))
          throw new Error(`Descriptorがありません: ${key}`);
        ids[key] = this.storeBuffer(descriptors[key]);
      }
      return this.call({ op: "load", package: screen, script, descriptors: ids });
    } finally {
      for (const id of Object.values(ids)) this.releaseBuffer(id);
    }
  }
  dispatch(target, payload = {}) {
    return this.call({ op: "event", target, payload });
  }
  completeHttp(id, response) {
    return this.call({ op: "http_result", id, ...response });
  }
  completeStorage(id, response) {
    return this.call({ op: "storage_result", id, ...response });
  }
  completeDialog(id, response) {
    return this.call({ op: "dialog_result", id, ...response });
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
  completeFile(id, response) {
    return this.completeBinary("file_result", id, response);
  }
  completeRpc(id, response) {
    return this.completeBinary("rpc_result", id, response);
  }
  completeBinary(op, id, response) {
    const buffer =
      response.data instanceof Uint8Array ? this.storeBuffer(response.data) : undefined;
    try {
      return this.call({ op, id, ...response, ...(buffer ? { data: null, buffer } : {}) });
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
