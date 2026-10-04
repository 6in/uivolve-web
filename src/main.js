import "./styles.css";
import { UiRuntime } from "./runtime.js";
import { applyTheme } from "./theme.js";
import { SCREEN_CATALOG, screenFile } from "./screen-catalog.js";
import { createUiTools, registerUiTools } from "./webmcp.js";
import { ResourceClient } from "./resource-client.js";
import { workerMockAdapter } from "./adapters/worker-mock.js";
import { packageFormat, parsePackage, stringifyPackage } from "./package-format.js";
import { readPageRoute, pageUrl } from "./page-router.js";
import { createScreenPicker } from "./screen-picker.js";

const $ = (id) => document.getElementById(id);
const base = new URL(import.meta.env.BASE_URL, window.location.href);
const resources = new ResourceClient({ baseUrl: base });
const bundledScreens = SCREEN_CATALOG.map((screen) => screen.id);
const controls = [
  "screen-select",
  "reload",
  "benchmark",
  "apply",
  "source-format",
  "load-url",
  "theme-select",
  "theme-apply",
  "theme-load-url",
  "auth-mode",
  "auth-token",
  "auth-origins",
  "auth-apply",
  "auth-refresh-enabled",
  "auth-refresh-url",
  "auth-refresh-token",
  "auth-refresh-format",
  "auth-refresh-client",
  "auth-expires-in",
  "cache-mode",
  "cache-clear",
];
let engine;
let packageUrl;
let currentPackage;
let webmcpRegistration;
let disposed = false;
let fetching = false;
let benchmarkRunning = false;
let scenes;
let themeFetching = false;
let themeChoice = "light";
let pendingRoute;
const screenPicker = createScreenPicker({
  list: $("sample-list"),
  select: $("screen-select"),
  baseUrl: base,
  onSelect: (id) => loadBundled(id),
});
$("sample-count").textContent = `${SCREEN_CATALOG.length}画面 · カテゴリから選択`;
function syncScreenPicker() {
  screenPicker.setState({
    id: currentPackage?.id,
    disabled: !engine || fetching || benchmarkRunning || themeFetching,
  });
}
syncScreenPicker();
function writeRoute(id, mode = "push") {
  const url = pageUrl(id, base, window.location.href);
  if (url.href !== window.location.href)
    window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
}
async function loadBundled(id, options = {}) {
  return load(new URL(`screens/${screenFile(id)}`, base), { ...options, routeId: id });
}
function restoreRoute() {
  if (bundledScreens.includes(currentPackage?.id)) writeRoute(currentPackage.id, "replace");
}
function followHistory() {
  if (!engine) return;
  try {
    const id = readPageRoute(window.location.href, base, bundledScreens);
    if (benchmarkRunning || themeFetching) {
      pendingRoute = id;
      return;
    }
    void loadBundled(id, { replacePending: true, historyMode: "replace" });
  } catch (exception) {
    error(exception.message);
    restoreRoute();
  }
}
window.addEventListener("popstate", followHistory);

function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function enableControls() {
  syncScreenPicker();
  for (const id of controls)
    $(id).disabled = !engine || fetching || benchmarkRunning || themeFetching;
  for (const id of ["auth-token", "auth-origins", "auth-refresh-enabled"])
    $(id).disabled ||= $("auth-mode").value !== "jwt";
  const refresh = $("auth-mode").value === "jwt" && $("auth-refresh-enabled").checked;
  $("auth-refresh-fields").hidden = !refresh;
  for (const id of [
    "auth-refresh-url",
    "auth-refresh-token",
    "auth-refresh-format",
    "auth-refresh-client",
    "auth-expires-in",
  ])
    $(id).disabled ||= !refresh;
  $("auth-refresh-client").disabled ||= $("auth-refresh-format").value !== "oauth";
  $("cache-mode").disabled ||= resources.getAuthentication().mode !== "none";
  if (pendingRoute && engine && !fetching && !benchmarkRunning && !themeFetching) {
    const id = pendingRoute;
    pendingRoute = undefined;
    void loadBundled(id, { replacePending: true, historyMode: "replace" });
  }
}
function updateState(result) {
  $("revision").textContent = String(result.revision).padStart(3, "0");
  $("state-view").textContent = JSON.stringify(result.state, null, 2);
}

