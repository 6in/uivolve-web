# 進捗

## turn 1 — research — 役割別サイズとCSS継承の競合を調査

- やったこと: local_projects（`.`）と公式資料を調査し、全共通Widgetの初期対応表、再利用設計、落とし穴ごとの検証条件を RESEARCH.md に作成。要件を保持し plan へ引き継ぐ。`bun run docs:check` 成功（既存文書のローカルリンク446件）、プローブ構文確認成功、diff whitespace確認成功。実装・build・状態回帰テスト・画像確認は未実施。
- 想定外: 高詳細度の runtime `font: inherit` が部品別宣言と Canvas editor に競合。bundled Chromium は未導入、既存スクリプトと同じシステム Chromium も snap capability 制約で起動不可。lean-ctx compose は承認不可のため読取・検索で継続した。
- やり直し: プローブ再実行1回（bundled browser未導入後にシステム経路へ切替、こちらも失敗）。ツール指定修正3回（誤った相対loopパス→PATH入口、存在しないrendererファイル名→実在するsurfaces.js、ブラウザ実行パスの変更）。調査成果物の書き直し0回。
- 次への注意: loop入口は必ず `gsd-lite-loop.sh --where`。plan はブラウザ起動経路の確認を先に置き、今回のCSS解析値を実測済みと扱わない。host font-size 16/20px、Grid表示/編集、SVG倍率、遅延fontとIME/テーマ/resize競合を完了条件へ写す。システムChromiumもこのsandboxでは起動できないため同じ起動試行を無条件に繰り返さない。

## turn 2 — plan — 実測入口から独立配布まで9タスクを確定

- やったこと: REQUIREMENTS / DECISIONS / RESEARCH、実ソースと直近2件の振り返りを読み、PLAN.template形式で9タスクを作成。DOM宣言値を保つ低詳細度reset、CSSを基準にしたCanvasサイズ解決、Grid編集12px、SVG内側倍率、font/DPR通知とdisposeの方針を確定し、全受け入れ基準・落とし穴を機械検査と目視へ対応付けた。docs:check成功（446リンク）、変更3ファイルの整形検査、diff whitespace、9タスク・turn一意性/昇順・impl状態の機械照合に成功。
- 想定外: なし。researchで記録されたブラウザ起動制約をT1の停止条件として引き継いだ。計画作成で実ブラウザ実測・画像確認・製品実装は行っていない。
- やり直し: 計画の書き直し0回、検証再実行0回。ツール指定修正1回（存在しない相対loopパスを試して失敗し、PATH上の `gsd-lite-loop.sh --where` へ修正）。
- 次への注意: loop入口は `gsd-lite-loop.sh --where` を直接使う。T1で実ブラウザ経路・日本語字体・実WASM観測を確立し、不能ならT1未完了のBLOCKEDをコミットする。新suite名とCSS property名は計画上の新設名であり既存実装ではない。整形→build→撮影を守り、実IME・実ズームと代用検査を区別する。

## turn 3 — impl — T1 実ブラウザ経路を確認しBLOCKEDを記録

- やったこと: cleanな作業ツリーで先頭の未完了T1を選択。bundled Chromium、ローカル代替実行ファイル、外部接続先の設定とlistenerを確認し、実ブラウザ利用不能の根拠と再開選択肢をBLOCKED.mdに記録。T1未完了を維持し、phase=blocked / next_command=BLOCKEDへ更新。製品実装・build・実WASM検査・画像採取は未実施。
- 想定外: bundled Chromiumは引き続き未導入。新たに見つけたVivaldiの起動もcrashpadのsetsockopt権限制約でSIGTRAP終了。外部ブラウザ接続先は未設定で確定できなかった。
- やり直し: ブラウザ経路変更1回（bundled不存在→ローカルVivaldi、起動失敗後cleanup完了）。ツール指定修正1回（誤った相対loopパス→PATH入口）。実装の書き直し0回、既存テスト期待値の変更なし。
- 次への注意: loop入口は `gsd-lite-loop.sh --where`。snapとVivaldiを同じ制約下で無条件に再試行しない。到達可能な外部Chromium接続先、または制約を解消した実行経路を確立してからT1を続ける。日本語字体・実WASM・数値・画像はまだ未確認で、T1を完了扱いにしない。

## turn 4 — impl — T1 実ブラウザ検証の入口と修正前台帳を完了

