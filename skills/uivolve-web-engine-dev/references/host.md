# ブラウザホストを変更する

[アーキテクチャ](../../../docs/architecture.md)で対象モジュールを選び、変更する契約だけを読む。ホスト専用スキルはまだ独立させず、この資料で扱う。

| 変更対象                          | 契約                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| host_call・HTTPメソッド・パス変数 | [現行HTTP契約](../../../docs/http-adapter.md)、[将来設計と実装状態](../../../docs/host-adapters-design.md) |
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
- 候補のエンジン/画面の取得・load成功後に置き換える。失敗時は現在の画面とテーマを保つ。WASMの再取得とページJSの再読み込みを区別する。
- OPFSは名前付き領域・ファイル排他・バッファ寿命を維持する。配信キャッシュは公開ソースのnetwork-firstで、完全なオフライン起動を保証しない。
- WebMCPは通常イベントと同じWASM検証を通す。screen token/revision、可視性、readOnly/disabled、モーダル遮断を維持する。説明メタデータを認可へ転用しない。未対応ブラウザでも通常UIを動かす。
- IME、フォーカス、非表示要素、メディアの解放に触れる変更は両描画方式で確認する。業務計算やGridの並べ替えをホストへ移さない。

- HTTPの固定宣言は画面load前、動的path/query/bodyは確定後のホストで検証する。state確定前に通信しない。host_resultのerrorは構造化オブジェクトで、旧http_resultの文字列と区別する。
- 外部操作の完了handlerが失敗してもidは消費される。onErrorのexternalResultを保持し、UIの巻き戻しを外部更新の取り消しとみなさない。
- HostEffects/HTTP以外のWebSocket・Media・Bluetooth・DB、host_event/host_closeは未実装。将来設計を現行DSLへそのまま追加しない。