const runtime = new UiRuntime({
  baseUrl: base,
  wasmUrl: new URL("engine.wasm", base),
  resources,
  adapters: [workerMockAdapter({ resources })],
  connections: {
    ordersMock: {
      adapter: "worker-mock",
      baseUrl: new URL("mock-api/", base).href,
      definition: new URL("mock/orders-api.yaml", base).href,
    },
  },
  surfaces: [
    { element: $("dom-stage"), renderer: "dom" },
    { element: $("canvas-stage"), canvas: $("canvas"), renderer: "canvas" },
  ],
  isBusy: () => benchmarkRunning || themeFetching,
  navigate: (url) => load(url, { throwOnError: true, routeFromPackage: true }),
  onError: (exception) => error(exception?.message ?? ""),
  onState: updateState,
  onBusy: (busy) => {
    fetching = busy;
    $("loading").hidden = !busy;
    $("loading").textContent = "画面定義とスクリプトをHTTPから読み込んでいます…";
    enableControls();
  },
  onRender: ({ scenes: rendered, durations }) => {
    scenes = rendered;
    applyTheme(document.documentElement, rendered[0].theme);
    $("dom-timing").textContent = `${durations[0].toFixed(2)} ms`;
    $("canvas-timing").textContent = `${durations[1].toFixed(2)} ms`;
  },
  onLoad: ({ screen, script, source, format, rawSource, duration }) => {
    engine = runtime.engine;
    currentPackage = screen;
    packageUrl = source;
    syncScreenPicker();
    $("wasm-size").textContent = `${Math.round(engine.bytes / 1024)} KiB`;
    $("source-format").value = format;
    editorFormat = format;
    $("dsl-source").value = rawSource ?? stringifyPackage(screen, format);
    $("script-source").value = script;
    $("screen-url").value = source.href;
    $("package-url").textContent = source.pathname;
    $("script-url").textContent = new URL(screen.script, source).pathname;
    $("compile-time").textContent = `${duration.toFixed(1)} ms`;
  },
  onCache: ({ status, fallbackReason, error: failure }) => {
    $("cache-message").textContent =
      status === "cache"
        ? `保存版から表示しています（${fallbackReason}）。`
        : status === "saved"
          ? "HTTPから表示し、配信キャッシュを保存しました。"
          : status === "save-error"
            ? `画面は表示できましたが、キャッシュを保存できませんでした。${failure.message}`
            : "HTTPから表示しています。";
  },
});
const dom = runtime.surfaces[0].adapter;
const canvas = runtime.surfaces[1].adapter;
const render = () => runtime.render();
const performEvent = (target, payload) => runtime.dispatch(target, payload);
const snapshot = () => runtime.snapshot();
function compile(screen, script, source, format = packageFormat(source), rawSource) {
  return runtime.compile(screen, script, source, { format, rawSource });
}
async function load(url, options = {}) {
  const {
    throwOnError = false,
    routeId: requestedId,
    routeFromPackage = false,
    historyMode = "push",
  } = options;
  if ((fetching && !options.replacePending) || benchmarkRunning || themeFetching) {
    if (throwOnError) throw new Error("画面の読み込み中です");
    return;
  }
  runtime.cacheMode = $("cache-mode").value;
  try {
    const candidate = await runtime.load(url, options);
    let routeId = requestedId;
    if (
      routeFromPackage &&
      bundledScreens.includes(candidate.screen.id) &&
      url.href === new URL(`screens/${screenFile(candidate.screen.id)}`, base).href
    )
      routeId = candidate.screen.id;
    if (routeId) writeRoute(routeId, historyMode);
    return true;
  } catch (exception) {
    if (exception.name !== "AbortError") {
      error(`画面を読み込めませんでした。${exception.message}`);
      if (requestedId && historyMode === "replace") restoreRoute();
    }
    if (throwOnError) throw exception;
  }
}

