# レンダラー間のフォントサイズ台帳

DOM 版と Canvas 版が同じ役割の文字を同じ実効サイズで表示しているかを、実ブラウザの実測値で
記録する台帳です。CSS の宣言値を読み比べるのではなく、`getComputedStyle` の計算値と Canvas の
実 `fillText` / `measureText` 呼び出しを採取して突き合わせます。

- 検査の入口: [`scripts/test-font-parity-browser.mjs`](../scripts/test-font-parity-browser.mjs)
- 最終判定: [`scripts/verify-font-parity.mjs`](../scripts/verify-font-parity.mjs)
- サイズの単一源: [`src/runtime.css`](../src/runtime.css) の custom properties と
  [`src/font-metrics.js`](../src/font-metrics.js)
- 観測コード: [`tests/browser/font-parity.mjs`](../tests/browser/font-parity.mjs)（suite 本体）・
  [`tests/browser/font-parity-observe.js`](../tests/browser/font-parity-observe.js)（ページへ入れる観測関数。
  何も import しないので配布物のページへもそのまま置ける）・
  [`tests/browser/font-parity-harness.js`](../tests/browser/font-parity-harness.js)（開発サーバー上の fixture 操作）・
  [`tests/browser/font-parity.html`](../tests/browser/font-parity.html) ・
  [`tests/browser/font-parity-dist-embed.html`](../tests/browser/font-parity-dist-embed.html)（配布物を読む組み込みホスト）
- 補助 fixture: [`tests/browser/font-parity-text.json`](../tests/browser/font-parity-text.json)（文字の形）・
  [`tests/browser/font-parity-edit.json`](../tests/browser/font-parity-edit.json)（列エディタの kind）・
  [`tests/browser/font-parity-surface.json`](../tests/browser/font-parity-surface.json)（図表・media・文字アイコン）・
  [`tests/browser/font-parity-states.json`](../tests/browser/font-parity-states.json)（状態と xtype の穴埋め）
- runner 自体の検査: [`tests/font-parity-runner.test.js`](../tests/font-parity-runner.test.js)

