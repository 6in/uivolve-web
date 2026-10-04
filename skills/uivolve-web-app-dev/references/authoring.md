# 画面パッケージとRhai

[画面契約](../../../docs/screen-format.md)が属性とイベントの基準。はじめての実装は[Hello World](../../../docs/tutorial-hello-world.md)、[JSON](../../../public/screens/hello-world.json)、[Rhai](../../../public/screens/hello-world.rhai)を参照する。

- YAMLはブロック形式で構造を表し、短い配列以外にJSON風のflow形式を多用しない。対応値はJSON互換値のみ。エイリアス・独自タグ・複数ドキュメント等の制限は[形式契約](../../../docs/platform-features.md)を確認する。
- `script`とメディアの相対URLは画面定義URLが基準。themeは別JSONで、画面定義に未対応のtheme/style属性を足さない。
- `init(state)`と各handlerはstateを返す。業務の流れ・計算・保存前の検証をRhaiに置く。Rhaiへ静的な型宣言を追加するのではなく、DSLのstateSchemaで確定時の値を検証する。
- 非破壊の前後空白除去には登録済みのtext_trimを使える。Rhai組み込みのtrim()は元の文字列を変更するため、戻り値を代入・比較しない。[共通関数](native-functions.md)を参照。
- 操作は宣言したhandler名から呼ぶ。itemId内のコロンは内部key用に予約される。入力の書き込みbindはトップレベルキーだけ。表示参照のドット記法と区別する。
- エンジンの未知属性拒否を維持する。任意のRustコードや未登録関数を画面パッケージへ書いても実行できない。利用できるRhai機能は対象版の`engine/Cargo.toml`と登録処理に依存する。

同梱の[最小YAML](../assets/hello-world/hello-world.yaml)と[Rhai](../assets/hello-world/hello-world.rhai)は、入力・ボタン・結果表示とstateSchemaを含む。コピー後にid、title、handlerと配信先をアプリに合わせて変更する。
