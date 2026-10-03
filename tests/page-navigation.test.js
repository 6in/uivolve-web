import { beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { PageEffects } from "../src/page-effects.js";
import { ApplicationLoader } from "../src/application-loader.js";
import { ResourceClient } from "../src/resource-client.js";
import { parsePackage } from "../src/package-format.js";

let wasm, bytes, screen, script, engine, assets;
const sourceUrl = new URL("https://example.test/uivolve-web/screens/page-navigation.yaml");
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  assets = Object.fromEntries(
    await Promise.all(
      [
        "page-navigation.yaml",
        "page-navigation.rhai",
        "page-navigation-detail.yaml",
        "page-navigation-detail.rhai",
      ].map(async (name) => [
        name,
        await readFile(new URL(`../public/screens/${name}`, import.meta.url), "utf8"),
      ]),
    ),
  );
  screen = parsePackage(assets["page-navigation.yaml"], "yaml");
  script = assets["page-navigation.rhai"];
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
  engine.load(screen, script);
});
const withOpen = (body) =>
  `fn init(s) {s} fn openDetails(s,e) {${body}} fn tryMissingPage(s,e) {s}`;

function fixture(overrides = {}) {
  let currentUrl = sourceUrl;
  const fetch = vi.fn(async (url) => {
    const name = url.pathname.split("/").at(-1);
    const content = Object.hasOwn(overrides, name) ? overrides[name] : assets[name];
    return content === undefined
      ? new Response("Not found", { status: 404 })
      : new Response(content);
  });
  const loader = new ApplicationLoader({
    resources: new ResourceClient({ baseUrl: sourceUrl, fetch }),
  });
  const onError = vi.fn();
  const host = new PageEffects({
    load: async (url) => {
      const candidate = await loader.fetch(url);
      engine.load(candidate.screen, candidate.script, candidate.descriptors);
      currentUrl = url;
      host.reset(url);
    },
    onError,
  });
  host.reset(sourceUrl);
  return { host, fetch, onError, currentUrl: () => currentUrl };
}

it("downloads separate YAML and Rhai in both directions and runs the destination handler", async () => {
  const { host, fetch, onError, currentUrl } = fixture();
  const started = engine.dispatch("openDetails");
  expect(started.effects).toEqual([
    { kind: "navigate", page: "details", url: "page-navigation-detail.yaml" },
  ]);
  await host.run(started.effects);
  expect(fetch.mock.calls.map(([url]) => url.href)).toEqual([
    "https://example.test/uivolve-web/screens/page-navigation-detail.yaml",
    "https://example.test/uivolve-web/screens/page-navigation-detail.rhai",
  ]);
  expect(fetch.mock.calls[0][1].mode).toBe("cors");
  expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBeNull();
  expect(currentUrl().pathname).toMatch(/page-navigation-detail\.yaml$/);
  engine.dispatch("destinationMemo", { value: "日本語のメモ" });
  expect(engine.dispatch("showMemo").state.notice).toBe("画面Bのメモ: 日本語のメモ");
  await host.run(engine.dispatch("returnHome").effects);
  expect(currentUrl()).toEqual(sourceUrl);
  expect(engine.layout(500).widgets.some((widget) => widget.target === "openDetails")).toBe(true);
  expect(engine.dispatch("sourceMemo", { value: "再取得後" }).state.memo).toBe("再取得後");
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(onError).not.toHaveBeenCalled();
});

