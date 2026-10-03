fn init(state) { state }
fn record(state) {
    if state.backend == "opfs" { "profileFile" } else { "profileDb" }
}
fn saveProfile(state, event) {
    storage_write(record(state), #{name: state.name, age: state.age});
    state.loading = true;
    state.notice = "保存しています…";
    state
}
fn restoreProfile(state, event) {
    storage_read(record(state));
    state.loading = true;
    state.notice = "復元しています…";
    state
}
fn removeProfile(state, event) {
    storage_remove(record(state));
    state.loading = true;
    state.notice = "削除しています…";
    state
}
fn stored(state, response) {
    state.loading = false;
    if !response.ok {
        state.notice = "保存操作に失敗しました: " + response.error;
    } else if response.operation == "read" {
        if response.data == () {
            state.notice = "保存データはまだありません。";
        } else if type_of(response.data) != "map" || !response.data.contains("name") || !response.data.contains("age") {
            state.notice = "保存データの形が不正です。";
        } else if type_of(response.data.name) != "string" || type_of(response.data.age) != "i64" || response.data.name.len() > 40 || response.data.age < 0 || response.data.age > 130 {
            state.notice = "保存データの型・範囲が不正です。";
        } else {
            state.name = response.data.name;
            state.age = response.data.age;
            state.notice = "プロフィールを復元しました。";
        }
    } else if response.operation == "write" {
        state.notice = "プロフィールを保存しました。";
    } else {
        state.notice = "保存データを削除しました。";
    }
    state
}
