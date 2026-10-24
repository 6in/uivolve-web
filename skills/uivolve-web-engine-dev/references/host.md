# ブラウザホストを変更する

[アーキテクチャ](../../../docs/architecture.md)で対象モジュールを選び、変更する契約だけを読む。ホスト専用スキルはまだ独立させず、この資料で扱う。

| 変更対象                          | 契約                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| host_call・HTTPメソッド・パス変数 | [現行HTTP契約](../../../docs/http-adapter.md)、[将来設計と実装状態](../../../docs/host-adapters-design.md) |
| WebWorker・宣言的モックAPI        | [WorkerモックAPI](../../../docs/worker-mock-api.md)                                                        |
| 配信・自然なURL・WASM更新         | [運用](../../../docs/operations.md)、[JSON/YAML・URL](../../../docs/platform-features.md)                  |
| JWT・CORS・refresh token          | [認証](../../../docs/authentication.md)                                                                    |
| HTTPの依頼と完了                  | [HTTP](../../../docs/tutorial-http-grid.md)                                                                |
| IndexedDB/OPFS                    | [JSON保存](../../../docs/platform-features.md)、[ファイル・キャッシュ](../../../docs/files-cache-rpc.md)   |
| Protobuf・Unary RPC・バイナリABI  | [RPC](../../../docs/files-cache-rpc.md)                                                                    |
| WebMCP登録と操作                  | [WebMCP](../../../docs/webmcp.md)                                                                          |

- 現行WASMはブラウザimportなし。I/Oは検証済みeffectsをホストが実行し、id付き完了を最新stateへ戻す。画面切替の中止と世代判定で古い応答を破棄する。
- 共通の取得・状態・描画・effectsは`src/runtime.js`、独立アプリの設定・ルーティングは`src/application.js`、デモの一覧・編集・計測は`src/main.js`。デモ用DOMや画面カタログを共通ランタイムへ持ち込まない。CSSは`src/runtime.css`で表示領域へ限定する。[配布契約](../../../docs/runtime-distribution.md)を維持する。
- HTTP、保存、ファイル、RPC、ダイアログの準備と容量確認が通ってからstate/effectsを確定する。新しい依頼種別ではホスト側の振り分けと完了ABIも接続する。
- JWTはResourceClient/TokenSessionが保持し、WASM、state、Sceneへ渡さない。CORSはサーバーの設定も必要。更新・401再試行・同時要求・中止の契約を維持する。
- JWTモードの送信先は`url.origin`で判定する。`allowedOrigins`のoriginにはJWTを付ける。`publicOrigins`のoriginへはJWTを付けず、トークン取得も401時の更新もしない。両方にあるoriginは`allowedOrigins`を優先する。どちらにも宣言の無いoriginは送信前に拒否する。その拒否の文言はoriginと許可リストだけを含み（パス・query・トークンを含めない）、画面・Rhai・テーマ・WASM・`app.json`の取得、Rhaiの宣言GET、Unary RPC、ホストが直接呼ぶ`resources.fetch / text / bytes`にはそのまま届く（宣言GET・RPCではRhaiの結果を通じてstateに残りうる）。汎用の文言になるのはHTTPアダプターと転送だけ。
- 候補のエンジン/画面の取得・load成功後に置き換える。失敗時は現在の画面とテーマを保つ。WASMの再取得とページJSの再読み込みを区別する。
- OPFSは名前付き領域・ファイル排他・バッファ寿命を維持する。配信キャッシュは公開ソースのnetwork-firstで、完全なオフライン起動を保証しない。
- WebMCPは通常イベントと同じWASM検証を通す。screen token/revision、可視性、readOnly/disabled、モーダル遮断を維持する。説明メタデータを認可へ転用しない。未対応ブラウザでも通常UIを動かす。
- IME、フォーカス、非表示要素、メディアの解放に触れる変更は両描画方式で確認する。業務計算やGridの並べ替えをホストへ移さない。

- HTTPの固定宣言は画面load前、動的path/query/bodyは確定後のホストで検証する。state確定前に通信しない。host_resultのerrorは構造化オブジェクトで、旧http_resultの文字列と区別する。HTTPの`error`には、応答を受け取った失敗ならopt-inと関係なく`status`が載り、操作が`errorBody: "json"`を宣言したときだけ`body`または`bodyError`が載る（両者は排他で、該当しないキーは存在しない）。接続の`clientErrorOutcome: "failed"`は4xx（408・429を除く）の`outcome`を`failed`にする接続側だけの設定で、画面DSLのoptionsには書けない。
- 外部操作の完了handlerが失敗してもidは消費される。onErrorのexternalResultを保持し、UIの巻き戻しを外部更新の取り消しとみなさない。
- HostEffects/HTTP以外のWebSocket・Media・Bluetooth・DB、host_event/host_closeは未実装。将来設計を現行DSLへそのまま追加しない。

- [OPFS転送](../../../docs/opfs-file-transfer.md)はFile/FormData専用送信とResponse reader→OPFS writableの逐次保存。一般JSON/Rhai/Workerの上限を拡張せず、本体をWASM/stateへ通さない。通常filesと同scope/volumeの共有ロックを使い、実処理とcleanupのsettleまで保持する。
- host_cancel(name)はtransactional intentで、handler/state検証失敗時にcontrol effectを発行しない。同名全中止、未知・終了済み名はno-op。host_progress/progressHostはid/operationを照合して最新stateへ適用し、完了pendingを消費しない。配送では世代・100ms以上の間隔・終端通知取消を維持する。アップロードbyte進捗は提供しない。
