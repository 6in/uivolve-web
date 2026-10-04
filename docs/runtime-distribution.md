# 共通ランタイムと最小アプリ

uivolve-webの実行ホストを`src/runtime.js`へ分離した。比較デモの`src/main.js`と、独立アプリの`src/application.js`は同じホストを使用する。WASM・Rhai・部品の実装を複製せず、画面の取得、入力、状態更新、描画、非同期処理、画面置換時の中止を共有する。

「最小」はサンプル一覧、ソースエディタ、比較表示、ベンチマーク、設定パネルを配布しないという意味。WASMの部品機能を削減した小容量ビルドではない。Canvasの入力・メディアには引き続きネイティブDOMを使用する。

## 配布物を作る

エンジン開発者はこのリポジトリで実行する。ビルドには既存のBun・Rust・wasm32ターゲットが必要。

```bash
bun install --frozen-lockfile
bun run build:minimal
bun run preview:minimal
```

`http://127.0.0.1:4175/`でHello Worldが動く。描画方式のリンクは同じアプリをDOMまたはCanvasで起動する。比較デモの4174とは独立した静的配信サーバー。

```text
app-dist/
  index.html
  boot.js
  app.json
  pages/
    home.yaml
    home.rhai
    home/index.html
  runtime/
    index.js
    index.css
    engine.wasm
    THIRD_PARTY_NOTICES.txt
```

`app-dist/`全体を静的ホストへ配置できる。配信にRust・Vite・npmのインストールは不要。Bunをサーバーとして選ぶ場合だけ配信先にBunが必要。添付のサーバーはローカル確認用に127.0.0.1へバインドする。`PORT=4180 bun run preview:minimal`でポートを変更できる。HTML・JS・CSS・WASM・YAML・Rhaiをそのまま配信し、存在しないファイルは404とする。

`pages/home/index.html`は直接アクセス用の入口なので、通常のディレクトリ配信でも`/pages/home/`を開ける。拡張子なしのURLはサーバーにより末尾スラッシュへ転送される。新しいページを追加する際は入口HTMLも用意するか、[運用](operations.md)の`/pages/`フォールバックを設定する。サブディレクトリに置いても、設定・WASM・スクリプト・CSSの参照はアプリの配置先から解決する。

生成先はGit管理しない。次のビルドでファイルが上書きされるので、開発中は`examples/minimal/`を編集する。配布後のアプリは配布物を自分のプロジェクトへコピーして管理できる。通常のYAML/Rhai変更にエンジンの再ビルドは不要。配信キャッシュを有効にする場合は[マニフェストの生成](files-cache-rpc.md)も必要。

## アプリ設定

```json
{
  "version": 1,
  "renderer": "dom",
  "initialPage": "home",
  "pages": [{ "id": "home", "title": "ホーム", "url": "pages/home.yaml" }],
  "cacheMode": "network-only",
  "webmcp": false
}
```

`renderer`は`dom`または`canvas`。画面idは1〜80文字の英数字・ハイフン・アンダースコアで、画面定義のidとも一致させる。`pages`は1〜100件、`initialPage`は登録済みのid。URLは`app.json`の場所から解決する。任意の`theme`にはテーマJSONのURLを指定できる。`cacheMode`の既定値は`network-only`、必要なら`network-first`。`webmcp`の既定値はfalseで、有効にするとアプリ自身の画面一覧を5つの共通ツールへ渡す。デモのサンプル一覧は含まない。

画面内の`navigate(name)`は従来どおりDSLの`pages`を使う。独立アプリでは、その遷移先URLを`app.json`にも登録する。登録URLの取得・Rhaiの初期化が成功した後に`/pages/<id>`を更新する。戻る・進むでも同じ取得経路を使用する。失敗時は以前の画面を保持する。各画面は初期状態から起動し、画面間で入力値を自動継承しない。

## 既存HTMLに組み込む

`bun run build:runtime`で生成した`runtime-dist/`を既存サイトの`runtime/`などへコピーする。ビルド済みES moduleはnpmやViteを介さずブラウザからimportできる。CSSも読み込む。

```html
<link rel="stylesheet" href="./runtime/index.css" />
<div id="app"></div>
<script type="module">
  import { createApplication } from "./runtime/index.js";
  const app = await createApplication({
    element: document.getElementById("app"),
    configUrl: new URL("./app.json", location.href),
    onError: (error) => console.error(error?.message ?? ""),
  });
  // 画面のホストを外すとき: app.dispose()
</script>
```

初期ページの決定には`app.json`の位置を使う。深いURLでも入口HTMLから正しい設定URLを渡す。サンプルの`boot.js`は`import.meta.url`を基準にしている。WASMの既定URLは配布モジュールに隣接する`engine.wasm`。別の配置なら`wasmUrl`を指定する。

ルーティングを既存サイト側で管理する場合は、下位APIの`createRuntime`で表示領域と画面URLだけを渡せる。

```js
import { createRuntime } from "./runtime/index.js";
const ui = await createRuntime({
  element: document.getElementById("app"),
  renderer: "canvas",
  baseUrl: new URL("./", location.href),
  onError: (error) => console.error(error?.message ?? ""),
});
await ui.load("pages/home.yaml");
// ui.dispose()
```

`UiRuntime`は`load / compile / dispatch / theme / snapshot / whenIdle / dispose`を提供する。`load`は取得失敗・コンパイル失敗をrejectする。`snapshot()`はコピーで、変更しても実行状態は変わらない。`whenIdle()`は発行済みの非同期effectsの完了を待つもので、未awaitの`load()`や未来のユーザー操作は待たない。`onState / onLoad / onRender / onBusy / onCache / onError`でホストへ通知する。通知コールバックは例外を投げず、読み取り・表示更新に使用する。

CSSとテーマ変数は表示領域の`.uivolve-runtime`へ適用する。外側のbodyや見出し、余白は利用側が決める。表示領域はランタイム専用の空要素にする。最小幅は240pxなので、それ以下の領域ではクリップされる。Canvasのフォーカス、入力、ResizeObserver、外側クリック、進行中の取得は`dispose()`で解除する。

認証は既存の`ResourceClient`を共有する。`createApplication`の`authentication`、または起動後の`app.runtime.resources.setAuthentication(...)`で[JWT・リフレッシュ設定](authentication.md)を渡せる。トークンは公開する`app.json`やDSLに埋め込まない。認証付き配信では配信キャッシュを有効にしない。

## 次の配布段階

現在はリポジトリから生成する静的配布物。npmの公開、`bunx uivolve-web init / serve / build`というCLI、アプリ用ビルドコマンドの一般化、ランタイムの自動更新はまだ提供していない。`package.json`は引き続きprivateで、公開操作も行わない。共通ランタイムの切り出しと静的利用の検証を先に完了させた。

時計を固定・差し替えする場合はcreateApplicationまたはUiRuntimeへ`clockProvider`を渡す。既定はブラウザ時計。[日付・時計の契約](date-functions.md)を参照。
