// Fixture for the renderer font-size ledger. The two handlers open a dialog whose icon is
// a character rather than one of the built-in SVG icons: a wide string, so the 30px icon
// has to be clipped like the DOM's instead of condensed to the box width, and an emoji.
fn init(state) {
    state
}
fn wideTextIcon(s, e) {
    alert("長い文字アイコンのダイアログ", "iconShown", #{icon: #{text: "重要なお知らせ", alt: "重要"}});
    s
}
fn emojiIcon(s, e) {
    alert("絵文字アイコンのダイアログ", "iconShown", #{icon: #{text: "🚀", alt: "ロケット"}});
    s
}
fn iconShown(s, r) {
    s.notice = if r.ok { "ダイアログを閉じました。" } else { "失敗: " + r.error };
    s
}
