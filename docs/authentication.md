# HTTP取得のJWT・CORS対応

画面JSON・Rhai・テーマのHTTP取得は、共通の`ResourceClient`を使う。認証は`none`（既定）または`jwt`。Rust/WASMのDSL・状態・レイアウトには認証情報を渡さない。署名・期限・issuer・audience・アクセス権の判定は配信サーバーの責務で、クライアントは発行済みJWTをBearerヘッダーに載せる。

## デモで切り替える

1. ツールバーの「認証: なし」を開く。
2. JWTを使う場合は「JWT（Bearer）」を選び、発行済みのJWTと送信先オリジンを指定する。既定の入力値はこのページのオリジン。別サーバーへ送る場合はそのオリジンを追加する。
3. 「認証設定を適用」を押す。画面の再取得、別パッケージの読み込み、HTTPでのテーマ切替に適用される。現在の画面・入力・テーマは設定変更だけでは初期化しない。
4. 無効化するには「なし」を選び、設定を適用する。保持するトークンを破棄する。

JWT入力欄はpassword型で、適用後は空にする。設定はページ内メモリにだけ保持する。再読み込み・HMRでは認証なしに戻る。URL、localStorage、sessionStorage、DSL、Rhai、Scene、WebMCPの画面スナップショットへトークンを保存・出力しない。JWTを差し替える場合は新しい値を入力して再適用する。

デモのHTML/JS/CSS/WASMは認証なしで起動する。画面JSON/Rhai/テーマを保護する構成を想定する。同梱の静的サーバーはJWT検証を実装していないため、JWT設定自体で同梱画面へのアクセスが制限されることはない。

## ホストAPI

```js
import { ResourceClient } from "../src/resource-client.js";
import { WasmEngine } from "../src/engine.js";

const resources = new ResourceClient({ baseUrl: window.location.href });
resources.setAuthentication({ mode: "none" });
const engine = await WasmEngine.create(new URL("engine.wasm", window.location.href));

// 発行・ログイン・更新は利用するアプリの認証機構で行う。
resources.setAuthentication({
  mode: "jwt",
  getToken: async ({ signal }) => authSession.getAccessToken({ signal }),
  allowedOrigins: ["https://screens.example.com"],
});

const packageUrl = new URL("https://screens.example.com/screens/app.json");
const screen = JSON.parse(await resources.text(packageUrl));
const script = await resources.text(new URL(screen.script, packageUrl));
engine.load(screen, script);
```

固定トークンは`getToken`の代わりに`token: accessToken`で渡せる。両方は指定しない。`getToken`は許可されたHTTP要求ごとに呼び、現在のトークンを返す。受け取ったAbortSignalを認証機構側でも扱う。JWTの内容はデコードせず、ヘッダーに使えるBearer文字列の形式と空値だけを検査する。

`getAuthentication()`が返すのは`mode / allowedOrigins`だけ。認証なしではAuthorizationヘッダーを付けず、従来どおり同一オリジンのCookieをブラウザが扱う。JWTモードは`credentials: "omit"`でCookieやブラウザのHTTP認証を併用しない。

WASMファイル自体も認証付きで取得するホストでは、起動前にResourceClientへ設定して渡す。

```js
const engine = await WasmEngine.create(new URL("https://screens.example.com/engine.wasm"), {
  resources,
  signal: controller.signal,
});
```

`WasmEngine.create(url)`だけの既存の呼び出しも利用できる。`resources.text(url, { signal })`は既存の1,000,000文字の上限を維持する。`resources.fetch(url, { signal })`は成功したResponseを返し、WASMなどのバイナリ取得にも使える。

## 送信先と失敗時の動作

- 許可リストはscheme・host・portの完全一致。パス・query・fragment・ユーザー情報付きオリジンは設定できない。既定はbaseUrlのオリジン。
- JWTモードでは許可されていないオリジンへの取得を送信前に拒否する。パッケージ内のscript URLから送信先を自動追加しない。
- JWTはHTTPSで送る。ローカル開発の`localhost / 127.0.0.1 / [::1]`のHTTPだけ例外とする。
- JWT付き取得は`cache: "no-store"`、`redirect: "error"`。同一オリジンを含めリダイレクトに追従せず、最終URLを直接指定する。認証なしは従来どおり追従する。
- 401/403は認証・権限エラーとして表示する。JWTを外した再試行、ログインページへの遷移、自動更新は行わない。新しいトークンを適用して手動で再取得する。
- 取得やコンパイルの失敗は表示中の画面・状態・revision、適用中のテーマを維持する。取得中はデモの認証設定を変更できない。APIで設定を変更した場合、共通クライアントで読み込み中の画面・スクリプト・テーマの応答は破棄する。`fetch()`で返したResponseを利用するホストは、その後の本文読み込み・適用を管理する。

画像・動画・iframeはブラウザのネイティブURL読み込みで、今回のBearerヘッダーの対象外。保護されたメディアには署名付きURLなどの別契約が必要。HTML/JS/CSS・外部フォント・Rhai内の非同期通信もこのAPIの対象ではない。ログイン、JWTの発行・更新、サーバーの検証処理、WASM内のJWT検証は未実装。

## CORSを標準で扱う

共通クライアントの取得は`mode: "cors"`。同梱のVite+開発・プレビューサーバーは、公開デモ資源用に次のCORS設定を既定で持つ。

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

別オリジンへBearerヘッダーを送る場合、ブラウザはOPTIONSプリフライトを行う。配信サーバーはOPTIONSへ2xxで応答し、上のヘッダーを返す。Authorizationは許可ヘッダーに明記する。GETの成功・401・403応答にもAccess-Control-Allow-Originを付ける。OPTIONSにはBearerが付かないので、JWT検証より先に処理する。

JWTモードはCookieを送らないため、公開デモの`*`で利用できる。本番の配信サーバーでは利用するWebアプリのオリジンへ制限できる。複数オリジンを動的に許可する場合は、その許可リストを検査して値を返し、`Vary: Origin`を付ける。JWTの送信先許可リストと、配信側のCORS許可リストは別の設定。

クライアントのCORSモードとデモの設定は、他サーバーのCORS制限を解除するものではない。`dist/`を別の静的サーバーに置く場合も、その配信側へCORS設定が必要。変更したVite設定は開発サーバー・プレビューを再起動して反映する。

根拠は[Bearer Token Usage（RFC 6750）](https://www.rfc-editor.org/rfc/rfc6750.html)、[MDNのCORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)、[リダイレクトの扱い](https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected)。HTTP取得・JWT切替・送信先・中断・WASM起動の自動テストは`tests/resource-client.test.js`に置く。

## 実装時の確認

2026-10-02：自動テスト65件（Vitest 62、Rust 3）、本番ビルド・静的チェック・文書リンク確認が成功。Chromiumで別オリジンのHTTPサーバーを使い、JWT付きJSON/Rhai/テーマの取得、OPTIONS、401/403時の状態保持、未許可script・リダイレクト拒否、認証無効化・再読み込み、DOM/Canvas編集、WebMCPへの非公開、390pxの表示を確認した。Vite+の開発4173・プレビュー4174の両方で、別オリジンからBearerヘッダー付きの取得が成功した。

ブラウザ確認は一時Playwrightスクリプトによるもの。サーバーのテスト用トークン照合はBearer送信を確認するfixtureであり、JWT署名・期限の検証処理ではない。既存のHTTP読み込み・テーマ・native WebMCPの3シナリオも回帰確認した。
