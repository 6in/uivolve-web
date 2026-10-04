# PLAN — opfs-file-transfer

- 作成: 2026-10-04 / gsd-lite-plan
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md
- 状態: 初回計画。subagents=auto、fix_round=0（state.json）。コード実装は次ターンから。

## 検証コマンド

以下は対象リポジトリのルート `.` で実行する。

```bash
bun run build:wasm
bunx vp test run tests/opfs-file-transfer.test.js
bun run test:rust
bun run test
bun run check
bun run docs:check
bun run build
```

- 環境の初期化（テストの前に毎回）: WASMを変更した場合とクリーンな検査開始時は `bun run build:wasm`。各試験は固有scopeのOPFS、独立サーバー、認証設定、fake timerを作りfinallyで破棄する。共有データを前回実行から継承しない。DB初期化は不要。
- 最終判定コマンド1本: `bun run verify:transfer`（T1で追加）。子プロセスを逐次実行し、WASM生成→全JS/Rustテスト→check→docs:check→build→T11のlocalhost実ブラウザ試験を走らせ、どれか失敗/ブラウザ未実行なら非0。ビルド済み成果物や稼働済みサーバーを前提にしない。サーバー/ブラウザは起動しfinallyで終了する。
- 根拠: package.jsonのscripts（`rg -n 'build|test|check' package.json`）、vite.config.js:16の `tests/**/*.test.js`。既存の全検査用単一コマンド/ブラウザrunnerは未登録なのでT1/T11で補う。

## 追従先チェックリスト

| 変更の種類                 | 直す場所                                                                                                                                                                                                                                                                   | 確かめ方                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| cancel/進捗ABI・Rhai登録   | engine/src/host.rs、engine/src/lib.rs、engine/src/abi.rs、src/engine.js、src/runtime.js、src/host-effects.js、tests/abi.test.js、tests/host-adapters.test.js                                                                                                               | `rg -n 'host_result                                                                   | host_call     | host_cancel | host_progress' engine/src src tests` と実WASM試験 |
| http action・ホスト設定    | src/adapters/http.js、src/resource-client.js、src/runtime.js、src/application.js、docs/http-adapter.md、docs/runtime-distribution.md                                                                                                                                       | `rg -n 'http.request                                                                  | http.download | http.upload | http.multipart                                    | transferLimit' src docs examples tests` と起動設定試験 |
| 通常filesと転送の排他/権限 | src/opfs.js、src/file-client.js、src/runtime.js、engine/src/files.rs、tests/helpers/opfs.js、tests/files-cache-rpc.test.js、docs/files-cache-rpc.md                                                                                                                        | Web Locks/fallback競合試験。cacheの別namespaceの既存挙動も退行確認                    |
| 現行API・制限の説明        | README.md、docs/README.md、docs/http-adapter.md、docs/files-cache-rpc.md、docs/authentication.md、docs/screen-format.md、docs/architecture.md、docs/runtime-distribution.md、docs/host-adapters-design.md、docs/opfs-file-transfer-plan.md、docs/platform-features-plan.md | `rg -n 'multipart.*未対応                                                             | 巨大ファイル  | 15秒        | 15 秒                                             | 900,000                                                | 1,000,000 | 100,000 | 最大.*件 | 最大.*本' README.md docs skills` を全件レビューし、転送にも適用と読める古い記述0件。一般HTTP/Rhaiの既存制限は明示して保持 |
| AI向け参照・文書検証       | skills/uivolve-web-app-dev/references/http.md、references/io-extensions.md、skills/uivolve-web-engine-dev/references/host.md、scripts/check-docs.mjs、tests/documented-http.test.js                                                                                        | docs:check、文書例実行、必要なskills:bundle後の差分確認。無関係な部品件数は変更しない |
| サンプル/サーバー/配布     | examples/opfs-file-transfer/、scripts/transfer-server.mjs、package.json、tests/distribution.test.js、docs/operations.md                                                                                                                                                    | DOM/Canvasの入口URL、サーバー停止、ビルド配布先、既存HTTPデモの退行試験               |

