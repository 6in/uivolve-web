# Screen package v1

画面パッケージはJSON。UI処理は別URLのRhaiテキスト。JSON内の`script`は、パッケージURLから解決する相対または絶対HTTP / HTTPS URL。

```json
{
  "version": 1,
  "id": "counter",
  "title": "カウンター",
  "script": "counter.rhai",
  "state": { "count": 0 },
  "ui": {
    "xtype": "container",
    "layout": "vbox",
    "items": [
      { "xtype": "metric", "text": "回数", "bind": "count" },
      {
        "xtype": "button",
        "itemId": "increment",
        "text": "増やす",
        "handler": "increment",
        "variant": "primary"
      }
    ]
  }
}
```

対応するRhai:

```rhai
fn init(state) { state }
fn increment(state, event) {
    state.count += 1;
    state
}
```

## 部品

Gridの拡張、tabpanel、treepanel/tree、menu、menuseparatorの設定と操作は[Grid・ナビゲーション形式](grid-navigation.md)を参照。実行例は`public/screens/grid-lab.*`。

toolbar、datepicker、messagebox、toast、エディター、文書、図表、会話・ログ、メディア、accordionレイアウトは[追加コンポーネント形式](uivolve-gallery.md)を参照。実行例は`public/screens/uivolve-gallery.*`。これらは元の部品の基本機能の対応であり、ライブラリ全機能の互換ではない。

| xtype            | 設定                                                      | 意味                                               |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------- |
| container        | layout, items                                             | `vbox`（既定）または`hbox`                         |
| panel            | title, layout, items, itemId, collapsedBind, handler      | タイトル付きコンテナ。折りたたみに対応             |
| window           | itemId, title, visibleBind, width, items, layout, handler | エリア内のモーダルウィンドウ                       |
| label            | text または bind                                          | １行テキスト。bindがあれば状態の値を表示           |
| metric           | text, bind, variant                                       | ラベルと大きな数値。variantはblue / green / amber  |
| textfield        | itemId, text, bind, handler                               | input。bindはトップレベルの状態キー。handlerは任意 |
| button           | itemId, text, handler, variant                            | 押下でhandler。variantはprimaryまたは省略          |
| grid             | itemId, bind, selectedBind, handler, columns              | 配列を行表示。行の`id`で選択を識別                 |
| textarea         | rows, emptyText, maxLength                                | 複数行入力。改行とIMEに対応                        |
| numberfield      | minValue, maxValue, increment                             | 数値入力。空欄はnull                               |
| datefield        | value                                                     | YYYY-MM-DD形式の日付入力                           |
| checkbox / radio | boxLabel, checked, inputValue                             | boolのチェック / 共通bind先への単一選択            |
| combobox         | options または store / data, emptyText                    | ドロップダウン選択                                 |
| listbox          | options または store / data, size, multiSelect            | リスト選択。複数選択に対応                         |
| displayfield     | fieldLabel, value または bind                             | ラベル付きの表示専用値                             |
| slider           | minValue, maxValue, increment                             | 数値選択。Canvasはドラッグと矢印/Home/Endに対応    |
| progressbar      | value または bind, text                                   | 0〜1の進捗表示。text省略時は百分率                 |
| fieldset         | title, items, collapsible, collapsed                      | タイトル付きグループ。折りたたみに対応             |

対応属性: `xtype`, `itemId`, `text`, `title`, `layout`, `bind`, `selectedBind`, `disabledBind`, `collapsedBind`, `visibleBind`, `width`, `handler`, `variant`, `flex`, `items`, `columns`。未知の属性はエラー。`flex`は正の数（既定1）で、hbox内の幅を配分する。`itemId`内のコロンは内部キー用に予約している。

フォーム系の追加属性: `fieldLabel`, `boxLabel`, `name`, `value`, `inputValue`, `checked`, `emptyText`, `inputType`, `readOnly`, `disabled`, `allowBlank`, `minLength`, `maxLength`, `minValue`, `maxValue`, `increment`, `rows`, `size`, `multiSelect`, `options`, `store`, `data`, `displayField`, `valueField`, `collapsible`, `collapsed`, `checkboxToggle`, `ui`。各部品で意味のある属性を使う。設定の対応範囲は[移植対応表](uivolve-port.md)を参照。

Grid・ナビゲーションの追加属性: `pageSize`, `pageBind`, `sortBind`, `filterBind`, `editingBind`, `activeTab`, `activeBind`, `expandedBind`, `openBind`, `root`, `rootVisible`, `children`。Grid列の追加属性は`sortable`, `hidden`, `align`, `editor`。設定は[Grid・ナビゲーション形式](grid-navigation.md)を参照。

`bind` / `selectedBind` / `disabledBind`は状態参照。表示の参照は`a.b`形式に対応。入力の書き込みはトップレベルキーのみ。disabledBindがtrueの操作は実行しない。

フォーム入力のbindを省略するとname、nameも省略すると生成された状態キーを使う。itemId省略時は構造パスからIDを生成する。明示したstateの値を優先し、未定義のキーはvalue / checkedなどからinit実行前に初期化する。構造変更によるIDの変化を避けたい場合はitemIdとbindを指定する。readOnlyの入力、disabled / disabledBindがtrueの部品とその子孫はWASMでも更新を受け付けない。

