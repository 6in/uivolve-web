fn calculations(s) {
    let subtotal = dec_mul(s.price, s.quantity);
    let tax = dec_round(dec_mul(subtotal, s.rate), 0, "half_up");
    let total = dec_add(subtotal, tax);
    let label = num_format(total, "¥#,##0");
    s.subtotal = subtotal;
    s.tax = tax;
    s.total = total;
    s.totalLabel = label;
    s.notice = "税率 " + num_format(s.rate, "0.0%") + "。計算結果は10進文字列です。";
    s
}
fn init(s) { calculations(s) }
fn calculate(s, e) {
    try { s = calculations(s); }
    catch (error) { s.notice = "計算できませんでした: " + error.to_string(); }
    s
}
