import { httpUrl } from "./http-policy.js";

export function grpcFrame(bytes, flag = 0) {
  const frame = new Uint8Array(bytes.length + 5);
  frame[0] = flag;
  new DataView(frame.buffer).setUint32(1, bytes.length);
  frame.set(bytes, 5);
  return frame;
}
export function grpcResponse(bytes, headers) {
  let offset = 0,
    message,
    status = headers.get("grpc-status"),
    detail = headers.get("grpc-message") ?? "",
    ended = false;
  while (offset < bytes.length) {
    if (ended || bytes.length - offset < 5) throw new Error("gRPC-Webフレームが不正です");
    const flag = bytes[offset];
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0);
    offset += 5;
    if (size > bytes.length - offset) throw new Error("gRPC-Webフレームが途切れています");
    const body = bytes.subarray(offset, offset + size);
    offset += size;
    if (flag === 128) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      for (const line of text.split("\r\n")) {
        const colon = line.indexOf(":");
        if (colon < 0 && line) throw new Error("gRPC-Web trailerが不正です");
        const key = line.slice(0, colon).toLowerCase(),
          value = line.slice(colon + 1).trim();
        if (key === "grpc-status") {
          status = value;
        }
        if (key === "grpc-message") {
          detail = value;
        }
      }
      ended = true;
    } else if (flag === 0 && message === undefined) message = body.slice();
    else throw new Error("圧縮・ストリーミングのgRPC-Webは未対応です");
  }
  if (status === null || !/^\d+$/.test(status)) throw new Error("gRPC statusがありません");
  if (status !== "0") {
    try {
      detail = decodeURIComponent(detail);
    } catch {
      /* Keep malformed server detail readable. */
    }
    throw new Error(`gRPC ${status}: ${detail.slice(0, 512)}`);
  }
  if (message === undefined || message.length > 1_000_000)
    throw new Error("gRPC応答メッセージのサイズ・件数が不正です");
  return message;
}
export class RpcClient {
  constructor({ resources, engine, timeout = 15_000 }) {
    this.resources = resources;
    this.engine = engine;
    this.timeout = timeout;
  }
  async execute(base, effect, { signal } = {}) {
    const url = httpUrl(effect.url, base);
    const data = this.engine.readBuffer(effect.buffer);
    const grpc = effect.protocol === "grpc-web";
    if (!grpc && effect.protocol !== "connect") throw new Error("未対応のRPCプロトコルです");
    const headers = grpc
      ? {
          "Content-Type": "application/grpc-web+proto",
          "X-Grpc-Web": "1",
          "grpc-timeout": `${this.timeout}m`,
        }
      : {
          "Content-Type": "application/proto",
          "Connect-Protocol-Version": "1",
          "Connect-Timeout-Ms": String(this.timeout),
        };
    const { response, bytes } = await this.resources.binaryRequest(url, {
      method: "POST",
      headers,
      body: grpc ? grpcFrame(data) : data,
      signal,
      retryAuthentication: effect.idempotent === true,
      allowHttpErrors: true,
    });
    if (!response.ok) {
      let detail = "";
      if (!grpc) {
        try {
          const error = JSON.parse(new TextDecoder().decode(bytes));
          detail = `${error.code ?? "unknown"}: ${String(error.message ?? "").slice(0, 512)}`;
        } catch {
          /* HTTP status remains available. */
        }
      }
      throw new Error(`RPC HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const type = response.headers.get("Content-Type")?.split(";")[0].trim();
    if (grpc) {
      if (type !== "application/grpc-web+proto" && type !== "application/grpc-web")
        throw new Error("gRPC-WebのContent-Typeが不正です");
      return grpcResponse(bytes, response.headers);
    }
    if (type !== "application/proto" || bytes.length > 1_000_000)
      throw new Error("Connect応答の形式・サイズが不正です");
    return bytes;
  }
}
