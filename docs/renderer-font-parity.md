# レンダラー間のフォントサイズ台帳

DOM 版と Canvas 版が同じ役割の文字を同じ実効サイズで表示しているかを、実ブラウザの実測値で
記録する台帳です。CSS の宣言値を読み比べるのではなく、`getComputedStyle` の計算値と Canvas の
実 `fillText` / `measureText` 呼び出しを採取して突き合わせます。

- 検査の入口: [`scripts/test-font-parity-browser.mjs`](../scripts/test-font-parity-browser.mjs)
- 最終判定: [`scripts/verify-font-parity.mjs`](../scripts/verify-font-parity.mjs)
- サイズの単一源: [`src/runtime.css`](../src/runtime.css) の custom properties と
  [`src/font-metrics.js`](../src/font-metrics.js)
- 観測コード: [`tests/browser/font-parity.mjs`](../tests/browser/font-parity.mjs) ・
  [`tests/browser/font-parity-harness.js`](../tests/browser/font-parity-harness.js) ・
  [`tests/browser/font-parity.html`](../tests/browser/font-parity.html)
- 補助 fixture: [`tests/browser/font-parity-text.json`](../tests/browser/font-parity-text.json)（文字の形）・
  [`tests/browser/font-parity-edit.json`](../tests/browser/font-parity-edit.json)（列エディタの kind）・
  [`tests/browser/font-parity-surface.json`](../tests/browser/font-parity-surface.json)（図表・media・文字アイコン）
- runner 自体の検査: [`tests/font-parity-runner.test.js`](../tests/font-parity-runner.test.js)

## 実行方法

```bash
bun run build:wasm
bun scripts/test-font-parity-browser.mjs --suite baseline
bun scripts/test-font-parity-browser.mjs --suite roles
bun scripts/test-font-parity-browser.mjs --suite editing
bun scripts/test-font-parity-browser.mjs --suite surfaces
bun scripts/test-font-parity-browser.mjs --suite lifecycle
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

| suite          | 担当  | 内容                                                            |
| -------------- | ----- | --------------------------------------------------------------- |
| `baseline`     | T1    | 修正前の台帳。差があっても報告のみで成功する                    |
| `roles`        | T2/T3 | 役割別サイズと reset（T2 済）、Canvas 描画・計測の照合（T3 済） |
| `editing`      | T4    | 通常値・編集オーバーレイ・Grid 編集（T4 済）                    |
| `surfaces`     | T5    | document / figure / dialog / media の実効倍率（T5 済）          |
| `lifecycle`    | T6    | フォント完了・DPR 変更時の再描画と解放（T6 済）                 |
| `matrix`       | T8    | 幅・拡大・配色の行列と代表画像                                  |
| `distribution` | T9    | 生成した配布物からの独立 runtime / minimal 確認                 |

未実装の suite は**成功として扱わず、非 0 で終了します**。登録されていない名前も非 0 です。
どちらもサーバーとブラウザを起動する前に判定します。`roles` は T2 と T3 が分担する 1 つの
suite です。T2 が DOM の宣言値・親コンテキスト・サイズ解決器を検査し、T3 が同じ suite へ
Canvas の描画／計測との突き合わせを足しました（実行時のログに検査件数を出します）。

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
  そのまま対応します。**T2 で修正済み**（下記「役割別サイズの単一源と reset の修正」）。
  修正後に同じ条件で `baseline` を採り直すと、両面とも**サイズ差 0 件**になります
  （`.gsd-lite/logs/renderer-font-size-parity/after-t2/baseline.json`。修正前の
  `baseline.json` は同ディレクトリの親に残しています）。
- 画像でも DOM 側のボタン文字が Canvas 側より明らかに大きく、サイズ差は目視でも確認できます。
- Hello World には 11/12/13px の役割しか出ません。9px・20px・22px・30px、document / figure、
  Grid、dialog、media などは後続タスクの suite と補助 fixture で採取します。

### 未取得・対象外（理由付き）

| 項目                                 | 状態・理由                                                        |
| ------------------------------------ | ----------------------------------------------------------------- |
| 比較デモ側の Scene オブジェクト      | デモは Scene を公開しないため、DOM の `.ui-widget` 矩形で代用した |
| 実 IME での変換中入力                | 無人環境では実行できない。T4 が合成 composition と分けて記録した  |
| 実ブラウザのズーム 100/200%          | T8 で実施方法と代用（DPR エミュレーション）を分けて記録する       |
| ホスト外枠（デモのページ装飾）の文字 | ランタイム外の表示であり、本マイルストーンの対象外                |
| 字体そのもの（グリフ形状）の差       | 対象はサイズの一致。字体はシステムのフォールバックに依存する      |
| `--browser-endpoint` の実接続        | 実装済み。到達できる CDP 接続先がないため、この環境では未実行     |

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
/* 修正後（詳細度 0,0,0 — 宣言がある部品は必ず自分の値になる） */
:where(.uivolve-runtime) :where(button, input, select, textarea) {
  font: inherit;
}
```

