# 保存・YAML・URL・型情報

OPFSのテキスト・バイナリ・ディレクトリ操作、配信ソースのキャッシュ、Unary RPCは[追加機能の契約](files-cache-rpc.md)を参照。この文書のstorage APIはJSONレコード保存を扱う。

実行例は[storage-lab.yaml](../public/screens/storage-lab.yaml)と[storage-lab.rhai](../public/screens/storage-lab.rhai)。プレビューの`/pages/storage-lab`で「保存・型・YAML」を開く。名前・年齢を入力し、IndexedDBまたはOPFSを選んで保存する。ページを再読み込みし、同じ方式を選んで復元すると値が戻る。削除後の復元は「保存データはまだありません」となる。

## 画面定義の形式

パッケージURLの拡張子が`.yaml` / `.yml`ならYAML、その他はJSONとして読む。scriptは従来どおり別URLのRhai。YAMLはホストが解析し、同じJSON ABIとRustのDSL検証へ通す。WASMにYAMLパーサーは組み込まない。

YAML 1.2のcore schemaを使い、文字列キー、有限数値、bool、null、配列、オブジェクトを扱う。日付らしい`2026-10-03`や`on` / `off`は文字列。複数ドキュメント、重複キー、独自/明示タグ、エイリアス、非文字列キー、非有限数値は拒否する。定義テキストは1,000,000 UTF-8バイト以内、値は32,000個以内・深さ64以内。Rustにはさらに部品・状態の既存上限がある。

「定義とスクリプト」には読み込んだ原文を表示し、JSON/YAMLの形式選択で変換できる。変換しても適用ボタンを押すまでは画面を変更しない。YAMLからJSONへ変換するとコメントは失われる。themeは現在JSONのみ。

## stateSchema

型情報の基準は画面DSLの任意の`stateSchema`。既存パッケージは省略でき、その場合の振る舞いは従来どおり。

```yaml
state:
  name: 太郎
  age: null
  rows: []
stateSchema:
  type: object
  required: [name, age, rows]
  additionalProperties: false
  properties:
    name: { type: string, maxLength: 40 }
    age: { type: [integer, "null"], minimum: 0, maximum: 130 }
    rows:
      type: array
      maxItems: 100
      items:
        type: object
        required: [id, title]
        additionalProperties: false
        properties:
          id: { type: integer }
          title: { type: string }
```

`"null"`を型名として書く場合、YAMLでは引用する。`null`値そのものとは区別する。

| 属性                      | 対応                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `type`                    | 各schemaで必須。string / number / integer / boolean / null / array / object、または重複なしの型名配列。ルートはobject |
| `properties` / `required` | 子プロパティのschemaと必須キー。requiredはpropertiesに宣言した名前に限る                                              |
| `additionalProperties`    | bool。既定true、falseなら未知キーを拒否。schema値は未対応                                                             |
| `items`                   | 全配列要素へ適用する単一schema                                                                                        |
| `enum`                    | 1〜100個のJSON値から選ぶ                                                                                              |
| `minimum` / `maximum`     | 数値の下限・上限を含む                                                                                                |
| `minLength` / `maxLength` | Unicodeコードポイント数。見た目の文字数とは異なることがある                                                           |
| `minItems` / `maxItems`   | 配列の要素数                                                                                                          |

JSON Schemaの一部だけを使い、未知属性はエラー。型のないschema、`$ref`、`allOf`、`pattern`、defaultによる自動補完などは未対応。schemaは200ノード・深さ12以内、プロパティ名は1〜128 UTF-8バイト。Rhaiソースの静的型検査ではない。

元の初期state、UI既定値の補完後、init後、イベントとHTTP/保存完了handler後を確定前に検証する。requiredに宣言した値は初期stateにも必要。additionalProperties=falseなら、UIが追加する補助状態キーも宣言する。入力部品のbindが宣言済みのプロパティに紐付く場合、textfieldなどはstring、numberfield/sliderはnumberまたはinteger、checkboxはboolean、複数listboxはarrayかも確認する。動的に追加する部品も対象。

numberfieldを空欄にできる設計なら`[number, "null"]`などを宣言する。minLength=1などをstateへ課すと、入力途中の空文字も拒否される。編集中に空欄を許す場合は保存時のRhai検査を使う。

型・範囲違反は`stateSchema state.age: expected integer, got number`のようなパス付きエラーとなり、画面・state・revisionを保持する。失敗したhandler内のHTTP/保存依頼も開始しない。完了handlerが失敗した場合、その依頼のidは消費済みとなる。再試行は新しい依頼を発行する。

## IndexedDB / OPFS

ページは最大8個の保存レコードを宣言する。

```yaml
storage:
  profile:
    backend: indexeddb # またはopfs
    key: profile
    handler: stored
```

Rhai側:

