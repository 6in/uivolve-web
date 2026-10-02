fn init(state) {
    for i in 1..501 {
        state.records.push(#{id: i, customer: "顧客 " + i.to_string(), quantity: (i * 7) % 100, status: if i % 3 == 0 { "出荷済" } else { "受注" }, memo: "デモの一覧データ"});
    }
    state
}

fn gridChanged(state, event) {
    state.selectionCount = state.selectedIds.len().to_string() + " 件";
    if event.action == "commitEdit" {
        if event.column == "quantity" && event.value > 500 {
            throw "デモの数量は500以下で入力してください。";
        }
        state.edited += 1;
        state.editedCount = state.edited.to_string() + " 件";
        state.notice = event.id.to_string() + " 行の「" + event.column + "」を保存しました。";
    }
    state
}

fn clearFilter(state, event) { state.query = ""; state.notice = "検索を解除しました。"; state }
fn clearSelection(state, event) { state.selectedIds = []; state.selectionCount = "0 件"; state.notice = "選択を解除しました。"; state }
fn categoryChanged(state, event) {
    if event.action != "select" { return state; }
    if event.id == "all" || event.id == "received" || event.id == "shipped" {
        state.query = if event.id == "received" { "受注" } else if event.id == "shipped" { "出荷済" } else { "" };
        state.activeView = 0;
        state.notice = "ツリーで選んだ出荷状況を一覧へ反映しました。";
    }
    state
}
