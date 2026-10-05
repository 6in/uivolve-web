# 開発振り返り記事 根拠台帳

状態: T1で照合欄を準備。本文・図・撮影・最終判定は未実施。機械検査は文章の正しさや画像の可読性を認定しない。

## 必須8内容と主張照合

| 内容             | 主張・境界                                                               | 実物のパス/行・実行コマンド | 結果   |
| ---------------- | ------------------------------------------------------------------------ | --------------------------- | ------ |
| 出発点           | 宣言的部品・配置をWebへ、完全互換ではない                                | 未記入                      | 未確認 |
| 共通エンジン     | HTTP取得/JS、Rust/WASM、AST、Scene、ABI所有権/寿命                       | 未記入                      | 未確認 |
| Hello World      | bind/handler、候補検証/確定、失敗時保持、両描画                          | 未記入                      | 未確認 |
| 通信と保存       | effects/最新state、ファイル本体はJS、世代/中止/排他/close境界/タブ間制限 | 未記入                      | 未確認 |
| WebMCP           | 比較デモの自動登録、独立アプリ明示設定、API/secure context               | 未記入                      | 未確認 |
| WorkerモックとUT | 明示登録、固定応答/CRUD、任意コード不可、実Worker/CORS/描画との境界      | 未記入                      | 未確認 |
| AI開発の振り返り | 人の要件判断、3停止/再開、Content-Type差し戻し、履歴範囲                 | 未記入                      | 未確認 |
| 制限と次の実験   | 実IME/アクセシビリティ/同期Rhai、CPU再描画とFPS/GPUの区別                | 未記入                      | 未確認 |

## コードと実行条件

| 抜粋                  | 完全例のパス/行 | import/初期化/ビルド条件・実行コマンド | 結果/ログ |
| --------------------- | --------------- | -------------------------------------- | --------- |
| Hello World JSON/Rhai | 未記入          | 入力のみ不変、太郎押下、空白World      | 未実施    |
| Worker DSL            | 未記入          | 明示アダプター登録                     | 未実施    |
| MockApiModel UT       | 未記入          | 描画なし、実Workerとの差               | 未実施    |
| 実WASM UT             | 未記入          | WASM生成と独立インスタンス             | 未実施    |

## 画像・目視

| PNG              | 制作ソース/再作成方法・寸法 | 800px表示の日本語/矢印/切れ/重なり・本文との照合 | 結果   |
| ---------------- | --------------------------- | ------------------------------------------------ | ------ |
| architecture.png | 未記入                      | JS取得/描画とWASMの責務                          | 未生成 |
| event-flow.png   | 未記入                      | 候補と確定、両描画                               | 未生成 |
| host-effects.png | 未記入                      | 最新state、JSファイル本体/WASMメタデータ         | 未生成 |
| dom-canvas.png   | 未記入                      | 両側Hello 太郎、Canvas実画素                     | 未撮影 |

撮影環境・方法: ブラウザ/OS/URL/viewport/操作順/切り出し/サーバー終了はT4で記入。

## 数値・歴史

| 記述                           | 範囲・根拠・再集計コマンド                               | 結果   |
| ------------------------------ | -------------------------------------------------------- | ------ |
| 20試行・5,697秒・約95分        | OPFS research〜verify、停止待機/reflect/ブログ作業を除く | 未照合 |
| 3回のBLOCKEDと人の再開         | archive/ログ/reflectの該当記録を記入                     | 未照合 |
| 868983e〜a8fdffe               | 取り込みからOPFS完了、commit以前を創作しない             | 未照合 |
| 実行モデル・トークン内訳・費用 | 未取得を0/無料と扱わない                                 | 未照合 |

## 検査と最終判定

- 計数規則: Unicodeコードポイント（絵文字の各コードポイントを含む）。タイトル/見出し/本文/画像説明を含み、フェンス、参考リンクH2以降、画像alt、リンクURL、装飾、空白/改行を除外。同じcountTextで各節とAI節を計数。
- 対応形式: インラインMarkdownリンク、H2の固定順。PNGは通常の非インターレース8bit灰色/RGB/灰色alpha/RGBAをCRC/展開/フィルター復元/寸法検査。画像の内容・可読性は別途目視。
- T1自己検証: `bun .gsd-lite/logs/development-retrospective-blog/scratch/turn-003-selfcheck.mjs`、23項目成功。ソースと結果は同scratchのturn-003-selfcheck.mjs / turn-003-selfcheck.log。6,000/8,000とAI20/30%の境界、絵文字、リンク/コード/alt除外、各節/AI共通計数、未完成complete失敗、PNG破損、外部画像/欠落リンク/余計なファイル拒否を確認。最終コマンド順と終了7で後続停止はspawn代替で確認し、実ビルド/撮影の成功とは扱わない。
- T1実検査: `bun install --frozen-lockfile`、`bun run check`（217ファイル整形、92ファイルlint）、`bun run docs:check`（445リンク/56文書）成功。`bun scripts/check-retrospective.mjs --stage draft`は本文がT2のためENOENT/終了1を確認。実記事のdraft/diagrams/completeと最終判定はT2〜T5で実行する。
- 最終判定: `bun scripts/verify-retrospective.mjs`。依存→WASM→対象UT→check→docs:check→build→complete→撮影。各コマンドと出力/終了コードをlogsへ保存。
- 最終字数/AI比率、check/docs:check/UT/build/complete/撮影結果、残留制限: 未実施。
