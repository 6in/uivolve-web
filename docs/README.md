# ドキュメント案内

AIエージェントは[参照入口](ai-development.md)から作業に必要な現行契約を選ぶ。計画書・検討書は使用APIの根拠にしない。

OPFSのGET受信・POST/PUT本文・multipart送信は[ファイル転送契約](opfs-file-transfer.md)を参照。[ファイル転送方針](opfs-file-transfer-plan.md)は実装前の検討記録。

公開デモ・Actions・Claude Code向けマーケットプレイスは[GitHub配布手順](github-publishing.md)を参照。

uivolve-webは、uivolveの考えをWebへ実装する試作。画面定義・状態・イベント・配置をRust/WASMへ置き、DOMとCanvasで比較する。部品の基本機能の移植であり、uivolve/ExtJSの全機能互換を意味しない。

| やりたいこと                                       | 読む文書                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 起動・ビルド・静的配信                             | [README](../README.md)、[運用手順](operations.md)                                        |
| デモを含めない独立アプリを配布・既存HTMLへ組み込む | [共通ランタイムと最小アプリ](runtime-distribution.md)                                    |
| はじめての画面を作る                               | [Hello Worldチュートリアル](tutorial-hello-world.md)                                     |
| ページ側のコードでタブと部品を追加する             | [動的タブのチュートリアル](tutorial-dynamic-tabs.md)                                     |
| HTTPメソッド・パス変数・query・JSON本文を使う      | [現行HTTPアダプター契約](http-adapter.md)                                                |
| 金額・Unicode文字列を扱う                          | [小数契約](decimal-functions.md)、[文字列契約](text-functions.md)                        |
| ボタンからJSONを取得してGridへ表示する             | [HTTPグリッドのチュートリアル](tutorial-http-grid.md)                                    |
| ボタンから別の画面を取得して表示を切り替える       | [画面遷移のチュートリアル](tutorial-page-navigation.md)                                  |
| カードをドラッグして移動・並べ替えする             | [KANBANとドラッグ＆ドロップ](kanban.md)                                                  |
| Rhaiから通知・確認・入力ダイアログを開く           | [独自ダイアログの契約](dialogs.md)                                                       |
| 日付・時計を扱う                                   | [日付・時計の契約](date-functions.md)、[実装計画](date-money-text-plan.md)               |
| 正規表現を使う・Rust関数をRhaiへ追加する           | [WASM内のRust拡張](native-extensions.md)                                                 |
| 保存・YAML・自然なURL・stateの型を使う             | [ブラウザ機能の契約](platform-features.md)、[対応計画](platform-features-plan.md)        |
| OPFSのファイル操作・アプリキャッシュ・RPCを使う    | [使い方と契約](files-cache-rpc.md)、[検討と実装結果](opfs-cache-rpc-investigation.md)    |
| 責務とデータの流れを知る                           | [アーキテクチャ](architecture.md)                                                        |
| uivolveの狙いと、動く画面・AI開発への広がりを読む  | [開発振り返りブログ](../blog/uivolve-web-retrospective/index.md)                         |
| HTTP・デバイス・ブラウザ内SQLの拡張設計を知る      | [ホスト・アダプター将来設計・履歴](host-adapters-design.md)                              |
| JSON/YAMLとRhaiで画面を作る                        | [画面契約](screen-format.md)、[アプリ開発スキル](../skills/uivolve-web-app-dev/SKILL.md) |
| AI向けスキルを選ぶ・外部アプリへ配布する           | [スキル案内](skills.md)、[エンジン開発スキル](../skills/uivolve-web-engine-dev/SKILL.md) |
| 部品を追加・変更する                               | [開発への参加](../CONTRIBUTING.md)、[部品開発ガイド](component-development.md)           |
| 変更を確認・レビューする                           | [検証基準](testing.md)                                                                   |
| DOMとCanvasの文字サイズが揃っているか確かめる      | [レンダラー間のフォントサイズ台帳](renderer-font-parity.md)                              |
| Grid/Card/Border/Fitで配置する                     | [レイアウト契約](layouts.md)                                                             |
| フォーム部品を使う                                 | [uivolve対応表](uivolve-port.md)                                                         |
| Data Grid・タブ・ツリー・メニューを使う            | [Grid・ナビゲーション契約](grid-navigation.md)                                           |
| カレンダー・通知・図表・エディター・メディアを使う | [ギャラリー契約](uivolve-gallery.md)                                                     |
| 配色を変える                                       | [テーマ契約](theme-format.md)                                                            |
| HTTP取得でJWTを使う・CORSを設定する                | [JWT・CORS契約](authentication.md)                                                       |
| AIから画面を操作する                               | [WebMCP契約](webmcp.md)                                                                  |
| 今回の整理と次の課題を知る                         | [整備計画](maintenance-plan.md)                                                          |

設定・イベントの詳細は各契約文書に置く。開発ガイドは実装箇所と判断基準を扱い、契約を重複して列挙しない。仕様を変えた場合は、実行例と該当する契約を同じ変更で更新する。

現在の主な制限は、Canvas 2Dとネイティブ入力によるIME連携、同期Rhai、内容に応じて伸びる配置、基本的な部品移植。GPU描画、内部スクロール・仮想化、OSのIMEモード制御、完全なCanvasアクセシビリティは実装していない。個別の対応範囲は各契約を参照する。

金額計算は[金額・10進数](decimal-functions.md)、文字列加工は[Unicode文字列](text-functions.md)を参照。
