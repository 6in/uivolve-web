# PLAN — development-retrospective-blog

- 作成: 2026-10-05 / gsd-lite-plan
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md
- 実行設定: subagents=auto、fix_round=0。対象は `.`、成果物と状態は `.gsd-lite/`。

## 検証コマンド

以下はリポジトリルートで実行する。既存コマンドの根拠は `package.json` のscripts、`README.md:28-32`、`vite.config.js:14-16`。T1で記事限定の検査を作り、未完成段階は明示したstageで検査する。

```bash
bun scripts/check-retrospective.mjs --stage draft
bun scripts/check-retrospective.mjs --stage diagrams
bun scripts/check-retrospective.mjs --stage complete
bunx vp test run tests/engine.test.js tests/worker-mock.test.js
bun run docs:check
bun run check
```

- 環境の初期化（テストの前に毎回）: DB初期化は不要。依存は既存lockfileに従う `bun install --frozen-lockfile`、WASMを使う検査の前は `bun run build:wasm`。最終判定はこれらを自分で実行する。ブラウザ撮影前は管理文書の整形を完了してから `bun run build` → `bun run preview`（127.0.0.1:4174、strictPort）を使用する。
- 最終判定コマンド1本: **`bun scripts/verify-retrospective.mjs`**（T1で作成）。順番は依存確認 → WASMビルド → 対象UT → check → docs:check → 本番build → 記事complete検査 → 記事限定ブラウザ撮影確認。ブラウザ工程はT4で作る `scripts/capture-retrospective.mjs` を使い、なければ失敗する。最終ログは `.gsd-lite/logs/development-retrospective-blog/`、要約・主張照合・目視結果は `.gsd-lite/BLOG-EVIDENCE.md` に保存する。
- クリーンなcheckoutで最終判定できるよう、検査2本と記事専用撮影1本を追跡する。図の制作ソースはscratchに置き、最終判定ではコミット済みPNGを検査する。汎用ブラウザ回帰基盤へ拡張しない。
- 手動判定: PNGを実際に開き、幅約800pxでも日本語・矢印・両側の挨拶を確認する。主張→実物照合表と8必須内容のレビュー結果をBLOG-EVIDENCEへ記録する。機械検査の成功だけで文章の正しさ・画像の可読性を認定しない。

## 追従先チェックリスト

| 変更の種類                   | 直す場所                                                    | 確かめ方                                                                                                           |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 記事の追加                   | `blog/uivolve-web-retrospective/index.md`、`docs/README.md` | 入口は `../blog/uivolve-web-retrospective/index.md` への1件のみ。docs:checkと記事内全ローカルリンクの存在確認      |
| 図・画面画像の追加           | 記事直下のPNG4枚、index.mdの参照/alt/説明                   | 直下は確定5ファイルのみ、画像参照は各1件の `./<name>.png`。PNG署名・デコード・寸法、外部/絶対/data画像の不在、目視 |
| 記事の名前・数値・コード変更 | index.md、`.gsd-lite/BLOG-EVIDENCE.md`                      | 主張→根拠パス/行または実行コマンドを同時更新。`rg -n '21                                                           | 12  | 5,697 | 5697 | 95  | 20  | 無料 | FPS | GPU | 既定 | デフォルト' blog/uivolve-web-retrospective/index.md` をレビューし、古い画面件数や未記録値の断定を0件にする |
| 文書/検査スクリプト変更      | 変更したMarkdown/JS、PROGRESS、state                        | 適用対象をvp fmtで整形してからcheck。既存契約・API・ランタイム・archive/reflect/logsは保持                         |

今回登録・権限・画面catalogの変更はない。画面件数を記事に載せないので既存READMEの件数整理は対象外。件数記述の実在確認は `rg -n '21|12' README.md`（RESEARCHの古い文書コピーの注意）。

## Tasks

