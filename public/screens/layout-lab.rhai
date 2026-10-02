fn refresh(state) {
    let titles = ["名前を入力", "メモを入力", "入力内容を確認"];
    state.stepLabel = (state.cardStep + 1).to_string() + " / 3 — " + titles[state.cardStep];
    state.backDisabled = state.cardStep == 0;
    state.nextDisabled = state.cardStep == 2;
    state
}
fn init(state) { refresh(state) }
fn nextCard(state, event) { if state.cardStep < 2 { state.cardStep += 1; } refresh(state) }
fn previousCard(state, event) { if state.cardStep > 0 { state.cardStep -= 1; } refresh(state) }
fn cardChanged(state, event) { refresh(state) }
fn workspaceReset(state, event) { state.workspaceMemo = "中央のパネルは残りの領域に広がります。"; state }
