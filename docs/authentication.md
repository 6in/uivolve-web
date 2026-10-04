# HTTP取得のJWT・CORS対応

画面JSON・Rhai・テーマのHTTP取得は、共通の`ResourceClient`を使う。認証は`none`（既定）または`jwt`。Rust/WASMのDSL・状態・レイアウトには認証情報を渡さない。署名・期限・issuer・audience・アクセス権の判定は配信サーバーの責務で、クライアントは発行済みJWTをBearerヘッダーに載せる。

## デモで切り替える

1. ツールバーの「認証: なし」を開く。
2. JWTを使う場合は「JWT（Bearer）」を選び、発行済みのJWTと送信先オリジンを指定する。既定の入力値はこのページのオリジン。別サーバーへ送る場合はそのオリジンを追加する。
3. 「認証設定を適用」を押す。画面の再取得、別パッケージの読み込み、HTTPでのテーマ切替に適用される。現在の画面・入力・テーマは設定変更だけでは初期化しない。
4. 無効化するには「なし」を選び、設定を適用する。保持するトークンを破棄する。

自動更新には「アクセストークンを自動更新する」を有効にし、更新URL・リフレッシュトークン・更新APIの形式を指定する。JWTの残り有効秒数は任意。未指定なら401時に更新する。

JWT・リフレッシュトークンの入力欄はpassword型で、適用後は空にする。設定はページ内メモリにだけ保持する。再読み込み・HMRでは認証なしに戻る。URL、localStorage、sessionStorage、DSL、Rhai、Scene、WebMCPの画面スナップショットへトークンを保存・出力しない。設定を差し替える場合は両方のトークンを入力して再適用する。

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

`getAuthentication()`は`mode / allowedOrigins`と、自動更新設定がある場合に`refresh: { url, format }`を返す。トークンは返さない。認証なしではAuthorizationヘッダーを付けず、従来どおり同一オリジンのCookieをブラウザが扱う。JWTモードは`credentials: "omit"`でCookieやブラウザのHTTP認証を併用しない。

WASMファイル自体も認証付きで取得するホストでは、起動前にResourceClientへ設定して渡す。

```js
const engine = await WasmEngine.create(new URL("https://screens.example.com/engine.wasm"), {
  resources,
  signal: controller.signal,
});
```

`WasmEngine.create(url)`だけの既存の呼び出しも利用できる。`resources.text(url, { signal })`は既存の1,000,000文字の上限を維持する。`resources.fetch(url, { signal })`は成功したResponseを返し、WASMなどのバイナリ取得にも使える。

## リフレッシュトークンによる自動更新

```js
resources.setAuthentication({
  mode: "jwt",
  token: accessToken,
  allowedOrigins: ["https://screens.example.com"],
  expiresIn: 3600, // 現在のJWTの残り有効秒数。省略可。
  refresh: {
    url: "https://auth.example.com/refresh",
    token: refreshToken,
    format: "json", // 既定。OAuth形式なら "oauth"。
  },
});
```

トークンは発行済みの値を指定する。リフレッシュトークンはJWTの形式に限定しない。`getToken`と組み込みの`refresh`は併用しない。独自の認証SDKを使う場合は引き続き`getToken`に任せる。

| 形式    | 送信                                                                                  | 成功時のJSON応答                                                                        |
| ------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `json`  | POST、application/json、`{ "refreshToken": "..." }`                                   | `accessToken`必須。`refreshToken / expiresIn / tokenType`任意。tokenTypeはBearerのみ。  |
| `oauth` | POST、application/x-www-form-urlencoded、`grant_type=refresh_token&refresh_token=...` | `access_token / token_type`必須。token_typeはBearer。`refresh_token / expires_in`任意。 |

OAuth形式では`refresh.clientId`に公開クライアントIDを追加できる。client secretをブラウザへ配置する設定は提供しない。別の認証・Cookie方式や応答形式が必要なら、ホストの認証SDKと`getToken`を使う。

更新URLは独立した送信先で、JWTの送信先許可リストへ加える必要はない。HTTPSとローカルHTTPの規則はJWTと同じ。userinfo・fragment付きURLを拒否する。リフレッシュトークンはこのURLのPOST本文だけへ送る。更新要求にはAuthorization・Cookieを付けず、CORS、no-store、リダイレクト拒否を使う。

- 有効秒数があれば、次のHTTP要求時に期限前の更新を行う。猶予は最大30秒、短い寿命ではその半分。定期タイマーによる更新やJWTのexpのデコードは行わない。
- 401なら更新し、同じGETを1回だけ再試行する。HTTPアダプターではHEADも対象で、POST/PUT/PATCH/DELETEの401後の更新・再送は行わない。403、通信・CORS失敗、5xxでは更新しない。更新設定がなければ従来どおりエラーを返す。
- 同じResourceClientの同時取得は1つの更新要求を共有する。遅れた旧世代の401も更新後のトークンを使う。別インスタンス・別タブ間では共有しない。
- 応答全体を検証してから両トークンを差し替える。新しいリフレッシュトークンが省略された場合は以前の値を維持する。有効秒数も省略された場合は、その後は401時に更新する。
- 更新待ちは10秒、JSON応答本文は64,000文字まで。更新拒否・通信失敗・無効な応答・再試行後の401ではセッションを停止し、保持するトークンを破棄する。匿名取得や自動再ログインへ切り替えず、新しい認証設定を必要とする。
- 1つの取得のキャンセルはその待機・再試行を止める。共有する更新は継続し、ローテーション結果を保持する。認証なしへの切替・設定変更は更新要求自体も中止し、遅れた応答で古い認証を復元しない。

手動更新は`await resources.refreshAuthentication({ signal })`。戻り値は設定メタデータで、トークンは含まない。更新設定がなければエラーになる。画面state/revisionは変更しない。

