# 入力とstateの型

[フォーム対応表](../../../docs/uivolve-port.md)、[フォーム例](../../../public/screens/uivolve-forms.json)、[型の契約](../../../docs/platform-features.md)を必要に応じて読む。

- 初期stateの明示値を優先し、未定義の入力キーだけvalue/checkedから補完する。bind省略時はname、その次に生成キーとなるので、継続して参照する入力にはitemIdとbindを付ける。
- checkboxはbool、numberfield/sliderは数値、複数listboxは文字列配列、radio/comboboxは文字列。numberfieldの空欄はnullで、Rhaiではunit `()`として調べる。radioは共有bind/nameとinputValueでまとめる。
- 選択肢はoptionsまたはstore.dataとdisplayField/valueFieldで定義する。allowBlank/inputType等だけで保存検証が済むと考えず、必要な業務検証をRhaiへ書く。
- stateSchemaは各ノードのtypeが必須で、対応語彙だけを使う。JSON Schema全体の実装ではない。YAMLで型名のnullを書くときは`"null"`と引用する。
- requiredのキーは元の初期stateにも置く。additionalProperties=falseならUIの補助状態キーも宣言する。動的部品の入力bindも型整合の対象。
- 入力途中に空欄を許すなら、stateSchemaのminLengthで毎回拒否せず保存handlerで必須検証する。nullableな数値欄はnumber/integerとnullの型配列で表す。
- 型・制約違反ではstateとrevisionが保持されることを確認する。保存から復元した値も、適用前に形・型を確認する。
