# 部品・配置・テーマ

必要な契約と実行例を選ぶ。

別のパッケージへ画面遷移する場合は[画面遷移チュートリアル](../../../docs/tutorial-page-navigation.md)を読む。トップレベル`pages`に遷移先を宣言し、イベントhandlerから`navigate(name)`で依頼する。遷移先のYAML/JSONとRhaiを取得・検証後に表示を切り替える。失敗時は現在の画面を保持する。stateの引き継ぎや同期の戻り値を前提にしない。

| 機能                              | 契約・例                                                                                                                                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grid/Card/Border/Fit              | [レイアウト](../../../docs/layouts.md)、[例](../../../public/screens/layout-lab.json)                                                                                                                                                                                         |
| Data Grid・タブ・ツリー・メニュー | [操作契約](../../../docs/grid-navigation.md)、[例](../../../public/screens/grid-lab.json)                                                                                                                                                                                     |
| 動的タブ                          | [チュートリアル](../../../docs/tutorial-dynamic-tabs.md)、[Rhai](../../../public/screens/dynamic-tabs.rhai)                                                                                                                                                                   |
| KANBAN・カード移動                | [操作契約](../../../docs/kanban.md)、[定義](../../../public/screens/kanban.yaml)、[Rhai](../../../public/screens/kanban.rhai)                                                                                                                                                 |
| パネル・window                    | [画面契約](../../../docs/screen-format.md)、[定義](../../../public/screens/components.json)、[Rhai](../../../public/screens/components.rhai)                                                                                                                                  |
| 図表・エディター・メディア等      | [ギャラリー契約](../../../docs/uivolve-gallery.md)、[定義](../../../public/screens/uivolve-gallery.json)、[Rhai](../../../public/screens/uivolve-gallery.rhai)                                                                                                                |
| 配色                              | [テーマ契約](../../../docs/theme-format.md)、[標準テーマ](../../../public/themes/light.json)                                                                                                                                                                                  |
| 画面合成（components）            | [合成契約](../../../docs/components.md)、[親の定義](../../../public/screens/order-dashboard.json)、[親Rhai](../../../public/screens/order-dashboard.rhai)、[子の定義](../../../public/screens/parts/order-list.json)、[子Rhai](../../../public/screens/parts/order-list.rhai) |

- layoutのgridは配置、xtypeのgridは一覧。共通gap/paddingは0..64。高さは最小高で、内容に応じて広がる。rowSpan・splitter・汎用内部スクロールを設定で追加しない。
- CardはactiveBindの整数indexで切り替え、操作ボタンはCardの外へ置く。Borderは一意のregionと必須center、Fitは子1つ。
- Data Gridは安定した行idとpageSizeを使う。編集はeditingBindの下書きからcommitEdit/cancelEditへ進める。handlerはactionで分岐し、commitEditのvalue/oldValue/column/idを確認する。handler失敗時は元データを保つ。
- kanbanはトップレベルbindのカード配列とlanesで構成する。列内の順序は配列順。moveのvalueは移動先の列id、beforeIdは挿入先のカードid（nullで末尾）。任意のhandlerは組み込み移動後のstateを受け取り、throwで移動を拒否できる。別ボード間・ファイルドロップ・自動スクロールを対応済みとしない。
- tabpanelのitemsBindでstate内の部品配列を使える。動的itemIdと入力キーは配列位置に依存させず一意にする。制限と削除時のactiveBindの扱いを契約で確認する。
- tabpanelのactiveBind、treeのexpandedBind/selectedBind、menuのopenBindを共通stateで管理する。隠れたタブ・閉じたツリーの操作、固定列・仮想スクロール・サブメニュー・ツリーGridを未対応のまま生成しない。
- panel.collapsedBindとwindow.visibleBindはトップレベルbool。開閉は組み込み状態更新後にhandlerが呼ばれる。×/Escapeと内容内のキャンセル処理を揃え、親windowを閉じるなら必要な子の状態も戻す。
- 元のuivolve/React/ExtJSとの全機能互換は前提にしない。Monaco補完・リッチテキスト・完全なMarkdown/Mermaid・グラフ操作を捏造しない。htmleditorはソース文字列、drawは契約内のsprite座標を使う。
- テーマは色トークンだけを別JSONで指定する。動画/iframeの再生状態はネイティブ要素が管理し、WASM stateとの同期を前提にしない。
- 画面合成は、親のトップレベル`components`で宣言名から`{ url }`へ対応付け、`xtype`に宣言名を書いたノード（componentノード）で既存の画面パッケージを埋め込む。componentノードは`itemId`必須で、書けるのは`config` / `listeners` / `flex` / `width` / `visibleBind`だけ。container / panel / fieldset / windowの`items`にのみ置ける。
- 親→子は`config`（固定値または`{ bind: <親stateの最上位キー> }`）で渡し、子は`state.config`として読む。子は`init`で`state.config`を読み、親のbind値が変わったときだけ任意の`config(state, event)`が呼ばれる。子→親は子Rhaiの`emit(name, payload)`と親ノードの`listeners: { <emit名>: <親handler> }`。親handlerの`event`は`target`（componentノードのitemId）・`action`（emit名）・`value`（payload）。親は子のstateを直接読めず、子は親のstateを読めない。
- 合成の子は同期処理のみ。`http_get`・`storage_*`・`file_*`・`rpc_call`・`host_call`・`alert` / `confirm` / `prompt`・`navigate`、トップレベルの`requests` / `operations` / `storage` / `files` / `rpc` / `pages` / `webmcp`、uiの`window`は子では読み込みエラー。通信・保存・ダイアログが要る処理は親（root）に置き、`emit`で親へ依頼する形にする。
- 1イベントで親子はまとめて1回確定し、どこかが失敗すれば親子とも変わらない。上限はInstance 8（rootを含む）・入れ子3段・同梱後2 MB。`itemId`に`/`は使えない（接頭辞付きパスに予約）。`components`を持つ画面は`network-first`で配信できない。
