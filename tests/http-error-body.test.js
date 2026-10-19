import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { memoryOpfs } from "./helpers/opfs.js";
import { httpAdapter } from "../src/adapters/http.js";
import { FileClient } from "../src/file-client.js";
import { HostEffects } from "../src/host-effects.js";
import { ResourceClient } from "../src/resource-client.js";
import { UiRuntime } from "../src/runtime.js";
import { WasmEngine } from "../src/engine.js";

// Adapters are verified in-browser. These tests exercise the shared host with real WASM.
vi.mock("../src/dom-renderer.js", () => ({
  DomRenderer: class {
    constructor(stage) {
      this.stage = stage;
      this.render = vi.fn();
      this.reset = vi.fn();
      this.dispose = vi.fn();
    }
  },
}));
vi.mock("../src/canvas-renderer.js", () => ({
  CanvasRenderer: class {
    constructor(stage) {
      this.stage = stage;
      this.render = vi.fn();
      this.reset = vi.fn();
      this.dispose = vi.fn();
    }
  },
}));

// 失敗応答の受付（errorBody: json）の格子。段の記号は契約 §2.2 の (a)〜(g):
//   (a) body が null  (b) Content-Type  (c) 読み取り（network / too-large）  (d) 0 バイト
//   (e) fatal UTF-8   (f) JSON・object・深さ 64   (g) 受理
// どの行も「どの段で止まる想定か」を it 名の先頭に書く。転送経路（upload / download）は T3。

const SOURCE = new URL("https://example.test/screens/home.yaml");
const BASE_URL = "https://example.test/api/";
const JSON_CT = { "content-type": "application/json" };
/** 契約 §2.2: bodyError が取りうる値はこの 5 つだけ。 */
const BODY_ERRORS = ["empty", "content-type", "too-large", "invalid", "network"];
const encode = (text) => new TextEncoder().encode(text);
/** `{"a":` を depth 段かぶせる。最も深い値は depth 段目（root を depth 0 と数える）。 */
const nest = (depth, leaf) => `${'{"a":'.repeat(depth)}${leaf}${"}".repeat(depth)}`;

/**
 * WASM を介さず httpAdapter を直接 validate + execute する。validate が connection.baseUrl を
 * 正規化するので execute の前に必ず呼ぶ。
 */
function send(
  response,
  { optOut = false, method = "GET", controller = new AbortController() } = {},
) {
  const fetch = vi.fn(async () => response);
  const adapter = httpAdapter({ resources: { fetch } });
  const operation = {
    action: "http.request",
    options: { path: "items", method, ...(optOut ? {} : { errorBody: "json" }) },
  };
  const connection = { adapter: "http", baseUrl: BASE_URL };
  adapter.validate(operation, connection, SOURCE);
  const promise = adapter.execute(
    operation,
    {},
    {
      signal: controller.signal,
      progress: vi.fn(),
      connection,
      scope: "http-error-body",
      files: {},
    },
  );
  return { promise, fetch, controller, adapter, operation, connection };
}

/**
 * 失敗 1 件を受け取り、全行で共通の到達性を確かめる（契約 §6-1・§6-2・§6-7）。
 * `keys` は付く想定のキー: "body" / "bodyError" / "none"。付かない方は Object.hasOwn が false。
 */
async function failure(promise, status, keys) {
  const settled = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await expect(promise).rejects.toMatchObject({ code: `HTTP_${status}`, status });
  const { error, value } = await settled;
  expect(error, `失敗する想定が成功した: ${JSON.stringify(value)}`).toBeInstanceOf(Error);
  expect(error.message).toBe(`HTTP ${status}: リクエストに失敗しました`);
  expect(error.outcome).toBe("unknown");
  expect(Number.isInteger(error.status)).toBe(true);
  expect(error.status).toBe(status);
  // body と bodyError は同時に付かない。付かないキーは undefined ではなく「存在しない」。
  expect({
    body: Object.hasOwn(error, "body"),
    bodyError: Object.hasOwn(error, "bodyError"),
  }).toEqual({ body: keys === "body", bodyError: keys === "bodyError" });
  if (keys === "bodyError") expect(BODY_ERRORS).toContain(error.bodyError);
  return error;
}

