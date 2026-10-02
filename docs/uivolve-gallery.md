# 追加コンポーネントの契約

[ギャラリーJSON](../public/screens/uivolve-gallery.json)と[Rhai](../public/screens/uivolve-gallery.rhai)を`?screen=uivolve-gallery`で試せる。参照元の登録部品を基本機能の範囲で移植している。以下の機能差があるため、uivolveの画面JSON全体との互換や各ライブラリの完全な置換は保証しない。

## 操作と状態

| 部品・別名                               | 対応する設定・操作                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| toolbar / tbar                           | items。button、フィールド、menuなどを横に配置。文字列`"->"`はtbfill、`"-"`はtbseparator、空白はtbspacer、その他はtbtext。panel/form/window/fieldset/chatpanelのtbar/bbar/buttonsも配列またはtoolbar設定で指定できる                                                                                      |
| tbfill / tbseparator / tbspacer / tbtext | 余白、区切り線、間隔、text。toolbar内で使用                                                                                                                                                                                                                                                              |
| splitbutton / button.menu                | text、handler、menu配列またはmenu設定。主ボタンは`<itemId>-main`、メニューは`<itemId>-menu`。主ボタンとメニュー項目はそれぞれRhai handlerを実行                                                                                                                                                          |
| radiogroup / checkboxgroup               | fieldLabel、items、columns（1〜8）、readOnly、disabled。radio子は親のbind/nameを共有しinputValueで選択。checkbox子は個別のbool bindingを持つ                                                                                                                                                             |
| datepicker                               | bind（YYYY-MM-DD）、pageBind（YYYY-MM）、value、today、showToday、todayText、readOnly。月移動と42日分の日付選択。handlerのactionは`month`/`select`、valueは月/日付文字列                                                                                                                                 |
| pagingtoolbar                            | totalまたは件数のbind、pageSize（1〜2000）、pageBind（0始まり）。先頭・前・次・末尾。handlerは`action="page"`と0始まりvalue。Gridとの連動はRhaiで行う                                                                                                                                                    |
| messagebox / msgbox                      | title、message/msg、prompt、bind、value、visibleBind、selectedBind、hidden、closable、buttons（ok/okcancel/yesno/yesnocancelまたは文字列配列）、handler。既存windowへ変換。回答はselectedBindへ保存し閉じる。handlerは`action="answer"`、idはボタン表示文字列、valueは入力値。×/Escapeは`action="close"` |
| toast                                    | title、message/text、visibleBind、hidden、closable。visibleBindはbool。×は`action="close"`。通常の画面配置に表示                                                                                                                                                                                         |
| accordionレイアウト                      | container/panelの`layout="accordion"`。子panel/fieldsetを折りたたみ可能にし、一度にひとつを展開。初期状態は最初のcollapsed=falseの子を選ぶ。すべて閉じることもできる                                                                                                                                     |

新部品のitemIdと上記の専用bindingを省略すると自動生成する。業務スクリプトから参照する状態には明示的なbindingを付ける。stateは初期値のvalue/hiddenより優先される。イベント時の型・日付・範囲・図表データを検証し、Rhaiの失敗を含めて変更を取り消す。閉じたダイアログ、非表示タブ、モーダルの背後への操作は既存のWASMガードを通る。

pagingtoolbarの件数は0〜10億の整数、pageBindは有効なページ内の整数にする。件数を変更して現在ページが範囲外になる場合は、同じRhaiハンドラでページも更新する。

datepickerのtodayは、比較アプリがHTTPパッケージを読み込む際にブラウザのローカル日付を補う。WASMに時計のインポートはない。WASM単体利用ではvalue/todayを明示する。単体で両方省略した場合は未選択、表示月は2026-01。日付は西暦0001〜9999のグレゴリオ暦で、ブラウザ組み込みのdatefieldと同様、言語別カレンダーやタイムゾーン変換は含まない。

## テキスト・エディター・会話

| 部品・別名         | 基本機能                                                                           | 元の部品との機能差                                                                |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| component / box    | text、value、htmlまたはbindをテキスト表示                                          | htmlも文字列として表示。HTML・任意DOMの実行なし                                   |
| codeeditor / code  | bind/value、title/fieldLabel、rows、readOnly、language。等幅textareaで編集         | Monaco、構文色分け、補完、行番号、minimapは未実装。入力したコードを自動実行しない |
| htmleditor         | HTMLソースの複数行編集、bind/value                                                 | contentEditableによる書式編集、HTMLプレビュー、太字などのツールバーは未実装       |
| diffeditor / diff  | originalとvalue/bindの行差分。共通行・追加・削除を色分け                           | 先頭200行までの読み取り専用の統合差分。sideBySide編集やMonaco連携は未実装         |
| markdown           | 見出し、`- `の箇条書き、コードフェンス、通常の段落                                 | インライン装飾、リンク、表、画像、HTMLは未実装。markedの全構文互換なし            |
| chatpanel / chat   | title、messagesまたはbindの配列、typing、tbar/bbar。各メッセージはfrom、name、text | メッセージ表示とRhaiの送信例。モデル接続、ストリーミング、添付は未実装            |
| terminal / console | title、linesまたはbind配列、maxLines（1〜500）。末尾のログ行を保持                 | ログ表示。シェル実行、周期アニメーション、speed、ターミナル制御シーケンスは未実装 |

