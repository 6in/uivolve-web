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

- [ ] T2: DOMの役割別サイズを保持してresetを修正し共通サイズ源を作る
  - 完了基準: runtime内resetを低詳細度へ変更し、DOMの既存11/12/13/20/22/30px等の宣言が勝つ。新設CSS custom propertiesを既存サイズ宣言から参照し、Canvas用の解決関数はstageのcomputed値を取得する。9pxのIDも含む。文字ごとのgetComputedStyleやJS側の独立したサイズ表は増やさない。roles suiteにroot直下・panel/window内・popup内・Canvas stage直下を追加し、host font-size 16/20px、light/darkでbutton12・close20・editor13等が局所指定どおりであることを実測する。ホスト外枠のcomputed値が変わらないことも確認。CSS欠落や不正な解決値を静かに成功扱いしない。
  - 対象: `src/runtime.css`、新設 `src/font-metrics.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`。
  - 依存: T1
  - 並列サブ作業: なし（CSSとresolverの契約に依存）。

- [ ] T3: Canvasの基本・追加部品の描画と計測を役割へ接続する
  - 完了基準: text窓口だけでなく全直接ctx.font/measureTextを棚卸しして同じ解決済みサイズを使う。label/empty/metric、button、panel/fieldset/window、旧row/Grid、tab/tree/menu、calendar/paging、toast/dialog-message、kanbanタイトル/件数/説明/ID/drag ghostの全roleがDOM実効pxと一致する。通常field値/labelも接続しT4の編集を準備する。selected/disabledでサイズは変わらない。左/中央/右寄せ、空、日本語、長い英数字、幅境界直前/直後、複数行でmeasureTextと描画fontが一致し、既存省略/折返し/clipを超える新たな欠けがない。roles suiteの当該roleを実WASM fixtureと元処理を通すCanvas観測で検証する。Kanban ghostのID非表示は既存差として台帳に残す。
  - 対象: `src/canvas-renderer.js`、必要なら `src/font-metrics.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`。
  - 依存: T2
  - 並列サブ作業: なし（同じrendererと観測suiteを更新する）。

- [ ] T4: 通常値と編集オーバーレイ、Grid編集を揃える
  - 完了基準: 通常fieldは13px、Grid cellの表示/DOM編集/Canvas編集は12px。gridEditorを局所識別して通常fieldを変更しない。labelHeight=0/有り、textfield/number/date/textarea/combobox/listbox、placeholder/option/monospace、dialog promptを両面で確認。Hello World・フォーム・orders/grid-labでfocus→編集開始→入力→Enter確定→再編集→Escape取消、GridのRhai拒否と下書き保持を実操作しstate/value/revisionを照合する。composing中のtheme/resize/renderでも同じinput、activeElement、selection、未確定値を保持する。合成composition試験と実IME確認の有無を分ける。フォーム関連・Grid・dialogの既存状態テストも成功。
  - 対象: `src/dom-renderer.js`、`src/canvas-renderer.js`、`src/runtime.css`、必要なら `src/field-control.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、変更契約に応じ `tests/fields.test.js` / `tests/grid-navigation.test.js` / `tests/dialogs.test.js`、`docs/renderer-font-parity.md`。
  - 依存: T3
  - 並列サブ作業: なし（共通編集契約と両面の操作試験を一緒に検証）。

- [ ] T5: 文書・図表とdialog/media文字の実効倍率を合わせる
  - 完了基準: 共有spritesを維持し、DOM SVGのborder内側viewport/CTMとCanvasのローカルtransformを同じ内容矩形に揃える。documentタイトル14・見出し16・本文/code12とfigureのScene fontSizeをCSS px換算して一致を検証する。WASM補完値を使用しDSLの省略を勝手に別値にしない。字体差が幅/欠けに影響する非code文字はruntime字体へ揃え、monospaceを保つ。dialog絵文字/任意テキスト30pxのmaxWidthによる意図しない縮小を防ぐ。mediaの空/エラー案内はDOM12pxへ合わせ、native overlayも確認する。desktop/390pxで日本語・英数字・絵文字・空・長文・複数行を数値と画像で確認。iframe内部・画像内文字・非文字SVGアイコンは対象外理由を残す。gallery/dialog状態回帰も成功。
  - 対象: `src/surfaces.js`、`src/dialog-icons.js`、`src/canvas-renderer.js`、必要なら `src/runtime.css`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`。
  - 依存: T4
  - 並列サブ作業: なし（同じCanvas font呼出しとsurface倍率を変更する）。

