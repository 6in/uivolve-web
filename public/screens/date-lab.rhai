fn calculations(s) {
    s.due = date_add_days(s.base, s.addDays);
    s.dueLabel = date_format(s.due, "YYYY年M月D日(ddd)");
    s.nextMonth = date_add_months(s.base, 1);
    s.monthEnd = date_end_of_month(s.base);
    s.notice = "基準日から " + date_diff_days(s.base, s.due).to_string() + "日後です。";
    s
}
fn init(s) {
    s.today = date_today();
    s.now = datetime_now();
    s.base = s.today;
    calculations(s)
}
fn refresh(s, e) { s.today = date_today(); s.now = datetime_now(); s }
fn calculate(s, e) {
    try { s = calculations(s); }
    catch (error) { s.notice = "計算できませんでした: " + error.to_string(); }
    s
}
