# PLAN — renderer-font-size-parity

- 作成: 2026-10-06 / gsd-lite-plan
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md
- 対象: `.`（`gsd-lite-loop.sh --where`: mode=repo、milestone_dir=.gsd-lite）。fix_round=0、subagents=auto。現ターンは計画のみ。

## 検証コマンド

対象リポジトリのルートで、変更に関係する検査を実行する。既存コマンドの根拠は `package.json` の scripts、`docs/testing.md` のコマンド・ブラウザ確認節。

```bash
bun run build:wasm
bunx vp test run tests/fields.test.js tests/grid-navigation.test.js tests/dialogs.test.js tests/gallery.test.js tests/kanban.test.js tests/runtime.test.js
bun scripts/test-font-parity-browser.mjs --suite baseline
bun scripts/test-font-parity-browser.mjs --suite roles
bun scripts/test-font-parity-browser.mjs --suite editing
bun scripts/test-font-parity-browser.mjs --suite surfaces
bun scripts/test-font-parity-browser.mjs --suite lifecycle
bun scripts/test-font-parity-browser.mjs --suite matrix
bun scripts/test-font-parity-browser.mjs --suite distribution
bun run build
bun run build:runtime
bun run build:minimal
bun run check
bun run docs:check
```

- 上記の font-parity スクリプトと suite は **T1で新設する計画名**。baseline は差を採取し、他 suite は担当タスクで検査を追加する。distribution はT9の生成配布物検査。未実装の suite を成功として扱わず非0終了する。
- **PLAN 訂正（turn 4 / T1 実測）**: 上の suite 一覧は「全ターンで green にする一覧」ではない。未実装 suite は担当タスクが実装するまで**非0で終了するのが期待どおり**なので、各実装ターンで green を確認するのは**その時点で実装済みの suite だけ**（T1終了時点では baseline のみ）。全 suite が green になるのはT9の `bun scripts/verify-font-parity.mjs` 一本。根拠: 同じ行の「未実装の suite を成功として扱わず非0終了する」という決定と、T1で実装した `--list` / 非0終了の実測。
- 環境の初期化（毎回）: `bun run build:wasm`。DB初期化は不要。ブラウザ runner は新しい context/runtime を作り、対象 suite のみを実行し、終了時にページ・context・ブラウザ・所有サーバーを閉じる。起動するサーバーのポートは自動割当とし、既存プロセスを終了しない。
- スクリプト実行前は `node --check <対象.mjs>`、撮影前は対象差分の整形→build。実行中の整形でページを再読込させない。
- 最終判定1本（T1で新設）: `bun scripts/verify-font-parity.mjs`。順番は build:wasm → 全Vitest → test:rust → check → docs:check → build → build:runtime → build:minimal → 全font-parity suite（baseline除く）→生成物からの独立runtime/minimal確認。失敗・中断を非0で返す。手動目視の記録はこのコマンドの成功に加えて必要。
- サーバー・Chromiumの実行経路と日本語フォントはT1で固定して `docs/renderer-font-parity.md` に記録する。新規の依存追加なし。runner は `--browser-path` と `--browser-endpoint` のどちらかを選べるようにし、外部ブラウザ接続時は所有したcontextのみ閉じる。無人環境で両方利用不能ならT1を未完了のままBLOCKEDをコミットする。researchで失敗したsnap Chromiumを無条件に再試行しない。
- **T1 実測で確定（turn 4）**: ブラウザは `/usr/bin/chromium-browser`（Chromium 152.0.7977.64、headless）、サーバーは `bunx vp dev` を空きポートで所有起動。環境変数は `FONT_PARITY_BROWSER_PATH` / `FONT_PARITY_BROWSER_ENDPOINT`。日本語は実在の字体で描画されることをインク幅で確認済み（`document.fonts.check` は未割当コードポイントにも true を返すため字体の証拠にしない）。**turn 3 のBLOCKEDは解消**。
- OSの実IMEと実ブラウザズームを実行できない場合は要件どおり限界・代用方式を明記する。ブラウザ数値比較・代表画像自体を省略して合格にしない。

## 追従先チェックリスト

部品追加ではなく既存描画の修正。対象側のAGENTS.md/CLAUDE.mdは `rg --files --hidden -g '*AGENTS.md' -g '*CLAUDE.md' -g '!node_modules' -g '!.git'` で見つからなかった。部品変更規約は `docs/component-development.md:51,60,62,92` を適用する。

| 変更の種類           | 直す場所                                                                                                     | 確かめ方                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 役割別サイズ・reset  | `src/runtime.css`、Canvasの全font指定、編集用要素、台帳                                                      | `rg -n 'font-size                                                                                                                      | font: | ctx.font | measureText | fillText' src` と実ブラウザの役割coverageを照合。デモ外枠の指定は対象外理由を残す |
| 入力サイズ・Grid例外 | `src/dom-renderer.js`、`src/canvas-renderer.js`、必要なら `src/field-control.js`                             | gridEditor有無、labelHeight有無、値/placeholder/select option、再描画時のnode identityを実ブラウザで検証                               |
| SVG/Canvas変換       | `src/surfaces.js`、`src/dialog-icons.js`、surface CSS                                                        | spritesのサイズ・SVG CTM・Canvas transformをCSS pxへ換算しborder内側viewportも照合                                                     |
| font/DPR購読         | `src/runtime.js`、rendererのrender/paint/reset/dispose                                                       | font完了・失敗・dispose後、DPRだけの変化、複数runtimeの独立性を確認                                                                    |
| 配布CSS・JS          | `src/runtime-entry.js`、`scripts/build-runtime.mjs` の既存配布経路                                           | build:runtime/build:minimal後、生成したindex.css/index.jsを使用する面で比較。生成物は手編集しない                                      |
| ブラウザ検査の常設   | 新runner/harness、`docs/testing.md`、`docs/renderer-font-parity.md`、`docs/README.md`                        | `docs/testing.md` の「恒久的なPlaywright実行スクリプト…同梱していない」を現状に合わせて更新。docs:check、全suiteが未実装skipなしで成功 |
| 機能/本数記載        | `README.md`、`docs/testing.md`、`docs/uivolve-gallery.md`、`docs/dialogs.md`、`docs/runtime-distribution.md` | 部品/API本数は今回変えない。`rg -n 'フォント                                                                                           | font  | ブラウザ | [0-9]+(件   | 種類                                                                              | タブ | つ  | 本)' README.md docs` で変更に関連する記載を照合し、更新した旧文言の残存0件を確認。既存の無関係な件数は保持 |

## Tasks

- [x] T1: 実ブラウザ検証の入口と修正前台帳を作る
  - 完了基準: サーバー起動・終了、実Chromium接続、実WASM load、document.fonts.ready待機、日本語表示を確認する。比較デモと独立UiRuntime双方でHello Worldの修正前値と画像を取得し、DOM selector/key/kind/role、computed font-size、実fillText font/transform、CSS幅/bitmap幅、viewport/DPR/theme/font状態をJSONに保存する。描画観測は元のfillText/measureTextを呼び、画像を変えない。フォント名指定と使用可能字体の証拠を分ける。重複文字の照合は位置・key・roleを使い、文字列だけで対応付けない。baselineは差があっても報告できるが未知suite・起動失敗・未取得データは非0。最終runnerの順序・失敗伝播・cleanupを小さなプロセス試験で検証し、今後の未実装suiteをskipしない。実ブラウザ利用不能時はBLOCKED、T1を完了にしない。
  - 対象: 新設 `scripts/test-font-parity-browser.mjs`、`scripts/verify-font-parity.mjs`、`tests/browser/font-parity.html`、`tests/browser/font-parity-harness.js`、`tests/browser/font-parity.mjs`、`tests/font-parity-runner.test.js`、`docs/renderer-font-parity.md`。証跡は `.gsd-lite/logs/renderer-font-size-parity/`。
  - 依存: なし
  - 並列サブ作業: なし（実行環境の確定とharnessの契約を先に揃える）。

