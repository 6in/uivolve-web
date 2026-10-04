# Unicode文字列の共通関数

元の文字列を保持したまま、検索用の正規化や表示用の加工を行える。入力・出力はそれぞれ65,536 UTF-8バイト以内。文字列以外は受け付けない。[文字列サンプル](../public/screens/text-lab.yaml)と[Rhai](../public/screens/text-lab.rhai)は`/pages/text-lab`で開く。

## API

| 関数                              | 結果                                         |
| --------------------------------- | -------------------------------------------- |
| `text_normalize(s)`               | NFKC正規化                                   |
| `text_normalize(s, form)`         | NFC、NFD、NFKC、NFKDのいずれか。名前は大文字 |
| `text_trim(s)`                    | Unicodeの前後空白を除去。内部の空白は保持    |
| `text_len(s)`                     | 拡張書記素クラスターの数                     |
| `text_pad_start(s, len, padding)` | 指定書記素数に達するまで先頭へpaddingを追加  |
| `text_pad_end(s, len, padding)`   | 指定書記素数に達するまで末尾へpaddingを追加  |
| `text_truncate(s, len, suffix)`   | 書記素を分断せず切り詰め、suffixを追加       |

lenは整数0〜65,536。元の文字列がlen以下ならtruncateは元の文字列を返し、suffixを追加しない。切り詰める場合、lenはsuffixの書記素数を含む最大出力長。suffixがlenを越える場合はエラー。len=0、suffixが空なら空文字列を返す。suffixが直前の文字と結合する場合は出力の書記素数がさらに減ることがある。

paddingは空でない単一書記素。元の文字列がlen以上ならそのまま返す。paddingの繰り返しや元の文字列との結合で書記素が合体し、指定長を満たせない場合はエラーにする。たとえば末尾に結合アクセントを追加すると既存の文字と結合するため、埋め文字には使えない。入力や出力容量を超えた場合も切り捨てずエラー。

```rhai
let query = text_trim(text_normalize(" ＡＢＣ　ﾊﾟ ")); // "ABC パ"
let count = text_len("👨‍👩‍👧‍👦é🇯🇵"); // 3
let short = text_truncate("👨‍👩‍👧‍👦é🇯🇵", 2, "…"); // "👨‍👩‍👧‍👦…"
let code = text_pad_start("42", 6, "0"); // "000042"
```

## 正規化と単位

NFKCは互換文字の違いをまとめ、全角ASCII、半角カナ、丸数字などを変換する。検索・照合用の値を作る用途で、元の表示文字列へ自動上書きしない。NFCは結合形、NFDは分解形、NFKDは互換分解形。大文字小文字、ひらがな・カタカナ、ロケール依存の照合を自動で揃える機能ではない。ZWSPなどUnicodeの空白ではない文字はtrimで消さない。

text_lenはバイト数やUTF-16単位ではなく、Unicodeの拡張書記素数。家族絵文字、国旗、結合文字は複数コードポイントでも1書記素として扱う。フォントの表示幅や列数は保証しない。既存入力部品のmaxLengthはUTF-16単位のため、text_lenと一致しない場合がある。

実装はunicode-normalization 0.1.25とunicode-segmentation 1.13.3。Unicode規則は依存版に従い、正規化は出力拡大中にも容量検査する。単独の全半角・かな変換、文字種検査は後続の範囲。文字列処理は純粋関数で、時計やブラウザimportを必要としない。例外はRhaiのtry/catchで扱え、未処理なら既存のイベント巻き戻しが適用される。

既存のAPIは維持する。新しい関数を使う配布先には対応するWASMと[ライセンス通知](../THIRD_PARTY_NOTICES.md)を再配信する。
