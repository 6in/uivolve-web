# 日付・金額・Unicodeの共通関数を選ぶ

関数名・引数・単位・上限・失敗の根拠は各契約を読む。共通関数は対応するWASMへ登録済みで、画面のためだけにRustを編集する必要はない。

| 用途                           | 契約と実行例                                                                                                                                 | 値の選択                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 今日、期限、月末、日時変換     | [日付・時計](../../../docs/date-functions.md)、[YAML](../../../public/screens/date-lab.yaml)、[Rhai](../../../public/screens/date-lab.rhai)  | Date/DateTimeは文字列。月・年加算は月末へ丸める。時計依存関数だけホストclockが必要 |
| 金額、税、端数、表示桁         | [10進数](../../../docs/decimal-functions.md)、[YAML](../../../public/screens/money-lab.yaml)、[Rhai](../../../public/screens/money-lab.rhai) | textfieldと小数文字列。FLOATを暗黙変換せず、scaleとmodeを明示                      |
| 検索用正規化、文字数、省略表示 | [Unicode](../../../docs/text-functions.md)、[YAML](../../../public/screens/text-lab.yaml)、[Rhai](../../../public/screens/text-lab.rhai)     | 原文と加工値を別に保持。lenは書記素、既存maxLengthはUTF-16単位                     |

時計は実行中に固定され、datepickerの自動todayはload時の値。日付が変わっても画面にタイマー更新があるとは考えない。num_formatの固定書式と計算値の正規化を分ける。NFKCを専用のかな変換とみなさない。未登録関数が必要な場合にだけエンジン拡張へ進む。