- [x] T2: DOMの役割別サイズを保持してresetを修正し共通サイズ源を作る
  - 完了基準: runtime内resetを低詳細度へ変更し、DOMの既存11/12/13/20/22/30px等の宣言が勝つ。新設CSS custom propertiesを既存サイズ宣言から参照し、Canvas用の解決関数はstageのcomputed値を取得する。9pxのIDも含む。文字ごとのgetComputedStyleやJS側の独立したサイズ表は増やさない。roles suiteにroot直下・panel/window内・popup内・Canvas stage直下を追加し、host font-size 16/20px、light/darkでbutton12・close20・editor13等が局所指定どおりであることを実測する。ホスト外枠のcomputed値が変わらないことも確認。CSS欠落や不正な解決値を静かに成功扱いしない。
  - 対象: `src/runtime.css`、新設 `src/font-metrics.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`。
  - 依存: T1
  - 並列サブ作業: なし（CSSとresolverの契約に依存）。
  - **PLAN 訂正（turn 5 / T2 実測）**: 親コンテキスト「panel内」は**DOM上に存在しない**。ホストはpanel/fieldsetの子をステージ（レイヤー）直下に絶対配置し、Sceneに `parentKey` を付けないため、panelの子のCSS親はステージになる。根拠: `src/dom-renderer.js:262`（`parentKey` が無い widget は `layers.get(widget.layer)` 直下）と、`parentKey` を設定するのが grid / kanban / tab / tree / menu だけであること（`engine/src/grid.rs`・`kanban.rs`・`navigation.rs:396,430,451,518`）。実測した必須コンテキストは `root` / `window` / `popup` / `canvas-stage` / `grid-row` / `grid-head` / `tabbar` の7つに置き換え、panel自身のboxは1役割（12px/600）として検査した。後続タスクで「panel内」を要求しない。
  - **PLAN 訂正（turn 5 / T2 実測）**: 既存テスト `tests/font-parity-runner.test.js` の「未実装suiteは非0」検査は `roles` を名指ししていたため、未実装の suite を `SUITES` から動的に選ぶよう変更した（`roles` はT2から実装済みになる）。

- [x] T3: Canvasの基本・追加部品の描画と計測を役割へ接続する
  - 完了基準: text窓口だけでなく全直接ctx.font/measureTextを棚卸しして同じ解決済みサイズを使う。label/empty/metric、button、panel/fieldset/window、旧row/Grid、tab/tree/menu、calendar/paging、toast/dialog-message、kanbanタイトル/件数/説明/ID/drag ghostの全roleがDOM実効pxと一致する。通常field値/labelも接続しT4の編集を準備する。selected/disabledでサイズは変わらない。左/中央/右寄せ、空、日本語、長い英数字、幅境界直前/直後、複数行でmeasureTextと描画fontが一致し、既存省略/折返し/clipを超える新たな欠けがない。roles suiteの当該roleを実WASM fixtureと元処理を通すCanvas観測で検証する。Kanban ghostのID非表示は既存差として台帳に残す。
  - 対象: `src/canvas-renderer.js`、必要なら `src/font-metrics.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`。
  - 依存: T2
  - 並列サブ作業: なし（同じrendererと観測suiteを更新する）。
  - **PLAN 訂正（turn 6 / T3 実測）**: 対象ファイルに2件追加した。(1) 新設 `tests/browser/font-parity-text.json` ＋ `font-parity-text.rhai`（実WASMの補助fixture）。既存のアプリ画面には「左/中央/右寄せ・空・日本語・長い英数字・幅境界の両側・等幅の複数行」が揃って出ないため、条件を実際に描かせないと「measureTextと描画fontが一致」を主張できない。実測で確認: 寄せはCanvas側では `textAlign` ではなくxの事前計算で行われる箇所が多く、既存画面の描画は全件 `textAlign: "left"` だった。(2) `tests/fields.test.js` の既存テスト1件（`text()` のシグネチャ変更に追従）。
  - **PLAN 訂正（turn 6 / T3 実測）**: 完了基準の「全roleがDOM実効pxと一致」のうち **media（image/video/iframe）の空/エラー案内は T5 の担当**とする。Canvas 13px 対 DOM 12px（`src/runtime.css:539-548`）で、PLANのT5完了基準が既に「mediaの空/エラー案内はDOM12pxへ合わせ」と明記しているため。T3では kind と理由を `roles.json` の除外に記録した。`fieldset` も T7 送り（`uivolve-forms` の fieldset は collapsible でタイトルが panel-toggle に移り、本体の描画が空文字のため内容で対応付けられない。canvas-renderer では panel と同一分岐）。

