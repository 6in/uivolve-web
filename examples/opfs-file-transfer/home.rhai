fn init(s) { s }
fn start(s, e) {
    s.busy = true; s.stage = "download"; s.notice = "CSV受信中…";
    host_call("csv", #{file: #{volume: "workspace", path: "source.csv"}}); s
}
fn downloaded(s, r) {
    if !r.ok { s.busy = false; s.stage = "idle"; s.notice = r.error.code + ": " + r.error.message; return s; }
    s.stage = "read"; s.notice = "小さなCSVを加工中…";
    file_read_text("workspace", "source.csv"); s
}
fn fileDone(s, r) {
    if !r.ok { s.busy = false; s.stage = "idle"; s.notice = "失敗: " + r.error; return s; }
    if s.stage == "read" && r.operation == "read_text" {
        s.stage = "write";
        let csv = r.data;
        csv.replace("apple,2", "apple,4");
        file_write_text("workspace", "processed.csv", csv);
    } else if s.stage == "write" && r.operation == "write_text" {
        s.stage = "send"; s.notice = "複数ファイル送信中…";
        host_call("multipart", #{parts: [
            #{name: "tag", value: "original"},
            #{name: "file", file: #{volume: "workspace", path: "source.csv"}, contentType: "text/csv"},
            #{name: "tag", value: "processed"},
            #{name: "file", file: #{volume: "workspace", path: "processed.csv"}, filename: "加工.csv", contentType: "text/csv"}
        ]});
    }
    s
}
fn slow(s, e) {
    s.busy = true; s.notice = "低速受信中…";
    host_call("slow", #{query: #{size: "1048576", chunkDelay: "150"}, file: #{volume: "workspace", path: "slow.bin"}}); s
}
fn upload(s, e) {
    s.busy = true; s.notice = "100 MiB送信中…";
    host_call("upload", #{file: #{volume: "workspace", path: "large.bin"}}); s
}
fn failure(s, e) {
    s.busy = true; s.notice = "失敗応答を確認中…";
    host_call("failure", #{file: #{volume: "workspace", path: "failure.bin"}}); s
}
fn cancel(s, e) {
    host_cancel("csv"); host_cancel("slow"); host_cancel("upload"); host_cancel("multipart"); host_cancel("failure");
    if s.busy { s.notice = "中止処理中…"; }
    s
}
fn received(s, p) {
    s.progress = p.transferred.to_string() + " bytes";
    if p.total != () { s.progress += " / " + p.total.to_string(); }
    s
}
fn transferDone(s, r) {
    s.busy = false; s.stage = "idle";
    if r.ok {
        s.notice = "完了: HTTP " + r.data.status.to_string();
        if r.data.body != () { s.notice += " / " + r.data.body.to_string(); }
    } else { s.notice = r.error.code + ": " + r.error.message; }
    s
}
