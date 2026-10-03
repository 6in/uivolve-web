fn init(state) {
    state
}

fn runRegex(state, event) {
    try {
        // These functions execute native Rust code in the engine's WASM instance.
        let matched = regex_is_match(state.pattern, state.text);
        let found = regex_find_all(state.pattern, state.text);
        let captures = regex_captures(state.pattern, state.text);
        let replaced = regex_replace_all(state.pattern, state.text, state.replacement);
        let rows = [];
        for i in 0..found.len() {
            rows.push(#{id: i + 1, text: found[i]});
        }
        let captureText = "";
        for i in 0..captures.len() {
            if i > 0 { captureText += "\n"; }
            captureText += i.to_string() + ": ";
            if captures[i] == () {
                captureText += "（未一致）";
            } else {
                captureText += captures[i];
            }
        }
        // Commit display results only after all native calls have succeeded.
        state.matched = if matched { "一致あり" } else { "一致なし" };
        state.matches = rows;
        state.captures = captureText;
        state.replaced = replaced;
        state.notice = found.len().to_string() + "件を抽出しました。";
    } catch (error) {
        state.notice = "実行できませんでした: " + error.to_string();
    }
    state
}

fn runSum(state, event) {
    try {
        state.total = sum_ints([state.a, state.b, state.c]);
        state.sumNotice = "WASM内のRust関数で集計しました。";
    } catch (error) {
        state.sumNotice = "集計できませんでした: " + error.to_string();
    }
    state
}