- やったこと: Claudeのサンドボックス外実行で `/usr/bin/chromium-browser`（Chromium 152.0.7977.64）の起動を確認しturn 3のBLOCKEDを解消。suite runner（`scripts/test-font-parity-browser.mjs`）、最終判定（`scripts/verify-font-parity.mjs`）、観測器とbaseline suite（`tests/browser/font-parity.mjs`）、独立UiRuntimeのfixture（`tests/browser/font-parity-harness.js` / `font-parity.html`）、runnerのプロセス試験（`tests/font-parity-runner.test.js` 10件）、台帳（`docs/renderer-font-parity.md`）を新設。実WASMのHello Worldを比較デモと独立runtimeの両方で採取し、JSON・PNG 3枚を `.gsd-lite/logs/renderer-font-size-parity/` に保存。実測差は **button「挨拶する」のみ DOM 16px/400 対 Canvas 12px/500**（`src/runtime.css:11-12` の `font: inherit` 詳細度0,1,1 が `:where(.uivolve-runtime) .ui-button` 0,1,0 に勝つ）。製品コード（src/）は未変更。
- PLAN 訂正: 検証コマンドの suite 一覧「全ターンで green」→「各ターンで green を確認するのは実装済み suite のみ（T1終了時点は baseline）。未実装 suite は非0が期待どおり。全 suite green はT9の `verify-font-parity.mjs` 一本」（根拠: 同じ節の「未実装の suite を成功として扱わず非0終了する」という決定と、実装後の `--list` と全未実装 suite が exit 1 になる実測）。ブラウザ経路も実測値（`/usr/bin/chromium-browser`、環境変数 `FONT_PARITY_BROWSER_PATH` / `FONT_PARITY_BROWSER_ENDPOINT`）でPLANに追記。
- 既存テストの期待値の変更: なし（既存テスト・既存ソースは未変更。追加は新規7ファイルのみ）。
- 想定外: (1) turn 3 の停止原因はブラウザ本体ではなくサンドボックスで、サンドボックス外実行で解消した。(2) `document.fonts.check` は未割当の私用領域コードポイントにも true を返し字体の証拠にならないため、実描画のインク幅（日本語87px 対 豆腐24px）を字体証拠に採用し、名前の指定と分けて記録した。読み込み済みfont-faceは0件でシステムのフォールバック解決と判明。(3) ホストは**フォント読込完了で再描画しない**ため（T6の対象そのもの）、baselineはステージ幅を実際に変えて再描画を起こしてから基準viewportに戻す必要があった。(4) `bunx vp dev` の実サーバーは孫プロセスで、SIGTERMはプロセスグループへ送らないと止まらない。
- やり直し: 5回。(a) 検証commandのパイプ+バックグラウンドで出力が見えず再実行1回、(b) `environment.canvas` のネスト取り違えでアサート修正1回、(c) viewport +1px ではステージ幅が変わらず再描画が起きない→±40%へ変更1回、(d) ResizeObserverが中間サイズを配信する前に戻すと再描画が起きないflakeの修正1回（reset→resize→中間フレーム待ち→戻す、の順に固定。連続4回成功を確認）、(e) `compare()` がplaceholderを除外して誤った組を比較していたので除外を撤回1回。
- 次への注意: ブラウザを使うコマンドは**サンドボックス外で実行**する（サンドボックス内はlisten/起動が権限拒否）。loop入口は `gsd-lite-loop.sh --where`。T2以降でsuiteを足すときは `SUITES` の `run` を埋めるだけでよく、未実装のまま残した suite は非0のままにする。ステージを再描画させる操作は「reset→実サイズ変更→フレーム待ち」の順を崩さない。既存ソース(src/)の最初の変更はT2のrunetime.css reset。baselineの数値はT2以降の比較基準なので取り直すときは同じ条件（1440x1000 / DPR1 / light / host 16px）で行う。

## turn 5 — impl — T2 役割別サイズの単一源とresetの修正を完了

