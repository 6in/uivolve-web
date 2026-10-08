// 部品として親画面に埋め込む受注一覧。親からは state.config の status / query だけを受け取る。
// 全ハンドラは state と event を受け取り、新しい state を返す。
fn refresh(state) {
    let status = state.config.status;
    let query = state.config.query;
    let visible = [];
    for order in state.orders {
        if status != "" && order.status != status { continue; }
        if query != "" && !order.customer.contains(query) && !order.number.contains(query) { continue; }
        order.amountLabel = "¥" + order.amount.to_string();
        visible.push(order);
    }
    state.visible = visible;
    state.count = visible.len().to_string() + " 件";
    state
}

fn init(state) { refresh(state) }

fn config(state, event) { refresh(state) }

fn select(state, event) {
    state.selected = event.id;
    for order in state.orders {
        if order.id == event.id {
            emit("selected", #{ "id": order.id, "number": order.number, "customer": order.customer });
            break;
        }
    }
    state
}