describe("errorBody の宣言（契約 §1）", () => {
  it("errorBody は json だけを受け付け、ほかの値は prepare 時に落ちる", () => {
    const connection = { adapter: "http", baseUrl: BASE_URL };
    const adapter = httpAdapter({ resources: { fetch: vi.fn() } });
    for (const errorBody of ["json", undefined]) {
      const options = { path: "items", method: "GET", ...(errorBody ? { errorBody } : {}) };
      adapter.validate({ action: "http.request", options }, { ...connection }, SOURCE);
    }
    for (const errorBody of ["text", true, 1, null]) {
      expect(() =>
        adapter.validate(
          { action: "http.request", options: { path: "items", errorBody } },
          { ...connection },
          SOURCE,
        ),
      ).toThrow("HTTP errorBodyはjsonだけ指定できます");
    }
  });
});

describe("失敗本文の受付格子（request 経路）", () => {
  const rows = [
    // (a) body が null —— ヘッダーも中身も見ずに empty
    [
      "段 a",
      "body が null の 422",
      () => new Response(null, { status: 422 }),
      { bodyError: "empty" },
    ],
    // (d) 0 バイト —— Content-Type は通るが中身が無い
    [
      "段 d",
      "0 バイトの 422",
      () => new Response("", { status: 422, headers: JSON_CT }),
      { bodyError: "empty" },
    ],
    // (b) Content-Type —— 受付条件（application/json / application/problem+json / +json 接尾辞）の外
    [
      "段 b",
      "Content-Type ヘッダーが無い",
      () => new Response(encode("{}"), { status: 422 }),
      { bodyError: "content-type" },
    ],
    [
      "段 b",
      "text/plain（文字列 body にブラウザが付ける既定）",
      () => new Response("{}", { status: 422 }),
      { bodyError: "content-type" },
    ],
    [
      "段 b",
      "text/json",
      () => new Response("{}", { status: 422, headers: { "content-type": "text/json" } }),
      { bodyError: "content-type" },
    ],
    [
      "段 b",
      "application/jsonx",
      () => new Response("{}", { status: 422, headers: { "content-type": "application/jsonx" } }),
      { bodyError: "content-type" },
    ],
    [
      "段 b",
      "application/json+xml",
      () =>
        new Response("{}", { status: 422, headers: { "content-type": "application/json+xml" } }),
      { bodyError: "content-type" },
    ],
    [
      "段 b",
      "二重送出の application/json, application/json",
      () =>
        new Response("{}", {
          status: 422,
          headers: { "content-type": "application/json, application/json" },
        }),
      { bodyError: "content-type" },
    ],
    [
      "段 b",
      "二重送出の application/problem+json, application/problem+json",
      () =>
        new Response("{}", {
          status: 422,
          headers: { "content-type": "application/problem+json, application/problem+json" },
        }),
      { bodyError: "content-type" },
    ],
    // (g) 受理する Content-Type の 3 形
    [
      "段 g",
      "Application/Problem+JSON; charset=utf-8",
      () =>
        new Response('{"title":"入力に誤りがあります"}', {
          status: 422,
          headers: { "content-type": "Application/Problem+JSON; charset=utf-8" },
        }),
      { body: { title: "入力に誤りがあります" } },
    ],
    [
      "段 g",
      "application/vnd.x+json; v=1",
      () =>
        new Response('{"title":"独自メディア型"}', {
          status: 422,
          headers: { "content-type": "application/vnd.x+json; v=1" },
        }),
      { body: { title: "独自メディア型" } },
    ],
    [
      "段 g",
      "application/json",
      () => new Response('{"title":"素の JSON"}', { status: 422, headers: JSON_CT }),
      { body: { title: "素の JSON" } },
    ],
    [
      "段 g",
      "BOM 付きの {}",
      () =>
        new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), {
          status: 422,
          headers: JSON_CT,
        }),
      { body: {} },
    ],
    // (e) fatal UTF-8
    [
      "段 e",
      "単独の 0xff",
      () => new Response(new Uint8Array([0xff]), { status: 422, headers: JSON_CT }),
      { bodyError: "invalid" },
    ],
    [
      "段 e",
      "孤立サロゲート 0xed 0xa0 0x80",
      () => new Response(new Uint8Array([0xed, 0xa0, 0x80]), { status: 422, headers: JSON_CT }),
      { bodyError: "invalid" },
    ],
    // (f) JSON として壊れている / object でない / 深すぎる
    ...[
      ["配列 [1]", "[1]"],
      ['文字列 "x"', '"x"'],
      ["数値 1", "1"],
      ["null", "null"],
      ["壊れた {broken", "{broken"],
    ].map(([name, text]) => [
      "段 f",
      name,
      () => new Response(text, { status: 422, headers: JSON_CT }),
      { bodyError: "invalid" },
    ]),
    [
      "段 f",
      "object を 65 段重ねた入れ子（最も深い値が深さ 65）",
      () => new Response(nest(65, "1"), { status: 422, headers: JSON_CT }),
      { bodyError: "invalid" },
    ],
    [
      "段 f",
      "配列を 65 段重ねた入れ子（root が配列でもある）",
      () => new Response(`${"[".repeat(65)}1${"]".repeat(65)}`, { status: 422, headers: JSON_CT }),
      { bodyError: "invalid" },
    ],
    [
      "段 g",
      "object を 64 段重ねた入れ子（最も深い値が深さ 64）",
      () => new Response(nest(64, "1"), { status: 422, headers: JSON_CT }),
      { body: JSON.parse(nest(64, "1")) },
    ],
    // (f) 文字列が整形式 UTF-16 でない（JSON エスケープで表した孤立サロゲート）
    ...[
      ["値が孤立した下位サロゲート", '{"a":"\\udc00"}'],
      ["値が孤立した上位サロゲート", '{"a":"\\ud800"}'],
      ["キーが孤立サロゲート", '{"\\udc00":1}'],
      ["配列の中の object の値が孤立サロゲート", '{"a":[{"b":"\\udfff"}]}'],
    ].map(([name, text]) => [
      "段 f",
      name,
      () => new Response(encode(text), { status: 422, headers: JSON_CT }),
      { bodyError: "invalid" },
    ]),
    [
      "段 g",
      "正しいサロゲートペア（補助文字）は受理",
      () => new Response(encode('{"a":"\\ud83d\\ude00"}'), { status: 422, headers: JSON_CT }),
      { body: { a: "😀" } },
    ],
    [
      "段 g",
      "NUL と行区切りを含む文字列は受理",
      () =>
        new Response(encode('{"a":"\\u0000","b":"\\u2028"}'), { status: 422, headers: JSON_CT }),
      { body: { a: "\u0000", b: " " } },
    ],
    // 422 以外のステータスでも同じ段で止まる（code / status の到達性）
    [
      "段 a",
      "HEAD + 404（応答に body が無い）",
      () => new Response(null, { status: 404, headers: JSON_CT }),
      { bodyError: "empty" },
      404,
      "HEAD",
    ],
    [
      "段 g",
      "503 + problem+json",
      () =>
        new Response('{"title":"あとで再試行してください"}', {
          status: 503,
          headers: { "content-type": "application/problem+json" },
        }),
      { body: { title: "あとで再試行してください" } },
      503,
    ],
  ];

  it.each(rows)("%s: %s", async (_stage, _name, make, expected, status = 422, method = "GET") => {
    const keys = expected.bodyError === undefined ? "body" : "bodyError";
    const error = await failure(send(make(), { method }).promise, status, keys);
    if (keys === "bodyError") expect(error.bodyError).toBe(expected.bodyError);
    else expect(error.body).toEqual(expected.body);
  });

  it("段 c: 64,000 バイトちょうどは受理し、64,001 バイトは too-large", async () => {
    const exact = `{"a":"${"x".repeat(63_992)}"}`;
    const over = `{"a":"${"x".repeat(63_993)}"}`;
    expect(encode(exact).length).toBe(64_000);
    expect(encode(over).length).toBe(64_001);
    const accepted = await failure(
      send(new Response(exact, { status: 422, headers: JSON_CT })).promise,
      422,
      "body",
    );
    expect(accepted.body).toEqual({ a: "x".repeat(63_992) });
    const rejected = await failure(
      send(new Response(over, { status: 422, headers: JSON_CT })).promise,
      422,
      "bodyError",
    );
    expect(rejected.bodyError).toBe("too-large");
  });

  it("段 c: Content-Length を名乗るだけでは too-large にならない（実体だけを数える）", async () => {
    const text = '{"a":"bb"}';
    expect(encode(text).length).toBe(10);
    const error = await failure(
      send(
        new Response(text, {
          status: 422,
          headers: { ...JSON_CT, "content-length": "64001" },
        }),
      ).promise,
      422,
      "body",
    );
    expect(error.body).toEqual({ a: "bb" });
  });

  it("段 g: __proto__ は own property として受理し、原型を汚さない", async () => {
    const error = await failure(
      send(new Response('{"__proto__":{"x":1}}', { status: 422, headers: JSON_CT })).promise,
      422,
      "body",
    );
    expect(Object.hasOwn(error.body, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(error.body)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(error.body, "__proto__").value).toEqual({ x: 1 });
    expect({}.x).toBeUndefined();
  });

  it("段 c: 読み取り中に reader.read() が reject すると network", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encode('{"a":'));
      },
      pull(controller) {
        controller.error(new Error("読み取りに失敗しました"));
      },
    });
    const error = await failure(
      send(new Response(stream, { status: 422, headers: JSON_CT })).promise,
      422,
      "bodyError",
    );
    expect(error.bodyError).toBe("network");
  });

  it("段 c: 読み取りの途中で signal を abort すると network", async () => {
    const aborter = new AbortController();
    let pulled;
    const firstChunkRead = new Promise((resolve) => {
      pulled = resolve;
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encode('{"a":'));
        aborter.signal.addEventListener("abort", () => {
          try {
            controller.error(new DOMException("Aborted", "AbortError"));
          } catch {
            // 既に閉じている場合は何もしない。
          }
        });
      },
      pull() {
        pulled();
        // abort されるまで 2 本目の read を解決しない。
        return new Promise(() => {});
      },
    });
    const { promise } = send(new Response(stream, { status: 422, headers: JSON_CT }), {
      controller: aborter,
    });
    await firstChunkRead;
    aborter.abort();
    const error = await failure(promise, 422, "bodyError");
    expect(error.bodyError).toBe("network");
  });
});

