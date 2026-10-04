# WebWorkerモックAPI（最小版）

状態: 実装済み。応答と初期データは独立したJSON/YAML DSLで定義し、画面の`operations`と`host_call`は[HTTP契約](http-adapter.md)をそのまま使う。ホストの接続を`worker-mock`へ向けると、更新先はWebWorkerのメモリになる。画面のリクエストに応答データを混ぜず、同じAPIを複数の画面から使える。

## 起動コード

配布版`runtime-dist`を`runtime/`へ置く。HTMLに`#app`と`./runtime/index.css`を用意し、アプリのルートに次のboot.jsを置く。HTTPアダプターはランタイムに組み込み済みだが、worker-mockは明示的に登録する。

```js
import { createRuntime, ResourceClient, workerMockAdapter } from "./runtime/index.js";

const baseUrl = new URL("./", import.meta.url);
const resources = new ResourceClient({ baseUrl });
const ui = await createRuntime({
  element: document.getElementById("app"),
  baseUrl,
  resources,
  adapters: [workerMockAdapter({ resources })],
  connections: {
    ordersMock: {
      adapter: "worker-mock",
      baseUrl: new URL("mock-api/", baseUrl).href,
      definition: new URL("mock/orders-api.yaml", baseUrl).href,
    },
  },
  onError: (error) => console.error(error.message),
});
await ui.load("screens/worker-orders.yaml");
// ホストを外すとき: ui.dispose()
```

baseUrlは末尾/のHTTP(S)ディレクトリURLで、HTTPの相対パス検証に使う仮想的な名前空間。ここへ実際のHTTPリクエストは送らない。definitionはHTTP(S)で取得するJSON/YAMLのURL。同じResourceClientを共有するので、定義ファイルの取得には既存の認証・取得ポリシーが適用される。WorkerのCRUDはHTTPヘッダーやJWTによる認証を行わない。任意ヘッダーに応じた動作分岐もない。

createApplicationでも同じadapters/connectionsを渡せる。接続設定をapp.jsonに置いてもworkerMockAdapterの登録はJavaScriptで必要。実サーバーへ切り替えるときは接続のadapterをhttpに変え、definitionを削除してbaseUrlを実APIへ向ける。画面とRhaiの呼び出しは同じ形式で使える。

## モックDSL

```yaml
version: 1
collections:
  orders:
    key: id
    seed:
      - { id: O001, customer: 山田商店, total: "2640" }
routes:
  listOrders: { method: GET, path: orders, operation: list, collection: orders }
  getOrder: { method: GET, path: "orders/{id}", operation: get, collection: orders }
  createOrder: { method: POST, path: orders, operation: insert, collection: orders }
  updateOrder: { method: PATCH, path: "orders/{id}", operation: update, collection: orders }
  deleteOrder: { method: DELETE, path: "orders/{id}", operation: delete, collection: orders }
  reset: { method: POST, path: reset, operation: reset }
  health: { method: GET, path: health, response: { status: 200, body: { ready: true } } }
```

これは画面DSLとは別のファイル。画面にcollections/routes/responseを追加しない。未知属性はエラー。JavaScript、式、ハンドラ文字列は実行しない。YAMLのアンカーや独自タグも既存パーサーが拒否する。

| 操作         | メソッド                       | パス変数 | 動作と応答                                                        |
| ------------ | ------------------------------ | -------- | ----------------------------------------------------------------- |
| list         | GET                            | なし     | 挿入順の全件配列、200                                             |
| get          | GET                            | 1個      | 対象のレコード、200。未存在404                                    |
| insert       | POST                           | なし     | JSON objectを追加、201。キー省略時M1、M2…を採番。重複/不正キー409 |
| update       | PATCH                          | 1個      | JSON objectを浅くマージ、200。未存在404、キー変更409              |
| delete       | DELETE                         | 1個      | 対象を削除、204・本文なし。未存在404                              |
| reset        | POST                           | なし     | 全コレクションをseedへ戻す、採番もリセット。200と`{reset:true}`   |
| 固定response | GET/POST/PUT/PATCH/DELETE/HEAD | 任意     | 宣言したstatus/bodyを返す。collection/operationと併用不可         |