- やったこと: `src/runtime.css` のサイズを7つの custom properties（meta9/label11/caption12/body13/close20/metric22/icon30）へ集約し、31件の `font-size` 宣言を全て参照に置換。フォーム部品の reset を `:where(.uivolve-runtime) :where(button, input, select, textarea)`（詳細度 0,0,0）へ下げた。新設 `src/font-metrics.js` の `resolveFontMetrics(stage)` はステージの computed 値から同じ変数を解決し、数値は一切持たない（CSS欠落・px以外・0以下・未マウントは例外）。`roles` suite のT2分を実装し、実WASMの `components` / `grid-lab` × ホスト16/20px × light/dark の**8ケース308件**を実測して green。修正で直った役割: button 16→12/500、panel-toggle 16→12/600、window-close 13→20、canvas-editor 16→13、menu-trigger 16→12、menu-item 13→12、grid-column 13→12、grid-cell 13→12、tab 13→12。検査コマンドは全て green（build:wasm / vitest 624件 / check / docs:check 456リンク / build / build:runtime / build:minimal / baseline / roles）。
- PLAN 訂正: (1) 親コンテキスト「panel内」は**DOM上に存在しない**（ホストはpanel/fieldsetの子をステージ直下に絶対配置し Scene に `parentKey` を付けない。根拠 `src/dom-renderer.js:262` と `parentKey` を設定するのが grid/kanban/tab/tree/menu だけであること）。必須コンテキストを `root`/`window`/`popup`/`canvas-stage`/`grid-row`/`grid-head`/`tabbar` の7つに置き換え、panel自身のboxは1役割（12px/600）として検査した。(2) 既存テストの `roles` 名指しを `SUITES` からの動的選択へ変更（下記）。
- 既存テストの期待値の変更: 1件。`tests/font-parity-runner.test.js` の「未実装suiteは非0で終了する」検査が `--suite roles` を名指ししていた。`roles` はT2から実装済みになるため、`SUITES.find((suite) => !suite.run)` で未実装の suite を動的に選ぶよう変更した（現在は `editing`）。検査の意図（未実装suiteをskipせず非0にする）は変えていない。他のテスト・期待値は未変更。
- 想定外: (1) PLANの「panel内」は実装上成立しない親コンテキストだった（上記訂正）。(2) 修正前の壊れ方は**親コンテキストごとに違った**。root直下だけがホストの16pxを継承し、window/popup/grid行の中では `.ui-widget` の13pxを継承していた。宣言値の比較では見つけられない差で、実測の必要性がそのまま裏付けられた。(3) `contextOf` を要素自身から走らせると `.ui-panel` が自分を親コンテキストと報告したため、親から走らせる形に直した（Canvasステージ直下だけはステージ自身で判定）。(4) reset を元に戻すと同じ suite が224件の不一致を出すことを確認してから本修正へ戻した（検査に歯があることの確認）。
- やり直し: 2回。(a) 必須コンテキストに `panel` を入れて実行し「panel was never measured」で失敗→実装を調べて panel 親が存在しないことを確定し、実在する入れ子コンテキストへ置き換え1回。(b) `contextOf` の自己一致の修正1回。整形のやり直し2回（`vp check` 指摘後に `vp fmt`、対象は font-parity 2ファイルと docs 1ファイル）。
- 次への注意: ブラウザを使うコマンドは**サンドボックス外で実行**する。loop入口は `gsd-lite-loop.sh --where`。T3は `src/canvas-renderer.js` の `FONT` 定数（8行目）と全ての直接 `ctx.font` / `measureText`（708/763/869/920/944/963行）を `resolveFontMetrics` へ接続する。解決は**描画開始時に1回**で、文字ごとに `getComputedStyle` を呼ばない。`roles` suite はT2が `run: runRoles` を埋めてあるので、T3は同じ suite にCanvas側の照合を足す（`harness.roles()` の返り値にCanvas観測を加えるのが素直）。親コンテキストに `panel` を要求しない。修正前の比較基準は `.gsd-lite/logs/renderer-font-size-parity/baseline.json`（修正前）と `after-t2/baseline.json`（T2後、サイズ差0件）で、**baseline.json を上書きしない**（取り直すときは `--evidence` で別ディレクトリへ）。9px・30px の役割はまだ実測できていない（Kanban / dialog の画面が必要、T5/T7）。

## turn 6 — impl — T3 Canvasの描画と計測を役割へ接続