describe("opt-out と応答の無い失敗（契約 §6-3・§6-4）", () => {
  it("errorBody 未指定なら status だけが付き、body も bodyError も付かない", async () => {
    const error = await failure(
      send(
        new Response('{"title":"入力に誤りがあります"}', {
          status: 422,
          headers: { "content-type": "application/problem+json" },
        }),
        { optOut: true },
      ).promise,
      422,
      "none",
    );
    expect(error.code).toBe("HTTP_422");
  });

  it("errorBody 未指定なら headers を持たない応答でも status だけを取り、本文を cancel する", async () => {
    const cancel = vi.fn(async () => {});
    const error = await failure(
      send({ ok: false, status: 403, body: { cancel } }, { optOut: true }).promise,
      403,
      "none",
    );
    expect(error.outcome).toBe("unknown");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("応答が返らない失敗（fetch が reject）には status が付かない", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const adapter = httpAdapter({ resources: { fetch } });
    const operation = {
      action: "http.request",
      options: { path: "items", method: "GET", errorBody: "json" },
    };
    const connection = { adapter: "http", baseUrl: BASE_URL };
    adapter.validate(operation, connection, SOURCE);
    const promise = adapter.execute(
      operation,
      {},
      {
        signal: new AbortController().signal,
        progress: vi.fn(),
        connection,
        scope: "http-error-body",
        files: {},
      },
    );
    const settled = promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await expect(promise).rejects.toMatchObject({ code: "NETWORK", outcome: "unknown" });
    const { error } = await settled;
    expect({
      status: Object.hasOwn(error, "status"),
      body: Object.hasOwn(error, "body"),
      bodyError: Object.hasOwn(error, "bodyError"),
    }).toEqual({ status: false, body: false, bodyError: false });
  });
});

describe("両 surface に同じ失敗本文が届く", () => {
  let wasm, bytes;
  const runtimes = [];
  beforeAll(async () => {
    bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
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
  // The host subscribes to the document's font set and to a resolution media query.
  function testDocument() {
    const view = {
      devicePixelRatio: 1,
      matchMedia: (media) => Object.assign(new EventTarget(), { media }),
    };
    return Object.assign(new EventTarget(), {
      defaultView: view,
      fonts: Object.assign(new EventTarget(), { status: "loading", ready: Promise.resolve() }),
    });
  }
  function stage(width = 400) {
    const element = {
      clientWidth: width,
      className: "host",
      ownerDocument: testDocument(),
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

  const problem = {
    type: "about:blank",
    title: "入力に誤りがあります",
    status: 422,
    errors: [{ field: "customer", code: "required", message: "顧客名を入力してください" }],
  };
  const definition = {
    version: 1,
    id: "http-error-body",
    title: "失敗本文",
    script: "home.rhai",
    state: { notice: "" },
    operations: {
      submit: {
        connection: "api",
        action: "http.request",
        handler: "received",
        options: { path: "orders", method: "POST", errorBody: "json" },
      },
    },
    ui: {
      xtype: "container",
      layout: "vbox",
      items: [
        { xtype: "button", itemId: "send", text: "送信", handler: "send" },
        { xtype: "label", itemId: "noticeLabel", bind: "notice" },
      ],
    },
  };
  const script =
    'fn init(s){s} fn send(s,e){host_call("submit", #{body: #{name:"太郎"}});s} ' +
    'fn received(s,r){ if !r.ok && "body" in r.error { ' +
    's.notice = r.error.status.to_string() + ": " + r.error.body.title; } s }';

  it("dom と canvas の両方に body.title 由来の notice が出て、state は 1 回だけ更新される", async () => {
    const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(problem), {
          status: 422,
          headers: { "content-type": "application/problem+json" },
        }),
    );
    const errors = [];
    const states = [];
    const runtime = new UiRuntime({
      baseUrl: "https://example.test/app/",
      engine,
      resources: new ResourceClient({ baseUrl: "https://example.test/app/", fetch }),
      connections: { api: { adapter: "http", baseUrl: "https://example.test/api/" } },
      surfaces: [
        { element: stage(400), renderer: "dom" },
        { element: stage(400), renderer: "canvas", canvas: {} },
      ],
      onError: (error) => {
        if (error) errors.push(error);
      },
      onState: (result) => states.push(result.state),
    });
    runtimes.push(runtime);
    await runtime.start();
    const complete = vi.spyOn(engine, "completeHost");
    runtime.compile(definition, script, "pages/home.yaml");
    expect(runtime.surfaces.map((surface) => surface.renderer)).toEqual(["dom", "canvas"]);
    runtime.dispatch("send");
    states.length = 0;
    await runtime.whenIdle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toMatchObject({
      ok: false,
      data: null,
      error: { code: "HTTP_422", outcome: "unknown", retryable: false, status: 422, body: problem },
    });
    expect(Object.hasOwn(complete.mock.calls[0][1].error, "bodyError")).toBe(false);
    // 失敗の完了で state が動くのは 1 回だけ。
    expect(states).toEqual([{ notice: "422: 入力に誤りがあります" }]);
    expect(runtime.state.notice).toBe("422: 入力に誤りがあります");

    const scenes = runtime.surfaces.map((surface) => {
      const calls = surface.adapter.render.mock.calls;
      expect(calls.length, surface.renderer).toBeGreaterThan(0);
      return calls.at(-1)[0].widgets;
    });
    for (const [index, widgets] of scenes.entries()) {
      const label = widgets.find((widget) => widget.key === "noticeLabel");
      expect(JSON.stringify(label), runtime.surfaces[index].renderer).toContain(
        "422: 入力に誤りがあります",
      );
    }
    expect(scenes[1]).toEqual(scenes[0]);
    expect(errors).toEqual([]);
  });

  // 孤立サロゲートを含む本文は JSON.stringify が \udc00 のまま出し、engine 側の serde_json が
  // 要求全体を拒否して完了が handler に届かなくなる。段 f で invalid に落として 1 回だけ返す。
  it("孤立サロゲートの本文は bodyError: invalid として handler に 1 回だけ届く", async () => {
    const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
    const fetch = vi.fn(
      async () => new Response(encode('{"a":"\\udc00"}'), { status: 422, headers: JSON_CT }),
    );
    const errors = [];
    const states = [];
    const runtime = new UiRuntime({
      baseUrl: "https://example.test/app/",
      engine,
      resources: new ResourceClient({ baseUrl: "https://example.test/app/", fetch }),
      connections: { api: { adapter: "http", baseUrl: "https://example.test/api/" } },
      surfaces: [
        { element: stage(400), renderer: "dom" },
        { element: stage(400), renderer: "canvas", canvas: {} },
      ],
      onError: (error) => {
        if (error) errors.push(error);
      },
      onState: (result) => states.push(result.state),
    });
    runtimes.push(runtime);
    await runtime.start();
    const complete = vi.spyOn(engine, "completeHost");
    runtime.compile(
      definition,
      'fn init(s){s} fn send(s,e){host_call("submit", #{body: #{name:"太郎"}});s} ' +
        'fn received(s,r){ if !r.ok && "bodyError" in r.error { ' +
        's.notice = r.error.status.to_string() + ": " + r.error.bodyError; } s }',
      "pages/home.yaml",
    );
    runtime.dispatch("send");
    states.length = 0;
    await runtime.whenIdle();

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toMatchObject({
      ok: false,
      error: { code: "HTTP_422", outcome: "unknown", status: 422, bodyError: "invalid" },
    });
    expect(Object.hasOwn(complete.mock.calls[0][1].error, "body")).toBe(false);
    expect(states).toEqual([{ notice: "422: invalid" }]);
    for (const surface of runtime.surfaces) {
      const widgets = surface.adapter.render.mock.calls.at(-1)[0].widgets;
      const label = widgets.find((widget) => widget.key === "noticeLabel");
      expect(JSON.stringify(label), surface.renderer).toContain("422: invalid");
    }
    expect(errors).toEqual([]);
  });
});

// ここから T3: 転送 3 経路（http.upload / http.download / http.multipart）の失敗本文。
// 段の記号は上のコメント（:30-33）と同じ (a)〜(g)。download の outcome は常に "failed"、
// upload / multipart は "unknown"（契約 §2.1-5・§2.2-3）。

/**
 * 転送 3 経路を httpAdapter 直叩きで走らせる最小フィクスチャ。
 * tests/opfs-file-transfer.test.js の transferValidation（:128-154）・downloadFixture（:630-677）・
 * uploadFixture（:957-974）から失敗本文の検査に要る分だけを写したもの（あちらは担当が別）。
 */
async function transfer(action, response, { optOut = false } = {}) {
  const fs = memoryOpfs();
  const files = new FileClient({ storage: fs.storage });
  const resources = { fetch: vi.fn(), transferRequest: vi.fn(async () => response) };
  const adapter = httpAdapter({ resources, transferLimit: 1_048_576, files });
  const operation = {
    action,
    options: { path: "items/{id}", ...(optOut ? {} : { errorBody: "json" }) },
  };
  const connection = { adapter: "http", baseUrl: BASE_URL };
  const context = {
    scope: "http-error-body",
    files: { writable: { access: "readwrite" } },
    signal: new AbortController().signal,
    progress: vi.fn(),
    connection,
  };
  const file = { volume: "writable", path: "日本語.csv" };
  const args = {
    path: { id: "one" },
    ...(action === "http.multipart" ? { parts: [{ name: "file", file }] } : { file }),
  };
  // validate が baseUrl を正規化し method / timeout の既定を入れるので execute の前に必ず呼ぶ。
  adapter.validate(operation, connection, SOURCE);
  const reference = files.transferFile(context.scope, context.files, file.volume, file.path, {
    write: true,
  });
  // 送信側（upload / multipart）は実体が要る。download は作らない（既存なら上書き拒否で止まる）。
  if (action !== "http.download") {
    const writer = await reference.writable();
    await writer.write("abc");
    await writer.close();
  }
  return { promise: adapter.execute(operation, args, context), resources, reference, file };
}

/**
 * downloadFixture（opfs-file-transfer.test.js:652-675）と同じ形の偽 Response。
 * download は :53 で取った reader を failureDetails へそのまま渡すので、read は 1 本だけ共有する。
 */
function streamed(status, headers, chunks, read) {
  const queue = chunks.map((chunk) => (typeof chunk === "string" ? encode(chunk) : chunk));
  const reader = {
    read:
      read ??
      vi.fn(async () => (queue.length ? { value: queue.shift(), done: false } : { done: true })),
    cancel: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: { getReader: () => reader },
  };
}

/**
 * 転送経路の失敗 1 件の到達性。既存の failure()（:81-100）と同じ検査を outcome 可変で行う。
 * failure() は outcome が "unknown" 固定なので、本体は変えずにこちらを足した。
 */
async function transferFailure(promise, status, keys, outcome) {
  const settled = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await expect(promise).rejects.toMatchObject({ code: `HTTP_${status}`, status });
  const { error, value } = await settled;
  expect(error, `失敗する想定が成功した: ${JSON.stringify(value)}`).toBeInstanceOf(Error);
  expect(error.message).toBe(`HTTP ${status}: リクエストに失敗しました`);
  expect(error.outcome).toBe(outcome);
  expect(Number.isInteger(error.status)).toBe(true);
  expect(error.status).toBe(status);
  // body と bodyError は同時に付かない。付かないキーは undefined ではなく「存在しない」。
  expect({
    body: Object.hasOwn(error, "body"),
    bodyError: Object.hasOwn(error, "bodyError"),
  }).toEqual({ body: keys === "body", bodyError: keys === "bodyError" });
  if (keys === "bodyError") expect(BODY_ERRORS).toContain(error.bodyError);
  return error;
}

describe("失敗本文の受付格子（転送 3 経路）", () => {
  const overflow = `{"a":"${"x".repeat(63_993)}"}`;
  const rows = [
    // ---- upload: 5 値ぜんぶ。outcome は request と同じ "unknown" が既定。 ----
    // (d) 0 バイト —— Content-Type は通るが中身が無い
    [
      "段 d",
      "upload: 0 バイトの 422",
      "http.upload",
      () => new Response("", { status: 422, headers: JSON_CT }),
      "empty",
      "unknown",
    ],
    // (b) Content-Type —— 文字列 body にブラウザが付ける text/plain は受付条件の外
    [
      "段 b",
      "upload: text/plain の 422",
      "http.upload",
      () => new Response("{}", { status: 422 }),
      "content-type",
      "unknown",
    ],
    // (c) 受信バイト累計が 64,000 を超えた
    [
      "段 c",
      "upload: 64,001 バイトの 422",
      "http.upload",
      () => new Response(overflow, { status: 422, headers: JSON_CT }),
      "too-large",
      "unknown",
    ],
    // (f) JSON として壊れている
    [
      "段 f",
      "upload: 壊れた {broken の 422",
      "http.upload",
      () => new Response("{broken", { status: 422, headers: JSON_CT }),
      "invalid",
      "unknown",
    ],
    // (c) 読み取り中の例外
    [
      "段 c",
      "upload: 読み取りが reject する 422",
      "http.upload",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encode('{"a":'));
            },
            pull(controller) {
              controller.error(new Error("読み取りに失敗しました"));
            },
          }),
          { status: 422, headers: JSON_CT },
        ),
      "network",
      "unknown",
    ],
    // ---- download: 5 値ぜんぶ。outcome は clientErrorOutcome に関係なく常に "failed"。 ----
    // (a) body が null —— 404 等。reader が undefined のまま failureDetails へ渡る
    [
      "段 a",
      "download: body が無い 404",
      "http.download",
      () => ({ ok: false, status: 404, headers: new Headers(JSON_CT), body: null }),
      "empty",
      "failed",
      404,
    ],
    [
      "段 b",
      "download: text/plain の 422",
      "http.download",
      () => streamed(422, { "content-type": "text/plain" }, ["{}"]),
      "content-type",
      "failed",
    ],
    [
      "段 c",
      "download: 64,001 バイトの 422",
      "http.download",
      () => streamed(422, JSON_CT, [new Uint8Array(64_001)]),
      "too-large",
      "failed",
    ],
    [
      "段 f",
      "download: 壊れた {broken の 422",
      "http.download",
      () => streamed(422, JSON_CT, ["{broken"]),
      "invalid",
      "failed",
    ],
    [
      "段 c",
      "download: read() が reject する 422",
      "http.download",
      () =>
        streamed(
          422,
          JSON_CT,
          [],
          vi.fn(async () => {
            throw new DOMException("read", "UnexpectedError");
          }),
        ),
      "network",
      "failed",
    ],
    // ---- multipart: upload と同じ関数を通るので 1 行だけ。 ----
    [
      "段 c",
      "multipart: 64,001 バイトの 422",
      "http.multipart",
      () => new Response(overflow, { status: 422, headers: JSON_CT }),
      "too-large",
      "unknown",
    ],
  ];

  it.each(rows)("%s: %s", async (_stage, _name, action, make, bodyError, outcome, status = 422) => {
    const { promise } = await transfer(action, make());
    const error = await transferFailure(promise, status, "bodyError", outcome);
    expect(error.bodyError).toBe(bodyError);
  });
});