探索根拠: `rg -n 'host_call|http.request|15秒|未対応|本|件' README.md docs/http-adapter.md skills`、`rg -n 'host_result|completeHost' src/engine.js engine/src/abi.rs`。転送action数を記した既存文書はない。文書の数値一覧は上記rgを最終タスクで再走査する。

## Tasks

- [x] T1: 転送試験の基盤と最終判定runner
  - 完了基準: OPFS mockが複数chunkを追記し、getFileがFile互換、close確定/abort破棄、0 bytesと段階別失敗・gateを表現する。既存files testsが通る。verify:transferが子検査の失敗を伝搬し、未完成のブラウザ試験を成功扱いにしない。初期runner試験で順序/非0/cleanupを検証。
  - 対象: tests/helpers/opfs.js、tests/opfs-file-transfer.test.js（新規）、scripts/verify-transfer.mjs（新規）、package.json
  - 依存: なし
  - 並列サブ作業: A: OPFS mockと基盤試験（tests/helpers/opfs.js、tests/opfs-file-transfer.test.js）。B: runnerとscript登録（scripts/verify-transfer.mjs、package.json）。

- [x] T2: host_cancelとpendingを消費しない進捗のengine契約
  - 完了基準: host_cancel(name)をtransactional intentとして登録し、handler/state検証失敗時は中止effectも発行しない。host_callの戻り値/上限を維持。未知・終了済み操作名のcancelは安全なno-op、同名全中止/別名継続を配送側で可能にする。options.progressHandlerの存在をload前に検証。新host_progress ABIは進行中id/操作に照合し最新stateでhandlerを実行、完了pendingを保持し、終了後・不正payloadを拒否する。handler失敗でstate/effectsを確定しない。実WASMとRustで検証。
  - 対象: engine/src/host.rs、engine/src/lib.rs、engine/src/abi.rs、src/engine.js、tests/host-adapters.test.js、tests/abi.test.js
  - 依存: T1
  - 並列サブ作業: なし（ABIとengine登録が依存）。

- [ ] T3: 共有領域ロックと転送用handle境界
  - 完了基準: 通常filesと転送が同じscope/volumeキーを使用。複数領域を重複除去/固定順で非待機取得し競合はBUSY。A+B/B+A/A+A/第2領域競合で処理未開始と取得済み解放を確認。Web LocksはifAvailableを使用しsignalをrequest optionsへ併用しない。fallbackも同じ規約、実promiseのsettleまで保持。限定handle/File/writable取得はrelativePath、宣言権限、親事前mkdirを守り、既存全量read/write上限を変更しない。
  - 対象: src/opfs.js、src/file-client.js、tests/opfs-file-transfer.test.js、tests/files-cache-rpc.test.js
  - 依存: T1
  - 並列サブ作業: なし（共通lockとhandle境界の同一ファイル）。

- [ ] T4: 認証付きFile/FormData専用送信経路
  - 完了基準: 一般fetchのUint8Array制限を維持し、転送専用の検証済みBlob/File/FormData経路を追加。既存URL/JWT/CORS/許可origin経路を共有し転送は3方式ともretryAuthentication=false。401/403/切断で送信1回、事前provider/refresh失敗はnot-started、送信後不明はunknownを区別できる。認証更新で古いpolicyを使わずトークンをstate/エラーへ漏らさない。ResourceClient/refresh既存試験も通る。
  - 対象: src/resource-client.js、tests/resource-client.test.js、tests/resource-refresh.test.js、tests/opfs-file-transfer.test.js
  - 依存: T1
  - 並列サブ作業: なし

- [ ] T5: HTTP転送宣言・引数・ホスト設定の純粋検証
  - 完了基準: http.download/upload/multipart登録。download=GET、upload/multipart=POST/PUTのみ。未知属性、型不正、未宣言volume、read領域download、パス/URL範囲/headers迂回をfetch/OPFS作成前に拒否。fileとpartsは要件の形、valueはstringのみ、file/value両方を拒否。parts32/33、files8/9、UTF-8 args上限を検証。overwriteはdownloadのみ、期限1/120/300秒と範囲外、ホスト容量設定の正の安全整数/既定値を試験。http.request既存契約を維持。
  - 対象: src/adapters/http.js、src/runtime.js、src/application.js、tests/opfs-file-transfer.test.js、tests/host-adapters.test.js、tests/distribution.test.js
  - 依存: T2、T3、T4
  - 並列サブ作業: なし（準備contextの受け渡しが依存）。

