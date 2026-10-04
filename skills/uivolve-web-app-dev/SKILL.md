---
name: uivolve-web-app-dev
description: uivolve-web上で動くアプリの画面JSON/YAML、Rhai、stateSchema、テーマを作成・修正する。HTTPメソッド・パス変数、保存、動的部品、ダイアログ、日付・金額・Unicode処理を既存契約で組み合わせる。Rust/WASMやブラウザホスト自体の変更はエンジン開発の範囲。
---

# uivolve-webでアプリを作る

画面パッケージとRhaiはHTTPで配信し、既存のWASMエンジンが構成・実行する。画面作成にRustの編集やWASMの再ビルドは不要。

## 最初に確認すること

- 対象アプリの配置・配信方法と、利用するエンジンのバージョンを確認する。同梱資料はこのスキルを配布した版の契約であり、別版への互換性を保証しない。
- 現行APIは契約文書、実行例はチュートリアル、計画書は履歴・将来案として区別する。[AI向け参照入口](../../docs/ai-development.md)で対応範囲を確認できる。
- [画面形式](../../docs/screen-format.md)と[基本の書き方](references/authoring.md)を読み、必要な機能の資料だけを以下から選ぶ。
- 新規画面には[最小YAML](assets/hello-world/hello-world.yaml)と[Rhai](assets/hello-world/hello-world.rhai)を使える。外部アプリでは2ファイルを一緒に置き、アプリの既存ローダーへURLを登録する。デモ専用の画面カタログを前提にしない。

## 必要な機能を選ぶ

| 作業                                        | 参照資料                                          |
| ------------------------------------------- | ------------------------------------------------- |
| フォーム・入力検証・stateの型               | [入力と型](references/fields-state.md)            |
| 配置・Grid・動的タブ・ウィンドウ・テーマ    | [部品と配置](references/components-layout.md)     |
| HTTPメソッド・パス変数・query・本文         | [HTTPの選択と接続](references/http.md)            |
| 日付・時計・金額・Unicode加工               | [共通関数の選択](references/native-functions.md)  |
| JSON保存・OPFSファイル・RPC・正規表現の利用 | [I/Oと拡張](references/io-extensions.md)          |
| alert・confirm・promptとアイコン            | [ダイアログ](references/dialogs.md)               |
| WebMCPの説明・操作・配信と確認              | [WebMCPと実行確認](references/webmcp-delivery.md) |

## 共通の契約

- `init(state)`と`handler(state, event)`は更新後のstateを返す。入力のbindはhandler呼び出し前に更新される。操作部品には安定した`itemId`と明示的なbindを付ける。
- CSS、DOM参照、描画アダプターのAPIをRhaiへ混ぜない。新しい属性・xtype・未登録のRust関数が必要なら、対応版のソース・契約を確認し、エンジン変更が必要な範囲を説明する。エンジン変更には `uivolve-web-engine-dev` を使う。
- 既存ホストAPIの起動設定は[配布契約](../../docs/runtime-distribution.md)に従う。未登録のアダプターを画面宣言だけで利用できるとは考えない。
- 非同期APIは依頼と完了handlerの方式。同期の戻り値やJavaScriptの`async/await`を前提にしない。
- 変更した定義・Rhaiを実WASMのloadと主要イベントへ通す。型違反・失敗時の状態保持と、DOM/Canvasの共有状態を確認する。
