# 日付・時計、金額、文字列処理の実装計画

2026-10-04。外部提案を現行のhost_resultと共通ランタイムに合わせて整理した計画。第1段階の日付・時計を完了し、追加の実装指示により第2・第3段階も進める。

## 第1段階: 日付・時計

1. 暦計算はChronoの時計取得を含まない構成で実装する。ブラウザimportは追加しない。年月日は0001〜9999、先発グレゴリオ暦とする。
2. Dateは厳密なYYYY-MM-DD。DateTimeの入力はYYYY-MM-DDTHH:mm:ssに任意の.SSSと必須のZまたは±HH:mmを続ける形式、出力は常にミリ秒3桁と数値オフセットを持つ。24時・うるう秒・年0は拒否。オフセットは-14:00〜+14:00。月・年加算は月末へ丸める。
3. clockはnowMsとtzOffsetMinutes。ホストはRhaiを実行するABI呼び出しごとに一度だけ採取する。同じ実行中は固定し、未提供なら現在時刻に依存する関数だけ失敗する。純粋な日付計算は使える。旧Rust APIも維持する。
4. Runtimeごとの共有セルとスコープguardで時計を保持する。失敗後、次の呼び出し、別Runtimeに値を漏らさない。入力の整数性・日時範囲・オフセットを検証する。
5. WasmEngine、UiRuntime、createApplicationにclockProviderを注入可能にする。画面load時は同じ時計値でinitとdatepicker.todayを処理する。WASM再取得にもproviderを引き継ぐ。
6. datepickerの自動todayは画面load時の値とする。開いたままの画面では自動タイマー更新しない。date_todayは次のイベントで新しい日付を返す。明示todayは維持する。
7. 日付入力・カレンダーの年月日検証、曜日、月の日数を共通化する。Rust単体と実WASMで範囲・精度・巻き戻し・全完了ABI・旧API互換を確認する。デモ、契約、両スキル、WASMサイズを更新する。

公開関数はdate_today、datetime_now、now_ms、tz_offset_minutes、date_is_valid、date_year/month/day/weekday、date_is_leap_year、date_days_in_month、date_add_days/months/years、date_diff_days、date_start/end_of_month、datetime_add_minutes、datetime_to_ms/from_ms、date_format。Dateの書式に時間トークンを指定するとエラー。曜日dddは日本語固定で、ロケール拡張は後続。

固定オフセットはIANAタイムゾーンではない。夏時間を追随する予約・営業日・祝日計算は対象外。日付同士は文字列比較可能だが、異なるオフセットの日時比較はdatetime_to_msを使う。

## 第2段階: 金額

- 入出力は厳密な10進文字列。FLOATを暗黙変換しない。rust_decimalを使い、scaleは0〜28、入力は64バイトまで。実際の係数範囲も検査し、overflowを返す。
- dec_add/sub/mul/div/round/cmp/is_valid/sumを先行する。計算結果は不要な末尾ゼロを除去し、-0は0。表示桁はnum_formatへ分離する。
- down=ゼロ方向、up=ゼロから離れる方向、half_up=中間値をゼロから離れる方向、half_even=偶数丸め。負数の例を契約へ載せる。floor/ceilは別名で追加可能。
- 除算は指定scaleへの丸めで、一度だけ丸める実装を確認する。既存SDKの除算精度からの二重丸めが起こる境界をテストする。0除算・丸め不能・overflowは例外。
- num_formatは#,##0、#,##0.00、0.0%、¥#,##0程度の限定仕様から開始。任意書式やロケール依存を初期版に含めない。
- 配列上限10,000、合計出力容量を制限。税計算・返金・負数端数・大きな係数・JSON保存をRustと実WASMで確認する。金額サンプル、スキル、ライセンス、サイズを更新する。

## 第3段階: 文字列

- unicode-normalizationとunicode-segmentationでNFKCと書記素処理を提供する。文字列全体の入力・出力は65,536 UTF-8バイトまで。
- text_normalize、text_trim、text_len、text_pad_start/end、text_truncateを先行し、かな変換・全半角変換・文字種検査は次のまとまりにする。
- NFKCは検索・照合用の変換で、元の表示文字列を保持できる説明とサンプルを用意する。自動で入力値を上書きしない。
- text_lenは書記素数。既存maxLengthのUTF-16単位との違いを明記する。paddingは単一書記素を要求し、truncateのlenはsuffixを含めた出力書記素数とする。
- 半角/全角・ひらがな/カタカナ検査は長音、結合濁点、空文字、空白、記号の扱いを確定してから追加する。変換の対象表を契約へ置き、可逆変換を約束しない。
- 絵文字列・結合文字・半角濁点・全角空白・境界容量をRustと実WASMで確認。検索用正規化のサンプル、スキル、ライセンス、サイズを更新する。

## 共通の完了条件

各段階は独立したコミットにし、bun run test/build/check/docs:checkとスキル配布の再生成を確認する。表示サンプルはDOM/Canvas、意味的操作はWebMCPを確認する。push・mainへのマージは今回の実装指示に含めず、ユーザーから依頼された時点で行う。

## 実装結果

日付・時計はPUSH済み。第2段階は[金額契約](decimal-functions.md)、第3段階の先行範囲は[文字列契約](text-functions.md)に沿って実装。小数の途中計算にはnum-bigintを追加し、最終値をrust_decimalで検証する。暗黙の丸めをせず、指定桁への除算を一度だけ丸める。かな変換・単独の全半角変換・文字種検査は計画どおり後続とする。
