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

  async fetch(value, { signal } = {}) {
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
    let response = await this.#request(url, policy, credential?.token, signal);
    if (response.status === 401 && policy.session) {
      await response.body?.cancel().catch(() => {});
      try {
        credential = await policy.session.renew(credential.generation, { signal });
      } catch {
        this.#check(policy, signal);
        throw new Error("トークンを更新できませんでした。再認証してください");
      }
      this.#check(policy, signal);
      response = await this.#request(url, policy, credential.token, signal);
      if (response.status === 401) policy.session.invalidate();
    }
    if (!response.ok) {
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

  async #request(url, policy, token, signal) {
    const headers = new Headers();
    if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
    const authenticated = policy.mode === "jwt";
    let response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        mode: "cors",
        headers,
        cache: authenticated ? "no-store" : "no-cache",
        credentials: authenticated ? "omit" : "same-origin",
        redirect: authenticated ? "error" : "follow",
        signal,
      });
    } catch {
      this.#check(policy, signal);
      throw new Error("HTTP取得に失敗しました（通信・CORS・リダイレクトを確認してください）");
    }
    this.#check(policy, signal);
    return response;
  }

  async text(url, { signal } = {}) {
    const policy = this.#policy;
    const response = await this.fetch(url, { signal });
    const text = await response.text();
    this.#check(policy, signal);
    if (text.length > 1_000_000) throw new Error("ファイルが1 MBを超えています");
    return text;
  }
}