- [x] T4: 通常値と編集オーバーレイ、Grid編集を揃える
  - 完了基準: 通常fieldは13px、Grid cellの表示/DOM編集/Canvas編集は12px。gridEditorを局所識別して通常fieldを変更しない。labelHeight=0/有り、textfield/number/date/textarea/combobox/listbox、placeholder/option/monospace、dialog promptを両面で確認。Hello World・フォーム・orders/grid-labでfocus→編集開始→入力→Enter確定→再編集→Escape取消、GridのRhai拒否と下書き保持を実操作しstate/value/revisionを照合する。composing中のtheme/resize/renderでも同じinput、activeElement、selection、未確定値を保持する。合成composition試験と実IME確認の有無を分ける。フォーム関連・Grid・dialogの既存状態テストも成功。
  - 対象: `src/dom-renderer.js`、`src/canvas-renderer.js`、`src/runtime.css`、必要なら `src/field-control.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、変更契約に応じ `tests/fields.test.js` / `tests/grid-navigation.test.js` / `tests/dialogs.test.js`、`docs/renderer-font-parity.md`。
  - 依存: T3
  - 並列サブ作業: なし（共通編集契約と両面の操作試験を一緒に検証）。
  - **PLAN 訂正（turn 7 / T4 実測）**: 対象ファイルに新設 `tests/browser/font-parity-edit.json` ＋
    `font-parity-edit.rhai`（実WASMの補助fixture）を追加した。Grid の列エディタに使える xtype は
    エンジンが `textfield` / `numberfield` / `datefield` / `combobox` / `checkbox` に限っており
    （`engine/src/grid.rs:61-67`）、このうち `datefield` と `checkbox` の列エディタは**どのアプリ画面にも
    存在しない**ため、実際に編集状態を描かせないと「date を両面で確認」を主張できない。
  - **PLAN 訂正（turn 7 / T4 実測）**: 完了基準の kind 一覧のうち **`textarea` と `listbox` は Grid の
    列エディタになれない**（同上のエンジン制約）。この2つは「通常 field ＋ Canvas 編集オーバーレイ」
    として検査した。あわせて、一覧に無い `checkbox` 列エディタもエンジンが許すため
    `.ui-field.grid-editor .box-control` を 12px 側へ入れて実測した（放置するとセル12px対
    キャプション13pxの不一致が残るため）。
  - **PLAN 訂正（turn 7 / T4 実測）**: 「Enter確定→再編集→Escape取消」のうち**通常 field の
    `Escape` は値を戻さない**（値は入力のたびに確定済みで、`Escape` は Canvas のオーバーレイを
    閉じるだけ）。`textarea` の `Enter` は改行でオーバーレイを閉じない。どちらも既存の挙動として
    台帳に記録し、下書きの破棄は Grid 編集の `Escape` でのみ検査した。
  - **PLAN 訂正（turn 7 / T4 実測）**: `datefield` の編集は**サイズの実測と `Escape` まで**とした。
    `input[type="date"]` の文字入力は区切りごとの別扱いで locale に依存するため、入力・確定・拒否の
    操作は `textfield` / `numberfield` で行う。

- [x] T5: 文書・図表とdialog/media文字の実効倍率を合わせる
  - 完了基準: 共有spritesを維持し、DOM SVGのborder内側viewport/CTMとCanvasのローカルtransformを同じ内容矩形に揃える。documentタイトル14・見出し16・本文/code12とfigureのScene fontSizeをCSS px換算して一致を検証する。WASM補完値を使用しDSLの省略を勝手に別値にしない。字体差が幅/欠けに影響する非code文字はruntime字体へ揃え、monospaceを保つ。dialog絵文字/任意テキスト30pxのmaxWidthによる意図しない縮小を防ぐ。mediaの空/エラー案内はDOM12pxへ合わせ、native overlayも確認する。desktop/390pxで日本語・英数字・絵文字・空・長文・複数行を数値と画像で確認。iframe内部・画像内文字・非文字SVGアイコンは対象外理由を残す。gallery/dialog状態回帰も成功。
  - 対象: `src/surfaces.js`、`src/dialog-icons.js`、`src/canvas-renderer.js`、必要なら `src/runtime.css`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`。
  - 依存: T4
  - 並列サブ作業: なし（同じCanvas font呼出しとsurface倍率を変更する）。
  - **PLAN 訂正（turn 8 / T5 実測）**: 対象ファイルに新設 `tests/browser/font-parity-surface.json`
    ＋ `font-parity-surface.rhai`（実WASMの補助fixture）と `src/font-metrics.js` を追加した。
    前者は、空のsprite・`fillStyle: "none"` の行・`fontSize` を省略した text sprite・空の文書・
    空/エラーの media・枠に収まらない文字アイコンが**どのアプリ画面にも揃って出ない**ため。
    後者は、DOMのSVG viewportが枠の内側（content box）なので Canvas も同じ枠幅で内側へ寄せる
    必要があり、その幅を `src/runtime.css` の `--ui-surface-border-width` に置いて
    `resolveFontMetrics(stage).surfaceBorder` で解決する形にしたため（サイズと同じ単一源）。
  - **PLAN 訂正（turn 8 / T5 実測）**: 完了基準の「字体差が幅/欠けに影響する非code文字は
    runtime字体へ揃え」に加えて、**`fontSize` を持たない text sprite** も揃える対象に入れた。
    修正前は DOM が属性を出さずホストの継承値（16px）、Canvas が 12px で、**宣言の無い
    sprite だけが両面で別サイズ**になっていた。両面とも WASM の補完値（12）を使う。
  - **PLAN 訂正（turn 8 / T5 実測）**: 文字アイコンの**行分割**は対象外とし台帳へ記録した。
    `.ui-dialog-icon` は `inline-flex` ＋ `overflow: hidden` なので、枠に収まらない文字列は
    DOM では匿名 flex item として折り返され、Canvas は 1 行のまま横に切る。完了基準が求める
    のは「30pxの maxWidth による意図しない縮小を防ぐ」ことなので、サイズと非縮小だけを揃え、
    送り幅の一致は DOM が 1 行に収まる場合だけ検査する。

