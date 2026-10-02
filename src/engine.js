// Browser boundary only: UTF-8 memory exchange and the native Wasm API.
export class WasmEngine {
  constructor(exports, bytes) {
    this.exports = exports;
    this.bytes = bytes;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
  }

  static async create(url) {
    const response = await fetch(url);
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

  load(screen, script) {
    return this.call({ op: "load", package: screen, script });
  }
  dispatch(target, payload = {}) {
    return this.call({ op: "event", target, payload });
  }
  layout(width) {
    return this.call({ op: "layout", width });
  }
  theme(theme) {
    return this.call(theme === undefined ? { op: "theme" } : { op: "theme", theme });
  }
}
