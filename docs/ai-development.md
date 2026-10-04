# AI開発エージェントの参照入口

状態: 現行実装の読み方。対象はこのチェックアウト、外部配布では同梱された版の契約を使う。必要な機能の行だけを選び、無関係な文書をまとめて読み込まない。

## 作業と根拠を選ぶ

| 作業                             | 入口                                                                                   | 決めるもの                                            |
| -------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 既存機能で画面を作る             | [app-devスキル](../skills/uivolve-web-app-dev/SKILL.md)、[画面契約](screen-format.md)  | YAML/JSON、Rhai、stateSchema                          |
| 独立アプリの起動設定             | [共通ランタイム](runtime-distribution.md)                                              | CSS/JS/WASMの配置、app.json、登録済みアダプターと接続 |
| メソッド・パス変数・本文付きHTTP | [HTTP契約](http-adapter.md)                                                            | ホスト登録＋operations.options＋host_callのargs       |
| 固定URLのJSON GET                | [GETチュートリアル](tutorial-http-grid.md)                                             | requests＋http_get                                    |
| サーバーなしの固定応答・CRUD     | [WorkerモックAPI](worker-mock-api.md)                                                  | 独立モックDSL＋workerMockAdapter＋既存operations      |
| 日付、金額、Unicode加工          | [日付](date-functions.md)、[小数](decimal-functions.md)、[文字列](text-functions.md)   | 引数の型、単位、丸め、上限                            |
| 保存、OPFS、Unary RPC            | [保存・型](platform-features.md)、[ファイル・RPC](files-cache-rpc.md)                  | 依頼宣言、完了handler、JSON/bytes寿命                 |
| 部品やエンジンを変更             | [engine-devスキル](../skills/uivolve-web-engine-dev/SKILL.md)、[構成](architecture.md) | Rust、ABI、両レンダラー、対応テスト                   |
| 画面を操作する                   | [WebMCP](webmcp.md)                                                                    | 可視key/actions、最新token/revision                   |

文書の種別を区別する。契約文書は使えるAPI、チュートリアルは実行可能な特定例、計画・検討は履歴と未実装範囲。計画中の名前・属性をコード生成の根拠にしない。違いを見つけたら、対象版の実装・意味のあるテストで確認し、契約と例を揃える。

## 実装済みの境界

- 共通UI WASMはstate・型・部品・layout・イベントを確定し、ブラウザimportを持たない。Rhaiは同期。通信・保存はホストへ依頼し、完了handlerで最新stateへ反映する。
- host_call、HostEffects、HTTPアダプター、WebWorkerの宣言的モックAPIは実装済み。WebSocket、カメラ/マイク、Bluetooth、PGlite/DuckDBアダプター、host_event、host_closeは将来設計。ブラウザ自体のAPIが存在することと、この製品のDSLで使えることを区別する。
- 日付・時計、10進文字列の金額、Unicodeの正規化・書記素処理は登録済み。専用かな変換・文字種検査は後続。日時をJSのDateオブジェクト、金額をFLOATとして扱うコードを生成しない。
- 比較デモの画面一覧はsrc/screen-catalog.jsから生成する。外部アプリはapp.jsonのpagesを使う。画面追加のためだけにデモindex.htmlの選択肢を手動追加しない。

## コード生成時に確定する項目

1. 対象は比較デモか独立アプリか、ソースか配布済みランタイムか。import先とURL基準は対象の配置から決める。
2. トップレベル宣言、属性の階層、itemId/bind、初期state、必要なhandlerを契約に合わせる。Sceneのkey/configをDSL属性へ流用しない。
3. stateSchemaのrequiredは初期stateにも置く。numberfieldの空欄はnullで、Rhaiではunit。金額はtextfieldと10進文字列。日付は厳密な文字列。業務の保存検証と入力途中の検証を区別する。
4. async依頼の開始時、成功、失敗でloadingと結果保持を揃える。従来GETのerror文字列とhost_callのerrorオブジェクトを区別し、外部の更新成功をUI rollbackと同一視しない。
5. 画面の変更は実WASMのload/initと主要イベントに通す。ホスト設定も変更した場合はホストを含めて確認する。検証コマンドは[検証基準](testing.md)へ。スキルの配布更新は[スキル案内](skills.md)へ。

API全文を入口へ重複させず、詳細は上の契約を参照する。外部へコピーされたスキルにソースがなければ、同梱契約で対応範囲を判断し、将来案から不足分を補わない。
