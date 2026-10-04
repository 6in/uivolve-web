fn calculations(s) {
    let normalized = text_trim(text_normalize(s.original));
    let count = text_len(normalized);
    let short = text_truncate(normalized, s.maxLength, "…");
    let code = text_pad_start(text_trim(s.code), 6, "0");
    s.normalized = normalized;
    s.graphemeCount = count;
    s.shortLabel = short;
    s.paddedCode = code;
    s.notice = "原文を変更せず、検索用の値と表示用の値を作成しました。";
    s
}
fn init(s) { calculations(s) }
fn process(s, e) {
    try { s = calculations(s); }
    catch (error) { s.notice = "処理できませんでした: " + error.to_string(); }
    s
}