- [x] T6: フォント完了とDPR変更時の再描画・解放を保証する
  - 完了基準: 初期fonts.readyと以後の使用字体load完了で必要な再描画/再計測を行い、失敗時もfallbackで動作する。テストサーバーで読取可能なテスト字体を遅延配信し、読込前後の実計測と描画更新を確認する（T1で字体経路を固定、依存追加なし）。font完了とtheme/renderの競合、load失敗、dispose後の完了では例外・復活描画・購読漏れなし。DPRだけが変わってCSS幅が同じ場合もbitmap/transformを更新し、DPR1→2→1で倍率が累積しない。複数runtimeのdisposeは他方へ影響しない。編集ノード・selection・draftを失わず、runtime状態回帰とlifecycle suiteが成功。
  - 対象: `src/runtime.js`、`src/canvas-renderer.js`、必要なら `src/font-metrics.js`、`tests/runtime.test.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`scripts/test-font-parity-browser.mjs`、`docs/renderer-font-parity.md`。
  - 依存: T5
  - 並列サブ作業: なし（購読・再描画・disposeの実装と試験は依存）。
  - **PLAN 訂正（turn 9 / T6 実測）**: 「テストサーバーで読取可能なテスト字体を遅延配信」は、
    **実行環境の実フォントファイル**（既定 `/usr/share/fonts/truetype/freefont/FreeMono.ttf`、
    `FONT_PARITY_TEST_FONT` で変更可）を読み、fixtureサーバーのoriginのURL
    （`/tests/browser/font-parity-probe-<id>.ttf`）で配信する形にした。**バイト列を保留して
    遅らせるのは runner の route** で、`bunx vp dev` にテスト専用の経路は足していない
    （サーバーは共有の開発サーバーで、遅延配信の口を足すと製品側の配布物に検査専用の経路が
    混ざる）。字体をリポジトリへ同梱しない（再配布しない）ためでもある。依存追加なし。
  - **PLAN 訂正（turn 9 / T6 実測）**: 「DPRだけが変わってCSS幅が同じ場合」の通知は
    `matchMedia("(resolution: Ndppx)")` の `change` で受ける（ResizeObserver は CSS 寸法が
    動かない変更を報告しないため）。ただし **CDP の `Emulation.setDeviceMetricsOverride` は
    `devicePixelRatio` と `MediaQueryList.matches` を更新するが `change` を配信しない**ことを
    実測した。そのため lifecycle suite は、購読済みの**実 `MediaQueryList` 上でイベントだけを
    発火**する（倍率・bitmap・変形・計測値はすべてブラウザ自身の値）。購読と張り直しは
    `tests/runtime.test.js` の単体試験でも確認し、台帳の限界表に代用であることを明記した。
  - **PLAN 訂正（turn 9 / T6 実測）**: 字体の読込前後を比べるケースだけ、画面を
    `screens/hello-world.json` ではなく T3 の `tests/browser/font-parity-text.json` にした。
    probe 字体（等幅）に CJK 字体が無く、**日本語だけの画面では送り幅が 1 件も動かない**ため
    （実測: 日本語テキスト 84.00px → 84.00px、ラテン `iiiii` 17.87px → 39.00px）。
    他の 4 ケースは hello-world のまま。

- [x] T7: 全共通部品の状態別coverageを閉じる
  - 完了基準: DomRendererのcreate/render、CanvasRendererのpaint/paintField、extrasのnormalize/arrange、実生成Sceneからkindとxtypeの二層で全役割を照合し、対応無しを黙ってskipしない。文字なし・対象外・既存の表現差は理由付きで台帳に残す。gallery全タブ、popup/menu、toast、dialog標準/画像/絵文字、media error、drag、selected/disabled、calendar月移動/長い月名/月端、label無しfieldを網羅する。代表画面だけにないroleは実WASM補助fixtureで検証する。台帳の全対象roleが実測結果を持ち、不一致0件。既存描画差を理由にサイズ不一致を免除しない。不足修正は既に確定したサイズ/倍率方針内に限定する。
  - 対象: `tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`、実測で残差がある場合のみ `src/runtime.css` / `src/canvas-renderer.js` / `src/dom-renderer.js` / `src/surfaces.js` / `src/dialog-icons.js`。
  - 依存: T6
  - 並列サブ作業: なし（coverage集計と残差修正を単一台帳へ統合）。
  - **PLAN 訂正（turn 10 / T7 実測）**: 対象ファイルに新設 `tests/browser/font-parity-states.json`
    ＋ `.rhai`（実WASMの補助fixture）と、既存 `tests/font-parity-runner.test.js` を追加した。
    前者は「折りたたまない fieldset・文字列項目の toolbar・card レイアウト・pagingtoolbar・
    messagebox・月端と最長見出しのカレンダー」が**どのアプリ画面にも揃って出ない**ため。
    後者は、完了基準の「kind と xtype の二層」のうち **xtype 層はブラウザを必要としない**ため
    （engine の許可リスト48件を起点に、各 xtype を実WASMで描かせて Scene kind を完全一致で
    突き合わせる）。この二層のデータ表は `tests/browser/font-parity.mjs` に 1 つだけ置き、
    `roles` suite と vitest の双方が同じ表を読む。製品コードへ検査専用の公開APIは足していない。
  - **PLAN 訂正（turn 10 / T7 実測）**: 「extras の normalize」から照合する範囲を、
    **合成される6つの xtype の入口だけ**に限定した（`tbtext`/`tbfill`/`tbseparator`/`tbspacer` は
    toolbar の文字列項目、`dialogbutton` は messagebox の `buttons`、`menuseparator` は menu の
    `"-"`）。normalize 全体を再現すると engine の二重実装になるため。これを入れないと
    `tbtext` の根拠が「どの画面の label でもよい」になり証明が空になることを実測で確認した。
  - **PLAN 訂正（turn 10 / T7 実測）**: 完了基準の「文字なし…は理由付きで台帳に残す」は、
    **根拠を2種類に分けた**。`engine-empty`（8件、engine が text を空にする）と
    `renderer-skips`（2件、`grid-shell`/`menu-surface` は読み上げ名としての文字列を持つが
    どちらの面も描かない）。「文字を持たない」と「文字を描かない」は別の主張で、前者で
    一括りにすると `grid-shell` の実測（`データ一覧`）で落ちる。
  - **PLAN 訂正（turn 10 / T7 実測）**: 残差修正は **0 件**だった（`src/` は 1 行も変えていない）。
    37 kind・48 xtype・18 状態すべてで不一致 0 件。唯一見つかった両面の差は
    **使用不可のカレンダー日の濃さ**（DOM は `:disabled` に `opacity: 0.5`、Canvas は薄くしない）で、
    色・不透明度の差でありサイズは両面とも一致するため、既存の表現差として台帳に記録した。

- [x] T8: 幅・拡大・配色の行列を実行し代表画像を目視する
  - 完了基準: Hello World、uivolve-forms、orders/grid-lab、components、uivolve-galleryについて、比較デモ/独立runtime × desktop/約390px × DPR1/2 × light/darkで全可視roleのCSS pxと入力位置を検証。viewportを狭めるだけでなく100/200%相当の拡大を別条件として実施し、方法とCSS座標換算を記録する。可能なら実ブラウザ100→200→100%も実施し、DPRエミュレーションやCSS拡大と別記録にする。focus/編集中にtheme/resize/拡大を変え、状態同期とnode/selectionを確認。修正前後の代表画像を同じ字体ロード後に撮影し、目視でサイズ差解消と長文/22px metric/30px icon/狭いセルの新たな欠け・重なりなしを記録する。自動数値結果、画像パス、目視結果、実IME/実ズームの限界を台帳に分けて残す。matrix suite成功。
  - 対象: `tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`scripts/test-font-parity-browser.mjs`、`docs/renderer-font-parity.md`。画像・JSONは `.gsd-lite/logs/renderer-font-size-parity/`。
  - 依存: T7
  - 並列サブ作業: なし（同じsuiteと目視記録を更新する）。
  - **PLAN 訂正（turn 11 / T8 実測）**: 画面の一覧を **7 画面**にした。「orders/grid-lab」は
    orders と grid-lab の 2 画面として読み、さらに **dialogs を足した**。完了基準が求める
    「30px icon の新たな欠け・重なりなし」の 30px 文字アイコンと長いダイアログ本文は
    **ダイアログを開いている間しか出ない**ため、5 画面だけでは目視の対象が画面に現れない。
  - **PLAN 訂正（turn 11 / T8 実測）**: 完了基準の「全可視 role の CSS px と入力位置を検証」の
    うち、**入力位置の照合は独立 runtime の 2 面だけ**で行う。比較デモは Scene を公開しないため
    入力欄を突き合わせる矩形が無い。デモ面では代わりに「描いた宣言サイズの集合・字体・描画時の
    倍率が独立 runtime と一致すること」を照合した（6 画面すべてで集合は一致）。
  - **PLAN 訂正（turn 11 / T8 実測）**: 拡大は **CSS viewport ÷ Z と devicePixelRatio × Z の
    同値変換**（1 回の metrics override）で実施した。実ブラウザのズーム操作は headless Chromium
    では実行できず（CDP にページズームの命令が無く `setPageScaleFactor` は再レイアウトしない）、
    CSS の `zoom` は埋め込み側の指定で利用者のズームとは別物なので使わない。3 者は台帳で別記録。
  - **PLAN 訂正（turn 11 / T8 実測）**: 修正前の代表画像は **378af26（T1 完了時点）の git
    worktree を立てて撮影**した。現在の harness は `src/font-metrics.js` を import するので
    修正前の木では動かず、計測は selector ごとの computed font-size と Canvas の font 文字列に
    絞っている。engine と `public/` はこのマイルストーンで不変なので、生成済みの `engine.wasm`
    と配信 manifest を複製した。
  - **PLAN 訂正（turn 11 / T8 実測）**: 観測コードの `attribute()` に**装飾文字の表**を足した
    （既存 suite と共通）。combobox の `▾` はどの widget の文字列にも無いため、720 CSS px の
    条件で隣のボタンへ吸われ「button が 13px」として落ちた。文字列で対応付くときは従来どおり
    （ツリーの開閉印は自分で `▾` を持つ）。