it.each([
  ["404", {}, "tryMissingPage", /HTTP 404/],
  [
    "syntax",
    { "page-navigation-detail.rhai": "fn init(" },
    "openDetails",
    /page-navigation-detail.rhai/,
  ],
  [
    "init",
    {
      "page-navigation-detail.rhai":
        'fn init(s) {throw "cannot initialize";} fn showMemo(s,e) {s} fn returnHome(s,e) {s}',
    },
    "openDetails",
    /cannot initialize/,
  ],
  ["YAML", { "page-navigation-detail.yaml": "ui: [" }, "openDetails", /YAML/],
])(
  "preserves the current screen and input on %s failure",
  async (_, overrides, target, message) => {
    const { host, currentUrl, onError } = fixture(overrides);
    engine.dispatch("sourceMemo", { value: "失いたくないメモ" });
    const effects = engine.dispatch(target).effects;
    const before = engine.layout(500);
    await host.run(effects);
    expect(currentUrl()).toEqual(sourceUrl);
    expect(engine.layout(500)).toEqual(before);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(message);
  },
);

it.each([
  'navigate("details"); throw "stop";',
  'navigate("details"); s.memo=123; s',
  'navigate("unknown"); s.memo="changed"; s',
])("does not emit navigation or commit invalid state from a failed handler: %s", (body) => {
  const typed = {
    ...screen,
    stateSchema: { type: "object", properties: { memo: { type: "string" } }, required: ["memo"] },
  };
  engine.load(typed, withOpen(body));
  const before = engine.layout(500);
  expect(() => engine.dispatch("openDetails")).toThrow();
  expect(engine.layout(500)).toEqual(before);
  expect(engine.dispatch("sourceMemo", { value: "retry" }).effects).toBeUndefined();
});

it("rejects automatic init navigation, duplicates and mixed side effects", () => {
  expect(() =>
    engine.load(
      screen,
      script.replace("fn init(state) { state }", 'fn init(state) {navigate("details"); state}'),
    ),
  ).toThrow(/not init/);
  engine.load(screen, withOpen('navigate("details"); navigate("details"); s'));
  expect(() => engine.dispatch("openDetails")).toThrow(/one navigation/);
  engine.load(screen, withOpen('navigate("details"); alert("mixed"); s'));
  expect(() => engine.dispatch("openDetails")).toThrow(/combined with other effects/);
  expect(engine.dispatch("sourceMemo", { value: "still here" }).effects).toBeUndefined();
});

it("allows navigation from a validated HTTP completion handler", () => {
  const afterRequest = {
    ...screen,
    requests: { check: { url: "check.json", handler: "checked" } },
  };
  engine.load(
    afterRequest,
    withOpen('http_get("check"); s') + ' fn checked(s,r) {if r.ok {navigate("details");} s}',
  );
  const effect = engine.dispatch("openDetails").effects[0];
  expect(engine.completeHttp(effect.id, { ok: true, data: {} }).effects).toEqual([
    { kind: "navigate", page: "details", url: "page-navigation-detail.yaml" },
  ]);
});

it.each([
  { details: { url: "" } },
  { details: { url: " " } },
  { "": { url: "details.yaml" } },
  { details: { url: "a".repeat(2049) } },
  { details: { url: "details.yaml", unknown: true } },
  Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, { url: "details.yaml" }])),
])("validates page definitions before loading the candidate", (pages) => {
  const before = engine.layout(500);
  expect(() => engine.load({ ...screen, pages }, script)).toThrow();
  expect(engine.layout(500)).toEqual(before);
});

it.each([
  "javascript:alert(1)",
  "file:///tmp/page.yaml",
  "https://user:password@example.test/page.yaml",
])("rejects unsafe page URL %s before calling the loader", async (url) => {
  const load = vi.fn();
  const onError = vi.fn();
  const host = new PageEffects({ load, onError });
  host.reset(sourceUrl);
  await host.run([{ kind: "navigate", url }]);
  expect(load).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
});

it("ignores a late failure after another screen has committed", async () => {
  let reject;
  const onError = vi.fn();
  const host = new PageEffects({
    load: () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
    onError,
  });
  host.reset(sourceUrl);
  const running = host.run([{ kind: "navigate", url: "details.yaml" }]);
  host.reset(new URL("https://example.test/screens/other.yaml"));
  reject(new Error("old request failed"));
  await running;
  expect(onError).not.toHaveBeenCalled();
});
