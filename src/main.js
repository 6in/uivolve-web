import "./styles.css";
import { WasmEngine } from "./engine.js";
import { DomRenderer } from "./dom-renderer.js";
import { CanvasRenderer } from "./canvas-renderer.js";
import { applyTheme } from "./theme.js";
import { SCREEN_CATALOG, createUiTools, registerUiTools } from "./webmcp.js";

const $ = (id) => document.getElementById(id);
const base = new URL(import.meta.env.BASE_URL, window.location.href);
const bundledScreens = SCREEN_CATALOG.map((screen) => screen.id);
const controls = [
  "screen-select",
  "reload",
  "benchmark",
  "apply",
  "load-url",
  "theme-select",
  "theme-apply",
  "theme-load-url",
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

function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function enableControls() {
  for (const id of controls)
    $(id).disabled = !engine || fetching || benchmarkRunning || themeFetching;
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
  const result = engine.dispatch(target, payload);
  updateState(result);
  error("");
  render();
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

async function fetchText(url, signal) {
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("ファイルが1 MBを超えています");
  return text;
}

function compile(screen, script, source) {
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
  const result = engine.load(screen, script);
  const duration = performance.now() - start;
  // Only replace the active screen after the candidate compiles and init succeeds.
  dom.reset();
  canvas.reset();
  currentPackage = screen;
  screenToken = crypto.randomUUID();
  packageUrl = source;
  $("dsl-source").value = JSON.stringify(screen, null, 2);
  $("script-source").value = script;
  $("screen-url").value = source.href;
  $("package-url").textContent = source.pathname;
  $("script-url").textContent = new URL(screen.script, source).pathname;
  $("compile-time").textContent = `${duration.toFixed(1)} ms`;
  updateState(result);
  render();
  error("");
}

async function load(url, { signal, beforeCommit, throwOnError = false } = {}) {
  if (fetching || benchmarkRunning || themeFetching) {
    if (throwOnError) throw new Error("画面の読み込み中です");
    return;
  }
  signal?.throwIfAborted();
  fetching = true;
  enableControls();
  $("loading").hidden = false;
  $("loading").textContent = "画面定義とスクリプトをHTTPから読み込んでいます…";
  try {
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("HTTP / HTTPSのURLを指定してください");
    const screen = JSON.parse(await fetchText(url, signal));
    if (typeof screen.script !== "string") throw new Error("script URLがありません");
    const scriptUrl = new URL(screen.script, url);
    if (!["http:", "https:"].includes(scriptUrl.protocol))
      throw new Error("scriptにはHTTP / HTTPSのURLが必要です");
    const script = await fetchText(scriptUrl, signal);
    signal?.throwIfAborted();
    beforeCommit?.();
    compile(screen, script, url);
    $("screen-select").value = bundledScreens.includes(screen.id) ? screen.id : "";
  } catch (exception) {
    if (!signal?.aborted) error(`画面を読み込めませんでした。${exception.message}`);
    if (throwOnError) throw exception;
  } finally {
    fetching = false;
    $("loading").hidden = true;
    enableControls();
  }
}

function snapshot() {
  return {
    screen: currentPackage
      ? { id: currentPackage.id, title: currentPackage.title, token: screenToken }
      : null,
    revision,
    state: currentState,
    scene: scenes?.[0],
    busy: fetching || benchmarkRunning || themeFetching,
  };
}

async function connectWebMCP() {
  try {
    webmcpRegistration = await registerUiTools(
      createUiTools({
        snapshot,
        dispatch: performEvent,
        loadScreen: (id, options) =>
          load(new URL(`screens/${id}.json`, base), { ...options, throwOnError: true }),
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
    setTheme(JSON.parse(await fetchText(url)), choice, url);
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

$("screen-select").addEventListener("change", () =>
  load(new URL(`screens/${$("screen-select").value}.json`, base)),
);
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
    compile(JSON.parse($("dsl-source").value), $("script-source").value, packageUrl);
  } catch (exception) {
    error(`変更を適用できませんでした。${exception.message}`);
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
    engine = await WasmEngine.create(new URL("engine.wasm", base));
    setTheme(engine.theme(), "light", new URL("themes/light.json", base));
    $("engine-status").textContent = "WASMエンジン稼働中";
    document.querySelector(".status-light").classList.add("ready");
    $("wasm-size").textContent = `${Math.round(engine.bytes / 1024)} KiB`;
    const requestedScreen = new URL(window.location.href).searchParams.get("screen");
    const screenId = bundledScreens.includes(requestedScreen) ? requestedScreen : "orders";
    await load(new URL(`screens/${screenId}.json`, base));
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
    webmcpRegistration?.dispose();
    resize.disconnect();
    dom.dispose();
    canvas.dispose();
    cancelAnimationFrame(frame);
  });
}
