import { readLimitedBytes } from "../resource-client.js";
import { httpUrl } from "../http-policy.js";
import { hostError } from "../host-effects.js";
import { FileClient } from "../file-client.js";
import { downloadFile } from "./http-download.js";
import { withFileLocks } from "../opfs.js";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const formats = ["json", "text", "empty"];
const optionsKeys = ["method", "path", "response", "headers", "responseHeaders"];
const transfers = ["http.download", "http.upload", "http.multipart"];

function transferArguments(operation, args, connection, { scope, files }, client) {
  const multipart = operation.action === "http.multipart";
  checkKeys(args, ["path", "query", multipart ? "parts" : "file"]);
  let size;
  try {
    size = new TextEncoder().encode(JSON.stringify(args)).length;
  } catch {
    throw hostError("INVALID_ARGUMENT", "HTTP引数をJSONへ変換できません");
  }
  if (size > 100_000) throw hostError("LIMIT", "HTTP引数が100 KBを超えています");
  const url = requestUrl(
    new URL(connection.baseUrl),
    operation.options.path ?? "",
    args.path,
    args.query,
  );
  const file = (value) => {
    checkKeys(value, ["volume", "path"]);
    try {
      return client.transferFile(scope, files, value.volume, value.path, {
        write: operation.action === "http.download",
      });
    } catch {
      throw hostError("INVALID_ARGUMENT", "HTTP fileの領域・権限・パスが不正です");
    }
  };
  if (!multipart) return { url, references: [file(args.file)] };
  if (!Array.isArray(args.parts) || args.parts.length > 32)
    throw hostError("INVALID_ARGUMENT", "HTTP partsは32項目以内の配列が必要です");
  let count = 0;
  const references = [];
  for (const part of args.parts) {
    checkKeys(part, ["name", "file", "filename", "contentType", "value"]);
    if (typeof part.name !== "string")
      throw hostError("INVALID_ARGUMENT", "HTTP part nameは文字列が必要です");
    if (Object.hasOwn(part, "file")) {
      if (
        Object.hasOwn(part, "value") ||
        (part.filename !== undefined && typeof part.filename !== "string") ||
        (part.contentType !== undefined && typeof part.contentType !== "string")
      )
        throw hostError("INVALID_ARGUMENT", "HTTP file partが不正です");
      if (++count > 8) throw hostError("INVALID_ARGUMENT", "HTTP filesは8件までです");
      references.push(file(part.file));
    } else if (
      typeof part.value !== "string" ||
      Object.hasOwn(part, "filename") ||
      Object.hasOwn(part, "contentType")
    ) {
      throw hostError("INVALID_ARGUMENT", "HTTP value partは文字列のみ指定できます");
    }
  }
  return { url, references };
}

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