- [ ] T6: downloadのストリーム保存と原子的確定
  - 完了基準: 2xxのみreader.read→容量加算→writer.writeを逐次awaitし全量blob/arrayBuffer/textを使わない。既定上書き拒否/許可、親不足、0 bytes、limit-1/limit/limit+1、Content-Length有/無/不正/虚偽、gzip復号後超過を検証し超過chunkを保存しない。close前の通信/OPFS失敗・中止では旧bytes保持、新規未確定entryのみ削除。createWritable/read/write/close/abort/remove失敗をError/DOMException全体として扱い、代表と列挙外の例外を注入。reader.cancel/writer.abort/cleanupを待ち、close成功後の取消で確定fileを消さない。成功dataはstatus/headers/body:null/files。
  - 対象: src/adapters/http.js、src/opfs.js、tests/opfs-file-transfer.test.js（必要なら内部転送helperを新規分離）
  - 依存: T5
  - 並列サブ作業: なし

- [ ] T7: 本文/multipart送信と応答outcome
  - 完了基準: Fileを本文、FormData.appendをparts順で使用し全量JS読み込みなし。POST/PUT、複数ファイル、同名項目、Unicode filename、空文字、既定filename/Content-Typeを照合。合計容量は重複file partも加算し超過を送信前拒否。大小文字を問わずmultipartトップContent-Type手動指定拒否。json/text/empty、status/許可headers/filesを返す。送信後切断=unknown、2xx後JSON/UTF-8/容量解析失敗=committed、非2xxのbodyをcancelし既存HTTP結果契約に整合。lockは応答処理終了まで保持。
  - 対象: src/adapters/http.js、tests/opfs-file-transfer.test.js
  - 依存: T6
  - 並列サブ作業: なし（action共有応答処理）。

- [ ] T8: 配送の中止・期限・進捗・世代を接続
  - 完了基準: operation名/generation/実処理promiseを保持し同名全cancel・別名継続。転送既定120秒/options.timeoutを適用し既存一般host既定15秒を維持。header待ち/reader待ち/write待ち/応答解析待ちのTIMEOUT/CANCELLEDと完了一回を検証。reset/disposeで中止し旧世代の完了/進捗を破棄。受信進捗operation/transferred/totalは単調・100ms以上間隔、信頼できないtotal=null。予約通知を終端/世代変更で取消し、handler例外をonErrorへ報告して転送継続。pendingを消費せず最終JSON検査でもcommittedを保持。
  - 対象: src/host-effects.js、src/runtime.js、tests/host-adapters.test.js、tests/runtime.test.js、tests/opfs-file-transfer.test.js
  - 依存: T2、T7
  - 並列サブ作業: なし（配送/実行contextの相互依存）。

- [ ] T9: 異常・並行性の統合回帰
  - 完了基準: 実WASM→HostEffects→HTTP→OPFSでwrite/close/abort gate中にTIMEOUT/cancel/画面置換を起こし通常read/write/removeと重複転送がBUSY、実処理settle後のみ利用可能を確認。2つのruntimeでも同scope排他。close中取消・成功closeの確定outcome、cleanup失敗、handler失敗、認証変化、最終応答上限、頻度境界を交差試験。WASM bufferとstateに本体を通さず全量読込spyが転送中呼ばれない。既存テスト全体が通る。
  - 対象: tests/opfs-file-transfer.test.js、tests/host-adapters.test.js、tests/files-cache-rpc.test.js、tests/runtime.test.js、発見した問題のsrc/engine修正
  - 依存: T8
  - 並列サブ作業: A: 排他/cleanup統合（tests/opfs-file-transfer.test.js）。B: 世代/handler回帰（tests/runtime.test.js、tests/host-adapters.test.js）。実装修正は親が統合。

