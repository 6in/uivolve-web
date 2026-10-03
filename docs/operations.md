# 起動・配信・更新

GitHub Pagesでの公開とActionsによるスキル配布は[GitHub配布手順](github-publishing.md)にまとめる。

開発に必要な環境と基本コマンドは[README](../README.md)を参照する。uivolve-webの画面処理はブラウザ内で実行され、配信側には静的HTTPサーバーが必要。

## 開発とプレビュー

```sh
bun install --frozen-lockfile
bun run dev
```

開発サーバーは`http://127.0.0.1:4173/`。起動時にWASMをビルドする。Rustを編集した場合は`bun run build:wasm`で再ビルドして画面を再読み込みする。画面JSON/Rhaiは「再取得」または定義エディタの「変更を適用」で検証できる。

```sh
bun run build
bun run preview
```

本番ビルドのプレビューは`http://127.0.0.1:4174/`。`/pages/layout-lab`などで画面を指定できる。旧`?screen=layout-lab`も対応する。プレビューは`dist/`を配信するため、ソースを編集した後は本番ビルドを更新する。両ポートはstrictPort設定で、使用中なら別ポートへ自動移動しない。既存サーバーを確認するか、必要に応じてVite+へ明示的なポートを渡す。

## 静的配信

配布物は`dist/`一式。ビルドされたHTML/JS/CSS、`engine.wasm`、`screens/`のJSONとRhai、`themes/`、`assets/`、第三者通知をまとめて置く。ビルド環境にはBun・Node・Rustが必要だが、静的配信先でそれらを実行する必要はない。

Viteのbaseは`/`。深いページURLでも同じ配信ルートから資源を取得する。サブディレクトリ`/demo/`に配信するなら`bun run build -- --base=/demo/`でビルドし、その下にdist一式を配置する。`/demo/pages/http-grid`も使用できる。

`/pages/...`はindex.htmlへフォールバックし、WASM・JSON・YAML・Rhaiなどの資源はそのまま返す。見つからないアセットには404を返す。例えばNginxのルート配信設定:

```nginx
location /pages/ { try_files $uri /index.html; }
location / { try_files $uri $uri/ =404; }
```

サブディレクトリでは上記の`/pages/`と`/index.html`に`/demo`を付ける。配布物のルートをroot等で指定する設定はサーバーの構成に合わせる。Vite開発・プレビューはSPAのフォールバックを提供する。

画面とscriptはHTTP/HTTPSのURLで取得する。scriptはパッケージURLを基準に解決し、メディアの相対URLもパッケージを基準にする。別オリジンへ置いた画面・script・テーマには配信側のCORS設定が必要。WebMCPの利用条件は[WebMCP契約](webmcp.md)を参照する。

HTTP取得はCORSモードが既定。Vite+開発・プレビューは公開デモ用のCORSヘッダーとAuthorizationプリフライト許可を返す。`dist/`を別サーバーへ配信した場合、この設定は自動では引き継がれない。認証付き画面を配信するには、そのサーバーでJWTを検証し、OPTIONSと401/403にもCORSヘッダーを返す。[JWT・CORS契約](authentication.md)を参照する。

現在はfile://での直接起動や単一HTMLへの全資源埋め込みには対応していない。

## 更新時の確認

- エンジンを更新したときはWASMとブラウザJSも含む配布物を同時に更新する。
- JSON/Rhaiはエンジンとは別に更新できるが、そのエンジンが受け付ける属性・イベントを使う。[画面契約](screen-format.md)を基準にする。
- 「画面を再取得」はWASMもHTTPから再取得し、現在のテーマを引き継いだ新しいエンジンで画面を読み直す。取得・コンパイル・initが成功してから置換し、失敗時は前のエンジン・画面・状態を保つ。画面状態は初期化される。通常の画面切替はエンジンを再取得しない。
- ブラウザJSを更新した場合はブラウザのページ自体を再読み込みする。画面だけの再取得では、ページが保持する古いJSは更新されない。RhaiのFunction not foundが出たら、配信中のエンジンとページが保持しているエンジンの差も確認する。
- 正常取得だけでなく、取得エラー、壊れたJSON/Rhai、init失敗を確認する。候補が失敗しても以前の画面・状態が残ることを確認する。

受注・タスクなど従来のデモはメモリ内状態を使う。「保存・型・YAML」は明示的にIndexedDB/OPFSへ保存する。再取得でstate自体は初期化されるが、保存レコードは残り「復元」で取り戻せる。サーバー保存や永久保持の保証はない。[保存契約](platform-features.md)を参照。

## 主なエラーの見方

| 症状                     | 確認すること                                                    |
| ------------------------ | --------------------------------------------------------------- |
| WASMの取得・解析失敗     | `engine.wasm`の有無、HTTPステータス、誤ってHTMLを返していないか |
| 画面/scriptの取得失敗    | 相対URLの基準、script属性、CORS、Rhaiファイルの配信             |
| 未知属性・xtype          | 取得したエンジンと画面パッケージの契約が一致するか              |
| 画面に編集が反映されない | 開発4173かプレビュー4174か、dist/WASMの再ビルドと再取得         |
| WebMCPが未対応           | ブラウザAPIとsecure context。通常UIは別に確認する               |
| WebMCPのSTALE_SCREEN     | ui_get_screenを再取得し、最新token/revisionを使う               |