```rhai
fn save(state, event) {
    storage_write("profile", #{name: state.name, age: state.age});
    state.loading = true;
    state
}
fn restore(state, event) { storage_read("profile"); state }
fn remove(state, event) { storage_remove("profile"); state }
fn stored(state, response) {
    state.loading = false;
    if !response.ok { state.notice = response.error; }
    else if response.operation == "read" && response.data != () {
        state.name = response.data.name;
        state.age = response.data.age;
    }
    state
}
```

関数は保存依頼をキューへ置く。同期で値を返さない。state/UI検証が通ったときだけ`effects`としてホストへ渡す。JSのStorageClientがブラウザAPIを呼び、`storage_result` ABIでWASMへ戻す。`storage_result`はeffectに載っていた`instance`を添えて返し、子Instance宛では必須、省略はroot宛を意味する。完了handlerには**最新のstate**と`{ok, data, error, request, operation}`を渡す。requestは宣言名、operationはread/write/remove。存在しない値のread、成功したwrite/removeのdataはnull（Rhaiの`()`）。保存JSON自体がnullの場合と未保存は区別しない。

宣言名、key、保存を使うページidは1〜80文字のASCII英数字・`-`・`_`。子Instanceの保存領域scope（下記の保存先で`pageId`に当たる値）は[部品化の契約](components.md)を参照する。同じ方式・同じkeyを指す別名も含め、同一レコードの同時要求は1件まで。handlerごとの依頼と進行中の依頼はそれぞれ最大8件。JSONは1,000,000 UTF-8バイト以内。readは保存されたJSON、write/removeは完了確認を返す。データの型確認はページ側で行い、stateへ戻すとstateSchemaも検証する。ホストで中止できない処理が残っている場合も、同じStorageClientの同一レコードを完了までロックし、再要求は通常の失敗で返す。

保存先:

- IndexedDB: DB `uivolve-web`、object store `pages`、キーは`[pageId, key]`のJSON文字列。
- OPFS: オリジン専用領域内の`uivolve-web/<pageId>/<key>.json`。利用者の任意のローカルファイルにはアクセスしない。

IndexedDBはtransactionのcomplete、OPFSはwriter.closeの成功後に完了を通知する。15秒の期限を設け、未対応・容量不足・失敗はok=falseで返す。OPFSにはHTTPS/localhostなどsecure contextが必要。画面切替・再コンパイルは中止を試み、世代番号で古い完了を破棄する。すでに確定した保存や確定中のcloseは巻き戻せない。複数タブや複数エンジンから同じOPFSファイルへ書く排他制御は含まない。

JWTを自動保存しない。ページidによる名前空間は整理用で、同一オリジン内の認可境界ではない。ブラウザの容量・データ削除・プライベートモードの制限を受ける。永久保持やサーバー同期は保証しない。任意DB/索引/複数レコードのトランザクション、バイナリ、ディレクトリ一覧、Worker同期APIは今回省略する。

APIの根拠：[IndexedDBのcomplete](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event)、[OPFSの取得](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory)、[ファイル書き込み](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable)。

## WebMCPの記述

トップレベルと各部品の`webmcp`に`label`、`description`、`tags`を記述できる。すべて省略可能。labelは160 UTF-8バイト、descriptionは2,000バイト、tagsは重複なし最大8件、1件1〜80バイト。

```yaml
webmcp:
  label: プロフィール編集
  description: このブラウザに名前と年齢を保存するサンプル。
  tags: [profile, storage]
ui:
  xtype: button
  itemId: save
  text: 保存
  handler: save
  webmcp:
    description: 選択した保存方式でプロフィールを保存する。
    tags: [write]
```

Sceneへ渡した画面情報は`ui_get_screen.screen.webmcp`、表示部品は`widgets[].metadata.webmcp`に出る。`widgets[].metadata.webmcp`は子Instanceの部品にも出る（keyは接頭辞付き）。子パッケージ直下の`webmcp`は`ui_get_screen.components[]`にinstance別で出る。stateSchemaも同ツールでプレビューを返し、省略時はstateSchemaTruncated=true。説明はツールの入力schema・許可action・認可を変更しない。ページ独自ツールや任意handlerの直接起動は省略する。[WebMCP契約](webmcp.md)を参照。

## 自然なURL

同梱画面は`/pages/http-grid`や`/pages/storage-lab`で直接開ける。画面選択とWebMCPの画面切替は、読み込み成功時だけ履歴を追加する。再読み込み・戻る・進むにも対応する。旧`?screen=http-grid`は読み込み、同じ画面の`/pages/http-grid`へreplaceStateで置き換える。未知の`/pages/...`は診断し、既存画面があればその画面のURLへ戻す。起動時の未知URLは受注画面を開き、診断を表示する。

画面URLと配信ファイルURLは別。`/pages/http-grid`は`/screens/http-grid.json`とそのRhaiを取得する。任意の外部パッケージのURL読み込みは引き続きエディタから行い、ルートには登録しない。外部パッケージの再現にはそのURLを再指定する。

深いURLをindex.htmlへフォールバックする配信設定が必要。既定baseは`/`。サブディレクトリではビルド時に絶対baseを指定する。[運用手順](operations.md)の例を参照。