- [x] T1: 記事限定検査と根拠台帳の準備
  - 完了基準: `scripts/check-retrospective.mjs` と `scripts/verify-retrospective.mjs` を追加。stage draftは本文/例/字数/相対ローカルリンクを、diagramsはさらに3図を、completeはさらに画面PNG/直下5ファイル/入口1件を検査する。未完成成果物をcompleteで成功させない。記事の各節とAI節を同じUnicode計数器で集計し6,000〜8,000字・AI20〜30%を判定する。フェンス、末尾「参考リンク」以下、画像alt、リンク先URL、装飾を除外し、空白/改行はレイアウトとして除外する。境界6,000/8,000、絵文字、リンク、コード、altの小さな自己検証をscratchで行い結果を保存。恒久的な実装コピーのテストは増やさない。最終判定は非0終了を伝播し元の失敗とcleanup失敗を分け、環境準備/全コマンド順を確認できる。BLOG-EVIDENCEに8内容/コード/画像/数値の照合欄を用意する。
  - 対象: `scripts/check-retrospective.mjs`、`scripts/verify-retrospective.mjs`、`.gsd-lite/BLOG-EVIDENCE.md`、scratchの自己検証/ログ
  - 依存: なし
  - 並列サブ作業: なし（検査仕様とstageを共有する）

- [x] T2: 根拠付き日本語原稿と実行確認済みの短い例を書く
  - 完了基準: 必須8内容を下記順で書き、ポップなです・ます/絵文字/短い段落、6,000〜8,000字、AI節20〜30%をdraft検査で満たす。Hello WorldのJSON/Rhai、Worker DSL、モデルUT/実WASM UTを「抜粋」・import/初期化/ビルド条件・完全な例へのリンク付きで載せる。`tests/engine.test.js` と `tests/worker-mock.test.js` をWASM生成後に実行し、掲載断片もscratchで実行、結果と対応行を台帳へ保存。入力時は挨拶不変、押下でHello 太郎、空白のみはHello Worldを確認。本文の失敗時保持/最新state/effects確定を実物へ照合し、Hello Worldに失敗処理が実装されているとは書かない。現行APIの説明と歴史的説明を区別し、3停止とContent-Type差し戻し・時間集計の根拠を台帳へ記録する。画像の相対参照/alt/説明はこの段階で配置し、未生成画像はdraft段階のみ許す。
  - 対象: `blog/uivolve-web-retrospective/index.md`、`.gsd-lite/BLOG-EVIDENCE.md`、scratchの例実行/結果
  - 依存: T1
  - 並列サブ作業: なし（同じ本文と根拠台帳を一貫して編集する）

- [ ] T3: 責務・イベント・非同期effectsの日本語技術図を制作
  - 完了基準: architecture/event-flow/host-effectsの3PNGを直下に生成しdiagrams検査が通る。日本語フォントを実描画で確認、画像を開いて欠字/切れ/重なり/矢印を点検、本文幅で読める結果を台帳へ記録。architectureはHTTP取得→JS→共通Rust/WASM→Scene→DOM/Canvas、event-flowはどちらの入力→候補state/Rhai→検証→確定→両描画、host-effectsはhost_call→確定effects→JS/アダプター→host_result→最新stateのhandler→再検証を表す。取得/描画APIをWASMが直接呼ぶ矢印を作らない。候補stateと確定state、JS側のファイル本体経路とWASM側のメタデータを区別する。制作ソース/手順をscratch、再作成情報と画像寸法を台帳へ保存する。ブラウザ描画を使う際はplaywright-skillを先に読む。
  - 対象: 記事直下の`architecture.png`、`event-flow.png`、`host-effects.png`、`.gsd-lite/BLOG-EVIDENCE.md`、scratchの図制作ソース
  - 依存: T2
  - 並列サブ作業:
    - A: architecture図（対象: architecture.png、scratchのarchitecture制作ソース）
    - B: event-flow図（対象: event-flow.png、scratchのevent-flow制作ソース）
    - C: host-effects図（対象: host-effects.png、scratchのhost-effects制作ソース）
    - 親が根拠・PNGを確認し台帳を更新する。

- [ ] T4: 実Hello WorldのDOM/Canvasを操作して撮影
  - 完了基準: playwright-skillを読み、管理文書整形→build→previewの順で実ブラウザを起動。`/pages/hello-world` で実入力・押下し、両方式にHello 太郎が表示されることを確認した比較領域のdom-canvas.pngを保存する。DOM起点とCanvas起点を順に操作し双方の更新、入力のみで挨拶を変えないこと、空白入力のWorldも確認して撮影時は太郎へ戻す。Canvasの実画素を開いて読む。DOM文字列やstate検査だけで合格にしない。実在UIの切り出しに留め、合成しない。ブラウザ/OS/URL/viewport/操作/撮影方法、PNGの目視、サーバー終了を台帳/PROGRESSに記録。記事専用の `scripts/capture-retrospective.mjs` は最終判定でも使えるようサーバー起動/終了を自己管理し、失敗時cleanupが元の失敗を隠さない。秘密情報のない名前とlocalhostのみ使用する。
  - 対象: `blog/uivolve-web-retrospective/dom-canvas.png`、`.gsd-lite/BLOG-EVIDENCE.md`、`scripts/capture-retrospective.mjs`、scratchの撮影ログ
  - 依存: T3
  - 並列サブ作業: なし（同じサーバー・画面・撮影証跡を扱う）

