# 共通レイアウト

レイアウトはRust/WASMが幅に応じて必要な高さを測り、子の座標とサイズを計算する。DOMとCanvasは同じスナップショットを描く。CSS GridやFlexboxに配置計算を委ねない。`?screen=layout-lab`に比較用の実行例がある。

`container` / `panel` / `fieldset` / `window`の`layout`は、既存の文字列、または設定オブジェクトを受け付ける。省略時はvbox。panel/fieldset/windowはタイトルと枠の領域を引いた内側に配置する。

```json
{
  "xtype": "container",
  "layout": { "type": "grid", "columns": 3, "minColumnWidth": 140, "gap": 12, "padding": 8 },
  "items": [
    { "xtype": "panel", "title": "A", "items": [] },
    { "xtype": "panel", "title": "B", "colSpan": 2, "items": [] }
  ]
}
```

| layout    | 配置・設定                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| vbox      | 上から順に配置。高さは各部品の必要な高さ。                                                                                                                                                                                                             |
| hbox      | 横に配置。残りの幅を子の正の`flex`比率で配分。                                                                                                                                                                                                         |
| accordion | vbox配置に、同階層の折りたたみ制御を追加。既存の契約は[ギャラリー](uivolve-gallery.md)参照。                                                                                                                                                           |
| grid      | 等幅の列に順番に配置。`columns`は最大列数1..12（既定2）、`minColumnWidth`は40..1200（既定120）。幅に収まる列数へ自動で減らす。子の`colSpan`は1..設定列数、狭い幅では実際の列数まで縮める。行の高さはその行の最大必要高、パネル・コンテナの枠を揃える。 |
| card      | 1..32枚の子から1枚を表示。`activeBind`の状態が選ぶ0始まりの整数index。`activeItem`は初期値（既定0）。外枠は全カードの最大必要高を基準にする。                                                                                                          |
| border    | 子に`region: "north" / "south" / "west" / "east" / "center"`を指定。同じregionは1つ、centerは必須。上下は全幅、左右と中央は残りの高さ。                                                                                                                |
| fit       | 通常配置の子はちょうど1つ。親の内側全体を割り当てる。                                                                                                                                                                                                  |

共通設定`gap`（既定12）と`padding`（既定0）は0..64ピクセル。狭い幅では余白を縮め、負の寸法を避ける。`columns` / `minColumnWidth`はGridレイアウト専用。文字列`"grid"`にはコンテナ直下の数値`columns`も使える。

コンテナ・パネル・ウィンドウの`height`は最小の外枠高。内容が収まらないと必要な高さまで広がる。Borderの上下も必要高に従い、左右の`width`は希望幅（24..1200、既定180）。狭い幅では左右を比例縮小して中央を確保する。windowの幅は従来どおり240..1200。通常のvbox/hbox/gridでの子の固定`width`指定は配置に使わない。

Fit/Card/Borderが割り当てる高さに合わせてパネル・コンテナを広げる。個別の入力、ラベル、Data Grid、図表などは既存の部品寸法を使い、余った領域全体へ自動で拡大しない。入力領域を大きくするにはtextareaの`rows`など、部品の設定を使う。

## Cardの状態とイベント

```json
{
  "xtype": "panel",
  "itemId": "wizard",
  "title": "入力",
  "layout": "card",
  "activeBind": "step",
  "activeItem": 0,
  "items": [
    { "xtype": "container", "title": "名前", "items": [] },
    { "xtype": "container", "title": "確認", "items": [] }
  ]
}
```

`state.step`をRhaiで変更するか、Card親へ`{ "action": "card", "value": 1 }`を送る。`itemId`や`activeBind`を省略した場合は構造パスから生成する。明示されたstateを優先し、未設定の場合に`activeItem`から初期化する。ハンドラも通常のRhai関数で、イベント時は切替後のstateを受け取る。範囲外・整数以外の状態はinit/イベントの確定前に拒否し、以前の画面や状態を保つ。

非表示カードの入力はstateに残り、再表示時に復元する。非表示の子へのイベントは処理せず、子に入れたwindowも表示・モーダル判定から外す。windowをCardの直接の子には置けないが、カード内のcontainer/panelに入れられる。明示的なCard切替イベントはdisabledのカードへの移動を拒否する。RhaiがactiveBindを直接変更する場合は、有効なindexかを検証する。

WebMCPの`ui_get_screen`は`wizard:card`を`kind: "card"`として記述し、`metadata.activeItem / count / titles`と`actions: ["card"]`を返す。`ui_dispatch`でそのキーに上記payloadを送り、非表示カードの子はツールの対象にも出さない。Card自身にはタブ見出しや切替ボタンを自動追加しない。必要な操作部品を外側に置く。[デモのRhai](../public/screens/layout-lab.rhai)は次へ/戻るを実装する。

## 現段階の範囲

`layout: "grid"`は画面配置であり、行データを表示する`xtype: "grid" / "gridpanel"`とは別。現在は列span、内容に応じた高さ、共通余白を扱う基本版。rowSpan、ドラッグによる領域サイズ変更、Borderのsplitter、内部スクロール、min/maxサイズ制約、縦方向のflex、テキストの計測・自動改行、差分だけの再配置は未実装。画面幅の変化で全体を再計算する。Fitは割り当てられた領域を使うが、ブラウザのviewport高を指定するAPIはまだない。uivolve/ExtJSのレイアウト全機能との互換を意味しない。