- やったこと: `src/canvas-renderer.js` から**サイズの数値を全廃**。`FONT` 定数を削除し、`text()` の第6引数を px から**役割名**へ変更、`paint()` の先頭で `resolveFontMetrics(this.stage)` を1回だけ解決して30か所の呼び出しと直接 `ctx.font` 3か所（Grid/tab/menuの計測・buttonの中央寄せ計測・textareaの折返し計測）を同じ metrics へ接続した。`roles` suite に Canvas 側の照合を追加し、実WASM 10画面・**19ケース・Canvas描画 664件 / 36 kind**（+ T5送り39件）で green。検査コマンドは全て green（build:wasm / vitest 624件 / check / docs:check 457リンク / build / build:runtime / build:minimal / baseline（`after-t3/`、サイズ差0件・未対応付け0件）/ roles）。
- PLAN 訂正: (1) 対象ファイルに `tests/browser/font-parity-text.json` ＋ `.rhai`（実WASM補助fixture）と `tests/fields.test.js` を追加。既存アプリ画面には寄せ/空/長い英数字/幅境界/等幅が揃って出ないため（実測: 既存画面の描画は**全件 `textAlign: "left"`**。Canvas側の中央/右寄せはxの事前計算で行われており textAlign を使わない）。(2) media（image/video/iframe）の空/エラー案内は **T5 担当**として除外（Canvas 13px 対 DOM 12px、PLANのT5完了基準に明記済み）。`fieldset` は T7 送り（collapsible でタイトルが panel-toggle に移り本体の描画が空文字、canvas-renderer では panel と同一分岐）。
- 既存テストの期待値の変更: 1件。`tests/fields.test.js` の「Canvas数値テキストを右端に寄せる」検査。`text()` が px ではなく役割名を取るようになったため、偽レンダラーに `fonts`（family + `font(role, weight, family)`）のスタブを持たせ、引数 `13` → `"body"`、2回目の呼び出しに `"label"` を明示した。あわせて `context.font` の検査を**追加**した（役割→pxの解決が検査対象に入り、検査は厳しくなった）。寄せと値の非パディングという元の意図は変えていない。
- 想定外: (1) 失敗の大半は**サイズではなく描画の対応付け**が原因だった。(a) recorder のバケットは canvas 要素をキーに持つため、ケースごとに新しい canvas を作ると `label` 一致検索が**使い終わった空のバケット**を引き当て、2ケース目以降が「描画が記録されなかった」になった → 要素で引く `forCanvas(canvas)` を追加。(b) 面積の小さい順だけで対応付けると window タイトルが中の部品に、button 文字が metric に吸われた → 「文字を描く kind だけを候補にする」「ローカル変形がある描画は surface sprites のもの」「その文字列を出せる widget を優先、同じなら位置」の3段に変更。(2) `.ui-field > label` は `label.box-control`（値と同じ13px/400）にも当たっていた → `:not(.box-control)` を追加。(3) `monospace` は画面定義のフィールドではなく `codeeditor`/`htmleditor` から導出される（`engine/src/fields.rs:367`）。(4) `fieldset` は実在するが描画が空文字で内容から対応付けられない。
- やり直し: 4回。(a) recorder のバケット取得を label 一致から要素キーへ修正1回、(b) 対応付けの規則を面積順から3段規則へ作り直し1回、(c) `.ui-field > label` の選択子修正1回、(d) 補助fixtureの `monospace: true` が画面定義で拒否され `codeeditor` + `language` へ修正1回。整形のやり直し1回（`vp check` 指摘後に `vp check --fix`、対象は font-parity 2ファイルと docs 1ファイル）。
- 次への注意: ブラウザを使うコマンドは**サンドボックス外で実行**する。loop入口は `gsd-lite-loop.sh --where`。`baseline.json`（修正前）は上書きしない。T3後の baseline は `after-t3/`。T4は `roles` と同じ作りで `editing` suite の `run` を埋める（`SUITES` の該当行）。**Grid編集の12pxはまだ未実装**で、`config.gridEditor` の field は現在 paintField の `body`(13px) を通る（`CANVAS_KIND_CONTRACT` の field 各 kind が `["label","body"]` を許可しているので、T4 は gridEditor のとき `caption` を許可・要求する形に変える）。対応付けの3段規則（文字を描く kind / ローカル変形は surface / 内容一致→位置）は壊さない。新しい画面を fixture に足すときは `cases: "single"` でライト/16pxのみにする（テーマ・ホストサイズ独立性は T2 の8ケースが担保）。drag ghost の計測は「押下したまま → 計測 → Escape → 離す」の順を崩さない。
