fn init(s) { s }
fn load(s, e) { s.loading = true; host_call("list", #{}); s }
fn add(s, e) { s.loading = true; host_call("add", #{body: #{name: s.name}}); s }
fn replace(s, e) {
    if s.rows.len() == 0 { s.notice = "先に一覧を取得してください。"; return s; }
    s.loading = true;
    host_call("replace", #{path: #{id: s.rows[0].id}, body: #{name: s.name}});
    s
}
fn patch(s, e) {
    if s.rows.len() == 0 { s.notice = "先に一覧を取得してください。"; return s; }
    s.loading = true;
    host_call("patch", #{path: #{id: s.rows[0].id}, body: #{name: s.name}});
    s
}
fn remove(s, e) {
    if s.rows.len() == 0 { s.notice = "先に一覧を取得してください。"; return s; }
    s.loading = true;
    host_call("remove", #{path: #{id: s.rows[0].id}});
    s
}
fn head(s, e) { s.loading = true; host_call("head", #{}); s }
fn listed(s, r) {
    s.loading = false;
    if r.ok { s.rows = r.data.body; s.notice = s.rows.len().to_string() + "件を取得しました。"; }
    else { s.notice = r.error.message; }
    s
}
fn changed(s, r) {
    if r.ok { host_call("list", #{}); }
    else { s.loading = false; s.notice = r.error.message; }
    s
}
fn checked(s, r) {
    s.loading = false;
    if r.ok { s.notice = "HEAD: " + r.data.headers["X-Item-Count"] + "件"; }
    else { s.notice = r.error.message; }
    s
}
