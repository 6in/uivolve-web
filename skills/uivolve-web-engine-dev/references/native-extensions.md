# Rhaiネイティブ関数を変更する

登録手順と公開Rust APIは[共通拡張契約](../../../docs/native-extensions.md)。対象の機能だけ、以下の契約と実装を読む。

| 対象       | 契約                                                                                          | 変更時の不変条件                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 時計・暦   | [日付](../../../docs/date-functions.md)、[実装](../../../engine/src/extensions/date.rs)       | ブラウザ時計は実行単位で1回採取。guardで解除。initとdatepicker.todayを揃え、時計関数を最適化時に固定しない |
| 金額・表示 | [小数](../../../docs/decimal-functions.md)、[実装](../../../engine/src/extensions/decimal.rs) | 厳密な小数文字列。暗黙の丸めを避け、指定桁で一度だけ丸める。係数超過をエラーにする                         |
| Unicode    | [文字列](../../../docs/text-functions.md)、[実装](../../../engine/src/extensions/text.rs)     | 書記素境界、結合によるpaddingの合体、正規化による出力拡大、入出力上限を検査                                |

新しい純粋関数はregister_with_contextから登録し、時計が必要なものだけExtensionContextを使う。旧Runtime APIを維持する。Rust単体に加え、実WASMから型違い・境界・例外・state/revision保持を検証する。依存追加時は実際のfeatures、import、WASMサイズ、ライセンス通知を確認する。
