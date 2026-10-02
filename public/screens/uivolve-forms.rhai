fn init(state) { state }

fn volumeChanged(state, event) {
    state.progress = event.value / 100.0;
    state.volumeText = "音量 " + event.value.to_int().to_string();
    state
}

fn saveForm(state, event) {
    let name = state.name;
    name.trim();
    if name == "" || state.quantity == () || state.due == "" {
        state.notice = "名前・数量・予定日を入力してください。";
        return state;
    }
    state.summary = name + " / " + state.quantity.to_string() + " 個 / " + state.due;
    state.notice = "入力内容を保存しました。";
    state
}