更新API側でリフレッシュトークンを検証・失効・ローテーションする。形式とローテーションの根拠は[RFC 6749 §6](https://www.rfc-editor.org/rfc/rfc6749.html#section-6)、[RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14)。

## 送信先と失敗時の動作

- 許可リストはscheme・host・portの完全一致。パス・query・fragment・ユーザー情報付きオリジンは設定できない。既定はbaseUrlのオリジン。
- JWTモードでは許可されていないオリジンへの取得を送信前に拒否する。パッケージ内のscript URLから送信先を自動追加しない。
- JWTはHTTPSで送る。ローカル開発の`localhost / 127.0.0.1 / [::1]`のHTTPだけ例外とする。
- JWT付き取得は`cache: "no-store"`、`redirect: "error"`。同一オリジンを含めリダイレクトに追従せず、最終URLを直接指定する。認証なしは従来どおり追従する。
- 401は任意のリフレッシュ設定があれば上記の更新・再試行を行い、403は権限エラーとして表示する。JWTを外した再試行やログインページへの遷移は行わない。
- 取得やコンパイルの失敗は表示中の画面・状態・revision、適用中のテーマを維持する。取得中はデモの認証設定を変更できない。APIで設定を変更した場合、共通クライアントで読み込み中の画面・スクリプト・テーマの応答は破棄する。`fetch()`で返したResponseを利用するホストは、その後の本文読み込み・適用を管理する。

Rhaiの宣言GETとHTTPアダプター、Unary RPC、画面が参照するRPC Descriptorにも共通ResourceClientを使う。RPCのPOSTで401後のrefresh・再送を許可するのは`idempotent: true`の宣言だけ。事前の期限更新は従来通り。公開ソースのOPFS配信キャッシュはJWTモードでは無効。[RPC・キャッシュ契約](files-cache-rpc.md)を参照する。

画像・動画・iframeはブラウザのネイティブURL読み込みで、Bearerヘッダーの対象外。保護されたメディアには署名付きURLなどの別契約が必要。HTML/JS/CSS・外部フォントはこのAPIの対象ではない。ログイン、JWTの発行・更新サーバー、サーバーの検証処理、WASM内のJWT検証は未実装。

## CORSを標準で扱う

共通クライアントの取得は`mode: "cors"`。同梱のVite+開発・プレビューサーバーは、公開デモ資源用に次のCORS設定を既定で持つ。

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

別オリジンへBearerヘッダーを送る場合、ブラウザはOPTIONSプリフライトを行う。配信サーバーはOPTIONSへ2xxで応答し、上のヘッダーを返す。Authorizationは許可ヘッダーに明記する。GETの成功・401・403応答にもAccess-Control-Allow-Originを付ける。OPTIONSにはBearerが付かないので、JWT検証より先に処理する。

JSON形式の更新POSTにもOPTIONSが必要。更新サーバーはPOSTとContent-Typeを許可し、成功・失敗の応答にもCORSヘッダーを返す。同梱のVite+はPOSTのCORS許可を持つが、更新エンドポイント自体は提供しない。

JWTモードはCookieを送らないため、公開デモの`*`で利用できる。本番の配信サーバーでは利用するWebアプリのオリジンへ制限できる。複数オリジンを動的に許可する場合は、その許可リストを検査して値を返し、`Vary: Origin`を付ける。JWTの送信先許可リストと、配信側のCORS許可リストは別の設定。

クライアントのCORSモードとデモの設定は、他サーバーのCORS制限を解除するものではない。`dist/`を別の静的サーバーに置く場合も、その配信側へCORS設定が必要。変更したVite設定は開発サーバー・プレビューを再起動して反映する。

根拠は[Bearer Token Usage（RFC 6750）](https://www.rfc-editor.org/rfc/rfc6750.html)、[MDNのCORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)、[リダイレクトの扱い](https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected)。HTTP取得・JWT切替・送信先・中断・WASM起動の自動テストは`tests/resource-client.test.js`に置く。

## 実装時の確認

2026-10-02：自動テスト65件（Vitest 62、Rust 3）、本番ビルド・静的チェック・文書リンク確認が成功。Chromiumで別オリジンのHTTPサーバーを使い、JWT付きJSON/Rhai/テーマの取得、OPTIONS、401/403時の状態保持、未許可script・リダイレクト拒否、認証無効化・再読み込み、DOM/Canvas編集、WebMCPへの非公開、390pxの表示を確認した。Vite+の開発4173・プレビュー4174の両方で、別オリジンからBearerヘッダー付きの取得が成功した。

ブラウザ確認は一時Playwrightスクリプトによるもの。サーバーのテスト用トークン照合はBearer送信を確認するfixtureであり、JWT署名・期限の検証処理ではない。既存のHTTP読み込み・テーマ・native WebMCPの3シナリオも回帰確認した。

同日のリフレッシュ対応追加後：自動テスト80件（Vitest 77、Rust 3）とビルド・静的チェック・文書リンク確認が成功。JSON/OAuth、期限前更新、共有更新、遅れた401、キャンセル・認証解除、失敗・タイムアウトの15テストを追加した。ブラウザで更新POSTのCORS、401からの更新・再試行、ローテーション後のテーマ取得、invalid_grant時の停止・状態保持、OAuth公開クライアントと省略されたrefresh_token、リダイレクト拒否、JWT無効化・再読み込み、狭い幅を確認した。既存のJWT/CORSとnative WebMCPも回帰確認した。

本文付きHTTPとパス変数の具体例は[現行HTTP契約](http-adapter.md)。APIサーバーのCORS許可メソッドは使用する操作に合わせる。過去の実装時の確認件数は履歴で、現在の全体テスト数ではない。
