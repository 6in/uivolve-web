# WebMCP接続

WebMCPはブラウザを介してページ内の構造化ツールをAIへ公開するAPI。この試作では、描画アダプターと別の`src/webmcp.js`から共通WASMエンジンへの操作を公開する。Canvasを画像認識でクリックせず、DOM版と同じ状態・検証・Rhaiハンドラを使える。

2026-10-02に確認した[W3Cコミュニティグループ草案](https://webmachinelearning.github.io/webmcp/)と[ChromeのImperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)に合わせ、`document.modelContext.registerTool(tool, {signal})`を使用する。仕様は草案で、APIや対応環境は変わり得る。`navigator.modelContext`を公開する旧プレビューにも対応する。登録部分は`registerUiTools`へ隔離し、ツール定義は`createUiTools(host)`で独立してテストできる。

APIがないブラウザには登録しない。グローバルAPIの偽装やpolyfillは追加しない。ページのWEBMCP表示は「5 tools」「未対応」「登録失敗」で実際の登録結果を示す。通常の画面操作はそのまま使える。

## 共通ツール

| 名前            | 操作                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| ui_list_screens | 同梱の画面IDとタイトルを取得                                                                   |
| ui_get_screen   | 現在の画面token・revision、表示中の部品、値、操作payload、許可action、モーダル／メニューを参照 |
| ui_get_state    | 指定したトップレベル状態キーを参照。配列はページ分割                                           |
| ui_dispatch     | 表示中の部品keyへ一つのイベントを送り、WASMで実行してDOM／Canvasへ反映                         |
| ui_load_screen  | 同梱の画面IDをHTTPから読み込み、初期状態で開く                                                 |

読み取りの3ツールは`readOnlyHint: true`。画面・入力・Rhai診断には外部パッケージやユーザー由来の文字列が含まれるため`untrustedContentHint: true`。ツール結果はJSONの`{ok:true,...}`または`{ok:false,error:{code,message}}`。MCPサーバーの結果ラッパーに依存しない。

`ui_get_screen`はWASMの部品スナップショットを読む。CSSセレクターや座標を使わない。`widgets`は既定100件、最大200件で、`nextOffset`から続きを取得できる。Gridは表示中のページだけを返す。`actions`の空文字列は通常のボタン／フィールド操作。`blocked`がtrueの部品は操作できない。非操作部品の`actions`は空配列。

`ui_get_state`は1〜10個のキーを指定する。配列は既定25件、最大50件で、total / offset / nextOffsetを返す。入れ子の配列・オブジェクトは50項目、文字列2,000文字、深さ6、値1,000個までのプレビュー。省略した場合は`truncated:true`。全状態を無制限に返す機能ではない。

[独自ダイアログ](dialogs.md)の回答待ちは`busy:true`となり、`ui_dispatch / ui_load_screen`の背景変更は`BUSY`になる。`ui_get_screen.dialog`は現在の`id / operation / title / message / icon`と、promptの入力`value`を制限付きで参照する。iconは標準名または任意文字／解決済み画像URLとalt。非表示時はnull。ダイアログの回答はそのUIから行い、専用の回答ツールはまだ提供しない。

## 操作手順

1. `ui_get_screen`で現在の画面と部品を読む。
2. `screen.token`を`screenToken`、`revision`を同名の引数にコピーする。
3. 部品の`key`と必要な`payload`で`ui_dispatch`を実行する。payloadは部品の既定payloadへマージする。
4. 成功結果のrevisionを使う。状態が変わったら画面を再参照し、表示中の部品を確認する。

Gridの例（tokenとrevisionは毎回最新値に置き換える）:

```json
{
  "screenToken": "...",
  "revision": 0,
  "key": "inventory:cell:2:customer",
  "payload": { "action": "beginEdit" }
}
```

編集開始後は同じkeyが入力部品になる。`{"value":"新しい顧客名"}`を送ると既定action=draftで下書きを更新し、`{"action":"commitEdit"}`で確定、`{"action":"cancelEdit"}`で破棄する。WASMによる型・範囲検証とRhaiによる業務検証を通す。Rhaiが失敗すると行と下書きを保持する。型付き入力や選択肢の値は[画面契約](screen-format.md)、Gridの詳細は[Grid契約](grid-navigation.md)を参照。

画面tokenは読み込み・定義適用ごとに新しく発行する。同じ画面を再読み込みしてrevisionが0へ戻っても古い操作を拒否する。人の操作でrevisionが進んだ場合も`STALE_SCREEN`になる。表示から消えたkeyは`NOT_VISIBLE`、無効／読み取り専用／モーダル背後は`BLOCKED`。読み込み・配色変更・ベンチマーク中の変更は`BUSY`。WASMがイベントを受け付けずrevisionが進まなければ`NOT_APPLIED`とし、成功扱いしない。

## 登録・中断・対応環境

ツールは起動時に一度登録し、画面切替後も現在の状態を参照する。登録用AbortControllerを所有し、ViteのHMR時に自分のツールだけを解除する。登録途中で失敗しても登録済み分を解除する。旧APIではunregisterToolも使用する。provideContext / clearContextで他のツールを消去しない。

実行時にブラウザから渡されたAbortSignalはHTTP取得へ渡し、WASMへの確定前にも中断と画面token／revisionを確認する。中断された取得は現在の画面を置き換えない。既に完了した同期イベントを取り消すundo機能は含まない。

**検証環境の制限:** Chromium 152では登録・発見・実行を確認したが、executeコールバックへAbortSignalが渡されず、消費側のexecuteToolをキャンセルしても進行中のダウンロードをアプリへ通知しなかった。この環境では画面切替が後から完了し得る。アプリの中断処理はSignalを渡す実装向けに用意し、Signalありの中断・確定前チェックをテストする。ブラウザのキャンセル操作だけで処理停止を保証したとは扱わない。

WebMCPを使うには対応ブラウザとsecure contextが必要。Chromeのローカル開発では[公式の開始手順](https://developer.chrome.com/docs/ai/webmcp#local-webmcp)を参照。今回のネイティブ確認はテスト専用ChromiumをWebMCP有効で起動し、通常のユーザーブラウザ設定は変更していない。

## 次の拡張点

現段階は試作用の共通操作契約。任意URLの読み込み、スクリプト評価、状態への直接書き込みはツールに含めない。ui_load_screenは同梱画面だけを受け付け、状態を初期化する。

画面と部品には任意の`webmcp: {label, description, tags}`を記述できる。`ui_get_screen.screen.webmcp`と`widgets[].metadata.webmcp`へ公開し、stateSchemaも同ツールのプレビューへ含める。省略したschema内容は`stateSchemaTruncated:true`で通知する。上限・記法は[ブラウザ機能の契約](platform-features.md)を参照。これらは説明情報で、共通ツールの許可action・入力schemaや認可を変更しない。

業務アプリでは、DSLから「注文検索」「見積確定」などの入力schema・結果schemaを宣言し、WASMのハンドラへ接続する専用ツールを追加する余地がある。公開する状態キー、操作ごとの権限・確認、機密値の扱いもその契約に含める。専用ツールのDSL属性・認可・外部MCPサーバー・クロスオリジン公開は今回の実装範囲に含まない。
