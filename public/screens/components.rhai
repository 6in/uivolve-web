fn init(state) { state }

fn panelChanged(state, event) {
    state.notice = if state.profileCollapsed { "プロフィールを折りたたみました。" } else { "プロフィールを展開しました。" };
    state
}

fn openEditor(state, event) {
    state.draftName = state.savedName;
    state.draftRole = state.savedRole;
    state.editorOpen = true;
    state.confirmOpen = false;
    state.notice = "ウィンドウ内で名前と担当を編集できます。";
    state
}

fn editorClosed(state, event) {
    state.confirmOpen = false;
    state.notice = "編集をキャンセルしました。";
    state
}

fn cancelEditor(state, event) {
    state.editorOpen = false;
    editorClosed(state, event)
}

fn review(state, event) {
    let name = state.draftName;
    name.trim();
    if name == "" {
        state.notice = "名前を入力してください。";
        return state;
    }
    state.confirmText = name + " さんの変更を保存します。";
    state.confirmOpen = true;
    state
}

fn back(state, event) {
    state.confirmOpen = false;
    state
}

fn commit(state, event) {
    let name = state.draftName;
    name.trim();
    state.savedName = name;
    state.savedRole = state.draftRole;
    state.confirmOpen = false;
    state.editorOpen = false;
    state.notice = "プロフィールを保存しました。";
    state
}
