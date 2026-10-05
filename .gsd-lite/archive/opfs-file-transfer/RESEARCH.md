# OPFSファイル転送 調査

調査日: 2026-10-04。対象: similar_oss / official_docs / local_projects。
REQUIREMENTS.md / DECISIONS.mdを優先し、要件本文は変更しない。以下はplanへの実装・検証提案であり、実ブラウザでの転送検証は実装フェーズで行う。

## 結論と参考実装

既存http adapter、ResourceClient、FileClient、OpfsDirectoryを拡張する。ブラウザ標準のFile / FormData / ReadableStream / createWritableで実現可能。新しい転送ライブラリは必須ではない。確認したOSSは転送やOPFS一般の部品であり、本プロジェクトのRhai、領域権限、JWT、世代管理、outcomeまで置換する根拠は見つからなかった。discussを覆す重大発見なし。

| 参考                                                                                                                       | 使える設計・採用判断                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [happy-opfs](https://github.com/JiangJie/happy-opfs)                                                                       | OPFSのパスAPI、writable stream、downloadFile/uploadFile、実ブラウザ試験の参考。ホスト契約まで満たすと判断せず、依存追加せず設計を参照する。                                |
| [drip-fs](https://github.com/pratherbytecraft/drip-fs)                                                                     | ストリームとOPFS staging、後始末の参考。Service Worker/ユーザー向け保存やblob fallbackは本件の領域内転送と異なる。全量メモリfallbackは採用しない。                         |
| `src/opfs.js`, `src/file-client.js`                                                                                        | 領域namespace `uivolve-web/fs/<scope>/<volume>`、相対パス制限、通常filesのロックキーを再利用。テキスト100,000 bytes/バイナリ1,000,000 bytesの既存制限は維持。              |
| `src/adapters/http.js`, `src/resource-client.js`, `src/http-policy.js`                                                     | URL範囲、許可ヘッダー、JWT/CORS、応答上限、json/text/emptyを再利用。転送は認証失敗後の再送も無効化。                                                                       |
| `src/host-effects.js`, `src/runtime.js`, `engine/src/host.rs`                                                              | transactional effect発行、世代、完了handler、既存host_callの実装箇所。host_cancelと進捗はここへ統合する。                                                                  |
| `tests/helpers/opfs.js`, `tests/host-adapters.test.js`, `tests/files-cache-rpc.test.js`, `tests/platform-features.test.js` | close確定、beforeClose gate、異常応答、世代切替試験を拡張。現在のOPFS mockはwriteごとに置換し、getFileもFileではないので、複数chunk・File/FormData試験向けの忠実性を補う。 |
| `scripts/http-server.mjs`, `examples/host-http`                                                                            | BunローカルHTTPサーバーとサンプルの雛形。現状JSON CRUDであり、転送/multipartは未対応。                                                                                     |

## 公式資料からの技術前提

- [File System Standard: createWritable](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable): streamはcloseまで既存内容を更新せず、通常一時データを使う。keepExistingData=falseで置換する。close開始後の取消は巻き戻し保証に含めない。SyncAccessHandleの直接書き込みは旧内容保持の用途に採用しない。
- [File System Standard: getFile](https://fs.spec.whatwg.org/#api-filesystemfilehandle-getfile): File取得後の元ファイル変更・削除で読み取りが失敗し得る。送信と応答処理が終わるまで領域ロックを保持する。
- [Streams Standard](https://streams.spec.whatwg.org/): reader/writeを逐次awaitしbackpressureを保つ。pipeTo利用ならsignal、容量検査、close/abort責任を明確にする。全chunk蓄積やresponse.blob()/arrayBuffer()はダウンロード本体に使わない。
- [Fetch Standard](https://fetch.spec.whatwg.org/): File/BlobとFormDataは標準本文型。転送容量は受信streamの実バイト数で判定する。Content-Encodingの復号でContent-Lengthと取得byte数は一致しないことがある。
- [XMLHttpRequest Standard: FormData](https://xhr.spec.whatwg.org/#interface-formdata): appendはentry list末尾に追加する。順序と重複nameを維持し、setやobject化を使わない。型の自動文字列化に頼らず、value:stringを事前検証する。
- [Web Locks API](https://w3c.github.io/web-locks/#api-lockmanager-request): ifAvailable=trueで非待機取得、取得不可はcallbackへnull。取得後のsignalはロックを強制解放しない。callbackの実処理promiseがsettleするまで保持する。ifAvailableとsignalの組み合わせ制約があるため、非待機取得ではsignalをrequest optionsへ渡さずcallback前後で中止を検査する。
- [Bun HTTP Server](https://bun.sh/docs/runtime/http/server): テストサーバーはstream ResponseとRequest本文を利用できる。100 MiB級試験ではmaxRequestBodySizeを明示し、サーバー側の既定制限とクライアント制限を混同しない。

## 統合の変更箇所と実装提案

1. `ResourceClient.fetch`は現在Uint8Arrayかつ1,010,000 bytes以下しか許容しない。転送専用の検証済みFile/FormData経路を追加し、一般JSON/RPC本文の上限を広げない。JWTのtoken取得と送信元チェックは既存経路を通す。3actionともretryAuthentication=false。事前のtoken取得/更新と、転送リクエストの再送を区別する。
2. `httpAdapter`は現在http.requestのみ、options/argsとも未知属性拒否。actionごとの許可属性、download=GET、upload/multipart=POST/PUT、overwrite、timeout、progressHandlerを純粋検証する。ホスト容量設定はfiniteかつ正の安全な整数、既定104,857,600 bytes。URLとヘッダー検証・応答解析は共有化する。
3. runtimeがロード時に確定したscope/files宣言を転送側へ渡す。volumeは宣言済みであることとread/readwriteをJS側でも検証する。FileClientの全量read/writeは転送に使わず、領域内handle/File/streamの限定された操作を共有する。
4. `withFileLock`は現状Web Locksで待機する。通常filesと転送の同じscope/volumeキーに非待機方式を共有する。複数volumeを重複除去・固定ソートし、全取得後に処理開始、途中競合時は取得済みロックを解放してBUSY。ロックなし環境のactive Setも同じ規約で利用する。アプリ外での直接OPFS書き換えはこの協調排他の対象外。
5. downloadはロック下で親を確認、既存entryを検査しoverwrite=falseなら副作用前に拒否。2xxだけを保存する。reader.read→容量加算→writer.writeをawait。EOFと中止状態確認後にcloseを一度だけ開始し、成功したcloseを確定点として扱う。失敗ではreader.cancelとwriter.abortを待ち、新規に作った未確定entryだけをremoveする。既存entryを失敗cleanupで削除しない。
6. uploadはgetFile().sizeを送信前に検査し、Fileをそのまま本文にする。multipartは全partsを事前検証して全ファイルサイズ合計を検査し、append順に構築する。同じファイルが複数partに登場する場合も各送信partのサイズを加算する。filename既定はpath末尾、contentType既定application/octet-stream。必要ならFileをBlob.sliceで型指定し、arrayBuffer経由で作り直さない。multipartのトップレベルContent-Typeは大文字小文字を問わず拒否し、boundaryをブラウザに任せる。
7. HostEffectsのPromise.raceはタイムアウト結果を先に返せるがadapter実処理を止めた証明にはならない。排他はadapterの実promise/cleanupに結び付け、race結果やresetによるactive Map消去で解放しない。処理状態にoperation名とgenerationを保持しhost_cancel(name)で同名を全中止する。engineの検証済みintent/effectとして追加し、host_callの戻り値と完了pendingを維持する。
8. 進捗は別経路で現在のstateへhandler適用し、completionのpendingを消費しない。単調時刻で100 ms間隔、世代と完了状態を送出時にも検査、予約通知をcancelする。handler例外はonErrorへ報告して転送を継続する。旧世代の遅延完了・進捗は破棄する。

## 落とし穴と検証方法（planの完了基準候補）

| 落とし穴                          | 回避・検証                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧ファイル消失・空の新規entry残留 | write/createWritable/read/close各段階の失敗を注入。close開始前の中止で旧bytesを比較、新規pathは不存在を確認。close中に中止しclose成功したケースは確定済み扱いで消さない。abort/remove失敗も契約内エラーとなることを確認する。 |
| cleanup前にロックが解放される     | reader/write/close/abortをgateで遅延。TIMEOUT/CANCELLEDを受けても実処理中は同領域の通常read/write/remove/転送がBUSY、settle後は成功。画面切替後の同scope/volumeでも試験。                                                     |
| 複数領域の漏れ・デッドロック      | A+BとB+A、A+A、2番目の競合を試験。全取得前にfetchせず、先に取った領域は競合後に利用可能。Web Locks実装とfallback両方、実ブラウザ2タブでも確認。                                                                               |
| 容量境界・圧縮・虚偽length        | limit-1/limit/limit+1、0 bytes、length有/無/不正、実stream超過、gzip復号後の超過を試験。超過chunkをwriteせず旧file保持。multipartは個別がlimit以下でも合計超過、同一file重複、parts32/33・files8/9を確認。                    |
| 全量読み込みの混入                | 100 MiB級をホストでchunk生成し送受信hash/size比較。転送中arrayBuffer/text/blob全量読み取りを禁止するspyとコード確認。WASM buffer/stateに本体を渡さない。ブラウザ内部のバッファ量は保証対象外。                                |
| FormDataによる型の黙認・順序喪失  | string以外のvalue、file/value両方、未知属性を送信前に拒否。文字列/ファイル混在・同名重複・Unicode filename・空文字をPOST/PUTサーバーで順序/内容/型/filename照合。                                                             |
| 権限・パス・ヘッダーの迂回        | 未宣言/read-onlyへのdownload、未宣言upload、../・絶対パス・backslash・UTF-8上限、親未作成を拒否。未許可headers/Authorization/手動boundaryとURL範囲逸脱を副作用前に拒否。                                                      |
| 認証更新後の自動再送              | JWTをホストのみで扱い、401/403とネットワーク切断で実送信回数1を確認。GET downloadでも401後に再送しない。事前token provider失敗と実送信後のunknownを区別。CORS preflight/許可応答headersを実サーバーで試験。                   |
| 成功更新をfailed扱いにする        | upload送信後切断=unknown、2xx後のJSON/UTF-8/サイズ解析失敗=committed。HostEffects最終JSONサイズ検査もcommittedを落とさない。downloadはclose前failed、確定後に副作用を否定しない。非2xxは既存HTTP契約に整合し、bodyをcancel。  |
| timeout・cancelが届かない         | 期限1/120/300秒と範囲外を検証。header待ち、reader待ち、write待ち、応答解析中で中止。同名全中止・別名継続、未知/終了済み名の安全な処理、終了一回を確認。                                                                       |
| 古い進捗・handler例外             | 毎秒10回以下、byte単調増加、total不明=null、完了後0回、世代切替時の予約通知破棄。handler例外後もclose/完了成功、完了handlerのpendingが残ることを確認。圧縮やCORSで総量が信頼できない場合はtotal=nullを提案。                  |
| mockだけでブラウザ仕様を誤認      | OPFS mockへ複数chunk、File、abort/close failureを追加。実localhostブラウザでcreateWritableとFile/FormDataを確認し、DOM/Canvas両方でdownload→小CSV加工→別名保存→複数file multipartまで実行。                                   |

## ローカル過去プロジェクトの探索

指定の`~/workspaces`を`/home/parallels/workspaces`として、OPFS/createWritable/FormData/withFileLockのJS・TS・MJS実装を検索した（node_modules/dist/target等の生成物を除外）。全ディレクトリを網羅した保証ではない。

- `/home/parallels/workspaces/fuck-cheetar/client/src/services/CacheManager.js`: OPFS capability判定とcreateWritable→write→close、finallyで進行中集合を解除する雛形。JSON全量cache・read失敗をnullにする実装なので、大容量転送やエラー契約にはそのまま使わない。
- `/home/parallels/workspaces/repounmix/src/adapters/FileSystemAdapter.ts`: FileSystemDirectoryHandle/getFile/createWritableのアダプター境界の参考。ユーザー選択のファイル領域、親自動作成、テキスト全量読込が本件と異なる。OPFS転送の置換候補ではない。
- `/home/parallels/workspaces/file-io-component`と`concept-file-test`: 名前から候補として確認したがOPFS/FormData実装の一致なし。
- 最も近い再利用元は対象リポジトリ自身の`src/opfs.js` / `src/file-client.js`とHTTP・host tests。既存設計案`docs/opfs-file-transfer-plan.md`の未確定記述より、今回の確定REQUIREMENTSを優先する。

## 要件への影響（提案のみ）

- close開始後・成功後の取消では旧file復元を保証しないことを試験でも区別する。既存合意の確定境界を具体化したものである。
- 圧縮/CORSでContent-Lengthの総量が信頼できない場合のtotal=nullと、decoded bytesでの容量判定を明文化する。
- BUSYの共有規約、cleanup完了までのロック保持、複数領域途中競合の解放を個別タスクの完了基準に含める。
- 実装順候補: 契約/engine cancel+進捗 → 共通領域排他・handle API → 認証付きFile/FormData本文 → 3転送action → ライフサイクル・異常統合 → サーバー/DOM/Canvas/100 MiB実ブラウザ・文書。これはPLANではなく依存関係の申し送り。
- 外部依存追加・要件変更・投資判断を要する発見なし。planへ遷移する。
