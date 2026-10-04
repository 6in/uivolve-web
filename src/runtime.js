import "./runtime.css";
import { WasmEngine } from "./engine.js";
import { DomRenderer } from "./dom-renderer.js";
import { CanvasRenderer } from "./canvas-renderer.js";
import { applyTheme } from "./theme.js";
import { ResourceClient } from "./resource-client.js";
import { ApplicationLoader } from "./application-loader.js";
import { HttpEffects } from "./http-effects.js";
import { HostEffects } from "./host-effects.js";
import { httpAdapter } from "./adapters/http.js";
import { StorageEffects } from "./storage-effects.js";
import { FileClient } from "./file-client.js";
import { RpcClient } from "./rpc-client.js";
import { PageEffects } from "./page-effects.js";
import { packageFormat } from "./package-format.js";

function prepareScreen(definition, source) {
  const screen = structuredClone(definition);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  function visit(node) {
    if (node.xtype === "datepicker" && !node.today) node.today = today;
    if (["image", "imagecomponent", "video", "iframe", "uxiframe"].includes(node.xtype)) {
      for (const key of ["src", "url", "poster", "posterUrl"]) {
        if (typeof node[key] === "string" && node[key]) {
          if (!["http:", "https:"].includes(new URL(node[key], source).protocol))
            throw new Error("メディアにはHTTP / HTTPSのURLが必要です");
        }
      }
    }
    for (const config of [node.items, node.tbar, node.bbar, node.buttons, node.menu]) {
      for (const child of Array.isArray(config) ? config : [config])
        if (child && typeof child === "object") visit(child);
    }
  }
  if (screen.ui) visit(screen.ui);
  return screen;
}

