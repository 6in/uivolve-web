# WebMCP・配信・検証

[WebMCP契約](../../../docs/webmcp.md)、[メタデータ](../../../docs/platform-features.md)、[運用手順](../../../docs/operations.md)を必要な範囲で読む。

- webmcpで画面・部品の説明を宣言する。説明は認可や任意handler実行の権限ではない。専用業務ツール用のDSL属性は未実装。
- 操作するAIはui_get_screenで可視key/actionsと最新screen.token/revisionを読み、ui_dispatchへ渡す。STALE_SCREENなら再参照し、Rhai検証エラーなら入力を修正する。DOM/Canvas専用の状態変更経路を作らない。
- 外部アプリでは定義とscriptをHTTP配信し、既存ホストのローダーへ接続する。`/pages/<id>`はデモホストの画面カタログとSPA fallbackの仕組みで、任意の画面ファイル名から自動生成されるAPIではない。
- デモへ追加する場合だけpublic/screens、src/screen-catalog.js、index.htmlの選択欄を更新する。配信マニフェストとキャッシュの利用は[配信契約](../../../docs/files-cache-rpc.md)に従う。
- 別オリジンへ置くならサーバー側のCORSが必要。認証は[JWT/CORS契約](../../../docs/authentication.md)に従う。画面へトークンを埋め込まない。
- 実WASMのloadで定義・Rhai・initを検証し、入力とhandlerの結果を確認する。DOM/Canvasから同じ操作をして同じstateを得ることを見る。対応ブラウザではWebMCPの主要操作も確認する。
- スクリプトのFunction not foundや表示が更新されない場合は対象版のAPI、配信ファイル、開発/previewポート、古いWASMを確認する。デモの「画面を再取得」はWASMも更新するが、JS更新後はページ全体を再読み込みする。file://起動は未対応。