export function httpAdapter({ resources, transferLimit = 104_857_600, files = new FileClient() }) {
  if (!Number.isSafeInteger(transferLimit) || transferLimit < 1)
    throw new Error("transferLimitには正の安全整数が必要です");
  return {
    name: "http",
    actions: ["http.request", ...transfers],
    transferLimit,
    validate(operation, connection, source) {
      checkKeys(connection, ["adapter", "baseUrl", "allowedHeaders"]);
      const transfer = transfers.includes(operation.action);
      const download = operation.action === "http.download";
      checkKeys(
        operation.options,
        transfer
          ? [...optionsKeys, "timeout", ...(download ? ["overwrite", "progressHandler"] : [])]
          : optionsKeys,
      );
      const options = operation.options;
      if (transfer) {
        if (options.method === undefined) options.method = download ? "GET" : "POST";
        if (options.timeout === undefined) options.timeout = 120;
        if (
          !(download ? options.method === "GET" : ["POST", "PUT"].includes(options.method)) ||
          !Number.isFinite(options.timeout) ||
          options.timeout < 1 ||
          options.timeout > 300 ||
          (options.response !== undefined && !formats.includes(options.response)) ||
          (options.overwrite !== undefined && typeof options.overwrite !== "boolean") ||
          (options.progressHandler !== undefined &&
            (typeof options.progressHandler !== "string" ||
              !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.progressHandler)))
        )
          throw hostError(
            "INVALID_ARGUMENT",
            "HTTP転送のmethod・timeout・overwrite・progressHandlerが不正です",
          );
      }
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
      if (options.path !== undefined && typeof options.path !== "string")
        throw hostError("INVALID_ARGUMENT", "HTTP pathは文字列が必要です");
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
      if (
        transfer &&
        options.headers &&
        Object.values(options.headers).some((value) => typeof value !== "string")
      )
        throw hostError("INVALID_ARGUMENT", "HTTP headersは文字列が必要です");
      if (operation.action === "http.multipart" && headers.has("content-type"))
        throw hostError("INVALID_ARGUMENT", "multipart Content-Typeはブラウザが生成します");
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
    async execute(operation, args, { signal, progress, connection, scope, files: declarations }) {
      if (transfers.includes(operation.action)) {
        const prepared = transferArguments(
          operation,
          args,
          connection,
          { scope, files: declarations },
          files,
        );
        if (operation.action === "http.download")
          return withFileLocks(
            prepared.references.map((reference) => reference.key),
            () =>
              downloadFile({
                resources,
                url: prepared.url,
                reference: prepared.references[0],
                file: args.file,
                options: operation.options,
                signal,
                progress,
                limit: transferLimit,
              }),
            { signal, locks: files.locks },
          );
        return withFileLocks(
          prepared.references.map((reference) => reference.key),
          async () => {
            signal.throwIfAborted();
            const selected = [];
            let size = 0;
            for (const reference of prepared.references) {
              let file;
              try {
                file = await reference.file({ signal });
              } catch {
                throw hostError("STORAGE", "OPFSファイルを取得できません", "not-started");
              }
              signal.throwIfAborted();
              if (file.size > transferLimit - size)
                throw hostError("LIMIT", "HTTP転送が容量上限を超えています", "not-started");
              size += file.size;
              selected.push(file);
            }
            const multipart = operation.action === "http.multipart";
            let body = selected[0];
            const metadata = [];
            if (multipart) {
              body = new FormData();
              let index = 0;
              for (const part of args.parts) {
                if (Object.hasOwn(part, "file")) {
                  const file = selected[index++];
                  body.append(
                    part.name,
                    file.slice(0, file.size, part.contentType ?? "application/octet-stream"),
                    part.filename ?? file.name,
                  );
                  metadata.push({ ...part.file, size: file.size });
                } else body.append(part.name, part.value);
              }
            } else metadata.push({ ...args.file, size: body.size });
            const options = operation.options;
            const headers = new Headers(options.headers);
            if (!multipart && !headers.has("content-type"))
              headers.set("Content-Type", "application/octet-stream");
            let response;
            try {
              response = await resources.transferRequest(prepared.url, {
                method: options.method,
                headers,
                body,
                signal,
                allowHttpErrors: true,
              });
            } catch (error) {
              throw hostError(
                "NETWORK",
                "HTTP通信・認証に失敗しました",
                error.outcome ?? "unknown",
              );
            }
            if (!response.ok) {
              await response.body?.cancel().catch(() => {});
              throw hostError(
                `HTTP_${response.status}`,
                `HTTP ${response.status}: リクエストに失敗しました`,
                "unknown",
              );
            }
            let payload = null;
            try {
              if ([204, 205].includes(response.status) || options.response === "empty") {
                await response.body?.cancel().catch(() => {});
              } else {
                const bytes = await readLimitedBytes(response, { signal, limit: 900_000 });
                const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                payload = options.response === "text" ? text : JSON.parse(text);
              }
            } catch {
              throw hostError("INVALID_RESPONSE", "HTTP応答のサイズ・形式が不正です", "committed");
            }
            const data = {
              status: response.status,
              headers: Object.fromEntries(
                (options.responseHeaders ?? []).map((key) => [key, response.headers.get(key)]),
              ),
              body: payload,
              files: metadata,
            };
            if (
              new TextEncoder().encode(JSON.stringify({ ok: true, data, error: null })).length >
              1_000_000
            )
              throw hostError("LIMIT", "HTTP応答が1 MBを超えています", "committed");
            return data;
          },
          { signal, locks: files.locks },
        );
      }
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