// Host orchestration shared by the comparison demo and standalone applications.
// No sample catalog, editor, Vite environment or document-wide theme is required.
export class UiRuntime {
  constructor(options) {
    this.options = options;
    this.baseUrl = new URL(options.baseUrl ?? "./", globalThis.location?.href);
    this.wasmUrl = new URL(
      options.wasmUrl ?? new URL(/* @vite-ignore */ "./engine.wasm", import.meta.url),
      this.baseUrl,
    );
    this.resources = options.resources ?? new ResourceClient({ baseUrl: this.baseUrl });
    this.applicationLoader = new ApplicationLoader({ resources: this.resources });
    this.engine = options.engine;
    this.cacheMode = options.cacheMode ?? "network-only";
    this.disposed = false;
    this.fetching = false;
    this.revision = 0;
    this.scenes = [];
    this.pending = new Set();
    this.lifecycle = new AbortController();
    this.loadSequence = 0;
    this.frame = 0;
    this.surfaces = [];
    const complete = (method) => (id, response) => {
      this.assertActive();
      const result = this.engine[method](id, response);
      this.updateState(result);
      this.options.onError?.(null);
      this.render();
      return result;
    };
    const shared = {
      runNext: (effects) => this.runEffects(effects),
      onError: (error) => this.reportError(error),
    };
    this.hostEffects = new HostEffects({
      ...shared,
      adapters: [httpAdapter({ resources: this.resources }), ...(options.adapters ?? [])],
      connections: options.connections ?? {},
      complete: complete("completeHost"),
    });
    const surfaces = options.surfaces ?? [
      { element: options.element, renderer: options.renderer ?? "dom" },
    ];
    if (!surfaces.length) throw new Error("表示領域を1つ以上指定してください");
    for (const surface of surfaces) {
      if (!surface.element || !["dom", "canvas"].includes(surface.renderer))
        throw new Error("表示領域とdom / canvasの描画方式を指定してください");
      if (this.surfaces.some((s) => s.element === surface.element))
        throw new Error("表示領域は重複できません");
      this.surfaces.push({ ...surface });
    }
    const dispatch = (target, payload) => {
      try {
        this.dispatch(target, payload);
        return true;
      } catch (error) {
        this.reportError(error);
        return false;
      }
    };
    try {
      for (const surface of this.surfaces) {
        surface.originalClass = surface.element.className;
        surface.element.classList.add("uivolve-runtime", "stage");
        if (surface.renderer === "canvas") {
          if (!surface.canvas) {
            surface.canvas = surface.element.ownerDocument.createElement("canvas");
            surface.canvas.tabIndex = 0;
            surface.canvas.setAttribute("aria-label", "UI Canvas");
            surface.element.append(surface.canvas);
            surface.ownsCanvas = true;
          }
          surface.element.classList.add("canvas-stage");
          surface.adapter = new CanvasRenderer(surface.element, surface.canvas, dispatch);
        } else surface.adapter = new DomRenderer(surface.element, dispatch);
      }
      this.resize = new ResizeObserver(() => this.scheduleRender());
      for (const surface of this.surfaces) this.resize.observe(surface.element);
      const document = this.surfaces[0].element.ownerDocument;
      document.addEventListener(
        "pointerdown",
        (event) => {
          const popup = this.scenes[0]?.popup;
          if (popup && !this.surfaces.some((surface) => surface.element.contains(event.target)))
            dispatch(popup.target, { action: "close" });
        },
        { signal: this.lifecycle.signal },
      );
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.httpEffects = new HttpEffects({
      ...shared,
      resources: this.resources,
      complete: complete("completeHttp"),
    });
    this.storageEffects = new StorageEffects({ ...shared, complete: complete("completeStorage") });
    this.fileEffects = new StorageEffects({
      ...shared,
      label: "ファイル操作",
      client: new FileClient({ engine: { readBuffer: (id) => this.engine.readBuffer(id) } }),
      complete: complete("completeFile"),
    });
    this.rpcEffects = new StorageEffects({
      ...shared,
      label: "RPC",
      client: new RpcClient({
        resources: this.resources,
        engine: { readBuffer: (id) => this.engine.readBuffer(id) },
      }),
      complete: complete("completeRpc"),
    });
    this.pageEffects = new PageEffects({
      load: (url) => (options.navigate ? options.navigate(url) : this.load(url)),
      onError: (error) =>
        this.reportError(new Error(`画面を切り替えられませんでした。${error.message}`)),
    });
  }

  assertActive() {
    if (this.disposed) throw new Error("ランタイムは破棄されています");
  }
  get busy() {
    return this.fetching || Boolean(this.options.isBusy?.());
  }
  reportError(error) {
    if (!this.disposed && error.name !== "AbortError") this.options.onError?.(error);
  }
  async start() {
    this.assertActive();
    if (!this.engine)
      this.engine = await WasmEngine.create(this.wasmUrl, {
        resources: this.resources,
        signal: this.lifecycle.signal,
      });
    this.assertActive();
    if (this.options.theme) this.engine.theme(this.options.theme);
    return this;
  }
  updateState(result) {
    this.state = result.state;
    this.revision = result.revision;
    this.options.onState?.(result);
  }
  dispatch(target, payload = {}) {
    this.assertActive();
    if (!this.screen || this.busy) throw new Error("画面の準備ができていません");
    let result;
    try {
      result = this.engine.dispatch(target, payload);
    } catch (error) {
      // Failed dialog completions may have consumed a request; redraw its successor.
      this.render();
      throw error;
    }
    this.updateState(result);
    this.options.onError?.(null);
    this.render();
    void this.runEffects(result.effects);
    return result;
  }
  runEffects(effects = []) {
    if (this.disposed) return Promise.resolve();
    const task = Promise.all([
      this.httpEffects.run(effects.filter((effect) => !effect.kind || effect.kind === "http")),
      this.storageEffects.run(effects.filter((effect) => effect.kind === "storage")),
      this.fileEffects.run(effects.filter((effect) => effect.kind === "file")),
      this.rpcEffects.run(effects.filter((effect) => effect.kind === "rpc")),
      this.pageEffects.run(effects.filter((effect) => effect.kind === "navigate")),
      this.hostEffects.run(effects.filter((effect) => effect.kind === "host")),
    ]).catch((error) => this.reportError(error));
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
    return task;
  }
  async whenIdle() {
    while (this.pending.size) await Promise.all(this.pending);
  }
  render() {
    if (this.disposed || !this.screen) return;
    const durations = [];
    this.scenes = this.surfaces.map((surface) => {
      const scene = this.engine.layout(Math.min(4096, Math.max(240, surface.element.clientWidth)));
      scene.assetBase = this.packageUrl.href;
      const start = performance.now();
      surface.adapter.render(scene);
      durations.push(performance.now() - start);
      return scene;
    });
    this.options.onRender?.({ scenes: this.scenes, durations });
  }
  scheduleRender() {
    if (this.disposed) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      try {
        this.render();
      } catch (error) {
        this.reportError(error);
      }
    });
  }
  theme(definition) {
    this.assertActive();
    const resolved = this.engine.theme(definition);
    for (const surface of this.surfaces) applyTheme(surface.element, resolved);
    this.render();
    return resolved;
  }
  compile(
    screen,
    script,
    source,
    {
      format = packageFormat(source),
      rawSource,
      descriptors = this.descriptors ?? {},
      engine = this.engine,
    } = {},
  ) {
    this.assertActive();
    source = new URL(source, this.baseUrl);
    if (!["http:", "https:"].includes(source.protocol))
      throw new Error("HTTP / HTTPSのURLを指定してください");
    screen = prepareScreen(screen, source);
    const start = performance.now();
    const hostOperations = this.hostEffects.prepare(screen.operations, source);
    const result = engine.load(screen, script, descriptors);
    const duration = performance.now() - start;
    this.engine = engine;
    for (const surface of this.surfaces) surface.adapter.reset();
    this.screen = screen;
    this.descriptors = descriptors;
    this.screenToken = crypto.randomUUID();
    this.packageUrl = source;
    this.hostEffects.reset(hostOperations);
    this.httpEffects.reset(source);
    this.storageEffects.reset(screen.id);
    this.fileEffects.reset(screen.id);
    this.rpcEffects.reset(source);
    this.pageEffects.reset(source);
    this.updateState(result);
    this.render();
    this.options.onError?.(null);
    this.options.onLoad?.({ screen, script, source, format, rawSource, descriptors, duration });
    void this.runEffects(result.effects);
    return result;
  }
  async load(
    value,
    { signal, beforeCommit, replacePending = false, refreshEngine = false, expectedId } = {},
  ) {
    this.assertActive();
    if ((this.fetching && !replacePending) || this.options.isBusy?.())
      throw new Error("画面の読み込み中です");
    const url = new URL(value, this.baseUrl);
    signal?.throwIfAborted();
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const sequence = ++this.loadSequence;
    this.fetching = true;
    this.options.onBusy?.(true);
    try {
      const candidate = await this.applicationLoader.fetch(url, {
        mode: this.cacheMode,
        signal: controller.signal,
      });
      const engine = refreshEngine
        ? await WasmEngine.create(this.wasmUrl, {
            resources: this.resources,
            signal: controller.signal,
            theme: this.engine.theme(),
          })
        : this.engine;
      controller.signal.throwIfAborted();
      this.assertActive();
      if (expectedId !== undefined && candidate.screen.id !== expectedId)
        throw new Error("app.jsonの画面idと画面定義のidが一致しません");
      beforeCommit?.();
      this.compile(candidate.screen, candidate.script, url, {
        format: candidate.format,
        rawSource: candidate.source,
        descriptors: candidate.descriptors,
        engine,
      });
      this.options.onCache?.({
        status: candidate.status,
        fallbackReason: candidate.fallbackReason,
      });
      try {
        await this.applicationLoader.save(candidate, { signal: controller.signal });
        if (candidate.metadata && candidate.status === "network")
          this.options.onCache?.({ status: "saved" });
      } catch (error) {
        controller.signal.throwIfAborted();
        this.options.onCache?.({ status: "save-error", error });
      }
      controller.signal.throwIfAborted();
      return candidate;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (sequence === this.loadSequence && !this.disposed) {
        this.fetching = false;
        this.options.onBusy?.(false);
      }
    }
  }
  snapshot() {
    return structuredClone({
      screen: this.screen
        ? {
            id: this.screen.id,
            title: this.screen.title,
            token: this.screenToken,
            ...(this.scenes[0]?.webmcp ? { webmcp: this.scenes[0].webmcp } : {}),
          }
        : null,
      revision: this.revision,
      state: this.state,
      scene: this.scenes[0],
      busy: this.busy,
      dialog: this.scenes[0]?.dialog ?? null,
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycle.abort();
    this.loadController?.abort();
    this.hostEffects?.dispose();
    for (const effect of [
      this.httpEffects,
      this.storageEffects,
      this.fileEffects,
      this.rpcEffects,
      this.pageEffects,
    ])
      effect?.reset();
    this.resize?.disconnect();
    cancelAnimationFrame(this.frame);
    for (const surface of this.surfaces) {
      surface.adapter?.dispose();
      if (surface.ownsCanvas) surface.canvas.remove();
      if (surface.originalClass !== undefined) surface.element.className = surface.originalClass;
    }
  }
}

export async function createRuntime(options) {
  const runtime = new UiRuntime(options);
  try {
    return await runtime.start();
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}