- [x] T9: 独立配布と最終検査を通し検証手順を文書化する
  - 完了基準: build:runtime/build:minimalの生成物を実ブラウザへ読み込み、ホスト16/20pxのDOM/Canvas、Hello World編集、日本語、dark切替とサイズ一致を確認する。全suiteは未実装skipなし、台帳の全対象roleに実測値・差・状態を持つ。`bun scripts/verify-font-parity.mjs` がクリーンなcontext/所有サーバーから非0検査を隠さず成功。README/配布/検証文書へ既存DOM基準・検証方法・限界を反映し、追従先の旧文言残存0件とdocs:checkを確認する。新依存・DSL/テーマのfont API・公開/デプロイなし。最終証跡と目視結果をまとめてverifyへ渡す。
  - 対象: `scripts/verify-font-parity.mjs`、`scripts/test-font-parity-browser.mjs`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`、`docs/testing.md`、`docs/runtime-distribution.md`、`docs/README.md`、必要なら `README.md`。
  - 依存: T8
  - 並列サブ作業: A: 文書の追従先確認・入口更新（対象: `docs/testing.md`、`docs/runtime-distribution.md`、`docs/README.md`、`README.md`）。B: 生成配布物のブラウザsuiteと最終runnerを完成（対象: `scripts/verify-font-parity.mjs`、`scripts/test-font-parity-browser.mjs`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`）。親が `docs/renderer-font-parity.md` の最終証跡を統合して全検査・コミット。両作業はT8までの確定結果を共有する。
  - **PLAN 訂正（turn 12 / T9 実測）**: 対象ファイルに新設 `tests/browser/font-parity-observe.js`
    と `tests/browser/font-parity-dist-embed.html` を追加した。配布物のページは `src/` を 1 つも
    読んではいけないので、観測関数を**何も import しない形**で `font-parity-observe.js` へ切り出し、
    生成物の隣へ置いて `import("/observe.js")` で読む。`font-parity-harness.js` は開発サーバー上の
    fixture 操作だけを持ち、移した関数を re-export する（suite 側の呼び出しは変えない）。
    `font-parity-dist-embed.html` は `docs/runtime-distribution.md` の手順どおりの組み込みホスト。
    `README.md` は更新不要だった（部品/API本数・フォント記載に今回の変更へ追従すべき旧文言が無い）。
  - **PLAN 訂正（turn 12 / T9 実測）**: 完了基準の「全suiteは未実装skipなし」を確かめる既存検査
    （`tests/font-parity-runner.test.js` の「未実装suiteは非0」）は、**全 suite が実装済みになると
    題材が無くなる**。表を注入して拒否を確かめる形に作り直し、あわせて「`SUITES` に実行関数の
    無い行が 0 件」を検査する（検査を緩めず、関数なしの新規登録はその場で落ちる）。
  - **PLAN 訂正（turn 12 / T9 実測）**: T6 の `lifecycle` 倍率ケースを T9 で直した（T9 の対象
    ファイル内）。**倍率上書きを消してしまう操作が 2 種類**ある。`locator.screenshot()` と、
    **新しい CDP セッションの attach**（別セッションが入れた上書きが外れる）。後者は未知だったため
    撮影が毎回 DPR を 1 へ戻しており、次の倍率で再描画が起きず 15 秒で時間切れになっていた
    （turn 9・11 でたまたま通っていた既存の不安定さ。T8 の木でも再現）。撮影をこのケースが持つ
    同じセッションに変え、通知はブラウザ自身の再描画を先に待ってから来ないときだけ合成する形に
    した。どちらで動いたかは倍率ごとに台帳へ残す。

- [x] F1: Canvas と DOM を役割単位で突き合わせ、DOM 側の役割一覧を閉じる（verify round 1）
  - 背景: 現在の suite は DOM を `ROLE_CONTRACT` の selector 表と、Canvas を「kind ごとに許される役割の集合」（`CANVAS_KIND_CONTRACT` と `allowed.includes(role)`）と、それぞれ別々に `SIZE_CONTRACT` の数値へ照合している。同じ部品・同じ役割の DOM 実効 px と Canvas 描画 px を直接比べるのは distribution の Hello World だけ（baseline の `compare()` は記録のみ）。verify が変異 1 と 5 を同時に入れた木で `roles`（28 ケース）と `matrix`（168 ケース）を実行し、**両方とも passed** になることを実測した（受け入れ基準 1「役割ごとに一致」を検査が担保していない）。製品コードの現状値は目視とコード読みで正しい。直すのは検査。
  - 完了基準: 下表のとおり。変異は 1 つずつ一時的に入れて該当 suite が非0になることを確かめ、確認後に戻して `git status --short` が空であることを確認する（変異そのものはコミットしない）。対応付けは部品の key と役割で行い、文字列や「同じフレームのどこかで使われた font」では行わない。DOM 側は selector の手書き表だけに頼らず、文字を描く全 kind の実際の文字ノード（子要素・疑似要素を含む）の実効サイズを測る（`observeDom` の文字ノード走査と baseline / distribution の `compare()` が再利用できる）。計測と描画の一致も部品単位で判定する。件数が変わるので台帳（`docs/renderer-font-parity.md`）の該当数値を更新する。

    | #   | 一時的な変異                                                                                   | 期待                                 |
    | --- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
    | 1   | `src/canvas-renderer.js` の metric で見出しと値の役割を入れ替える（`"label"` ↔ `"metric"`）    | `roles` と `matrix` が非0            |
    | 2   | `paintField` の checkbox / radio のキャプションを `"label"` で描く                             | `roles` が非0                        |
    | 3   | `paintField` のラベルを `"body"`、値を `"label"` で描く（textfield / combobox / displayfield） | `roles` と `editing` が非0           |
    | 4   | kanban-card の説明（`"label"`）と ID（`"meta"`）の役割を入れ替える                             | `roles` が非0                        |
    | 5   | `src/runtime.css` の `.ui-empty` から `font-size` を削除する                                   | `roles` が非0                        |
    | 6   | `.ui-fieldset` の `font-size` を `var(--ui-font-size-body)` にする                             | `roles` が非0                        |
    | 7   | `.ui-row span` に `font-size: var(--ui-font-size-body)` を足す（子要素側の宣言）               | `roles` が非0                        |
    | 8   | textarea の折返し計測（`ctx.font = this.fonts.font(valueRole, …)`）を `"label"` にする         | `roles` が非0                        |
    | 9   | 変異なし                                                                                       | 全 suite が green、不一致 0 件のまま |

  - 対象: `tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`tests/browser/font-parity-observe.js`、`docs/renderer-font-parity.md`。`src/` は変異の確認以外で変更しない。
  - 依存: T9

- [ ] F2: 欠け・入力位置・編集操作の検査の穴を閉じる（verify round 1）
  - 背景: 台帳が数値で主張しているのに gate が落とさない項目と、受け入れ基準 3 の代表画面のうち編集操作を実行していない画面がある。
  - 完了基準: 下表のとおり。追加する操作は既存の `FIELD_OPERATIONS` と同じ手順（focus → 編集開始 → 入力 → 確定 → 再編集 → 取消、state / value / revision の照合）で、実キー入力を使う。対象の入力欄が画面に存在しない場合は、存在しないことを Scene から確かめたうえで理由を台帳へ残す（黙って省かない）。

    | #   | 検査                                                                                                                                   | 期待                                                                                       |
    | --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
    | 1   | `font-parity-text.json` の `boundaryFits` / `boundaryOverflows`                                                                        | 前者は両面とも省略なし、後者は既存仕様どおり省略・クリップされることを assert する         |
    | 2   | `matrix` の「枠外へ出た未省略の描画」（`matrixOverflow`）                                                                              | 独立 runtime の全ケースで 0 件を assert する（現在は記録のみ）                             |
    | 3   | `matrix` の入力位置（`assertMatrixControls` の `checked`）                                                                             | 入力欄を持つ画面の独立 runtime ケースで 1 件以上を assert する                             |
    | 4   | `matrix` の dark ケース                                                                                                                | テーマ切替後に Canvas が新しいフレームを描いたことを確かめてから測る（古い記録を使わない） |
    | 5   | 編集操作中の `errors`                                                                                                                  | Rhai 拒否を意図したケース以外で空であることを assert する                                  |
    | 6   | DOM の media 案内                                                                                                                      | Scene が空 / エラーの media では案内が表示されていることを assert する                     |
    | 7   | 編集操作の追加: uivolve-forms の DOM 面、components のウィンドウ内の入力欄（DOM / Canvas）、uivolve-gallery の編集タブ（DOM / Canvas） | 既存 7 本と同じ照合で green                                                                |
    | 8   | 既存の全 suite                                                                                                                         | green、件数を台帳へ反映                                                                    |

  - 対象: `tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、必要なら `tests/browser/font-parity-text.json`、`docs/renderer-font-parity.md`。
  - 依存: F1

