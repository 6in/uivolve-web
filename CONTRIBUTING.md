# 開発への参加

uivolve-webでは、画面定義・状態・イベント・配置を共通エンジンに置き、DOMとCanvasから同じ処理を使う。

最初に[アーキテクチャ](docs/architecture.md)で担当範囲を確認する。画面JSON/Rhaiの変更は[画面契約](docs/screen-format.md)、部品追加は[部品開発ガイド](docs/component-development.md)、確認・レビューは[検証基準](docs/testing.md)を使う。対応範囲の詳細は[文書案内](docs/README.md)から辿れる。

## 作業の進め方

1. 変更する振る舞い、DSLの設定、イベント、未対応範囲を短く整理する。
2. 既存部品から近い実装を選び、共通エンジン・両描画方式・WebMCPへの影響を確認する。
3. 実行例と該当する契約を更新する。振る舞いを変える場合は、以前の画面パッケージへの影響を明記する。
4. `bun run test`、`bun run build`、`bun run check`、`bun run docs:check`を実行する。見た目や入力に関わる変更はブラウザでも確認する。
5. レビューできる単位でコミットする。何を変えたか、どう確認したか、残る制限を記す。

起動・必要な環境は[README](README.md)、プレビューと静的配信は[運用手順](docs/operations.md)を参照する。Rust変更時にはWASMを再ビルドする。`bun run test`と`bun run build`はWASMビルドも行う。

## 基本方針

- 業務の流れ・検証はRhai、部品の共通状態・型・配置はRust、ブラウザの入力・描画・HTTPはJavaScriptへ置く。再利用する計算処理は[ネイティブ拡張](docs/native-extensions.md)としてRustへ登録できる。
- DSLの未知属性を拒否する契約と、安定したitemId/keyを維持する。移植元の属性を受け付けるだけで「対応済み」と扱わない。
- 新しい部品はDOM/Canvas両方の動作と、WebMCPでの記述・操作を確認する。表示だけの部品に不要なactionを付けない。
- IME変換中の要素と下書きを保持する。動画・iframe・イベントリスナーなどの終了処理を用意する。
- 実装の整理と振る舞いの変更は、確認しやすい単位に分ける。テストは状態・座標・イベントの結果を確認する。
- 移植・再利用したコードのライセンスとクレジットを[第三者通知](THIRD_PARTY_NOTICES.md)へ反映する。

同梱AIスキルは[画面作成](skills/wasm-ui-authoring/SKILL.md)と[部品開発](skills/uivolve-web-components/SKILL.md)。これらはリポジトリ内のガイドであり、グローバル環境へのインストールを自動では行わない。
