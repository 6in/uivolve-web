# DOM / Canvas フォントサイズ統一 — 調査

調査日: 2026-10-06。対象は state の `local_projects`（検索先 `.`）と `official_docs` のみ。要件・決定は変更していない。類似 OSS 調査、新依存、実装はこのターンの対象外。

## 結論と確度

一律の Canvas 拡大では解決しない。多くの役割は既に同じ px を指定している一方、`src/runtime.css:11` の `.uivolve-runtime :is(button, input, select, textarea) { font: inherit; }` が、一部の部品別指定と Canvas 編集オーバーレイの指定より高い詳細度を持つ。これがホスト・DOM 親によって文字サイズを変える主要候補である。独立ランタイムにも同じ CSS を使うため、比較デモだけの CSS 修正では足りない。

この判断はコードと CSS 仕様による解析。ブラウザ実測済みとは扱わない。Playwright の CSS プローブは構文確認に成功したが、bundled Chromium が未導入。既存スクリプトと同じ `/usr/bin/chromium-browser` へ切り替えても snap-confine の capability 制約で起動失敗した。実効 CSS px・画像・実IME・実ブラウザ拡大は未確認。research の成果物作成は可能なため plan に進めるが、実装後のブラウザ受け入れ確認を省略してはならない。

## 参考実装と再利用