async function connectWebMCP() {
  try {
    webmcpRegistration = await registerUiTools(
      createUiTools({
        snapshot,
        dispatch: performEvent,
        loadScreen: (id, options) => loadBundled(id, { ...options, throwOnError: true }),
      }),
    );
    if (disposed) {
      webmcpRegistration.dispose();
      return;
    }
    $("webmcp-status").textContent =
      webmcpRegistration.status === "ready" ? `${webmcpRegistration.toolCount} tools` : "未対応";
    $("webmcp-status").title =
      webmcpRegistration.status === "ready"
        ? `${webmcpRegistration.api}.modelContext に登録済み`
        : "このブラウザではWebMCP APIを利用できません。共通ツール契約は準備済みです。";
  } catch (exception) {
    $("webmcp-status").textContent = "登録失敗";
    $("webmcp-status").title = exception.message;
  }
}

function themeError(message) {
  $("theme-error").textContent = message;
  $("theme-error").hidden = !message;
}

function setTheme(definition, choice, url) {
  const resolved = runtime.theme(definition);
  applyTheme(document.documentElement, resolved);
  $("theme-source").value = JSON.stringify(resolved, null, 2);
  $("theme-url").value = url?.href || "";
  themeChoice = choice;
  $("theme-select").value = choice;
  themeError("");
  render();
}

async function loadTheme(url, choice) {
  if (!engine || themeFetching || fetching || benchmarkRunning) return;
  themeFetching = true;
  enableControls();
  try {
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("HTTP / HTTPSのURLを指定してください");
    setTheme(JSON.parse(await resources.text(url)), choice, url);
  } catch (exception) {
    $("theme-select").value = themeChoice;
    $("theme-panel").hidden = false;
    $("theme-toggle").setAttribute("aria-expanded", "true");
    themeError(`配色を変更できませんでした。${exception.message}`);
  } finally {
    themeFetching = false;
    enableControls();
  }
}

$("theme-select").addEventListener("change", () =>
  loadTheme(new URL(`themes/${$("theme-select").value}.json`, base), $("theme-select").value),
);
$("theme-toggle").addEventListener("click", () => {
  const open = $("theme-panel").hidden;
  $("theme-panel").hidden = !open;
  $("theme-toggle").setAttribute("aria-expanded", String(open));
});
$("theme-url-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadTheme(new URL($("theme-url").value, base), "custom");
});
$("theme-apply").addEventListener("click", () => {
  try {
    setTheme(JSON.parse($("theme-source").value), "custom");
  } catch (exception) {
    themeError(`配色を変更できませんでした。${exception.message}`);
  }
});

$("auth-origins").value = base.origin;
$("auth-mode").value = "none";
$("auth-refresh-enabled").checked = false;
$("auth-refresh-format").value = "json";
$("auth-refresh-token").value = "";
$("auth-toggle").textContent = "認証: なし";
$("auth-message").textContent = "";
$("auth-error").hidden = true;
$("auth-toggle").addEventListener("click", () => {
  const open = $("auth-panel").hidden;
  $("auth-panel").hidden = !open;
  $("auth-toggle").setAttribute("aria-expanded", String(open));
});
$("auth-mode").addEventListener("change", enableControls);
$("auth-refresh-enabled").addEventListener("change", enableControls);
$("auth-refresh-format").addEventListener("change", enableControls);
$("auth-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!engine || fetching || benchmarkRunning || themeFetching) return;
  try {
    const auth = resources.setAuthentication({
      mode: $("auth-mode").value,
      token: $("auth-token").value,
      allowedOrigins: $("auth-origins").value.split(/\s+/).filter(Boolean),
      expiresIn: $("auth-expires-in").value ? Number($("auth-expires-in").value) : undefined,
      refresh: $("auth-refresh-enabled").checked
        ? {
            url: $("auth-refresh-url").value,
            token: $("auth-refresh-token").value,
            format: $("auth-refresh-format").value,
            clientId:
              $("auth-refresh-format").value === "oauth" && $("auth-refresh-client").value
                ? $("auth-refresh-client").value
                : undefined,
          }
        : undefined,
    });
    $("auth-token").value = "";
    $("auth-refresh-token").value = "";
    $("auth-toggle").textContent =
      `認証: ${auth.mode === "jwt" ? (auth.refresh ? "JWT（自動更新）" : "JWT") : "なし"}`;
    $("auth-message").textContent = "設定を適用しました。次のHTTP取得から使用します。";
    $("auth-error").hidden = true;
    if (auth.mode !== "none") $("cache-mode").value = "network-only";
    enableControls();
  } catch (exception) {
    $("auth-message").textContent = "";
    $("auth-error").textContent = exception.message;
    $("auth-error").hidden = false;
  }
});

