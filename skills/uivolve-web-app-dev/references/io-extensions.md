# I/Oとネイティブ関数の利用

| 機能                                    | 契約・例                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPメソッド・パス変数                  | [選択と接続](http.md)、[現行契約](../../../docs/http-adapter.md)                                                                                                                                    |
| 固定URLのHTTP JSON取得                  | [チュートリアル](../../../docs/tutorial-http-grid.md)、[Rhai](../../../public/screens/http-grid.rhai)                                                                                               |
| IndexedDB/OPFSのJSON保存                | [保存契約](../../../docs/platform-features.md)、[YAML](../../../public/screens/storage-lab.yaml)、[Rhai](../../../public/screens/storage-lab.rhai)                                                  |
| OPFSファイル・配信キャッシュ・Unary RPC | [契約](../../../docs/files-cache-rpc.md)、[ファイルRhai](../../../public/screens/file-lab.rhai)、[RPC YAML](../../../public/screens/rpc-lab.yaml)、[RPC Rhai](../../../public/screens/rpc-lab.rhai) |
| 正規表現・集計                          | [Rust拡張契約](../../../docs/native-extensions.md)、[Rhai](../../../public/screens/native-extensions.rhai)                                                                                          |

- HTTPは[選択と接続](http.md)でhttp_getとhost_callを選ぶ。POST/PUT/PATCH/DELETE/HEAD、パス変数、query、JSON本文はHTTPアダプターで対応済み。Rhaiのasync/awaitとタイマーは未実装。
- storageで名前付きレコードを宣言し、storage_read/write/removeを発行する。結果はresponse.ok/data/error/request/operation。同期で値を受け取らない。OPFS非対応・容量不足は通常の失敗として扱う。
- filesの名前付き領域へfile_read/write_text、file_read/write_bytes、file_mkdir/list/stat/removeを依頼する。同じ領域への依頼を同時に出さず、mkdir完了後に書く。read_bytesのFileBytesは不変のローカル値で、JSON stateへ置かない。
- rpc_callは宣言したUnaryメソッドと配信Descriptorを使う。64bit整数は十進文字列、bytesはProtoJSONのBase64。idempotent=trueはサーバーが冪等性を保証するときだけ。ネイティブgRPC/Streaming対応を前提にしない。
- 配信キャッシュはホストのnetwork-first設定。ページ側のキャッシュAPIや完全オフライン起動を作り出さない。JWTはstate、画面定義、保存例へ入れずホストの認証設定で扱う。
- 正規表現はregex_is_match/find_all/captures/replace_all、一括整数集計はsum_ints。型・サイズ上限・例外は契約で確認する。新しいRust関数にはエンジンでの登録と再ビルドが必要。

日付・時計・金額・Unicode加工は[共通関数の選択](native-functions.md)。API詳細の重複一覧は置かず、機能別契約を参照する。
