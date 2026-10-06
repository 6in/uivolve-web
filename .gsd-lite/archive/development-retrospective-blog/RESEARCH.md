# RESEARCH — development-retrospective-blog

調査: 2026-10-05、turn 1。対象は `local_projects` / `.` のみ。外部検索・他プロジェクトの調査はしていない。REQUIREMENTS / DECISIONSは変更しない。重大な判断変更を必要とする発見はなく、planへ渡す。

## 参考実装と記事の根拠

以下はすべてリポジトリルートからのパス。記事から参照するときは `../../` を付ける。

| 主張・素材      | 正準の根拠                                                                                                                                  | 記事で使う内容                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 出発点・制限    | `README.md`、`docs/uivolve-port.md`、`REQUIREMENTS.md`                                                                                      | 宣言的な部品・配置をWebへ移す試作。完全互換や性能改善を動機として創作しない                                                            |
| 共通エンジン    | `docs/architecture.md`、`engine/src/lib.rs`、`engine/src/abi.rs`、`src/runtime.js`                                                          | Rustがstate・イベント・layout・Sceneを扱い、JSが取得とブラウザAPI・描画を担当                                                          |
| JSON/YAML・Rhai | `src/package-format.js`、`engine/src/lib.rs:368,455-462`                                                                                    | YAMLはホストでJSON相当へ変換。RhaiはWASM内でASTへコンパイルして同期実行。RhaiからWASMバイナリを生成しない                              |
| Hello World     | `public/screens/hello-world.json`、`public/screens/hello-world.rhai`、`tests/engine.test.js:43-62`                                          | nameInputのbind=name、helloButtonのhandler=sayHello、greetingLabelのbind=greeting。trimは変数を更新し、空白のみならWorld               |
| 検証と確定      | `engine/src/lib.rs` のdispatch、`engine/src/abi.rs` のload、`src/runtime.js` のcompile/load                                                 | stateのコピーへ入力とRhaiを適用し、状態・UI・effectsの準備が通ってから確定。候補load失敗時は前の画面が残る                             |
| 配置・描画      | `src/dom-renderer.js`、`src/canvas-renderer.js`、`src/field-control.js`                                                                     | layout(width)はScene生成。DOMはkeyで要素更新、Canvasは面を再描画し入力時はネイティブ欄を併用。幅が違えば座標も違う                     |
| ABI             | `src/engine.js:45-67`、`engine/src/abi.rs`、`docs/architecture.md`                                                                          | UTF-8 JSON、入力はfinallyで解放、応答はエンジン所有で次requestまで有効。呼出後のmemory.bufferを参照                                    |
| effectsとホスト | `engine/src/host.rs`、`src/host-effects.js`、`src/adapters/http.js`、`docs/http-adapter.md`                                                 | host_callのintentを状態検証後にkind=host/v=1のeffectsへ。登録アダプターへ配送しhost_resultから最新stateのhandlerへ                     |
| 保存・RPC・転送 | `docs/files-cache-rpc.md`、`docs/opfs-file-transfer.md`、`src/adapters/http-download.js`、`src/opfs.js`、`tests/opfs-file-transfer.test.js` | 一般FileBytesの容量と大容量転送を区別。GET reader→OPFS writable、uploadはFile、multipartはFormData。ファイル本体はWASM/stateへ通さない |
| WebMCP          | `docs/webmcp.md`、`src/main.js:224`、`src/application.js:61,159`、`src/ui-tools.js`、`tests/webmcp.test.js`                                 | 比較デモは起動時登録。独立アプリはwebmcp:true。5共通ツール、人と同じWASMイベント、token/revision/可視性の検査                          |
| Workerモック    | `docs/worker-mock-api.md`、`public/mock/orders-api.yaml`、`public/screens/worker-orders.yaml`、`public/screens/worker-orders.rhai`          | 画面とは別DSLのcollections/routes/固定response/CRUD。workerMockAdapterを明示登録。画面のhost_callは維持してホスト接続を実HTTPへ切替    |
| 描画なしUT      | `src/mock-api-model.js`、`tests/worker-mock.test.js:56-79`、`tests/engine.test.js:15-62`                                                    | MockApiModel.requestと実WASMのload/dispatch/layout。Worker代替のTestWorkerはメッセージ契約の試験で、実ブラウザの代替保証にはしない     |
| AI運用          | `.agents/skills/gsd-lite-*/SKILL.md`、`.gsd-lite/archive/opfs-file-transfer/`、`.gsd-lite/reflect/20261005-0843-opfs-file-transfer.md`      | discuss→research→plan→impl→verify→reflect。要件・停止時の判断は人、記録と検証をループが引継ぐ                                          |

