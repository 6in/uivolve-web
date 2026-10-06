# レンダラー間のフォントサイズ台帳

DOM 版と Canvas 版が同じ役割の文字を同じ実効サイズで表示しているかを、実ブラウザの実測値で
記録する台帳です。CSS の宣言値を読み比べるのではなく、`getComputedStyle` の計算値と Canvas の
実 `fillText` / `measureText` 呼び出しを採取して突き合わせます。

- 検査の入口: [`scripts/test-font-parity-browser.mjs`](../scripts/test-font-parity-browser.mjs)
- 最終判定: [`scripts/verify-font-parity.mjs`](../scripts/verify-font-parity.mjs)
- 観測コード: [`tests/browser/font-parity.mjs`](../tests/browser/font-parity.mjs) ・
  [`tests/browser/font-parity-harness.js`](../tests/browser/font-parity-harness.js) ・
  [`tests/browser/font-parity.html`](../tests/browser/font-parity.html)
- runner 自体の検査: [`tests/font-parity-runner.test.js`](../tests/font-parity-runner.test.js)

## 実行方法

```bash
bun run build:wasm
bun scripts/test-font-parity-browser.mjs --suite baseline
```

- `--suite <name>` は繰り返し指定できます。`--list` で登録済み suite と実装状態を表示します。
- ブラウザ経路は `--browser-path <実行ファイル>` と `--browser-endpoint <CDP URL>` のどちらかを
  選びます（同時指定はエラー）。環境変数 `FONT_PARITY_BROWSER_PATH` /
  `FONT_PARITY_BROWSER_ENDPOINT` でも指定できます。既定は `/usr/bin/chromium-browser` →
  `/usr/bin/chromium` → `/snap/bin/chromium` の順で最初に存在したものです。
- `--browser-endpoint` で外部ブラウザへ接続したときは、このプロセスが作った context だけを閉じ、
  ブラウザ本体は終了しません。`--browser-path` で起動したときだけブラウザを閉じます。
- 検証サーバーは `bunx vp dev` を空きポート（OS 自動割当）で起動し、プロセスグループごと
  終了させます。既存のサーバーには接続も終了もしません。
- `--viewport 390x844` で幅を変えられます。既定は `1440x1000`、`deviceScaleFactor` は 1 です。
- 証跡（JSON・PNG）は `--evidence <dir>`（既定 `.gsd-lite/logs/renderer-font-size-parity`）へ
  書き出します。

## suite の一覧と実装状態

| suite          | 担当  | 内容                                            |
| -------------- | ----- | ----------------------------------------------- |
| `baseline`     | T1    | 修正前の台帳。差があっても報告のみで成功する    |
| `roles`        | T2/T3 | 役割別サイズと reset、Canvas 描画・計測の照合   |
| `editing`      | T4    | 通常値・編集オーバーレイ・Grid 編集             |
| `surfaces`     | T5    | document / figure / dialog / media の実効倍率   |
| `lifecycle`    | T6    | フォント完了・DPR 変更時の再描画と解放          |
| `matrix`       | T8    | 幅・拡大・配色の行列と代表画像                  |
| `distribution` | T9    | 生成した配布物からの独立 runtime / minimal 確認 |

未実装の suite は**成功として扱わず、非 0 で終了します**。登録されていない名前も非 0 です。
どちらもサーバーとブラウザを起動する前に判定します。

## 観測の方法と限界

- Canvas の観測は `CanvasRenderingContext2D.prototype` の `fillText` / `measureText` /
  `clearRect` を包み、**必ず元のメソッドへ委譲**します。描画結果（ピクセル）は変えません。
  全面 `clearRect` を 1 フレームの区切りとして扱い、画面に出ている最後のフレームだけを残します。
- Canvas の座標とサイズは `getTransform()` の値から CSS 座標系へ換算します
  （`effectiveFontSize = 宣言px × ローカル倍率 ÷ devicePixelRatio`）。bitmap の DPR 倍率は
  除いた値で DOM の computed font-size と比べます。
- 同じ文字列が複数回出るため、Canvas の描画は**位置（CSS px）・widget の key・kind**で
  役割に対応付けます。文字列だけでは対応付けません。独立 runtime では実 Scene の widget 矩形、
  比較デモでは `#dom-stage` 内の `.ui-widget` の矩形（両面で同じ Scene 幾何）を使います。
- 現状のホストは**Web フォントの読み込み完了で再描画しません**（T6 の対象）。そのため baseline は
  `document.fonts.ready` の後にステージ幅を実際に変えて再描画を起こし、基準 viewport に戻した
  フレームを採取します。再描画を起こせなかった場合は古いフレームを採らずに失敗します。
- データが欠けたとき（DOM 文字 0 件、Canvas 描画 0 件、`document.fonts` 未完了、日本語字体の
  証拠なし、bitmap 幅なし、解釈できない Canvas font 文字列、ページ/ランタイムのエラー）は
  非 0 で終了します。採れた分の JSON は失敗時も書き出します。

## フォントの証拠（名前の指定と字体の有無は分ける）

`font` 節は 3 つに分かれます。**宣言（declared）**はスタイルシートが要求した名前、
**可用性（available）**は `document.fonts.check` の返り値、**描画（rendered）**は実際に
塗られたピクセルです。

2026-10-06 の実測（Chromium 152.0.7977.64 / Linux 6.8.0-142-generic）:

