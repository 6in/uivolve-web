# Hello World：DSLとRhaiではじめての画面を作る

名前を入力して「挨拶する」を押すと「Hello 太郎」のように表示する。入力欄・ボタン・結果表示の3部品を使い、DOM版とCanvas版で同じ処理を動かす。

## 1. サンプルを開く

環境の準備は[READMEの起動手順](../README.md)を参照。リポジトリで次を実行する。

```sh
bun run dev
```

ブラウザで `http://127.0.0.1:4173/?screen=hello-world` を開く。既に本番プレビューを起動している場合は `http://127.0.0.1:4174/?screen=hello-world` を開く。画面パッケージの選択欄から「Hello World・はじめての画面」を選んでもよい。

名前に「太郎」を入力して「挨拶する」を押すと、両方の画面に「Hello 太郎」が表示される。名前を消して押すと「Hello World」。入力だけでは挨拶文は変わらず、ボタンを押した時点の名前を使う。

## 2. ページを作る2つのファイル

| ファイル                                               | 担当                                           |
| ------------------------------------------------------ | ---------------------------------------------- |
| [hello-world.json](../public/screens/hello-world.json) | 初期データ、部品の配置、データとイベントの接続 |
| [hello-world.rhai](../public/screens/hello-world.rhai) | 初期化とボタンを押したときの処理               |

RustはUIエンジンの実装言語、Rhaiはページ側のスクリプト言語。ページを作るときにRustを書く必要はない。ブラウザのホストがHTTPでJSONとRhaiのソースを取得し、共通のWASMエンジンへ渡す。エンジン内でRhaiを解析してASTへコンパイルし、イベントごとに実行する。Rhaiのソース自体をWASMバイナリに変換する方式ではない。

## 3. 画面DSLを書く

`public/screens/hello-world.json` の全体は次のとおり。

```json
{
  "version": 1,
  "id": "hello-world",
  "title": "Hello World・はじめての画面",
  "script": "hello-world.rhai",
  "state": {
    "name": "",
    "greeting": "名前を入力して「挨拶する」を押してください。"
  },
  "ui": {
    "xtype": "container",
    "layout": "vbox",
    "items": [
      {
        "xtype": "textfield",
        "itemId": "nameInput",
        "fieldLabel": "名前",
        "emptyText": "例：太郎",
        "bind": "name"
      },
      {
        "xtype": "button",
        "itemId": "helloButton",
        "text": "挨拶する",
        "handler": "sayHello",
        "variant": "primary"
      },
      {
        "xtype": "label",
        "itemId": "greetingLabel",
        "bind": "greeting"
      }
    ]
  }
}
```

`script` はJSONから見たRhaiファイルの相対URL。同じディレクトリに置いた2ファイルを配信すれば、この指定で読み込める。

`state` はページが持つデータで、ここでは入力値の `name` と表示する文章の `greeting`。`ui` が画面の部品ツリーで、`vbox` は子部品を縦に並べる。

| 設定                  | この画面での意味                                         |
| --------------------- | -------------------------------------------------------- |
| `xtype`               | `textfield`は入力欄、`button`はボタン、`label`は文章表示 |
| `itemId`              | イベントや部品識別に使う、一意のID                       |
| `bind: "name"`        | 入力欄の値を `state.name` と接続する                     |
| `handler: "sayHello"` | ボタン押下時にRhaiの `sayHello` 関数を呼ぶ               |
| `bind: "greeting"`    | `state.greeting` を結果として表示する                    |

入力欄は `handler` を指定しなくても、入力イベントによって `state.name` が更新される。結果表示は別のキーに接続しているので、名前を入力しただけでは挨拶文を変更しない。

## 4. Rhaiで処理を書く

`public/screens/hello-world.rhai` の全体は次のとおり。

```rhai
fn init(state) {
    state
}

fn sayHello(state, event) {
    let name = state.name;
    name.trim();
    if name == "" {
        name = "World";
    }
    state.greeting = "Hello " + name;
    state
}
```

`fn` は関数定義。`init` は画面の読み込み時にエンジンが呼ぶ。このサンプルはJSONの初期データをそのまま返す。

`sayHello` はDSLの `handler` と同じ名前にする。第1引数の `state` は現在のページデータ、第2引数の `event` は操作対象の `target` や入力値の `value` などのイベント情報。この処理では現在の入力値を `state.name` から読めるため、`event` は使わない。

`let name` はローカル変数。`name.trim()` で前後の空白を除き、空なら `World` にする。これは挨拶文に使う名前の整形であり、入力欄の `state.name` 自体は書き換えない。

`state.greeting = "Hello " + name` が結果データの更新。最後のセミコロンなしの `state` は関数の戻り値で、`return state;` とも書ける。`init` とイベントのハンドラは、必ず更新後のstateオブジェクトを返す。

## 5. 入力から表示までの流れ

```text
入力欄に「太郎」を入力
  → 入力イベントで state.name が「太郎」になる

「挨拶する」を押す
  → WASMエンジンが sayHello(state, event) を呼ぶ
  → Rhaiが state.greeting を「Hello 太郎」に変更して返す
  → エンジンが返されたstateを検証・確定する
  → DOM版とCanvas版の結果表示が更新される
```

ページのコードはDOM要素やCanvasの座標を操作しない。データを更新すると、そのデータに `bind` された部品をエンジンと描画バックエンドが更新する。片方から入力・押下しても、共通状態の結果を両方へ表示する。

## 6. 書き換えて試す

まずRhaiの `"Hello "` を `"こんにちは、"` に変えてみる。画面上部の「定義とスクリプト」を押すと、ボタンの下に画面定義とスクリプトのエディタが開く。「イベント処理」エディタでスクリプトを編集して「変更を適用」を押す。画面は再初期化されるので、再度名前を入力してボタンを押す。

ファイルを直接変更した場合は、画面上部の「画面を再取得」ボタンで読み直す。JSON・Rhaiの変更だけならWASMエンジンの再ビルドは不要。本番プレビューでファイル変更を確認する場合は、[運用手順](operations.md)に従い `bun run build` で配信物を更新する。

JSONのボタンの `text` を変えると表示名だけが変わる。`handler` を変える場合はRhaiの関数名も合わせる。文法エラーや存在しないハンドラは画面上の診断に表示され、失敗した変更は現在の画面を置き換えない。

別のサンプルを作るなら、2ファイルを `public/screens/` 内で別名へコピーし、JSONの `id` と `script` を変更する。例えば `my-hello.json` と `my-hello.rhai` を作り、下部の「URLから読み込む」で `http://127.0.0.1:4173/screens/my-hello.json` を指定すれば試せる。同梱一覧への登録なしでもURLからの取得は可能。同梱画面として選択欄や `?screen=` から開く場合は、[screen-catalog.js](../src/screen-catalog.js) と [index.html](../index.html) の選択肢にも登録する。

部品の詳細やイベントの契約は[画面契約](screen-format.md)、処理の担当範囲は[アーキテクチャ](architecture.md)を参照。この例は既存部品と同期処理だけで動作する。部品の動的追加や通信・タイマーなどをページから使うAPIは、現在まだ提供していない。
