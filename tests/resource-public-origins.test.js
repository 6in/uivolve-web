import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { httpAdapter } from "../src/adapters/http.js";
import { ApplicationLoader } from "../src/application-loader.js";
import { WasmEngine } from "../src/engine.js";
import { ResourceClient } from "../src/resource-client.js";
import { UiRuntime } from "../src/runtime.js";

// The runtime tests below drive real WASM; the renderers are verified in-browser elsewhere.
vi.mock("../src/dom-renderer.js", () => ({
  DomRenderer: class {
    render = vi.fn();
    reset = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("../src/canvas-renderer.js", () => ({
  CanvasRenderer: class {
    render = vi.fn();
    reset = vi.fn();
    dispose = vi.fn();
  },
}));

const baseUrl = "https://ui.example/demo/";
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJwdWJsaWMifQ.secret-signature";
const REFRESH = "refresh-secret-value";
const REFRESH_URL = "https://auth.example/token";

const create = (fetcher = vi.fn(async () => new Response("ok"))) => ({
  client: new ResourceClient({ baseUrl, fetch: fetcher }),
  fetcher,
});

// The previous policy every failing cell must leave untouched.
const previousOptions = () => ({
  mode: "jwt",
  token: TOKEN,
  allowedOrigins: ["https://ui.example"],
  publicOrigins: ["https://cdn.example"],
  refresh: { url: REFRESH_URL, token: REFRESH },
});

function configured() {
  const created = create();
  created.client.setAuthentication(previousOptions());
  return { ...created, before: created.client.getAuthentication() };
}

// main: setAuthentication(null) throws TypeError from destructuring; getters leak their message.
function expectConfigError(client, before, options, message) {
  let error;
  try {
    client.setAuthentication(options);
  } catch (e) {
    error = e;
  }
  expect(error).toBeDefined();
  expect(error).not.toBeInstanceOf(TypeError);
  expect(error.constructor).toBe(Error);
  expect(error.message).not.toContain(TOKEN);
  expect(error.message).not.toContain(REFRESH);
  if (message) expect(error.message).toContain(message);
  expect(client.getAuthentication()).toEqual(before);
  return error;
}

const throwingGetter = () =>
  Object.defineProperty({}, "mode", {
    enumerable: true,
    get() {
      throw new TypeError(`getter failed ${TOKEN} ${REFRESH}`);
    },
  });

describe("setAuthentication first argument", () => {
  const OBJECT_ERROR = "認証設定はオブジェクトで指定してください";
  const cells = [
    ["undefined", () => undefined, { ok: true }],
    ["null", () => null, { error: OBJECT_ERROR }],
    ["number", () => 1, { error: OBJECT_ERROR }],
    ["string", () => "jwt", { error: OBJECT_ERROR }],
    ["array", () => [], { error: OBJECT_ERROR }],
    ["function", () => () => {}, { error: OBJECT_ERROR }],
    ["null prototype without mode", () => Object.create(null), { ok: true }],
    ["throwing getter", throwingGetter, { error: "認証設定を読み取れませんでした" }],
  ];
  it.each(cells)("%s", (_name, value, expected) => {
    const { client, before } = configured();
    if (expected.ok) {
      expect(client.setAuthentication(value())).toEqual({
        mode: "none",
        allowedOrigins: [],
        publicOrigins: [],
      });
    } else expectConfigError(client, before, value(), expected.error);
  });

  it("treats a call without arguments as none", () => {
    const { client } = configured();
    expect(client.setAuthentication()).toEqual({
      mode: "none",
      allowedOrigins: [],
      publicOrigins: [],
    });
  });
});

const throwingString = () => ({
  toString() {
    throw new TypeError(`toString failed ${TOKEN}`);
  },
});

const ORIGIN_VALUES = [
  ["undefined", () => undefined],
  ["null", () => null],
  ["string", () => "https://a.example"],
  ["empty", () => []],
  ["duplicate", () => ["https://a.example", "https://a.example"]],
  ["path", () => ["https://a.example/p"]],
  ["query", () => ["https://a.example/?q=1"]],
  ["fragment", () => ["https://a.example/#f"]],
  ["userinfo", () => ["https://user:pass@a.example"]],
  ["http", () => ["http://10.0.0.1:8080"]],
  ["symbol", () => [Symbol("origin")]],
  ["throwing toString", () => [throwingString()]],
  ["null element", () => [null]],
  ["number element", () => [1]],
];

const URL_ERROR = "HTTP / HTTPSのURLを指定してください";
const USERINFO_ERROR = "認証情報を含まないHTTP / HTTPSのURLを指定してください";
const NONE = { ok: { allowedOrigins: [], publicOrigins: [] } };

// Expected outcome per (field, mode, value name).
const EXPECTED = {
  publicOrigins: {
    none: (name) =>
      name === "undefined" ? NONE : { error: "publicOriginsはJWTモードでだけ指定できます" },
    jwt: (name) =>
      ({
        undefined: { ok: { allowedOrigins: [baseOrigin()], publicOrigins: [] } },
        null: { error: "JWTなしで取得するオリジンは配列で指定してください" },
        string: { error: "JWTなしで取得するオリジンは配列で指定してください" },
        empty: { ok: { allowedOrigins: [baseOrigin()], publicOrigins: [] } },
        duplicate: { ok: { allowedOrigins: [baseOrigin()], publicOrigins: ["https://a.example"] } },
        path: { error: "JWTなしで取得するオリジンにはパスを含まないオリジンを指定してください" },
        query: { error: "JWTなしで取得するオリジンにはパスを含まないオリジンを指定してください" },
        fragment: {
          error: "JWTなしで取得するオリジンにはパスを含まないオリジンを指定してください",
        },
        userinfo: { error: USERINFO_ERROR },
        http: { ok: { allowedOrigins: [baseOrigin()], publicOrigins: ["http://10.0.0.1:8080"] } },
      })[name] ?? { error: URL_ERROR },
  },
  allowedOrigins: {
    none: () => NONE,
    jwt: (name) =>
      ({
        undefined: { ok: { allowedOrigins: [baseOrigin()], publicOrigins: [] } },
        null: { error: "JWTの送信先オリジンを指定してください" },
        string: { error: "JWTの送信先オリジンを指定してください" },
        empty: { error: "JWTの送信先オリジンを指定してください" },
        duplicate: { ok: { allowedOrigins: ["https://a.example"], publicOrigins: [] } },
        path: { error: "JWTの送信先にはパスを含まないオリジンを指定してください" },
        query: { error: "JWTの送信先にはパスを含まないオリジンを指定してください" },
        fragment: { error: "JWTの送信先にはパスを含まないオリジンを指定してください" },
        userinfo: { error: USERINFO_ERROR },
        http: { error: "JWTの送信先にはHTTPSを指定してください（ローカル開発を除く）" },
      })[name] ?? { error: URL_ERROR },
  },
};

function baseOrigin() {
  return new URL(baseUrl).origin;
}

describe.each(["publicOrigins", "allowedOrigins"])("%s grid", (field) => {
  describe.each(["none", "jwt"])("mode %s", (mode) => {
    it.each(ORIGIN_VALUES)("%s", (name, value) => {
      const { client, before } = configured();
      const options = { mode, token: TOKEN, [field]: value() };
      const expected = EXPECTED[field][mode](name);
      if (expected.error) {
        expectConfigError(client, before, options, expected.error);
        return;
      }
      const result = client.setAuthentication(options);
      expect(result).toEqual({ mode, ...expected.ok });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    });
  });
});

describe("other invalid JWT fields keep the previous policy", () => {
  const jwt = (extra) => ({ mode: "jwt", token: TOKEN, ...extra });
  const refresh = (extra) => ({ refresh: { url: REFRESH_URL, token: REFRESH }, ...extra });
  it.each([
    ["refresh null", jwt({ refresh: null }), "リフレッシュ設定を指定してください"],
    ["refresh number", jwt({ refresh: 1 }), "リフレッシュ設定を指定してください"],
    ["refresh array", jwt({ refresh: [] }), "リフレッシュ設定を指定してください"],
    ["refresh url number", jwt({ refresh: { url: 1, token: REFRESH } }), URL_ERROR],
    [
      "expiresIn string",
      jwt(refresh({ expiresIn: "x" })),
      "トークンの有効秒数には正の数を指定してください",
    ],
    [
      "getToken number",
      { mode: "jwt", getToken: 1 },
      "tokenまたはgetTokenのどちらか一方を指定してください",
    ],
    [
      "unknown mode",
      { mode: "basic", token: TOKEN },
      "認証モードはnoneまたはjwtを指定してください",
    ],
    // Order: allowedOrigins → publicOrigins → token (decision 5).
    [
      "allowedOrigins before publicOrigins",
      { mode: "jwt", token: "", allowedOrigins: [], publicOrigins: "x" },
      "JWTの送信先オリジンを指定してください",
    ],
    [
      "publicOrigins before token",
      { mode: "jwt", token: "", publicOrigins: "x" },
      "JWTなしで取得するオリジンは配列で指定してください",
    ],
  ])("%s", (_name, options, message) => {
    const { client, before } = configured();
    expectConfigError(client, before, options, message);
  });

  it("still sends the previous JWT after failed replacements", async () => {
    const { client, fetcher, before } = configured();
    expectConfigError(client, before, null, "認証設定はオブジェクトで指定してください");
    expectConfigError(client, before, { mode: "none", publicOrigins: [] });
    await client.text("screens/app.json");
    expect(fetcher.mock.lastCall[1].headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });
});

describe("host values that throw while being read (verify round 1, F1)", () => {
  const READ_ERROR = "認証設定を読み取れませんでした";
  const HOST = "host-message-marker";
  const leak = () => new TypeError(`${HOST} ${TOKEN} ${REFRESH}`);
  const revoked = (target = {}) => {
    const { proxy, revoke } = Proxy.revocable(target, {});
    revoke();
    return proxy;
  };
  // An origin list whose trap for `key` throws `thrown()`.
  const trapping = (key, thrown = leak) =>
    new Proxy(["https://a.example"], {
      get(target, property, receiver) {
        if (property === key) throw thrown();
        return Reflect.get(target, property, receiver);
      },
    });
  const throwingRefresh = (key, thrown = leak) =>
    Object.defineProperty({ url: REFRESH_URL, token: REFRESH }, key, {
      enumerable: true,
      get() {
        throw thrown();
      },
    });
  const jwt = (extra) => ({ mode: "jwt", token: TOKEN, ...extra });

  function expectReadError(options, message = READ_ERROR) {
    const { client, before } = configured();
    const error = expectConfigError(client, before, options, message);
    expect(error.message).not.toContain(HOST);
  }

  // Each row: name, options, comment on how main fails.
  it.each([
    // main: Array.isArray(revoked proxy) throws TypeError before the try.
    ["first argument revoked", () => revoked()],
    ...["allowedOrigins", "publicOrigins"].flatMap((field) => [
      // main: Array.isArray(revoked) throws TypeError outside the try.
      [`${field} revoked`, () => jwt({ [field]: revoked([]) })],
      // main: the length trap's TypeError (with the token) reaches the caller.
      [`${field} length trap`, () => jwt({ [field]: trapping("length") })],
      // main: map reads the index through the trap and leaks its message.
      [`${field} index trap`, () => jwt({ [field]: trapping("0") })],
      // main: the iterator was never read; now Array.from reads it inside the try.
      [`${field} iterator trap`, () => jwt({ [field]: trapping(Symbol.iterator) })],
    ]),
    // main: TokenSession's Array.isArray(revoked) throws TypeError.
    ["refresh revoked", () => jwt({ refresh: revoked() })],
    // main: TokenSession reads these getters and lets the host TypeError through.
    ...["url", "token", "format", "clientId"].map((key) => [
      `refresh.${key} getter`,
      () => jwt({ refresh: throwingRefresh(key) }),
    ]),
    // main: thrown non-Error values pass through unchanged (constructor is not Error).
    ["thrown string", () => jwt({ publicOrigins: trapping("length", () => `${HOST} ${TOKEN}`) })],
    ["thrown null", () => jwt({ allowedOrigins: trapping("length", () => null) })],
    ["thrown revoked proxy", () => jwt({ refresh: throwingRefresh("url", () => revoked()) })],
  ])("%s", (_name, options) => expectReadError(options()));

  it.each(
    ["allowedOrigins", "publicOrigins"].flatMap((field) => [
      // main: map skips the hole and the policy keeps undefined/accepts the list.
      [`${field} [, origin]`, field, () => Object.assign(Array(2), { 1: "https://a.example" })],
      // main: map skips every hole; publicOrigins [,] was accepted as an empty list.
      [`${field} [,]`, field, () => Array(1)],
    ]),
  )("%s is a URL error", (_name, field, value) => {
    expectReadError(jwt({ [field]: value() }), URL_ERROR);
  });

  it("no longer reads map, so a list whose map trap throws is accepted", () => {
    const { client } = configured();
    expect(client.setAuthentication(jwt({ publicOrigins: trapping("map") }))).toEqual({
      mode: "jwt",
      allowedOrigins: [baseOrigin()],
      publicOrigins: ["https://a.example"],
    });
  });
});

describe("getAuthentication with publicOrigins", () => {
  it("returns mode, allowedOrigins, publicOrigins, refresh in this order without tokens", () => {
    const { client } = configured();
    const metadata = client.getAuthentication();
    expect(Object.keys(metadata)).toEqual(["mode", "allowedOrigins", "publicOrigins", "refresh"]);
    expect(metadata).toEqual({
      mode: "jwt",
      allowedOrigins: ["https://ui.example"],
      publicOrigins: ["https://cdn.example"],
      refresh: { url: REFRESH_URL, format: "json" },
    });
    expect(JSON.stringify(metadata)).not.toContain(TOKEN);
    expect(JSON.stringify(metadata)).not.toContain(REFRESH);
  });

  it("returns copies that cannot change the policy", () => {
    const { client } = configured();
    const metadata = client.getAuthentication();
    metadata.publicOrigins.push("https://evil.example");
    metadata.allowedOrigins.push("https://evil.example");
    expect(client.getAuthentication().publicOrigins).toEqual(["https://cdn.example"]);
    expect(client.getAuthentication().allowedOrigins).toEqual(["https://ui.example"]);
  });

  it("keeps declaration order, normalizes origins, and keeps origins listed in both", () => {
    const { client } = create();
    const result = client.setAuthentication({
      mode: "jwt",
      token: TOKEN,
      allowedOrigins: ["https://api.example.com"],
      publicOrigins: [
        "https://UI.example.com:443/",
        "http://10.0.0.1:8080",
        "https://ui.example.com",
        "https://api.example.com",
      ],
    });
    expect(result.publicOrigins).toEqual([
      "https://ui.example.com",
      "http://10.0.0.1:8080",
      "https://api.example.com",
    ]);
    expect(result.allowedOrigins).toEqual(["https://api.example.com"]);
  });

  it("reports an empty publicOrigins list for none and for the initial state", () => {
    const { client } = create();
    expect(client.getAuthentication()).toEqual({
      mode: "none",
      allowedOrigins: [],
      publicOrigins: [],
    });
    client.setAuthentication({ mode: "jwt", token: TOKEN });
    expect(client.getAuthentication().publicOrigins).toEqual([]);
  });
});

const API = "https://api.example.com";
const UI = "https://ui.example.com";
const BOTH = "https://both.example.com";
const STRANGER = "https://x.example.com";
const NEXT = "header.next.signature";
const REJECTED = "このURLはJWTの送信先として許可されていません";
const authorization = ([, init]) => new Headers(init.headers).get("Authorization");

describe("R5: the rejection names the origin and the lists only", () => {
  const SECRET = `${STRANGER}/secret/path?token=abc#frag`;
  it.each([
    [[], `${REJECTED}: ${STRANGER}（許可: ${API}）`],
    [[UI], `${REJECTED}: ${STRANGER}（許可: ${API}、JWTなし: ${UI}）`],
  ])("publicOrigins %j", async (publicOrigins, message) => {
    const fetcher = vi.fn(async () => new Response("ok"));
    const getToken = vi.fn(async () => TOKEN);
    const client = new ResourceClient({ baseUrl: `${UI}/app/`, fetch: fetcher });
    client.setAuthentication({ mode: "jwt", getToken, allowedOrigins: [API], publicOrigins });
    const error = await client.text(SECRET).catch((e) => e);
    // main: the message stops at "許可されていません" with neither the origin nor the lists.
    expect(error.message).toBe(message);
    for (const secret of ["/secret", "token=abc", "#frag", TOKEN])
      expect(error.message).not.toContain(secret);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("JWT mode fetch: bearer, anonymous or rejected", () => {
  const ok = () => vi.fn(async () => new Response("ok"));
  function jwt(fetcher, extra = {}) {
    const client = new ResourceClient({ baseUrl: `${UI}/app/`, fetch: fetcher });
    client.setAuthentication({ mode: "jwt", allowedOrigins: [API], publicOrigins: [UI], ...extra });
    return client;
  }

  it("fetches a public origin without Authorization, with the JWT-mode settings, asking no token", async () => {
    const fetcher = ok();
    const getToken = vi.fn(async () => TOKEN);
    const client = jwt(fetcher, { getToken });
    // main: rejected before fetch because the page origin is not in allowedOrigins.
    expect(await client.text("screens/app.json")).toBe("ok");
    const [url, init] = fetcher.mock.lastCall;
    expect(url.href).toBe(`${UI}/app/screens/app.json`);
    expect(init.headers.has("Authorization")).toBe(false);
    expect(init).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      mode: "cors",
    });
    expect(getToken).not.toHaveBeenCalled();
  });

  it("neither refreshes nor invalidates the session on a 401 from a public origin", async () => {
    const fetcher = vi.fn(async (url) => {
      if (String(url) === REFRESH_URL) return Response.json({ accessToken: NEXT, expiresIn: 3600 });
      return url.origin === UI ? new Response("no", { status: 401 }) : new Response("api");
    });
    const client = jwt(fetcher, { token: TOKEN, refresh: { url: REFRESH_URL, token: REFRESH } });
    await expect(client.text("screens/app.json")).rejects.toThrow(
      "HTTP 401: 認証が必要、またはJWTが無効・期限切れです",
    );
    // A renew on the anonymous 401 would POST the refresh token (pitfall 11).
    expect(fetcher.mock.calls.filter(([url]) => String(url) === REFRESH_URL)).toHaveLength(0);
    expect(await client.text(`${API}/items`)).toBe("api");
    expect(authorization(fetcher.mock.lastCall)).toBe(`Bearer ${TOKEN}`);
  });

  it("sends the JWT to an origin listed in both and rejects an undeclared one unsent", async () => {
    const fetcher = ok();
    const client = jwt(fetcher, { token: TOKEN, allowedOrigins: [API, UI] });
    await client.text("screens/app.json");
    expect(authorization(fetcher.mock.lastCall)).toBe(`Bearer ${TOKEN}`);
    await expect(client.text(`${STRANGER}/x`)).rejects.toThrow(`${REJECTED}: ${STRANGER}（`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // Decision 7: the rule is applied to url.origin only.
  it.each([
    [UI, true],
    [`${UI}:443/x`, true],
    ["https://UI.example.com/x", true],
    [`${UI}:444/x`, false],
  ])("compares the normalized origin of %s", async (target, accepted) => {
    const fetcher = ok();
    const client = jwt(fetcher, { token: TOKEN });
    if (accepted) {
      await client.text(target);
      expect(authorization(fetcher.mock.lastCall)).toBeNull();
    } else {
      await expect(client.text(target)).rejects.toThrow(
        `${REJECTED}: ${UI}:444（許可: ${API}、JWTなし: ${UI}）`,
      );
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("abandons a public fetch when the authentication changes while it runs", async () => {
    let release;
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Response("late"));
        }),
    );
    const client = jwt(fetcher, { token: TOKEN });
    const pending = client.text("screens/app.json");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    client.setAuthentication({ mode: "jwt", token: TOKEN, allowedOrigins: [API] });
    release();
    await expect(pending).rejects.toThrow("認証設定が変更されたため取得を中止しました");
  });
});

describe("every fetch path × origin kind", () => {
  const R5 = `${REJECTED}: ${STRANGER}（許可: ${API}、${BOTH}、JWTなし: ${UI}、${BOTH}）`;
  let wasmBytes;
  beforeAll(async () => {
    wasmBytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  });
  afterEach(() => vi.restoreAllMocks());

  const adapterCall = (method) => (client, origin) => {
    const adapter = httpAdapter({ resources: client });
    const operation = { action: "http.request", options: { path: "items", method } };
    const connection = { adapter: "http", baseUrl: `${origin}/api/` };
    adapter.validate(operation, connection, `${UI}/app/home.json`);
    return adapter.execute(operation, method === "POST" ? { body: { a: 1 } } : {}, {
      signal: new AbortController().signal,
      progress: vi.fn(),
      connection,
      scope: "grid",
      files: {},
    });
  };
  // [entry, call, message of the rejection]. The adapter and transfer keep their generic messages.
  const ENTRIES = [
    ["text", (client, origin) => client.text(`${origin}/app/screen.json`), R5],
    ["bytes", (client, origin) => client.bytes(`${origin}/app/part.bin`), R5],
    [
      "binaryRequest",
      (client, origin) =>
        client.binaryRequest(`${origin}/rpc/Echo`, { method: "POST", body: new Uint8Array([1]) }),
      R5,
    ],
    [
      "WasmEngine.create",
      (client, origin) => WasmEngine.create(`${origin}/engine.wasm`, { resources: client }),
      R5,
    ],
    ["httpAdapter GET", adapterCall("GET"), "HTTP通信・認証に失敗しました"],
    ["httpAdapter POST", adapterCall("POST"), "HTTP通信・認証に失敗しました"],
    [
      "transferRequest",
      (client, origin) =>
        client.transferRequest(`${origin}/upload`, { method: "POST", body: new Blob(["file"]) }),
      "HTTP転送に失敗しました",
    ],
  ];
  const KINDS = [
    ["allowed", API, "bearer"],
    ["public", UI, "anonymous"],
    ["both", BOTH, "bearer"],
    ["undeclared", STRANGER, "rejected"],
  ];

  describe.each(ENTRIES)("%s", (_entry, run, rejection) => {
    it.each(KINDS)("%s origin", async (_kind, origin, expected) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const logs = ["log", "info", "warn", "error", "debug"].map((name) =>
        vi.spyOn(console, name).mockImplementation(() => {}),
      );
      const fetcher = vi.fn(async (url) => {
        if (String(url) === REFRESH_URL)
          return Response.json({ accessToken: NEXT, expiresIn: 3600 });
        if (url.pathname === "/engine.wasm") return new Response(wasmBytes);
        return Response.json({ ok: true });
      });
      const client = new ResourceClient({ baseUrl: `${UI}/app/`, fetch: fetcher });
      client.setAuthentication({
        mode: "jwt",
        token: TOKEN,
        allowedOrigins: [API, BOTH],
        publicOrigins: [UI, BOTH],
        expiresIn: 60,
        refresh: { url: REFRESH_URL, token: REFRESH },
      });
      // Inside the refresh margin: any session access POSTs the refresh token before sending.
      clock.mockReturnValue(1_031_000);
      let error;
      try {
        await run(client, origin);
      } catch (e) {
        error = e;
      }
      const refreshes = fetcher.mock.calls.filter(([url]) => String(url) === REFRESH_URL);
      const sent = fetcher.mock.calls.filter(([url]) => String(url) !== REFRESH_URL);
      if (expected === "rejected") {
        // main: R5 cells end at "許可されていません"; adapter and transfer cells already pass.
        expect(error?.message).toBe(rejection);
        expect(error).not.toBeInstanceOf(TypeError);
        expect(fetcher).not.toHaveBeenCalled();
        if (_entry === "transferRequest") expect(error.outcome).toBe("not-started");
      } else {
        // main: public cells are rejected; both cells pass.
        expect(error).toBeUndefined();
        expect(sent).toHaveLength(1);
        if (expected === "bearer") {
          expect(authorization(sent[0])).toBe(`Bearer ${NEXT}`);
          expect(refreshes).toHaveLength(1);
        } else {
          expect(authorization(sent[0])).toBeNull();
          expect(refreshes).toHaveLength(0);
        }
      }
      const printed = logs
        .flatMap((spy) => spy.mock.calls.flat())
        .map(String)
        .join("\n");
      for (const secret of [TOKEN, NEXT, REFRESH]) {
        expect(printed).not.toContain(secret);
        expect(error?.message ?? "").not.toContain(secret);
      }
    });
  });
});

describe("ApplicationLoader with publicOrigins", () => {
  const href = (path) => `${UI}/app/${path}`;
  const pkg = (id, components) => ({
    version: 1,
    id,
    title: id,
    script: `${id}.rhai`,
    state: {},
    ...(components ? { components } : {}),
    ui: {
      xtype: "container",
      items: Object.keys(components ?? {}).map((name) => ({ xtype: name, itemId: name })),
    },
  });
  function fixture() {
    const files = {
      "A.json": pkg("A", { part: { url: "a.json" } }),
      "B.json": pkg("B", { part: { url: "a.json" } }),
      "a.json": pkg("a"),
    };
    const reads = new Map();
    const fetcher = vi.fn(async (url) => {
      const path = url.pathname.replace("/app/", "");
      reads.set(path, (reads.get(path) ?? 0) + 1);
      if (path.endsWith(".rhai")) return new Response("fn init(s) { s }");
      return files[path] ? Response.json(files[path]) : new Response("missing", { status: 404 });
    });
    const resources = new ResourceClient({ baseUrl: href(""), fetch: fetcher });
    return { reads, fetcher, resources, loader: new ApplicationLoader({ resources }) };
  }
  const jwt = (publicOrigins) => ({
    mode: "jwt",
    token: TOKEN,
    allowedOrigins: [API],
    publicOrigins,
  });

  it("refuses network-first even when every resource is public", async () => {
    const f = fixture();
    f.resources.setAuthentication(jwt([UI]));
    await expect(f.loader.fetch(href("A.json"), { mode: "network-first" })).rejects.toThrow(
      "配信キャッシュは認証なしの場合に利用できます",
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("drops the shared children when only publicOrigins changes", async () => {
    const f = fixture();
    f.resources.setAuthentication(jwt([UI]));
    await f.loader.fetch(href("A.json"));
    for (const call of f.fetcher.mock.calls) expect(authorization(call)).toBeNull();
    f.resources.setAuthentication(jwt([UI]));
    await f.loader.fetch(href("B.json"));
    expect(f.reads.get("a.json")).toBe(1);
    f.resources.setAuthentication(jwt([UI, "https://cdn.example.com"]));
    await f.loader.fetch(href("B.json"));
    // main: getAuthentication() had no publicOrigins, so the child would be reused (1).
    expect(f.reads.get("a.json")).toBe(2);
  });
});

describe("UiRuntime over publicOrigins (real WASM)", () => {
  let wasm, size;
  const runtimes = [];
  beforeAll(async () => {
    const bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
    size = bytes.length;
    wasm = await WebAssembly.compile(bytes);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });
  afterAll(() => vi.unstubAllGlobals());

  function stage() {
    const view = {
      devicePixelRatio: 1,
      matchMedia: (media) => Object.assign(new EventTarget(), { media }),
    };
    const ownerDocument = Object.assign(new EventTarget(), {
      defaultView: view,
      fonts: Object.assign(new EventTarget(), { status: "loading", ready: Promise.resolve() }),
    });
    const element = {
      clientWidth: 400,
      className: "host",
      ownerDocument,
      contains: () => false,
      style: { setProperty: vi.fn() },
      dataset: {},
    };
    element.classList = {
      add: (...names) => {
        element.className += " " + names.join(" ");
      },
    };
    return element;
  }
  const card = () => ({
    version: 1,
    id: "card",
    title: "カード",
    script: "card.rhai",
    state: { picked: "" },
    ui: { xtype: "container", items: [{ xtype: "datepicker", itemId: "cal", bind: "picked" }] },
  });
  const home = () => ({
    version: 1,
    id: "home",
    title: "親画面",
    script: "home.rhai",
    state: { calls: 0 },
    components: { card: { url: "card.json" } },
    pages: { next: { url: `${STRANGER}/secret/next.json?token=abc` } },
    operations: {
      request: {
        connection: "api",
        action: "http.request",
        handler: "received",
        options: { path: "items", method: "GET" },
      },
    },
    ui: {
      xtype: "container",
      items: [
        { xtype: "card", itemId: "a", config: {} },
        { xtype: "button", itemId: "start", text: "start", handler: "start" },
        { xtype: "button", itemId: "away", text: "away", handler: "away" },
      ],
    },
  });
  const HOME_SCRIPT =
    'fn init(s){s} fn start(s,e){host_call("request", #{});s} fn received(s,r){s.calls+=1;s} fn away(s,e){navigate("next");s}';
  const fetcherFor = () =>
    vi.fn(async (url) => {
      if (url.origin === API) return Response.json({ value: 1 });
      const name = url.pathname.split("/").at(-1);
      if (name === "home.json") return Response.json(home());
      if (name === "card.json") return Response.json(card());
      if (name === "home.rhai") return new Response(HOME_SCRIPT);
      if (name === "card.rhai") return new Response("fn init(s){s}");
      return new Response("missing", { status: 404 });
    });
  async function host(fetcher) {
    const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, size);
    const resources = new ResourceClient({ baseUrl: `${UI}/app/`, fetch: fetcher });
    resources.setAuthentication({
      mode: "jwt",
      token: TOKEN,
      allowedOrigins: [API],
      publicOrigins: [UI],
    });
    const onError = vi.fn();
    const runtime = new UiRuntime({
      baseUrl: `${UI}/app/`,
      engine,
      resources,
      connections: { api: { adapter: "http", baseUrl: `${API}/api/` } },
      surfaces: [{ element: stage(), renderer: "dom" }],
      clockProvider: () => ({
        nowMs: Date.parse("2026-10-24T00:00:00+09:00"),
        tzOffsetMinutes: 540,
      }),
      onError,
    });
    runtimes.push(runtime);
    await runtime.start();
    return { runtime, onError };
  }
  const reported = (onError) => onError.mock.calls.filter(([error]) => error);

  // Round-trip probe: anonymous screen, Rhai and part; Bearer only on the API call.
  it("loads a public screen with a part anonymously and still sends the JWT to the API", async () => {
    const fetcher = fetcherFor();
    const { runtime, onError } = await host(fetcher);
    await runtime.load("pages/home.json");
    const loaded = fetcher.mock.calls.map((call) => [call[0].pathname, authorization(call)]);
    expect(loaded.sort()).toEqual([
      ["/app/pages/card.json", null],
      ["/app/pages/card.rhai", null],
      ["/app/pages/home.json", null],
      ["/app/pages/home.rhai", null],
    ]);
    runtime.dispatch("start");
    await vi.waitFor(() => expect(runtime.state.calls).toBe(1));
    const api = fetcher.mock.calls.filter(([url]) => url.origin === API);
    expect(api).toHaveLength(1);
    expect(authorization(api[0])).toBe(`Bearer ${TOKEN}`);
    expect(reported(onError)).toEqual([]);
  });

  it("reports the rejected origin through onError when a navigation leaves both lists", async () => {
    const fetcher = fetcherFor();
    const { runtime, onError } = await host(fetcher);
    await runtime.load("pages/home.json");
    const before = fetcher.mock.calls.length;
    runtime.dispatch("away");
    await vi.waitFor(() => expect(reported(onError)).toHaveLength(1));
    const { message } = reported(onError)[0][0];
    // main: the message carried no origin, so the host could not tell which list to fix.
    expect(message).toContain(`${STRANGER}（許可: ${API}、JWTなし: ${UI}）`);
    for (const secret of ["/secret", "token=abc", TOKEN]) expect(message).not.toContain(secret);
    expect(fetcher).toHaveBeenCalledTimes(before);
  });
});