編集欄のIME・選択・入力は既存のネイティブtextareaを利用し、Canvasでも編集中だけ重ねる。編集中の要素は再描画やテーマ変更で作り直さない。表示専用の文書・差分・会話・ログはSVG/Canvasへ共通の行データを描画し、高さを超える行をクリップする。内部スクロール・文字選択・リンク操作は未実装。長い内容はheightを指定するか、内容を短く分割する。heightは24〜1200px。

## 図表

Rust/WASMが座標・図形・文字列を計算し、DOMはSVG、CanvasはCanvas 2Dへ同じ描画データを渡す。外部のチャート・グラフ描画ライブラリを読み込まない。

| 部品・別名                | 設定と制限                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| chart / cartesian / polar | store（配列または`{data:[...]}`）、data、bind。seriesはオブジェクトまたは1要素配列。typeはbar/line/area/pie、xField（既定name）、yField（既定value、配列なら最大4系列）。最大50データ点。pieは先頭yFieldを使用し値は非負。polarのseries省略時はpie。軸設定、ツールチップ、ズーム、凡例操作、対話イベントは未実装                                                                                                                                                         |
| draw                      | sprites最大200個。typeはrect/circle/ellipse/line/path/text。座標x/y/cx/cy/fromX/fromY/toX/toY、width/height/r/rx/ry/radius、path（SVGパス）、text/fontSize/fontWeight/textAlign、fillStyle/strokeStyle/lineWidth/opacity。色は6桁/8桁hexまたはtheme token（text/border/background/surface/accent/muted/selected/primary）、none。座標は絶対値10000以下、寸法は非負、opacityは0〜1。基準座標460×260から表示サイズへ拡縮。変形・アニメーション・図形単位のイベントは未実装 |
| gitgraph                  | branches（最大12）、commits（最大100）。id、branch、message、parents（id配列）、tag。親参照とidの一意性を検証して枝を描画。Gitリポジトリを直接読み込まない                                                                                                                                                                                                                                                                                                               |
| networkgraph / forcegraph | nodes（最大50）: id、text、group、r、color。edges（最大100）: from、to。WASMの反発・ばね計算50回による決定的な静的配置。継続的な物理シミュレーション、ドラッグ、ズーム、ノードイベントは未実装                                                                                                                                                                                                                                                                           |
| mermaid                   | value/bind。`flowchart LR/TD/TB`または`graph LR/TD/TB`の基本部分。`A[ラベル] --> B[ラベル]`、括弧/波括弧ラベル、連結した辺、改行/`;`、`%%`コメント。idはASCII英数字/underscore。最大12ノード/24辺/10KB。形状は共通の矩形。sequence/ER、サブグラフ、スタイル、辺ラベル等はエラー。Mermaidライブラリの完全実装ではない                                                                                                                                                     |

図表はheight（既定260px）を指定できる。chartの系列色は固定6色であり、パレットのカスタマイズは今後の拡張。文字・背景・枠は共通テーマを利用する。

## メディア

image/imagecomponentはsrc、alt、title。DOMはimg、Canvasは読み込んだ画像をdrawImageで描く。videoはsrc、poster、controls（既定true）、muted、autoplay、loop。iframe/uxiframeはurlまたはsrc、title。URLはパッケージを取得したURLを基準に相対解決し、HTTP/HTTPSか相対URLを使用する。ローカル配信のSVG・WebM・HTMLをギャラリーに同梱している。

動画とiframeはCanvas側でもネイティブDOMを重ねる。動画の再生位置やiframe内部の状態はそれぞれのブラウザ要素が管理するため、DOM版とCanvas版で独立。テーマ・通常の状態更新で要素を維持し、タブ/画面切替で破棄する際に動画を停止する。Canvasのモーダルやメニューが開いている間は、背後のネイティブ要素を一時的に非表示にする。iframeは空のsandboxとno-referrerを付け、内部スクリプトやフォーム等を許可しない。video/iframeをCanvasだけで描く方式、再生操作のWebMCP公開、CORSを跨ぐCanvasの画像書き出しは含まない。

通知の自動消去やalignによる四隅固定、pagingtoolbarの直接ページ入力/再読み込み/displayMsg置換、アイコンフォント、独自CSS、borderレイアウトは未実装。WebMCPではカレンダーの日付セル・ページボタン・ダイアログ回答なども表示中のkeyとpayloadを取得して共通のui_dispatchから操作できる。
