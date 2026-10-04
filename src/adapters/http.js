import { readLimitedBytes } from "../resource-client.js";
import { httpUrl } from "../http-policy.js";
import { hostError } from "../host-effects.js";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const formats = ["json", "text", "empty"];
const optionsKeys = ["method", "path", "response", "headers", "responseHeaders"];

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function checkKeys(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw hostError("INVALID_ARGUMENT", "HTTP設定・引数に未知の属性があります");
}
function scalar(value) {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
function requestUrl(base, path, params = {}, query = {}) {
  if (
    typeof path !== "string" ||
    path.length > 2048 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[?#]/.test(path) ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  )
    throw hostError("INVALID_ARGUMENT", "HTTP pathは接続先からの相対パスを指定してください");
  if (!object(params) || !object(query))
    throw hostError("INVALID_ARGUMENT", "HTTPパス・queryの引数はオブジェクトが必要です");
  const replaced = path.replace(/\{([A-Za-z0-9_-]+)\}/g, (_, key) => {
    if (
      !Object.hasOwn(params, key) ||
      !scalar(params[key]) ||
      [".", "..", ""].includes(String(params[key])) ||
      /[/\\]/.test(String(params[key]))
    )
      throw hostError("INVALID_ARGUMENT", "HTTPパス変数が不正です");
    return encodeURIComponent(String(params[key]));
  });
  if (/[{}]/.test(replaced)) throw hostError("INVALID_ARGUMENT", "HTTPパス変数が不正です");
  const url = httpUrl(replaced, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    throw hostError("INVALID_ARGUMENT", "HTTPパスが接続先の範囲外です");
  for (const [key, value] of Object.entries(query)) {
    if (!scalar(value)) throw hostError("INVALID_ARGUMENT", "HTTP queryの値が不正です");
    url.searchParams.set(key, String(value));
  }
  return url;
}

export function httpAdapter({ resources }) {
  return {
    name: "http",
    actions: ["http.request"],
    validate(operation, connection, source) {
      checkKeys(connection, ["adapter", "baseUrl", "allowedHeaders"]);
      checkKeys(operation.options, optionsKeys);
      const options = operation.options;
      if (
        !methods.includes(options.method ?? "GET") ||
        !formats.includes(options.response ?? "json")
      )
        throw hostError("INVALID_ARGUMENT", "HTTP method・responseが不正です");
      if (typeof connection.baseUrl !== "string" || !connection.baseUrl)
        throw hostError("INVALID_ARGUMENT", "HTTP baseUrlが必要です");
      const base = httpUrl(connection.baseUrl, source);
      if (!base.pathname.endsWith("/") || base.search || base.hash)
        throw hostError("INVALID_ARGUMENT", "HTTP baseUrlは末尾/のディレクトリURLが必要です");
      connection.baseUrl = base.href;
      const dummy = Object.fromEntries(
        Array.from((options.path ?? "").matchAll(/\{([A-Za-z0-9_-]+)\}/g), (m) => [m[1], "value"]),
      );
      requestUrl(base, options.path ?? "", dummy);
      const allowed = connection.allowedHeaders ?? ["accept", "content-type"];
      if (!Array.isArray(allowed) || allowed.some((key) => typeof key !== "string"))
        throw hostError("INVALID_ARGUMENT", "HTTP allowedHeadersが不正です");
      const allowSet = new Set(allowed.map((key) => key.toLowerCase()));
      if (options.headers !== undefined && !object(options.headers))
        throw hostError("INVALID_ARGUMENT", "HTTP headersが不正です");
      const headers = new Headers(options.headers);
      for (const [key] of headers) {
        if (
          !allowSet.has(key) ||
          ["authorization", "cookie", "host"].includes(key) ||
          key.startsWith("sec-")
        )
          throw hostError("INVALID_ARGUMENT", "HTTP headerはホストで許可したものだけ指定できます");
      }
      if (
        options.responseHeaders !== undefined &&
        (!Array.isArray(options.responseHeaders) ||
          options.responseHeaders.some(
            (key) => typeof key !== "string" || /^(set-cookie|authorization)$/i.test(key),
          ))
      )
        throw hostError("INVALID_ARGUMENT", "HTTP responseHeadersが不正です");
    },
    async execute(operation, args, { signal, connection }) {
      checkKeys(args, ["path", "query", "body"]);
      const options = operation.options;
      const method = options.method ?? "GET";
      const url = requestUrl(
        new URL(connection.baseUrl),
        options.path ?? "",
        args.path,
        args.query,
      );
      let body;
      const headers = new Headers(options.headers);
      if (Object.hasOwn(args, "body")) {
        if (["GET", "HEAD"].includes(method))
          throw hostError("INVALID_ARGUMENT", "GET/HEADにbodyは指定できません");
        // v1 sends JSON bodies; text and binary will use explicit contracts in a later slice.
        body = new TextEncoder().encode(JSON.stringify(args.body));
        if (body.length > 100_000) throw hostError("LIMIT", "HTTP bodyが100 KBを超えています");
        headers.set("Content-Type", "application/json");
      }
      let response;
      try {
        response = await resources.fetch(url, {
          signal,
          method,
          headers,
          body,
          retryAuthentication: method === "GET" || method === "HEAD",
          allowHttpErrors: true,
        });
      } catch {
        signal.throwIfAborted();
        throw hostError("NETWORK", "HTTP通信・認証に失敗しました", "unknown");
      }
      const responseHeaders = Object.fromEntries(
        (options.responseHeaders ?? []).map((key) => [key, response.headers.get(key)]),
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw hostError(
          `HTTP_${response.status}`,
          `HTTP ${response.status}: リクエストに失敗しました`,
          "unknown",
        );
      }
      const outcome = ["GET", "HEAD"].includes(method) ? "failed" : "committed";
      let payload = null;
      try {
        if (
          method === "HEAD" ||
          response.status === 204 ||
          response.status === 205 ||
          options.response === "empty"
        ) {
          await response.body?.cancel().catch(() => {});
        } else {
          const bytes = await readLimitedBytes(response, { signal, limit: 900_000 });
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          payload = options.response === "text" ? text : JSON.parse(text);
        }
      } catch {
        throw hostError("INVALID_RESPONSE", "HTTP応答のサイズ・形式が不正です", outcome);
      }
      const data = { status: response.status, headers: responseHeaders, body: payload };
      if (
        new TextEncoder().encode(JSON.stringify({ ok: true, data, error: null })).length > 1_000_000
      )
        throw hostError("LIMIT", "HTTP応答が1 MBを超えています", outcome);
      return data;
    },
  };
}