| 項目                                   | 値                                                                    |
| -------------------------------------- | --------------------------------------------------------------------- |
| 宣言された font-family                 | `Inter, "Noto Sans JP", system-ui, sans-serif`（`src/runtime.css:3`） |
| `document.fonts` の読み込み済み face   | 0 件（Web フォントは同梱していない）                                  |
| `document.fonts.check` の返り値        | 全ファミリ・全サンプルで `true`                                       |
| 実描画 `Abc123` (13px)                 | 塗りピクセル 239、インク幅 44px、`measureText` 44.21px                |
| 実描画 `日本語テキスト` (13px)         | 塗りピクセル 480、インク幅 87px、`measureText` 91.00px                |
| 実描画 `U+E000 U+E001`（未割当）(13px) | 塗りピクセル 206、インク幅 24px、`measureText` 26.00px                |

- `document.fonts.check` は未割当の私用領域コードポイントにも `true` を返すため、**字体が
  存在する証拠にはなりません**。実際に使える字体かどうかは `rendered` のインク幅で判定します。
  日本語のインク幅（87px）が未割当の豆腐（24px）と異なるため、日本語は実在の字体で描かれています。
- 読み込み済み face が 0 件なので、`Inter` / `Noto Sans JP` はこの環境では**システム側の
  フォールバック字体**で解決されています。字体そのものの差は本マイルストーンの対象外です
  （対象はサイズの一致）。別の OS・別の字体構成では幅の実測値が変わります。

## 修正前の実測値 — Hello World

- 採取日: 2026-10-06 / Chromium 152.0.7977.64 / Linux 6.8.0-142-generic
- viewport 1440x1000、devicePixelRatio 1、テーマ `ライト`（light）、ホスト font-size 16px
- Canvas: CSS 幅 599px / bitmap 幅 599px（DPR 1 なので同値）
- 実 WASM 読み込み: 画面 id `hello-world`、Scene 2 面 × widget 3 件
  （`textfield/nameInput`・`button/helloButton`・`label/greetingLabel`）
- 証跡: `.gsd-lite/logs/renderer-font-size-parity/baseline.json`、
  `baseline-demo-comparison.png`、`baseline-demo-canvas.png`、`baseline-standalone.png`

比較デモ（`/pages/hello-world`）と独立 `UiRuntime`
（`tests/browser/font-parity.html`）で**同じ値**でした。

| 役割                      | key             | DOM 実効              | Canvas 実効           | 差      |
| ------------------------- | --------------- | --------------------- | --------------------- | ------- |
| textfield ラベル「名前」  | `nameInput`     | 11px / weight 500     | 11px / weight 500     | なし    |
| textfield placeholder     | `nameInput`     | 13px / weight 400     | 13px / weight 400     | なし    |
| button ラベル「挨拶する」 | `helloButton`   | **16px / weight 400** | **12px / weight 500** | **4px** |
| label 本文（greeting）    | `greetingLabel` | 11px / weight 400     | 11px / weight 400     | なし    |

- **button だけが不一致**です。`.uivolve-runtime :is(button, input, select, textarea)` の
  `font: inherit`（`src/runtime.css:11-12`、詳細度 0,1,1）がボタンの `font-size: 12px` /
  `font-weight: 500`（`src/runtime.css:431,436-437`、詳細度 0,1,0）に勝ち、DOM 側だけがホストの
  16px / 400 を継承しています。入力欄は
  `:where(.uivolve-runtime) .ui-field > :is(input, select, textarea)`
  （`src/runtime.css:352,357`）が同じ詳細度 0,1,1 で後から宣言されるため 13px を保っています。
  つまり壊れているのは「宣言の値」ではなく「reset の詳細度」です。
- この 1 件は DECISIONS の「DOM の部品別宣言値を基準とし、偶発的な reset 継承を修正する」に
  そのまま対応します。修正は T2 で行います。
- 画像でも DOM 側のボタン文字が Canvas 側より明らかに大きく、サイズ差は目視でも確認できます。
- Hello World には 11/12/13px の役割しか出ません。9px・20px・22px・30px、document / figure、
  Grid、dialog、media などは後続タスクの suite と補助 fixture で採取します。

### 未取得・対象外（理由付き）

| 項目                                 | 状態・理由                                                        |
| ------------------------------------ | ----------------------------------------------------------------- |
| 比較デモ側の Scene オブジェクト      | デモは Scene を公開しないため、DOM の `.ui-widget` 矩形で代用した |
| 実 IME での変換中入力                | 無人環境では実行できない。T4 で合成 composition と分けて記録する  |
| 実ブラウザのズーム 100/200%          | T8 で実施方法と代用（DPR エミュレーション）を分けて記録する       |
| ホスト外枠（デモのページ装飾）の文字 | ランタイム外の表示であり、本マイルストーンの対象外                |
| 字体そのもの（グリフ形状）の差       | 対象はサイズの一致。字体はシステムのフォールバックに依存する      |
| `--browser-endpoint` の実接続        | 実装済み。到達できる CDP 接続先がないため、この環境では未実行     |

## 実行環境（T1 で確定）

| 項目         | 値                                                            |
| ------------ | ------------------------------------------------------------- |
| OS           | Linux 6.8.0-142-generic                                       |
| ブラウザ     | Chromium 152.0.7977.64（headless）                            |
| 実行ファイル | `/usr/bin/chromium-browser`                                   |
| サーバー     | `bunx vp dev --host 127.0.0.1 --port <自動割当> --strictPort` |
| ロケール     | `ja-JP`                                                       |
| 新規依存     | なし（既存の `playwright` devDependency のみ）                |

Playwright 同梱の Chromium は未導入です。`--browser-path` を指定しない場合は上記の
システム Chromium が使われます。接続先だけがある環境では `--browser-endpoint` を使います。