- [ ] F3: Canvas の描画失敗で操作・effects・他の面を止めない（verify round 1）
  - 背景: `CanvasRenderer.paint()` が毎フレーム `resolveFontMetrics(this.stage)` を呼び、解決できないと例外を投げる。`UiRuntime.render()` はそれを `dispatch()` / `compile()` の途中（state 更新の後、`runEffects` の前）で受けるため、verify のプローブ（`.gsd-lite/logs/renderer-font-size-parity/scratch/turn-013-probe.mjs`）で次を実測した。main の Canvas は computed style に依存せず、どれも起きない。
    - Canvas ステージを文書へ入れる前に `load()` すると `ステージの font-family を解決できません` で reject し、`onLoad` と初期 effects が実行されない（画面と state は確定済み。DOM renderer は同条件で成功）。
    - 表示中に Canvas ステージを文書から外して DOM 面のボタンを押すと、revision は 0→2 と進むのに `runEffects` が 0 回（正常時は 2 回）。面の順序が Canvas → DOM だと DOM 面の表示も古いまま。
    - ランタイム CSS が無い場合も同じ経路で effects が落ちる。`display: none` のステージは問題なし。
  - 完了基準: 下表のとおり。例外は面ごとの描画境界で `Error` 全般として受け、メッセージ文字列で分岐しない。T2 の「CSS 欠落や不正な解決値を静かに成功扱いしない」は保つ（行 3 は通知する）。宣言の無いサイズで文字を描かない。`lifecycle` suite に行 1〜5 を実ブラウザのケースとして足し、`tests/runtime.test.js` に「ある面の描画が失敗しても effects と他の面が実行される」単体試験を足す。未接続のステージの扱いを `docs/runtime-distribution.md` と台帳に書く。

    | #   | 条件                                                                                          | `load()` / `dispatch()` | `onLoad`・effects | 同じ runtime の他の面   | Canvas 面                                                 | `onError`                              |
    | --- | --------------------------------------------------------------------------------------------- | ----------------------- | ----------------- | ----------------------- | --------------------------------------------------------- | -------------------------------------- |
    | 1   | Canvas ステージが文書に未接続のまま `load()`                                                  | resolve                 | 実行される        | 描画される              | そのフレームは描かない。接続後の再描画で最新 state を描く | 通知しない                             |
    | 2   | 表示中に Canvas ステージを文書から外し、他の面を操作（面の順序 2 通り）                       | 成功、revision が進む   | 実行される        | 最新 state に更新される | 同上                                                      | 通知しない                             |
    | 3   | ステージは接続済みだがランタイム CSS が無い / 役割サイズが px で解決できない                  | 成功、state 更新        | 実行される        | 最新 state に更新される | 描かない                                                  | 役割名と property 名を含むエラーを通知 |
    | 4   | `display: none` のステージ                                                                    | 成功（現状どおり）      | 実行される        | 更新される              | 描画する                                                  | 通知しない                             |
    | 5   | 行 1〜3 の状態で、Scene を伴わない再描画（focus / blur・画像の load・フォント完了・倍率変更） | —                       | —                 | —                       | 行 1〜3 と同じ。例外をイベントハンドラの外へ漏らさない    | 行 3 のときだけ通知                    |
    | 6   | 通常の表示（既存の全 suite）                                                                  | 現状どおり              | 現状どおり        | 現状どおり              | 現状どおり                                                | 現状どおり                             |

  - 対象: `src/canvas-renderer.js`、`src/runtime.js`、必要なら `src/font-metrics.js`、`tests/runtime.test.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`、`docs/runtime-distribution.md`。
  - 依存: F2

