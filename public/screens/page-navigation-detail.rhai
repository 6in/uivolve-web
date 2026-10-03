fn init(state) { state }

fn showMemo(state, event) {
    if state.memo == "" {
        state.notice = "画面BのRhaiが実行されました。";
    } else {
        state.notice = "画面Bのメモ: " + state.memo;
    }
    state
}

fn returnHome(state, event) {
    navigate("home");
    state
}
