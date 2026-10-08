// 部品として親画面に埋め込むメモ。自分の storage 宣言でブラウザ保存を使い、保存できたら親へ知らせる。
// 全ハンドラは state と event / response を受け取り、新しい state を返す。
fn init(state) {
    storage_read("memo");
    state
}

fn save(state, event) {
    storage_write("memo", #{ "text": state.text });
    state
}

fn stored(state, response) {
    if response.operation == "read" {
        if response.ok && response.data != () {
            state.text = response.data.text;
        }
    } else if response.ok {
        state.status = "保存済み";
        emit("saved", #{ "text": state.text });
    }
    state
}