- [ ] T5: 文書入口・推敲・最終要件照合を仕上げる
  - 完了基準: docs/READMEに記事入口を1件追加しcomplete検査が成功。本文と図を照合して全8内容、ABI所有権、WebMCPの比較デモ/独立アプリ条件、明示モック登録/任意コード不可、UTと実Worker/CORS/描画の境界、ファイル本体をWASMへ渡さないこと、世代/中止/cleanupまでの排他/close後の境界/タブ間保証の制限を台帳の照合表で全て確認する。出発点・履歴範囲・20試行5,697秒・3停止/人の再開・verify差し戻し・未記録モデル/費用・実IME/アクセシビリティ/同期Rhai/GPU/CPU計測の境界を確認する。`bun scripts/verify-retrospective.mjs` をクリーンな準備から実行、check/docs:check/対象UT/build/記事/撮影の結果、字数とAI比率、実PNGの目視、未取得/残留制限をBLOG-EVIDENCEに保存。適用文書を整形して再撮影の前に完了させる。verifyが独立して再実行できるコマンド/手順を揃える。
  - 対象: `docs/README.md`、記事直下5ファイル（必要な推敲のみ）、`.gsd-lite/BLOG-EVIDENCE.md`、検査スクリプト（必要な修正のみ）
  - 依存: T4
  - 並列サブ作業: なし（最終整形・画像・計数の順番を固定する）

## 決めた事項

1. 見出しは出発点→共通エンジン→Hello World→通信と保存→WebMCP→WorkerモックとUT→AI開発の振り返り→制限と次の実験→参考リンク。AI計数区間は「AI開発の振り返り」見出しから次の同階層見出しの直前。参考リンクは末尾で集計対象外（根拠: REQUIREMENTSの必須内容/分量、DECISIONSの文体・分量）。
2. 記事直下はindex.mdとPNG4枚のみ、図は既存ブラウザ/HTML/SVGで制作し依存追加なし。技術図は横幅1600px程度を制作目安にし、800px表示で目視確認して調整する（根拠: REQUIREMENTSの配置/可読性、RESEARCHの制作手段）。
3. API表記は実物に合わせる。JSは `load(screen, script, descriptors = {}, options = {})`、`dispatch(target, payload = {})`、`layout(width)`（`src/engine.js:70,89,143`）。モデルは `request({ method, path, query = {}, body })`（`src/mock-api-model.js:126`）。新APIの名前は発明しない。
4. Hello WorldのitemId/bind/handlerはpublicの実物を抜粋し、Rhaiのtrimは `name.trim();` を保持する。全量掲載ではなく前提と完全例への相対リンクを添える（根拠: `cat public/screens/hello-world.json`、`cat public/screens/hello-world.rhai`、`tests/engine.test.js`のHello World試験）。
5. 状態確定は `engine/src/lib.rs:598,718,930-982`、host完了の最新stateは同`:752-773`、候補画面は`engine/src/abi.rs:39`と`src/runtime.js:263-361`、ASTは`engine/src/lib.rs:462`を照合する。ABIは`src/engine.js:56-65`を根拠にメモリ所有権/寿命を説明する。
6. WebMCP起動登録は`src/main.js:224`、独立アプリの明示有効化は`src/application.js:61,159`。ツール名/数を載せるなら`src/ui-tools.js`の宣言をimplで再確認する。画面件数は掲載しない。
7. 転送の説明は世代ガード`src/host-effects.js:145,253`、GET reader/writable/close`src/adapters/http-download.js:51,73,99-100`、FormData`src/adapters/http.js:249`、排他`src/opfs.js:42-67`と現行契約で照合する。非同期/境界/異常系の担い手はT2の既存例確認とT5の主張照合であり、新たな全I/O試験は作らない。
8. 数値は記事自身の作業を加算せず、既存OPFSログのresearch/plan/impl/verifyのみ再集計する。履歴は868983e〜a8fdffe。出力/キャッシュ/費用/正確な実行モデルの未取得を0と書かない（根拠: RESEARCH履歴・数字、DECISIONS根拠・履歴）。

