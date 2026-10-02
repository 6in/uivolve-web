fn refresh(state) {
    let visible = [];
    let done = 0;
    for task in state.tasks {
        if task.status == "完了" { done += 1; }
        if state.query == "" || task.name.contains(state.query) { visible.push(task); }
    }
    state.visible = visible;
    state.count = state.tasks.len().to_string() + " 件";
    state.done = done.to_string() + " 件";
    state.pending = (state.tasks.len() - done).to_string() + " 件";
    state
}
fn init(state) { refresh(state) }
fn search(state, event) { refresh(state) }
fn select(state, event) { state.selected = event.id; state }
fn add(state, event) {
    let name = state.newTask;
    name.trim();
    if name == "" { state.notice = "タスク名を入力してください。"; return state; }
    let id = 1;
    for task in state.tasks { if task.id >= id { id = task.id + 1; } }
    state.tasks.push(#{ id: id, name: state.newTask, status: "未完了" });
    state.selected = id;
    state.newTask = "";
    state.notice = "新しいタスクを追加しました。";
    refresh(state)
}
fn toggle(state, event) {
    let tasks = [];
    for task in state.tasks {
        if task.id == state.selected {
            task.status = if task.status == "完了" { "未完了" } else { "完了" };
        }
        tasks.push(task);
    }
    state.tasks = tasks;
    state.notice = "完了状態を切り替えました。";
    refresh(state)
}
