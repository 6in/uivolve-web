# HTTPでJSONを取得してグリッドへ表示する

「HTTP JSON・グリッドへ表示」を選ぶか、プレビューの`http://127.0.0.1:4174/?screen=http-grid`を開く。「JSONを取得」を押すと、HTTP GETで商品一覧を受け取り、DOM版・Canvas版へ同じデータを表示する。認証設定は不要。

サンプルは[画面JSON](../public/screens/http-grid.json)、[Rhai](../public/screens/http-grid.rhai)、[応答JSON](../public/data/products.json)の3ファイル。既存の静的HTTPサーバーだけで動き、専用のAPIサーバーは不要。商品一覧は起動時に埋め込まず、押下のたびに実際にHTTP取得する。

## 取得先と受け取り関数を宣言する

画面JSONのトップレベルに`requests`を置く。URLは**画面JSONのURLを基準**に解決する。

```json
"requests": {
  "products": {
    "url": "../data/products.json",
    "handler": "productsReceived"
  }
}
```

`products`は通信の名前、`productsReceived`はRhaiの受け取り関数。取得先を別のAPIへ置き換える場合も、このURLを変更する。同梱データは次のような配列を返す。

```json
[
  { "id": 1, "name": "りんご", "price": 180, "stock": 24 },
  { "id": 2, "name": "みかん", "price": 120, "stock": 40 }
]
```

このサンプルではid・価格・在庫は整数、商品名は文字列。idは一意、価格と在庫は0以上。別形式のAPIには受け取り関数で変換・検証を追加する。

## ボタンから通信を依頼する

```json
{
  "xtype": "button",
  "itemId": "loadProducts",
  "text": "JSONを取得",
  "handler": "loadProducts",
  "disabledBind": "loading"
}
```

```rhai
fn loadProducts(state, event) {
    state.loading = true;
    state.notice = "商品一覧を取得しています…";
    http_get("products");
    state
}
```

`http_get`は通信の依頼を登録し、その場でJSONを返さない。Rhaiの実行とstate検証が成功した後、ホストがHTTP取得する。Rhai自身は同期実行なので`await`は不要。通信中は`loading`でボタンを無効にする。

## 応答をstateへ入れる

基本形は次のとおり。実際のサンプルは代入前に配列・商品属性・型・重複を検証する。

```rhai
fn productsReceived(state, response) {
    state.loading = false;
    if !response.ok {
        state.notice = "取得できませんでした: " + response.error;
        return state;
    }
    // ここでAPIに合わせたデータの検証・変換をする。
    state.products = response.data;
    state.page = 0;
    state.selected = [];
    state.notice = state.products.len().to_string() + "件の商品を取得しました。";
    state
}
```

`response.ok`は取得・JSON解析の成功を示す。`data`は解析済みJSON、`error`は失敗理由。通信失敗・HTTPエラー・不正JSON・タイムアウトも同じ関数で受け取る。取得中に別の操作をした場合、受け取り関数へ渡るstateは**受信時点の最新状態**。

## グリッドはbindで表示する

```json
{
  "xtype": "gridpanel",
  "itemId": "productsGrid",
  "bind": "products",
  "pageSize": 5,
  "pageBind": "page",
  "sortBind": "sort",
  "selectedBind": "selected",
  "columns": [
    { "text": "番号", "dataIndex": "id", "flex": 1 },
    { "text": "商品名", "dataIndex": "name", "flex": 3 },
    { "text": "価格（円）", "dataIndex": "price", "flex": 2 },
    { "text": "在庫", "dataIndex": "stock", "flex": 1 }
  ]
}
```

stateに入った配列を既存のGridが描画する。サンプルは8件を5件ずつ表示し、ソート・ページ移動・選択も試せる。再取得時は先頭ページに戻り、選択を解除する。通信失敗やデータ形式の不一致では前回の一覧を保持し、ボタンを再び利用可能にする。

「定義とスクリプト」でURLや受け取り関数を変更して「変更を適用」を押せる。存在しないJSONのURLに変えると失敗メッセージを確認できる。「再取得」で同梱の定義に戻る。

## 通信の契約と制限

- `requests`は省略可能。最大8個。各定義は`url`と`handler`のみで、handlerの存在を読み込み時に確認する。
- `http_get(name)`は宣言済みの名前だけを使う。`init`からも呼べる。1回の関数実行と同時進行の上限は8件。同じ名前は完了まで再要求できない。無効な依頼ではstateも通信も確定しない。
- このチュートリアルのhttp_getはHTTP / HTTPSのGETとJSON応答に対応し、要求本文やパス変数を受け取らない。POST/PUT/PATCH/DELETE/HEAD、パス変数、query、JSON本文、許可ヘッダーは別の[HTTPアダプター契約](http-adapter.md)のhost_callを使う。StreamingとRhaiのasync/awaitは未対応。
- タイムアウトは15秒。応答はUTF-8で1 MB以内、stateも1 MB以内。Gridは最大2,000行。Rhai側の文字列・配列・操作数の制限も適用する。
- ホストは既存のResourceClientを使い、CORSを既定で使用する。デフォルトは認証なし。デモの認証設定を変更した場合はJSON取得にもその設定を使う。別オリジンのAPIには配信側のCORS許可が必要。[JWT・CORS契約](authentication.md)も参照。
- 画面切替・再取得・再コンパイルの成功時に以前の要求を中止し、遅れて届いた応答を破棄する。失敗した画面置換では元の画面を維持する。
- 完了handlerも通常のイベントと同じstate・部品検証を通す。handler自身が例外や不正stateを返した場合は変更を破棄し、ホストのエラー欄へ表示する。その要求は完了扱いになるので、自動で繰り返し実行しない。

WASMが返すload/event/http_resultの結果には、要求がある場合だけ`effects: [{ id, request, url }]`を追加する。ホストは取得後に`{ op: "http_result", id, ok, data, error }`で戻す。公開WASM関数とブラウザimport不要の構成は維持し、業務処理はページのRhaiへ置く。
