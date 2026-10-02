// HTTP resources belong to the host boundary, never to DSL/Rhai state.
function httpUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error("HTTP / HTTPSのURLを指定してください");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("認証情報を含まないHTTP / HTTPSのURLを指定してください");
  return url;
}

function secureOrigin(url) {
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function bearerToken(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("JWTを指定してください");
  const token = value.trim();
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token))
    throw new Error("JWTにはBearerトークンの文字列だけを指定してください");
  return token;
}

export class ResourceClient {
  #base;
  #fetch;
  #policy = { mode: "none", allowedOrigins: [] };

  // Native browser fetch needs its Window receiver, even when stored on this client.
  constructor({ baseUrl, fetch: fetcher = (...args) => globalThis.fetch(...args) }) {
    this.#base = httpUrl(baseUrl);
    this.#fetch = fetcher;
  }

  setAuthentication({ mode = "none", token, getToken, allowedOrigins = [this.#base.origin] } = {}) {
    if (mode === "none") {
      this.#policy = { mode, allowedOrigins: [] };
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
      const fixedToken = getToken === undefined ? bearerToken(token) : undefined;
      this.#policy = {
        mode,
        allowedOrigins: [...new Set(origins)],
        getToken: getToken ?? (() => fixedToken),
      };
    } else throw new Error("認証モードはnoneまたはjwtを指定してください");
    return this.getAuthentication();
  }

  // Metadata only: no token/provider can be read through this API.
  getAuthentication() {
    return { mode: this.#policy.mode, allowedOrigins: [...this.#policy.allowedOrigins] };
  }

  #check(policy, signal) {
    signal?.throwIfAborted();
    if (policy !== this.#policy) throw new Error("認証設定が変更されたため取得を中止しました");
  }

  async fetch(value, { signal } = {}) {
    const url = httpUrl(value, this.#base);
    const policy = this.#policy;
    this.#check(policy, signal);
    const headers = new Headers();
    const authenticated = policy.mode === "jwt";
    if (authenticated) {
      if (!policy.allowedOrigins.includes(url.origin))
        throw new Error("このURLはJWTの送信先として許可されていません");
      let token;
      try {
        token = await policy.getToken({ url: new URL(url), signal });
      } catch {
        this.#check(policy, signal);
        throw new Error("JWTを取得できませんでした");
      }
      this.#check(policy, signal);
      headers.set("Authorization", `Bearer ${bearerToken(token)}`);
    }
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
    if (!response.ok) {
      if (response.status === 401)
        throw new Error("HTTP 401: 認証が必要、またはJWTが無効・期限切れです");
      if (response.status === 403)
        throw new Error("HTTP 403: このリソースへのアクセス権限がありません");
      throw new Error(`HTTP ${response.status}: リソースを取得できませんでした`);
    }
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
