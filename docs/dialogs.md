# 通知・確認・入力ダイアログ

Rhaiから`alert / confirm / prompt`を依頼し、アプリ共通の独自ダイアログで表示する。DOM・Canvasのどちらから操作しても、ダイアログは1つだけ開く。配色は現在のテーマを使う。ブラウザのwindow.alert/confirm/promptは呼び出さない。

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

## 回答・操作・制限

handlerのresponseは`ok / data / error / operation / cancelled`を持つ。

| 操作・結果               | ok    | data                 | cancelled |
| ------------------------ | ----- | -------------------- | --------- |
| alertを閉じる            | true  | null                 | false     |
| confirmのOK              | true  | true                 | false     |
| confirmのキャンセル      | true  | false                | true      |
| promptのOK               | true  | 文字列（空文字も可） | false     |
| promptのキャンセル       | true  | null                 | true      |
| 表示失敗・回答サイズ超過 | false | null                 | false     |

Rhaiのnullはunit `()`としても検査できる。キャンセルは正常な回答。成功時errorは空文字列。×・Escapeはキャンセルボタンと同じ結果。alertでは閉じた扱い。Enterは選択中のボタン／入力のOK。promptはネイティブinputを使い、IME変換中のsubmit・Escapeで回答を確定しない。

タイトル・メッセージ・入力・ボタンは共通のHTMLモーダルシェルに表示する。`<dialog>.showModal()`を使って背景への物理操作を遮断し、Tabの移動を内部へ保つ。閉じた後は元の操作部品へフォーカスを戻す。背景クリックだけでは閉じない。CSSはthemeの色トークンを使い、幅は画面に収め、長い内容は内部でスクロールする。

完了handlerは最新stateを受け取り、その結果もstateSchema・UI検証へ通す。違反時はstateとrevisionを保持し、完了idは再使用できない。同じイベントの依頼は発行順に表示する。完了handlerから次の依頼も発行できる。最大8件まで進行し、message・defaultValue・promptの回答は各4,096 UTF-8 bytes、handler名は80 bytesまで。

画面置換・ホットリロードでは表示中のダイアログも閉じ、未表示の依頼・古い回答を破棄する。ユーザーが回答する時間にタイムアウトは設けない。ページ側がloadingを持つ場合は、依頼時にtrue、成功・キャンセル・失敗のどの完了でもfalseへ戻す。

ダイアログを待つ間のWebMCPによる背景の変更はBUSYになる。`ui_get_screen.dialog`で操作名・メッセージ・現在の入力を参照できる。回答は現在のダイアログUIで行う。専用の回答ツールは今後の拡張対象。

## 実装・拡張する場所

- `engine/src/dialogs.rs`：Rhai API、依頼・handler・id・回答の型と上限。確定前の検証に参加する。
- `src/dialog-effects.js`：非同期表示のFIFO、画面世代、AbortSignal、WASMへの完了。描画内容を持たない。
- `src/dialog-presenter.js`：通知・確認・入力のパターン定義と、共通シェル・フォーカス・回答・閉じ方。
- `src/styles.css`の`.ui-dialog*`：共通シェルの外観。既存テーマの色トークンを使う。

追加ABI操作は`dialog_result`、JS側は`WasmEngine.completeDialog`。WASMのブラウザimportは増やさない。将来、複数フィールドや選択一覧のパターンを加える際は、PresenterのパターンとWASMの引数・回答契約を一緒に拡張する。現在は3種類だけで、任意のdialog DSLやフォームスキーマは未実装。

既存の[messagebox/window](uivolve-gallery.md)は各描画領域内の部品として維持する。このAPIのダイアログはホスト全体のモーダルで、DOM/Canvasへ二重に描画しない。

`tests/dialogs.test.js`で実WASMと注入した表示アダプターを使い、OK/キャンセル/空文字、UTF-8上限、検証失敗時の非発行、FIFO・連鎖・画面世代を確認する。モーダルの表示・キーボード・テーマ・入力は実ブラウザでも確認する。

2026-10-03の検証：Vitest 230件・Rust 7件が成功し、ビルド・静的チェック・文書リンク・画面作成スキルの形式検証も成功。ブラウザで通知、確認のOK/キャンセル、入力の日本語・空文字・Escape、×、Tab/Shift+Tabの循環、フォーカス復帰、ライト/ダーク、Canvasからの呼び出しと両側の状態反映、戻るによる画面置換時の破棄、WebMCPの参照とBUSYを確認した。日本語文字列の入力確認であり、OS固有の実IME変換操作の自動検証は含まない。
