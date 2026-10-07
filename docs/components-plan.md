# 画面パッケージの部品化計画

状態: 計画・検討記録。現行APIの判断は[ドキュメント案内](README.md)から各契約を参照し、この文書を現行仕様の根拠にしない。合成が実装された段階で契約文書`components.md`を別に起こす。
2026-10-07。段階1・2が本マイルストーンの範囲で、段階3以降は方式と設計決定を固定しただけの検討。

## 目的と前提

要望の原点は「ExtJSのカスタムコンポーネントのように、既存の画面+スクリプトを1部品として任意のページへ組み込む」。複数画面の並列表示（ワークスペース）ではない。

採用はB案エンジン内合成。Rustに`Instance`を導入し、1つのScene・1トランザクションで親子を扱う。

却下した3案と理由。

| 却下案                   | 内容                                                                        | 却下理由                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A案ホスト合成            | 子ごとに別WASM、親の矩形に子`UiRuntime`を重ねる                             | 子の高さが親レイアウトに反映されない、親window/モーダルと子ポップアップのz順が破綻、Canvasで子がDOM浮きになる、WebMCPが子を別画面と見る。B案へ発展できない使い捨て                                      |
| B-lite案ロード時の平坦化 | 子パッケージを親へ平坦化（id/bindを接頭辞付きに書き換え、スクリプトを結合） | `bind`がstate最上位キーなので子Rhaiが読むキー名が変わり、結局handlerに部分stateを渡して書き戻す必要がある=B案と同じ。Rhai関数名の書き換えも脆い                                                         |
| ワークスペース案         | 複数`UiRuntime`+共有ストア+通知                                             | 共有データの読みが非同期往復になる、pane間通知のピンポン、busy中のdispatch例外、同一パッケージ多重起動でOPFS非待機ロック衝突、幅下限240px、WebMCPの1ページ1登録。親stateを正とするB案ならこれらが消える |

## 使い方

段階3以降の姿であり、現行契約ではない。実装前の素案として読む。

- 親の`components`宣言で、部品名から`url`へ対応付ける
- ノードの`xtype`に宣言名を書いて参照する
- ノードの`config`で親→子へ値を渡す。固定値または親stateへの`bind`
- ノードの`listeners`で子の`emit`名を親handlerへつなぐ
- 子Rhaiは`emit(name, payload)`で親へ通知する。任意で`config(state, config)`handlerを持てる
- 子へ渡した`config`は子の`state.config`へ注入される

架空の最小例。

```yaml
version: 1
id: order-page
title: 受注
script: order-page.rhai
components:
  customerCard: ./customer-card.yaml
state:
  customerId: C-001
  notice: ""
ui:
  xtype: container
  layout: vbox
  items:
    - xtype: customerCard
      itemId: customer
      config:
        customerId:
          bind: customerId
        readOnly: true
      listeners:
        picked: onCustomerPicked
```

```rhai
// customer-card.rhai（子）
fn config(s, c) { s.customerId = c.config.customerId; s }
fn pick(s, e) {
    emit("picked", #{id: s.customerId});
    s
}
```

## Instance木の構造

段階3以降の構造。

- `Runtime { root: Instance, components: HashMap<itemId, Instance> }`
- Sceneは1つ
- イベントの`target`と保存の`key`は`"<itemId>/<子itemId>"`の接頭辞付き

本マイルストーンでは`components`のHashMapは追加しない。Instance木はrootのみ。

## 設計決定

| 論点                           | 決定                                                                                            | 根拠/却下案                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 親↔子の可視性                  | 子は自分のstateと`state.config`のみ。親は子stateを見ない。やり取りは`config`と`emit`のみ        | 子パッケージを無改修で部品化できる。親stateを正とすることで共有データが同期で読める                              |
| 子→親（`emit`）の連鎖          | 同一トランザクション。1イベントで1回commit、連鎖深さ上限4。親listenerが失敗したら子も確定しない | 既存の「失敗したら何も変わらない」不変条件を維持。却下: 別トランザクション（子だけ確定した中途半端な状態が残る） |
| 子の`navigate`                 | 許可。ページ全体を置換。URLは子パッケージ基準で解決                                             | ExtJSでも部品がページ遷移を起こすのは普通。却下: 禁止（既存画面の流用範囲が狭まる）                              |
| 子の`alert / confirm / prompt` | ページ全体モーダル。キューはroot1本、完了handlerを子Instanceへルーティング                      | 既存の「ダイアログはmodal層の部品」と整合。却下: 子内モーダル（親windowとのz順が破綻）                           |
| 子のstorage / files scope      | `親画面id/itemId`。種別で共有したい場合は宣言で選択                                             | 同じ部品を2つ置いたときのOPFS非待機ロック衝突を避ける。却下: 子package id固定（多重起動で衝突）                  |
| 非同期効果の完了先             | effectと`*_result` opに`instance`を追加（段階4）                                                | ホストが完了を正しいInstanceへ返すため                                                                           |
| 制限                           | node 200 / script 100KB / state上限はInstanceごと。Instance数8、ネスト深さ3                     | 既存画面を無改修で部品にできる。却下: 全体で共有（1部品が上限を食い潰す）                                        |
| ロード                         | 子パッケージを同梱して1回の`load`。入力2MB上限の扱いは段階5で決める                             | 候補が失敗したら前画面を保つ既存契約を保てる                                                                     |

