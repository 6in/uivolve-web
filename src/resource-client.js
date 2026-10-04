// HTTP resources belong to the host boundary, never to DSL/Rhai state.
import { bearerToken, httpUrl, secureOrigin } from "./http-policy.js";
import { TokenSession } from "./token-session.js";

export class ResourceClient {
  #base;
  #fetch;
  #policy = { mode: "none", allowedOrigins: [] };

  // Native browser fetch needs its Window receiver, even when stored on this client.
  constructor({ baseUrl, fetch: fetcher = (...args) => globalThis.fetch(...args) }) {
    this.#base = httpUrl(baseUrl);
    this.#fetch = fetcher;
  }

  setAuthentication({
    mode = "none",
    token,
    getToken,
    allowedOrigins = [this.#base.origin],
    refresh,
    expiresIn,
  } = {}) {
    let policy;
    if (mode === "none") {
      policy = { mode, allowedOrigins: [] };
    } else if (mode === "jwt") {
      if (!Array.isArray(allowedOrigins) || !allowedOrigins.length)
        throw new Error("JWTの送信先オリジンを指定してください");
      const origins = allowedOrigins.map((value) => {
        const url = httpUrl(value);
        if (url.pathname !== "/" || url.search || url.hash)
          throw new Error("JWTの送信先にはパスを含まないオリジンを指定してください");
        if (!secureOrigin(url))
          throw new Error("JWTの送信先にはHTTPSを指定してください（ローカル開発を除く）");
        return url.origin;
      });
      if (getToken !== undefined && (typeof getToken !== "function" || token !== undefined))
        throw new Error("tokenまたはgetTokenのどちらか一方を指定してください");
      if (getToken !== undefined && refresh !== undefined)
        throw new Error("getTokenと組み込みのリフレッシュ設定は併用できません");
      const fixedToken = getToken === undefined ? bearerToken(token) : undefined;
      const session =
        refresh === undefined
          ? undefined
          : new TokenSession({ token: fixedToken, expiresIn, refresh, fetch: this.#fetch });
      policy = {
        mode,
        allowedOrigins: [...new Set(origins)],
        getToken: session ? undefined : (getToken ?? (() => fixedToken)),
        session,
      };
    } else throw new Error("認証モードはnoneまたはjwtを指定してください");
    const previous = this.#policy;
    this.#policy = policy;
    previous.session?.invalidate();
    return this.getAuthentication();
  }

  // Metadata only: no token/provider can be read through this API.
  getAuthentication() {
    return {
      mode: this.#policy.mode,
      allowedOrigins: [...this.#policy.allowedOrigins],
      ...(this.#policy.session ? { refresh: this.#policy.session.metadata() } : {}),
    };
  }

  #check(policy, signal) {
    signal?.throwIfAborted();
    if (policy !== this.#policy) throw new Error("認証設定が変更されたため取得を中止しました");
  }

  async fetch(value, options = {}) {
    const { body } = options;
    if (body !== undefined && (!(body instanceof Uint8Array) || body.length > 1_010_000))
      throw new Error("HTTP bodyのサイズ・形式が不正です");
    return this.#fetchResource(value, options);
  }

  // Only the host transfer adapter uses this path; bytes never enter Rhai/state.
  async transferRequest(value, options = {}) {
    const attempt = { started: false };
    try {
      const { body, method = "GET" } = options;
      if (
        !["GET", "POST", "PUT"].includes(method) ||
        (method === "GET"
          ? body !== undefined
          : !(body instanceof Blob || body instanceof FormData))
      )
        throw new Error("転送のHTTPメソッド・bodyが不正です");
      return await this.#fetchResource(value, { ...options, retryAuthentication: false }, attempt);
    } catch (error) {
      // Abort reasons and injected fetch/provider errors may contain credentials.
      throw Object.assign(new Error("HTTP転送に失敗しました"), {
        name: error?.name === "AbortError" ? "AbortError" : "Error",
        ...(error?.code === "NETWORK" ? { code: "NETWORK" } : {}),
        outcome: attempt.started ? "unknown" : "not-started",
      });
    }
  }

  async #fetchResource(
    value,
    {
      signal,
      method = "GET",
      headers,
      body,
      retryAuthentication = method === "GET",
      allowHttpErrors = false,
    } = {},
    attempt,
  ) {
    if (
      !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method) ||
      (["GET", "HEAD"].includes(method) && body !== undefined)
    )
      throw new Error("未対応のHTTPメソッド・bodyです");
    const extraHeaders = new Headers(headers);
    if (extraHeaders.has("Authorization"))
      throw new Error("認証ヘッダーは認証設定から付与してください");
    const options = { method, headers: extraHeaders, body };
    const url = httpUrl(value, this.#base);
    const policy = this.#policy;
    this.#check(policy, signal);
    const authenticated = policy.mode === "jwt";
    let credential;
    if (authenticated) {
      if (!policy.allowedOrigins.includes(url.origin))
        throw new Error("このURLはJWTの送信先として許可されていません");
      try {
        credential = policy.session
          ? await policy.session.access({ signal })
          : { token: await policy.getToken({ url: new URL(url), signal }) };
      } catch {
        this.#check(policy, signal);
        throw new Error(
          policy.session
            ? "トークンを更新できませんでした。再認証してください"
            : "JWTを取得できませんでした",
        );
      }
      this.#check(policy, signal);
      credential.token = bearerToken(credential.token);
    }
    let response = await this.#request(url, policy, credential?.token, signal, options, attempt);
    if (response.status === 401 && policy.session && retryAuthentication) {
      await response.body?.cancel().catch(() => {});
      try {
        credential = await policy.session.renew(credential.generation, { signal });
      } catch {
        this.#check(policy, signal);
        throw new Error("トークンを更新できませんでした。再認証してください");
      }
      this.#check(policy, signal);
      response = await this.#request(url, policy, credential.token, signal, options);
      if (response.status === 401) policy.session.invalidate();
    }
    if (!response.ok && !allowHttpErrors) {
      if (response.status === 401)
        throw new Error("HTTP 401: 認証が必要、またはJWTが無効・期限切れです");
      if (response.status === 403)
        throw new Error("HTTP 403: このリソースへのアクセス権限がありません");
      throw new Error(`HTTP ${response.status}: リソースを取得できませんでした`);
    }
    return response;
  }

  async refreshAuthentication({ signal } = {}) {
    const policy = this.#policy;
    this.#check(policy, signal);
    if (!policy.session) throw new Error("リフレッシュ設定がありません");
    try {
      await policy.session.renew(undefined, { signal });
    } catch {
      this.#check(policy, signal);
      throw new Error("トークンを更新できませんでした。再認証してください");
    }
    this.#check(policy, signal);
    return this.getAuthentication();
  }

  async #request(url, policy, token, signal, options, attempt) {
    const headers = new Headers(options.headers);
    if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
    const authenticated = policy.mode === "jwt";
    let response;
    try {
      if (attempt) attempt.started = true;
      response = await this.#fetch(url, {
        method: options.method,
        ...(options.body !== undefined ? { body: options.body } : {}),
        mode: "cors",
        headers,
        cache: authenticated ? "no-store" : "no-cache",
        credentials: authenticated ? "omit" : "same-origin",
        redirect: authenticated ? "error" : "follow",
        signal,
      });
    } catch {
      this.#check(policy, signal);
      throw Object.assign(
        new Error("HTTP取得に失敗しました（通信・CORS・リダイレクトを確認してください）"),
        { code: "NETWORK" },
      );
    }
    this.#check(policy, signal);
    return response;
  }

  async text(url, { signal } = {}) {
    const policy = this.#policy;
    const response = await this.fetch(url, { signal });
    const bytes = await readLimitedBytes(response, { signal });
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    this.#check(policy, signal);
    return text;
  }
  async bytes(url, { signal, limit = 1_000_000 } = {}) {
    const policy = this.#policy;
    const response = await this.fetch(url, { signal });
    const data = await readLimitedBytes(response, { signal, limit });
    this.#check(policy, signal);
    return data;
  }
  async binaryRequest(url, options) {
    const policy = this.#policy;
    const response = await this.fetch(url, options);
    const bytes = await readLimitedBytes(response, { signal: options.signal, limit: 1_010_000 });
    this.#check(policy, options.signal);
    return { response, bytes };
  }
}
export async function readLimitedBytes(response, { signal, limit = 1_000_000 } = {}) {
  signal?.throwIfAborted();
  if (Number(response.headers.get("Content-Length")) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`応答が${limit / 1_000_000} MBのサイズ上限を超えています`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        signal?.throwIfAborted();
        throw Object.assign(new Error("HTTP応答の受信中に通信が切れました"), { code: "NETWORK" });
      }
      const { done, value } = chunk;
      signal?.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error(`応答が${limit / 1_000_000} MBのサイズ上限を超えています`);
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return data;
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
