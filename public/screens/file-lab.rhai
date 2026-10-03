fn init(s) {s}
fn busy(s) {s.loading=true; s.notice="処理しています…"; s}
fn mkdir(s,e) {file_mkdir("workspace","drafts"); busy(s)}
fn save(s,e) {file_write_text("workspace","drafts/page.yaml",s.source); busy(s)}
fn read(s,e) {file_read_text("workspace","drafts/page.yaml"); busy(s)}
fn list(s,e) {file_list("workspace","drafts"); busy(s)}
fn stat(s,e) {file_stat("workspace","drafts/page.yaml"); busy(s)}
fn remove(s,e) {file_remove("workspace","drafts/page.yaml"); busy(s)}
fn binarySave(s,e) {
    let bytes = blob(4, 0);
    bytes[0]=0; bytes[1]=127; bytes[2]=128; bytes[3]=255;
    file_write_bytes("workspace","drafts/data.bin",bytes);
    busy(s)
}
fn binaryRead(s,e) {file_read_bytes("workspace","drafts/data.bin"); busy(s)}
fn fileDone(s,r) {
    s.loading=false;
    if !r.ok {s.notice="失敗: " + r.error; return s;}
    s.notice=r.operation + ": " + r.path;
    if r.operation=="read_text" {s.content=r.data;}
    else if r.operation=="read_bytes" {
        let bytes=r.data;
        s.content="バイナリ: " + bytes.len() + " bytes";
        if bytes.len()==4 {s.content += " / " + bytes[0] + ", " + bytes[1] + ", " + bytes[2] + ", " + bytes[3];}
    } else if r.operation=="list" {
        s.content="ファイル一覧:";
        for entry in r.data {s.content += " " + entry.name + " (" + entry.kind + ")";}
    } else if r.operation=="stat" {
        if r.data.exists {s.content=r.data.kind + " / " + r.data.size + " bytes";}
        else {s.content="ファイルはありません。";}
    }
    s
}
