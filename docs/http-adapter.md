# HTTPアダプター: メソッド・パス変数・JSON本文

状態: 実装済み契約。対象は`host_call` → HostEffects → httpAdapter → `host_result`。HTTP以外のアダプター設計は[将来設計](host-adapters-design.md)に分離する。

## APIを選ぶ

| 用途                                                  | 宣言 / 呼び出し                    | 成功データ                                          | エラー                       |
| ----------------------------------------------------- | ---------------------------------- | --------------------------------------------------- | ---------------------------- |
| 固定URLからJSONをGET                                  | requests / http_get(name)          | response.dataが取得JSONそのもの                     | response.errorは文字列       |
| パス変数、query、POST/PUT/PATCH/DELETE/HEAD、JSON本文 | operations / host_call(name, args) | response.data.bodyが応答本文、statusとheadersも持つ | response.errorはオブジェクト |

従来の[GETチュートリアル](tutorial-http-grid.md)のresponse.dataと、新APIのresponse.data.bodyを混同しない。host_callは値を同期で返さない。Rhaiにfetch、await、http_postなどの未登録関数を書かず、宣言した操作を呼ぶ。

## ホストを設定する（JavaScript）

[ランタイム配布](runtime-distribution.md)のruntime-distを`runtime/`へ配置した例。HTMLに空の`<div id="app"></div>`を置き、`./runtime/index.css`を読み込む。boot.jsはアプリのルートに配置する。

```js
import { createRuntime, ResourceClient, httpAdapter } from "./runtime/index.js";

const baseUrl = new URL("./", import.meta.url);
const resources = new ResourceClient({ baseUrl });
const ui = await createRuntime({
  element: document.getElementById("app"),
  baseUrl,
  resources,
  adapters: [httpAdapter({ resources })],
  connections: {
    api: { adapter: "http", baseUrl: new URL("./api/", baseUrl).href },
  },
  onError: (error) => console.error(error.message),
});
await ui.load("screens/orders.yaml");
// ホストを外すとき: ui.dispose()
```

APIエンドポイントは利用者のサーバーで用意する。このライブラリは`./api/`にサーバーを生成しない。baseUrlは末尾/のHTTP(S)ディレクトリURLで、query/fragmentを付けない。相対接続URLは画面URLから解決されるため、複数画面で共有する接続は上のように絶対URLにする。

createApplicationも同じresources、adapters、connectionsを受け取る。connectionsをapp.jsonに置く場合でも、httpAdapterの登録は起動JavaScriptで必要。既定で自動登録されない。JWTは共有ResourceClientへ設定し、画面やRhaiへトークンを渡さない。詳細は[認証契約](authentication.md)。

## 画面を宣言する（screens/orders.yaml）

method、path、response、headers、responseHeadersは必ずoptions内に置く。connection、action、handlerはその外。未知の操作属性は拒否される。

```yaml
version: 1
id: orders
title: 注文の更新
script: orders.rhai
state:
  customerId: "C001"
  orderId: "O123"
  status: "confirmed"
  loading: false
  notice: ""
operations:
  updateOrder:
    connection: api
    action: http.request
    handler: updated
    options:
      method: PATCH
      path: customers/{customerId}/orders/{orderId}
      response: json
ui:
  xtype: container
  layout: vbox
  items:
    - { xtype: textfield, itemId: customerId, bind: customerId, fieldLabel: 顧客ID }
    - { xtype: textfield, itemId: orderId, bind: orderId, fieldLabel: 注文ID }
    - { xtype: button, itemId: save, text: 更新, handler: save, disabledBind: loading }
    - { xtype: label, bind: notice }
```

## 依頼と完了（screens/orders.rhai）

```rhai
fn init(state) { state }
fn save(state, event) {
    host_call("updateOrder", #{
        path: #{customerId: state.customerId, orderId: state.orderId},
        query: #{include: "summary"},
        body: #{status: state.status}
    });
    state.loading = true;
    state
}
fn updated(state, response) {
    state.loading = false;
    if response.ok {
        state.notice = "更新しました: HTTP " + response.data.status.to_string();
        // response.data.body: サーバーのJSON。204/205/HEAD/emptyはunit ()。
    } else {
        state.notice = response.error.code + ": " + response.error.message;
    }
    state
}
```

