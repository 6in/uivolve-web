# 開発振り返り記事 根拠台帳

状態: T2原稿と掲載例の実行・実装照合を完了。図・撮影・最終判定は未実施。機械検査は文章の正しさや画像の可読性を認定しない。

## 必須8内容と主張照合

| 内容             | 主張・境界                                                               | 実物のパス/行・実行コマンド                                                                                                                                         | 結果                                |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 出発点           | 宣言的部品・配置をWebへ、完全互換ではない                                | README.md:133、docs/uivolve-port.md:61、REQUIREMENTS目的                                                                                                            | T2照合済み                          |
| 共通エンジン     | HTTP取得/JS、Rust/WASM、AST、Scene、ABI所有権/寿命                       | engine/src/lib.rs:462、src/engine.js:45-65,143、engine/src/abi.rs:39,154、docs/architecture.md                                                                      | T2照合済み                          |
| Hello World      | bind/handler、候補検証/確定、失敗時保持、両描画                          | public/screens/hello-world.json:14-33、hello-world.rhai:5-13、lib.rs:621,698-718,930-983、abi.rs:39-41、runtime.js:281-303、tests/engine.test.js:43-62,125-139      | T2照合済み・UT成功                  |
| 通信と保存       | effects/最新state、ファイル本体はJS、世代/中止/排他/close境界/タブ間制限 | lib.rs:752-773,953-977、host-effects.js:91-92,145,241-253、http-download.js:51,73-100、http.js:224-249,318、opfs.js:42-67、docs/opfs-file-transfer.md容量/保存/中止 | T2実装/契約照合済み                 |
| WebMCP           | 比較デモの自動登録、独立アプリ明示設定、API/secure context               | main.js:224、application.js:61,159、ui-tools.js:295-296、docs/webmcp.md対応環境/操作手順                                                                            | T2照合済み・最新外部仕様の調査なし  |
| WorkerモックとUT | 明示登録、固定応答/CRUD、任意コード不可、実Worker/CORS/描画との境界      | mock-api-model.js:17-19,51-110,126-200、tests/worker-mock.test.js:27-54,56-79,212以降、docs/worker-mock-api.md                                                      | T2照合済み・UT成功                  |
| AI開発の振り返り | 人の要件判断、3停止/再開、Content-Type差し戻し、履歴範囲                 | archive/opfs-file-transfer/PROGRESS.md:17,43,96,108,117,129,145-165、reflect/20261005-0843-opfs-file-transfer.md、cc25ac4のVERIFICATION                             | T2履歴照合済み                      |
| 制限と次の実験   | 実IME/アクセシビリティ/同期Rhai、CPU再描画とFPS/GPUの区別                | README.md:135、src/field-control.js、canvas-renderer.js:556、main.js:406-430、docs/testing.md                                                                       | T2境界照合済み・実IME/GPUの実測なし |

## コードと実行条件

| 抜粋                  | 完全例のパス/行                                               | import/初期化/ビルド条件・実行コマンド                  | 結果/ログ                     |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------- |
| Hello World JSON/Rhai | public/screens/hello-world.json:14-33 / hello-world.rhai:5-13 | 完全画面/initをload。scratch/turn-004-excerpts.mjs      | T2成功・turn-004-results.json |
| Worker DSL            | public/mock/orders-api.yaml:1-4,29                            | parsePackage→空seedのGET。アダプター明示登録は本文記載  | T2成功・turn-004-results.json |
| MockApiModel UT       | tests/worker-mock.test.js:3,11-14,57-60                       | 完全definition、MockApiModelとexpect。scratchで直接実行 | T2成功・turn-004-results.json |
| 実WASM UT             | tests/engine.test.js:15-40,51-60                              | WASM生成/compile/instantiate、独立インスタンス          | T2成功・turn-004-results.json |

## 画像・目視

| PNG              | 制作ソース/再作成方法・寸法 | 800px表示の日本語/矢印/切れ/重なり・本文との照合 | 結果   |
| ---------------- | --------------------------- | ------------------------------------------------ | ------ |
| architecture.png | 未記入                      | JS取得/描画とWASMの責務                          | 未生成 |
| event-flow.png   | 未記入                      | 候補と確定、両描画                               | 未生成 |
| host-effects.png | 未記入                      | 最新state、JSファイル本体/WASMメタデータ         | 未生成 |
| dom-canvas.png   | 未記入                      | 両側Hello 太郎、Canvas実画素                     | 未撮影 |

撮影環境・方法: ブラウザ/OS/URL/viewport/操作順/切り出し/サーバー終了はT4で記入。

## 数値・歴史

| 記述                           | 範囲・根拠・再集計コマンド                               | 結果                 |
| ------------------------------ | -------------------------------------------------------- | -------------------- |
| 20試行・5,697秒・約95分        | OPFS research〜verify、停止待機/reflect/ブログ作業を除く | T2照合済み・下記参照 |
| 3回のBLOCKEDと人の再開         | archive/ログ/reflectの該当記録を記入                     | T2照合済み・下記参照 |
| 868983e〜a8fdffe               | 取り込みからOPFS完了、commit以前を創作しない             | T2照合済み・下記参照 |
| 実行モデル・トークン内訳・費用 | 未取得を0/無料と扱わない                                 | T2照合済み・下記参照 |

## 検査と最終判定