以下は**経過の記録**で、各タスクの節には「その時点で未実施」の表が残っています。節の並びは
作業順ではなく内容のつながりで、T1〜T6 → F3 → T7〜T9 → F1 → F2 → F4 → まとめの順です
（F3 は T6 の `lifecycle` に続くので差し戻しのタスクのうち 1 つだけ前へ出ています）。**いま何が対象外で、何が既存の表現差で、どこに限界があるか**は
[現在の対象外・表現差・限界（まとめ）](#現在の対象外表現差限界まとめ)だけを読めば分かります。

## 実行方法

```bash
bun run build:wasm
bun scripts/test-font-parity-browser.mjs --suite baseline
bun scripts/test-font-parity-browser.mjs --suite roles
bun scripts/test-font-parity-browser.mjs --suite editing
bun scripts/test-font-parity-browser.mjs --suite surfaces
bun scripts/test-font-parity-browser.mjs --suite lifecycle
bun scripts/test-font-parity-browser.mjs --suite matrix
bun run build:runtime
bun run build:minimal
bun scripts/test-font-parity-browser.mjs --suite distribution
```

最終判定は 1 本ですが、**上の suite をまとめただけではありません**。font-parity の 6 suite
（`baseline` は修正前の台帳なので含みません）の前に、`build:wasm` → `vitest` → `test:rust` →
`check` → `docs:check` → `build` → `build:runtime` → `build:minimal` を実行します
（`--print-plan` が出す 14 手順そのもの）。font-parity の suite は配布物を測る
`distribution` が最後です。

```bash
bun scripts/verify-font-parity.mjs            # 14 手順を順に実行し、失敗・中断で非 0
bun scripts/verify-font-parity.mjs --print-plan  # 実行する手順の一覧だけを表示
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
- `distribution` は生成済みの `runtime-dist/` と `app-dist/` を測ります。**この suite は何も
  build しません。** 足りないファイルがあれば、サーバーとブラウザを起動する前に、それを作る
  コマンド名（`bun run build:runtime` / `bun run build:minimal`）を挙げて非 0 で終了します
  （ここで build し直すと「build したもの」と「測ったもの」のずれを隠してしまうため）。

## suite の一覧と実装状態

| suite          | 担当     | 内容                                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `baseline`     | T1       | 修正前の台帳。差があっても報告のみで成功する                                                            |
| `roles`        | T2/T3/T7 | 役割別サイズと reset（T2 済）、Canvas 描画・計測の照合（T3 済）、kind と xtype の二層 coverage（T7 済） |
| `editing`      | T4       | 通常値・編集オーバーレイ・Grid 編集（T4 済）                                                            |
| `surfaces`     | T5       | document / figure / dialog / media の実効倍率（T5 済）                                                  |
| `lifecycle`    | T6/F3    | フォント完了・DPR 変更時の再描画と解放（T6 済）、ステージの状態と描画の切り分け（F3 済）                |
| `matrix`       | T8       | 幅・拡大・配色の行列と代表画像（T8 済）                                                                 |
| `distribution` | T9       | 生成した配布物からの独立 runtime / minimal 確認（T9 済）                                                |

登録済みの suite は**全て実装済み**になりました（T9 で `distribution` を実装）。runner が持つ
「実行する関数が無い suite は拒否する」という歯は残っていて、`tests/font-parity-runner.test.js`
が注入した表で拒否を確かめ、あわせて `SUITES` に関数の無い行が 1 つも無いことを検査します。
新しい suite を関数なしで登録すると、その時点で vitest が落ちます。
登録されていない名前も非 0 です。どちらもサーバーとブラウザを起動する前に判定します。
`roles` は T2・T3・T7 が分担する 1 つの
suite です。T2 が DOM の宣言値・親コンテキスト・サイズ解決器を検査し、T3 が同じ suite へ
Canvas の描画／計測との突き合わせを足し、T7 が kind と xtype の二層 coverage と状態の一覧を
足しました（実行時のログに検査件数を出します）。

`verify-font-parity.mjs` は suite ごとに `bun scripts/test-font-parity-browser.mjs --suite <名前>`
を 1 回ずつ起動します。T6〜T8 の間は `--suite` を重ねて 1 プロセスで続けて走らせると
`lifecycle` の倍率ケースが落ちていました。**T9 で原因を特定して直してあります**: 新しい CDP
セッションを張ると別セッションの倍率上書きが外れるため、先行 suite の撮影のあとは倍率が 1 に
戻っていて、再描画を待つ `waitForFunction` が切れていました（[下記](#限界代用実ブラウザズームと-cdp-のイベント配信)）。
2026-10-07 に `--suite surfaces --suite lifecycle` を 1 プロセスで実行し、両方 passed
（exit 0）になることを確認しています。

## 観測の方法と限界

- Canvas の観測は `CanvasRenderingContext2D.prototype` の `fillText` / `measureText` /
  `clearRect` を包み、**必ず元のメソッドへ委譲**します。描画結果（ピクセル）は変えません。
  全面 `clearRect` を 1 フレームの区切りとして扱い、画面に出ている最後のフレームだけを残します。
- Canvas の座標とサイズは `getTransform()` の値から CSS 座標系へ換算します
  （`effectiveFontSize = 宣言px × ローカル倍率 ÷ devicePixelRatio`）。bitmap の DPR 倍率は
  除いた値で DOM の computed font-size と比べます。
- 同じ文字列が複数回出るため、Canvas の描画は**位置（CSS px）・widget の key・kind**で
  役割に対応付けます。文字列だけでは対応付けません。独立 runtime では実 Scene の widget 矩形、
  比較デモ（`baseline`）では `#dom-stage` 内の `.ui-widget` の矩形（両面で同じ Scene 幾何）を
  使います。レンダラー自身が描く装飾文字（combobox の `▾`・checkbox の `✓`）はどの widget の
  文字列にも無いので、**どの widget の文字列とも一致しないときだけ、描く kind を名指し**して
  候補を絞ります（T8 で追加。狭い幅では位置だけだと隣のボタンへ吸われます。自分で `▾` を持つ
  ツリーの開閉印などは、これまでどおり文字列で対応付きます）。
- ホストは **T6 で Web フォントの完了・失敗と DPR の変更を購読する**ようになったので、画面に出て
  いるフレームは字体が決まった後のものです。baseline は T1 当時の手順（`document.fonts.ready` の
  後にステージ幅を実際に変えて再描画を起こし、基準 viewport に戻す）のまま残しています。修正前の
  基準値を同じ条件で取り直せること、「フレームが 1 枚も描かれていない」ことを検出できることの
  2 つが理由で、**再描画のために必要だからではありません**（[下記](#baseline-の強制再描画について)）。
- データが欠けたとき（DOM 文字 0 件、Canvas 描画 0 件、`document.fonts` 未完了、日本語字体の
  証拠なし、bitmap 幅なし、解釈できない Canvas font 文字列、ページ/ランタイムのエラー）は
  非 0 で終了します。採れた分の JSON は失敗時も書き出します。

## フォントの証拠（名前の指定と字体の有無は分ける）

`font` 節は 3 つに分かれます。**宣言（declared）**はスタイルシートが要求した名前、
**可用性（available）**は `document.fonts.check` の返り値、**描画（rendered）**は実際に
塗られたピクセルです。

2026-10-06 の実測（Chromium 152.0.7977.64 / Linux 6.8.0-142-generic）:

| 項目                                   | 値                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------- |
| 宣言された font-family                 | `Inter, "Noto Sans JP", system-ui, sans-serif`（`src/runtime.css:18`） |
| `document.fonts` の読み込み済み face   | 0 件（Web フォントは同梱していない）                                   |
| `document.fonts.check` の返り値        | 全ファミリ・全サンプルで `true`                                        |
| 実描画 `Abc123` (13px)                 | 塗りピクセル 239、インク幅 44px、`measureText` 44.21px                 |
| 実描画 `日本語テキスト` (13px)         | 塗りピクセル 480、インク幅 87px、`measureText` 91.00px                 |
| 実描画 `U+E000 U+E001`（未割当）(13px) | 塗りピクセル 206、インク幅 24px、`measureText` 26.00px                 |

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
  `font: inherit`（詳細度 0,1,1）がボタンの `font-size: 12px` / `font-weight: 500`
  （詳細度 0,1,0）に勝ち、DOM 側だけがホストの 16px / 400 を継承しています。入力欄は
  `:where(.uivolve-runtime) .ui-field > :is(input, select, textarea)` が同じ詳細度 0,1,1 で
  後から宣言されるため 13px を保っています。
  つまり壊れているのは「宣言の値」ではなく「reset の詳細度」です。
  行番号はこの段落だけ**修正前（`main`）の `src/runtime.css`** を指します:
  reset が 11-12、`.ui-button` が 431 / 436-437、`.ui-field > :is(…)` が 352 / 357。
  現在の木での位置は 37-38 / 466・471-472 / 378・383 です。
- この 1 件は DECISIONS の「DOM の部品別宣言値を基準とし、偶発的な reset 継承を修正する」に
  そのまま対応します。**T2 で修正済み**（下記「役割別サイズの単一源と reset の修正」）。
  修正後に同じ条件で `baseline` を採り直すと、両面とも**サイズ差 0 件**になります
  （`.gsd-lite/logs/renderer-font-size-parity/after-t2/baseline.json`。修正前の
  `baseline.json` は同ディレクトリの親に残しています）。
- 画像でも DOM 側のボタン文字が Canvas 側より明らかに大きく、サイズ差は目視でも確認できます。
- Hello World には 11/12/13px の役割しか出ません。9px・20px・22px・30px、document / figure、
  Grid、dialog、media などは後続タスクの suite と補助 fixture で採取します。

### 未取得・対象外（理由付き）

| 項目                                 | 状態・理由                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 比較デモ側の Scene オブジェクト      | デモは Scene を公開しないため、DOM の `.ui-widget` 矩形で代用した                                                              |
| 実 IME での変換中入力                | 無人環境では実行できない。T4 が合成 composition と分けて記録した                                                               |
| 実ブラウザのズーム 100/200%          | **未実施のまま**。T8 が同値変換（CSS viewport ÷ Z・DPR × Z）で実施し、実ズーム・CSS `zoom`・DPR エミュレーションを別記録にした |
| ホスト外枠（デモのページ装飾）の文字 | ランタイム外の表示であり、本マイルストーンの対象外                                                                             |
| 字体そのもの（グリフ形状）の差       | 対象はサイズの一致。字体はシステムのフォールバックに依存する                                                                   |
| `--browser-endpoint` の実接続        | 実装済み。到達できる CDP 接続先がないため、この環境では未実行                                                                  |

## 役割別サイズの単一源と reset の修正（T2）

### サイズの単一源

役割ごとのサイズは [`src/runtime.css`](../src/runtime.css) の `.uivolve-runtime` に置いた
custom properties が唯一の定義です。DOM 側の各宣言はこの変数を参照し、Canvas 側は
[`src/font-metrics.js`](../src/font-metrics.js) の `resolveFontMetrics(stage)` が**ステージの
computed 値から同じ変数を解決**します。`font-metrics.js` は数値を 1 つも持ちません
（プロパティ名と解決手順だけ）。ランタイム内部の仕組みであり、公開設定 API ではありません。

| custom property          | 値     | 役割の例                                               |
| ------------------------ | ------ | ------------------------------------------------------ |
| `--ui-font-size-meta`    | `9px`  | Kanban カードの ID                                     |
| `--ui-font-size-label`   | `11px` | field ラベル、metric の見出し、`ui-label`、grid 見出し |
| `--ui-font-size-caption` | `12px` | button、panel、window タイトル、grid セル、tab、menu   |
| `--ui-font-size-body`    | `13px` | field の値、dialog 本文、`canvas-editor`、`ui-widget`  |
| `--ui-font-size-close`   | `20px` | window の閉じるボタン                                  |
| `--ui-font-size-metric`  | `22px` | metric の数値                                          |
| `--ui-font-size-icon`    | `30px` | dialog アイコン・絵文字                                |

解決に失敗したとき（ランタイム CSS が読み込まれていない、`px` 以外の値、0 以下、
ステージが文書に無い）は**例外を投げます**。既定値へのフォールバックはしません。
`roles` suite はこの 3 系統の失敗（要素なし・ランタイム外・不正な値）を毎回確認します。

### reset の詳細度

```css
/* 修正前（詳細度 0,1,1 — 部品の宣言 0,1,0 に勝ってしまう） */
.uivolve-runtime :is(button, input, select, textarea) {
  font: inherit;
}
/* 修正後（詳細度 0,1,0 — 部品の宣言と同じ詳細度。後から宣言される部品側が勝つ） */
.uivolve-runtime :where(button, input, select, textarea) {
  font: inherit;
}
```

`font: inherit` 自体は残します（フォーム部品がブラウザ既定のフォントに戻らないため）。
詳細度を 0,1,0 にしたことで、**宣言がある部品は自分の値、宣言が無い部品だけが継承**という
本来の関係になります（部品の宣言は同じ 0,1,0 で、この reset より後にあるので勝ちます。
だから reset はフォントを宣言するどの規則よりも前に置き、0,1,0 より強くしません）。
ホスト側（ランタイム外）の computed 値は変わりません。

`:where()` を両側に付けて 0,0,0 まで下げた形は **F4 で取り消しました**。0,0,0 ではホスト
ページの `button, input, select, textarea { font: … }`（0,0,1）が reset に勝ち、サイズは
部品側の宣言で保たれるものの字体・斜体・太さがホストのものになっていました。詳しくは
「ホストのタグ規則からフォーム部品を守る（F4）」の節。

### 修正で直った役割（修正前 → 修正後）

ホスト font-size 16px / ライト / 1440x1000 での実測。修正前の値は reset を元に戻して
`roles` suite を実行し、224 件の不一致として採取しました。

| 役割            | 親コンテキスト | 修正前   | 修正後   | 画面       |
| --------------- | -------------- | -------- | -------- | ---------- |
| `button`        | root           | 16px/400 | 12px/500 | components |
| `button`        | window         | 13px/400 | 12px/500 | components |
| `panel-toggle`  | root           | 16px/400 | 12px/600 | components |
| `window-close`  | window         | 13px     | 20px     | components |
| `canvas-editor` | canvas-stage   | 16px     | 13px     | components |
| `menu-trigger`  | root           | 16px     | 12px     | grid-lab   |
| `menu-item`     | popup          | 13px     | 12px     | grid-lab   |
| `grid-column`   | grid-head      | 13px     | 12px     | grid-lab   |
| `grid-cell`     | grid-row       | 13px     | 12px     | grid-lab   |
| `tab`           | tabbar         | 13px     | 12px     | grid-lab   |

`window` / `popup` / `grid-row` の中で修正前が 13px だったのは、`.ui-widget` の 13px を
継承していたためです（root 直下だけがホストの 16px を継承していました）。つまり壊れ方は
親コンテキストごとに違い、宣言値の比較では見つけられません。

### `roles` suite が確認していること（T2 時点）

`bun scripts/test-font-parity-browser.mjs --suite roles`。実 WASM で 2 画面
（`screens/components.json` / `screens/grid-lab.json`）× ホスト font-size 16/20px ×
ライト/ダークの **8 ケース・308 件**を実測します。

- 16 役割の computed font-size と font-weight が、親コンテキスト・ホストのサイズ・テーマに
  かかわらず局所宣言どおりであること（`button` 12/500、`window-close` 20、`canvas-editor` 13 ほか）
- 親コンテキスト `root` / `window` / `popup` / `canvas-stage` / `grid-row` / `grid-head` /
  `tabbar` のすべてで 1 件以上を実測していること。**契約に挙げた役割か必須コンテキストが
  1 件も採れなければ非 0**（黙って skip しない）
- `resolveFontMetrics` が DOM ステージと Canvas ステージの両方で 7 つのサイズすべてを
  契約どおりに解決し、不正入力では例外を投げること
- ステージの computed font-size がホストの値（16/20px）と一致すること
  = ランタイムは root に font-size を宣言していない
- ランタイム外（ホスト要素・`document.body`）の computed font-size が全ケースで同一であること
- window オーバーレイと menu ポップアップ、Canvas の編集オーバーレイは**実クリックで開く**
  （要素を手で作らない）。Canvas は Scene の widget 矩形から座標を出して `pointerdown` を送る
- 証跡: `roles.json` と `roles-<画面>-<テーマ>-host<サイズ>.png` 8 枚

### T2 の時点で未実施（理由付き）

| 項目                                      | 状態・理由                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas の描画／計測と役割の突き合わせ     | T3 で実施（下記）                                                                                                                                                                                                                             |
| `font-metrics.js` の Canvas への接続      | T3 で実施（下記）                                                                                                                                                                                                                             |
| 親コンテキスト「panel 内」                | ホストは panel の子をステージ／レイヤー直下に絶対配置する（Scene に `parentKey` が無い）ため、**DOM 上に panel 親は存在しない**。panel 自身の box を 1 役割として検査し、実際に入れ子になる grid 行／見出し・tabbar・popup・window で代替した |
| Grid 編集の 12px、通常 field の 13px 区別 | T4。T2 では `.ui-field > input` の 13px のみを検査する                                                                                                                                                                                        |
| 9px・30px の役割                          | 9px は T3 で採取（Kanban カード ID）。30px の dialog 絵文字は T5                                                                                                                                                                              |
| 幅・DPR・拡大の行列                       | T8 が実施（実ズームは未実施のまま代用）。T2 は 1440x1000 / DPR 1 固定。T8 が条件を動かしたのは 39 役割のうち 26 で、T2 の役割がすべて行列に乗ったわけではない（[下記](#条件を動かして測った範囲)）                                            |

## Canvas の描画と計測を役割へ接続（T3）

### 接続のしかた

`src/canvas-renderer.js` にはもう**サイズの数値がありません**。描画の入口
`text(text, x, y, width, color, role, weight, family, align)` は px ではなく**役割名**を
取り、フレームの先頭（`paint()`）で 1 回だけ解決した
`resolveFontMetrics(this.stage)` から px を引きます。文字ごとに `getComputedStyle` は
呼びません。削除した定数は `FONT`（`'"Inter", "Noto Sans JP", system-ui, sans-serif'` の
二重定義）で、字体はステージの computed `font-family` から来ます。

直接 `ctx.font` を書いていた 3 か所（Grid／tab／menu の計測、button の中央寄せ計測、
textarea の折返し計測）も同じ `metrics.font(role, weight, family)` を使います。**計測と
描画で同じ font 文字列**になるため、省略記号や中央寄せの判断をしたサイズと実際に塗った
サイズがずれません。等幅（`codeeditor` / `htmleditor` の `config.monospace`）だけが
family を `monospace` に差し替えます。

| Canvas の kind                                                                                                            | 役割（許可するサイズ）                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `label`、`grid-header`、`slider`（ラベル）                                                                                | `label` 11px                               |
| `button`、`extra-button`、`panel`、`fieldset`、`panel-toggle`、`window`、`tree-shell`、`tree-node`、`tree-toggle`         | `caption` 12px                             |
| `tab`、`menu-trigger`、`menu-item`、`grid-column`、`grid-cell`、`grid-select`、`grid-page`、`row`、`empty`、`progressbar` | `caption` 12px                             |
| `window-close`                                                                                                            | `close` 20px                               |
| `toast`、`dialog-message`                                                                                                 | `body` 13px                                |
| `metric`                                                                                                                  | `label` 11px + `metric` 22px               |
| `kanban-lane`                                                                                                             | `caption` 12px + `label` 11px              |
| `kanban-card`                                                                                                             | `caption` 12px + `label` 11px + `meta` 9px |
| field 各 kind（`textfield`/`numberfield`/`datefield`/`textarea`/`combobox`/`listbox`/`checkbox`/`radio`/`displayfield`）  | `label` 11px（ラベル） + `body` 13px（値） |

### `roles` suite が Canvas 側で確認していること

**T3 時点の件数**: 実 WASM の 13 fixture（画面ファイルは 8 つ。1 つの画面ファイルからタブや
ドラッグ状態で複数の fixture を取るため、fixture 数と画面ファイル数は一致しません）を
**19 ケース**（T2 の 2 fixture はホスト 16/20px × ライト/ダークで 4 ケースずつ、T3 が足した
11 fixture は ライト/ホスト 16px の 1 ケースずつ）で実行し、**664 件の Canvas 描画／36 kind**を
突き合わせていました。T7 以降の現在値は 22 fixture（画面ファイル 9）・28 ケース・
Canvas 描画 1276 件・37 kind です（[下記](#roles-suite-が-t7-で確認していること)）。
Canvas のサイズは CSS の custom properties から毎フレーム解決されるので、
テーマとホストのサイズを変えても変わりません。その独立性は T2 の 8 ケースが実測しています。

- 描画 1 件ごとに、その kind に許可された役割のどれかの px であること。許可外の px は非 0
- 実効サイズが宣言サイズと一致（`localScale` が 1、ローカル変形で拡大されていない）
- font の family がステージの解決済み family、または `monospace` であること
- **`measureText` に使った font 文字列が、その計測が属する `fillText` の font と一致すること**
  （計測と描画のサイズ・太さ・字体のずれを検出する）。F1 までは「同じフレームのどこかの
  `fillText` に現れること」という枠だけの検査で、フレーム内で他の部品が使っている font なら
  通ってしまいました。現在は記録器が計測 1 件ごとに「そのフレームでそれまでに記録した描画の
  件数」を押しており、renderer は描く直前に測るので、その番号が計測の属する描画を指します
  → [役割単位の突き合わせ（F1）](#役割単位の突き合わせf1verify-round-1)
- 文字の形の網羅: 左／中央／右寄せ、空文字、日本語、長い英数字、省略された描画と
  省略されなかった描画、等幅の折返しが**すべて 1 件以上**実測されていること。
  1 つでも 0 件なら非 0（上の計測／描画一致が何も証明しない状態を成功にしない）
- **幅境界の両側を部品単位で assert すること**（F2）。`boundaryFits` は両面とも省略なし
  （DOM は送り幅 ≦ 枠・1 行、Canvas は Scene の値そのものを描く）、`boundaryOverflows` は
  両面とも省略（DOM は送り幅 > 枠、Canvas は `…` で終わる描画で、省略前の文字列が値の
  先頭と一致する）。上の「形の網羅」はフレーム全体の件数なので、**どちらかの境界側が
  消えても 0 件にはならない**（F2 以前は `overflowsBox` が枠に収まる長さで、境界の
  「後」側が実際には出ていませんでした。fixture の値を 200 文字へ伸ばして条件を作り直し、
  短い値へ戻すと `roles` が非 0 になることを確かめています）
- `CANVAS_KIND_CONTRACT` の必須 kind が 1 件以上描かれていること（**T3 時点 36 種、現在 37 種**。
  T3 は `fieldset` を T7 へ送っていました）。採れない kind は理由付きで `roles.json` の
  `gaps` に残す
- 描画の役割への対応付けは、①文字を描く kind だけを候補にする（backdrop や行背景が他の
  widget の文字を吸わない）②ローカル変形がある描画は surface sprites（`figure`/`document`）
  のものとする ③候補のうちその文字列を出せる widget を優先し、同じなら位置（面積の小さい
  box → 後に描かれた方）で決める、の 3 段です。**文字列だけでは対応付けません**

### T3 で足した fixture

| fixture                                  | 画面                                  | 採れる役割                                                                                                      |
| ---------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `grid-lab-tree` / `grid-lab-memo`        | `screens/grid-lab.json` のタブ 2/3    | `tree-shell`・`tree-node`・`tree-toggle`、`textarea`                                                            |
| `forms`                                  | `screens/uivolve-forms.json`          | `progressbar`、`listbox`、`slider`、`numberfield`、`datefield`、`combobox`、`displayfield`、`checkbox`、`radio` |
| `text-shapes`                            | `tests/browser/font-parity-text.json` | 寄せ 3 種・空・日本語・長い英数字・幅境界の両側・等幅の折返し                                                   |
| `kanban`                                 | `screens/kanban.yaml`                 | `kanban-lane`・`kanban-card`（9px の ID を含む）、`empty`                                                       |
| `orders`                                 | `screens/orders.json`                 | 旧 Grid の `grid-header`・`row`                                                                                 |
| `gallery`                                | `screens/uivolve-gallery.json`        | `toast`、`extra-button`（カレンダー）、`grid-page`（ページング）                                                |
| `gallery-chart`                          | 同（チャートタブ）                    | surface sprites（T3 時点で T5 へ送った 39 件。T5 の現在値は 18 ケース・sprite の対 257 件）                     |
| `dialogs`                                | `screens/dialogs.yaml`                | `dialog-message`、`window`、`window-close`                                                                      |
| `kanban-drag-dom` / `kanban-drag-canvas` | `screens/kanban.yaml`                 | drag ghost（押下したまま計測し、Escape で取り消す）                                                             |

`text-shapes` は実 WASM の補助 fixture です（[`tests/browser/font-parity-text.json`](../tests/browser/font-parity-text.json)
＋ `.rhai`）。アプリ画面のどれにも寄せ・幅境界・等幅が揃って出ないため、**条件を実際に
描かせてから**計測と描画の一致を主張します。

drag ghost は押しっぱなしでしか存在せず、pointer capture は実入力でしか得られないため、
この 2 ケースだけ Playwright の `page.mouse` で本物の押下・移動を行い、計測のあと
`Escape` で取り消してから離します（fixture の状態を動かさない）。ghost は `kanban-card` の
分岐ではなく `paintKanban` の末尾の別ブロックで描かれ（`src/canvas-renderer.js:883-921`）、
カードと同じ `caption` 600 + `label` の 2 件です。観測側では ghost は上の 3 段の③で
**位置の下にある kind** へ対応付けられるので、`kanban-card` の役割表ではなく、その kind に
許可された役割の集合で判定します（下記の [`drag-ghost`](#状態の一覧18-件担当-suite-付き)）。

### T3 の時点で未実施・対象外（理由付き）

| 項目                                                  | 状態・理由                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `figure` / `document` の sprites（T3 時点 39 件）     | T5 で実施（現在は 18 ケース・sprite の対 257 件）。`paintSurface` がローカル変形をかけるため実効倍率の換算が別問題。`roles` suite は kind と理由を記録して除外する                                                                                                          |
| `dialog-icon` の 30px                                 | T5。`dialogs` 画面の標準アイコンは SVG 画像で描かれ `fillText` を通らない。絵文字・任意文字の 30px は T5 が採る                                                                                                                                                             |
| `media` の空／エラー案内                              | **T5 で修正済み**。T3 時点では Canvas 13px 対 DOM 12px の既知の不一致でした。現在は両面とも `caption` 12px（DOM は `[data-media-kind][data-empty]::after` ＝ `src/runtime.css:560-569`）                                                                                    |
| `fieldset`                                            | `uivolve-forms` の fieldset は collapsible でタイトルを `panel-toggle` が描くため、本体の描画は空文字で内容からは対応付けられない。canvas-renderer では panel と同じ分岐（`kind === "panel" \|\| kind === "fieldset"`）。T7 が kind 単位で閉じる                            |
| `extra-button` の太さ                                 | Canvas は 12px/500、DOM は 12px/400（`.ui-extra-button` は font-weight を宣言しない）。**サイズは一致**。太さの差は本マイルストーンの対象外で、**F1 の太さ一覧**（`roles` 28 ケースで 467 件）と[現在の対象外・表現差の一覧](#現在の対象外と既存の表現差一覧)に入れています |
| drag ghost の ID                                      | ghost は Canvas でも DOM でも ID を出しません（Canvas はタイトルと説明だけを描き、DOM の `::after` は `.ui-kanban-card` にしか当たりません）。**両面で同じ**なので既存差として記録のみ                                                                                      |
| 幅境界の「ちょうど 1px 手前／後」                     | 省略の分岐は描画記録から px 単位では特定できない（`text()` に渡す width は記録に無い）。枠に収まる値と収まらない値を**同じ幅の 2 つの部品**に置き、両面の省略有無を部品単位で assert して分岐の両側を押さえている（F2）                                                     |
| Grid 編集の 12px と通常 field の 13px                 | **T4 で実施**（下記）。T3 は通常 field の `label` + `body` までを接続した                                                                                                                                                                                                   |
| 一時状態（selected/disabled/calendar 月端など）の網羅 | T7。T3 は fixture が出す状態で kind を網羅した                                                                                                                                                                                                                              |

### 検査に歯があることの確認

`metric` の値の役割を `metric`(22px) から `body`(13px) に差し替えて `roles` を実行すると、
`components` と `grid-lab` の全ケースで「canvas metric … は 13px（役割 body）。許可:
label=11px, metric=22px」として非 0 になりました。確認後に元へ戻しています。

## 通常値と編集オーバーレイ、Grid 編集（T4）

### 決めたこと — サイズの例外は編集中のセルだけ

通常の field は値も placeholder も `body` 13px、Grid のセルは表示中も編集中も `caption`
12px です。例外の目印は**編集されている widget 自身の `config.gridEditor`** だけで、
同じ画面の他の field には届きません。

| 面                        | 対象                                                                       | サイズ                                   |
| ------------------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| DOM・通常 field           | `.ui-field:not(.grid-editor) > :is(input, select, textarea)`、`option`     | `body` 13px                              |
| DOM・Grid 編集            | `.ui-field.grid-editor > :is(input, select, textarea)`、`option`           | `caption` 12px                           |
| DOM・Grid 編集の box      | `.ui-field.grid-editor .box-control`（checkbox 編集のキャプション）        | `caption` 12px                           |
| Canvas・通常オーバーレイ  | `.canvas-editor:not(.grid-editor)`                                         | `body` 13px                              |
| Canvas・Grid オーバーレイ | `.canvas-editor.grid-editor`                                               | `caption` 12px                           |
| Canvas の描画             | `paintField` の値（`displayfield`・box・listbox・textarea・combobox 共通） | `gridEditor` なら `caption`、他は `body` |

- CSS の例外は 1 ブロックだけです（`src/runtime.css`）。詳細度は `.ui-field.grid-editor > input`
  が 0,2,1 で基準の `.ui-field > input`（0,1,1）に勝ちます。`!important` は使いません。
- DOM 側の目印は `src/dom-renderer.js` が field を描くときに
  `root.classList.toggle("grid-editor", Boolean(widget.config.gridEditor))` で毎回付け直します。
  Canvas 側のオーバーレイは `openEditor` が同じ条件で class を付けます。
- Canvas の描画は `paintField` の中で役割を 1 つ選び（`gridEditor ? "caption" : "body"`）、
  値・box キャプション・listbox の行・textarea の折返し計測・combobox の `▾` すべてに同じ
  役割を渡します。**ラベル帯（`label` 11px）は別**で、Grid 編集では `labelHeight` が 0 なので
  そもそも描かれません。
- Grid の列エディタに使える xtype はエンジン側で `textfield` / `numberfield` / `datefield` /
  `combobox` / `checkbox` に限られます（`engine/src/grid.rs:61-67`）。`textarea` と `listbox` は
  列エディタにはなれないため、この 2 つは**通常 field と Canvas オーバーレイ**として検査します。

### ラベル帯の 3 種類

`labelHeight` はエンジンが付ける値で、サイズを CSS から読み直さずに 3 つの場合を見分けられます。

| `labelHeight` | 場合                                                    | 根拠                                                 |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `0`           | Grid 編集中のセル / `fieldLabel` の無い checkbox・radio | `engine/src/grid.rs:564`、`engine/src/fields.rs:365` |
| `22`          | dialog の prompt 入力欄                                 | `engine/src/dialogs.rs:481`                          |
| `24`          | その他すべての field                                    | `engine/src/fields.rs:365`                           |

### `editing` suite が確認していること

`bun scripts/test-font-parity-browser.mjs --suite editing`。実 WASM の **16 ケース・DOM 353 件・
Canvas 描画 665 件（うち Grid 編集中 11 件）**と、**12 本の操作スクリプト**（6 画面 × DOM / Canvas
両面）・**2 本の変換プローブ**を実行します。

- 14 役割の computed font-size（上の表）。**通常 field と Grid 編集を必ず同じ画面・同じ瞬間に
  実測**します。セレクタでの照合に加えて、画面上の全入力欄を列挙して
  「`gridEditor` なら 12px、それ以外は 13px」も直接確かめます（マークアップが変わっても効く形）
- Grid 編集の 5 kind（`textfield` / `numberfield` / `datefield` / `combobox` / `checkbox`）が
  すべて実測されていること。`labelHeight` の 0 / 22 / 24 がすべて現れていること。
  等幅・非等幅の入力欄と placeholder を持つ入力欄がそれぞれ 1 件以上あること。
  **1 つでも欠けたら非 0**（契約に挙げた役割が 1 件も採れない場合も同じ）
- Canvas 側は `roles` と同じ突き合わせを通し、`gridEditor` の描画は `caption` だけを許可します
- 操作スクリプト（実キー入力）。**どの画面も DOM / Canvas の両面**で走ります（片面しか
  操作していない画面があれば非 0。F2 以前は uivolve-forms が Canvas 面だけでした）:
  - 通常 field 10 本: Hello World、uivolve-forms（DOM は `personName`、Canvas は
    `memo` の textarea）、orders、**components のウィンドウ内**（`openEditor` を実クリックで
    開いてから `draftName`）、**uivolve-gallery の「編集」タブ**（タブを実クリックしてから
    `codeSource` の codeeditor）。focus → オーバーレイが開く → 入力 → `Enter` → 再 focus →
    `Escape`。各段で `revision`・束縛された state・入力欄のサイズを記録します
  - Grid 2 本（grid-lab を DOM / Canvas 両面）編集開始 → 入力 → `Enter` 確定 → 再編集 →
    `Escape` 取消 → **Rhai 拒否**（数量 600 は `gridChanged` が 500 超で `throw`）。
    拒否では行が変わらず、編集が閉じず、下書き（`cellEdit.value`）が残り、サイズが 12px の
    ままで、エラーがホストへ報告されることを確かめます
  - **報告されたエラーは assert 対象**（F2）。通常 field・変換プローブは最後の段で
    `errors` が空であること、Grid は**拒否の前が空**・拒否でちょうど 1 件増える
    （内容に `500` を含む）・最後の `Escape` で増えないこと。`errors` は累積するので
    「拒否の前が空」は拒否より前の全段をまとめて押さえます
- 変換プローブ（合成 composition）: 変換中に `render()` / テーマ変更 / ホストの幅変更を
  起こしても、**同じ入力要素**（要素の同一性で比較）・`activeElement`・selection・未確定値が
  保持され、未確定値が state に入らないこと。`compositionend` で初めて state に入ること
- 証跡: `editing.json` と `editing-<ケース名>.png` 16 枚

### 既存の挙動として記録すること（変更しない）

| 挙動                                            | 記録                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 通常 field の `Escape` は値を戻さない           | 値は入力のたびに確定済みなので、`Escape` は Canvas のオーバーレイを閉じるだけ。Grid 編集の `Escape` だけが下書きを捨てる |
| textarea の `Enter` は改行                      | オーバーレイは閉じない（`src/canvas-renderer.js` の `widget.kind !== "textarea"` 条件）                                  |
| Grid 列エディタに `textarea` / `listbox` は無い | エンジンが拒否する（`engine/src/grid.rs:61-67`）。両者は通常 field とオーバーレイで検査した                              |

### T4 の時点で未実施・対象外（理由付き）

| 項目                            | 状態・理由                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **実 IME での変換**             | 無人の headless Chromium では OS の IME を操作できない。`editing` suite の変換は `compositionstart` → `input(isComposing)` → `compositionend` を**ページ内で dispatch する合成**で、実 IME の確認として読み替えない。実 IME は手動確認の項目として残す                                                                                                                                              |
| Canvas 面の押下                 | 両面を縦に積む fixture では下の面が折り返しの外に出るため、押下・ダブルクリックは既存の `clickCanvas` と同じく**ページ内で dispatch**する（hit test・listener・dispatch はホスト自身のもの）。**キー入力は実キーボード**（Playwright の `page.keyboard`）                                                                                                                                           |
| datefield 編集での文字入力      | `input[type="date"]` の入力は区切りごとの別扱いで locale に依存するため、datefield はサイズの実測と `Escape` までとし、入力・確定の操作は textfield / numberfield で行う                                                                                                                                                                                                                            |
| dialog prompt の `Enter` 確定   | prompt の `Enter` は `accept` を投げてダイアログを閉じる既存経路。T4 はサイズ（13px）とラベル帯（22px）の実測までとし、ダイアログの状態遷移は既存の `tests/dialogs.test.js` が担保する                                                                                                                                                                                                              |
| 幅・DPR・テーマの行列           | `editing` は 1440x1000 / DPR 1 / ライト / ホスト 16px 固定（テーマとホストサイズに対する独立性は T2 の 8 ケースが実測済み）。通常 field の `canvas-editor` 13px は **T8 の編集 journey 2 本が 6 段（light / dark × desktop / 390px × 拡大 100 / 200%）で測ります**。**T8 へ届かなかったのは Grid 編集の 12px オーバーレイだけ**で、これはこの 1 条件の実測です（[下記](#条件を動かして測った範囲)） |
| media / surface / dialog 絵文字 | T5。`editing` でも T5 送りの kind は `roles` と同じ理由で除外する                                                                                                                                                                                                                                                                                                                                   |

### 検査に歯があることの確認

2 系統それぞれを壊して `editing` を実行しました。

| 壊した場所                                                 | 出た不一致                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/runtime.css` の例外ブロックを削除                     | DOM / オーバーレイの 21 件が「13px、expected 12px」。`option` も 13px になるため、`option` のサイズ検査も効いている |
| `src/canvas-renderer.js` の `valueRole` を `"body"` へ固定 | Canvas の Grid 編集描画 11 件が「13px」、`checkbox` は「役割 body。許可: caption=12px」                             |

どちらも確認後に元へ戻しています。

### T4 で足した fixture

| fixture                            | 画面                                  | 採れる役割                                                                     |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| `grid-lab-*`                       | `screens/grid-lab.json`               | Grid 編集の `textfield` / `numberfield` / `combobox`、同じ画面の通常 textfield |
| `edit-datefield` / `edit-checkbox` | `tests/browser/font-parity-edit.json` | Grid 編集の `datefield` / `checkbox`（どの画面にも無い列エディタ）             |
| `forms-overlay-*`（6 件）          | `screens/uivolve-forms.json`          | Canvas オーバーレイの 6 kind、`labelHeight` 0 の box、placeholder、`option`    |
| `text-overlay-monospace`           | `tests/browser/font-parity-text.json` | 等幅のオーバーレイ（family だけ `monospace`、サイズは `body`）                 |
| `dialogs-prompt`                   | `screens/dialogs.yaml`                | dialog prompt（13px・`labelHeight` 22・window の中）                           |

`font-parity-edit.json` ＋ `.rhai` は実 WASM の補助 fixture です。列エディタの 5 kind のうち
`datefield` と `checkbox` はどのアプリ画面にも無いため、**実際に編集状態を描かせてから**
サイズを測ります。

## 文書・図表と dialog / media の文字（T5）

### 決めたこと — 内容矩形を 1 つにする

図表（`figure`）と文書（`document`）の sprites は **DOM と Canvas で同じ 1 本のリスト**
（[`src/surfaces.js`](../src/surfaces.js) の `documentSprites()` と `surface()`）です。
違い得るのは「リストを**どの矩形へ収めるか**」だけでした。

| 面     | 修正前                                             | 修正後                                                  |
| ------ | -------------------------------------------------- | ------------------------------------------------------- |
| DOM    | `<svg width/height: 100%>` ＝ 枠の内側（内容矩形） | 変更なし                                                |
| Canvas | `widget.width × widget.height`（枠を含む全体）     | `contentFit()` が同じ内容矩形（枠の幅ぶん内側）へ収める |

枠の幅も**サイズと同じ単一源**にしました。`src/runtime.css` に
`--ui-surface-border-width: 1px` を置いて `.ui-figure, .ui-document` の `border` から
参照し、Canvas は `resolveFontMetrics(stage).surfaceBorder` で同じ値を解決します
（[`src/font-metrics.js`](../src/font-metrics.js) の `SURFACE_BORDER_PROPERTY`）。

`src/surfaces.js` が持たなくなったのは**枠の幅と役割サイズ**で、px の数値が 1 つも無いわけでは
ありません。文書 sprite の既存の値（表題 `fontSize: 14`、見出し 16 / 本文 12、左余白 `x: 12`）と、
engine の補完値（`spriteFontSize()` の `?? 12`）は**この 1 ファイルにだけ**あり、両面がそこから
読みます（決定 2 の「文書 14/16px と figure の fontSize は既存 sprites を維持」）。sprite の
リストは DOM と Canvas で同じ 1 本なので、数値が 1 か所にある限り両面がずれる余地はありません。

あわせて 4 つの食い違いを閉じました。

| 直した点                          | 修正前                                                  | 修正後                                                                          |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| sprite の字体                     | Canvas だけ `system-ui, sans-serif` 固定                | ステージの解決済み字体。`monospace` 指定だけが例外で、両面とも `monospace`      |
| `fontSize` を持たない text sprite | DOM は属性を出さずホストの継承値、Canvas は 12px        | 両面とも `spriteFontSize()`（WASM の補完値 12）。属性を省かない                 |
| ダイアログの文字アイコン          | `fillText(..., width)` の `maxWidth` で 32px へ**縮小** | `maxWidth` なし。DOM と同じく 30px のまま枠で切る。字体もステージの解決済み字体 |
| media の空／エラー案内            | Canvas は `body` 13px、DOM は `::after` の 12px         | Canvas も `caption` 12px（`[data-media-kind][data-empty]::after` と同じ役割）   |

文書のサイズは変えていません（表題 14 / 見出し 16 / 本文・コード 12）。図表の
`fontSize` は **DSL の指定か WASM の補完値**をそのまま使い、レンダラーが別の値を
入れないことを検査で確かめます。

### `surfaces` suite が確認していること

実 WASM の 9 fixture × **desktop 1440x1000 / narrow 390x844** の 18 ケース、
**sprite の対（DOM 対 Canvas）257 件**・media 枠 46 件（**DOM の枠 30 ＋ Canvas 面の native
overlay 16**。うち案内が出ているのは DOM 24 ＋ overlay 4 の 28 件。Canvas のビットマップへ
描く案内はこの数に入りません）・
ダイアログアイコン 6 件（**文字アイコン 4 ＝「重要なお知らせ」と `🚀` を 2 幅ずつ、
標準 SVG アイコン 2 ＝ `dialogs` の `info` を 2 幅**。30px の検査が効くのは文字の 4 件で、
SVG の 2 件は「文字を描かないこと」の実測です）。

- **内容矩形**: 各 `figure` / `document` の DOM 枠幅が解決値と一致し、SVG の viewport が
  枠の内側（`box - border × 2`）であること
- **sprite の対**: 同じ widget の DOM `<text>` と Canvas の `fillText` を**描画順で 1 対 1**に
  並べ（`fill="none"` の sprite は両面とも描かないので順序から外す）、文字・宣言サイズ・
  **倍率**・実効サイズ・widget 枠内の位置・太さ・寄せ（`text-anchor` ↔ `textAlign`）・字体を照合。
  倍率は**実際の CTM と実際の Canvas transform**から採り、計算し直しません
- **サイズの根拠**: 図表は Scene の sprite が持つ `fontSize`、文書は Scene の行が持つ
  `heading` / `code` から**期待値を独立に導出**して照合します（折り返しの規則は内容一致で
  たどるので、ここで作り直していません）
- **media**: 空／エラーの案内が DOM の `::after`・Canvas のビットマップ・Canvas 面の
  native overlay（video / iframe）すべてで 12px であること。`src` があるのに文字を描いて
  いないこと。**案内が出ていること自体も assert します**（F2）。Scene が「`src` 無し、
  または読込エラー」と言っている枠では DOM の `::after` に文言があり、逆に `src` がある
  枠では出ていないこと。F2 以前はサイズの検査が `shown` を前提条件にしていたので、案内が
  出なくなっても何も測らないまま成功していました（`content` を消すと `surfaces` が非 0 に
  なることを確かめています）。モーダルの裏で畳まれた Canvas overlay は `hidden` なので
  この assert の対象外です
- **ダイアログの文字アイコン**: DOM・Canvas とも 30px、Canvas の `maxWidth` が無いこと、
  ローカル倍率が 1 であること、字体・寄せ・文字が一致すること、1 行に収まる場合は
  **送り幅が両面で一致**すること。標準アイコン（SVG path）は文字を描かないこと
- **文字の条件**（実際の描画から数え、0 件なら失敗）: 日本語・英数字・絵文字・空文字・
  長文・等幅・14/16/12px・中央寄せ・右寄せ・内容矩形をはみ出す行。複数行の図表が 1 件以上
- **倍率が 2 種類以上**あること（幅による縮尺が効いていない状態を見逃さない）
- 証跡: `surfaces.json` と `surfaces-<ケース名>-<desktop|narrow>.png` 18 枚

### 既存の表現差として記録すること（変更しない）

| 差                       | 内容                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| media 案内の**文言**     | Canvas はビットマップへ widget の題名、DOM は `::after` の固定文「メディアを読み込めません」。今回揃えたのはサイズだけ                                        |
| 文字アイコンの**行分割** | `.ui-dialog-icon` は `inline-flex` ＋ `overflow: hidden` なので、枠に収まらない文字列は DOM では匿名 flex item として折り返され、Canvas は 1 行のまま横に切る |
| 壊れた画像の DOM 側      | DOM は `<img>` の代替表示（alt）と `::after` の案内が重なる。Canvas は image の native 要素を持たないので案内だけ                                             |

### T5 の時点で未実施・対象外（理由付き）

| 項目                       | 状態・理由                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iframe の中身              | 別文書（`sandbox` 済み）で runtime の CSS もフォント解決も届かない。枠と空／エラー案内だけを対象にする                                                                                                                                                  |
| 画像の中の文字             | ビットマップの一部で `font-size` を持たない。両面とも同じ画像を同じ内容矩形へ収める                                                                                                                                                                     |
| 標準ダイアログアイコン     | 文字ではなく path（`src/dialog-icons.js` の 24 単位 viewBox）。文字サイズを持たないので、文字アイコンだけを 30px の対象にする                                                                                                                           |
| DPR・テーマ・100/200% 拡大 | **未実施**。`surfaces` は DPR 1 / ライト / ホスト 16px の 2 幅のみ。`matrix` は figure / document / media / dialog-icon を扱わない（surfaces の担当 kind として除外する）ので、T8 へ送ったつもりでも届いていません（[下記](#条件を動かして測った範囲)） |
| フォント完了時の再描画     | T6。`surfaces` は `settle()` 後（`document.fonts.ready` 済み）の 1 フレームを測る                                                                                                                                                                       |

### 検査に歯があることの確認

4 か所それぞれを修正前へ戻して `surfaces` を実行しました。

| 戻した場所                               | 出た不一致                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `contentFit()` の枠幅を 0（widget 全体） | **744 件**。倍率 0.9923 対 1、実効 13.89px 対 14px、位置 (14.46,18.86) 対 (12.00,18.00) |
| sprite の字体を `system-ui, sans-serif`  | 全 sprite が「Canvas の font ... がステージの字体ではない」                             |
| 文字アイコンの `maxWidth` を復活         | 「Canvas の文字アイコンに maxWidth 32」                                                 |
| media 案内の役割を既定（`body`）へ       | image / video / iframe の「Canvas 案内が 13px」                                         |

いずれも確認後に元へ戻しています。

### T5 で足した fixture

[`tests/browser/font-parity-surface.json`](../tests/browser/font-parity-surface.json) ＋
[`.rhai`](../tests/browser/font-parity-surface.rhai) は実 WASM の補助 fixture です。
アプリ画面には次の条件が揃って出ないため、**実際に描かせてから**測ります。

| 条件                                       | 置いたもの                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| 空の sprite・`fillStyle: "none"` の行      | `draw` の text sprite（描かない行は両面とも描画 0 件）                 |
| `fontSize` を省略した text sprite          | 同上（WASM が 12 で補完することの確認）                                |
| 中央寄せ・右寄せ・はみ出す長文・絵文字     | 同上                                                                   |
| 空の文書                                   | `component`（値が空 → 空行 1 つ）                                      |
| 空／エラーの media（image・video・iframe） | `src` 無しの 3 件と、読み込めない `src` の image                       |
| 枠に収まらない文字アイコン                 | `wideTextIcon` ハンドラの `alert`（`icon: #{text: "重要なお知らせ"}`） |

アプリ画面側は `screens/uivolve-gallery.json` の 5 タブ（編集・チャート・グラフ・会話・
メディア）と `screens/dialogs.yaml`（標準 SVG アイコン）で、実データの文書・図表・
正常な media を測っています。

## フォント完了と DPR 変更の再描画・解放（T6）

### 決めたこと — 2 つの購読と、毎フレームの bitmap 同期

DOM はフォントが届けば自分で組み直し、DPR が変われば自分で描き直します。**Canvas は
どちらもしません**。そこで `UiRuntime` が 2 つだけ購読を足し、どちらも
`scheduleRender()` へ流します（`src/runtime.js` の `watchFonts` / `watchPixelRatio`）。

| 購読                                       | 届く合図                                         | 解除                                       |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| `document.fonts` の `loadingdone`          | 使っている字体の読み込みが終わった               | `lifecycle` の `AbortSignal`（dispose 時） |
| `document.fonts` の `loadingerror`         | 読み込みに失敗した（fallback のまま描き直す）    | 同上                                       |
| `document.fonts.ready`                     | 購読を張る前から流れていた分の初回完了           | `scheduleRender()` が破棄後は何もしない    |
| `matchMedia("(resolution: Ndppx)")` の変化 | CSS 寸法は変わらずに devicePixelRatio だけ動いた | 同上＋変化のたびに新しい倍率で張り直す     |

- 解像度クエリは**ちょうど 1 つの倍率にしか一致しない**ので、変化のたびに新しい倍率で
  張り直します（張り直す前の購読は毎回外します）。ResizeObserver は CSS 寸法が動かない
  DPR 変更を報告しないため、この経路が必要です。
- `CanvasRenderer.syncSurface()` を新設し、bitmap 寸法・CSS 寸法・`setTransform` を
  `render()` だけでなく **`paint()` の先頭でも**実行します。画像や字体の完了、ドラッグ中の
  描き直しのように Scene を作り直さない一時的な paint でも、そのときの倍率の bitmap へ
  落ちます。倍率は `scale()` ではなく `setTransform()` なので、1 → 2 → 1 で累積しません。
- フォントサイズに DPR は掛けません（決定 6）。倍率が動かすのは bitmap だけです。

### `lifecycle` suite が確認していること

テスト字体は**この環境の実フォントファイル**（既定 `/usr/share/fonts/truetype/freefont/FreeMono.ttf`、
1126964 バイト、sha256 `9691040d4d89266d…`、`FONT_PARITY_TEST_FONT` で変更可）を読み、
fixture サーバーの origin の URL（`/tests/browser/font-parity-probe-<id>.ttf`）で配信します。
**バイト列を保留して遅らせるのは runner の route** で、サーバーにテスト専用の経路は足して
いません。`@font-face` は fixture ページ側で宣言し、ステージの `font-family` を上書きします
（製品コードには検査専用の口を足していません）。等幅の字体を選ぶのは、`iiiii` と `WWWWW` の
送り幅が等しいかどうかで**字体が効いたことを数値だけで判定**するためです。

| ケース          | 何を確かめるか                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `fonts-arrival` | 保留した字体を解放した後、**こちらから何もせずに** Canvas が描き直し、再計測していること                           |
| `fonts-error`   | 壊れたバイト列で face が `error` になっても描き直し、fallback の送り幅と役割サイズが動かないこと                   |
| `fonts-race`    | 字体の到着とテーマ切替・幅変更が競合しても、最後の 1 フレームに全部が載り、編集が生きていること                    |
| `fonts-dispose` | 読み込み中に `dispose()` しても完了で描画が復活せず、**その後に作った runtime は自分の字体完了で描き直す**こと     |
| `pixel-ratio`   | CSS 寸法を 1px も変えずに倍率を 1 → 2 → 1 → 2.5 → 1 と動かし、bitmap・変形・実効サイズ・編集中の節点を確かめること |

F3 が足した 6 ケース（`stage-detached-load` / `stage-detached-live-dom-first` /
`stage-detached-live-canvas-first` / `stage-no-sizes-stylesheet` / `stage-no-sizes-role` /
`stage-hidden`）は次節にまとめています。

役割サイズは全ケースで `ROLE_CONTRACT` の宣言値と照合し、Canvas の描画サイズも
`SIZE_CONTRACT` の 7 役割以外が出たら失敗にします。字体も倍率も**サイズを動かしてよい理由に
はなりません**。

### 実測値（2026-10-06・Chromium 152.0.7977.64）

送り幅。DOM ステージと Canvas ステージで同じ値です。**サンプルごとに役割が違います**
（`FONT_SAMPLES` の `role`、既定は `body`）。

| サンプル         | 役割           | 読み込み前 | 読み込み後 | 期待                                      |
| ---------------- | -------------- | ---------- | ---------- | ----------------------------------------- |
| `iiiii`          | `body` 13px    | 17.87px    | 39.00px    | 動く（probe 字体が覆う）                  |
| `WWWWW`          | `body` 13px    | 57.07px    | 39.00px    | 動く・`iiiii` と一致（等幅になった証拠）  |
| `ABCDEFGHIJ`     | `body` 13px    | 77.56px    | 78.00px    | 動く                                      |
| `日本語テキスト` | `caption` 12px | 84.00px    | 84.00px    | **動かない**（probe 字体に CJK 字体なし） |

- DOM の再レイアウト: `.ui-displayfield > div` のインク幅 63.6px → 70.2px。CJK の `.ui-label`
  は 120.7px のまま（コードポイント単位の fallback が維持されている証拠）。
- Canvas の再計測: 同じ文字列の `measureText` が **4 件**変化（`lifecycle.json` の
  `fonts-arrival.remeasured`）。フレーム内の全描画が `fonts.status === "loaded"` の状態で
  描かれています。F2 より前は 5 件でした。この件数は**前後で同じ文字列だった描画**だけを
  数えます（`find(entry.text === draw.text)`）。F2 が `overflowsBox` を 200 文字へ伸ばしたので、
  その部品の描画は省略後の文字列が前後で変わり（58 文字 → 85 文字。probe 字体が細いため
  同じ枠に多く入る）、同じ文字列として照合できなくなりました。残る 4 件は
  `左寄せ 123`（63.56 → 70.20px）・`中央寄せ 123`（76.56 → 83.20px）・
  `1234567.89`（68.55 → 78.00px）・`WWWWWWWWWWWWWW`（159.80 → 109.20px）です。
- 編集中の節点: 再描画後も `same: true`（同一 DOM ノード）、下書き `下書き`、選択位置 3-3、
  サイズ 13px を保持。`fonts-race`（dark 切替＋幅 760px）でも同じです。
- `dispose()` 後の字体完了で記録された描画は **0 件**。続けて作った runtime は自分の字体完了で
  描き直しました。
- 倍率（CSS 696x180 のまま）:

| devicePixelRatio | bitmap     | Canvas 変形  | 実効フォントサイズ   |
| ---------------- | ---------- | ------------ | -------------------- |
| 1                | 696 x 180  | a=1, d=1     | 変化なし             |
| 2                | 1392 x 360 | a=2, d=2     | 変化なし             |
| 1（戻り）        | 696 x 180  | a=1, d=1     | 最初のフレームと一致 |
| 2.5              | 1740 x 450 | a=2.5, d=2.5 | 変化なし             |
| 1（戻り）        | 696 x 180  | a=1, d=1     | 最初のフレームと一致 |

代表画像: `lifecycle-font-before.png` / `lifecycle-font-after.png`（字体の前後）、
`lifecycle-dpr-1.png` / `-2.png` / `-2_5.png`。目視で、両面が同時に probe 字体へ切り替わり、
日本語と `monospace` 指定の部分は変わらず、新たな欠け・重なり・ずれがないことを確認しました。

### 限界・代用（実ブラウザズームと CDP のイベント配信）

| 項目                           | 状態                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実ブラウザの 100 / 200% ズーム | **未実施**。`lifecycle` は CDP の `Emulation.setDeviceMetricsOverride` で倍率だけを変える。拡大そのものは T8                                                                                                                                                                                                                           |
| 解像度クエリの `change` 配信   | CDP の倍率上書きは `devicePixelRatio` と `MediaQueryList.matches` を更新するが **`change` を配信しない**。そこでまず**ブラウザ自身の再描画を 1.5 秒待ち**、来なかったときだけ購読済みの実 `MediaQueryList` 上でイベントを発火する。どちらで動いたかは倍率ごとに台帳へ残す（`deliveries`。実測は 4 回とも合成）                         |
| 上の代用で何が実物か           | 倍率・bitmap・変形・計測値はすべてブラウザ自身の値。合成しているのは**通知の配達だけ**。購読と張り直しは `tests/runtime.test.js` の単体試験でも確認                                                                                                                                                                                    |
| 倍率上書きを消してしまう操作   | **2 種類ある**（T9 で実測）。`locator.screenshot()` は Playwright が自前の metrics を復元する。**新しい CDP セッションを張ると、別のセッションが入れた上書きが外れる**（どちらも 2 → 1 に戻り `(resolution: 2dppx)` が一致しなくなる）。そのため撮影はこのケースが持っている同じセッションで行う。`captureBeyondViewport` 自体は無関係 |
| 実 IME                         | 未実施（T4 と同じ）。合成 composition と分けて記録                                                                                                                                                                                                                                                                                     |
| 字体の配信元                   | 実フォントファイルを読むため、この環境以外では `FONT_PARITY_TEST_FONT` の指定が要る。見つからない場合は候補を並べて非 0 で終了する                                                                                                                                                                                                     |

### baseline の強制再描画について

T1 の `repaintAfterFonts()`（幅を実際に変えて再描画を起こす）は、**T6 以降は再描画のためには
不要**です。`fonts-arrival` が「解放しただけで描き直す」ことを実測したのが、その根拠です。
それでも残しているのは、(1) `baseline.json` は修正前の基準値で、同じ手順で取り直せる必要が
あること、(2) この手順が「フレームが 1 枚も描かれていない」ことを検出する役割も兼ねていること
の 2 つの理由からです。

### 検査に歯があることの確認

`watchFonts` / `watchPixelRatio` の呼び出しを外して `lifecycle` を実行しました。

| 外したもの   | 出た失敗                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| 2 つの購読   | `fonts-arrival` / `fonts-error` / `fonts-race` / `fonts-dispose` がすべて `repainted: false` |
| 同上         | `pixel-ratio` は `matchMedia((resolution: 1dppx)) は一度も問い合わされていません` で停止     |
| 同上（単体） | `tests/runtime.test.js` が `expected "scheduleRender" to be called 2 times, but got 0 times` |

確認後はすべて元へ戻しています。

## ステージの状態と描画の切り分け（F3・verify round 1）

### 決めたこと — 描けないフレームは飛ばす。操作・effects・他の面は止めない

1 フレームのサイズは**ステージの computed style** から取ります（決定 3）。つまりホストは、
サイズを取れない状態にステージを置けます。verify round 1 のプローブは、その状態で
`CanvasRenderer.paint()` が例外を投げ、`UiRuntime.render()` が `dispatch()` / `compile()` の
途中（state 更新の後、`runEffects` の前）でそれを受けて、**`load()` の reject・`onLoad` と
effects の未実行・他の面の未更新**を起こすことを実測しました（main の Canvas は computed
style に依存しないため起きません）。F3 で直したのは次の 2 か所です。

| 直した場所                                | 変えたこと                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CanvasRenderer.resolveFonts()`（新設）   | **ステージ自身で**状態を分ける。文書に未接続なら黙ってそのフレームを飛ばす。接続済みで解決できないときは `onError` へ通知してから飛ばす。例外は投げない |
| `UiRuntime.render()` の面ごとの try/catch | 描画を**面ごとの境界**にする。`Error` 全般をその面の中で受けて通知し、次の面を描く。state は描画より前に確定しているので、effects と他の面は必ず走る    |

- 分岐は `stage.isConnected` で決めます。**例外のメッセージ文字列では分岐しません**
  （`resolveFontMetrics` のどのメッセージにも依存しない）。
- 宣言の無いサイズで文字は描きません。T2 の「CSS 欠落や不正な解決値を静かに成功扱いしない」は
  通知の側で保ちます（行 3）。
- 解決は `paint()` がビットマップに触る前に行います。これで**Scene を伴わない再描画**
  （画像・字体の完了、倍率変更、ドラッグ）は、描かないときに今表示されているフレームを
  `syncSurface()` の寸法変更で消しません。**`render(scene)` の経路は別**です。`syncSurface()`
  は `paint()` の前に `render()` 自身が呼ぶので（`src/canvas-renderer.js:476`）、Scene の寸法が
  変わるフレームでは解決に失敗しても bitmap は作り直され、前のフレームは消えます
  （ステージを文書から外すと CSS 箱が既定幅 240px になるため、実際に寸法が変わります）。
  消えたまま残らないのは、接続・復旧のあとに `ResizeObserver` が再描画を起こすからです。
- **復帰の仕組みは増やしていません。** 接続・復旧のあとに描き直すのは既存の
  `ResizeObserver`（ステージの CSS 箱が 0 から実寸になるのを報告する）と、ふだんの操作です。

### 実測（`lifecycle` の 6 ケース、Chromium 152.0.7977.64）

| 行  | 条件                                                                      | `load()` / 操作             | `onLoad`・effects      | 他の面                         | Canvas 面                             | `onError`                                                     |
| --- | ------------------------------------------------------------------------- | --------------------------- | ---------------------- | ------------------------------ | ------------------------------------- | ------------------------------------------------------------- |
| 1   | 未接続のまま `load()`（`stage-detached-load`）                            | resolve                     | `onLoad` 1 / effects 1 | DOM 面が描画（部品あり）       | 描画 0 件 → 接続後に 4 件             | 0 件                                                          |
| 1'  | 同上で操作 → 接続                                                         | revision 0 → 1、effects 2   | 同上                   | DOM 面に `Hello World`         | 接続後のフレームに `Hello World`      | 0 件                                                          |
| 1'' | 同上・画像のある画面（surface fixture）を未接続で load                    | resolve                     | effects 3              | DOM 面に media の案内 4 件     | 描画 0 件 → 接続後に 24 件            | 0 件                                                          |
| 2   | 表示中に外して DOM 面を操作（面の順序 2 通り）                            | revision 0 → 1、effects 2   | 実行                   | **両方の順序で** `Hello World` | 描画 0 件 → 戻すと 4 件（最新 state） | 0 件                                                          |
| 3   | ランタイム CSS を文書から外す（`-stylesheet`、1 枚）                      | 成功、revision 1、effects 2 | 実行                   | `Hello World`                  | 描画 0 件 → 戻して操作すると 4 件     | `フォントサイズ meta (--ui-font-size-meta) を…`               |
| 3'  | 役割を px で解決できない値にする（`-role`、`1.1em`）                      | 同上                        | 実行                   | `Hello World`                  | 同上                                  | `フォントサイズ body (--ui-font-size-body) を…`               |
| 4   | `display: none` のステージ（`stage-hidden`）                              | 成功、revision 1、effects 2 | 実行                   | 更新                           | **描画する**（4 件・最新 state）      | 0 件                                                          |
| 5   | 行 1〜3 で Scene を伴わない再描画（focus / blur・フォント完了・倍率変更） | —                           | —                      | —                              | いずれも描画 0 件                     | 行 3 でのみ 4 経路とも 1 件ずつ（役割名と property 名を含む） |

- 行 5 の通知は正規表現 `(<役割名>) \((--ui-font-size-…)\)` で検査します。役割名の一覧は
  `src/font-metrics.js` の `FONT_ROLES` をそのまま使い、台帳にもテストにも写しません。
- 行 3 を直したあとは、**追加の通知なしで**次の操作のフレームが描かれ、ステージから
  サイズが再び解決できることまで確認しています（`healed`）。
- 単体試験（`tests/runtime.test.js`）は「ある面の描画が失敗しても effects と他の面が走る」
  ことを、面の 1 つが必ず投げる状態で `load()` と 2 回の `dispatch()` について確認します
  （revision 2、effects 3 回、無事な面に 3 フレーム、通知 3 件）。

### 限界・代用（F3）

| 項目                                       | 状態                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| focus / blur の配達                        | 未接続・`display: none` のステージは焦点を持てないため、**ブラウザがイベントを配らない**。行 1・2 の 0 件は「paint が呼ばれて描かなかった」ではなく「呼ばれなかった」の確認。行 3（接続済み）では 4 経路すべてが paint に届く |
| フォント完了・倍率変更の配達               | T6 と同じ代用。`document.fonts` の `loadingdone` と解像度クエリの `change` を**購読済みの実オブジェクト上で発火**する（配達だけが合成で、倍率・寸法・計測値はブラウザ自身の値）                                               |
| 画像経路                                   | surface fixture の読み込めない `src` の `error` ハンドラで実測。`video` / `iframe` はこの経路を持たない（`src/surfaces.js` が load / error を張るのは `image` だけ）                                                          |
| ホスト規則による字体の変化                 | F3 の対象外（F4）。ここで測っているのはサイズを解決できるかどうかだけ                                                                                                                                                         |
| ステージを**接続したまま**描けなくする手段 | 実際に試したのは 2 つ（stylesheet を外す・役割の値を px でなくする）。`font-family` を空にする経路は接続済みのステージでは作れなかった（継承値が必ず入る）                                                                    |

### 検査に歯があることの確認（F3）

F3 の製品側の修正を 1 つずつ戻して実行しました（手順は
`.gsd-lite/logs/renderer-font-size-parity/scratch/turn-016-mutate.mjs`。変異はコミットしていません）。

| #   | 戻したもの                                 | 期待             | 実測                                                                                             |
| --- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `paint()` が例外を投げる形へ（境界は残す） | `lifecycle` 非 0 | 非 0・指摘 18 件（未接続・外した状態でも通知が出る、接続後も通知が続く）                         |
| 2   | 面ごとの描画境界を外す（paint は残す）     | 単体試験が非 0   | `tests/runtime.test.js` が FAIL、`lifecycle` は green（paint が投げないため）                    |
| 3   | 両方を戻す（= 差し戻し前の挙動）           | 両方非 0         | 単体試験 FAIL、`lifecycle` 非 0・指摘 27 件（`load()` が rejected、`onLoad` 0 回、effects 0 回） |
| 4   | 変異なし                                   | 全 green         | 最終 gate の実行で確認                                                                           |

## 全共通部品の kind・xtype・状態 coverage（T7）

### 決めたこと — 役割の一覧そのものを engine から導く

T2〜T6 は「この役割はこの px」を実測してきました。T7 が閉じるのはその一段上、**一覧が
揃っているか**です。役割（kind）は人が書くものではなく、engine が画面定義の xtype から
導きます。だから一覧の正しさは kind だけでは示せません。T7 は二層で照合します。

| 層       | 何を示すか                                               | どこで                                                      |
| -------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| kind 層  | 描かれた文字のサイズがその kind の役割どれかに一致する   | `roles` suite（実ブラウザ・実 WASM）                        |
| xtype 層 | kind の一覧そのものが engine の受け付ける全 xtype を覆う | `tests/font-parity-runner.test.js`（実 WASM・ブラウザ不要） |

xtype 層は engine の許可リスト（`engine/src/lib.rs` から読み出す 48 件）を起点にし、各 xtype を
**実 WASM で最小の形に描かせて**、出てきた Scene kind を宣言と**完全一致**で突き合わせます
（`XTYPE_SHAPES`）。1 つの xtype に描画の形が 2 通りある場合は行を分けます（折りたたみの
`panel` / `fieldset`、Grid の簡易と高機能、開いた `menu`、出ていない `toast`）。別名で
展開されるだけの `messagebox` / `splitbutton` / `codeeditor` と、xtype ではなく **レイアウト**から
出る `card`、xtype を通らない **dialog 面**（alert / prompt / icon 無し）も行を持ちます。

これで失敗するのは 3 方向です。(1) shape の無い xtype、(2) どの表も担当しない kind、
(3) どの shape も生まない kind。宣言と実測がずれたら即座に落ちます。

### kind の担当表（53 件・重複なし）

| 担当                       | 件数 | 内容                                                                 |
| -------------------------- | ---- | -------------------------------------------------------------------- |
| `roles` suite              | 37   | `CANVAS_KIND_CONTRACT`。文字を描き、サイズを役割として検査する       |
| `surfaces` suite           | 6    | `figure` / `document` / `dialog-icon` / `image` / `video` / `iframe` |
| 文字を描かない（理由付き） | 10   | `KIND_NO_TEXT`。下の表                                               |

文字を描かない 10 件は、根拠を 2 つに分けて記録します。**「文字を持たない」と「文字を描かない」
は別の主張**だからです。

| 根拠             | kind                                                                                                  | 確かめ方                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `engine-empty`   | `backdrop` / `card` / `grid-head` / `grid-row` / `menuseparator` / `separator` / `tabbar` / `toolbar` | probe が `text` / `value` / `cells` を空だと実測する                                                                            |
| `renderer-skips` | `grid-shell`（一覧の題）/ `menu-surface`（引き金の見出し）                                            | 文字列は持つが DOM は属性に載せて `textContent` を飛ばし、Canvas は枠だけを描く。probe は**逆に文字列が空でないこと**を確かめる |

どちらも実ブラウザ側で裏を取ります。DOM は `observeDom` が拾った文字ノードの kind を照合し、
Canvas はこの 10 件に対応づいた描画が**空文字であること**を要求します（`card` は汎用の label
分岐を通るので `fillText("")` を実際に 1 件出します。実測 3 件）。

### `roles` suite が T7 で確認していること

28 ケース・DOM 1243 件・Canvas 描画 1276 件・**37 kind すべて描画あり**・**48/48 xtype**・
**状態 18 件すべて 1 件以上観測**で green。F1 からは同じ 28 ケースで
**両面を部品単位に突き合わせた 1254 スロット／37 kind**も同時に判定します
（→ [役割単位の突き合わせ（F1）](#役割単位の突き合わせf1verify-round-1)）。
**T3 が送った `fieldset` の穴**（`uivolve-forms` の fieldset は折りたたみでタイトルが
`panel-toggle` へ移るため、箱自身の描画が空文字だった）もここで閉じました。states fixture が
**折りたたまない** fieldset を書くので、箱自身が見出しを描きます。

状態の 18 件は**各状態が少なくとも 1 回は実測されたこと**を示すもので、部品 × 状態の格子では
ありません。たとえば `disabled` は components / grid-lab / forms / states で観測していますが、
「全 37 kind を disabled で測った」という意味ではありません。`stateTableProblems()` が
落とすのも「1 件も観測されなかった状態」です。

xtype が「描かれた」と数える根拠は 2 段で、台帳（`roles-coverage.json`）に**どちらで示したか**を
残します。

| 根拠     | 件数 | 内容                                                                                                                                                                                                      |
| -------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target` | 40   | Scene widget の `target` が画面定義の `itemId` に戻る（1 件単位で確実）                                                                                                                                   |
| `kind`   | 6    | その画面が xtype を書いていて、その kind が Scene にある（`dialogbutton` / `menuseparator` / `metric` / `progressbar` / `tbseparator` / `tbtext`）。節点に `itemId` が無いか normalize が id を書き換える |
| 対象外   | 2    | `tbfill` / `tbspacer` は widget を 1 つも生まないのでブラウザから観測できない。probe が `kinds: []` を実測する                                                                                            |

`kind` 根拠は 1 件単位の対応付けではありません。その代わり、**xtype ごとの厳密な kind の証明は
probe 側**にあります（上の完全一致）。ブラウザ側は「本当に描画まで届いたか」を示す役割です。

normalize が合成する xtype（画面定義に書けないもの）は、**入口の記述から**数えます
（`screenCoverage` が `extras::normalize` のこの一部だけを再現する）。これをやらないと
`tbtext` の kind 根拠が `label` になり、どの画面の label でも「証明」できてしまいます。
`XTYPE_SYNTHESIZED` は **5 件**です。

| 合成される xtype | 入口の記述                           |
| ---------------- | ------------------------------------ |
| `tbtext`         | toolbar の文字列項目（`"帯の文字"`） |
| `tbfill`         | toolbar の `"->"`                    |
| `tbseparator`    | toolbar の `"-"`                     |
| `tbspacer`       | toolbar の空白だけの項目             |
| `dialogbutton`   | messagebox の `buttons`              |

`menuseparator` はこの一覧に入りません。menu の `"-"` 項目からも合成されますが、
**`xtype: menuseparator` と画面定義に直接書けます**（engine の許可リストにあり、
`XTYPE_SHAPES` も `{ xtype: "menuseparator", node: {} }` を直接描かせています）。
`screenCoverage` の walk は `"-"` からの合成も数えますが、「書けないから合成から数える」
5 件とは根拠が違うので分けてあります。

### 状態の一覧（18 件・担当 suite 付き）

| 状態                   | 担当        | 観測した fixture / 証跡                               |
| ---------------------- | ----------- | ----------------------------------------------------- |
| `selected`             | `roles`     | grid-lab ほか（Grid 行・カレンダーの選択日・タブ）    |
| `disabled`             | `roles`     | components / grid-lab / forms / states                |
| `collapsed-panel`      | `roles`     | components ほか（`panel-toggle` が見出しを描く）      |
| `popup-open`           | `roles`     | grid-lab（親コンテキストが `popup` になる）           |
| `toast`                | `roles`     | gallery                                               |
| `dialog-standard-icon` | `roles`     | dialogs（組み込み SVG。文字を描かないことを実測）     |
| `dialog-image-icon`    | `roles`     | dialogs-image-icon（同上）                            |
| `dialog-text-icon`     | `roles`     | dialogs-text-icon（30px の実測は `surfaces`）         |
| `messagebox-answers`   | `roles`     | states-answer（`-answer-N` の target で 1 件単位）    |
| `drag-ghost`           | `roles`     | **kanban-drag-dom のみ**（下記）                      |
| `field-without-label`  | `roles`     | forms / kanban / gallery / states（`labelHeight: 0`） |
| `grid-empty`           | `roles`     | kanban ほか（一致 0 件の案内）                        |
| `calendar-month-shift` | `roles`     | states-month-shift（実クリックで `2026年 11月` へ）   |
| `calendar-long-title`  | `roles`     | states（`9999年 12月`。対応範囲で最長）               |
| `calendar-month-edge`  | `roles`     | states（前後月の muted 日と、戻れない月の `‹` 無効）  |
| `editing-overlay`      | `editing`   | T4: Grid 編集中 11 件を含む 16 ケース                 |
| `media-empty-or-error` | `surfaces`  | T5: media 枠 46 件（案内 28 件）                      |
| `font-loaded`          | `lifecycle` | T6: 字体の遅延配信 4 ケース ＋ 倍率 1 ケース          |

`media-empty-or-error` の 46 件の内訳は、**DOM の枠 30 件 ＋ Canvas 面の native overlay
（video / iframe）16 件**です（Canvas のビットマップへ描く案内はこの数に入りません）。
案内が出ている 28 件は DOM 24 ＋ overlay 4 で、残りは `src` があって案内を出さない枠と、
モーダルの裏で畳まれて `hidden` の overlay です。

担当が `roles` 以外の 3 件を二重に測り直してはいません。測り直すと同じ検査が 2 か所にでき、
片方だけ直されたときに食い違います。`stateTableProblems()` が「担当 suite の無い状態」と
「`roles` 担当なのに判定の無い状態」を落とします。

2 行だけ、担当の中身を補足します。

- **`drag-ghost`**: 状態として記録するのは `kanban-drag-dom` だけです。検出条件が
  `ROLE_CONTRACT` の `ghost-title` / `ghost-detail`（`.kanban-drag-ghost > strong` /
  `> span`）という **DOM 側の selector** だからです。Canvas の ghost
  （`kanban-drag-canvas`）は同じ `roles` suite の中でサイズを検査していますが、
  **`kanban-card` の kind としてではありません**。ghost の 2 件の描画は位置で対応付けられ
  （[F1 の `position` 根拠](#突き合わせの決まり)）、`roles-parity.json` の実測では
  ポインタの下にあった `empty`（12px）と `kanban-lane`（11px）へ帰属して、その kind に
  許可された役割の集合に入ることだけを見ています。DOM に同じ key の節点が無いので
  `canvasOnly`（理由付き）へ回り、部品単位の突き合わせと状態表の件数には入りません。
  ghost が自分の 2 役割で描いていることは、この集合の判定と `roles` の「許可外のサイズは
  非 0」で押さえられますが、**ghost 専用の役割表はありません**（まとめの限界表に記載）。
- **`font-loaded`**: ここで数えている 5 ケースは **T6 の分**で、字体の到着・失敗・競合・
  dispose の 4 件（`fonts-arrival` / `fonts-error` / `fonts-race` / `fonts-dispose`）と、
  倍率だけを動かす 1 件（`pixel-ratio`）です。「遅延配信の前後」なのは前の 4 件です。
  `lifecycle` suite 自体は F3 がステージの状態の 6 ケースを足して**現在 11 ケース**です。

### T7 で足した fixture

| ファイル                                          | 置いた理由                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/browser/font-parity-states.json` / `.rhai` | 折りたたまない fieldset、文字列項目の toolbar、card レイアウト、pagingtoolbar、messagebox、3 つのカレンダー（通常月・`0001-01`・`9999-12`）。どのアプリ画面にもこれらが揃って出ない |

gallery は 6 タブすべてを開くようにしました（タブは開くまで widget を 1 つも生まないので、
エディター・グラフ・会話ログ・メディアの xtype が「書いてあるが描かれていない」ままになる）。
dialogs はアイコンの 3 形（標準 / 画像 / 絵文字）を、**combobox を選んでからボタンを押す**
実操作で開きます（`selectDom`）。

### 既存の表現差として記録すること（変更しない）

| 差                                         | 内容                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 使用不可のカレンダー日の濃さ               | DOM は `:disabled` に `opacity: 0.5`（`src/runtime.css:43-46`）、Canvas は muted 色のみで薄くしない。**色・不透明度の差でサイズの差ではない**（両面とも 11px の label 役割で一致）。この milestone はサイズが対象 |
| `grid-shell` / `menu-surface` の読み上げ名 | 両面とも文字としては描かない（上の `renderer-skips`）                                                                                                                                                             |

### T7 の時点で未実施（理由付き）

| 未実施                               | 理由                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 幅・拡大・配色の行列と代表画像の目視 | T8 の担当。T7 は light / 16px の 1 条件で coverage を閉じる（テーマ・ホストサイズ独立性は T2 の 8 ケースが担保）。**T8 の 7 画面に出る役割だけが行列に乗ります**。37 kind のうち 9 件は `matrix` の画面に出ないので 1 条件のままです: `kanban-card` / `kanban-lane`（9px の `meta` を含む）・`tree-shell` / `tree-node` / `tree-toggle`・`menu-item`・`toast`・`fieldset`・`empty`（[下記](#条件を動かして測った範囲)） |
| 生成配布物からの確認                 | T9 の担当                                                                                                                                                                                                                                                                                                                                                                                                               |

### 検査に歯があることの確認

| 外したもの                              | 出た失敗                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `tbtext` の shape 1 行                  | `xtype tbtext に shape が無い`（vitest・2 件）                                          |
| `KIND_NO_TEXT` から `card`              | `kind card を担当する表が無い`（vitest）                                                |
| `grid-shell` を `engine-empty` 扱い     | `grid-shell は文字を持たないはず: expected 'データ一覧' to be ''`（実装中に実際に出た） |
| states fixture 3 件すべて               | `canvas kind fieldset was never painted` ＋ 状態 3 件が未観測（ブラウザ）               |
| states fixture 2 件（送りのケースだけ） | `state calendar-month-shift ... was never observed`（ブラウザ）                         |

確認後はすべて元へ戻し、`git diff` と `vp test` で復元を確かめています。

## 幅・拡大・配色の行列と代表画像（T8）

### 決めたこと — 条件は「掛け合わせ」ではなく実行できる一覧にする

T2〜T7 は 1 条件（ライト・ホスト 16px・1440x1000・DPR 1）で役割と一覧を閉じました。T8 が
閉じるのは**条件が動いても同じか**です。面・幅・倍率・配色・拡大を軸にし、`matrix` suite が
**7 画面 × 6 条件 × 2 テーマ × 2 面 = 168 ケース**を実測します。

| 軸   | 値                                                                                                                                     | 実装                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 面   | 比較デモ（`/pages/<id>`）／独立 UiRuntime（fixture ページ）                                                                            | デモは実ページを開き、配色は画面の `#theme-select` を実操作で切り替える                |
| 幅   | desktop 1440x1000 ／ narrow 390x844                                                                                                    | `--viewport` の値が desktop の基準。narrow は固定                                      |
| 倍率 | devicePixelRatio 1 ／ 2                                                                                                                | CDP `Emulation.setDeviceMetricsOverride`                                               |
| 配色 | light ／ dark（`/themes/*.json` の実ファイル）                                                                                         | 独立 runtime は `runtime.theme()`、デモは配色セレクタ                                  |
| 拡大 | 100% ／ 200%                                                                                                                           | 下記。**幅を狭めることとは別の条件**として実施する                                     |
| 画面 | hello-world / uivolve-forms / orders / grid-lab / components / uivolve-gallery / dialogs（絵文字アイコンの確認ダイアログを開いた状態） | dialogs は 30px の文字アイコンと長いメッセージが開いている間しか出ないため条件に足した |

### 条件を動かして測った範囲

T2〜T7 の節は「幅・DPR・テーマ・拡大は T8 が見る」と書いていますが、**行列に乗ったのは
この 7 画面に出る役割だけ**です。乗らなかったものは、ライト／ホスト 16px ／ DPR 1 ／
1440x1000 の 1 条件でしか測っていません。範囲は次のとおりです。

| 区分                           | 件数                              | 内容                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 行列に乗った DOM 役割          | 26 / `ROLE_CONTRACT` の 39        | ケースごとの `roles`（`matrix.json` の `cases[].roles`）。6 条件 × 2 テーマ × 2 面で測る                                                                                                                                                                        |
| 行列に乗った Canvas kind       | 28 / `CANVAS_KIND_CONTRACT` の 37 | ケースごとの `canvasKinds`（`matrix.json` の `cases[].canvasKinds`）                                                                                                                                                                                            |
| 行列に乗らなかった DOM 役割    | 13                                | `canvas-editor`、`menu-item`、`tree-shell` / `tree-node` / `tree-toggle`、`toast`、Kanban の 5 役割（**9px の `kanban-card-id` を含む**）、ghost の 2 役割。`canvas-editor` は下の journey で別に測る                                                           |
| 行列に乗らない surface の文字  | —                                 | `figure` / `document` / `media` の案内。`matrix` は `surfaces` 担当の kind を除外するので、2 幅 × DPR 1 × ライトのみ（`surfaces` suite）                                                                                                                        |
| 記録はするが assert は別 suite | —                                 | `dialog-icon` の 30px。`canvasKinds` には入りませんが、描いた**宣言サイズ**としては `declaredSizes` に記録され、dialogs 画面の 24 ケース（独立 12・デモ 12）でデモ／独立の集合比較に入ります。30px であることの assert は `surfaces`                            |
| 行列に乗らない編集オーバーレイ | —                                 | 168 ケース本体は編集オーバーレイを開きません。通常 field の `canvas-editor` 13px は下の journey 2 本（Hello World）が light / dark × desktop / 390px × 拡大 100 / 200% の 6 段で測ります。**1 条件のままなのは Grid 編集の 12px オーバーレイだけ**（`editing`） |

`matrix` が実際に描かせた宣言サイズは 11 / 12 / 13 / 20 / 22 / 30px の 6 種で、**9px は
1 件も出ていません**（Kanban が行列の画面に無いため）。

### ズームの方法と CSS 座標換算

ブラウザのズーム Z は **CSS viewport を 1/Z にし、devicePixelRatio を Z 倍する**変換です。
`matrix` はそれを 1 回の metrics override（CSS 幅・高さと `deviceScaleFactor` を同時指定）で
適用します。CSS px の定義は変わらないので、役割サイズは CSS px のまま比べ、bitmap だけが
DPR×Z 倍になります。

| 条件                   | CSS viewport | devicePixelRatio | canvas CSS 幅 → bitmap 幅（独立 / デモ） | ケース | DOM 役割 | Canvas 描画 |
| ---------------------- | ------------ | ---------------- | ---------------------------------------- | ------ | -------- | ----------- |
| `desktop-dpr1-zoom100` | 1440x1000    | 1                | 696→696 / 599→599                        | 28     | 916      | 1006        |
| `narrow-dpr1-zoom100`  | 390x844      | 1                | 240→240 / 352→352                        | 28     | 916      | 1010        |
| `desktop-dpr2-zoom100` | 1440x1000    | 2                | 696→1392 / 599→1198                      | 28     | 916      | 1006        |
| `narrow-dpr2-zoom100`  | 390x844      | 2                | 240→480 / 352→704                        | 28     | 916      | 1010        |
| `desktop-dpr1-zoom200` | 720x500      | 2                | 336→672 / 682→1364                       | 28     | 916      | 1006        |
| `narrow-dpr1-zoom200`  | 195x422      | 2                | 240→480 / 240→480                        | 28     | 916      | 1014        |

- 拡大 200% は DPR 1 の行だけで実施します。拡大が倍率をすでに 2 倍にするので、DPR 2 と
  掛け合わせた 4 倍は `lifecycle` が持つ bitmap の計算を繰り返すだけになります。
- **195 CSS px の条件では canvas ステージが 240 CSS px で床打ちします**（canvas 要素の既定幅と
  列の padding による下限で、fixture ページでもデモページでも 240px）。ページは横にあふれ、
  レイアウトは 240px のものになります。サイズ一致の判定には影響しません。

### 編集中に条件を変える（2 本 × 6 段）

Hello World の `nameInput` に下書き「下書き」を入れたまま、配色 → 幅 → 拡大を変えます。
各段で**同じ入力要素か（`same`）・未確定の値・選択位置・サイズ・オーバーレイの矩形**を実測します。

| 段               | 条件                | CSS viewport | DPR | bitmap  | Canvas オーバーレイ | same | 値     | 選択 | サイズ |
| ---------------- | ------------------- | ------------ | --- | ------- | ------------------- | ---- | ------ | ---- | ------ |
| `start`          | desktop / light     | 1440x1000    | 1   | 696→696 | 16,40 664x38        | true | 下書き | 3-3  | 13px   |
| `theme-dark`     | desktop / dark      | 1440x1000    | 1   | 696→696 | 16,40 664x38        | true | 下書き | 3-3  | 13px   |
| `resize-narrow`  | narrow / dark       | 390x844      | 1   | 240→240 | 16,40 208x38        | true | 下書き | 3-3  | 13px   |
| `resize-desktop` | desktop / dark      | 1440x1000    | 1   | 696→696 | 16,40 664x38        | true | 下書き | 3-3  | 13px   |
| `zoom-200`       | desktop 200% / dark | 720x500      | 2   | 336→672 | 16,40 304x38        | true | 下書き | 3-3  | 13px   |
| `zoom-100`       | desktop 100% / dark | 1440x1000    | 1   | 696→696 | 16,40 664x38        | true | 下書き | 3-3  | 13px   |

- オーバーレイの矩形は Scene の widget から書かれた値（`left,top width×height`）で、幅だけが
  レイアウトに追従し、サイズ 13px と編集中のノード・選択位置は動きません。DOM 面の 1 本
  （`journey-dom`）も同じ段を通り、オーバーレイが無いこと以外は同じ結果です。
- **100% → 200% → 100% の往復**は、描いた文字・font 文字列・変形・bitmap 幅まで含めて
  拡大前のフレームと完全一致することを比べます（倍率が累積していたら落ちます）。
- **拡大の 2 段（`zoom-200` / `zoom-100`）は、解像度クエリの `change` を合成して配達します。**
  CDP の倍率上書きは `devicePixelRatio` と `MediaQueryList.matches` を更新しますが `change` を
  配信しないためです（T6 の限界表と同じ事情）。journey は `lifecycle` と違い、**ブラウザ自身の
  再描画を待たずに無条件で発火**してから再描画を待ちます。合成しているのは通知の配達だけで、
  倍率・bitmap・変形・計測値はすべてブラウザ自身の値です。`matrix` の 168 ケース本体は条件
  ごとに harness を開き直すので、この合成を使いません（新しい runtime がその時点の倍率を読む）。

### 自動数値結果（2026-10-07 実測・Chromium 152.0.7977.64）

`bun scripts/test-font-parity-browser.mjs --suite matrix`。

| 項目                         | 値                                                               |
| ---------------------------- | ---------------------------------------------------------------- |
| ケース                       | 168（独立 runtime 84・デモ 84）                                  |
| DOM 役割サンプル（可視のみ） | 5496 件・**契約との不一致 0 件**                                 |
| Canvas 描画                  | 6052 件（独立 3024・デモ 3028）・役割外のサイズ 0 件             |
| 実測した役割                 | 26（desktop 26・narrow 26。幅で消える役割は無し）                |
| 入力位置                     | 288 件を Scene の矩形と照合（7/7 画面）。最大はみ出し **2.00px** |
| 枠外へ出た未省略の描画       | **独立 runtime で 0 件**（省略付きは独立 604・デモ 244）         |
| CSS viewport の種類          | 1440 / 720 / 390 / 195                                           |
| bitmap 幅の種類              | 10                                                               |
| 編集中の条件変更             | 2 本 × 6 段、すべて `same: true`                                 |
| 代表画像                     | 64 枚                                                            |
| 証跡                         | `matrix.json`（条件・ケース・画像パス・限界）                    |

- 入力位置の 2.00px は Chromium が `input[type="range"]` に付ける UA 既定の margin です
  （`src/runtime.css:415-419` は padding と border だけを 0 にしています）。判定は
  「中心が部品の矩形の中」＋「辺のはみ出しが 4px 以内」で、位置を失った入力はレイアウトの
  刻み（数十 px）でずれるため区別できます。実測の最大値はケースごとに台帳へ出します。
- デモ面は Scene を公開していないため、描画の部品対応付けと入力位置の照合は**行いません**。
  代わりに、デモが描いた宣言サイズの集合が独立 runtime の集合に含まれること・字体・描画時の
  倍率を照合します（**7 画面すべて**で集合は一致しました）。
- **F2 で assert に変えたもの**（それまでは記録だけで、落ちませんでした）:
  - 枠外へ出た未省略の描画は**独立 runtime の 84 ケースで 0 件**（デモの 84 ケースは対応付ける
    Scene が無いので件数自体を出せません。つまりこの 0 件はデモ面について何も言っていません）。
    Grid の行の文字を枠の 6 倍の幅で描くと `matrix` が非 0 になることを確かめています
  - 入力位置は、**Scene に入力欄を持つ部品がある画面では 1 件以上**照合していること。
    画面ごとの件数と、0 件の画面については「Scene に入力欄を持つ部品が無い」という理由を
    `matrix.json` の `controlCoverage` に出します（7 画面すべてで 1 件以上でした）。
    入力欄の矩形を観測しないようにすると `matrix` が非 0 になります
  - dark のケースは、**記録器を空にしてからテーマを切り替え、Canvas が新しいフレームを
    描いたことを待ってから**測ります。あわせて両ステージの `data-theme-mode` と Scene の
    テーマも照合します（切替が片面にしか届かないまま測る状態を成功にしない）

### 代表画像（修正前 → 修正後）

修正前は **378af26（T1 完了時点）の git worktree** を同じ手順で立てて撮影しました。engine と
`public/` はこのマイルストーンで変わっていないため、生成済みの `engine.wasm` と配信
manifest を複製しています。どちらも `document.fonts.ready` の後、再描画を起こしてからの
フレームです。

- 修正前: `.gsd-lite/logs/renderer-font-size-parity/before-fix/before-<画面>-<幅>-<テーマ>.png`
  （28 枚）と `before.json`
- 修正後: `before-fix/` の**親**（`.gsd-lite/logs/renderer-font-size-parity/`）の
  `matrix-demo-<画面>-<条件>-<テーマ>.png` / `matrix-standalone-...`（`matrix.json` の
  `images` 64 枚）と `matrix.json`。編集 journey の 12 枚
  （`matrix-journey-<面>-<段>.png`）は同じ場所ですが `images` には入らず、
  `journeys[].steps[].image` に出ます

修正前の DOM 実測値（7 画面 × 2 幅 × 2 テーマ = 28 ケース）と、修正後の契約値。
**「画面」は `before.json` にその selector が実際に出た画面**で、選択肢の例ではありません。

| selector                                                                                                                                                                      | 修正前                        | 修正後 | 出た画面                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------ | ------------------------------------- |
| `.ui-button`                                                                                                                                                                  | 16px（ダイアログ内のみ 13px） | 12px   | **7 画面中 6**（grid-lab には出ない） |
| `.ui-menu-trigger`                                                                                                                                                            | 16px                          | 12px   | grid-lab / uivolve-gallery            |
| `.ui-grid-column` / `.ui-grid-cell` / `.ui-grid-select` / `.ui-grid-page`                                                                                                     | 13px                          | 12px   | **grid-lab のみ**                     |
| `.ui-tab`                                                                                                                                                                     | 13px                          | 12px   | grid-lab / uivolve-gallery            |
| `.ui-window-close`                                                                                                                                                            | 13px                          | 20px   | dialog-text-icon                      |
| `.ui-field > input` / `select` / `textarea` / `.box-control` / `.ui-displayfield > div`                                                                                       | 13px                          | 13px   | 変化なし                              |
| `.ui-field > label` 11px・`.ui-label` 11px・`.ui-panel` 12px・`.ui-metric span` 11px / `strong` 22px・`.window-title` 12px・`.ui-dialog-message` 13px・`.ui-dialog-icon` 30px | 同左                          | 同左   | 変化なし                              |

- **orders の Grid は `.ui-grid-*` ではありません。** 旧 Grid なので `.ui-grid-header`
  （`label` 11px）と `.ui-row`（`caption` 12px）で描かれ、この 2 つは `main` と現在で同じ値です
  （`src/runtime.css:698-703` / `714-718`。`main` では直接 11px / 12px）。ただし
  **`before.json` はこの 2 つを 1 件も採っていない**ので、修正前後の実測としてはこの表に
  ありません。両面の一致は `roles`（`grid-header` / `row` kind）と `matrix` が見ています。
- T2 が `roles` suite で採った修正前の値（`button` 16→12、`window-close` 13→20、
  `grid-column` / `grid-cell` / `tab` 13→12、`menu-trigger` 16→12）と、別の経路で撮った
  この実測が一致しています。

### 目視結果（8 組・2026-10-07）

修正前の 28 枚・修正後の 64 枚 ＋ journey の 12 枚のうち、**下の 8 組を人が開いて見ました**。
残りは自動数値だけが根拠です。8 組が名指す修正後の画像のうち 7 枚は `images` の 64 枚に入り、
`matrix-journey-canvas-zoom-200` だけが journey の 12 枚の側です。「面」は撮った対象で、
修正前の 28 枚はすべて比較デモです（`before.json` の note）。

| 画像の組（修正前 → 修正後）                                                                       | 面   | テーマ | 見たこと                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before-grid-lab-desktop-light` → `matrix-demo-grid-lab-desktop-dpr1-zoom100-light`               | デモ | light  | 修正前は DOM のタブが `出荷状況から絞り…` と欠け、ボタン・セルが Canvas より大きい。修正後は `出荷状況から絞り込む` が収まり、両面の文字が同じ大きさに見える                                                                                |
| `before-components-desktop-dark` → `matrix-demo-components-desktop-dpr1-zoom100-dark`             | デモ | dark   | 修正前は DOM の `▾プロフィール` `▾メモ` とボタンが一回り大きい。修正後は一致。暗い配色でも重なり・欠けは増えていない                                                                                                                        |
| `before-uivolve-forms-desktop-light` → `matrix-demo-uivolve-forms-desktop-dpr1-zoom100-light`     | デモ | light  | 修正前は DOM の `▼ 通知と選択`（panel-toggle）と `入力内容を保存`（button）が Canvas より一回り大きい。修正後は両方とも Canvas と同じ大きさ。入力欄・ラベル・listbox・displayfield は前後とも同じで、新たな欠け・重なり・行送りのずれはない |
| `before-orders-narrow-light` → `matrix-demo-orders-narrow-dpr1-zoom100-light`                     | デモ | light  | 修正前は DOM のセルが `SO-0…` `田中デザ…` `受…` と欠け、Canvas は `SO-001` `田中デザイン` `受注`。修正後は両面とも同じ文字・同じ省略位置（`出…`）                                                                                           |
| `before-dialog-text-icon-narrow-light` → `matrix-demo-dialog-text-icon-narrow-dpr1-zoom100-light` | デモ | light  | 修正前は DOM の `✕` が小さい（13px）。修正後は 20px で Canvas と一致。**30px の絵文字アイコンは前後とも同じ大きさで、枠からの欠けも増えていない**                                                                                           |
| `matrix-standalone-hello-world-desktop-dpr1-zoom200-light`（修正後のみ）                          | 独立 | light  | 拡大 200% でも両ステージの文字が同じ大きさで、bitmap が 2 倍になって輪郭が崩れていない                                                                                                                                                      |
| `matrix-journey-canvas-zoom-200`（修正後のみ）                                                    | 独立 | dark   | 拡大したまま編集中の下書き「下書き」とキャレットが残り、オーバーレイが欄の上にぴたりと乗っている。サイズは 13px のまま                                                                                                                      |
| `matrix-demo-uivolve-gallery-narrow-dpr1-zoom100-light`（修正後のみ）                             | デモ | light  | 幅 390px でも両面が同じ大きさ・同じ行位置。タブは両面とも同じ位置で `チャ…` `メデ…` と省略され、カレンダー・ページング・パネル見出しにも新たな欠け・重なりはない                                                                            |

- **22px の metric**（orders / components の `¥514400` など）は前後とも 22px で、幅 390px でも
  欠け・重なりはありません。**狭いセル**は上記 orders の組のとおり、修正後は両面が同じ位置で
  省略します。**長文**（gallery の案内文・dialogs の説明）は前後とも同じ位置で省略されます。
- 既知の表現差（使用不可のカレンダー日が DOM だけ薄い）は目視ではなく **T7 の `roles` suite が
  実測して記録**しています。**色・不透明度の差で、サイズは両面とも 11px の `label` で一致**します
  → [現在の対象外と既存の表現差（一覧）](#現在の対象外と既存の表現差一覧)。

### 限界（それぞれ別に記録する）

| 項目                    | 状態                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実ブラウザのズーム      | **未実施**。headless Chromium ではズーム操作ができず、CDP にページズームの命令もない（`Emulation.setPageScaleFactor` はピンチズームで再レイアウトしない）。手動確認の項目                                                                                                                           |
| CSS の `zoom`           | **不使用**。埋め込み側が書いたときだけ現れるもので、利用者のズームとは別物。要件が求めるのは利用者のズームなので上記の同値変換で実施した                                                                                                                                                            |
| DPR エミュレーション    | 上の metrics override。倍率・bitmap・変形・計測値はブラウザ自身の値                                                                                                                                                                                                                                 |
| 実 IME                  | 未実施（T4 と同じ）。合成 composition と分けて記録                                                                                                                                                                                                                                                  |
| デモ面の Scene          | 公開されていないため、デモでは部品対応付けと入力位置を照合しない（上記）                                                                                                                                                                                                                            |
| 解像度クエリの `change` | 編集 journey の `zoom-200` / `zoom-100` は**合成した `change` を無条件に発火**してから再描画を待つ（CDP の倍率上書きは `change` を配信しない）。合成しているのは通知の配達だけで、倍率・bitmap・変形・計測値はブラウザ自身の値。168 ケース本体は条件ごとに harness を開き直すのでこの合成を使わない |
| 測った役割の範囲        | 行列に乗ったのは 39 役割のうち 26 ／ 37 kind のうち 28（[上記](#条件を動かして測った範囲)）。9px の役割・Grid 編集オーバーレイ・surface の文字は 1 条件のまま（通常 field のオーバーレイは下の journey が 6 段で測る）                                                                              |

### T8 で直した観測コードの穴

| 穴                                        | 直し方                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page.setViewportSize` と倍率上書きの競合 | 幅・高さ・`deviceScaleFactor` を 1 回の metrics override で指定する。2 回に分けると viewport が倍率より 1 段遅れる                                    |
| `locator.screenshot()` が倍率を戻す       | 画像は CDP の `Page.captureScreenshot` で撮る。clip はページ座標（スクロール量を足す）、幅はあふれを含める（狭い条件でステージが 240px に床打ちする） |
| 装飾文字の対応付け                        | combobox の `▾` と checkbox の `✓` は widget の文字列に無いため、位置だけでは隣のボタンへ吸われる。**描く kind を名指し**して候補を絞る               |

### 検査に歯があることの確認

T8 は細工をせずに済みました。実装中に上の 3 つの穴が**実際の失敗として**出たためです。

| 出た失敗                                                                     | 何を守っていたか                          |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| `devicePixelRatio が 1`（63 件）                                             | 条件が実際に適用されたかの検査            |
| `canvas button "▾" は 13px（役割 body）。許可: caption=12px`（720px の条件） | Canvas の役割サイズ検査（対応付けの誤り） |
| `入力欄 volume の位置 … が部品の矩形 … の外にある`                           | 入力位置の検査（UA margin の 2px を実測） |
| `ズームを戻したフレームが拡大前のフレームと一致しない（倍率が累積している）` | 100→200→100% の往復検査                   |

## 生成した配布物からの確認（T9）

### 決めたこと — 測る対象を `src/` から生成物へ替える

ここまでの suite は、開発サーバー越しにこのリポジトリの `src/` を測っています。`distribution`
だけは**利用者が実際に入れるファイル**（`bun run build:runtime` の `runtime-dist/` と
`bun run build:minimal` の `app-dist/`）を測ります。

- 配信元はこの suite が所有する静的サーバー（127.0.0.1・OS 自動割当ポート）です。`bunx vp dev`
  も `src/` も経由しません。
- 観測関数は `tests/browser/font-parity-observe.js` を**何も import しない形**に切り出し、
  配布物の隣へ置いて `import("/observe.js")` で読みます。これにより、ページが触る CSS と
  レンダラーは生成物だけになります（harness は開発サーバー上の fixture 操作を担当したまま）。
- 作業場所は毎回作り直します（`dist-host/`）。古いコピーが測定対象になる余地を無くすためです。
- **この suite は build しません。** 足りないファイルはサーバーとブラウザの起動前に、
  それを作るコマンド名を挙げて非 0 で終了します。最終 gate は `build:runtime` /
  `build:minimal` をこの suite の前に実行するので、ここで build し直すと「build したもの」と
  「測ったもの」のずれを隠してしまいます。

測る 2 面:

| 面        | ページ                                                                                       | 読むもの                                                                                          |
| --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `embed`   | `font-parity-dist-embed.html`（`docs/runtime-distribution.md` の手順どおりの組み込みホスト） | `runtime-dist/index.css` と `index.js` の `createRuntime`。DOM 面と Canvas 面を同じページに並べる |
| `minimal` | `app-dist/index.html`（生成された最小アプリ。1 文字も編集しない）                            | `app-dist/runtime/` の生成物。`?renderer=dom` / `?renderer=canvas` で 2 回読む                    |

`runtime-dist/` と `app-dist/runtime/` が**同じバイト列**であることを sha256 で確かめます
（別物なら片方を測っても他方の証拠になりません）。実測: `index.js` / `index.css` /
`engine.wasm` の 3 件とも両側で一致。**ハッシュの値はここへ写しません** —
`src/` を 1 行変えるたびに `index.js` / `index.css` が変わるので、台帳の数字がすぐ古くなります
（この節を直したコメント修正でも変わりました）。そのときの値は `distribution.json` の
`builds` にあります。

### 自動数値結果（2026-10-07 実測・Chromium 152.0.7977.64）

`bun scripts/test-font-parity-browser.mjs --suite distribution`。
2 面 × ホスト font-size 16px/20px × light/dark の **8 ケース**。

| 項目                      | 値                                                                  |
| ------------------------- | ------------------------------------------------------------------- |
| ケース                    | 8（embed 4・minimal 4）                                             |
| DOM 文字レコード          | 32 件（各ケース 4 件）                                              |
| Canvas 描画               | 32 件（各ケース 4 件）・部品に結び付かない描画 0 件                 |
| 対応付いた比較            | 32 件・**実効サイズ差 0 件**（しきい値 0.01px）                     |
| 役割サイズの契約違反      | **0 件**                                                            |
| 条件で動いた役割          | **0 件**（面ごとに全条件で同じ値）                                  |
| 編集                      | 16 本（各ケース DOM 1・Canvas 1）・すべて **13px**                  |
| ページ/ランタイムのエラー | 0 件                                                                |
| 代表画像                  | 12 枚                                                               |
| 証跡                      | `distribution.json`（限界・ハッシュ・ケース・編集・画像・全比較行） |

ホスト font-size を変えても役割のサイズは動きません:

| 役割          | 宣言 | host 16px | host 20px |
| ------------- | ---- | --------- | --------- |
| `field-label` | 11px | 11px      | 11px      |
| `label`       | 11px | 11px      | 11px      |
| `button`      | 12px | 12px      | 12px      |
| `field-input` | 13px | 13px      | 13px      |

- ステージ要素（`.uivolve-runtime`）自体の computed font-size は 16px / 20px と**ホストに追従
  します**。`src/runtime.css` が `font-size` を宣言していないのは**ステージ自身（`.uivolve-runtime`
  のルール）についてだけ**で、中の部品には `--ui-font-size-*` を参照する `font-size` 宣言が
  並んでいます。動かないのは部品の役割サイズで、これは役割ごとの宣言が効いているためです。
- Canvas の bitmap は embed 712x180、minimal 718x180 で、どちらも CSS 寸法と同じ（DPR 1）。
- 日本語は 4 役割すべてで実測しています（`名前` / `例：太郎` / `挨拶する` /
  `名前を入力して「挨拶する」を押してください。`）。

### 編集（両面 × 8 ケース = 16 本）

ランタイムの API には触れず、**画面に出ている文字だけ**を根拠にします（最小アプリは API を
公開しないため）。面ごとに別の名前を打つので、「挨拶が変わった」ことはその面の操作でしか
起こせません。

1. 入力欄をクリックする（Canvas 面は Scene の矩形から求めた点を実マウスでクリックし、
   `.canvas-editor` が開くのを待つ）
2. `ControlOrMeta+a` → 実キー入力で `太郎`（DOM 面）/ `花子`（Canvas 面）
3. `document.activeElement` の computed font-size を読む → **16 本すべて 13px**
4. 確定（Canvas 面は `Enter` でオーバーレイを閉じてから、描かれたボタンを実マウスで押す）
5. その面に `Hello 太郎` / `Hello 花子` が現れる／描かれるまで待つ

Canvas 面は 16 本中 8 本で `canvas-editor` クラスの入力欄が 1 つ開き、DOM 面はページ本来の
`input` に focus が入りました（オーバーレイ 0 件）。

### 代表画像（12 枚）と目視結果（5 組・7 枚・2026-10-07）

撮った 12 枚は `distribution-embed-<host>-<テーマ>.png`（4 枚）と
`distribution-minimal-<renderer>-<host>-<テーマ>.png`（8 枚）です。**人が開いて見たのは
下の 5 組・のべ 7 枚**で、残りの 5 枚（`embed-16px-dark` / `embed-20px-light` /
`minimal-dom-16px-dark` / `minimal-dom-20px-dark` / `minimal-canvas-20px-dark`）は
自動数値だけが根拠です。

| 見た画像                                                      | 見たこと                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distribution-embed-16px-light`                               | 左の DOM 面と右の Canvas 面で `名前` `例：太郎` `挨拶する` `名前を入力して…` がすべて同じ大きさ・同じ行位置。欠け・重なりなし                                 |
| `distribution-embed-20px-dark`                                | 16px の組と文字の大きさが変わらない。暗い配色でも両面一致で、ボタン内の文字が枠からはみ出していない                                                           |
| `distribution-minimal-dom-20px-light` ／ `-canvas-20px-light` | 生成 HTML 側の見出し `Hello World`・リンク `DOMで表示` `Canvasで表示`・案内文は**ホストの 20px に追従して大きくなる**一方、枠内の部品は 16px の組と同じ大きさ |
| `distribution-minimal-dom-16px-light` ／ `-canvas-16px-light` | 2 枚の枠内が同じ大きさ・同じ折り返し位置。日本語の `例：太郎` も同じ                                                                                          |
| `distribution-minimal-canvas-16px-dark`                       | 枠内だけが暗い配色になり、ホストのページは明るいまま（ホストがページを持つという契約どおり）。文字サイズは light の組と同じ                                   |

### 限界（配布物の面に固有のもの）

| 項目                     | 状態                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最小アプリの 2 面        | `createApplication` は 1 ページにつき 1 レンダラーを描くため、`?renderer=dom` と `?renderer=canvas` の **2 回読み込み**で測る。Canvas 読み込みは Scene を公開しないので、DOM 読み込みで採った部品矩形で描画を対応付け、クリック位置を決める。viewport とホスト font-size は両方で同じ |
| 最小アプリのテーマ       | 生成された `app.json` はテーマを指していない。dark のケースは `app-dist` の**無編集のコピー**に、テーマを指す `app.json` を置いた**別のホスト構成**（`dist-host/minimal-dark/`）。`minimal/` 側はバイト列のまま                                                                       |
| ホストの font-size       | ホストページ側の宣言なので、ページの CSS として与える（embed は `?host=`、生成 HTML は `font-size` を宣言していないので `body` 規則を足す）。生成物は編集しない                                                                                                                       |
| 画面                     | Hello World 1 画面。全役割の網羅は `roles`（T7）、幅・拡大・配色の網羅は `matrix`（T8）が `src/` 側で担当し、ここは**配布経路が同じ値を出すか**だけを見る                                                                                                                             |
| 実ブラウザズーム・実 IME | 未実施（T8 / T4 と同じ）                                                                                                                                                                                                                                                              |

### 検査に歯があることの確認

| 外した／壊したもの                               | 出た失敗                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `runtime-dist/index.css` を退避して suite を起動 | `Suite "distribution" needs the generated artifacts.` と `bun run build:runtime`（起動前） |
| `SUITES` に実行関数の無い行を足す                | `tests/font-parity-runner.test.js` の「全 suite に runner がある」が落ちる                 |

## 役割単位の突き合わせ（F1・verify round 1）

### 直した穴

T7 までの検査は、DOM を `ROLE_CONTRACT` の selector 表と、Canvas を「kind ごとに許される役割の
集合」と、**それぞれ別々に** `SIZE_CONTRACT` の数値へ照合していました。同じ部品の DOM 実効 px と
Canvas 描画 px を直接比べていたのは `distribution` の Hello World だけで、verify round 1 が
`metric` の役割入替と `.ui-empty` の宣言削除を同時に入れた木で `roles`（28 ケース）と
`matrix`（168 ケース）を実行したところ、**両方とも passed** になりました。受け入れ基準 1 の
「役割ごとに一致」を検査が担保していなかったので、F1 で検査側を直しました。製品コード（`src/`）は
**1 行も変えていません**。

### 突き合わせの決まり

部品の **key とスロット**で対応付けます。両面の描いた文字列どうしを比べることはしません。

- **DOM 側**は `observeDom` の文字ノード走査そのもの（selector の手書き表は使わない）。
  走査は再帰で、文字が現れる順に記録します: `::before` → その要素自身の直接の文字 →
  子孫 → `::after`。この順序が「スロット N 同士を比べる」ことを成り立たせています
  （Kanban カードの ID は `::after` で、題と説明より**下**に出るため。親→子の平坦な走査だと
  先頭に来てしまいます）
- **Canvas 側**は記録した描画を描画順に並べ、`attribute()` が Scene 自身の文字列と描画位置で
  部品へ結び付けたもの。結び付けの根拠を描画ごとに持ち回ります（下表）
- 両 renderer は 1 つの部品の文字を同じ視覚順で出すので、スロット N 同士を比べ、
  **スロット数の一致も要求**します（片面だけが文字を出さなくなったら非 0）
- 判定するのは**サイズ**です。太さの差は既存の表現差として一覧に残します（後述）

| 結び付けの根拠 | 突き合わせ | 内容                                                                                                                                                                                                                                                                                              |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`       | する       | 点を含む部品がその文字列を宣言している。通常の経路                                                                                                                                                                                                                                                |
| `truncated`    | する       | 文字列が省略記号に食われて `…` だけになった（狭い toast の閉じるボタン）。照合する文字列が残っていないので、点を含む最小の部品が唯一正直な答え                                                                                                                                                    |
| `decoration`   | しない     | renderer が自分で描く印（combobox の `▾` 4 件、checkbox の `✓` 2 件）。DOM は部品の既定の表示を使い文字ノードを持たない                                                                                                                                                                           |
| `position`     | しない     | 点の下の部品がその文字列を宣言していない。**Kanban の drag ghost だけ**が正当にこうなる（掴んだカードの文字列をポインタ位置へ描き直す。DOM は `.kanban-drag-ghost` を部品の外に作るので同じ key の節点が無い。サイズは `ROLE_CONTRACT` の `ghost-title` / `ghost-detail` が持つ）。それ以外は非 0 |

DOM の文字ノード側で落とすものは、**要素から読める事実**だけで決めます（`displayed`）:
値を文字として見せない控え（`checkbox` / `radio` / `range` / `color` / `file`）の `value`、
値が入っているときの `placeholder`、展開済みリストボックスの選択肢（選択肢そのものが
要素として並ぶので、`select` 側の重複記録を落とす）。閉じた combobox は逆で、選ばれた選択肢を
`select` 自身の箱のサイズで見せるので、そちらを採ります。

1 つの DOM ノードが複数の Canvas 描画になる kind は 3 つだけで、**最後のスロットだけ**が
余りを引き受けます: `textarea`（renderer が自分で行分割する）、`toast` と `dialog-message`
（engine が行を渡し、DOM は 1 ノードに改行で入れる）。他の kind はスロット数が完全一致。

### 計測と描画の一致（部品単位）

記録器は `measureText` 1 件ごとに「そのフレームでそれまでに記録した描画の件数」を押します。
renderer は描く直前に測るので、その番号が計測の属する描画を指します。計測の font と
その描画の font が**部品単位で**一致することを要求します。F1 までは「同じフレームのどこかの
`fillText` に現れること」という枠だけの検査で、フレーム内の他の部品が使う font なら通りました。

### 実測値（2026-10-07・Chromium 152.0.7977.64）

| suite              | ケース               | 突き合わせたスロット | kind | サイズ不一致 |
| ------------------ | -------------------- | -------------------- | ---- | ------------ |
| `roles`            | 28                   | 1254                 | 37   | **0**        |
| `editing`          | 16                   | 638                  | 25   | **0**        |
| `matrix`（独立面） | 84（168 のうち独立） | 2904                 | 28   | **0**        |

`roles` のスロットの内訳 — 役割別: `caption` 859 / `label` 275 / `body` 75 / `metric` 25 /
`meta` 12 / `close` 8。DOM の読み取り口別: 直接の文字 1195 / `value` 38 / `::after` 12 /
`placeholder` 5 / 閉じた combobox の選択肢 4。`matrix` は独立面の全 84 ケースが 1 件以上
（最小 4 件）突き合わせており、1 ケースでも 0 件なら非 0 にします。比較デモの 84 ケースは
Scene を公開しないので対象外です（T8 と同じ理由）。

突き合わせから外した描画は `roles` 28 ケースで **78 件**: `figure` 51・`document` 18・
`dialog-icon` 1（`surfaces` suite の担当）、`decoration` 6、drag ghost 2。
逆向き（DOM が文字を出しているのに Canvas が 1 件も描いていない部品）は **15 件**で、
すべて `surfaces` suite の担当（`figure` 8・`document` 6・`dialog-icon` 1）。
それ以外は両方向とも非 0 です。

### 既存の表現差として記録すること（太さだけ・サイズは一致・変更しない）

一覧に無い太さの差はその場で非 0 になり、**一覧にあるのに 1 件も観測されなかった行も非 0**
（直ったら一覧から外す、という形にしてあります）。`roles` 28 ケースでの実測件数つき。

| 部品               | DOM | Canvas | 件数 | 理由                                                                        |
| ------------------ | --- | ------ | ---- | --------------------------------------------------------------------------- |
| `extra-button`     | 400 | 500    | 467  | DOM の `.ui-extra-button` は太さを宣言せず 400、Canvas は button と同じ 500 |
| `grid-column`      | 500 | 400    | 16   | DOM は見出しとして 500、Canvas は本文と同じ 400                             |
| `kanban-card` の題 | 700 | 600    | 12   | DOM が `<strong>`（既定 700）、Canvas は 600                                |
| `kanban-lane` の題 | 700 | 600    | 9    | 同上                                                                        |
| `tree-node`        | 600 | 400    | 5    | `.ui-tree-shell` の 600 を継承、Canvas は 400                               |
| `tree-toggle`      | 600 | 400    | 2    | 同上。印（`▾`/`▸`）の太さだけの差                                           |

### 検査に歯があることの確認

変異は 1 つずつ一時的に入れ、該当 suite が非 0 になることを確かめてから戻し、
`git status --porcelain -- src/` が空であることを毎回確認しました（変異はコミットしていません）。
手順は `.gsd-lite/logs/renderer-font-size-parity/scratch/turn-014-mutate.mjs`。

| #   | 一時的な変異                                                     | 期待              | 実測                                                                                       |
| --- | ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| 1   | `metric` の見出しと値の役割を入れ替える（`label` ↔ `metric`）    | `roles`+`matrix`  | 両方非 0。`DOM 11px 対 Canvas 22px` と `DOM 22px 対 Canvas 11px` が metric 1 件につき 2 行 |
| 2   | `paintField` の checkbox / radio のキャプションを `label` で描く | `roles`           | 非 0。`checkbox … DOM 13px 対 Canvas 11px`（6 件）                                         |
| 3   | field のラベルを `body`、値を `label` で描く                     | `roles`+`editing` | 両方非 0。`textfield` / `combobox` のスロット 0 と 1 が両方向に出る                        |
| 4   | kanban-card の説明（`label`）と ID（`meta`）の役割を入れ替える   | `roles`           | 非 0。スロット 1 が `11px 対 9px`、スロット 2（`::after`）が `9px 対 11px`                 |
| 5   | `.ui-empty` から `font-size` を削除する                          | `roles`           | 非 0。`DOM 13px 対 Canvas 12px`（3 ケース。DOM はレーンの継承値になる）                    |
| 6   | `.ui-fieldset` の `font-size` を `body` にする                   | `roles`           | 非 0。`fieldset` と、同じ宣言を共有する `panel` が `DOM 13px 対 Canvas 12px`               |
| 7   | `.ui-row span` に `font-size: var(--ui-font-size-body)` を足す   | `roles`           | 非 0。`row` の各セルが `DOM 13px 対 Canvas 12px`                                           |
| 8   | textarea の折返し計測を `label` の font で行う                   | `roles`           | 非 0。`13px monospace で描いたのに 11px monospace で計測している`                          |
| 9   | 変異なし                                                         | 全 suite green    | `roles` / `editing` / `surfaces` / `lifecycle` / `matrix` すべて green・不一致 0 件        |

## 欠け・入力位置・編集操作の穴（F2・verify round 1）

### 直した穴

F1 がサイズの突き合わせを部品単位にしたのに対し、F2 は**台帳が数値で主張しているのに
gate が落とさなかった項目**と、**受け入れ基準 3 の代表画面のうち編集操作を実行していな
かった面**を閉じました。製品コード（`src/`）は 1 行も変えていません。

| 穴                                                                                                   | 直し方                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 幅境界の両側が**フレーム全体の件数**でしか見られていなかった。しかも境界の「後」側が実際には無かった | 同じ幅の 2 部品で部品単位に assert。`overflowsBox` を 200 文字へ伸ばして条件を作り直した（`roles` suite の節） |
| 枠外へ出た未省略の描画が**記録だけ**だった                                                           | 独立 runtime の全ケースで 0 件を assert（`matrix` の自動数値結果の節）                                         |
| 入力位置が照合 0 件でも通った                                                                        | Scene に入力欄を持つ部品がある画面では 1 件以上。画面ごとの件数と 0 件の理由を `controlCoverage` に出す        |
| dark のケースが**古いフレームを測り得た**                                                            | 記録器を空にしてから切り替え、新しいフレームを待つ。両ステージと Scene のテーマも照合                          |
| 編集操作で報告された `errors` を誰も読んでいなかった                                                 | 通常 field と変換プローブは空、Grid は拒否でちょうど 1 件（`editing` suite の節）                              |
| media の案内が**出ていなくても**サイズ検査が成功した                                                 | Scene が空／エラーと言う枠では案内が出ていること、`src` がある枠では出ていないこと（`surfaces` suite の節）    |
| uivolve-forms は Canvas 面しか操作していなかった                                                     | DOM 面を足し、components のウィンドウ内と uivolve-gallery の編集タブを両面で追加（7 本 → 12 本）               |

### 検査に歯があることの確認

F2 が閉じたのは**検査の穴**なので、変異は「その assert が気付くはずの条件を消す」形にして
います（fixture が条件を出さなくなる／観測が読まなくなる／製品が枠外へ描く・実体のない
エラーを通知する）。1 つずつ入れて戻し、毎回 `git diff --stat` が F2 の差分だけに戻ることを
確認しました（変異はコミットしていません）。手順は
`.gsd-lite/logs/renderer-font-size-parity/scratch/turn-015-mutate.mjs`。

| #   | 一時的な変異                                                    | 期待           | 実測                                                                            |
| --- | --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| 1   | 幅境界の「後」の値を枠に収まる長さ（30 文字）へ戻す             | `roles`        | 非 0・3 件。DOM 「送り幅 342.42px / 枠 664px で省略されていない」＋ Canvas 2 件 |
| 2   | Grid の行の文字を枠の 6 倍の幅で描く                            | `matrix`       | 非 0。`row "出荷済" が部品の枠外へ 12.53px 出ている`（narrow の 8 ケース）      |
| 3   | 入力欄の矩形を 1 件も観測しない（`controlBoxes` が空を返す）    | `matrix`       | 非 0。画面ごとの「位置を 1 件も照合していない」＋ 全体の 0 件                   |
| 4   | media の空／エラー案内の `content` を消す                       | `surfaces`     | 非 0。`image / video / iframe` の 4 枠 ×ケースで「案内が出ていない」            |
| 5   | `dispatch` ごとに実体のないエラーを通知する（state は変えない） | `editing`      | 非 0・25 件。操作スクリプト 10 本すべてが `errors: ["probe", …]` を出した       |
| 6   | 変異なし                                                        | 全 suite green | `bun scripts/verify-font-parity.mjs` の 14 手順すべて green（約 69 秒）         |

## ホストのタグ規則からフォーム部品を守る（F4・verify round 1）

### 直した穴

「決めた事項 1」で reset の詳細度を 0,0,0 まで下げたとき、**サイズの修正と引き換えに
main が防いでいた範囲を失っていました**。ホストページが

```css
button,
input,
select,
textarea {
  font: italic 700 17px/2 serif;
}
```

のようにタグだけで書いた規則は 0,0,1 なので、0,0,0 の reset に勝ちます。verify round 1 の
実測では、サイズは部品側の宣言（12 / 13px）で保たれるのに **DOM 面の全フォーム部品が
`italic` / `serif` になり、入力欄と選択欄は太さ 700 になりました**（Canvas はランタイムの
字体・normal・400 のままなので、両面が食い違います）。

直し方は 1 セレクタです。`.uivolve-runtime` を `:where()` の外へ出して **0,1,0** にし、
部品側（同じ 0,1,0）は**この reset より後ろにある**ことで勝たせます。つまり reset は
フォントを宣言するどの規則よりも前に置き、0,1,0 より強くしません。

| 詳細度                                | 例                                           | reset との勝敗                   |
| ------------------------------------- | -------------------------------------------- | -------------------------------- |
| 0,0,1〜0,0,n（タグ・子孫だけ）        | `button, input…` / `html body button…`       | reset が勝つ（守る範囲）         |
| 0,1,0（ランタイムの部品別宣言・同列） | `:where(.uivolve-runtime) .ui-button`        | 後に来る部品側が勝つ（意図通り） |
| 0,1,0 以上のホスト規則・`!important`  | `.my-app button` / `button { … !important }` | ホストが勝つ（対象外）           |

### 実測（`roles` / `editing` の 3 ケース・18 回の読み取り、Chromium 152.0.7977.64）

規則は**ランタイムの stylesheet の前と後の両方**に置いて測ります（順序が結果を決めて
いないことの確認）。挿入位置は `installHostRule` が文書内の index で返し、`before` なら
runtime より小さい index、`after` なら大きい index であることを assert します。

| ケース                 | suite     | 開いた対象（slot）                        | 部品数 |
| ---------------------- | --------- | ----------------------------------------- | ------ |
| forms-overlay          | `roles`   | 通常 field ＋ Canvas オーバーレイ         | 15     |
| grid-lab-dom-editor    | `editing` | 通常 field ＋ DOM の Grid 列エディタ      | 54     |
| grid-lab-canvas-editor | `editing` | 通常 field ＋ Canvas の Grid オーバーレイ | 55     |

3 ケース × 3 規則（shorthand / longhand / 子孫セレクタ 0,0,3）× 2 配置 = **18 回の読み取り、
のべ 744 部品**。各部品について `font: inherit` が設定する 7 プロパティ（font-family /
font-style / font-variant / font-weight / font-stretch / font-size / line-height）を規則なしの
読み取りと突き合わせ、**差は 0 件**でした。規則を外したあとに baseline へ戻ることも
毎ケース確認しています。Canvas 側の解決値（字体・7 役割のサイズ）も規則の前後で不変です。

**対照群**: ランタイムの外に裸の `button` / `input` / `select` / `textarea` を置き、規則が
効いていることを**そこで**確かめます。これが無いと「reset が何にも一致しなくなった」状態が
「部品がフォントを守った」と読めてしまいます。実測では 4 部品すべてが `serif` / `italic` /
`700` / `17px` へ動きました。唯一の例外は **`select` の line-height**で、Blink が UA
stylesheet で固定するためページ側の規則では動きません（`normal` のまま）。これは
`HOST_RULE_IMMOVABLE` に tag ごとの一覧として置き、**過不足ない一致**を assert します
（ブラウザが将来動かせるようになったら、黙って緩むのではなくここで落ちます）。

### 限界（F4）

- **0,1,0 以上のホスト規則は対象外**です。`.my-app button { font: … }`、`#app input { … }`、
  `!important` を含む規則はフォーム部品の font を変えられます。main の reset（0,1,1）でも
  同じで、これは F4 で広げていません。
- **ランタイム内部の class を名指しするホスト規則も対象外**です（`.ui-button { font-size: 20px }`
  のように書けば勝ちます）。内部 class は公開 API ではなく、`docs/runtime-distribution.md`
  にも同じ注意を書いています。
- 守る対象は**フォーム部品**（`button` / `input` / `select` / `textarea`、Grid 編集と Canvas
  オーバーレイを含む）です。F4 が測ったのはこの範囲だけです。
- `div` / `span` で描かれる役割について、タグだけのホスト規則に勝つのは**自分の `font-size`
  宣言を持つ要素だけ**です（部品別の宣言が 0,1,0 で勝つ）。宣言を持たず親から継承している
  子要素には届きます: `.ui-grid-header span` / `.ui-row span` は `font-size` を宣言せず
  （`src/runtime.css:705-712`）親の 11px / 12px を継承するので、ホストの
  `span { font-size: 20px }` のような規則が勝ちます（継承値は要素上のどの宣言にも負ける）。
  **F4 では未実測で、`main` でも同じ状態**です（まとめの限界表に記載）。
- ホストの `* { font: inherit }` のような規則は SVG sprite の `font-size` 属性より強く効き、
  図表・文書の文字サイズを変えます（[まとめの限界表](#限界未実施代用残っているリスク)。
  main から同じ）。
- `select` の line-height はブラウザが固定するため、この 1 プロパティについては
  「ホスト規則から守れている」ことを対照群で示せません（そもそも誰も動かせません）。

### 検査に歯があることの確認（F4）

1 つずつ入れて戻し、毎回 `git diff --stat` が F4 の差分だけに戻ることを確認しました
（変異はコミットしていません）。手順は
`.gsd-lite/logs/renderer-font-size-parity/scratch/turn-017-mutate.mjs`。

| #   | 一時的な変異                                             | 期待                | 実測                                                                                        |
| --- | -------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| 1   | reset を 0,0,0 へ戻す（= 差し戻し前）                    | `roles` / `editing` | 非 0・54 / 108 件。字体・斜体・太さ・line-height が全フォーム部品で動く（サイズは動かない） |
| 2   | reset を main の 0,1,1（`.uivolve-runtime button, …`）へ | `roles` / `editing` | 非 0・1765 / 571 件。button 16px・panel-toggle 16px・grid-cell 13px など部品の宣言が負ける  |
| 3   | ホスト規則を何にも一致しないセレクタにする               | `roles`             | 非 0・8 件。対照の 4 部品が「5 プロパティとも動いていない」として落ちる                     |
| 4   | 変異なし                                                 | `roles` / `editing` | 両方 green（`roles` 28 ケース ＋ 6 読み取り、`editing` 16 ケース ＋ 12 読み取り）           |

## 現在の対象外・表現差・限界（まとめ）

各タスクの節には「その時点で未実施」「T◯ へ送る」という表が残っています。あちらは経過の記録で、
解消済みの行と恒久の行が混ざっています。**現在どうなっているかはこの節だけを読めば分かります。**

### 現在の対象外と既存の表現差（一覧）

| 区分             | 対象                                                                                                  | 現在の扱い                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文字を描かない   | `backdrop` / `card` / `grid-head` / `grid-row` / `menuseparator` / `separator` / `tabbar` / `toolbar` | `engine-empty`。engine が `text` / `value` / `cells` を空にすることを probe が実測する（8 件）                                                                                                                                                                                          |
| 文字を描かない   | `grid-shell`（一覧の題）/ `menu-surface`（引き金の見出し）                                            | `renderer-skips`。文字列は持つがどちらの面も描かない。probe は**逆に文字列が空でないこと**を確かめる（2 件）                                                                                                                                                                            |
| 対象外           | iframe の中身                                                                                         | 別文書（`sandbox` 済み）で runtime の CSS もフォント解決も届かない。枠と空／エラー案内だけが対象                                                                                                                                                                                        |
| 対象外           | 画像（ビットマップ）の中の文字                                                                        | `font-size` を持たない。両面とも同じ画像を同じ内容矩形へ収める                                                                                                                                                                                                                          |
| 対象外           | 標準ダイアログアイコン（`info` などの SVG path）                                                      | 文字ではなく path（`src/dialog-icons.js` の 24 単位 viewBox）。「文字を描かないこと」だけを実測する                                                                                                                                                                                     |
| 対象外           | ホスト外枠（デモのページ装飾・最小アプリの見出しとリンク）                                            | ランタイム外の表示。ホストの `font-size` に追従するのが正しい                                                                                                                                                                                                                           |
| 対象外           | 字体そのもの（グリフ形状）の差                                                                        | 対象はサイズの一致。字体はシステムのフォールバックに依存する                                                                                                                                                                                                                            |
| 対象外           | 詳細度 0,1,0 以上のホスト規則・`!important`・内部 class を名指しする規則                              | ホストが勝つ。`main` の reset（0,1,1）でも同じで、F4 で範囲を広げていない                                                                                                                                                                                                               |
| 表現差（太さ）   | `extra-button` DOM 400 / Canvas 500（467 件）                                                         | `.ui-extra-button` が太さを宣言せず 400、Canvas は button と同じ 500。**サイズは一致**                                                                                                                                                                                                  |
| 表現差（太さ）   | `grid-column` DOM 500 / Canvas 400（16 件）                                                           | DOM は見出しとして 500、Canvas は本文と同じ 400                                                                                                                                                                                                                                         |
| 表現差（太さ）   | `kanban-card` の題 700/600（12 件）・`kanban-lane` の題 700/600（9 件）                               | DOM が `<strong>`（既定 700）、Canvas は 600                                                                                                                                                                                                                                            |
| 表現差（太さ）   | `tree-node` 600/400（5 件）・`tree-toggle` 600/400（2 件）                                            | `.ui-tree-shell` の 600 を継承、Canvas は 400                                                                                                                                                                                                                                           |
| 表現差（不透明） | 使用不可のカレンダー日の濃さ                                                                          | DOM は `:disabled` に `opacity: 0.5`（`src/runtime.css:43-46`）、Canvas は muted 色のみ。**両面とも 11px の `label`**                                                                                                                                                                   |
| 表現差（文言）   | media の空／エラー案内                                                                                | Canvas はビットマップへ widget の題名、DOM は `::after` の固定文「メディアを読み込めません」。**サイズは両面とも `caption` 12px**                                                                                                                                                       |
| 表現差（重なり） | 壊れた画像の DOM 側                                                                                   | DOM は `<img>` の代替表示（alt）と `::after` の案内が重なる。Canvas は image の native 要素を持たないので案内だけ                                                                                                                                                                       |
| 表現差（行分割） | 枠に収まらない文字アイコン                                                                            | `.ui-dialog-icon` は `inline-flex` ＋ `overflow: hidden` なので DOM は折り返し、Canvas は 1 行のまま横に切る。**サイズは両面とも 30px・縮小なし**                                                                                                                                       |
| 表現差（省略）   | 省略の仕組み                                                                                          | DOM は CSS の `text-overflow: ellipsis`（文字列は元のまま）、Canvas は renderer が `…` を文字列へ入れる。文字列どうしは比べない。**部品単位で「省略されたか」を assert するのは幅境界 fixture の 2 部品**（`boundaryFits` / `boundaryOverflows`）で、他の部品は省略の有無を記録するだけ |
| 表現差（ID）     | Kanban drag ghost の ID                                                                               | ghost は両面とも ID を出さない（Canvas は題と説明だけ、DOM の `::after` は `.ui-kanban-card` にしか当たらない）。**両面で同じ**                                                                                                                                                         |

**解消済みのためこの一覧に無いもの**: reset の詳細度（T2 が 0,1,1 → 0,0,0 へ下げ、F4 が
0,1,0 にした）、media 案内の
サイズ（T5 で両面 12px）、`fieldset` の kind coverage（T7）、sprite の字体と `fontSize` 省略時の
値（T5）、文字アイコンの `maxWidth` 縮小（T5）。これらは各タスクの節に経過が残っています。

### 限界（未実施・代用・残っているリスク）

| 項目                                                | 状態                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実 IME での変換                                     | **未実施**。headless では OS の IME を操作できない。`editing` の変換は合成 composition で、実 IME の確認として読み替えない                                                                                                                                                                                                                          |
| 実ブラウザのズーム 100 / 200%                       | **未実施**。CDP にページズームの命令が無い。T8 は CSS viewport ÷ Z・DPR × Z の同値変換で実施し、CSS の `zoom` は使わない（3 者を別記録）                                                                                                                                                                                                            |
| 解像度クエリの `change`                             | **配達だけ合成**。CDP の倍率上書きは配信しないため、`lifecycle` は実再描画を 1.5 秒待ってから、T8 の journey は無条件に発火する                                                                                                                                                                                                                     |
| `--browser-endpoint` の実接続                       | 実装済み。到達できる CDP 接続先がこの環境に無いため未実行                                                                                                                                                                                                                                                                                           |
| 条件を動かした範囲                                  | 39 役割のうち 26・37 kind のうち 28。9px の役割・**Grid 編集**オーバーレイ・figure / document / media の案内は 1 条件のまま。`dialog-icon` の 30px は `matrix` の `declaredSizes` に記録されて集合比較に入るが、30px であることの assert は `surfaces`。通常 field の `canvas-editor` は journey が 6 段で測る（[上記](#条件を動かして測った範囲)） |
| ホストの `* { font: inherit }`                      | SVG sprite の `font-size` 属性より強く効き、図表・文書の文字サイズを変えます。検査は属性値を読むので**検出しません**。`main` から同じ                                                                                                                                                                                                               |
| ホストが `canvas` に寸法を指定                      | `max-width` などで bitmap が縮むと文字が小さく見えます。検査は `canvas.style.width` を読むので**検出しません**。`main` から同じ                                                                                                                                                                                                                     |
| ホストの `span { font-size }`                       | `.ui-grid-header span` / `.ui-row span` は自分の `font-size` を宣言せず親から継承するため、タグだけのホスト規則が勝ちます（`src/runtime.css:705-712`）。F4 はフォーム部品だけを測っており、**ここは未実測**。`main` から同じ                                                                                                                        |
| ブラウザの最小フォントサイズ設定                    | 9px の `meta` 役割（Kanban カードの ID）が利用者の設定で引き上げられる可能性があります。**測っていません**                                                                                                                                                                                                                                          |
| `select` の line-height                             | Blink が UA stylesheet で固定するため、ホスト規則からランタイムが守れていることを対照群で示せません（そもそも誰も動かせません）                                                                                                                                                                                                                     |
| Canvas の drag ghost                                | 観測では位置の下にある kind（実測では `empty` / `kanban-lane`）へ帰属し、その kind に許可された役割の集合で判定します。**ghost 専用の役割表はありません**。DOM に同じ key の節点が無いので部品単位の突き合わせにも入りません（[T7 の `drag-ghost`](#状態の一覧18-件担当-suite-付き)）                                                               |
| デモ面の Scene                                      | 公開されていないため、デモの 84 ケースでは部品単位の突き合わせ・入力位置の照合・枠外の描画の検査を**行いません**（宣言サイズの集合・字体・描画時の倍率だけを照合）                                                                                                                                                                                  |
| Canvas 面の押下                                     | 両面を縦に積む fixture では下の面が折り返しの外に出るため、押下・ダブルクリックは**ページ内で dispatch**します（hit test・listener・dispatch はホスト自身のもの）。キー入力は実キーボード                                                                                                                                                           |
| datefield の文字入力                                | **未実施**。`input[type="date"]` の入力は区切りごとの別扱いで locale に依存するため、サイズの実測と `Escape` までとし、入力・確定は textfield / numberfield で行っています                                                                                                                                                                          |
| 配布物で測った画面                                  | Hello World 1 画面だけ（`distribution`）。全役割・幅・拡大・配色の網羅は `src/` 側の `roles` / `matrix` が担当します                                                                                                                                                                                                                                |
| 18 状態の読み方                                     | 各状態が**少なくとも 1 回**実測されたことを示すもので、部品 × 状態の格子ではありません（[T7](#roles-suite-が-t7-で確認していること)）                                                                                                                                                                                                               |
| 未接続・`display: none` のステージへの focus / blur | ブラウザがイベントを配らないため、F3 の行 1・2 の「描画 0 件」は「paint が呼ばれて描かなかった」ではなく「呼ばれなかった」の確認です（接続済みの行 3 では 4 経路すべてが paint に届きます）                                                                                                                                                         |
| CSS が無いまま `load()` したときの通知の並び        | round 2 のプローブ実測。解決エラーの通知の直後に `compile()` の `onError(null)` が続き、次のフレーム（`ResizeObserver`）で再び通知されます。最後に届くのは通知で、`load()` は resolve・`onLoad` 1 回・effects 1 回です                                                                                                                              |

このうち **verify round 1 が残留リスクとして確認し、このマイルストーンでは修正しないもの**は
4 つです: (1) ホストの `* { font: inherit }`、(2) ホストが `canvas` に寸法を指定する場合、
(3) figure / document の文字を DPR 2・拡大・dark で測っていないこと（「条件を動かした範囲」の
行）、(4) ブラウザの最小フォントサイズ設定。(1)(2) は `main` でも同じ状態です。
round 2 はこれに **ホストの `span { font-size }`** を足しました（同じく `main` から変わらず、
修正しません）。

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
