# 通知・確認・入力ダイアログ

Rhaiから`alert / confirm / prompt`を依頼すると、WASMエンジンがダイアログを画面のSceneへ構成する。DOM版は自分の表示領域内のDOMで、Canvas版は自分のCanvas上に描画する。比較デモでは同じ1件の依頼を両側へ表示し、どちらで回答しても両側へ反映する。配色は現在のテーマを使う。

専用のDSL宣言は不要。実行例は[dialogs.yaml](../public/screens/dialogs.yaml)と[Rhai](../public/screens/dialogs.rhai)。`/pages/dialogs`で開ける。

## 呼び出し方

```rhai
fn notify(state, event) {
    alert("保存しました。");
    state
}
fn askConfirmation(state, event) {
    confirm("この内容で進めますか？", "confirmationDone");
    state
}
fn confirmationDone(state, response) {
    if !response.ok { state.notice = response.error; }
    else if response.data {
        state.notice = "OKが選択されました。";
        // 保存やRPCなど、次の依頼をここで発行できる。
    } else { state.notice = "キャンセルしました。"; }
    state
}
fn askName(state, event) {
    prompt("名前を入力してください。", state.name, "nameDone");
    state
}
fn nameDone(state, response) {
    if !response.ok { state.notice = response.error; }
    else if response.cancelled { state.notice = "名前を変更せずキャンセルしました。"; }
    else { state.name = response.data; } // 空文字のOKもここへ来る。
    state
}
```

| Rhai API                                 | 完了handler                            |
| ---------------------------------------- | -------------------------------------- |
| `alert(message)`                         | 省略可。閉じた後のstateは保持          |
| `alert(message, handler)`                | 閉じた後に呼び出す                     |
| `confirm(message, handler)`              | boolの回答を受け取る                   |
| `prompt(message, handler)`               | 初期文字列は空                         |
| `prompt(message, defaultValue, handler)` | 文字列またはキャンセルのnullを受け取る |

message・defaultValue・handlerは文字列。callbackは同じRhaiの`fn handler(state, response)`を名前で指定する。名前と引数2個を依頼の確定前に検証する。confirm/promptのhandlerは必須。

呼び出しの戻り値はunit `()`。`if confirm(...)`や`state.name = prompt(...)`とは書かず、完了handlerで回答を扱う。画面のstate/UIとすべてのI/O依頼を検証してから表示する。Rhaiコードは同期実行のままで、ユーザーの回答を待つ間はブラウザの実行をブロックしない。

## アイコン

省略時はalertが`info`、confirmが`question`、promptが`input`を表示する。標準アイコンは`info / success / warning / error / question / input`。`none`で非表示にできる。標準のパス定義はレンダラーに同梱し、DOMではSVG、CanvasではPath2Dとして描画する。配色には現在のテーマを使う。

既存の引数の末尾にオプションmapを追加する。`alert(message, options)`はhandler省略用。`prompt(message, handler, options)`では初期値は空文字で、`prompt(message, defaultValue, handler, options)`でも指定できる。オプション省略や`#{}`はデフォルトと同じ。現在のオプション項目は`icon`のみで、未知の項目は拒否する。

```rhai
alert("保存しました。", #{icon: "success"});
confirm("削除しますか？", "confirmationDone", #{icon: "warning"});
prompt("名前", state.name, "nameDone", #{icon: "input"});

// SVG/PNG等の画像URL。相対URLは、ダウンロードした画面定義のURLを基準にする。
alert("アプリからのお知らせ", "noticeDone", #{
    icon: #{src: "../assets/app-icon.svg", alt: "アプリのアイコン"}
});
// 絵文字や文字。HTML/SVGのソースとしては解釈しない。
alert("準備できました。", #{icon: #{text: "🚀", alt: "ロケット"}});
alert("アイコンを表示しません。", #{icon: "none"});
```

画像はHTTP/HTTPSのURLを使い、`src`は2,048 UTF-8 bytes以内。空白を含むファイル名はURLエンコードする。`text`は空白のみを除く1〜64 UTF-8 bytes、任意の`alt`は160 UTF-8 bytes以内。画像指定は`src / alt`、文字指定は`text / alt`だけを受け付け、両形式は混ぜない。標準アイコンは種類の名前、カスタムはalt（省略時は文字や「カスタムアイコン」）をアクセシビリティへ公開する。

画像URLの解決はホストが行い、data/blob/file/javascriptや資格情報を含むURLは受け付けない。不正な形・名前・サイズはWASMで依頼の確定前に拒否する。URL解決失敗や画像の404等は情報アイコンへ置き換え、ダイアログ自体は操作できる。画像取得はブラウザのimg要素で行い、ResourceClientのJWTは付与しない。Refererは送信しない。カスタム画像・絵文字の色は元のアセット／フォントに従う。

サンプルの「アイコン」欄で標準6種類・任意SVG・絵文字・非表示を切り替え、3つのダイアログで試せる。

## 回答・操作・制限

handlerのresponseは`ok / data / error / operation / cancelled`を持つ。

| 操作・結果          | ok    | data                 | cancelled |
| ------------------- | ----- | -------------------- | --------- |
| alertを閉じる       | true  | null                 | false     |
| confirmのOK         | true  | true                 | false     |
| confirmのキャンセル | true  | false                | true      |
| promptのOK          | true  | 文字列（空文字も可） | false     |
| promptのキャンセル  | true  | null                 | true      |
| ホストの失敗通知    | false | null                 | false     |

