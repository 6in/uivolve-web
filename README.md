# uivolve-web

uivolveの宣言的な部品・配置という考えを、Web向けのUIエンジンとして実装する試作。HTTPで取得した画面DSLとスクリプトを共通のRust/WASMエンジンで実行し、DOM版・Canvas版を並べて比較する。

開発環境は **Bun 1.3.12 + Vite+ 1.0.0**。ReactなどのUIフレームワークは使用しない。

## 起動

必要: Bun、Rust/Cargo、`wasm32-unknown-unknown`ターゲット。Vite+のローカルCLIはNode.js 22.18以降、24.11以降、または26以降を使用する。

```sh
rustup target add wasm32-unknown-unknown
bun install --frozen-lockfile
bun run dev
```

開発サーバー: `http://127.0.0.1:4173/`。起動時にRustをWASMへビルドする。

画面を直接開くにはURLへ`?screen=uivolve-forms`などを付ける。対応値は`orders`、`tasks`、`components`、`uivolve-forms`、`grid-lab`、`uivolve-gallery`、`layout-lab`。省略・不明な値は受注管理を開く。レイアウトのプレビュー: `http://127.0.0.1:4174/?screen=layout-lab`。

```sh
bun run build       # WASM + Vite+本番ビルド → dist/
bun run preview     # 本番成果物 → http://127.0.0.1:4174/
bun run test        # 実際のWASMのVitest + Rustのテスト
bun run check       # Oxfmt / Oxlint + rustfmt
bun run fmt
```

Rustを変更したら`bun run build:wasm`を実行する。フロントエンドはVite+で更新される。画面JSON・Rhaiは「再取得」、またはエディタの「変更を適用」で再読み込みできる。

## 試せること

- 「Grid・Card・Border レイアウト」画面で、幅に応じたGrid配置と列span、入力を保持するCard切替、上下左右と中央を組むBorder、領域を使い切るFitを試せる。共通gap/paddingと最小高さを扱い、座標・寸法をWASMが計算する。詳細は[レイアウト契約](docs/layouts.md)。

- 受注一覧の検索・行選択・顧客名と金額の編集。反映先はデモのメモリ内状態で、永続化やサーバーへの保存は行わない。
- DOM側・Canvas側のどちらから操作しても、共通状態を両側へ表示。
- タスク管理へのHTTP読み込みと、追加・完了状態の切り替え。
- 「パネル・ウィンドウ」画面で、入れ子のパネルの折りたたみ、プロフィール編集、保存確認ウィンドウの重ね表示。× / Escapeで閉じ、Tabで内部を移動。開閉・重なり順・背後へのイベント遮断は共通WASMエンジンで処理する。
- ライト／ダークの共通テーマ。JSONで色をカスタムし、HTTPから別テーマを取得できる。入力値や開いているwindowを保ったままDOM・Canvasの両方へ適用する。
- 「uivolve フォーム部品」画面で、複数行・数値・日付入力、チェック、ラジオ、単一／複数選択、スライダー、進捗、表示専用値、fieldsetを試せる。設定名・振る舞いの[移植対応表](docs/uivolve-port.md)あり。
- 「Grid・タブ・ツリー・メニュー」画面で500行の一覧を検索・ソート・ページ切替し、複数選択とセル編集を試せる。Enterで確定、Escapeで取消。Rhaiが編集を拒否したときは下書きを保つ。タブを切り替えても入力値は保持し、ツリーから一覧を絞り込める。詳細は[部品契約](docs/grid-navigation.md)。
- 「uivolve コンポーネントギャラリー」画面でツールバー、分割ボタン、入力グループ、カレンダー、ページ操作、アコーディオン、通知、入力ダイアログ、コード/HTMLソース編集、差分、Markdown、図形、チャート、Git/ネットワーク/フロー図、会話とログ、画像・動画・iframeを試せる。重い部品は基本機能の対応で、差分・制限は[追加部品の契約](docs/uivolve-gallery.md)を参照。
- WebMCP対応ブラウザへ5つの共通ツールを登録。表示中の部品・状態参照、画面切替、WASMイベント実行をDOM／Canvas共通で扱う。未対応ブラウザでは通常UIを維持する。仕様・操作例・ブラウザの中断通知の制限は[WebMCP契約](docs/webmcp.md)を参照。
- 任意のHTTP / HTTPSパッケージURLの読み込み。別オリジンは配信側のCORS許可が必要。
- DSL・Rhaiの編集、WASM内での再コンパイル。失敗した変更は現在の画面を置き換えない。
- CanvasのTab移動とEnter / Space操作。編集中はブラウザのinput / textarea / selectを利用。スライダーはドラッグと矢印/Home/Endで操作できる。
- 同じスナップショットの60回再描画。値はDOM更新・Canvas描画命令のCPU時間であり、GPU完了・FPS・総合性能の比較ではない。DOMは既存部品を更新し、Canvasは面を描き直す。