| パス                                                          | 再利用できる設計                                                        | 検証への使い方                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/runtime.css:1`                                           | マウント面内だけに閉じる CSS と役割別サイズ。DOM の既存宣言を基準にする | 独立面と比較デモ双方で getComputedStyle を記録する                       |
| `src/canvas-renderer.js:535`                                  | `text()` にサイズ・太さ・字体を渡す既存窓口                             | `fillText` の実行時 font と transform を役割・widget key に対応付ける    |
| `src/canvas-renderer.js:708` / `763` / `920`                  | 計測専用 font 指定も存在                                                | measureText と直後の描画で同じ font を使うことを確認する                 |
| `src/field-control.js:5` / `96`                               | DOM/Canvas 共通の native 入力と composing 中の値保持                    | 編集中の input identity、selection、activeElement と未確定値を確認する   |
| `src/canvas-renderer.js:342` / `406` / `480`                  | オーバーレイの生成・位置更新・再描画時の再利用                          | ラベル有無、Grid・dialog、テーマ変更時の通常描画と入力を比較する         |
| `src/surfaces.js:7` / `50` / `64` / `117`                     | documentSprites と figure の同じ描画記述から DOM SVG と Canvas を作る   | SVG viewBox と Canvas のローカル倍率を含めて比較する                     |
| `engine/src/figures.rs:40` / `246`                            | 図表文字は12、draw の fontSize 省略を12へ補完                           | 生 DSL でなく WASM が生成した Scene の値を検査する                       |
| `src/widget-contract.js:2` / `13`                             | 入力・操作の kind 分類を既に共有                                        | テキスト役割の一覧と操作対象を照合する（全 Widget 一覧ではない）         |
| `engine/src/extras.rs:61` / `638`                             | gallery の多数の xtype を既存 Widget に展開する                         | xtype と kind の二層で網羅表を作る                                       |
| `src/runtime.js:113` / `126` / `232`                          | 共通 CSS の適用、ResizeObserver、Scene の描画                           | 独立 runtime と比較デモに同じサイズ修正を適用する                        |
| `scripts/capture-retrospective.mjs:66` / `77`                 | ブラウザ選択と実 fillText を元実装へ委譲しながら観測する例              | font・transform の採取へ拡張できる。既存撮影画像は今回の合格証拠にしない |
| `tests/browser/transfer-harness.js` / `tests/runtime.test.js` | ブラウザ用実 WASM harness と runtime 状態テストの例                     | CSS は mock adapter の単体テストでは検証できない                         |
| `docs/testing.md` / `package.json`                            | 既存の build/check/test とブラウザ検証方針、Playwright 導入済み         | 依存追加なしでブラウザ検証を構成する                                     |

## 部品と文字役割の初期対応表

単位は CSS px。DOM 列は **CSS 宣言と解析値** であり、実測値ではない。「継承」は前述の reset が勝つため親の実効値に依存する。Canvas はソース上の描画引数。実装ターンではこの表を実測と差分・理由付きの台帳へ更新する。

| Widget / 役割                                                                                      | DOM の指定                             | Canvas                                               | 差・確認点                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| label / 基本文字・muted・tbtext・ページ情報                                                        | `.ui-label` 11                         | fallback 11                                          | 指定一致                                                                                          |
| empty / 空一覧                                                                                     | 12                                     | 12                                                   | 指定一致                                                                                          |
| metric / 見出し、値                                                                                | 11 / 22                                | 11 / 22                                              | 指定一致、22px の長い値を確認                                                                     |
| textfield, textarea, numberfield, datefield, combobox, listbox / ラベル                            | 11                                     | 11                                                   | labelHeight=0 なら文字なし                                                                        |
| 上記入力 / 値・placeholder・listbox 選択肢                                                         | 13、option は継承                      | 13                                                   | `.ui-field > :is(...)` は reset と同詳細度で後の指定が勝つ。option の native popup 表示も別途確認 |
| checkbox, radio / boxLabel                                                                         | 13                                     | 13                                                   | native 印と Canvas のチェック印は既存の描画差                                                     |
| slider / ラベル                                                                                    | 11                                     | 11                                                   | range 本体に値文字なし                                                                            |
| displayfield / ラベル、値                                                                          | 11 / `.ui-widget` 継承13               | 11 / 13                                              | 指定一致                                                                                          |
| progressbar / 表示文字                                                                             | 12                                     | 12                                                   | 28px 高のクリップ確認                                                                             |
| button / 本文、dialogbutton                                                                        | 12 宣言、実際は reset による親継承候補 | 12                                                   | サイズ・500 weight 指定の競合を実測する                                                           |
| extra-button / カレンダー日付・前後・ページ操作・toast 閉じる                                      | 12 宣言、親継承候補                    | 12                                                   | gallery の各状態を確認                                                                            |
| panel, fieldset / 見出し                                                                           | 12                                     | 12                                                   | 指定一致                                                                                          |
| panel-toggle / 見出し                                                                              | 12 宣言、親継承候補                    | 12                                                   | root の親によって変化する可能性                                                                   |
| window / タイトル                                                                                  | `.window-title` 12                     | 12                                                   | 指定一致、dialog アイコン付き inset も確認                                                        |
| window-close / ×                                                                                   | 20 宣言、親継承候補                    | 20                                                   | window 内では親 `.ui-widget` の13等になり得る                                                     |
| grid-header / 旧表見出し                                                                           | 11                                     | 11                                                   | cell span が継承                                                                                  |
| row / 旧表本文                                                                                     | 12 宣言、button の親継承候補           | 12                                                   | 旧表と Grid の両経路を対象にする                                                                  |
| grid-column, grid-cell, grid-select / 列見出し・値・選択印                                         | 12 宣言、button の親継承候補           | 12                                                   | Grid 編集中の field 値は13。既存12→13の差を揃える方針が必要                                       |
| grid-page, menu-trigger / ページ・メニュー起点                                                     | 12 宣言、親継承候補                    | 12                                                   | popup も対象                                                                                      |
| tab, tree-node, tree-toggle, menu-item / 表示文字                                                  | 12 宣言、親継承候補                    | 12                                                   | 選択/disabled でサイズを変えない                                                                  |
| tree-shell / 見出し                                                                                | `.window-title` 12                     | 12                                                   | button 以外の見出し                                                                               |
| kanban-lane / タイトル、件数                                                                       | 12 / 11                                | 12 / 11                                              | 子要素の明示指定                                                                                  |
| kanban-card / タイトル、説明、ID                                                                   | 12 / 11 / 9                            | 12 / 11 / 9                                          | 擬似要素とドラッグ ghost も対象。Canvas ghost はIDを描かない既存差                                |
| toast / タイトル・本文                                                                             | `.ui-widget` 13                        | 13                                                   | 26px 行送りは共通、閉じるは extra-button                                                          |
| dialog-message / 本文                                                                              | 13                                     | 13                                                   | 22px 行送りとスクロール                                                                           |
| dialog-icon / テキスト・絵文字                                                                     | 30                                     | 30                                                   | Canvas fillText の maxWidth による圧縮可能性、SVG/画像アイコンは文字なし                          |
| document / タイトル・見出し・本文・code                                                            | 14 / 16 / 12 / 12（共通 sprites）      | 同値                                                 | DOM 非code は runtime 字体、Canvas 非code は system-ui。文字幅・欠けを確認                        |
| figure / 図表・draw の text sprite                                                                 | sprite.fontSize（通常12）              | 同値、fallback12                                     | fontSize 未指定の draw は WASM が12を補完。SVG 内側サイズは倍率で換算                             |
| image, video, iframe / 空・エラー案内                                                              | 擬似要素12                             | image 等の案内 text 既定13、native overlay にはCSS12 | 文字内容にも既存差。iframe 内と画像内文字は対象外                                                 |
| canvas-editor / 編集値・placeholder・選択肢                                                        | 13 宣言、stage の font 継承候補        | 通常値13                                             | DOM入力は widget 内、Canvas入力は stage 直下という親の差が重要                                    |
| toolbar, separator, backdrop, grid-shell, grid-head, grid-row, tabbar, menu-surface, menuseparator | 本体に可視文字なし                     | 本体に文字なし                                       | 子 Widget の文字を対象。container/card/layout も Scene 展開を見て重複計上しない                   |

Gallery の coverage: toolbar/tbtext/splitbutton/menu は label/button/menu 系、datepicker/pagingtoolbar は label/extra-button、radiogroup/checkboxgroup は見出しと field、accordion は panel 系、messagebox は window/label/field/button、codeeditor/htmleditor は textarea、Markdown/diff/chat/terminal は document、chart/draw/gitgraph/networkgraph/mermaid は figure。`engine/src/extras.rs` の normalize/arrange と生成 Scene で追跡する。gallery の6タブだけでは一時表示・エラー・disabled・dialog の全役割を網羅しないので状態別 fixture を補う。

## 公式資料と技術前提

1. [W3C Selectors Level 4 — specificity](https://www.w3.org/TR/selectors-4/#specificity-rules): `:where()` の詳細度は0、`:is()` は引数の最大詳細度。このため reset は (0,1,1)、`.ui-button` や `.canvas-editor` は (0,1,0)。CSS の記述順だけを変えても競合を解消できない。
2. [W3C CSS Fonts — font shorthand](https://www.w3.org/TR/css-fonts-4/#font-prop): font はサイズ・太さ・字体・行高を含む shorthand。inherit を字体だけの reset と誤解しない。参照は Working Draft だが今回使う shorthand の基本動作は既存 CSS の範囲。
3. [WHATWG Canvas text styles](https://html.spec.whatwg.org/multipage/canvas.html#text-styles): ctx.font は CSS font 値を解釈し、サイズを CSS px にする。未読込フォントは fallback を使う。ctx.font に inherit をそのまま代入する方法は使えない。
4. [MDN Document.fonts](https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts): document.fonts.ready は使用中フォントのロードとレイアウト後の観測に使える。未使用の全フォントが必ずロードされる保証ではない。今回の src/index/examples/public の検索では @font-face や外部フォント読込、fonts.ready の実装は見つからず、名前の指定を実フォント導入の証拠にしない。
5. [MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio): ページズームは DPR に影響し、pinch zoom は別の拡大。Canvas のバッファ高密度化と CSS サイズを分ける。
6. [W3C SVG viewport transforms](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform): viewBox と viewport によってユーザー座標の文字が拡縮される。単なる font-size 属性比較では CSS px 一致を判定できない。
7. [MDN measureText](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText) / [TextMetrics](https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics): 文字計測は現在の font に依存。幅と実際の字形の上下境界を分けて観測する。
8. [Playwright emulation](https://playwright.dev/docs/emulation#devices): viewport と deviceScaleFactor による高密度表示を再現できる。DPR2 を実ブラウザ200%の確認に代用しない。

## 推奨設計（plan で確定する）

- 最初に reset の詳細度を調整し、既存 DOM の役割別宣言が適用される状態にする。例として reset 自体も `:where()` で低詳細度にする方法を評価する。Canvas をホストの偶発的な16/20px等へ合わせることは避け、要件にある継承原因の修正として扱う。DOM の11/12/13/20/22/30等の宣言を保持した比較画像を残す。
- runtime の既存 CSS をサイズの基準にする。必要な役割を runtime 内 CSS custom properties として表し、Canvas が stage の resolved 値を描画前に読む方法が候補。新しい DSL/テーマ API は不要。CSSとJSに二重のサイズ表を増やさない。getComputedStyle を文字ごとに実行せず、render/必要な再描画で更新し、独立 Canvas 面でも解決できる仕組みにする。
- font 計測と描画を同じ役割へ集約する。`text()` 以外の measureText、paintSurface、dialog-icons、drag ghost を漏らさない。字体・太さ・行高を無条件に全面統一せず、欠けとサイズ比較に必要な差だけを調整する。
- Grid の表示値12と編集値13を、DOM の表示役割を保つ12へ両編集経路で合わせる案を推奨。通常 field は13のまま。gridEditor によるローカル指定を使い、フィールド全体を12へ変更しない。
- 図表・文書の共有 sprites と既存倍率計算を維持する。SVG の border 内 viewport と Canvas の widget 全体を使う倍率の差を実測する。ドキュメントの字体差が欠けを起こす場合は runtime の字体を再利用する。
- 元の input/textarea/select を保持してスタイルと位置を更新する。今回のサイズ修正で作り直したり composing 中に値を上書きしたりしない。新依存追加は不要。

## 落とし穴・回避策・検証条件

| 落とし穴                             | 回避策                                           | 踏んでいないことの検証                                                                                                                        |
| ------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS宣言だけを一致と見なす            | reset を含め実効値を観測                         | 比較デモと独立runtime、host font-size 16/20pxの双方で全役割の getComputedStyle と実 fillText font を照合。ボタン・×・オーバーレイを必須にする |
| DOM 親と Canvas stage の継承差       | 文字役割を局所指定し親依存を除く                 | stage直下・panel/window内・popup・Grid editor の同じ role を比較する                                                                          |
| DPRをfont-sizeにも掛ける二重拡大     | 既存469–479行の bitmap倍率を保持                 | DPR1/2で CSS幅、bitmap幅、transform、draw font を記録。fontは同値、bitmapだけ倍率を持つ。テーマ連打・resizeでtransformが累積しない            |
| zoomで再描画されず旧DPR bitmapを使う | ResizeObserverの実際の発火と必要時の再描画を確認 | 描画済みページを100→200→100%に変更し、同じCSS幅の場合も再描画/位置/文字が一致する。DPRエミュレーションとは別記録                              |
| fontロード後もfallback描画を残す     | 使用字体ロード後に再描画、dispose時に通知を解除  | 遅延font読込、読込失敗、dispose後完了を観測。fonts.ready前後の計測と再描画を比較。フォント名列とロード済み実字体を混同しない                  |
| measureTextとdrawのfontが別値        | 同じ解決済み役割を使う                           | 左/中央/右寄せ、幅境界直前/直後、空文字・長い英数字・日本語で省略/折返しを確認する                                                            |
| SVGサイズ属性だけを見る              | viewBox→CSSpx倍率と内容viewportを換算            | 390px/desktopで document/figure のSVG CTM と Canvas transform を採取。borderの2px差も含める                                                   |
| native editorで文字サイズが跳ねる    | 通常値と編集roleを揃える                         | 通常→focus→入力→Enter確定→再編集→Escape取消。両面操作から値/stateが同期し、Grid拒否は下書きを保持する                                         |
| 再描画でIME/選択/フォーカスを失う    | control再利用、composing guard維持               | composing中にテーマ変更・resize・再描画し同じnodeとactiveElement、選択、下書きを保持。合成イベントと実IMEを別記録                             |
| 太さ/字体/line-heightの変化で欠ける  | 必要な計測・内側余白だけ調整                     | 日本語、英数字、空、長文、絵文字、複数行、22px metric、30px icon、狭いセルで画像目視。既存ellipsis/clipを超える重なりを増やさない             |
| 一時状態をcoverageから漏らす         | kindとroleと状態を台帳に記録                     | light/dark、selected/disabled、placeholder、popup、toast、dialog、media error、dragを確認。文字なし/対象外/既存差には理由を残す               |

今回に関係する並行性は fontロード完了と再描画・dispose、IME入力とテーマ/resizeの競合。暦計算・DST・通信認証・権限契約の変更は不要。カレンダーは文字役割の網羅に月移動・長い月名・月端の行数を使い、日付アルゴリズムを変更しない。

## plan への完了条件と要件への提案

1. 実測前提を最初に確立する。起動できるブラウザ経路を確認し、必要なら権限範囲内のブラウザ検証手段を準備する。利用不能なまま受け入れ合格にしない。
2. Hello World、uivolve-forms、orders/grid-lab、components、gallery を全タブ・一時状態まで inventory に入れる。独立 runtime にも DOM/Canvas の同じfixtureをマウントし比較する。
3. 各roleに DOM selector、widget key/kind、実効px、Canvasfont/transform、編集値、viewport/倍率/字体状態、差と理由を記録。実 fillText を元処理へ委譲しながら観測する。mock Canvasだけの定数検査は不要。
4. desktop/約390px、DPR1/2、100/200%相当の拡大、light/darkで代表画面と編集動作を確認。実ブラウザ拡大を実行できなければ代用方式と未確認範囲を明記する。
5. 適切な回帰確認に加え `bun run build`、`bun run check` を実施。状態/編集コードに触れれば `bun run test` の関連契約も確認。独立配布の変更があるため `bun run build:runtime` / `bun run build:minimal` の検証も計画する。整形→build→撮影の順を守る。

既存受け入れ基準は十分であり本文への追加はしない。提案として、ホストfont-size変更、SVG倍率、Grid通常/編集の境界、遅延font完了とdisposeを計画の完了条件へ具体化する。discuss の投資判断を覆す発見はない。

## このターンの検証記録

- ブランチ `gsd-lite/renderer-font-size-parity`、開始時の git status は clean。
- `gsd-lite-loop.sh --where` の成功出力は mode=repo、milestone_dir=.gsd-lite、target=.。初回の誤った相対パス実行は失敗し、PATH入口へ修正した。
- CSSプローブ: `.gsd-lite/logs/renderer-font-size-parity/scratch/turn-001-font-probe.mjs`。`node --check` 成功。実行は上記ブラウザ制約で失敗し、実測JSON・撮影は生成されていない。scratchはgitignore対象、成果物として追跡しない。
- スキル・ソース・公式資料の読取は完了。lean-ctx compose は承認不可で利用できず、通常の読取・検索で調査を継続した。これは research 成果物作成の停止条件ではない。