送信例は`<アプリのルート>/api/customers/C001/orders/O123?include=summary`。本文はJSONで、Content-Typeはapplication/jsonになる。

## パス変数とqueryの規則

- プレースホルダは`{name}`。名前は英数字・ハイフン・アンダースコアからなる。同じ名前を複数回使える。複数の名前も使用可能。
- 値はargs.pathのmapから渡す。文字列・有限の数値・boolを受け付け、文字列化してencodeURIComponentする。日本語や空白、`?`、`#`は自動エンコードされる。事前にURLエンコードしない。`%`も文字として再エンコードされる。
- 未指定、null、配列、map、空文字、`.`、`..`、`/`またはバックスラッシュを含む値は拒否。複数パス区間を1変数へ入れない。余分なargs.pathキーは使用されない。
- options.pathは接続URLからの相対パス。先頭/、絶対URL、query/fragment、バックスラッシュ、不正な波括弧を含めない。解決後も接続のオリジンとベースディレクトリ内に限定する。
- queryはargs.queryのmap。値は文字列・有限の数値・boolで、URLSearchParamsがエンコードする。配列、null、同名キーの複数値は未対応。
- argsはpath、query、bodyだけ。メソッドやURLを呼び出し時のargsで上書きしない。宣言を分けて使用する。

## メソッド・応答・上限

| 項目            | 契約                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| method          | GET、POST、PUT、PATCH、DELETE、HEAD。既定GET。大文字                                     |
| body            | JSON互換値。GET/HEADでは指定不可。text、bytes、multipart送信は未対応                     |
| response        | json、text、empty。既定json。bytesは未対応                                               |
| headers         | options.headers。接続allowedHeadersで許可された固定ヘッダーだけ。既定accept/content-type |
| responseHeaders | 公開する応答ヘッダー名の配列。CORSで非公開のヘッダーはnull                               |
| 操作宣言        | 最大64件。操作名と接続名は英数字・ハイフン・アンダースコア1〜80文字                      |
| 呼び出し        | 1回のhandler最大8件、同時pending最大8件。同名の複数呼び出しも各idで管理                  |
| 容量            | args全体100,000 UTF-8バイト、JSON本文100,000バイト、path宣言2,048文字                    |
| 応答            | 本文900,000バイト、完了JSON全体1,000,000バイトまで                                       |
| 期限            | HostEffects既定15秒。画面置換・disposeで中止を試み、古い世代の完了は破棄                 |

authorization/cookie/host/sec-*は画面指定不可。set-cookie/authorizationは応答ヘッダー公開不可。JWTやCookieはホストの認証設定に従う。別オリジンのPATCHなどではサーバーが使用メソッドとContent-TypeをCORSで許可する必要がある。

成功は`{ok:true, data:{status, headers, body}, error:null}`。失敗は`{ok:false, data:null, error:{code, message, retryable:false, outcome}}`。非2xxはHTTP_404などのcodeで失敗し、失敗本文は返さない。outcomeはnot-started、failed、committed、unknown。更新成功後に応答解析が失敗した場合はcommitted、通信失敗など結果不明はunknownとなる。

通常のRhai/状態検証失敗では未確定の依頼を開始しない。動的なpath/query/bodyのHTTP検証はstate確定後にホストで行い、不正値は完了handlerへ失敗として返す。try/catchだけで通信失敗を受け取ろうとしない。完了handlerが失敗しても外部の更新は巻き戻せず、そのidは消費される。ホストのonErrorにはexternalResultが付く。自動再送を前提にしない。認証の401後の更新・再送はGET/HEADだけで、POST/PUT/PATCH/DELETEは行わない。

実装根拠は[HTTPアダプター](../src/adapters/http.js)、[HostEffects](../src/host-effects.js)、[Rust操作宣言](../engine/src/host.rs)。検証は[既存テスト](../tests/host-adapters.test.js)と[この文書の例のテスト](../tests/documented-http.test.js)。