$("screen-select").addEventListener("change", () => loadBundled($("screen-select").value));
$("cache-clear").addEventListener("click", async () => {
  if (!packageUrl || fetching || benchmarkRunning || themeFetching) return;
  fetching = true;
  enableControls();
  try {
    await runtime.applicationLoader.clear(packageUrl);
    $("cache-message").textContent = "この画面の配信キャッシュを削除しました。";
  } catch (e) {
    $("cache-message").textContent = `削除できませんでした。${e.message}`;
  } finally {
    fetching = false;
    enableControls();
  }
});
$("reload").addEventListener("click", () =>
  load(packageUrl || new URL("screens/orders.json", base), { refreshEngine: true }),
);
$("source-toggle").addEventListener("click", () => {
  const open = $("source-panel").hidden;
  $("source-panel").hidden = !open;
  $("source-toggle").setAttribute("aria-expanded", String(open));
});
$("url-form").addEventListener("submit", (event) => {
  event.preventDefault();
  load(new URL($("screen-url").value, base));
});
$("apply").addEventListener("click", () => {
  try {
    const source = $("dsl-source").value;
    const format = $("source-format").value;
    compile(parsePackage(source, format), $("script-source").value, packageUrl, format, source);
  } catch (exception) {
    error(`変更を適用できませんでした。${exception.message}`);
  }
});
let editorFormat = "json";
$("source-format").addEventListener("focus", () => {
  editorFormat = $("source-format").value;
});
$("source-format").addEventListener("change", () => {
  try {
    $("dsl-source").value = stringifyPackage(
      parsePackage($("dsl-source").value, editorFormat),
      $("source-format").value,
    );
    editorFormat = $("source-format").value;
  } catch (exception) {
    $("source-format").value = editorFormat;
    error(exception.message);
  }
});
$("benchmark").addEventListener("click", async () => {
  if (!scenes || benchmarkRunning) return;
  benchmarkRunning = true;
  enableControls();
  let domTime = 0;
  let canvasTime = 0;
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise(requestAnimationFrame);
      $("benchmark").textContent = `再描画 ${i + 1} / 60`;
      const start = performance.now();
      dom.render(scenes[0]);
      const middle = performance.now();
      canvas.render(scenes[1]);
      const end = performance.now();
      domTime += middle - start;
      canvasTime += end - middle;
    }
    $("dom-timing").textContent = `平均 ${(domTime / 60).toFixed(2)} ms`;
    $("canvas-timing").textContent = `平均 ${(canvasTime / 60).toFixed(2)} ms`;
  } catch (exception) {
    error(exception.message);
  } finally {
    benchmarkRunning = false;
    $("benchmark").textContent = "◷ 60回再描画";
    enableControls();
  }
});

async function start() {
  try {
    await runtime.start();
    engine = runtime.engine;
    setTheme(engine.theme(), "light", new URL("themes/light.json", base));
    $("engine-status").textContent = "WASMエンジン稼働中";
    document.querySelector(".status-light").classList.add("ready");
    $("wasm-size").textContent = `${Math.round(engine.bytes / 1024)} KiB`;
    let screenId;
    let routeError;
    try {
      screenId = readPageRoute(window.location.href, base, bundledScreens);
    } catch (exception) {
      screenId = "orders";
      routeError = exception.message;
    }
    await loadBundled(screenId, { historyMode: "replace" });
    if (routeError) error(routeError);
    await connectWebMCP();
  } catch (exception) {
    $("engine-status").textContent = "起動失敗";
    $("loading").hidden = true;
    error(`WASMを起動できませんでした。${exception.message}`);
  }
}
start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    runtime.dispose();
    window.removeEventListener("popstate", followHistory);
    resources.setAuthentication({ mode: "none" });
    $("auth-token").value = "";
    $("auth-refresh-token").value = "";
    webmcpRegistration?.dispose();
  });
}
