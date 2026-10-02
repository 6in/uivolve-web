fn init(state) {
    state
}

fn loadProducts(state, event) {
    state.loading = true;
    state.notice = "商品一覧を取得しています…";
    http_get("products");
    state
}

fn productsReceived(state, response) {
    state.loading = false;
    if !response.ok {
        state.notice = "取得できませんでした: " + response.error;
        return state;
    }
    if type_of(response.data) != "array" {
        state.notice = "商品一覧はJSON配列で返してください。";
        return state;
    }
    if response.data.len() > 2000 {
        state.notice = "商品一覧は2,000件以内にしてください。";
        return state;
    }
    let ids = [];
    for product in response.data {
        if type_of(product) != "map" {
            state.notice = "商品データの形式が正しくありません。";
            return state;
        }
        if !product.contains("id") || !product.contains("name") || !product.contains("price") || !product.contains("stock") {
            state.notice = "商品データにはid・name・price・stockが必要です。";
            return state;
        }
        if type_of(product.id) != "i64" || type_of(product.name) != "string" || type_of(product.price) != "i64" || type_of(product.stock) != "i64" {
            state.notice = "商品名は文字列、番号・価格・在庫は整数で返してください。";
            return state;
        }
        if product.price < 0 || product.stock < 0 || ids.contains(product.id) {
            state.notice = "番号の重複、負の価格・在庫は使用できません。";
            return state;
        }
        ids.push(product.id);
    }
    state.products = response.data;
    state.page = 0;
    state.selected = [];
    state.notice = state.products.len().to_string() + "件の商品を取得しました。";
    state
}