- [ ] F4: ホストのタグセレクタ規則からフォーム部品の font を守る（verify round 1）
  - 背景: reset を `:where(.uivolve-runtime) :where(button, input, select, textarea)`（詳細度 0,0,0）へ下げたため、ホストページの `button, input, select, textarea { font: italic 700 17px/2 serif }` のようなタグだけの規則（0,0,1）が reset に勝つようになった。verify のプローブ（同上）の実測: サイズは部品側の宣言で 12 / 13px のまま保たれるが、DOM 面の全フォーム部品が `italic` / `serif` になり、入力欄・選択欄は太さ 700 になる（Canvas は runtime の字体・normal・400 のまま）。main の reset（0,1,1）は同じ規則に勝ち、字体・斜体・太さはランタイムのものだった。サイズの修正と引き換えに、main が防いでいた範囲を失っている。「決めた事項 1」の機構はこの副作用を見落としていたので、このタスクで訂正する。
  - 完了基準: 下表のとおり。対象は DOM 面の全フォーム部品（button / input / select / textarea。Grid 編集を含む）と Canvas の編集オーバーレイ（`.canvas-editor` の input / select / textarea）。守る範囲は「クラス・ID・`!important` を含まない規則（詳細度 0,0,n）」で、main の reset が勝っていた範囲と同じ。それより強いホスト規則と、ランタイム内部の class を名指しする規則は対象外として台帳の限界に書く。機構は任せるが、部品別の宣言（button 12/500、panel-toggle 12/600、close 20 など）が reset に負けないこと。`roles` / `editing` suite にホスト規則ありのケースを足して実測する。

    | #   | ホストページの規則（ランタイムの stylesheet の前後どちらに置いても）                               | 期待（フォーム部品とオーバーレイの computed 値）                                        |
    | --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
    | 1   | `button, input, select, textarea { font: italic 700 17px/2 serif }`                                | font-family / font-style / font-weight / font-size / line-height が規則なしのときと同一 |
    | 2   | 行 1 と同じ値を longhand（font-family / font-style / font-weight / font-size / line-height）で指定 | 同上                                                                                    |
    | 3   | `html body button, html body input, html body select, html body textarea { … }`（0,0,3）           | 同上                                                                                    |
    | 4   | 規則なし、ホスト font-size 16 / 20px（既存ケース）                                                 | 既存の期待どおり（回帰なし）。Canvas の描画サイズ・字体と一致                           |

  - 対象: `src/runtime.css`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`、`docs/runtime-distribution.md`。
  - 依存: F3

- [ ] F5: 台帳と文書の事実誤り・古い記述・言い過ぎを直し、最終 gate を通す（verify round 1）
  - 背景: verify が `docs/renderer-font-parity.md` の数値と主張を証跡 JSON・コードと照合した。現在の合計値（28 ケース / DOM 1243 / Canvas 1276 / 37 kind / 48 xtype / 168 ケースなど）は証跡と一致したが、下の項目が食い違っていた。行番号は 7b126a4 時点。F1〜F4 で変わった件数・挙動もここで最終値に揃える。
  - 完了基準: 下の全項目を直し、`bun scripts/verify-font-parity.mjs` が green。直した旧文言が残っていないことを grep で確認する。
    - 事実の誤り:
      - L311「10 画面を 19 ケース」→ 13 fixture（8 画面ファイル）。
      - L324「必須 kind（29 種）」→ T3 時点 36、現在 37。
      - L640 の表見出し「送り幅（13px、body）」→ 4 行目の `日本語テキスト` は 12px / caption。
      - L748「T2 の時点から残っていた fieldset の穴」→ T3。
      - L764–775「合成される xtype 6 つ」→ 5 つ（`menuseparator` は画面定義に書ける）。
      - L790 drag-ghost の観測ケース → 状態表が記録しているのは `kanban-drag-dom` だけ。Canvas 側の ghost も状態として記録するか、記述を合わせる。
      - L924「6 画面すべてで集合は一致」→ 7 画面（PLAN の T8 訂正も同じ誤り）。
      - L944 `.ui-grid-column` などの画面 → grid-lab のみ。orders は `.ui-row` / `.ui-grid-header` で、`.ui-row` が修正前後の表に無い。
      - L502「`src/surfaces.js` は px の数値を 1 つも持ちません」→ `src/surfaces.js` に 12 / 14 / 16 がある（engine の補完値と文書 sprite の既存値）。持つ理由を書く。
    - 古い記述:
      - L84–89（suite を重ねると lifecycle が落ちる「既存の挙動」）は T9 で原因を特定・修正済み。現状に合わせる。
      - L181 / L278（実ズームを T8 で記録する、という未来形）。
      - L311–314 / L324–325 / L341 / L358 の T3 時点の件数（19 ケース / 664 / 36 kind / 39 件）に時点を明記する。
      - L360（media 案内が Canvas 13px）は T5 で修正済み。
      - L362 extra-button の太さの差（DOM 12px/400 対 Canvas 500 12px）は「T7 が表現差として扱う」とあるが T7 の表に無い。既存の表現差として一覧に入れる。
      - L125 / L160–164 の `src/runtime.css` の行番号。
    - 言い過ぎ:
      - L457 / L557 / L826: 幅・DPR・テーマ・拡大を T8 へ送ったとあるが、matrix に無いもの（figure / document / media / dialog-icon、Grid 編集オーバーレイ、9px の役割）は light / host 16px / DPR 1 でしか測っていない。範囲を明記する。
      - L429: uivolve-forms の textarea 操作は Canvas 面のみ（F2 で DOM 面を足したら最終値で書く）。
      - L520 / L797「media 案内 46 件」→ 46 は検査した media 枠の数で、案内が出ているのは 28 件。「ダイアログアイコン 6 件」は文字 4 ＋ 標準 SVG 2。
      - L798「遅延配信の前後 5 ケース」→ フォント 4 ＋ 倍率 1。
      - L702 / L747「状態別 coverage」「状態 18 件すべて観測」→ 状態ごとの存在確認であり、部品 × 状態の格子ではないことを書く。
      - L880–898 / L971–979: T8 の編集 journey の拡大ステップも合成した `change` を発火している。T8 の節と限界表に書く。
      - L911「枠外へ出た未省略の描画 0 件」→ 独立 runtime のみ。
      - L942 `.ui-button` が「全画面」→ 7 画面中 6。
      - L1080「代表画像と目視結果（12 枚）」→ 表は 5 行、目視したのは 4 枚。
      - L38「最終判定は上をまとめた 1 本」→ gate は vitest / test:rust / check / docs:check / build も実行する。
      - L1057–1058「`src/runtime.css` は `font-size` を宣言していません」→ ステージ自身についてだけ成り立つ。
      - `docs/runtime-distribution.md:97`「実測では…変わらない」→ 配布物で測ったのは Hello World の役割と編集欄。範囲を書く。
      - `docs/testing.md:83`「Playwright実行スクリプトは2系統」→ `scripts/capture-retrospective.mjs` もある。
    - 一覧の整理: 受け入れ基準 1 の「該当しない部品と既存の描画差の一覧」が各タスクの表に散らばり、解消済みの行と恒久の行が混ざっている。**現在の状態だけ**をまとめた 1 つの表を置く（文字を描かない kind、対象外、既存の表現差: Kanban ghost の ID、使用不可カレンダー日の濃さ、文字アイコンの行分割、extra-button の太さ、省略方式の違い など）。
    - 限界への追記（verify が round 1 で確認した残留リスク。修正はしない）: (1) ホストの `* { font: inherit }` のような規則は SVG の `font-size` 属性より強く、sprite の文字サイズを変える。検査は属性値を読むので検出しない。main から同じ。(2) ホストが `canvas` に `max-width` などを指定すると bitmap が縮んで文字が小さく見える。検査は `canvas.style.width` を読むので検出しない。main から同じ。(3) figure / document の文字は DPR 2・拡大・dark で測っていない。(4) ブラウザの最小フォントサイズ設定の影響（9px の役割）は測っていない。
    - 目視の記録: 表の各行に面（デモ / 独立）とテーマを書く。uivolve-forms の修正前後の組を足す。
  - 対象: `docs/renderer-font-parity.md`、`docs/runtime-distribution.md`、`docs/testing.md`、`.gsd-lite/PLAN.md`（T8 訂正の「6 画面」）。
  - 依存: F4

## 決めた事項

1. DOMの部品別**宣言値**を基準として維持し、偶発的なreset継承は修正する。resetを `:where(.uivolve-runtime) :where(button, input, select, textarea)` とする計画。根拠: `src/runtime.css:11` のfont shorthandと同ファイル437/452/252/185行の明示指定、RESEARCHのspecificity解析。
2. runtime内の非公開CSS propertiesは `--ui-font-size-meta`=9px、`--ui-font-size-label`=11px、`--ui-font-size-caption`=12px、`--ui-font-size-body`=13px、`--ui-font-size-close`=20px、`--ui-font-size-metric`=22px、`--ui-font-size-icon`=30pxとする。名前は今回確定する新設名。根拠となる既存値は `src/runtime.css:139,696,437,196,252,276,44`。文書14/16pxとfigureの任意fontSizeは既存spritesを維持（`src/surfaces.js:17,22,39`、`engine/src/figures.rs:266`）。公開設定APIにしない。
3. Canvasは新設 `src/font-metrics.js` でCSS値とruntime字体を描画開始時に一度解決し、textと直接計測・surface/iconへ渡す。render以外のpaint経路も対象。現在の窓口は `CanvasRenderer.text(text, x, y, width, color = this.scene.theme.colors.text, size = 13, weight = 400, family = FONT, align = "left")`（`src/canvas-renderer.js:535`）。このシグネチャは現状の引用であり公開APIの約束ではない。計測専用箇所は同708/763/920行。不要な字体/太さ/行間の全面変更は行わない。
4. Gridは通常値も編集中も12px、通常fieldは13px。Grid例外はconfig.gridEditorで識別する（`src/canvas-renderer.js:359,402`、`src/dom-renderer.js:181`）。通常値12pxの基準は `src/runtime.css:579-591`。native controlは既存createControl/syncControlを使い続ける（`src/field-control.js:5,96`）。
5. document/figureは同じsprites・同じborder内側viewportで変換する。現状 `renderSvg(record, widget, theme)` はviewBox + xMidYMid meet（`src/surfaces.js:61,67-68`）、`paintSurface(ctx, widget, theme)` はwidget全体で倍率計算（同117/126-134行）、DOMは1px border（`src/runtime.css:464-475`）。実効pxはDOM computed font-size×SVG CTM倍率とCanvas font-size×ローカル倍率をCSS座標系で比べ、bitmap DPRを除く。
6. bitmapのDPR倍率は既存 `src/canvas-renderer.js:469-479` を維持し、font-sizeへDPRを掛けない。フォント/DPR通知はUiRuntimeのscheduleRenderとdisposeに接続する方針（`src/runtime.js:126,245,386-405`）。一時のrenderer paintでも最新の解決値を用いる。
7. 常設ブラウザ検査は既存Playwrightと実WASM harness方式を再利用する。対象OSは現在のLinux環境、Chromium、127.0.0.1の所有サーバー。ブラウザ経路はT1で実測確定し、snap失敗を成功に読み替えない。既存選択例は `scripts/test-transfer-browser.mjs:57-60`、最終runnerの失敗/中断伝播例は `scripts/verify-transfer.mjs`。製品コードへ検査専用公開APIを追加しない。

## メモ

### 粒度とゴール逆算

受け入れ基準をCSS継承、通常描画、編集、SVG/特殊文字、font/DPR購読、状態coverage、行列/目視、配布へ細分化し、同じファイル群の修正と対応検査を統合した9タスク。ブラウザ準備は独立した停止単位とし、全roleの状態coverageと画面行列も各1ターンに分ける。先頭未完了を依存順で実施する。

| REQUIREMENTS受け入れ基準                  | 完了を担うタスク                     |
| ----------------------------------------- | ------------------------------------ |
| 1 全共通部品・役割別実効px・対象外の理由  | T1台帳、T2/T3/T4/T5実測、T7全件照合  |
| 2 フォント後の実ブラウザ比較と画像目視    | T1入口、T6読込、T8目視               |
| 3 代表画面・通常/focus/編集確定取消・同期 | T4操作、T7一時状態、T8代表画面       |
| 4 日本語/英数字/空/長文・欠け/重なり      | T3計測、T4入力、T5特殊描画、T8画像   |
| 5 desktop/390px・100/200%・DPR1/2         | T5SVG換算、T6DPR通知、T8倍率別記録   |
| 6 theme/render・編集focus・実IME限界      | T4composition、T6競合、T8目視/限界   |
| 7 適切な回帰・build/check                 | 各修正タスクのsuite、T9最終検査/配布 |

### RESEARCHの再利用設計の採否

| 盗める点                                   | 採否と理由                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| runtimeに閉じたCSSと役割サイズ             | 採用、T2の単一サイズ源。デモCSSだけの修正は却下、独立面に届かない                 |
| text窓口と直接計測の接続                   | 採用、T3。サイズ数字のコピー検査は却下、実行時の継承と描画を検出できない          |
| createControl/syncControlとcomposing guard | 採用、T4。入力作り直しは却下、選択とIME下書きを失う                               |
| documentSprites/SVG/Canvas共有記述         | 採用、T5。両側で別の折返し表を作らない                                            |
| figuresのWASM生成fontSize                  | 採用、T5/T7。DSL省略値をブラウザで独自補完しない                                  |
| widget-contractの分類、extrasの展開        | 採用、T7。ただし操作kind分類のみでは全文字roleを列挙できないため生成Sceneとも照合 |
| runtimeのCSS・ResizeObserver・render       | 採用、T6/T9。font/DPR通知を補いdisposeで解除、既存レイアウト/状態経路を維持       |
| capture-retrospectiveの元fillTextへの委譲  | 採用、T1観測。既存撮影画像を今回の合格証拠とする案は却下                          |
| 実WASM browser harnessと状態回帰           | 採用、T1/T4/T6。mockだけのCSS合格は却下                                           |
| 既存build/check/testとPlaywright           | 採用、T9。新依存は不要                                                            |

### 落とし穴の対応（RESEARCHの列挙順）

| 落とし穴                     | 機械確認/目視の担当                    |
| ---------------------------- | -------------------------------------- |
| CSS宣言だけで一致判定        | T1実効観測、T2host16/20、T7全role      |
| DOM親とstageの継承差         | T2parent別、T4Grid/dialog editor       |
| DPR二重拡大                  | T6bitmap/transform/DPR往復、T8行列     |
| zoom後に旧bitmapを維持       | T6DPRのみ変化、T8実ズームと代用区別    |
| font後にfallback描画が残る   | T6遅延/失敗/dispose競合                |
| measureTextとdraw fontの相違 | T3幅境界/寄せ/日本語/空/長文           |
| SVG属性だけの比較            | T5CTMとborder内側倍率、T8幅行列        |
| native editorのサイズ跳ね    | T4通常/編集/確定/取消/拒否             |
| IME/selection/focus消失      | T4composing + theme/resize、T6font競合 |
| 字体/太さ/行高による欠け     | T3計測、T5複数行、T8目視               |
| 一時状態のcoverage漏れ       | T7全状態と理由付き台帳                 |

並行性はT6のfont完了対dispose/render、T4/T6のcomposing対theme/resizeで担保する。境界値はT3の空/幅閾値、T5のviewport/大きな文字、T8の幅/倍率。異常系はT1起動/cleanup、T4Rhai拒否、T5media error、T6font失敗。例外は特定のエラー文字列/コードだけで捕捉せず、操作境界でその失敗系全体を処理し、元の失敗をcleanup失敗で隠さない。

### 直近2件の振り返りからの採否

- opfs-file-transfer: PATH入口、実行環境プローブ、整形→起動、cleanupの元エラー保持、PROGRESSのturn一意性/昇順は採用（T1/全ターン）。サーバー/Rhai fixtureの複雑作業分離の考えはT1と後続検査の分割へ反映。Content-Type既定値表は今回の文字契約に無関係のため不採用。ループ/スキル改修とusage計測追加はスコープ外で不採用。
- development-retrospective-blog: ブラウザ経路/日本語字体の事前共有、scratch構文確認と実fixture文字列の照合、整形→build→撮影、やり直しを検証再実行/ツール指定修正に分ける記録は採用（T1/T8/全ターン）。スキル入口自体の改修とループ計測は不採用、今回のスコープ外。
- researchのブラウザ未実測を継承し、T1成功まで実効pxや画像確認済みとは書かない。実ブラウザ起動不能は実装ターンの停止条件であり、要件内の実行手順を定められる計画作成自体の停止条件ではない。

### verify round 1 の記録（turn 13）

判定は差し戻し（F1〜F5）。round 2 以降はこの格子の再確認と修正差分の回帰だけを行い、新しいクラスは探さない。

- 最終 gate: `bun scripts/verify-font-parity.mjs` を clean な木から実行し 14 手順とも成功（vitest 630 件、roles 28 ケース、editing 16、surfaces 18、lifecycle 5、matrix 168、distribution 8。件数は turn 12 と同じ）。所要はおよそ 70 秒で、PROGRESS turn 12 の「およそ 20 分」は実際と違う（前回の gate ログも vitest 開始から完了まで約 1 分）。前景のまま実行できる。
- 目視: 修正前後の components、狭幅 dark の grid-lab、絵文字アイコンのダイアログを確認し、両面の文字サイズ差の解消と新たな欠け・重なりが無いことを確かめた。
- 堅牢性の格子（実ブラウザ、`scratch/turn-013-probe.mjs`）:

  | 入力経路                  | 試した条件                                                                      | 結果                          |
  | ------------------------- | ------------------------------------------------------------------------------- | ----------------------------- |
  | ステージの状態            | 未接続のまま load / 表示中に外す（面の順序 2 通り）/ `display: none` / CSS 無し | `display: none` 以外は F3     |
  | ホスト CSS                | font-size 16 / 20px の継承（既存 suite）/ タグセレクタの `font` 規則            | 継承は合格、タグ規則は F4     |
  | ホスト CSS（main と同じ） | `* { font: inherit }` と SVG 属性、`canvas` への寸法指定                        | 残留リスク（F5 で限界に記載） |
  | 文字の内容                | 日本語・英数字・空・長文・絵文字・等幅（既存 suite の fixture）                 | 合格（境界の assert は F2）   |
  | フォント・倍率            | 遅延読込・読込失敗・dispose 中の完了・DPR 1→2→1→2.5→1（既存 lifecycle）         | 合格                          |
  | 検査そのもの              | 変異（metric の役割入替 ＋ `.ui-empty` の宣言削除）で roles / matrix を実行     | 両方 passed のまま → F1       |

- セキュリティ: `src/` は秘密情報・外部入力の評価・新しい依存なし。検査スクリプトは `shell: true` を使わず、サーバーは 127.0.0.1 に限定、`package.json` と lockfile は不変、`src/` は `tests/` を import しない。残留リスク（修正不要、CLI を手で使う場合のみ）: runner のサーバー起動失敗時に `bunx vp dev` の process group が残る、SIGINT は suite の切れ目まで待つ、`--evidence` に repo 外のパスを渡せる（distribution が `<evidence>/dist-host` を削除する）、`--browser-endpoint` の URL をログに出す。
- 並列レビュー: テスト妥当性と文書照合を読み取り専用のサブエージェント 2 本に分け、製品コードの差分・プローブ・変異の実行・判定は親が行った。
