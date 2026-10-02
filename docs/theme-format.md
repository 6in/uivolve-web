# Theme v1

テーマは画面パッケージとは別のJSON。色だけを指定する小さな形式で、DOMとCanvasが共通の配色を使う。テーマ変更で画面を再読み込みせず、業務状態・revision・入力値・開いているwindowを維持する。

```json
{
  "version": 1,
  "name": "すみれ",
  "mode": "light",
  "colors": {
    "primary": "#7253a3",
    "focus": "#9272bd",
    "selected": "#f3effa"
  }
}
```

versionは1が必須。nameは省略時「カスタム」、1〜80文字。modeはlight（既定）またはdarkで、ネイティブ入力欄のcolor-schemeと比較ページの明暗にも反映する。colorsは省略でき、指定しなかった色は**modeに対応する標準テーマ**の値で補完する。直前のテーマとのマージは行わない。ダークテーマの一部だけ変更したい場合はmodeをdarkにするか、配色エディタに表示された完全な定義を編集する。

| 色名                            | 用途                                               |
| ------------------------------- | -------------------------------------------------- |
| background                      | 描画エリア、入力欄、window、通常のボタン・行の背景 |
| surface                         | パネル背景                                         |
| subtle                          | 一覧ヘッダー、windowの閉じるボタン                 |
| text / muted                    | 本文 / ラベル・補助文言                            |
| border                          | 枠線・区切り線                                     |
| primary / onPrimary             | 主ボタンの背景 / その文字色                        |
| selected                        | 選択行、通常のボタンや行のhover背景                |
| focus                           | フォーカス表示、選択行の目印                       |
| overlay / shadow                | モーダル背景 / windowの影                          |
| infoBackground / infoText       | blueのmetric                                       |
| successBackground / successText | greenのmetric                                      |
| warningBackground / warningText | amberのmetric                                      |

色は`#RRGGBB`または`#RRGGBBAA`のみ。CSS式、URL、任意の属性や未知の色名は受け付けない。入力をWASMで検証・補完してから置き換えるため、無効な変更は現在の配色を維持する。

ブラウザの「テーマ」でライト／ダークを選択できる。「配色を編集」では現在の配色をJSONで変更・適用でき、HTTP / HTTPS URLから独自テーマを取得することもできる。別オリジンからの取得には配信側のCORS許可が必要。選択したテーマは画面パッケージを切り替えても維持する。ページを再読み込みすると標準ライトに戻る。

ブラウザAPIは`engine.theme()`で取得、`engine.theme(definition)`で更新。ABIでは`{ op: "theme" }`と`{ op: "theme", theme: definition }`に対応する。`layout()`のscene.themeには補完済みの定義が入る。DOM版はCSS変数へ変換し、Canvas版は同じcolorsを描画命令へ渡す。Canvasの編集中のHTML inputにも同じCSS変数を適用する。

標準ファイルは`public/themes/light.json`と`public/themes/dark.json`。HTTPで読み込むテーマはエンジンの再ビルドなしで変更できる。省略した色の補完用の標準値はWASMへ埋め込んでいるため、その既定値自体を更新する場合はWASMも再ビルドする。

今回の対応は配色のみ。フォント、余白、角丸、部品ごとの自由なstyle、CSSのカスケードやセレクターは提供しない。配置や部品の寸法は既存の画面DSLが管理する。hover表現やCanvasのアクセシビリティに関する従来の差は残る。比較ページの外枠は明暗に追従するが、ブランド表示など一部は固定の色を使う。