`font: inherit` 自体は残します（フォーム部品がブラウザ既定のフォントに戻らないため）。
詳細度を 0,0,0 にしたことで、**宣言がある部品は自分の値、宣言が無い部品だけが継承**という
本来の関係になります。ホスト側（ランタイム外）の computed 値は変わりません。

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
| 幅・DPR・実ズームの行列                   | T8。T2 は 1440x1000 / DPR 1 固定                                                                                                                                                                                                              |

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
| `kanban-card`（drag ghost も同じ分岐）                                                                                    | `caption` 12px + `label` 11px + `meta` 9px |
| field 各 kind（`textfield`/`numberfield`/`datefield`/`textarea`/`combobox`/`listbox`/`checkbox`/`radio`）                 | `label` 11px（ラベル） + `body` 13px（値） |

### `roles` suite が Canvas 側で確認していること

実 WASM の 10 画面を **19 ケース**（T2 の 2 画面はホスト 16/20px × ライト/ダークの 4 ケース、
T3 が足した画面は ライト/ホスト 16px の 1 ケース）で実行し、**664 件の Canvas 描画／36 kind**を
突き合わせます。Canvas のサイズは CSS の custom properties から毎フレーム解決されるので、
テーマとホストのサイズを変えても変わりません。その独立性は T2 の 8 ケースが実測しています。

- 描画 1 件ごとに、その kind に許可された役割のどれかの px であること。許可外の px は非 0
- 実効サイズが宣言サイズと一致（`localScale` が 1、ローカル変形で拡大されていない）
- font の family がステージの解決済み family、または `monospace` であること
- **`measureText` に使った font 文字列が、同じフレームの `fillText` にも現れること**
  （計測と描画のサイズ・太さ・字体のずれを検出する）
- 文字の形の網羅: 左／中央／右寄せ、空文字、日本語、長い英数字、省略された描画と
  省略されなかった描画、等幅の折返しが**すべて 1 件以上**実測されていること。
  1 つでも 0 件なら非 0（上の計測／描画一致が何も証明しない状態を成功にしない）
- 必須 kind（29 種）が 1 件以上描かれていること。採れない kind は理由付きで
  `roles.json` の `gaps` に残す
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
| `gallery-chart`                          | 同（チャートタブ）                    | surface sprites（T5 へ送る 39 件の実測）                                                                        |
| `dialogs`                                | `screens/dialogs.yaml`                | `dialog-message`、`window`、`window-close`                                                                      |
| `kanban-drag-dom` / `kanban-drag-canvas` | `screens/kanban.yaml`                 | drag ghost（押下したまま計測し、Escape で取り消す）                                                             |

`text-shapes` は実 WASM の補助 fixture です（[`tests/browser/font-parity-text.json`](../tests/browser/font-parity-text.json)
＋ `.rhai`）。アプリ画面のどれにも寄せ・幅境界・等幅が揃って出ないため、**条件を実際に
描かせてから**計測と描画の一致を主張します。

drag ghost は押しっぱなしでしか存在せず、pointer capture は実入力でしか得られないため、
この 2 ケースだけ Playwright の `page.mouse` で本物の押下・移動を行い、計測のあと
`Escape` で取り消してから離します（fixture の状態を動かさない）。ghost は保持中のカード／
レーンへ対応付けられ、カードと同じ `caption` + `label` を描きます。

### T3 の時点で未実施・対象外（理由付き）

