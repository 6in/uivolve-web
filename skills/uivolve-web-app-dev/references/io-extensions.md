# I/Oとネイティブ関数の利用

| 機能                                    | 契約・例                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP JSON取得                           | [チュートリアル](../../../docs/tutorial-http-grid.md)、[Rhai](../../../public/screens/http-grid.rhai)                                                                                               |
| IndexedDB/OPFSのJSON保存                | [保存契約](../../../docs/platform-features.md)、[YAML](../../../public/screens/storage-lab.yaml)、[Rhai](../../../public/screens/storage-lab.rhai)                                                  |
| OPFSファイル・配信キャッシュ・Unary RPC | [契約](../../../docs/files-cache-rpc.md)、[ファイルRhai](../../../public/screens/file-lab.rhai)、[RPC YAML](../../../public/screens/rpc-lab.yaml)、[RPC Rhai](../../../public/screens/rpc-lab.rhai) |
| 正規表現・集計                          | [Rust拡張契約](../../../docs/native-extensions.md)、[Rhai](../../../public/screens/native-extensions.rhai)                                                                                          |

- HTTPはトップレベルrequestsに宣言し、`http_get(name)`と完了handlerを使う。依頼時・成功・失敗でloading等の状態を揃える。汎用POST、async/await、タイマー等は未実装。
- storageで名前付きレコードを宣言し、storage_read/write/removeを発行する。結果はresponse.ok/data/error/request/operation。同期で値を受け取らない。OPFS非対応・容量不足は通常の失敗として扱う。
- filesの名前付き領域へfile_read/write_text、file_read/write_bytes、file_mkdir/list/stat/removeを依頼する。同じ領域への依頼を同時に出さず、mkdir完了後に書く。read_bytesのFileBytesは不変のローカル値で、JSON stateへ置かない。
- rpc_callは宣言したUnaryメソッドと配信Descriptorを使う。64bit整数は十進文字列、bytesはProtoJSONのBase64。idempotent=trueはサーバーが冪等性を保証するときだけ。ネイティブgRPC/Streaming対応を前提にしない。
- 配信キャッシュはホストのnetwork-first設定。ページ側のキャッシュAPIや完全オフライン起動を作り出さない。JWTはstate、画面定義、保存例へ入れずホストの認証設定で扱う。
- 正規表現はregex_is_match/find_all/captures/replace_all、一括整数集計はsum_ints。型・サイズ上限・例外は契約で確認する。新しいRust関数にはエンジンでの登録と再ビルドが必要。

- 日付計算と時計は[日付・時計の契約](../../../docs/date-functions.md)を参照。Date/DateTimeは文字列を保存し、date_add_monthsは月末へ丸める。date_today等はホスト時計を必要とし、RhaiからJavaScriptのDateを直接呼ばない。
