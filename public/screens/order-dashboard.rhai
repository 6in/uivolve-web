// 受注一覧の部品を2つ並べる親画面。絞り込み文字列を config で配り、選択の知らせを listeners で受ける。
// 全ハンドラは state と event を受け取り、新しい state を返す。
fn init(state) { state }

fn filterChanged(state, event) { state }

fn onSelected(state, event) {
    state.notice = (if event.target == "open" { "受注" } else { "出荷済" }) + " の部品で " +
        event.value.number + " / " + event.value.customer + " を選択しました。";
    state
}