gridのcolumnsは`{ "text": "顧客名", "dataIndex": "customer", "flex": 2 }`。行データに安定した一意の`id`を付ける。既存の単純Gridは先頭100行を表示し、拡張GridはpageSizeで表示件数を制限する。

## パネルとウィンドウ

`panel.collapsedBind`はトップレベルのbool状態キー。指定時はitemIdも必要で、タイトルが開閉ボタンになる。折りたたんだ内容はレイアウトから除外するが、入力値は状態に保持する。開閉イベントは`{ action: "toggle" }`で、状態を反転してから任意のhandlerを呼ぶ。

`window`はcontainerまたはpanelのitems内に置く。itemIdと`visibleBind`（トップレベルのbool状態キー）が必須。trueのときだけ表示する。通常のvbox/hboxの配置領域を消費せず、描画エリアの中央に重ねる。widthは既定400、指定範囲240〜1200で、エリアより広い場合は左右16pxの余白を残して縮める。高さは内容に合わせる。

```json
{
  "xtype": "window",
  "itemId": "editor",
  "title": "編集",
  "visibleBind": "editorOpen",
  "width": 420,
  "items": [{ "xtype": "textfield", "itemId": "name", "text": "名前", "bind": "draftName" }]
}
```

Rhaiから`state.editorOpen = true`で開く。右上の×またはEscapeは`{ action: "close" }`を送信し、visibleBindをfalseにしてからwindow.handlerを呼ぶ。キャンセルなど内容内のボタンは自分のhandlerで状態を変更する。handlerが失敗した場合は開閉状態もコミットしない。

windowのitemsにwindowを置いて確認画面を重ねられる。表示中のwindowをDSLの深さ優先順に重ね、最後のwindowだけが操作を受け付ける。隠れたwindow、折りたたみ内の内容、モーダルの背後へのイベントはWASM側でも無視し、revisionを進めない。閉じた親windowの子windowは表示しない。

両バックエンドで、操作した側のフォーカスをウィンドウへ移し、Tab / Shift+Tabを内部で循環させる。閉じると利用可能な呼び出し元へ戻す。IME変換中のEscapeは閉じる操作として扱わない。背景クリックでは閉じない。

モーダルの範囲は**各描画エリア内**。比較ページのツールバーやもう一方のレンダラーは操作できる。DOM版はrole=dialogとinertを使用する。ブラウザページ全体をモーダルにするshowModalやaria-modal=trueは使用しない。ドラッグ移動、サイズ変更、非モーダルwindow、ポップオーバーは未実装。実行例は`public/screens/components.*`。

## イベント契約

起動時: `init(state) → state`。イベント時: `handler(state, event) → state`。必ずオブジェクトを返す。使用するhandlerが存在するかは読み込み時に確認される。

イベントには`target`（itemId）、`value`、`id`、`action`がある。textfield / textarea / datefieldは文字列、numberfieldは数値またはnull、checkboxはbool、radioはinputValueの文字列、combobox / 単一listboxは選択値の文字列、複数listboxは文字列配列、sliderは刻みに丸めた数値のvalueを渡す。行選択は行のid、ボタンはvalue / idがnull。通常のactionは空文字列で、パネル開閉はtoggle、windowの×やEscapeはclose。入力のbind先は**ハンドラを呼ぶ前に**更新される。

WASMはイベント値の型、maxLength、数値の範囲、日付の実在、選択肢への所属、複数選択の重複を検証する。allowBlank / minLength / inputTypeはラベルやネイティブ入力のヒントで、保存時の必須入力・メール形式などの検証はRhaiで行う。文字入力はIME変換中に送信せず、確定後に送信する。numberfieldのnullはRhaiではunit `()`になる。

状態を変更する計算・検証・一覧のフィルタリングはRhaiで実装する。描画バックエンドに業務ロジックを入れない。DOM、CSSクラス、Canvas座標をスクリプトから参照するAPIは提供しない。

ハンドラは更新された状態を返した後にコミットされる。例外や上限超過では、そのイベントによる状態変更をコミットしない。新しい画面の読み込みは、コンパイルとinitが成功してから現在の画面を置き換える。

同期処理のみ。通信・async/await・タイマー・モジュールimport・時刻APIは提供しない。これらが必要な依頼では、未実装APIを生成せず、必要なエンジン拡張を明示する。

## 診断と制限

構文エラーにはスクリプト名とRhaiの位置情報。実行エラーにはスクリプト名・itemId・handler名とRhaiの診断を表示する。

- UI: 200ノード、20階層。
- スクリプト: 100 KB、50,000操作、32呼び出し階層。
- Rhaiの配列サイズ上限設定: 10,000、mapサイズ上限設定: 32,000、文字列: 100,000バイト。Gridのローカルデータは別途2,000行まで。
- 状態: JSONシリアライズ後1 MB。入力: 10 KB。
- Rhaiのバージョンと実際の有効機能は`engine/Cargo.toml` / `engine/Cargo.lock`を参照。

基準の実行可能なサンプルは`public/screens/orders.*`、`public/screens/tasks.*`、`public/screens/components.*`、`public/screens/uivolve-forms.*`、`public/screens/grid-lab.*`、`public/screens/uivolve-gallery.*`。変更したパッケージは、ブラウザの「URLから読み込む」または「変更を適用」でWASMに通して検証する。
