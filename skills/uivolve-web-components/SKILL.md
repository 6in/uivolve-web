---
name: uivolve-web-components
description: uivolve-webのRust/WASMエンジンとDOM/Canvas描画へ部品を追加・修正する。DSL、共通状態、配置、入力、WebMCPの契約を揃える。画面JSON/Rhaiだけの編集には画面作成ガイドを使う。
---

# uivolve-webの部品開発

リポジトリ同梱の開発スキル。部品の追加・変更では[部品開発ガイド](../../docs/component-development.md)を読み、責務を確認するときは[アーキテクチャ](../../docs/architecture.md)を使う。画面だけの編集は[画面作成ガイド](../wasm-ui-authoring/SKILL.md)に従う。

- 設定・状態型・既定値・イベント・寸法・対応範囲を決め、近い実装を選ぶ。未知属性を拒否するDSL契約を維持する。
- Runtimeのコピー→組み込み更新→Rhai→状態検証→確定の順序を維持する。新しい状態制約はinit後とhandler後に検証し、失敗時に元の画面・状態を保つ。
- 状態・型・配置はRust、業務計算はRhai、HTTPとブラウザ入力・描画はJavaScriptへ置く。レンダラーだけで状態を変更しない。
- 同じ幅で計測と配置を行い、安定したWidget keyを使う。子を隠す構造では、イベント遮断とwindow収集も揃える。
- 操作種別は`src/widget-contract.js`へ接続する。表示部品、物理操作部品、Cardの意味的操作を区別し、WebMCPの可視key/actionとWASM検証を揃える。
- IME中の入力要素と文字列を保持する。ネイティブメディアやリスナーには非表示・reset/dispose時の終了処理を用意する。
- 実行例と部品契約を同時に更新し、移植元の未対応機能を実装済みと記述しない。[検証基準](../../docs/testing.md)から変更に必要な項目を選び、実WASMと両描画方式で確認する。
- 変更の振る舞い、互換性、検証結果、残る制限を報告する。既存の他者の変更を含めず、作業単位をローカルコミットへ保存する。外部へのpushはユーザーの指示に従う。
