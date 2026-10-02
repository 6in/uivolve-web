---
name: wasm-ui-authoring
description: このWASM UI Labの画面JSONとRhaiハンドラを作成・修正する。DOM版とCanvas版で同じ画面処理を実行するためのパッケージ契約に従う。
---

# WASM UI画面の作成

リポジトリ同梱のスキル。画面パッケージはエンジンと別にHTTPで取得され、RhaiはWASM内でASTへコンパイルされる。

- まず[画面形式](../../docs/screen-format.md)を読み、必要な部品とイベント契約を確認する。
- 配置は[共通レイアウト契約](../../docs/layouts.md)と[実行例](../../public/screens/layout-lab.json)を参照する。layoutのgridは画面配置で、xtypeのgridは一覧表示。Gridは最大列数とcolSpan、CardはactiveBindの整数index、Borderは一意のregionと必須center、Fitは1つの子を使う。共通gap/paddingは0..64。高さは最小高で、内容が多ければ広がる。rowSpan、splitter、内部スクロール等の未対応機能を捏造しない。Cardの操作ボタンはCardの外側へ置く。
- 配色は[テーマ形式](../../docs/theme-format.md)に従う別JSONとして作成する。画面JSONへ未対応のtheme/style属性を追加しない。テーマは色だけを指定し、modeごとの既定値で不足を補完する。
- 一覧・編集は[受注JSON](../../public/screens/orders.json)と[処理](../../public/screens/orders.rhai)、追加・状態変更は[タスクJSON](../../public/screens/tasks.json)と[処理](../../public/screens/tasks.rhai)を参考にする。
- パネルの折りたたみとモーダルの重ね表示は[部品JSON](../../public/screens/components.json)と[処理](../../public/screens/components.rhai)を参考にする。panel.collapsedBind、window.visibleBindにはトップレベルのbool状態キーを使う。windowは通常の配置領域を消費しない。
- フォームは[uivolve対応表](../../docs/uivolve-port.md)と[実行例](../../public/screens/uivolve-forms.json)を参照する。textfield/textarea/numberfield/datefield/checkbox/radio/combobox/listbox/displayfield/slider/progressbar/fieldsetと対応するxtypeの別名を使える。元のReact画面全体との互換を前提にしない。
- 追加部品は[ギャラリー契約](../../docs/uivolve-gallery.md)、[JSON](../../public/screens/uivolve-gallery.json)、[Rhai](../../public/screens/uivolve-gallery.rhai)を参照する。toolbar、日付カレンダー、入力グループ、通知・ダイアログ、エディター、図表、会話・ログ、メディアを使える。Monaco補完、リッチテキスト、完全なMarkdown/Mermaid、グラフ操作等を捏造しない。Rhaiのtrim()は文字列をその場で変更するため、戻り値を文字列として代入しない。
- 一覧とナビゲーションは[Grid・タブ・ツリー・メニューの契約](../../docs/grid-navigation.md)と[実行例](../../public/screens/grid-lab.json)を使う。Gridは安定した行idを必須とし、pageSizeで描画を制限する。セルの入力はeditingBindの下書きで、commitEditの後にRhaiが失敗すれば元データを保つ。Grid handlerはactionを見て処理を分け、commitEditではvalue/oldValue/column/idを参照できる。
- tabpanelはactiveBind、treeはexpandedBind/selectedBind、menuはopenBindを共通状態へ持つ。隠れたタブや折りたたまれたツリーの操作を作らない。未対応の固定列・仮想スクロール・サブメニュー・ツリーGridなどを設定で捏造しない。
- WebMCPによる操作は[共通ツール契約](../../docs/webmcp.md)を参照する。まずui_get_screenで表示中のkey・actions・最新screen.tokenとrevisionを取得し、ui_dispatchへ渡す。STALE_SCREENなら再参照し、Rhai検証エラーは入力を修正する。DOM／Canvasを直接操作する別経路を作らない。専用業務ツール用のDSL属性は未実装なので画面JSONへ捏造しない。
- `itemId`を操作部品に付け、ハンドラはJSONから名前で参照する。`init(state)`と各`handler(state, event)`は状態オブジェクトを返す。
- 入力のbind先はハンドラ呼び出し前に更新される。入力のbindはトップレベルキー。省略時はname、その次に生成キーを使う。安定した状態参照にはitemIdとbindまたはnameを明示する。checkboxはbool、numberfield/sliderは数値、複数listboxは文字列配列、radio/comboboxは文字列。numberfieldの空欄はnullで、Rhaiではunit `()`として検査する。
- 初期stateを優先し、ない入力キーだけvalue/checkedから初期化する。radioは共有bind/nameとinputValueでグループ化する。選択肢はoptionsまたはstore.data（displayField/valueField）で指定する。allowBlank/minLength/inputTypeの指定だけで保存検証が済むと考えず、必須・形式検査はRhaiへ書く。
- パネルのtoggleとwindowのcloseも状態を変更してからhandlerを呼ぶ。背後や隠れた部品へのイベントは受け付けない。× / Escapeと内容内のキャンセルボタンの処理を揃え、親windowを閉じる際は必要に応じて子windowの表示状態も戻す。
- Rhaiのtrim()は文字列をその場で変更する。戻り値を代入・比較しない。コピーへtrim()を呼んでから空文字列か検査する。
- レイアウトはvbox/hbox/accordionとflex。HTML編集はhtmleditorのソース文字列、図形座標はdraw.spritesの指定範囲で扱う。CSS・DOM参照・描画アダプターのAPIを画面処理へ混ぜない。動画/iframeの再生状態はネイティブ要素が管理し、共通WASM状態との同期を前提にしない。
- 計算・検証・一覧の絞り込みはRhaiに置く。通信、async/await、タイマー等の未実装APIを捏造しない。必要なら拡張点として説明する。
- 変更したJSONとRhaiをWASMエンジンの`load`へ通し、主要イベントを確認する。ブラウザの定義エディタからも検証できる。両バックエンドで同じ状態が見えることを確認する。

エンジン拡張が必要な場合は、画面パッケージの修正と分けて影響を説明する。対応属性・Rhai機能の最終的な根拠は`engine/src/lib.rs`と`engine/Cargo.toml`。
