import "./styles.css";
import { WasmEngine } from "./engine.js";
import { DomRenderer } from "./dom-renderer.js";
import { CanvasRenderer } from "./canvas-renderer.js";
import { applyTheme } from "./theme.js";
import { SCREEN_CATALOG, screenFile } from "./screen-catalog.js";
import { createUiTools, registerUiTools } from "./webmcp.js";
import { ResourceClient } from "./resource-client.js";
import { HttpEffects } from "./http-effects.js";
import { StorageEffects } from "./storage-effects.js";
import { FileClient } from "./file-client.js";
import { ApplicationLoader } from "./application-loader.js";
import { RpcClient } from "./rpc-client.js";
import { packageFormat, parsePackage, stringifyPackage } from "./package-format.js";
import { readPageRoute, pageUrl } from "./page-router.js";

const $ = (id) => document.getElementById(id);
const base = new URL(import.meta.env.BASE_URL, window.location.href);
const resources = new ResourceClient({ baseUrl: base });
const applicationLoader = new ApplicationLoader({ resources });
let currentDescriptors = {};
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
let currentState;
let screenToken;
let webmcpRegistration;
let disposed = false;
let revision = 0;
let fetching = false;
let benchmarkRunning = false;
let frame = 0;
let scenes;
let themeFetching = false;
let themeChoice = "light";
let loadSequence = 0;
let loadController;
let pendingRoute;
function completeEffect(method, id, response) {
  const result = engine[method](id, response);
  updateState(result);
  error("");
  render();
  return result;
}
const httpEffects = new HttpEffects({
  resources,
  complete: (id, response) => completeEffect("completeHttp", id, response),
  runNext: runEffects,
  onError: (exception) => error(exception.message),
});
const storageEffects = new StorageEffects({
  complete: (id, response) => completeEffect("completeStorage", id, response),
  runNext: runEffects,
  onError: (exception) => error(exception.message),
});
const fileEffects = new StorageEffects({
  label: "ファイル操作",
  client: new FileClient({ engine: { readBuffer: (id) => engine.readBuffer(id) } }),
  complete: (id, response) => completeEffect("completeFile", id, response),
  runNext: runEffects,
  onError: (exception) => error(exception.message),
});
const rpcEffects = new StorageEffects({
  label: "RPC",
  client: new RpcClient({ resources, engine: { readBuffer: (id) => engine.readBuffer(id) } }),
  complete: (id, response) => completeEffect("completeRpc", id, response),
  runNext: runEffects,
  onError: (exception) => error(exception.message),
});
function runEffects(effects = []) {
  return Promise.all([
    httpEffects.run(effects.filter((effect) => !effect.kind || effect.kind === "http")),
    storageEffects.run(effects.filter((effect) => effect.kind === "storage")),
    fileEffects.run(effects.filter((effect) => effect.kind === "file")),
    rpcEffects.run(effects.filter((effect) => effect.kind === "rpc")),
  ]);
}
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
  currentState = result.state;
  revision = result.revision;
  $("revision").textContent = String(revision).padStart(3, "0");
  $("state-view").textContent = JSON.stringify(result.state, null, 2);
}

function performEvent(target, payload) {
  if (!currentPackage || fetching || benchmarkRunning)
    throw new Error("画面の準備ができていません");
  let result;
  try {
    result = engine.dispatch(target, payload);
  } catch (exception) {
    // A failed completion consumes its dialog; redraw the next engine-owned modal.
    render();
    throw exception;
  }
  updateState(result);
  error("");
  render();
  void runEffects(result.effects);
  return result;
}

function dispatch(target, payload) {
  try {
    performEvent(target, payload);
    return true;
  } catch (exception) {
    error(exception.message);
    return false;
  }
}

const dom = new DomRenderer($("dom-stage"), dispatch);
const canvas = new CanvasRenderer($("canvas-stage"), $("canvas"), dispatch);
document.addEventListener("pointerdown", (event) => {
  if (scenes?.[0].popup && !event.target.closest(".stage"))
    dispatch(scenes[0].popup.target, { action: "close" });
});

function render() {
  if (!currentPackage) return;
  // Identical viewport sizes are not assumed: Rust lays out the same tree for each area.
  const domWidth = Math.max(240, $("dom-stage").clientWidth);
  const canvasWidth = Math.max(240, $("canvas-stage").clientWidth);
  scenes = [engine.layout(domWidth), engine.layout(canvasWidth)];
  for (const scene of scenes) scene.assetBase = packageUrl.href;
  applyTheme(document.documentElement, scenes[0].theme);
  const start = performance.now();
  dom.render(scenes[0]);
  const middle = performance.now();
  canvas.render(scenes[1]);
  const end = performance.now();
  $("dom-timing").textContent = `${(middle - start).toFixed(2)} ms`;
  $("canvas-timing").textContent = `${(end - middle).toFixed(2)} ms`;
}

function scheduleRender() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    try {
      render();
    } catch (exception) {
      error(exception.message);
    }
  });
}
const resize = new ResizeObserver(scheduleRender);
resize.observe($("dom-stage"));
resize.observe($("canvas-stage"));

