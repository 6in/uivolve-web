# Grid・タブ・ツリー・メニュー

実行例: [grid-lab.json](../public/screens/grid-lab.json) / [grid-lab.rhai](../public/screens/grid-lab.rhai)。プレビューは`http://127.0.0.1:4174/?screen=grid-lab`で直接開く。

## Grid

既存のgridは設定を変えずに使える。pageSize、pageBind、sortBind、filterBind、editingBind、multiSelect=true、または列のeditor / hidden / align / sortable=falseを指定すると、共通エンジンのGrid機能を有効にする。既存の受注画面のRhaiによる検索・編集とは独立した機能。

```json
{
  "xtype": "gridpanel",
  "itemId": "inventory",
  "bind": "records",
  "pageSize": 8,
  "filterBind": "query",
  "selectedBind": "selectedIds",
  "multiSelect": true,
  "columns": [
    {
      "text": "名前",
      "dataIndex": "name",
      "flex": 3,
      "editor": { "xtype": "textfield", "maxLength": 80 }
    },
    {
      "text": "数量",
      "dataIndex": "quantity",
      "align": "right",
      "editor": { "xtype": "numberfield", "minValue": 0 }
    }
  ]
}
```

- データはトップレベルbindの配列。各行に一意で安定した文字列または数値のidを必須とする。最大2,000行。bind省略時は生成キーへstore（配列またはstore.data）/ dataを初期化する。
- pageSizeは1〜50、機能を有効にしたときの既定10。表示ページの行だけをスナップショット化する。件数は絞り込み後の件数。全件が空でも1ページとして表示する。
- 列は最大12で、dataIndexを一意にする。flexで幅を分配し、hidden=trueの列を非表示にする。alignはleft / center / right。ソート可否は列のsortable（既定true）で制御する。
- 列見出しは昇順→降順→元の順の切替。数値は数値、その他は表示文字列の小文字化で比較する。ソートは安定ソート。日本語の照合順を保証するロケール比較ではない。
- filterBindの文字列をtrim・小文字化し、全列の値へ部分一致検索する。非表示列も検索対象。検索変更とソート変更ではページを先頭に戻す。
- selectedBindは単一選択でidまたはnull、複数選択でid配列。通常クリックは選択を置換し、Ctrl/Metaまたは□で追加・解除。Shiftは現在ページ内の最後の選択位置から範囲選択する。ソート、検索、ページ切替でも選択idを保持し、データから削除されたidは除く。

pageBind（0始まり）、sortBind（nullまたは`{column,direction}`）、selectedBind、editingBindを省略するとitemIdから生成する。各bindingは異なるトップレベルキーにする。filterBindもこれらと区別する。

### セル編集

列editorはtextfield / numberfield / datefield / combobox / checkboxを指定できる。editor内のitems / handler、編集列の入れ子dataIndexは未対応。GridのreadOnly、editorのreadOnly / disabledは編集を拒否する。

ダブルクリックまたはEnter/F2で編集を開始する。editingBindへ`{id,column,value}`を保持する。入力イベントはこの下書きだけを更新し、元の行を更新しない。Enter / Tabまたは保存ボタンで確定、Escapeまたは取消ボタンで破棄する。Canvasの編集でもIME変換中の中間値は送信しない。

確定時にeditorの型・長さ・範囲・日付・選択肢を検証し、allowBlank=falseの空値も拒否する。その後Gridのhandlerを呼ぶ。例外なら元の行と下書きを保ち、修正または取消ができる。成功時だけ該当idの行を更新して下書きを除く。ソート・ページ・検索変更や別セルでの編集開始は、未確定の下書きを取り消す。タブを隠した場合は下書きを保持し、隠れたGridのイベントを拒否する。

Gridのイベントactionはsort / page / select / beginEdit / draft / commitEdit / cancelEdit。columnはdataIndex、idは安定した行id。commitEditのvalueは確定値、oldValueは以前の値。built-in処理の後に任意のGrid handlerを実行する。WASMは現在ページ以外の選択・編集、存在しない列、非表示/編集不可列、古いセルからのdraft、不正なページ番号を拒否する。

DOMはrole=grid / row / columnheader / gridcellとaria-sort、aria-selectedを付ける。両版で矢印による表示セル移動ができ、同じ下書きと確定値を表示する。Canvasは描画とヒット判定を共用し、編集時にブラウザの入力・選択欄を重ねる。

### 現段階の制限

ローカル配列とページ単位の描画。スクロールに連動する行/列の仮想化ではない。固定列、横スクロール、列幅のドラッグ変更・列移動、範囲コピー/貼り付け、グルーピング、ツリーGrid、リモートデータ取得、サーバー側の検索/ソート、undo/redoは未実装。状態はイベントごとにJSON経由で受け渡すため、2,000行を超える規模では通信・状態差分と描画方式も再検討する。

## タブ

xtype=tabpanel。itemsは1〜8個の部品、titleをタブ名として使う。activeTabは0始まりの初期番号。activeBindは現在番号のトップレベルキーで、省略時は生成する。disabled / disabledBindのタブには切り替えられない。無効な現在番号なら利用可能な先頭を表示する。

`{action:"tab",value:番号}`で切り替え、状態を更新してからtabpanel.handlerを呼ぶ。非表示の内容は配置・描画から外し、イベントとwindow表示も遮断する。入力状態は残す。左右/Home/Endで利用可能なタブを切り替えられる。タブの閉鎖、追加、並べ替え、スクロールは未実装。

## ツリー

xtype=treepanel / tree。root.childrenまたはchildrenにノード配列を指定し、rootVisible=trueならroot自体も表示する。bind指定時は状態の配列を使う。各ノードはid、text、children、leaf、expanded、disabledを持てる。最大500ノード・20階層。id省略時は構造パスを使うため、動的なツリーでは明示的なidを推奨する。

expandedBindは展開id配列、selectedBindは選択id。省略時は生成し、起動前のデータのexpanded=trueで初期化する。矢印は`{action:"toggle",id}`、項目は`{action:"select",id}`。非表示の子ノードやdisabledノードへのイベントは拒否する。ツリーhandlerでGridのfilterBindを変える実例あり。columns付きのツリーGrid、ドラッグ移動、チェックツリー、遅延読込は未実装。

## メニュー

xtype=menuをトリガー付きメニューとして実装する。text / titleがトリガー名。itemsは1〜12個のbuttonまたはmenuseparator。itemのxtype省略時はbutton、`{text:"-"}`や文字列`"-"`は区切り線として解釈する。文字列の項目名、button.menuとsplitbuttonも[追加部品の契約](uivolve-gallery.md)で扱う。サブメニューは未対応。

openBindはトップレベルbool、省略時は生成する。toggleで開閉、closeで閉じる。項目クリック・エンジン内の別操作・外側クリック・Escapeで閉じる。項目のhandlerは名前で指定する。ArrowDownで開き、上下で有効な項目を移動できる。背景を遮断せず、同じ描画エリアの部品の上へ重ねる。window内でも親の枠で切れないように表示し、より上のwindowの背後には留まる。

テーマは既存の色トークンを共用する。uivolveとの対応は設定と振る舞いの部分移植で、CSSや画面全体の完全互換を前提としない。
