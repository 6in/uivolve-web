# uivolveの部品移植

参照元: [6in/uivolve](https://github.com/6in/uivolve)、コミット`3d22a3cfab5488afe3c60f8775676a85c51593ec`。元のReact実装の部品設定と操作を参考に、Rust/WASMの状態・レイアウトとDOM/Canvasの描画へ移植している。元のReactコンポーネントをそのまま実行する方式ではない。ライセンスは[通知](../THIRD_PARTY_NOTICES.md)に記載。

「uivolve フォーム部品」画面を選ぶと、JSONとRhaiをHTTPから取得する。入力値・選択状態・折りたたみを共通WASMで管理し、どちらの描画版からの操作も同じ状態へ反映する。

## 今回の対応範囲

| 元のxtype                  | エンジンでの部品 | 対応する主な設定                                                                   |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| form / panel               | panel            | title, items, 共通layout, collapsible, collapsed                                   |
| fieldcontainer / container | container        | items, 共通layout, flex                                                            |
| textfield                  | textfield        | fieldLabel, value, name, emptyText, inputType, readOnly, disabled                  |
| textarea / textareafield   | textarea         | 上記とrows、複数行入力                                                             |
| numberfield                | numberfield      | value, minValue, maxValue, increment                                               |
| datefield                  | datefield        | value（YYYY-MM-DD）                                                                |
| checkbox / checkboxfield   | checkbox         | boxLabel, checked, boolのvalue                                                     |
| radio / radiofield         | radio            | boxLabel, checked, name, inputValue                                                |
| combobox / combo           | combobox         | options, store, data, displayField, valueField, emptyText                          |
| listbox / multiselect      | listbox          | 同上とsize、multiSelect。multiselectは既定true                                     |
| displayfield               | displayfield     | fieldLabel, value / bind                                                           |
| slider / sliderfield       | slider           | minValue（既定0）, maxValue（既定100）, increment（既定1）                         |
| progressbar / progress     | progressbar      | value / bind（0〜1に収めて表示）、text                                             |
| fieldset                   | fieldset         | title, items, collapsible, collapsed, checkboxToggle                               |
| gridpanel                  | grid             | ソート、検索、ページ切替、複数選択、セル編集。詳細は[Grid契約](grid-navigation.md) |
| tabpanel                   | tabpanel         | title、activeTab / activeBind、disabled、items                                     |
| treepanel / tree           | treepanel        | root / children、展開・選択、disabled                                              |
| menu                       | menu             | 開閉、button項目、区切り線、disabled                                               |
| button                     | 既存のbutton     | text, handler, ui="primary"（variantへの別名）                                     |

残りの登録部品の基本対応も「uivolve コンポーネントギャラリー」画面へ追加した。toolbar/tbar・splitbutton・radiogroup/checkboxgroup・datepicker・pagingtoolbar・messagebox/msgbox・toast・component/box・codeeditor/code・htmleditor・diffeditor/diff・markdown・chatpanel/chat・terminal/console・chart/cartesian/polar・draw・gitgraph・networkgraph/forcegraph・mermaid・image/imagecomponent・video・iframe/uxiframeを扱う。設定、イベント、元の部品との機能差は[追加コンポーネント契約](uivolve-gallery.md)を参照。

checkboxToggleは折りたたみの指定として扱い、ヘッダーの開閉ボタンで操作する。元のfieldsetにあるチェック付き凡例の見た目は再現していない。

## 選択肢と状態

```json
{
  "xtype": "combo",
  "itemId": "department",
  "name": "department",
  "fieldLabel": "担当チーム",
  "displayField": "label",
  "valueField": "id",
  "store": { "data": [{ "id": "engine", "label": "エンジン" }] }
}
```

optionsは文字列・数値の配列または`{value,text}`の配列。storeは配列または`{data:[...]}`。store省略時はdataも使える。optionsを優先し、空ならstore/dataを読む。選択値は文字列へ統一する。選択肢は最大100件、値は一意。リモートstoreや動的な選択肢更新は未実装。

radioは同じnameまたはbindを持つ部品で状態キーを共有し、inputValueで選択を識別する。チェックボックスはbool、複数選択は文字列配列、numberfield/sliderは数値として状態へ格納する。明示したstateを優先し、ない場合にvalue/checkedを初期化する。radioのinputValue省略時はvalue、それも省略時はitemId。未選択の初期値は空文字列。

入力の保存・検証はRhaiのhandlerを使う。元のlistenersやJavaScript関数は取り込まない。allowBlank=falseは必須マークとネイティブ入力のrequired指定、minLengthとinputTypeは入力のヒント。入力途中の状態を許容し、保存時の必須・形式検証はRhaiに置く。

## 描画と制限

DOMはネイティブ入力を維持して更新する。Canvasは通常表示をCanvas 2Dで描き、テキスト・複数行・数値・日付・選択欄の編集中だけネイティブinput/textarea/selectを重ねる。チェック・ラジオ・スライダーはCanvasのヒット判定とキーボード操作で更新する。選択ポップアップ、日付ピッカー、スクロール、IMEの表示はブラウザに任せる。Canvasのリスト表示はsize件までで、編集中のネイティブリストで残りへスクロールする。rowsとsizeは1〜12。

テーマは既存の色トークンを共用する。元のCSSクラスやstyleを描画版へ渡す契約はない。fieldsetの外観も現在のパネルに合わせている。

元の画面JSON全体との互換は保証しない。cls、bodyPadding、独自CSS、borderレイアウト、イベントlisteners、vtype/regex、アイコンフォントは未対応。未知の属性・xtypeは読み込みエラーになる。追加部品は基本機能の移植であり、Monaco、リッチテキスト、完全なMarkdown/Mermaid、グラフの対話操作などは含まない。windowとgridはこの試作の設定範囲を使う。タブの動的追加はitemsBindで対応し、専用の閉鎖ボタン・ツリーGrid・サブメニューなどの制限は[Grid・ナビゲーション契約](grid-navigation.md)を参照。

実行例: [画面JSON](../public/screens/uivolve-forms.json) / [Rhai](../public/screens/uivolve-forms.rhai)。属性とイベント値の契約は[画面形式](screen-format.md)を参照。