## 再利用する設計・制作手段

- 記事はHello Worldの1本の流れを主軸にする。JSONは3部品の必要部分、RhaiはsayHelloを抜粋し、完全なファイルへリンクする。現行publicのHello WorldはJSON/Rhaiであり、別のskills同梱YAMLと混同しない。
- UT例は `tests/engine.test.js:51-60` のload→名前入力→押下→state/Scene検証と、`tests/worker-mock.test.js:57-62` のモデルCRUDを短く抜粋できる。import・初期化・WASMビルド条件を省いた断片には「抜粋」と準備条件を添える。モデル例でrequestヘルパーを使うなら定義も含めるかmodel.requestへ明示する。
- Worker定義は `public/mock/orders-api.yaml` または現行ガイドのcollections/seed/GETルートを縮める。画面DSLのoperationsとモックDSLのroutesを別々に示す。接続設定だけではモック登録にならない。
- 新規ライブラリは不要。既存playwrightとHTML/SVGのブラウザ描画で日本語技術図をPNG化できる。図の制作ソースと検査スクリプトは `.gsd-lite/logs/development-retrospective-blog/scratch/` に置く。記事の確定出力は直下5ファイルだけ。
- 撮影の参考は `scripts/test-transfer-browser.mjs` のChromium起動/終了方法、`index.html` の `#dom-stage` / `#canvas-stage`、`src/main.js` の両面への接続。実撮影前にplaywright-skillを読む。サーバーはREADMEのbuild→preview、Hello Worldは `/pages/hello-world`。画像内で両方の結果が見えるよう比較領域を切り出す。撮影はimplで行い、このresearchでは実施していない。
- 技術図の矢印はarchitectureで「画面/Rhaiの取得→JS→共通WASM→Scene→DOM/Canvas」、event-flowで「どちらの入力→共通イベント→候補state/Rhai→検証→確定→両面」、host-effectsで「host_call→確定effects→ホスト/アダプター→host_result→最新stateのhandler→再検証」とする。WASMが直接fetchやCanvas APIを呼ぶ矢印を描かない。

## 履歴・数字の確定範囲

- 起点はroot commit `868983e`（2026-10-02、既存試作の取り込み）。初期試作以前の制作過程は記録から分からない。終点は `a8fdffe`（2026-10-05、OPFS reflect）。今回の `f473db8` 以降は振り返る開発実績へ含めない。
- 技術の経緯は `06f42f5` Hello World、`5dcac12` HTTP effects、`3a1eeca` YAML/保存/型、`eb9a0a2` files/cache/RPC、`04b3118` 共通runtime/独立アプリ、`8a9d943` host adapters、`cd92375` Workerモック、OPFSマイルストーンへつなげられる。コミット以前の動機や心情は補わない。
- `.gsd-lite/logs/opfs-file-transfer/turns.jsonl` をJSON解析し、phaseがresearch/plan/impl/verifyの行だけを再集計した。20試行、5,697秒（94.95分）、内訳1/1/16/2。全21行の最後はreflectであり集計から除外する。停止・対話の待機時間と開発全体の時間は含まない。
- BLOCKEDはturn3/T1（localhost EPERMと既存文書書式）、turn13/T10（Rhai CSV加工）、turn15/T11（ブラウザ認証fixture）の3回。根拠はarchiveのPROGRESSとreflect、必要なら `git show b88009e:.gsd-lite/BLOCKED.md` / `4c48111` / `f869419` の当時ファイルで追える。再開は `2f79ddf` / `f746985` / `5089c6d`。
- `cc25ac4` の当時VERIFICATIONを確認。全試験成功でも、本文uploadのContent-Type欠落を既存試験が期待し、合意したapplication/octet-stream既定値を満たしていなかった。F1 `178a9ea` → verify `67c1d8f` で修正・確認。これはBLOCKEDではなくverify差し戻し。
- ログのmodelは空、usageにtotal_tokensのみある。出力/キャッシュ内訳・費用は未記録。stateのClaude用model値は実行モデルの証拠にならない。リトライ0/progressed=trueも停止・手戻り0を意味しない。