## 構成

```text
HTTP → 画面JSON + Rhaiソース
             ↓
Rust / WASM エンジン
  DSL解析・構造検証
  Rhai → ASTコンパイル → イベントごとの実行
  状態管理・共通レイアウト・部品スナップショット生成
             ↓
ブラウザ描画バックエンド
  DOM: 既存のinputやbuttonを維持して更新
  Canvas: Canvas 2Dで描画、座標から操作対象を判定
```

画面処理はRust/WASM内で実行する。JavaScriptはHTTP取得、WASMメモリとの受け渡し、DOM更新・Canvas API呼び出しを担当する。Canvasの描画命令発行はこの段階ではJavaScript側のバックエンドにある。

- `engine/src/lib.rs`: 共通エンジンと手動のUTF-8 JSON ABI。
- `engine/src/fields.rs`: uivolveの部品設定、初期値、入力値の検証とスナップショット。
- `src/engine.js`: WASM呼び出し。スクリプトをJavaScriptへ変換・evalしない。
- `src/webmcp.js`: 描画方式に依存しない共通ツールとブラウザへの登録アダプター。
- `src/dom-renderer.js` / `src/canvas-renderer.js`: 描画・入力のアダプター。
- `public/screens/`: エンジンとは別に配信する７画面。
- `engine/src/layouts.rs` / `docs/layouts.md`: Grid/Card/Border/Fitと共通余白の計測・配置・契約。
- `engine/src/grid.rs` / `navigation.rs`: Gridの操作・下書き・ページ生成とタブ・ツリー・メニューの共通状態。
- `docs/screen-format.md`: 画面・スクリプトの契約。
- `docs/theme-format.md` / `public/themes/`: 配色の契約と標準テーマ。フォントや余白を指定する汎用スタイルDSLは含まない。
- `skills/wasm-ui-authoring/SKILL.md`: AI向けの画面作成ガイド。

## 検証上の限界

Canvas版は **Canvas 2D + 編集時のネイティブ入力・選択欄**。WebGL / WebGPUや独自IMEは実装していない。日本語文字の入出力とcompositionイベントの扱いは確認できるが、OSの実IME・変換候補位置・モバイルキーボードは対象環境での手動検証が必要。

DOM版はネイティブ入力・ボタンを使用する。Canvas版はキーボード移動と入力連携を提供するが、部品ごとのアクセシビリティツリーは未実装。DOM相当のスクリーンリーダー対応、文字選択、ブラウザ内検索、印刷を提供しているとはみなさない。

ウィンドウは各描画エリア内のモーダル。比較ページ全体は遮断しない。幅はエリアに収め、内容が高い場合はエリア自体を拡張する。ドラッグ移動、サイズ変更、非モーダル表示、内部スクロールは未実装。

このDSLはuivolveの宣言的な部品・配置という考えを踏まえた小さな試験用フォーマット。uivolve / ExtJSとの完全互換はない。

スクリプトは同期実行。`async/await`、通信サービス、タイマー、モジュールimport、時刻APIは未実装。操作数上限などは応答性のための制限であり、第三者コードを安全に実行するための隔離環境を保証しない。

次の比較では、非同期処理の契約、大量データ・仮想スクロール、IMEの実機検証、アクセシビリティ、GPU描画を順に検証できる。