- [ ] T6: フォント完了とDPR変更時の再描画・解放を保証する
  - 完了基準: 初期fonts.readyと以後の使用字体load完了で必要な再描画/再計測を行い、失敗時もfallbackで動作する。テストサーバーで読取可能なテスト字体を遅延配信し、読込前後の実計測と描画更新を確認する（T1で字体経路を固定、依存追加なし）。font完了とtheme/renderの競合、load失敗、dispose後の完了では例外・復活描画・購読漏れなし。DPRだけが変わってCSS幅が同じ場合もbitmap/transformを更新し、DPR1→2→1で倍率が累積しない。複数runtimeのdisposeは他方へ影響しない。編集ノード・selection・draftを失わず、runtime状態回帰とlifecycle suiteが成功。
  - 対象: `src/runtime.js`、`src/canvas-renderer.js`、必要なら `src/font-metrics.js`、`tests/runtime.test.js`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`scripts/test-font-parity-browser.mjs`、`docs/renderer-font-parity.md`。
  - 依存: T5
  - 並列サブ作業: なし（購読・再描画・disposeの実装と試験は依存）。

- [ ] T7: 全共通部品の状態別coverageを閉じる
  - 完了基準: DomRendererのcreate/render、CanvasRendererのpaint/paintField、extrasのnormalize/arrange、実生成Sceneからkindとxtypeの二層で全役割を照合し、対応無しを黙ってskipしない。文字なし・対象外・既存の表現差は理由付きで台帳に残す。gallery全タブ、popup/menu、toast、dialog標準/画像/絵文字、media error、drag、selected/disabled、calendar月移動/長い月名/月端、label無しfieldを網羅する。代表画面だけにないroleは実WASM補助fixtureで検証する。台帳の全対象roleが実測結果を持ち、不一致0件。既存描画差を理由にサイズ不一致を免除しない。不足修正は既に確定したサイズ/倍率方針内に限定する。
  - 対象: `tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`、実測で残差がある場合のみ `src/runtime.css` / `src/canvas-renderer.js` / `src/dom-renderer.js` / `src/surfaces.js` / `src/dialog-icons.js`。
  - 依存: T6
  - 並列サブ作業: なし（coverage集計と残差修正を単一台帳へ統合）。

- [ ] T8: 幅・拡大・配色の行列を実行し代表画像を目視する
  - 完了基準: Hello World、uivolve-forms、orders/grid-lab、components、uivolve-galleryについて、比較デモ/独立runtime × desktop/約390px × DPR1/2 × light/darkで全可視roleのCSS pxと入力位置を検証。viewportを狭めるだけでなく100/200%相当の拡大を別条件として実施し、方法とCSS座標換算を記録する。可能なら実ブラウザ100→200→100%も実施し、DPRエミュレーションやCSS拡大と別記録にする。focus/編集中にtheme/resize/拡大を変え、状態同期とnode/selectionを確認。修正前後の代表画像を同じ字体ロード後に撮影し、目視でサイズ差解消と長文/22px metric/30px icon/狭いセルの新たな欠け・重なりなしを記録する。自動数値結果、画像パス、目視結果、実IME/実ズームの限界を台帳に分けて残す。matrix suite成功。
  - 対象: `tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`scripts/test-font-parity-browser.mjs`、`docs/renderer-font-parity.md`。画像・JSONは `.gsd-lite/logs/renderer-font-size-parity/`。
  - 依存: T7
  - 並列サブ作業: なし（同じsuiteと目視記録を更新する）。

- [ ] T9: 独立配布と最終検査を通し検証手順を文書化する
  - 完了基準: build:runtime/build:minimalの生成物を実ブラウザへ読み込み、ホスト16/20pxのDOM/Canvas、Hello World編集、日本語、dark切替とサイズ一致を確認する。全suiteは未実装skipなし、台帳の全対象roleに実測値・差・状態を持つ。`bun scripts/verify-font-parity.mjs` がクリーンなcontext/所有サーバーから非0検査を隠さず成功。README/配布/検証文書へ既存DOM基準・検証方法・限界を反映し、追従先の旧文言残存0件とdocs:checkを確認する。新依存・DSL/テーマのfont API・公開/デプロイなし。最終証跡と目視結果をまとめてverifyへ渡す。
  - 対象: `scripts/verify-font-parity.mjs`、`scripts/test-font-parity-browser.mjs`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`、`docs/renderer-font-parity.md`、`docs/testing.md`、`docs/runtime-distribution.md`、`docs/README.md`、必要なら `README.md`。
  - 依存: T8
  - 並列サブ作業: A: 文書の追従先確認・入口更新（対象: `docs/testing.md`、`docs/runtime-distribution.md`、`docs/README.md`、`README.md`）。B: 生成配布物のブラウザsuiteと最終runnerを完成（対象: `scripts/verify-font-parity.mjs`、`scripts/test-font-parity-browser.mjs`、`tests/browser/font-parity.mjs`、`tests/browser/font-parity-harness.js`）。親が `docs/renderer-font-parity.md` の最終証跡を統合して全検査・コミット。両作業はT8までの確定結果を共有する。

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