- [ ] T10: テストサーバーとDOM/Canvasサンプル
  - 完了基準: localhostサーバーにGET、POST/PUT本文、POST/PUT multipart、遅延/容量/非2xx/認証/不正応答のfixtureを用意。受信hash/sizeとmultipart entry順序・同名値・filename/typeを返しサーバー試験で一致確認。maxRequestBodySizeは大容量検証を許可。DOM/Canvas共通YAML/Rhaiでdownload→小CSV加工→別名保存→複数file multipartを表示し、中止/受信進捗/送信中・完了/失敗を扱う。100 MiBはホストがchunkで直接生成しRhai既存上限を迂回拡張しない。既存CRUDサーバーを維持。
  - 対象: scripts/transfer-server.mjs、tests/transfer-server.test.js、examples/opfs-file-transfer/、package.json
  - 依存: T9
  - 並列サブ作業: A: サーバーと試験（scripts/transfer-server.mjs、tests/transfer-server.test.js）。B: サンプル（examples/opfs-file-transfer/）。親がpackage.json登録と結合確認。

- [ ] T11: 再実行可能な実ブラウザ検証
  - 完了基準: localhost実OPFS/File/FormDataを使いDOM/Canvas両方で一連のCSV操作を実行。100 MiB級のGET/本文/multipartをsize/hash照合し全量JS読込禁止を確認。CORS preflight/Authorization/Expose-Headers、上書き/容量/中止/画面切替、2タブWeb LocksのA+B/B+A競合と解放を自動検証。ブラウザ/サーバー/OPFS試験namespaceを終了時cleanup。実行不能は非0、mockだけで合格しない。runnerに組み込み。
  - 対象: scripts/test-transfer-browser.mjs、tests/browser/opfs-file-transfer.mjs、scripts/verify-transfer.mjs、package.json（必要なブラウザ開発依存）、examples/opfs-file-transfer/の試験入口
  - 依存: T10
  - 並列サブ作業: なし（browser runner/fixtures連携）。

- [ ] T12: 現行契約文書と最終判定
  - 完了基準: docs/opfs-file-transfer.mdへ起動設定/YAML/Rhai/API/エラー/確定境界/容量/中止/進捗/サンプル/テスト実行を実装通り記載し、追従先の古い転送不可記述を更新。文書例を実WASMで実行。追従先rgの数値を全件照合。`bun run verify:transfer`をクリーン開始で合格し、実ブラウザ環境・コマンド・結果を記録。一般JSON/Rhai/Workerの上限と期限を維持し、アップロードbyte進捗やブラウザ内部buffer保証を追加しない。
  - 対象: docs/opfs-file-transfer.md、追従先チェックリストの文書/skills、tests/documented-transfer.test.js、scripts/check-docs.mjs、必要な最終修正
  - 依存: T11
  - 並列サブ作業: A: 利用契約/入口文書（docs/opfs-file-transfer.md、README.md、docs/README.md、docs/http-adapter.md、docs/files-cache-rpc.md、docs/runtime-distribution.md）。B: ABI/認証/設計履歴/skills（残りの追従先文書）。C: 文書例と検証（tests/documented-transfer.test.js、scripts/check-docs.mjs）。親が統合して最終判定。

## 決めた事項