備考。

- 子のstorage / files scopeの区切り文字は`storage::safe_key`（`storage.rs:49`。`/`を許さない）と合わせて段階4で決める
- `http`のeffectだけ`kind`を持たない（`{id, request, url}`。storageは`kind: "storage"`）ので、段階4で`instance`を追加するときに揃える

## 段階計画

1. 段階1（設計文書の固定）。本マイルストーンで完了。本文書で方式・設計決定8論点・Instanceのフィールド一覧を固定した。
2. 段階2（挙動不変リファクタ）。本マイルストーンで完了。`engine/src/instance.rs`を新設し`Runtime`からInstanceを切り出した。公開シグネチャとABIの応答JSONは不変で、mainのビルドとの応答照合で確かめた。証跡は`target/engine-compare/`の照合JSON。
3. 段階3（同期のみの合成）。componentノードのレイアウト + dispatchルーティング + `emit` / `config`。子の非同期効果は禁止。
4. 段階4（効果のinstanceルーティング）。effectと`*_result` opに`instance`を追加。storage / files scopeの区切り文字と`http` effectの`kind`もここで決める。
5. 段階5（ローダー）。子パッケージの再帰取得・キャッシュ・入力2MB上限の扱い。
6. 段階6（WebMCP・契約文書`components.md`・デモ画面）。

## 本マイルストーンで確定した構造

`engine/src/instance.rs`のInstanceのフィールドは12個。名前・型・順序は次のとおり。

| フィールド          | 型                             | 内容                                               |
| ------------------- | ------------------------------ | -------------------------------------------------- |
| `package`           | `Package`                      | 読み込んだDSLのテンプレート                        |
| `ui`                | `Node`                         | 正規化・検証を通した確定UIツリー                   |
| `functions`         | `HashSet<String>`              | スクリプトが定義したhandler名の集合                |
| `engine`            | `Engine`                       | この画面専用のRhaiエンジン                         |
| `extension_context` | `extensions::ExtensionContext` | 拡張関数が参照する実行文脈（時刻などの差し替え口） |
| `ast`               | `AST`                          | コンパイル済みのRhaiスクリプト                     |
| `state`             | `Dynamic`                      | 確定済みの現在state                                |
| `http`              | `http::Requests`               | HTTP依頼のキューと未完了の対応                     |
| `host`              | `host::Requests`               | ホスト操作依頼のキューと未完了の対応               |
| `storage`           | `storage::Requests`            | 保存依頼のキューと未完了の対応                     |
| `files`             | `files::Requests`              | ファイル操作依頼のキューと未完了の対応             |
| `rpc`               | `rpc::Requests`                | RPC依頼のキューと記述子                            |

Runtime側に残した4フィールド。

| フィールド | 型                   | 内容                                          |
| ---------- | -------------------- | --------------------------------------------- |
| `root`     | `instance::Instance` | 現在の画面1つ分                               |
| `dialogs`  | `dialogs::Requests`  | ダイアログ依頼のキュー（画面で1本）           |
| `pages`    | `pages::Requests`    | ページ遷移依頼と宣言済みページ                |
| `revision` | `u32`                | 応答の世代番号。`abi.rs`が読むため`pub`のまま |

root共通物をRuntimeに残したのは、段階3の「ダイアログはroot1本」「1イベント1commit（revisionは1つ）」と整合するため。却下: すべてInstanceへ（段階3でrootへ戻す再設計が要る）。

Instanceのメソッドは3本。

- `load`。旧`Runtime::load_with_clock`の本文をそのままの順序で持ち、root共通物の`dialogs` / `pages`は引数で受ける
- `clear_queues`。`http`→`host`→`storage`→`files`→`rpc`の順にキューを空にする
- `state_json`

`commit_state`と`take_effects`はRuntimeに残した。`commit_state`は`prepare`の呼び出し順序と「検証がすべて通ってから代入」を動かさないため。`take_effects`のeffects連結順（`http`→`storage`→`files`→`rpc`→`dialogs`→`pages`→`host`）は応答のeffects配列の順序そのものなので変えられない。段階3で子Instanceが同じ関数を使えるようにするかは再検討する。

`engine/src/abi.rs`は無改修。`revision`が`pub`のままRuntimeに残るため。

## 残課題

- 子のstorage / files scopeの区切り文字。`storage::safe_key`が`/`を許さない
- `http` effectの`kind`欠落。段階4で揃えるか決める
- WASMインスタンス単位の`thread_local`（`abi.rs`のRUNTIMEスロット、`dialogs.rs`のSEQUENCE、`buffers.rs`のバッファ、`files.rs`のBYTE_USAGE、`theme.rs`の現在テーマ）が、Instance木になったときにどこへ属するか。`dialogs::SEQUENCE`は`load`をまたいで増え続ける採番で、Instance / Runtimeのフィールドへ移すとダイアログidの採番が変わるため本マイルストーンでは触っていない
