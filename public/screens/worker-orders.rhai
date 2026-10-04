fn list(s) { host_call("listOrders", #{}); s.loading = true; s }
fn init(s) { s.date = date_today(); list(s) }
fn refreshOrders(s, e) { list(s) }
fn failure(s, r) { s.loading = false; s.notice = r.error.code + ": " + r.error.message; s }
fn listed(s, r) {
    if !r.ok { return failure(s, r); }
    let orders = [];
    for order in r.data.body {
        order.totalLabel = num_format(order.total, "¥#,##0");
        orders.push(order);
    }
    s.orders = orders;
    s.selected = "";
    s.loading = false;
    s.notice = orders.len().to_string() + "件。Workerから取得しました。";
    s
}
fn draft(s, order) {
    s.id = order.id; s.customer = order.customer; s.date = order.date;
    s.price = order.price; s.quantity = order.quantity; s
}
fn selectOrder(s, e) {
    for order in s.orders { if order.id == e.id { return draft(s, order); } }
    s
}
fn getOrder(s, e) {
    if s.id == "" { s.notice = "IDを入力してください。"; return s; }
    host_call("getOrder", #{path: #{id: s.id}}); s.loading = true; s
}
fn fetched(s, r) {
    if !r.ok { return failure(s, r); }
    s = draft(s, r.data.body); s.loading = false; s.notice = "取得しました。"; s
}
fn save(s, operation) {
    try {
        let customer = text_trim(text_normalize(s.customer, "NFKC"));
        if customer == "" { throw "顧客名を入力してください。"; }
        if !date_is_valid(s.date) { throw "受注日が不正です。"; }
        if dec_cmp(s.price, "0") < 0 || dec_cmp(s.quantity, "0") <= 0 { throw "単価は0以上、数量は0より大きくしてください。"; }
        if operation == "updateOrder" && s.id == "" { throw "更新するIDを入力してください。"; }
        let subtotal = dec_mul(s.price, s.quantity);
        let total = dec_add(subtotal, dec_round(dec_mul(subtotal, "0.1"), 0, "half_up"));
        let body = #{customer: customer, date: s.date, due: date_add_days(s.date, 14), price: s.price, quantity: s.quantity, total: total};
        host_call(operation, #{path: #{id: s.id}, body: body});
        s.loading = true;
    } catch (error) { s.notice = "入力を確認してください: " + error.to_string(); }
    s
}
fn createOrder(s, e) { save(s, "createOrder") }
fn updateOrder(s, e) { save(s, "updateOrder") }
fn deleteOrder(s, e) {
    if s.id == "" { s.notice = "削除するIDを入力してください。"; return s; }
    host_call("deleteOrder", #{path: #{id: s.id}}); s.loading = true; s
}
fn resetOrders(s, e) { host_call("resetOrders", #{}); s.loading = true; s.id = ""; s }
fn changed(s, r) {
    if !r.ok { return failure(s, r); }
    if type_of(r.data.body) == "map" && "id" in r.data.body { s.id = r.data.body.id; }
    list(s)
}