## メモ

### 分割とゴール逆算

受け入れ基準を計数/配置/ローカルリンク/本文8内容/例/履歴/図3種/画面撮影/入口/整形/最終照合に分解し、同じファイル群を扱う本文と例、図3種、最終推敲と入口を統合した。5タスクで各1ターンを上限にし、小規模な文書マイルストーンを8件へ水増ししない。

| RESEARCHの落とし穴                  | 検証するタスク                                     |
| ----------------------------------- | -------------------------------------------------- |
| 古い文書のコピー                    | T2主張台帳、T5の現行実物照合/件数rg                |
| 架空/実行不能例                     | T2対象UTと掲載抜粋実行、T4実入力                   |
| 確定前/失敗時保持の誤解             | T2既存試験/実装照合、T3候補/確定図、T5照合         |
| 非同期結果を古いstateへ戻す         | T2最新state/世代説明、T3effects図、T5排他/中止境界 |
| 大容量転送を全量WASM読込と説明      | T2ホストの経路、T3図、T5現行契約                   |
| モックを任意サーバー/認証検証と表現 | T2DSL/UTの準備条件と限界、T5照合                   |
| WebMCPが全アプリで既定有効          | T2条件分離、T5実装照合                             |
| 字数の測定が曖昧                    | T1境界/Unicode計数、T2/T5計数結果                  |
| docs:checkのみで画像検査扱い        | T1記事限定検査、T3/T4目視、T5complete              |
| 図・比較画像が読めない              | T3フォント/縮小目視、T4Canvas実画素、T5再確認      |
| 整形/HMRで撮影が崩れる              | T4/T5整形→本番build→preview、cleanup別記           |
| 能力・時間の過大評価                | T2履歴根拠/集計、T5制限/数値照合                   |

### 参考実装の「盗める点」採否

| 提案                                                | 採否と理由                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Hello Worldを1本の流れにしてpublic/既存UTを再利用   | 採用。前提付き実例と失敗時保持を混同せず説明できる                |
| Worker DSLとモデルUT/実WASM UTの短い抜粋            | 採用。描画なし検証と実Workerの境界を具体化できる                  |
| 既存playwrightとHTML/SVGによるPNG                   | 採用。日本語を確認でき、新依存が不要                              |
| test-transfer-browserの起動/終了管理                | 採用。撮影中断時の後始末と元のエラーを保持する                    |
| check-docsだけで記事検査                            | 却下。`scripts/check-docs.mjs:19`の走査はblogを含まない           |
| verify-transferの全I/O/ブラウザ回帰を丸ごと実行     | 却下。文書マイルストーンは対象UT/記事撮影を最終コマンドへ限定する |
| 原子的確定/世代/cleanupまでの排他の堅牢性を説明する | 採用。単純化で契約を落とさずT2/T3/T5で照合する                    |

### 直近reflectの提案

reflectは `.gsd-lite/reflect/20261005-0843-opfs-file-transfer.md` の1件のみ（`rg --files --hidden .gsd-lite/reflect`）。

| 次回への提案                           | 採否と理由                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| PATH上のloop入口へ統一                 | 採用。次から `gsd-lite-loop.sh --where` のみ使用。本turnは誤った相対パス呼出しを1回修正した       |
| 起動前localhost/checkプローブ          | 一部採用。T1でcheck、T4で実起動/終了。discuss/allowlistの変更は本スコープ外                       |
| サーバーfixtureとWASMサンプルを分離    | 今回は不採用。転送fixtureを追加せず、既存UT/記事例をT2に集約                                      |
| 整形→ブラウザ起動・cleanup失敗を別記   | 採用。T4/T5に固定。認証fixtureを使わない                                                          |
| Content-Type期待値を要件から決定       | 説明へ採用。verify差し戻しの要件/試験の違いをT2/T5で照合。API試験追加は範囲外                     |
| blocked/やり直し/未取得値/見出し一意性 | 採用。記事の数字をT2/T5で照合し、各turnはPROGRESS見出しとstate.turnを確認。ループ実装変更は範囲外 |

図生成/ブラウザ依存で新たな判断が必要な障害が起きた場合は未検証を保持してBLOCKEDへ記録する。記事の機械検査結果、主張台帳、画像目視の三者を最終合否の根拠とする。
