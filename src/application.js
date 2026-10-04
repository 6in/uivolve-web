import { createRuntime } from "./runtime.js";
import { ResourceClient } from "./resource-client.js";
import { httpUrl } from "./http-policy.js";
import { readPageRoute, pageUrl } from "./page-router.js";
import { createUiTools, registerUiTools } from "./ui-tools.js";

export function validateAppConfig(value, baseUrl) {
  if (!value || value.version !== 1 || !["dom", "canvas"].includes(value.renderer))
    throw new Error("app.jsonのversion=1とrenderer=dom / canvasが必要です");
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 100)
    throw new Error("pagesには1〜100件の画面を指定してください");
  const ids = new Set();
  const pages = value.pages.map((page) => {
    if (
      !page ||
      typeof page.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(page.id) ||
      ids.has(page.id)
    )
      throw new Error("画面idには重複しない英数字・ハイフン・アンダースコアを指定してください");
    if (typeof page.url !== "string" || !page.url) throw new Error("画面のurlが必要です");
    ids.add(page.id);
    return {
      id: page.id,
      title: typeof page.title === "string" ? page.title : page.id,
      url: httpUrl(page.url, baseUrl).href,
    };
  });
  if (!ids.has(value.initialPage)) throw new Error("initialPageはpagesにあるidを指定してください");
  const cacheMode = value.cacheMode ?? "network-only";
  if (!["network-only", "network-first"].includes(cacheMode))
    throw new Error("cacheModeが不正です");
  if (value.webmcp !== undefined && typeof value.webmcp !== "boolean")
    throw new Error("webmcpには真偽値を指定してください");
  if (value.theme !== undefined && (typeof value.theme !== "string" || !value.theme))
    throw new Error("themeにはテーマURLを指定してください");
  const connections = value.connections ?? {};
  if (
    !connections ||
    typeof connections !== "object" ||
    Array.isArray(connections) ||
    Object.keys(connections).length > 32 ||
    Object.entries(connections).some(
      ([name, connection]) =>
        !/^[A-Za-z0-9_-]{1,80}$/.test(name) ||
        !connection ||
        typeof connection !== "object" ||
        Array.isArray(connection) ||
        typeof connection.adapter !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(connection.adapter),
    )
  )
    throw new Error("connectionsには名前付きの接続設定を指定してください");
  return {
    version: 1,
    renderer: value.renderer,
    initialPage: value.initialPage,
    pages,
    connections: structuredClone(connections),
    cacheMode,
    webmcp: value.webmcp === true,
    theme: value.theme === undefined ? undefined : httpUrl(value.theme, baseUrl).href,
  };
}

// A ready-to-use static application host. All URLs resolve from app.json, never the route.
export async function createApplication({
  element,
  configUrl,
  wasmUrl = new URL(/* @vite-ignore */ "./engine.wasm", import.meta.url),
  renderer,
  resources,
  authentication,
  onError,
  onBusy,
  onState,
  onCache,
  adapters,
  connections,
} = {}) {
  configUrl = httpUrl(configUrl, globalThis.location?.href);
  const baseUrl = new URL("./", configUrl);
  resources ??= new ResourceClient({ baseUrl });
  if (authentication) resources.setAuthentication(authentication);
  const config = validateAppConfig(JSON.parse(await resources.text(configUrl)), baseUrl);
  const ids = config.pages.map((page) => page.id);
  let runtime;
  let registration;
  let disposed = false;
  let currentRoute;
  const lifecycle = new AbortController();
  function writeRoute(id, mode) {
    const url = pageUrl(id, baseUrl, location.href);
    if (url.href !== location.href)
      history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
    currentRoute = id;
  }
  async function loadPage(id, { historyMode = "push", ...options } = {}) {
    const page = config.pages.find((page) => page.id === id);
    if (!page) throw new Error(`未知の画面idです: ${id}`);
    const candidate = await runtime.load(page.url, { ...options, expectedId: id });
    writeRoute(id, historyMode);
    return candidate;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycle.abort();
    registration?.dispose();
    runtime?.dispose();
  }
  try {
    runtime = await createRuntime({
      element,
      renderer: renderer ?? config.renderer,
      wasmUrl,
      resources,
      baseUrl,
      cacheMode: config.cacheMode,
      adapters,
      connections: connections ?? config.connections,
      onError,
      onBusy,
      onState,
      onCache,
      navigate: async (url) => {
        const page = config.pages.find((page) => page.url === url.href);
        if (!page) throw new Error("遷移先をapp.jsonのpagesへ登録してください");
        return loadPage(page.id);
      },
    });
    if (config.theme) runtime.theme(JSON.parse(await resources.text(config.theme)));
    await loadPage(readPageRoute(location.href, baseUrl, ids, config.initialPage), {
      historyMode: "replace",
    });
    window.addEventListener(
      "popstate",
      () => {
        let id;
        try {
          id = readPageRoute(location.href, baseUrl, ids, config.initialPage);
        } catch (error) {
          if (currentRoute) writeRoute(currentRoute, "replace");
          onError?.(error);
          return;
        }
        void loadPage(id, { replacePending: true, historyMode: "replace" }).catch((error) => {
          if (disposed || error.name === "AbortError") return;
          if (currentRoute) writeRoute(currentRoute, "replace");
          onError?.(error);
        });
      },
      { signal: lifecycle.signal },
    );
    if (config.webmcp) {
      registration = await registerUiTools(
        createUiTools(
          {
            snapshot: () => runtime.snapshot(),
            dispatch: (target, payload) => runtime.dispatch(target, payload),
            loadScreen: loadPage,
          },
          config.pages.map(({ id, title }) => ({ id, title })),
        ),
      );
    }
    return { runtime, config, loadPage, webmcp: registration?.status ?? "disabled", dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
