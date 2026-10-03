# KANBANとドラッグ＆ドロップ

ローカルのデモは`http://127.0.0.1:4174/pages/kanban`。「アプリケーション例」のKANBANからも開ける。[画面YAML](../public/screens/kanban.yaml)と[Rhai](../public/screens/kanban.rhai)は別ファイルでHTTP配信する。

## 画面の記述

```yaml
xtype: kanban
itemId: taskBoard
bind: cards
handler: cardMoved
lanes:
  - id: todo
    title: 未着手
  - id: doing
    title: 進行中
  - id: done
    title: 完了
```

`itemId`とトップレベルの`bind`は必須。`lanes`は1〜6列で、`id / title`だけを指定する。列とカードのidは1〜64文字のASCII英数字・`- / _`。列idは一意。titleは空でない160 UTF-8バイト以内の文字列。

bind先は100件以内のカード配列。未定義のbindはinit前に空配列で補完し、明示stateは保持する。各カードは`id / title / lane`を必須とし、任意の`description`（320 UTF-8バイト以内の文字列）、`disabled`（bool）を持つ。カードidはボード内で一意、laneは宣言した列id。追加の業務データもカードに保持できる。stateSchemaを併用する場合はそのデータの型も宣言する。

```yaml
state:
  cards:
    - id: task-1
      title: 画面を設計
      description: YAMLで構成する
      lane: todo
```

列内の順序は配列順。Rhaiで追加・削除・内容変更したカードも、確定時に検証して両側へ反映する。KANBANに子の`items`は置けない。幅が不足した場合は列を縦に並べ、内容の高さまで伸ばす。内部スクロールや仮想化は行わない。

## 移動と検証

DOMとCanvasは同じポインター処理と挿入位置判定を使う。カードをつかみ、5px以上動かすとドラッグ表示になる。列・挿入線を表示し、空の列にもドロップできる。ドロップ時に一度だけ以下のイベントを送る。

```json
{
  "action": "move",
  "id": "task-1",
  "value": "doing",
  "beforeId": "task-3"
}
```

`value`は移動先の列id。`beforeId`は移動先の列にある別のカードid。その直前へ挿入する。省略またはnullなら列末尾。元の列、無効なカード、存在しない列・挿入先、同じカードを挿入先にする操作をWASMで検証する。ボードの`disabled / disabledBind / readOnly`、親の無効・非表示、モーダル背後への操作も遮断する。

WASMはstateのコピーでカードを移動し、任意のhandlerへ`event.id / value / oldValue / column / beforeId`を渡す。oldValueは元の列id、columnは移動先の列id。handler後にstateSchemaとカード構成を検証して確定する。handlerがthrowしたり、不正なstateを返した場合はカード・順序・state・revisionを変更しない。

```rhai
fn cardMoved(state, event) {
    if state.reviewRequired && event.value == "done" {
        throw "完了への移動はレビュー待ちです。";
    }
    state.notice = `${event.id}: ${event.oldValue} → ${event.value}`;
    state
}
```

Escape、ポインターキャンセル、領域外でのドロップ、画面更新・切り替えでドラッグを中止する。ドラッグ中の位置・ゴースト・挿入線はアダプターの一時表示で、共通stateを更新しない。ドラッグ中に別の操作で画面が更新された場合も中止し、古い並びへの移動を送らない。

## キーボードとWebMCP

カードへTabでフォーカスし、Alt＋左右で隣の列の末尾へ移動、Alt＋上下で同じ列内を並べ替えられる。DOM・Canvasで同じmoveイベントを使う。単純なクリックやEnter/Spaceではカードを移動しない。

`ui_get_screen`は`kanban-lane`のlane/count、`kanban-card`の安定key・値・lane・actionsを返す。表示中のカードkeyに`ui_dispatch`で`payload: {value: "doing", beforeId: "task-3"}`を送ると、既定のaction/idへマージして移動する。通常と同じtoken/revision・WASM・Rhai検証を通る。[WebMCP契約](webmcp.md)も参照する。

## 対応範囲と確認

今回の対象は同一ボード内のマウス操作、列移動、列内の並べ替え、キーボード操作。OSファイルのドロップ、別ウィンドウ・別ボード間の移動、複数カード選択、タッチ操作の最適化、端での自動スクロール、列の並べ替え、ドラッグによるwindowの移動は含まない。変更はメモリ内で、保存はアプリがHTTPやstorage/files APIで実装する。

既存DSLの動作は維持する。新しい`kanban / lanes / beforeId`には対応エンジンと両レンダラーが必要。古いWASMでは新xtype・属性を拒否するため、配布時はJS/CSS/WASMを一式更新する。

`tests/kanban.test.js`は実WASMの移動・順序・空列・安定key、無効な入力、Rhaiの拒否と不正state、狭い幅、readOnly/disabled/modal、WebMCP、ポインターの閾値・座標変換・中止・リスナー解放を確認する。ブラウザでは以下を試す。

1. DOMでカードを別の列へドラッグし、Canvasも同じ列に移ること。
2. Canvasでカードを同じ列内で並べ替え、DOMの順序も変わること。
3. 「完了への移動をRhaiで拒否する」を選び、完了へドロップして元の位置を保つこと。
4. カードにフォーカスしてAlt＋左右／上下を使い、両側に反映されること。
