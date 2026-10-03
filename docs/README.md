# ドキュメント案内

uivolve-webは、uivolveの考えをWebへ実装する試作。画面定義・状態・イベント・配置をRust/WASMへ置き、DOMとCanvasで比較する。部品の基本機能の移植であり、uivolve/ExtJSの全機能互換を意味しない。

| やりたいこと                                       | 読む文書                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 起動・ビルド・静的配信                             | [README](../README.md)、[運用手順](operations.md)                                  |
| はじめての画面を作る                               | [Hello Worldチュートリアル](tutorial-hello-world.md)                               |
| ページ側のコードでタブと部品を追加する             | [動的タブのチュートリアル](tutorial-dynamic-tabs.md)                               |
| ボタンからJSONを取得してGridへ表示する             | [HTTPグリッドのチュートリアル](tutorial-http-grid.md)                              |
| 正規表現を使う・Rust関数をRhaiへ追加する           | [WASM内のRust拡張](native-extensions.md)                                           |
| 責務とデータの流れを知る                           | [アーキテクチャ](architecture.md)                                                  |
| JSONとRhaiで画面を作る                             | [画面契約](screen-format.md)、[AI作成ガイド](../skills/wasm-ui-authoring/SKILL.md) |
| 部品を追加・変更する                               | [開発への参加](../CONTRIBUTING.md)、[部品開発ガイド](component-development.md)     |
| 変更を確認・レビューする                           | [検証基準](testing.md)                                                             |
| Grid/Card/Border/Fitで配置する                     | [レイアウト契約](layouts.md)                                                       |
| フォーム部品を使う                                 | [uivolve対応表](uivolve-port.md)                                                   |
| Data Grid・タブ・ツリー・メニューを使う            | [Grid・ナビゲーション契約](grid-navigation.md)                                     |
| カレンダー・通知・図表・エディター・メディアを使う | [ギャラリー契約](uivolve-gallery.md)                                               |
| 配色を変える                                       | [テーマ契約](theme-format.md)                                                      |
| HTTP取得でJWTを使う・CORSを設定する                | [JWT・CORS契約](authentication.md)                                                 |
| AIから画面を操作する                               | [WebMCP契約](webmcp.md)                                                            |
| 今回の整理と次の課題を知る                         | [整備計画](maintenance-plan.md)                                                    |

設定・イベントの詳細は各契約文書に置く。開発ガイドは実装箇所と判断基準を扱い、契約を重複して列挙しない。仕様を変えた場合は、実行例と該当する契約を同じ変更で更新する。

現在の主な制限は、Canvas 2Dとネイティブ入力によるIME連携、同期Rhai、内容に応じて伸びる配置、基本的な部品移植。GPU描画、内部スクロール・仮想化、OSのIMEモード制御、完全なCanvasアクセシビリティは実装していない。個別の対応範囲は各契約を参照する。
