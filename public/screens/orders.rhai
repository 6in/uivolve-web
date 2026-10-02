// HTTPで取得するスクリプト。WASM内でASTへコンパイルし、イベントごとに呼び出す。
// 全ハンドラは state と event を受け取り、新しい state を返す。
fn refresh(state) {
    let visible = [];
    let total = 0;
    let pending = 0;
    for order in state.orders {
        total += order.amount;
        if order.status == "受注" { pending += 1; }
        if state.query == "" || order.customer.contains(state.query) || order.number.contains(state.query) {
            order.amountLabel = "¥" + order.amount.to_string();
            visible.push(order);
        }
    }
    state.visible = visible;
    state.count = state.orders.len().to_string() + " 件";
    state.total = "¥" + total.to_string();
    state.pending = pending.to_string() + " 件";
    state
}

fn reset(state, event) {
    for order in state.orders {
        if order.id == state.selected {
            state.draftCustomer = order.customer;
            state.draftAmount = order.amount.to_string();
        }
    }
    state.notice = "一覧から受注を選んで編集できます。";
    state
}

fn init(state) { refresh(reset(state, #{})) }
fn search(state, event) { refresh(state) }
fn select(state, event) {
    state.selected = event.id;
    reset(state, event)
}

fn save(state, event) {
    let customer = state.draftCustomer;
    customer.trim();
    if customer == "" {
        state.notice = "顧客名を入力してください。";
        return state;
    }
    let amount = 0;
    try {
        amount = parse_int(state.draftAmount);
    } catch (err) {
        state.notice = "金額は整数で入力してください。";
        return state;
    }
    if amount < 0 {
        state.notice = "金額は0以上で入力してください。";
        return state;
    }
    let orders = [];
    for order in state.orders {
        if order.id == state.selected {
            order.customer = state.draftCustomer;
            order.amount = amount;
        }
        orders.push(order);
    }
    state.orders = orders;
    state.notice = "変更を反映しました。このデモ内の状態に保存されています。";
    refresh(state)
}