| 項目                                                  | 状態・理由                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `figure` / `document` の sprites（39 件）             | T5。`paintSurface` がローカル変形をかけるため実効倍率の換算が別問題。`roles` suite は kind と理由を記録して除外する                                                                                                                              |
| `dialog-icon` の 30px                                 | T5。`dialogs` 画面の標準アイコンは SVG 画像で描かれ `fillText` を通らない。絵文字・任意文字の 30px は T5 が採る                                                                                                                                  |
| `media` の空／エラー案内                              | T5。Canvas は現在 13px、DOM は 12px（`src/runtime.css:539-548`）。**既知の不一致**で、T5 が DOM 側へ揃える                                                                                                                                       |
| `fieldset`                                            | `uivolve-forms` の fieldset は collapsible でタイトルを `panel-toggle` が描くため、本体の描画は空文字で内容からは対応付けられない。canvas-renderer では panel と同じ分岐（`kind === "panel" \|\| kind === "fieldset"`）。T7 が kind 単位で閉じる |
| `extra-button` の太さ                                 | Canvas は 12px/500、DOM は 12px/400（`.ui-extra-button` は font-weight を宣言しない）。**サイズは一致**。太さの差は本マイルストーンの対象外として台帳に残す（T7 が表現差として扱う）                                                             |
| drag ghost の ID                                      | ghost は Canvas でも DOM でも ID を出しません（Canvas はタイトルと説明だけを描き、DOM の `::after` は `.ui-kanban-card` にしか当たりません）。**両面で同じ**なので既存差として記録のみ                                                           |
| 幅境界の「ちょうど 1px 手前／後」                     | 省略の分岐は描画記録から px 単位では特定できない（`text()` に渡す width は記録に無い）。省略された描画と省略されなかった描画の**両方**を実測して分岐の両側を押さえている                                                                         |
| Grid 編集の 12px と通常 field の 13px                 | **T4 で実施**（下記）。T3 は通常 field の `label` + `body` までを接続した                                                                                                                                                                        |
| 一時状態（selected/disabled/calendar 月端など）の網羅 | T7。T3 は fixture が出す状態で kind を網羅した                                                                                                                                                                                                   |

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
Canvas 描画 665 件（うち Grid 編集中 11 件）**と、**7 本の操作スクリプト**・**2 本の変換プローブ**を
実行します。

- 14 役割の computed font-size（上の表）。**通常 field と Grid 編集を必ず同じ画面・同じ瞬間に
  実測**します。セレクタでの照合に加えて、画面上の全入力欄を列挙して
  「`gridEditor` なら 12px、それ以外は 13px」も直接確かめます（マークアップが変わっても効く形）
- Grid 編集の 5 kind（`textfield` / `numberfield` / `datefield` / `combobox` / `checkbox`）が
  すべて実測されていること。`labelHeight` の 0 / 22 / 24 がすべて現れていること。
  等幅・非等幅の入力欄と placeholder を持つ入力欄がそれぞれ 1 件以上あること。
  **1 つでも欠けたら非 0**（契約に挙げた役割が 1 件も採れない場合も同じ）
- Canvas 側は `roles` と同じ突き合わせを通し、`gridEditor` の描画は `caption` だけを許可します
- 操作スクリプト（実キー入力）:
  - 通常 field（Hello World・uivolve-forms の textarea・orders を DOM / Canvas 両面）
    focus → オーバーレイが開く → 入力 → `Enter` → 再 focus → `Escape`。各段で
    `revision`・束縛された state・入力欄のサイズを記録します
  - Grid（grid-lab を DOM / Canvas 両面）編集開始 → 入力 → `Enter` 確定 → 再編集 →
    `Escape` 取消 → **Rhai 拒否**（数量 600 は `gridChanged` が 500 超で `throw`）。
    拒否では行が変わらず、編集が閉じず、下書き（`cellEdit.value`）が残り、サイズが 12px の
    ままで、エラーがホストへ報告されることを確かめます
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

