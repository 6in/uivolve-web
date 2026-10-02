fn init(state) { state }
fn showDialog(state, event) { state.dialogOpen = true; state.notice = "ダイアログを開きました。"; state }
fn showToast(state, event) { state.toastOpen = true; state.notice = "通知を表示しました。"; state }
fn save(state, event) { state.notice = "保存操作をWASMで処理しました。"; state.logLines.push("✓ 保存操作"); state }
fn calendarChanged(state, event) {
    state.notice = if event.action == "select" { "日付を選択: " + state.selectedDate } else { "表示月: " + state.calendarMonth };
    state
}
fn pageChanged(state, event) { state.notice = "ページ " + (state.page + 1).to_string() + " を表示中"; state }
fn dialogAnswered(state, event) {
    if event.action == "answer" && event.id == "OK" {
        let name = state.promptText;
        name.trim();
        if name == "" { throw "保存名を入力してください。"; }
        state.notice = "「" + state.promptText + "」として保存しました。";
        state.logLines.push("✓ 名前を付けて保存: " + state.promptText);
    } else { state.notice = "保存を取り消しました。"; }
    state
}
fn sendMessage(state, event) {
    let text = state.chatDraft;
    text.trim();
    if text == "" { throw "メッセージを入力してください。"; }
    if state.chatMessages.len() >= 6 { state.chatMessages = []; }
    state.chatMessages.push(#{from: "user", name: "あなた", text: text});
    state.chatMessages.push(#{from: "bot", name: "UIエンジン", text: "受け取りました: " + text});
    if state.logLines.len() >= 8 { state.logLines = []; }
    state.logLines.push("✓ メッセージ送信: " + text);
    state.chatDraft = "";
    state.notice = "Rhaiでメッセージを処理しました。";
    state
}
fn clearChat(state, event) { state.chatMessages = []; state }
fn clearLog(state, event) { state.logLines = []; state }