describe("同じ操作の 2 回目が 1 回目の失敗本文の読み取り中に走る（決めた事項 22）", () => {
  let wasm, bytes;
  beforeAll(async () => {
    bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
    wasm = await WebAssembly.compile(bytes);
  });

  const definition = {
    version: 1,
    id: "http-error-body-concurrent",
    title: "失敗本文の並行",
    script: "home.rhai",
    state: { notice: "" },
    operations: {
      submit: {
        connection: "api",
        action: "http.request",
        handler: "received",
        options: { path: "orders", method: "POST", errorBody: "json" },
      },
    },
    ui: {
      xtype: "container",
      items: [{ xtype: "button", itemId: "send", text: "送信", handler: "send" }],
    },
  };
  const script =
    'fn init(s){s} fn send(s,e){host_call("submit", #{body: #{name:"太郎"}});s} ' +
    "fn received(s,r){s.notice = r.error.body.title;s}";

  it("2 回目が 1 回目の読み取り中に完了し、別 id のまま本文が取り違わらない", async () => {
    const engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
    engine.load(definition, script);
    // 1 本目は本文を手で解放できるストリーム。2 本目は普通の応答。
    let pulled;
    const firstChunkRead = new Promise((resolve) => {
      pulled = resolve;
    });
    let release;
    let released = false;
    const slow = new ReadableStream({
      start(controller) {
        controller.enqueue(encode('{"title":"一つ目"'));
      },
      pull(controller) {
        pulled();
        // finally からの後始末でも呼べるよう 2 回目以降は何もしない。
        release = () => {
          if (released) return;
          released = true;
          controller.enqueue(encode("}"));
          controller.close();
        };
        // release() が呼ばれるまで 2 本目の read を解決しない。
        return new Promise(() => {});
      },
    });
    const problemHeaders = { "content-type": "application/problem+json" };
    const fetch = vi
      .fn(async () => new Response('{"title":"二つ目"}', { status: 422, headers: problemHeaders }))
      .mockImplementationOnce(
        async () => new Response(slow, { status: 422, headers: problemHeaders }),
      );
    const hostErrors = [];
    const complete = vi.fn((id, result) => engine.completeHost(id, result));
    const effects = new HostEffects({
      adapters: [httpAdapter({ resources: new ResourceClient({ baseUrl: SOURCE.href, fetch }) })],
      connections: { api: { adapter: "http", baseUrl: BASE_URL } },
      complete,
      onError: (error) => hostErrors.push(error),
    });
    effects.reset(effects.prepare(definition.operations, SOURCE.href));
    try {
      const first = engine.dispatch("send").effects;
      const pending = effects.run(first);
      await firstChunkRead;
      // ここで 1 本目は failureDetails の読み取りの途中で止まっている。
      const second = engine.dispatch("send").effects;
      await effects.run(second);
      expect(complete).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      release();
      await pending;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenCalledTimes(2);
      const ids = complete.mock.calls.map(([id]) => id);
      expect(new Set(ids).size).toBe(2);
      expect([...ids].sort()).toEqual([first[0].id, second[0].id].sort());
      const byId = new Map(complete.mock.calls.map(([id, result]) => [id, result]));
      expect(byId.get(first[0].id)).toMatchObject({
        ok: false,
        error: { code: "HTTP_422", status: 422, body: { title: "一つ目" } },
      });
      expect(byId.get(second[0].id)).toMatchObject({
        ok: false,
        error: { code: "HTTP_422", status: 422, body: { title: "二つ目" } },
      });
      for (const id of ids) expect(Object.hasOwn(byId.get(id).error, "bodyError")).toBe(false);
      expect(hostErrors).toEqual([]);
    } finally {
      effects.dispose();
      release?.();
    }
  });
});
