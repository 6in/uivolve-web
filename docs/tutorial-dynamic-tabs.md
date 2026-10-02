# Rhaiからタブと部品を追加する

[Hello World](tutorial-hello-world.md)の次の例。ボタンを押すと商品名・数量・確認ボタン・結果表示を持つタブを追加する。画面の部品構成もページ側のRhaiで作れる。

## サンプルを動かす

[起動手順](../README.md)に従い、開発サーバーなら `http://127.0.0.1:4173/?screen=dynamic-tabs`、本番プレビューなら `http://127.0.0.1:4174/?screen=dynamic-tabs` を開く。選択欄の「動的タブ追加・Rhaiから部品を作る」からも開ける。

1. 最初に「タブ1」が作られる。商品名に「りんご」、数量に「3」を入力して「内容を確認」を押すと「りんご × 3」と表示される。
2. 「タブを追加」を押すと、新しい入力欄・確認ボタン・結果表示を持つ「タブ2」が作られ、自動的に切り替わる。
3. タブ2へ別の商品を入力してからタブ1へ戻ると、最初の入力と結果が残っている。
4. DOM版・Canvas版のどちらからも操作でき、同じ状態を両方へ表示する。タブは最大8個で、上限になると追加ボタンが無効になる。

全ソースは[dynamic-tabs.json](../public/screens/dynamic-tabs.json)と[dynamic-tabs.rhai](../public/screens/dynamic-tabs.rhai)。画面の「定義とスクリプト」からも確認・編集できる。

## DSLで動的な子要素の接続先を宣言する

初期stateには空の部品定義の配列を置く。以下は画面パッケージの関連部分の抜粋。

```json
{
  "state": {
    "tabs": [],
    "activeTab": 0,
    "nextTabId": 1
  },
  "ui": {
    "xtype": "tabpanel",
    "itemId": "workspace",
    "itemsBind": "tabs",
    "activeBind": "activeTab"
  }
}
```

`itemsBind: "tabs"` は、`state.tabs` の中身をタブの部品定義として使う指定。静的な `items` の代わりに使う。`activeBind` は現在の選択番号で、0始まりの整数。

## Rhaiで部品の定義を追加する

サンプルの `createTab` は、タブ固有のIDと入力キーを作り、部品定義を `state.tabs` へpushする。次のコードは、その仕組みを商品名の入力だけに絞った説明用の例。実際のサンプルには数量・確認ボタン・結果表示と、8個の上限チェックもある。

```rhai
fn createTab(state) {
    let id = state.nextTabId;
    let key = "tab" + id.to_string();
    state.nextTabId += 1;

    state["product_" + key] = "";
    state.tabs.push(#{
        xtype: "container",
        itemId: key,
        title: "タブ" + id.to_string(),
        items: [
            #{
                xtype: "textfield",
                itemId: "product-" + key,
                fieldLabel: "商品名",
                bind: "product_" + key
            }
        ]
    });

    state.activeTab = state.tabs.len() - 1;
    state
}

fn init(state) {
    createTab(state)
}

fn addTab(state, event) {
    createTab(state)
}
```

`#{ ... }` はRhaiでマップを作る記法。ここで作っているものは、画面JSONの部品と同じ設定を持つデータ。Rustの部品実装を書いているわけではない。WASMエンジンがこのデータを解析・検証して実際の部品ツリーにする。

`init` はページ読み込み時に最初のタブを作る。追加ボタンのDSLは `handler: "addTab"` を指定しており、押下時に同じ `createTab` を呼ぶ。新しいタブを選ぶ処理もRhaiの `state.activeTab` 更新で行う。

入力キーは `product_tab1`、`product_tab2` のように分ける。両方の入力を同じ `bind` にすると値を共有するため、独立した入力には固有のキーを使う。入力のbindはトップレベルキーなので、ドットによるネストした書き込みは使わない。

## 追加した部品にもハンドラを接続する

実際のサンプルでは、追加するタブの中にもボタンを置く。

```rhai
#{
    xtype: "button",
    itemId: "save-" + key,
    text: "内容を確認",
    handler: "confirmTab",
    variant: "primary"
}
```

ページのRhaiに `confirmTab(state, event)` を定義すると、追加されたボタンからも通常のハンドラとして呼ばれる。`event.target` は押されたボタンのitemId。サンプルは対応するタブの入力キーを読み、そのタブだけの `result_tab1` などを更新する。結果のlabelはそのキーにbindされている。

この仕組みにより、タブの作成・タブ内の入力・確認処理は、エンジンとは別に配信するページのコードで完結する。新しいページを作るためのRust/WASM再ビルドは不要。

## 更新が失敗した場合

エンジンは部品定義とstateを一緒に検証・確定する。重複itemId、未知の部品・属性、未定義のハンドラ、タブ数やUI全体の上限超過があれば、そのイベントの状態変更も画面変更も確定しない。

state.tabsの各要素には、画面内で一意のitemIdを明示する。IDは追加のたびに新しい番号で作り、配列の現在位置をIDとして使わない。新しいIDの入力には既定値を補完するが、Rhaiで指定したstateや既存タブの入力を上書きしない。

現在のitemsBindはtabpanel専用で、配列は0〜8件。全画面の200ノード・20階層の上限も適用される。タブの非表示中はその部品の操作を受け付けない。閉鎖用UI、ドラッグ並べ替え、スクロール付きタブバーは含まない。詳しい初期値・削除・選択番号の扱いは[タブの契約](grid-navigation.md)を参照。
