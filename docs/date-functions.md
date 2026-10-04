# 日付・時計の共通関数

Dateは`YYYY-MM-DD`、DateTimeは`YYYY-MM-DDTHH:mm:ss`に任意の`.SSS`と必須の`Z`または`±HH:mm`を続ける形式の文字列。先発グレゴリオ暦の0001〜9999年を扱う。空文字、曖昧な形式、年0、24:00、うるう秒は拒否する。DateTimeの返り値は常にミリ秒3桁と数値オフセットを持つ。`Z`の入力は`+00:00`となる。

[日付・時計サンプル](../public/screens/date-lab.yaml)と[Rhai](../public/screens/date-lab.rhai)は`/pages/date-lab`で開く。[段階別の計画](date-money-text-plan.md)には後続の金額・文字列処理も記載している。

## 関数

| Rhaiの呼び出し                      | 結果                                              |
| ----------------------------------- | ------------------------------------------------- |
| `date_today()`                      | 実行開始時の現地日付                              |
| `datetime_now()`                    | 実行開始時の現地日時                              |
| `now_ms()`                          | Unix epochからの整数ミリ秒                        |
| `tz_offset_minutes()`               | UTCより東を正とする整数分。日本は540              |
| `date_is_valid(date)`               | 厳密な日付かをboolで返す                          |
| `date_year/month/day(date)`         | 年・月・日を整数で返す。実際は3つの関数           |
| `date_weekday(date)`                | 月曜1〜日曜7                                      |
| `date_is_leap_year(year)`           | うるう年か。年は1〜9999                           |
| `date_days_in_month(year, month)`   | 月の日数。月は1〜12                               |
| `date_add_days(date, n)`            | 整数n日を加算                                     |
| `date_add_months(date, n)`          | 整数n月を加算。存在しない日は移動先の月末へ丸める |
| `date_add_years(date, n)`           | 整数n年を加算。2月29日は平年の2月28日へ丸める     |
| `date_diff_days(a, b)`              | b−aの日数。aより前なら負数                        |
| `date_start_of_month(date)`         | 月初の日付                                        |
| `date_end_of_month(date)`           | 月末の日付                                        |
| `datetime_add_minutes(datetime, n)` | 整数n分を加算。元のオフセットとミリ秒を保持       |
| `datetime_to_ms(datetime)`          | UTC基準の整数ミリ秒                               |
| `datetime_from_ms(ms)`              | その実行の時計オフセットで日時に変換              |
| `date_format(value, pattern)`       | DateまたはDateTimeを限定書式で表示                |

不正な引数や範囲外の結果はRhai例外。`date_is_valid`だけは不正な日付文字列にfalseを返す。整数引数へ小数は渡せない。例外は`try / catch`で扱え、未処理の例外はイベントのstate・UI・revision変更を破棄する。

```rhai
let due = date_add_months("2026-01-31", 1); // 2026-02-28
let label = date_format(due, "YYYY年M月D日(ddd)"); // 2026年2月28日(土)
let instant = datetime_to_ms("1970-01-01T00:00:00.001Z"); // 1
```

書式トークンは`YYYY`、`MM`、`M`、`DD`、`D`、`ddd`、`HH`、`mm`、`ss`。長いトークンから照合し、それ以外の文字はそのまま出力する。dddは日本語の月〜日。Dateに時間トークンを指定すると例外になる。パターンは256 UTF-8バイト、出力は1,024バイトまで。トークンを引用する構文やロケール切替はない。

## 時計の供給と再現性

WASMはOSやブラウザから直接時計を取得しない。ブラウザホストはRhaiを実行する`load`、`event`、`host_result`、`http_result`、`storage_result`、`file_result`、`rpc_result`、`dialog_result`ごとに一度だけ時計を採取する。initと同じ画面load中のdatepicker.todayにも同じ値を使う。layoutやthemeだけの操作では採取しない。

ABIの任意フィールドは`clock: {nowMs, tzOffsetMinutes}`。nowMsは整数、tzOffsetMinutesは-840〜840の整数分で、現地日付が0001〜9999年であることを検証する。JavaScriptではnowMsが安全な整数であることも要求する。余分なキーは拒否する。clockを省略した旧ABIも使えるが、`date_today`、`datetime_now`、`now_ms`、`tz_offset_minutes`、`datetime_from_ms`は時計不足の例外になる。純粋な日付計算は使える。

WasmEngine、UiRuntime、createApplicationは`clockProvider`を受け取る。既定はDate.nowとその瞬間のブラウザのUTCオフセット。固定時計を注入すればテストや再生を再現できる。providerがundefinedを返すと時計を省略する。

```js
const clockProvider = () => ({
  nowMs: Date.parse("2026-10-04T00:00:00.123+09:00"),
  tzOffsetMinutes: 540,
});
const runtime = new UiRuntime({ ...options, clockProvider });
```

WASM再取得でもproviderを引き継ぐ。各Runtimeは独立した時計スコープを持ち、成功・失敗とも実行終了時に解除する。Rhaiの最適化で現在時刻をコンパイル時に固定しない。

旧Rust APIの`Runtime::load`、`load_with_extensions`、`load_with_descriptors`を維持する。Rustで時計を提供する場合は`load_with_clock(package, script, descriptors, Some(clock), register)`と`runtime.with_clock(Some(clock), |runtime| runtime.dispatch(...))`を使う。型は`extensions::Clock`。時計依存関数の共通登録は`extensions::register_with_context`、従来の`register`も利用可能。

## カレンダーとタイムゾーン

Dateは時刻・タイムゾーンを持たず、同じ形式の文字列同士を日付順に比較できる。DateTimeを異なるオフセットで比較するときはdatetime_to_msを使う。固定オフセットはIANAタイムゾーンではなく、日時への加算は夏時間を追随しない。営業日・祝日・タイマーは別機能とする。

日付入力とdatepickerは同じ暦検証を使う。自動todayは画面load時の値で、開いたまま日付が変わってもタイマーでは更新しない。次のイベントでdate_todayは新しい日付を返す。明示したdatepicker.todayは維持する。時計を省略したホストでは自動todayも補わない。

暦計算にはChrono 0.4.45をdefault-features=false、features=[std]で利用する。時計取得・IANAデータ・ブラウザimportは追加しない。実ビルドログで圧縮前のWASMは約4,125 KiBから約4,192 KiBへ増加した（約67 KiB）。性能測定ではない。[ライセンス通知](../THIRD_PARTY_NOTICES.md)も配布に含める。