- 計数規則: Unicodeコードポイント（絵文字の各コードポイントを含む）。タイトル/見出し/本文/画像説明を含み、フェンス、参考リンクH2以降、画像alt、リンクURL、装飾、空白/改行を除外。同じcountTextで各節とAI節を計数。
- 対応形式: インラインMarkdownリンク、H2の固定順。PNGは通常の非インターレース8bit灰色/RGB/灰色alpha/RGBAをCRC/展開/フィルター復元/寸法検査。画像の内容・可読性は別途目視。
- T1自己検証: `bun .gsd-lite/logs/development-retrospective-blog/scratch/turn-003-selfcheck.mjs`、23項目成功。ソースと結果は同scratchのturn-003-selfcheck.mjs / turn-003-selfcheck.log。6,000/8,000とAI20/30%の境界、絵文字、リンク/コード/alt除外、各節/AI共通計数、未完成complete失敗、PNG破損、外部画像/欠落リンク/余計なファイル拒否を確認。最終コマンド順と終了7で後続停止はspawn代替で確認し、実ビルド/撮影の成功とは扱わない。
- T1実検査: `bun install --frozen-lockfile`、`bun run check`（217ファイル整形、92ファイルlint）、`bun run docs:check`（445リンク/56文書）成功。`bun scripts/check-retrospective.mjs --stage draft`は本文がT2のためENOENT/終了1を確認。実記事のdraft/diagrams/completeと最終判定はT2〜T5で実行する。
- 最終判定: `bun scripts/verify-retrospective.mjs`。依存→WASM→対象UT→check→docs:check→build→complete→撮影。各コマンドと出力/終了コードをlogsへ保存。
- 最終字数/AI比率、check/docs:check/UT/build/complete/撮影結果、残留制限: 未実施。

## T2実行・主張の照合（turn 4）

- 本文: blog/uivolve-web-retrospective/index.md。必須8節を固定順で確認。数値検索では画面数を掲載せず、約95分をOPFSの試行内所要として限定。未記録値、互換性、最新ブラウザ仕様の保証を追加していない。
- JSON抜粋: public/screens/hello-world.json:14-33の3部品へ全属性を照合。Rhai抜粋: public/screens/hello-world.rhai:5-13の一致を確認。完全ファイルのinitと初期stateを使う。
- 実WASM抜粋: tests/engine.test.js:15-40のreadFile/compile/instantiate/WasmEngine準備、51-60のイベント列とScene確認に対応。scratchで記事のjavascriptフェンスを直接実行し、入力のみ不変、太郎、Scene、空白Worldを確認。
- Worker YAML抜粋: public/mock/orders-api.yaml:1-4,29に対応する空seedの縮小例。parsePackageとMockApiModelで実行しGET ordersが空配列。完全例のseed2件と混同しない説明を本文に付記。
- モデルUT抜粋: tests/worker-mock.test.js:3,11-14,57-60に対応。完全definitionを読み、記事フェンスの直接requestを実行して2件。TestWorkerのメッセージUTと実ブラウザ/Worker/CORS/描画の境界を明記。
- 実行証跡: scratch/turn-004-excerpts.mjsとturn-004-results.json（本文からの抽出・実行と再集計）。準備はbun install --frozen-lockfile成功（96 installs/172 packages、変更なし）、bun run build:wasm成功（4464 KiB）。bunx vp test run tests/engine.test.js tests/worker-mock.test.jsは2ファイル16件成功（379ms）。既存テストの期待値変更なし。
- 状態保持: lib.rs:930-983は検証とeffects準備の後にstate/uiと依頼を確定。失敗handlerは候補を確定しない。abi.rs:39-41とruntime.js:281-303ではload成功後に現在画面へ切替。完了handlerはlib.rs:770のself.state.clone()。Hello World独自の失敗処理として説明していない。
- 履歴: git log --oneline a8fdffeで868983e〜a8fdffeを照合。06f42f5→5dcac12→3a1eeca→eb9a0a2→04b3118→8a9d943→cd92375→OPFSの順序を確認。
- 3停止: b88009e/T1（localhost・書式）、4c48111/T10（Rhai CSV）、f869419/T11（認証fixture）。再開2f79ddf/f746985/5089c6dとarchive PROGRESSを照合。verify差し戻しは別工程のcc25ac4→178a9ea→67c1d8f。git show cc25ac4:.gsd-lite/VERIFICATION.mdのF1で全試験成功と既定Content-Type欠落の期待値を確認。
- 時間: .gsd-lite/logs/opfs-file-transfer/turns.jsonlのphase research/plan/impl/verifyを抽出しduration_sを合計。scratchのassertで20試行/5697秒（94.95分）、reflect・待機・ブログ作業除外を再確認。model空、usageはtotal_tokensのみ。費用/出力/キャッシュ未記録を0にしない。
- 本文draft: 7926字、AI1979字、24.968%（共通Unicode計数）。4画像は相対参照と日本語alt/説明のみ配置、画像実物はT3/T4。docs入口はT5。未生成画像をcomplete成功と扱わない。
- 人の考察: AI節の契約から期待値を決める提案と次の実験は筆者の考察として記述。記録にない感情・発言の引用はなし。

- T2追加検査: bun run check成功（218ファイル整形、92ファイルlint、cargo fmt check）、bun run docs:check成功（445ローカルリンク/56文書）、git diff --check成功。整形後のdraftと掲載断片を再確認。diagrams/complete/build/撮影の最終検証はT3〜T5で実施する。
