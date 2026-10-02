fn createTab(state) {
    if state.tabs.len() >= 8 {
        state.notice = "タブは最大8個です。";
        return state;
    }

    let id = state.nextTabId;
    let key = "tab" + id.to_string();
    state.nextTabId += 1;

    state["product_" + key] = "";
    state["quantity_" + key] = 1;
    state["result_" + key] = "このタブの内容を入力して「内容を確認」を押してください。";

    state.tabs.push(#{
        xtype: "container",
        itemId: key,
        title: "タブ" + id.to_string(),
        items: [
            #{
                xtype: "textfield",
                itemId: "product-" + key,
                fieldLabel: "商品名",
                bind: "product_" + key,
                emptyText: "例：りんご"
            },
            #{
                xtype: "numberfield",
                itemId: "quantity-" + key,
                fieldLabel: "数量",
                bind: "quantity_" + key,
                minValue: 1,
                maxValue: 9999
            },
            #{
                xtype: "button",
                itemId: "save-" + key,
                text: "内容を確認",
                handler: "confirmTab",
                variant: "primary"
            },
            #{
                xtype: "label",
                itemId: "result-" + key,
                bind: "result_" + key
            }
        ]
    });

    state.activeTab = state.tabs.len() - 1;
    state.tabLimit = state.tabs.len() >= 8;
    if state.tabLimit {
        state.notice = "タブを8個追加しました。各タブの入力値は個別に保持されます。";
    }
    state
}

fn init(state) {
    createTab(state)
}

fn addTab(state, event) {
    createTab(state)
}

fn confirmTab(state, event) {
    for tab in state.tabs {
        let key = tab.itemId;
        if event.target == "save-" + key {
            let product = state["product_" + key];
            product.trim();
            let quantity = state["quantity_" + key];
            if product == "" || quantity == () {
                state["result_" + key] = "商品名と数量を入力してください。";
            } else {
                state["result_" + key] = product + " × " + quantity.to_string();
            }
        }
    }
    state
}