## 落とし穴と検証方法（planの完了基準へ）

| 落とし穴                             | 回避策                                            | 踏んでいないことの確認方法                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 古い文書のコピー                     | 現行実装・契約を優先                              | READMEには画面数21と古い12が混在。testingには恒久ブラウザscriptなしとあるが転送scriptは実在。件数は避けるかcatalog/実ファイルから数え、記事の主張をパス別照合表へ記録                                                    |
| 例が架空/実行不能                    | publicの例と既存UTを再利用                        | WASM生成後 `bunx vp test run tests/engine.test.js tests/worker-mock.test.js` など対象試験で確認。掲載断片の準備条件・対応行・出力を保存し、名前入力では挨拶を変えず押下でHello 太郎、空白だけでWorldを確認               |
| 確定前と失敗時の保持を誤解           | candidate stateと確定stateを描き分ける            | lib.rs dispatch/commit、ABI load、runtime compileを照合。失敗したRhai/候補loadの保持は対応する既存試験を参照し、Hello World自体に未実装の失敗処理を足した説明にしない                                                    |
| 非同期結果を古いstateへ戻す          | pending id・最新state・ホスト世代を説明           | host.rs/HostEffectsと既存host/転送試験を照合。画面切替後の通知破棄、中止後のcleanup完了までの排他、close後の取消不能を区別                                                                                               |
| 大容量転送を全量WASM読込と説明       | File/reader/writable/FormDataのJSホスト経路を図示 | http-download/http/opfs実装と転送契約を照合。一般FileBytes上限は緩和されない。Web Locks未対応時はタブ間保証がなく、サーバー更新巻戻しも保証しない                                                                        |
| モックを任意サーバー/認証検証と表現  | 宣言DSL・メモリCRUDの最小版と明記                 | model/worker/adapterを照合。Worker更新は送信後取消されない。UTのTestWorkerと実Worker、実HTTP/CORS、描画の確認を別の検証対象として記述                                                                                    |
| WebMCPが全アプリで既定有効という断定 | demoと独立アプリの条件を分ける                    | main.jsの起動登録とapplication.jsのwebmcp===trueガードを照合。対応API/secure context/未対応時UI維持、5ツールの名称をui-toolsと照合。外部仕様の現況は今回調査していない                                                   |
| 字数の測定が曖昧                     | 記事限定の計数をplanで固定                        | コードフェンス・末尾参考リンク一覧・画像alt・URL・Markdown装飾を除き、見出し/本文/図説明をUnicode文字数で数える。Python lenまたはJS Array.fromを使用し絵文字をUTF-16長で数えない。6,000〜8,000、AI部分2〜3割の結果を保存 |
| docs:checkだけで画像を検査した扱い   | 記事を個別検査                                    | check-docs.mjsはdocs/skills等のみ走査しblog内部を対象にしない。docs入口リンクに加え記事内相対リンク/4画像の存在・PNG形式・直下5ファイルを別検査。外部URL/data URI/絶対画像パスがないことを確認                           |
| 図・比較画像が読めない               | 日本語フォントを確認し実PNGを開く                 | 3図の欠字/重なり/切れ/矢印、本文幅縮小の可読性を目視。実Hello Worldを入力・押下し両面の同じ結果を撮影。Canvasの画素内容も確認し、stateだけで成功扱いにしない                                                             |
| 整形/HMRで撮影が崩れる               | 文書整形後にサーバー起動                          | 前回reflectを採用。管理文書整形→撮影、cleanup失敗は元の失敗と別記。記事限定確認とcheck/docs:checkを行い、全ブラウザ回帰を追加しない                                                                                      |
| 能力・時間を過大評価                 | 観測と考察を分ける                                | 8必須内容の照合表に実IME/アクセシビリティ/同期Rhai/GPU未対応、CPU再描画≠FPS、時間の対象、3停止と人の再開判断を含める。数字の時点とログ集計条件を添える                                                                   |

## 要件への影響・planへの提案

要件変更は不要。上記の「どう確認するか」を既存受け入れ基準の実行方法としてplanに採用することを提案する。特に記事限定検査（字数・直下5ファイル・4画像参照・ローカルリンク）、主張→根拠の照合表、対象UT、実画面撮影と目視の証跡を最終判定へ固定する。記事入口は `docs/README.md` に1件追加する。API変更・追加依存・外部公開は行わない。