function compile(
  screen,
  script,
  source,
  format = packageFormat(source),
  rawSource,
  descriptors = currentDescriptors,
) {
  screen = structuredClone(screen);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const calendarDefaults = (node) => {
    if (node.xtype === "datepicker" && !node.today) node.today = today;
    if (["image", "imagecomponent", "video", "iframe", "uxiframe"].includes(node.xtype)) {
      for (const key of ["src", "url", "poster", "posterUrl"]) {
        if (typeof node[key] === "string" && node[key]) {
          const url = new URL(node[key], source);
          if (!["http:", "https:"].includes(url.protocol))
            throw new Error("メディアにはHTTP / HTTPSのURLが必要です");
        }
      }
    }
    for (const config of [node.items, node.tbar, node.bbar, node.buttons, node.menu]) {
      for (const child of Array.isArray(config) ? config : [config])
        if (child && typeof child === "object") calendarDefaults(child);
    }
  };
  calendarDefaults(screen.ui);
  const start = performance.now();
  const result = engine.load(screen, script, descriptors);
  const duration = performance.now() - start;
  // Only replace the active screen after the candidate compiles and init succeeds.
  dom.reset();
  canvas.reset();
  currentPackage = screen;
  currentDescriptors = descriptors;
  screenToken = crypto.randomUUID();
  packageUrl = source;
  httpEffects.reset(source);
  storageEffects.reset(screen.id);
  fileEffects.reset(screen.id);
  rpcEffects.reset(source);
  $("source-format").value = format;
  editorFormat = format;
  $("dsl-source").value = rawSource ?? stringifyPackage(screen, format);
  $("script-source").value = script;
  $("screen-url").value = source.href;
  $("package-url").textContent = source.pathname;
  $("script-url").textContent = new URL(screen.script, source).pathname;
  $("compile-time").textContent = `${duration.toFixed(1)} ms`;
  updateState(result);
  render();
  error("");
  void runEffects(result.effects);
}

async function load(
  url,
  {
    signal,
    beforeCommit,
    throwOnError = false,
    routeId,
    historyMode = "push",
    replacePending = false,
  } = {},
) {
  if ((fetching && !replacePending) || benchmarkRunning || themeFetching) {
    if (throwOnError) throw new Error("画面の読み込み中です");
    return;
  }
  signal?.throwIfAborted();
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const externalAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", externalAbort, { once: true });
  const sequence = ++loadSequence;
  fetching = true;
  enableControls();
  $("loading").hidden = false;
  $("loading").textContent = "画面定義とスクリプトをHTTPから読み込んでいます…";
  try {
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("HTTP / HTTPSのURLを指定してください");
    const candidate = await applicationLoader.fetch(url, {
      mode: $("cache-mode").value,
      signal: controller.signal,
    });
    const { screen, script, format, source, descriptors } = candidate;
    controller.signal.throwIfAborted();
    beforeCommit?.();
    compile(screen, script, url, format, source, descriptors);
    $("cache-message").textContent =
      candidate.status === "cache"
        ? `保存版から表示しています（${candidate.fallbackReason}）。`
        : "HTTPから表示しています。";
    try {
      await applicationLoader.save(candidate, { signal: controller.signal });
      if (candidate.metadata && candidate.status === "network")
        $("cache-message").textContent = "HTTPから表示し、配信キャッシュを保存しました。";
    } catch (e) {
      controller.signal.throwIfAborted();
      $("cache-message").textContent =
        `画面は表示できましたが、キャッシュを保存できませんでした。${e.message}`;
    }
    controller.signal.throwIfAborted();
    $("screen-select").value = bundledScreens.includes(screen.id) ? screen.id : "";
    if (routeId) writeRoute(routeId, historyMode);
    return true;
  } catch (exception) {
    if (!controller.signal.aborted) {
      error(`画面を読み込めませんでした。${exception.message}`);
      $("screen-select").value = bundledScreens.includes(currentPackage?.id)
        ? currentPackage.id
        : "";
      if (routeId && historyMode === "replace") restoreRoute();
    }
    if (throwOnError) throw exception;
  } finally {
    signal?.removeEventListener("abort", externalAbort);
    if (sequence === loadSequence) {
      fetching = false;
      $("loading").hidden = true;
      enableControls();
    }
  }
}

function snapshot() {
  return {
    screen: currentPackage
      ? {
          id: currentPackage.id,
          title: currentPackage.title,
          token: screenToken,
          ...(scenes?.[0].webmcp ? { webmcp: scenes[0].webmcp } : {}),
        }
      : null,
    revision,
    state: currentState,
    scene: scenes?.[0],
    busy: fetching || benchmarkRunning || themeFetching,
    dialog: scenes?.[0].dialog ?? null,
  };
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
  const resolved = engine.theme(definition);
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
    await applicationLoader.clear(packageUrl);
    $("cache-message").textContent = "この画面の配信キャッシュを削除しました。";
  } catch (e) {
    $("cache-message").textContent = `削除できませんでした。${e.message}`;
  } finally {
    fetching = false;
    enableControls();
  }
});
$("reload").addEventListener("click", () =>
  load(packageUrl || new URL("screens/orders.json", base)),
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
    engine = await WasmEngine.create(new URL("engine.wasm", base), { resources });
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
    httpEffects.reset();
    storageEffects.reset();
    fileEffects.reset();
    rpcEffects.reset();
    loadController?.abort();
    window.removeEventListener("popstate", followHistory);
    resources.setAuthentication({ mode: "none" });
    $("auth-token").value = "";
    $("auth-refresh-token").value = "";
    webmcpRegistration?.dispose();
    resize.disconnect();
    dom.dispose();
    canvas.dispose();
    cancelAnimationFrame(frame);
  });
}
