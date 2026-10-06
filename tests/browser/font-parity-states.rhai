// Fixture for the renderer font-size ledger. The roles suite reaches most states through
// the application screens; this screen carries the ones none of them render together: a
// fieldset that is not collapsible (so the box paints its own title), a toolbar built from
// string items (which normalize turns into tbtext / tbseparator / tbspacer / tbfill), a
// card layout, a paging toolbar, three calendars (a normal month and both ends of the
// supported range) and a messagebox whose answer buttons are dialogbuttons.
fn init(state) {
    state
}
fn openAnswer(s, e) {
    s.answerOpen = true;
    s
}
fn answered(s, e) {
    s.answerOpen = false;
    s.notice = "応答: " + e.id;
    s
}
