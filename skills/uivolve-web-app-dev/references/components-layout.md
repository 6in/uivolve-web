# 部品・配置・テーマ

必要な契約と実行例を選ぶ。

| 機能                              | 契約・例                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grid/Card/Border/Fit              | [レイアウト](../../../docs/layouts.md)、[例](../../../public/screens/layout-lab.json)                                                                          |
| Data Grid・タブ・ツリー・メニュー | [操作契約](../../../docs/grid-navigation.md)、[例](../../../public/screens/grid-lab.json)                                                                      |
| 動的タブ                          | [チュートリアル](../../../docs/tutorial-dynamic-tabs.md)、[Rhai](../../../public/screens/dynamic-tabs.rhai)                                                    |
| パネル・window                    | [画面契約](../../../docs/screen-format.md)、[定義](../../../public/screens/components.json)、[Rhai](../../../public/screens/components.rhai)                   |
| 図表・エディター・メディア等      | [ギャラリー契約](../../../docs/uivolve-gallery.md)、[定義](../../../public/screens/uivolve-gallery.json)、[Rhai](../../../public/screens/uivolve-gallery.rhai) |
| 配色                              | [テーマ契約](../../../docs/theme-format.md)、[標準テーマ](../../../public/themes/light.json)                                                                   |

- layoutのgridは配置、xtypeのgridは一覧。共通gap/paddingは0..64。高さは最小高で、内容に応じて広がる。rowSpan・splitter・汎用内部スクロールを設定で追加しない。
- CardはactiveBindの整数indexで切り替え、操作ボタンはCardの外へ置く。Borderは一意のregionと必須center、Fitは子1つ。
- Data Gridは安定した行idとpageSizeを使う。編集はeditingBindの下書きからcommitEdit/cancelEditへ進める。handlerはactionで分岐し、commitEditのvalue/oldValue/column/idを確認する。handler失敗時は元データを保つ。
- tabpanelのitemsBindでstate内の部品配列を使える。動的itemIdと入力キーは配列位置に依存させず一意にする。制限と削除時のactiveBindの扱いを契約で確認する。
- tabpanelのactiveBind、treeのexpandedBind/selectedBind、menuのopenBindを共通stateで管理する。隠れたタブ・閉じたツリーの操作、固定列・仮想スクロール・サブメニュー・ツリーGridを未対応のまま生成しない。
- panel.collapsedBindとwindow.visibleBindはトップレベルbool。開閉は組み込み状態更新後にhandlerが呼ばれる。×/Escapeと内容内のキャンセル処理を揃え、親windowを閉じるなら必要な子の状態も戻す。
- 元のuivolve/React/ExtJSとの全機能互換は前提にしない。Monaco補完・リッチテキスト・完全なMarkdown/Mermaid・グラフ操作を捏造しない。htmleditorはソース文字列、drawは契約内のsprite座標を使う。
- テーマは色トークンだけを別JSONで指定する。動画/iframeの再生状態はネイティブ要素が管理し、WASM stateとの同期を前提にしない。