1. 新公開ホスト容量設定は `transferLimit`（bytes、既定104857600）、UiRuntime/createRuntime/createApplicationからHTTPへ渡す。画面に容量引き上げ権限を渡さない。根拠: REQUIREMENTS「ラウンド2」、src/runtime.js:80-85とsrc/application.js:78-79,121-122の起動設定経路。既存設定は追加ではなく実物照合して拡張する。
2. 操作の `options.timeout` は秒（1〜300、既定120）、`options.overwrite` はbool（downloadのみ、既定false）。`options.progressHandler` はdownloadのみのRhai handler名。既存一般host timeoutのms単位と区別する。根拠: REQUIREMENTSラウンド3/4、src/host-effects.js:33,49-51、src/adapters/http.js:7。
3. cancelはhost_cancel(name)→独立control effect、進捗は `host_progress` ABIとJS `progressHost` で配送し、完了consumeを使わない。id/operation/generationで照合する。根拠: engine/src/host.rs:34,90,114、engine/src/lib.rs:721-741、engine/src/abi.rs:77-87、src/engine.js:91-92。control effectの内部kindは `host_cancel`、runtimeでhostと一緒にHostEffectsへ送る。
4. ロックキー `uivolve-web:file:<scope>:<volume>`、OPFS namespace `uivolve-web/fs/<scope>/<volume>`、scopeはロード済みscreen.idを再利用。prepared contextへfiles宣言とscopeをsnapshotで渡し置換前に純粋検証。根拠: src/file-client.js:25-30、src/runtime.js:275-287。storage/cacheのnamespaceは別として維持。
5. downloadはclose成功を確定点とし、close開始前の失敗/取消では旧内容を保持。closeが開始した後の巻き戻しは保証しないが確定済みファイルをcleanupで削除しない。実処理/cleanupがsettleするまでロックを保持。根拠: REQUIREMENTSラウンド3、RESEARCH統合提案5/7、src/opfs.js:96-109、src/host-effects.js:115-137。
6. 成功filesはpart順（download/uploadは1件）、重複送信partも別metadata/容量加算。filenameは末尾、typeはapplication/octet-stream。totalはContent-Encoding/CORS等で信頼できなければnull。根拠: REQUIREMENTS API/最終合意、RESEARCH統合提案6/8。
7. 例外処理はJS Error/DOMException全体を境界で契約化し、途中処理失敗でcleanupを省略しない。NotFoundErrorだけを不存在判定に使い他の例外を不存在として隠さない。根拠: src/opfs.js:135-152、RESEARCH落とし穴表。

## メモ

- 受け入れ条件をまず契約/保存/排他/認証/通知/サンプル/大容量/文書へ分解し、同一境界の実装と試験を統合して12タスクにした。転送実装と競合統合/実ブラウザは切り戻し単位が異なるため分離。PLANターンではサブエージェント不要、implでは列挙した独立所有範囲をsubagents=autoで利用できる。
- `.gsd-lite/reflect/` の直近2件: ファイルなし（`rg --files --hidden -g '.gsd-lite/reflect/**'`）。採用/不採用の提案なし。

| RESEARCHの盗める点                       | 採否と理由                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| happy-opfsのpath/writable/実ブラウザ試験 | 採用: T3/T6/T11で標準APIを利用。依存追加は却下: ホスト契約を置換しない                            |
| drip-fsのstaging/cleanup                 | 採用: T6のclose/abort責任。全量memory fallback/SW保存は却下: 領域内ストリーム契約に不要           |
| 既存FileClient/OpfsDirectory             | 採用: T3、権限/namespace/lockを共有。全量read/write転送利用は却下: 大容量と旧上限の分離           |
| HTTP/ResourceClient/host実装             | 採用: T2/T4/T5/T8。転送時認証再送は却下: 結果不明と二重送信防止                                   |
| mock/gate/既存HTTPデモ                   | 採用: T1/T9/T10。mockのみの合格は却下: T11で標準挙動を実測                                        |
| ローカルCacheManager / FileSystemAdapter | capability/finallyとhandle境界のみ採用: T3/T6。read失敗null化/親自動作成/全量textは却下: 契約違反 |

| RESEARCH落とし穴              | 機械検証するタスク |
| ----------------------------- | ------------------ |
| 旧ファイル消失・新規entry残留 | T6、T9、T11        |
| cleanup前のロック解放         | T3、T8、T9         |
| 複数領域漏れ/デッドロック     | T3、T9、T11        |
| 容量境界/圧縮/虚偽length      | T5、T6、T7、T11    |
| 全量読込/WASM経由             | T6、T7、T9、T11    |
| FormData型/順序               | T5、T7、T10、T11   |
| 権限/パス/ヘッダー迂回        | T3、T5、T11        |
| 認証更新後の再送              | T4、T7、T11        |
| 成功更新outcome               | T7、T8、T9         |
| timeout/cancel不到達          | T2、T8、T9、T11    |
| 古い進捗/handler例外          | T2、T8、T9         |
| mockだけの仕様誤認            | T1、T10、T11       |

ゴール逆算: GET保存=T6、本文/multipart=T7、通常files共有排他=T3/T9、認証=T4、cancel/期限/進捗/画面切替=T2/T8/T9、サーバーとDOM/Canvas/100MiB=T10/T11、契約文書と全退行=T12。全受け入れ基準に担当と検証を割り当て済み。
