# 部品開発ガイド

対象はuivolve-webエンジンの部品追加・変更。JSON/Rhaiだけで画面を作る場合は[画面契約](screen-format.md)を使う。

## 契約を先に決める

部品ごとに、次の項目を短く記す。実装後は該当する部品契約へ残す。

| 項目           | 決めること                                                     |
| -------------- | -------------------------------------------------------------- |
| 設定           | xtype・必要な属性・既定値・許容範囲・別名                      |
| 状態           | bind先、初期値、空値、入力の型、部品固有の状態制約             |
| 操作           | actionとpayload、組み込み更新の後にhandlerへ渡す情報           |
| 配置           | 必要高、幅への対応、親に割り当てられた高さの扱い               |
| 表示           | Widgetのkind/config、テーマ、表示用・入力用・複合部品の区別    |
| ライフサイクル | 非表示時の状態・フォーカス、入力要素、メディア・リスナーの終了 |
| 対応範囲       | DOM/Canvas/WebMCPで提供する動作、移植元との差分                |

未知属性はserdeで拒否する。新しい属性は`Node`または関連する型へ明示的に追加し、意味のある部品・レイアウトで検証する。`config`を任意のDSL属性の逃げ道にしない。

## 近い実装を選ぶ

| 追加するもの         | 最初に見る実装                                                               |
| -------------------- | ---------------------------------------------------------------------------- |
| 表示専用の小さな部品 | `lib.rs`のlabel/metric/displayfield、両レンダラー                            |
| 入力・選択           | `fields.rs`と`field-control.js`。新xtypeを既存の入力kindへ正規化できるか検討 |
| 複数の操作を持つ部品 | `navigation.rs`のmenu/tree、`extras.rs`のdatepicker/pagingtoolbar            |
| 配置                 | `layouts.rs`のvalidate/natural_height/slots、`lib.rs`のmeasure/arrange_sized |
| データ編集           | `grid.rs`の編集下書き・確定・取消・Rhai失敗時の保持                          |
| 図表・文書           | `figures.rs`の描画データ、`surfaces.js`のSVG/Canvasへの変換                  |
| ネイティブのメディア | `surfaces.js`のsyncMedia/disposeMedia、両レンダラーの更新・reset/dispose     |

新しいモジュールを作る場合も、既存の部品モジュールとの接続点を確認する。現在は自動登録のプラグインシステムではなく、明示的なRustの分岐で部品を選ぶ。

## エンジンへの接続

1. `lib.rs`の`Node`と`validate`へ設定とxtypeを接続する。移植元の別名や構成展開は`fields::normalize`から呼ぶ既存のnormalize経路へ入れる。
2. 未設定の状態だけをinitializeで補完する。画面の明示stateを上書きしない。トップレベルの書き込みbindを検証する。
3. 部品の状態に制約があるならvalidate_stateを用意し、`Runtime::load`のinit後と`Runtime::dispatch`のhandler後、確定前へ接続する。入力payload自体はhandler実行前に検証する。
4. measure/arrangeへ接続する。専用モジュールでは、既存のcomponent/advanced判定に相当する分岐も必要。レイアウトは計測時と配置時で同じ幅・余白・行構成を使う。
5. eventへ接続する。状態のコピーを変更し、最終確定をRuntimeへ任せる。handlerをレンダラーから直接実行しない。

型付きのフィールドは`fields::input / event_value / configure`が入口。`event_value`は受け付けた値を返し、Runtimeがbindを更新してからhandlerを呼ぶ。複合部品は固有event関数で状態を更新し、必要に応じてhandler向けpayloadを補う。

複数のWidgetを生成するときは、`<itemId>:<役割>:<安定ID>`など衝突しないkeyを付ける。行番号だけを選択・編集の識別に使わない。itemId内のコロンは内部key用に予約している。ルートのkeyは`root`、itemIdを省略した子は構造パスになるので、keyとtargetを同一と仮定しない。

新しい「子を隠す」構造を作る場合は、描画だけでなく、イベントのhidden判定とwindow収集にも同じ条件を接続する。Cardとtabpanelが参考になる。非表示にした入力の値は共通stateに保持する。

## 描画と操作

既存のkindへ展開できれば、その描画実装を再利用する。新kindが必要ならDOMのcreate/render、Canvasのpaint、および`src/runtime.css`へ追加する。部品のCSSは`.uivolve-runtime`の表示領域へ限定し、デモ用の`src/styles.css`へ入れない。状態・行の並べ替え・業務計算は描画コードに入れない。

操作種別は`src/widget-contract.js`へ接続する。

- `fieldKinds`はネイティブ入力、`buttonKinds`はポインター/キーボードで操作するWidget。
- `isInteractive`はdisabledを除いた物理操作対象。読み取り専用の入力はフォーカスできる。
- `widgetActions`はWebMCPへ示すaction。Cardのような意味的操作だけの部品は、自動のボタン・Tab移動対象へ追加しない。
- `isBlocked`はWebMCPの変更可否。disabled、readOnly、モーダル背後を扱う。最終的な型・可視性・状態の判定はWASMでも行う。

入力を追加するときは、`createControl`の型変換と`syncControl`の更新に接続する。compositionstart/endとisComposingを維持し、変換途中の値を送らない。描画更新時は同じkey/kindの要素を保持し、同期処理で変換中の文字列を上書きしない。

ネイティブ要素を持つ部品は、非表示・画面切替・HMRのreset/disposeで停止・解放する。Canvasに重ねる要素は、モーダルやpopupの背後で前面に出ないか確認する。

## 最初の実行例

設定を増やす前に、1つの正常系を両方の描画方式で通す。たとえば表示専用の新xtypeなら、既存のlabel/metric経路を手本に、次のような最小パッケージを実行する。

```json
{
  "version": 1,
  "id": "component-example",
  "title": "部品の例",
  "script": "component-example.rhai",
  "state": { "status": "準備完了" },
  "ui": {
    "xtype": "container",
    "items": [{ "xtype": "label", "itemId": "status", "bind": "status" }]
  }
}
```

```rhai
fn init(state) { state }
```

上の例は現行エンジンで動くlabelの基準例。新xtypeへ置き換える場合は、先にエンジンへそのxtypeを登録する。専用イベントがある部品では、正常操作と拒否される操作をそれぞれ追加し、更新後のstate/revisionと表示を確認する。

画面を増やす場合は、`public/screens/<id>.json`とRhai、`src/screen-catalog.js`、デモの`index.html`の選択欄、起動URLの説明を更新する。カタログに載せたパッケージとスクリプトの存在はテストする。

## 完了の判定

[検証基準](testing.md)に従い、設定の拒否、正常イベント、handler失敗、非表示/disabled、狭い幅、IME、テーマ、WebMCPを変更に応じて確認する。表示専用部品には不要な入力テストを追加しない。実行例と契約文書に、実装した機能と未対応の機能を明記する。

Rustの大きな設定型や`extras.rs`の分割、registry/traitの導入は[整備計画](maintenance-plan.md)の次の候補。まず現在の接続と動作を守り、実際の部品追加で必要になった構造を整理する。
