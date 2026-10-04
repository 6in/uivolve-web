---
name: uivolve-web-engine-dev
description: uivolve-webのRust/WASMエンジン、部品、レイアウト、DSL、Rhaiネイティブ拡張、ABIとDOM/Canvasアダプターを開発・修正する。ブラウザホストの配信・認証・非同期I/O変更も扱う。既存機能だけで画面JSON/YAMLとRhaiを書く場合はアプリ開発の範囲。
---

# uivolve-webエンジンを開発する

対象はuivolve-webのソースリポジトリ。外部アプリの画面だけを編集する場合は `uivolve-web-app-dev` を使う。配布版スキル内の文書は参照用のスナップショットなので、対象チェックアウトの契約・実装を優先する。

## 変更する責務を選ぶ

[アーキテクチャ](../../docs/architecture.md)を参照し、必要な作業の資料だけを読む。

| 作業                                             | 参照資料                                          |
| ------------------------------------------------ | ------------------------------------------------- |
| 部品・配置・DSL・イベント                        | [部品開発](references/components.md)              |
| Rust関数をRhaiへ公開する                         | [ネイティブ拡張](../../docs/native-extensions.md) |
| HTTP・認証・保存・配信・ルーティング・WebMCP登録 | [ブラウザホスト](references/host.md)              |
| 検証・ビルド・互換性                             | [確認手順](references/validation.md)              |

## 維持する境界

- state、型、部品構成、配置、イベント確定はRust。業務の流れはRhai。ブラウザAPI、HTTP、IME入力、描画はホストとアダプターに置く。
- Runtimeのコピー→組み込み更新→Rhai→状態/UI検証→確定の順序を維持する。失敗時に以前の画面・state・revisionを保ち、未確定のI/Oを開始しない。
- JSON/YAMLは同じDSL検証へ通す。未知属性を拒否し、configを任意属性の逃げ道にしない。stateSchemaは初期化・通常イベント・非同期完了の確定前に適用する。
- 新しい操作はDOM、Canvas、widget-contract、WebMCPとWASMの可視性・型・actionを揃える。レンダラーだけでstateを変更しない。
- 契約変更と実行例を同じ変更で更新し、以前の画面パッケージへの影響を明記する。既存の他者の編集を含めず、作業単位でローカルコミットする。pushはユーザーの指示に従う。

時計の変更では[日付・時計の契約](../../docs/date-functions.md)を維持する。clockは実行スコープだけに保持し、失敗時も解除する。initとdatepicker.todayは同じサンプルを共有する。
