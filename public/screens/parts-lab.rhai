// HTTP取得・ブラウザ保存・確認ダイアログを使う3つの画面パッケージを部品として並べる親画面。
// 各部品は自分の効果を自分で完了させ、終わったことだけを listeners で親へ知らせる。
// 全ハンドラは state と event を受け取り、新しい state を返す。
fn init(state) { state }

fn onSaved(state, event) {
    state.notice = "メモを保存しました: " + event.value.text;
    state
}

fn onAnswered(state, event) {
    state.notice = if event.value.approved { "承認されました。" } else { "却下されました。" };
    state
}
