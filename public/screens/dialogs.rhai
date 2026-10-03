fn init(s) { s }
fn waiting(s) { s.loading = true; s.notice = "回答を待っています…"; s }
fn dialogOptions(s) {
    if s.dialogIcon == "default" { return #{}; }
    if s.dialogIcon == "custom-image" {
        return #{icon: #{src: "../assets/dialog-orbit.svg", alt: "アプリのアイコン"}};
    }
    if s.dialogIcon == "custom-text" { return #{icon: #{text: "🚀", alt: "ロケット"}}; }
    #{icon: s.dialogIcon}
}
fn showAlert(s, e) {
    alert("Hello " + s.name, "dialogDone", dialogOptions(s));
    waiting(s)
}
fn showConfirm(s, e) {
    confirm(s.name + " さん、この内容でよいですか？", "dialogDone", dialogOptions(s));
    waiting(s)
}
fn showPrompt(s, e) {
    prompt("名前を入力してください。", s.name, "dialogDone", dialogOptions(s));
    waiting(s)
}
fn dialogDone(s, r) {
    s.loading = false;
    if !r.ok { s.notice = "失敗: " + r.error; return s; }
    if r.operation == "alert" { s.notice = "alertを閉じました。"; }
    else if r.operation == "confirm" {
        if r.data { s.notice = "confirm: OK"; }
        else { s.notice = "confirm: キャンセル"; }
    } else if r.cancelled { s.notice = "prompt: キャンセル（名前を保持）"; }
    else { s.name = r.data; s.notice = "prompt: 「" + r.data + "」"; }
    s
}
