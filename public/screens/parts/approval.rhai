// 部品として親画面に埋め込む承認。自分で confirm ダイアログを出し、回答を親へ知らせる。
// 全ハンドラは state と event / response を受け取り、新しい state を返す。
fn init(state) { state }

fn ask(state, event) {
    confirm("承認しますか？", "answered");
    state
}

fn answered(state, response) {
    state.result = if response.data == true { "承認" } else { "却下" };
    emit("answered", #{ "approved": response.data == true });
    state
}