Rhaiのnullはunit `()`としても検査できる。キャンセルは正常な回答。成功時errorは空文字列。×・Escapeはキャンセルボタンと同じ結果。alertでは閉じた扱い。Enterは選択中のボタン／入力のOK。promptはネイティブinputを使い、IME変換中のsubmit・Escapeで回答を確定しない。

WASMが通知・確認・入力の構成、座標、表示順、promptの下書き、回答を管理する。既存のwindow/backdrop/textfield/buttonのScene部品を使い、本文とアイコンの部品を加えて表示する。背景操作の遮断もエンジンで行う。DOMはrole=dialogとinert、Canvasは描画とヒットテストを使う。Tabは領域内のダイアログへ留まり、閉じた後はその領域の元の部品へフォーカスを戻す。背景クリックだけでは閉じない。比較ページのツールバーや画面切替は操作できる。

promptの下書きはページのstateへ混ぜず、エンジン内で保持する。片側で入力するともう片側の入力へも反映する。下書き更新でもrevisionを進め、WebMCPの古い操作を拒否する。Canvas版は入力中だけ既存のIME用HTML入力欄と連携し、枠・本文・ボタン・アイコンはCanvasへ描画する。

本文はWASMで改行と折り返しを計算する。長文は本文領域を最大220pxに抑え、DOMではスクロール、Canvasでは本文上のホイールで読み進める。スクロール位置は各レンダラーにあり、回答と下書きはエンジンで共有する。

完了handlerは最新stateを受け取り、その結果もstateSchema・UI検証へ通す。違反時はstateとrevisionを保持し、回答済みの依頼は消費するためダイアログは閉じるか次の依頼へ進む。同じidの再完了はできない。同じイベントの依頼は発行順に表示し、完了handlerから次の依頼も発行できる。最大8件まで進行し、message・defaultValue・promptの回答は各4,096 UTF-8 bytes、handler名は80 bytesまで。回答サイズ超過は確定前に拒否し、下書きを保持する。

画面置換・ホットリロードでは表示中と未表示の依頼を破棄する。idは同じエンジンの画面置換をまたいで再使用せず、古い回答イベントが新しいダイアログへ届かないようにする。回答待ちにタイムアウトは設けない。ページ側がloadingを持つ場合は、依頼時にtrue、成功・キャンセル・失敗の各完了でfalseへ戻す。

WebMCPでは`ui_get_screen.dialog`でid・操作名・メッセージ・指定したicon・現在の入力を参照できる。iconのsrcは依頼時の値で、相対URLの解決は各レンダラーが行う。ダイアログだけではbusyにならず、背景部品への`ui_dispatch`はBLOCKED、表示中の入力・OK・キャンセル・×は通常の`ui_dispatch`で操作できる。入力には`value`、入力中のEnter確定には`action: "accept", value`を渡す。表示中のkeyとactions、最新screen.tokenとrevisionを毎回参照する。内部keyを画面DSLへ記述しない。

## 実装・拡張する場所

- `engine/src/dialogs.rs`：Rhai API、依頼・handler・id、FIFO、下書き、回答、Scene構成、型と上限。
- `engine/src/lib.rs`：ダイアログイベントの優先処理、背景操作の遮断、通常windowの上のmodal層。
- `src/dom-renderer.js` / `src/canvas-renderer.js`：各領域での描画、キーボード、IME連携、フォーカス。
- `src/dialog-icons.js`：共有パス定義、任意文字／画像の検証とURL解決、各描画方式と画像失敗時の代替表示。

通常の回答は`event` ABIでエンジンへ届く。追加ABIの`dialog_result`とJSの`WasmEngine.completeDialog`も、独自ホストが依頼を完了させるために維持する。`kind=dialog`のeffectsは発行通知として残すが、比較デモでは外部の表示アダプターへ振り分けずSceneを描画する。WASMのブラウザimportは増やさない。

複数フィールドや選択一覧を加える際は、エンジンのパターン・引数・回答契約と両レンダラーを一緒に拡張する。現在は3種類だけで、任意のdialog DSLやフォームスキーマは未実装。既存の[messagebox/window](uivolve-gallery.md)も各描画領域内の部品で、同じmodal層の仕組みを使う。

## 検証

`tests/dialogs.test.js`と`tests/webmcp.test.js`で実WASMを使い、Scene内の構成、領域内の座標、既存windowより上の表示、背景遮断、共有下書き、OK/キャンセル/空文字、UTF-8上限、FIFO・連鎖、画面置換後の古い操作、非同期応答後の最新state、WebMCPからの入力・回答を確認する。

2026-10-03の領域内描画への変更後：Vitest 260件・Rust 7件が成功。ブラウザでもDOMとCanvasのalert表示、Canvas側の回答による両側の閉鎖、日本語promptの共有入力とEnter確定、DOMのEscapeキャンセル・空文字確定とフォーカス復帰、任意SVGと絵文字の両方式での描画、表示中のダークテーマへの切替、Canvasのconfirm回答、WebMCPの背景BLOCKEDと×による閉鎖を確認した。OS固有の実IME変換操作の自動検証は含まない。
