import { bearerToken, httpUrl, secureOrigin } from "./http-policy.js";

const UPDATE_FAILED = "トークンを更新できませんでした。再認証してください";

function refreshToken(value) {
  // oxlint-disable-next-line no-control-regex -- Reject control bytes before JSON/form encoding.
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error("リフレッシュトークンを指定してください");
  return value;
}

function refreshAt(expiresIn) {
  if (expiresIn === undefined) return Infinity;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new Error("トークンの有効秒数には正の数を指定してください");
  const duration = expiresIn * 1000;
  const at = Date.now() + duration - Math.min(30_000, duration / 2);
  if (!Number.isSafeInteger(Math.ceil(at))) throw new Error("トークンの有効秒数が大きすぎます");
  return at;
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  return new Promise((resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject);
  }).finally(() => signal.removeEventListener("abort", abort));
}

// Owns credentials and refresh rotation; shared requests never expose these tokens.
export class TokenSession {
  #accessToken;
  #refreshToken;
  #url;
  #format;
  #clientId;
  #fetch;
  #refreshAt;
  #generation = 0;
  #pending;
  #controller;
  #invalid = false;

  constructor({ token, expiresIn, refresh, fetch: fetcher }) {
    this.#accessToken = bearerToken(token);
    if (!refresh || typeof refresh !== "object" || Array.isArray(refresh))
      throw new Error("リフレッシュ設定を指定してください");
    this.#url = httpUrl(refresh.url);
    if (!secureOrigin(this.#url) || this.#url.hash)
      throw new Error("更新先にはHTTPSのURLを指定してください（ローカル開発を除く）");
    this.#refreshToken = refreshToken(refresh.token);
    this.#format = refresh.format ?? "json";
    if (!["json", "oauth"].includes(this.#format))
      throw new Error("更新形式はjsonまたはoauthを指定してください");
    if (
      refresh.clientId !== undefined &&
      (this.#format !== "oauth" || typeof refresh.clientId !== "string" || !refresh.clientId.trim())
    )
      throw new Error("clientIdはOAuth形式の公開クライアントIDを指定してください");
    this.#clientId = refresh.clientId;
    this.#fetch = fetcher;
    this.#refreshAt = refreshAt(expiresIn);
  }

  metadata() {
    return { url: this.#url.href, format: this.#format };
  }

  invalidate() {
    this.#invalid = true;
    this.#accessToken = "";
    this.#refreshToken = "";
    this.#controller?.abort();
  }

  #check() {
    if (this.#invalid) throw new Error(UPDATE_FAILED);
  }

  #credential() {
    return { token: this.#accessToken, generation: this.#generation };
  }

  async access({ signal } = {}) {
    signal?.throwIfAborted();
    this.#check();
    if (this.#pending || Date.now() >= this.#refreshAt)
      return this.renew(this.#generation, { signal });
    return this.#credential();
  }

  async renew(generation, { signal } = {}) {
    signal?.throwIfAborted();
    this.#check();
    // A delayed 401 for an older generation reuses the already refreshed access token.
    if (generation !== undefined && generation !== this.#generation && !this.#pending)
      return this.#credential();
    if (!this.#pending) {
      const controller = new AbortController();
      this.#controller = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      this.#pending = this.#update(controller.signal).finally(() => {
        clearTimeout(timeout);
        this.#pending = undefined;
        this.#controller = undefined;
      });
    }
    // A caller can leave the wait; rotation continues for the other callers/session.
    return waitFor(this.#pending, signal);
  }

  async #update(signal) {
    try {
      const oauth = this.#format === "oauth";
      const payload = oauth
        ? new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.#refreshToken,
            ...(this.#clientId === undefined ? {} : { client_id: this.#clientId }),
          })
        : JSON.stringify({ refreshToken: this.#refreshToken });
      const response = await this.#fetch(new URL(this.#url), {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": oauth ? "application/x-www-form-urlencoded" : "application/json",
          Accept: "application/json",
        },
        body: payload,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error(UPDATE_FAILED);
      const text = await response.text();
      signal.throwIfAborted();
      this.#check();
      if (text.length > 64_000) throw new Error(UPDATE_FAILED);
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data) || data.error !== undefined)
        throw new Error(UPDATE_FAILED);
      const type = oauth ? data.token_type : data.tokenType;
      if (
        (oauth || type !== undefined) &&
        (typeof type !== "string" || type.toLowerCase() !== "bearer")
      )
        throw new Error(UPDATE_FAILED);
      const access = bearerToken(oauth ? data.access_token : data.accessToken);
      const rotated = oauth ? data.refresh_token : data.refreshToken;
      const refresh = rotated === undefined ? this.#refreshToken : refreshToken(rotated);
      const at = refreshAt(oauth ? data.expires_in : data.expiresIn);
      // Validate the whole response before replacing either token.
      this.#accessToken = access;
      this.#refreshToken = refresh;
      this.#refreshAt = at;
      this.#generation++;
      return this.#credential();
    } catch {
      this.invalidate();
      throw new Error(UPDATE_FAILED);
    }
  }
}