collection/routeの名前とkeyは英数字・ハイフン・アンダースコア1〜80文字。seedはレコード配列で、各レコードはkeyに一意の空でない文字列を持つ。bodyのキーも文字列。パス変数は区間全体の`{id}`などで定義し、item操作ではその値をcollectionのキーとして使う。パスは先頭/、空区間、`.`、`..`、query/fragment、バックスラッシュを含まない。request時の値のエンコードはHTTPアダプターと共通。固定区間が多いルートを優先し、同じメソッドとパス構造の重複を拒否する。

固定responseのstatusは200〜599の整数。body省略時null。204/205/304に本文は指定できず、HEADは本文を返さない。2xx以外は通常HTTPと同様に完了handlerへHTTP_404などの失敗を返す。失敗本文は公開しない。未定義パス404、パスはあるがメソッド不一致405。

## 画面から使う

```yaml
operations:
  createOrder:
    connection: ordersMock
    action: http.request
    handler: created
    options: { method: POST, path: orders, response: json }
```

```rhai
fn create(s, e) {
    host_call("createOrder", #{body: #{customer: s.customer, total: s.total}});
    s.loading = true;
    s
}
fn created(s, r) {
    s.loading = false;
    if r.ok { s.id = r.data.body.id; }
    else { s.notice = r.error.code + ": " + r.error.message; }
    s
}
```

完全な実行例は[受注画面](../public/screens/worker-orders.yaml)、[Rhai](../public/screens/worker-orders.rhai)、[モック定義](../public/mock/orders-api.yaml)。比較デモの`/pages/worker-orders`で一覧・取得・登録・更新・削除・リセットを試せる。顧客名はNFKCとtrim、金額は10進文字列と税率10％、期限は受注日の14日後として計算する。新規登録は編集中のIDを使わず自動採番する。

## 寿命・上限・最小版の範囲

- Workerは最初の呼び出し時に作成。同じadapter内の同じdefinition URLは1つのWorkerを共有。別のadapter/タブは独立。画面切替・再loadでデータを保持し、runtime.disposeでWorkerを終了する。ページ再読込とresetで初期データに戻る。definitionは同じホスト内で再取得しない。
- Workerは到着順に同期処理し、更新後のGETが更新を読める。画面置換・タイムアウトは待機と古い画面への完了を中止するが、既にWorkerへ送った更新は取り消さない。自動再送はしない。
- 定義1 MB、16コレクション、64ルート、各コレクション1,000行、全データ1 MB、body100 KB、クライアント待機64件。HostEffectsの同時8件・既定15秒、HTTP応答900 KBの上限も適用する。Worker初期化にも15秒の期限がある。更新後の応答検証失敗では更新が残る。
- queryは空のみ。検索・ページング・遅延・障害シナリオ・永続保存・PUTによる置換・DB・WebSocketは今回の範囲外。返却オブジェクトの業務スキーマは検証しないので、seedとbodyの項目を画面の契約に揃える。

画面を介さずホストから呼ぶ場合は配布版の`createMockApi({url, resources})`をawaitし、`request({method,path,body}, signal)`、`reset()`、`dispose()`を使える。pathは相対パスで、動的区間の値はencodeURIComponentする。この直接APIはHTTPエラーも`{status,headers,body}`として返し、非2xxを例外にしない。構築やWorkerの失敗は例外になる。

実装は[モデル](../src/mock-api-model.js)、[Worker](../src/mock-api-worker.js)、[クライアント](../src/mock-api-client.js)、[アダプター](../src/adapters/worker-mock.js)。契約・WASMとの接続は[テスト](../tests/worker-mock.test.js)で確認する。
