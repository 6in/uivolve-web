# 部品・DSL・レイアウト

[部品開発ガイド](../../../docs/component-development.md)を読み、近い実装を選ぶ。対応版のengine/srcと両レンダラーを変更する。

- xtype、属性、既定値、state型、イベントpayload、寸法、ライフサイクル、DOM/Canvas/WebMCPでの対応範囲を決める。未知属性拒否と安定したWidget keyを維持する。
- Node/validate→normalize/initialize→validate_state→measure/arrange→event→描画の接続を確認する。初期stateの明示値を上書きしない。新しい入力型はstate_schema.rsのbind整合も確認する。
- 同じ幅・余白で計測と配置を行う。子を隠す構造では描画だけでなくイベント遮断とwindow収集にも同じ条件を適用する。
- src/widget-contract.jsで、表示部品、物理操作部品、Card等の意味的操作を区別する。WebMCPの可視key/actionsとWASMの検証を揃える。
- IME変換中の入力要素と文字列を保持する。ネイティブメディアやリスナーは非表示・reset/disposeで終了する。Canvas上の要素とモーダルの重なりを確認する。
- ダイアログの変更は[独自ダイアログ契約](../../../docs/dialogs.md)に従う。WASMのFIFO・下書き・回答・Scene構成を維持し、DOM/Canvasそれぞれの領域内へ描画する。
- 再利用する計算は[ネイティブ拡張](../../../docs/native-extensions.md)として登録する。型変換、処理・容量上限、エラー時の巻き戻しを揃える。ブラウザAPIを同期Rust関数として偽装しない。
- 設定、正常操作、拒否、handler失敗、可視性、狭い幅、IME、テーマを変更に応じて確認する。移植元の未対応機能を実装済みと記述しない。