| 項目                            | 状態・理由                                                                                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **実 IME での変換**             | 無人の headless Chromium では OS の IME を操作できない。`editing` suite の変換は `compositionstart` → `input(isComposing)` → `compositionend` を**ページ内で dispatch する合成**で、実 IME の確認として読み替えない。実 IME は手動確認の項目として残す    |
| Canvas 面の押下                 | 両面を縦に積む fixture では下の面が折り返しの外に出るため、押下・ダブルクリックは既存の `clickCanvas` と同じく**ページ内で dispatch**する（hit test・listener・dispatch はホスト自身のもの）。**キー入力は実キーボード**（Playwright の `page.keyboard`） |
| datefield 編集での文字入力      | `input[type="date"]` の入力は区切りごとの別扱いで locale に依存するため、datefield はサイズの実測と `Escape` までとし、入力・確定の操作は textfield / numberfield で行う                                                                                  |
| dialog prompt の `Enter` 確定   | prompt の `Enter` は `accept` を投げてダイアログを閉じる既存経路。T4 はサイズ（13px）とラベル帯（22px）の実測までとし、ダイアログの状態遷移は既存の `tests/dialogs.test.js` が担保する                                                                    |
| 幅・DPR・テーマの行列           | T8。`editing` は 1440x1000 / DPR 1 / ライト / ホスト 16px 固定（テーマとホストサイズに対する独立性は T2 の 8 ケースが実測済み）                                                                                                                           |
| media / surface / dialog 絵文字 | T5。`editing` でも T5 送りの kind は `roles` と同じ理由で除外する                                                                                                                                                                                         |

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
`src/surfaces.js` は px の数値を 1 つも持ちません。

あわせて 3 つの食い違いを閉じました。

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
**sprite の対（DOM 対 Canvas）257 件**・media 案内 46 件・ダイアログアイコン 6 件。

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
  いないこと
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

| 項目                       | 状態・理由                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| iframe の中身              | 別文書（`sandbox` 済み）で runtime の CSS もフォント解決も届かない。枠と空／エラー案内だけを対象にする                        |
| 画像の中の文字             | ビットマップの一部で `font-size` を持たない。両面とも同じ画像を同じ内容矩形へ収める                                           |
| 標準ダイアログアイコン     | 文字ではなく path（`src/dialog-icons.js` の 24 単位 viewBox）。文字サイズを持たないので、文字アイコンだけを 30px の対象にする |
| DPR・テーマ・100/200% 拡大 | T8。`surfaces` は DPR 1 / ライト / ホスト 16px の 2 幅のみ                                                                    |
| フォント完了時の再描画     | T6。`surfaces` は `settle()` 後（`document.fonts.ready` 済み）の 1 フレームを測る                                             |

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

役割サイズは全ケースで `ROLE_CONTRACT` の宣言値と照合し、Canvas の描画サイズも
`SIZE_CONTRACT` の 7 役割以外が出たら失敗にします。字体も倍率も**サイズを動かしてよい理由に
はなりません**。

### 実測値（2026-10-06・Chromium 152.0.7977.64）

送り幅（13px、`body`）。DOM ステージと Canvas ステージで同じ値です。

| サンプル         | 読み込み前 | 読み込み後 | 期待                                      |
| ---------------- | ---------- | ---------- | ----------------------------------------- |
| `iiiii`          | 17.87px    | 39.00px    | 動く（probe 字体が覆う）                  |
| `WWWWW`          | 57.07px    | 39.00px    | 動く・`iiiii` と一致（等幅になった証拠）  |
| `ABCDEFGHIJ`     | 77.56px    | 78.00px    | 動く                                      |
| `日本語テキスト` | 84.00px    | 84.00px    | **動かない**（probe 字体に CJK 字体なし） |

- DOM の再レイアウト: `.ui-displayfield > div` のインク幅 63.6px → 70.2px。CJK の `.ui-label`
  は 120.7px のまま（コードポイント単位の fallback が維持されている証拠）。
- Canvas の再計測: 同じ文字列の `measureText` が **5 件**変化。フレーム内の全描画が
  `fonts.status === "loaded"` の状態で描かれています。
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

| 項目                           | 状態                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 実ブラウザの 100 / 200% ズーム | **未実施**。`lifecycle` は CDP の `Emulation.setDeviceMetricsOverride` で倍率だけを変える。拡大そのものは T8                                                             |
| 解像度クエリの `change` 配信   | CDP の倍率上書きは `devicePixelRatio` と `MediaQueryList.matches` を更新するが **`change` を配信しない**。そこで購読済みの実 `MediaQueryList` 上でイベントだけを発火する |
| 上の代用で何が実物か           | 倍率・bitmap・変形・計測値はすべてブラウザ自身の値。合成しているのは**通知の配達だけ**。購読と張り直しは `tests/runtime.test.js` の単体試験でも確認                      |
| 実 IME                         | 未実施（T4 と同じ）。合成 composition と分けて記録                                                                                                                       |
| 字体の配信元                   | 実フォントファイルを読むため、この環境以外では `FONT_PARITY_TEST_FONT` の指定が要る。見つからない場合は候補を並べて非 0 で終了する                                       |

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
