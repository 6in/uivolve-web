use super::{display, fields, flag, lookup, widget, Node, Widget};
use serde_json::{json, Value};
use std::{cmp::Ordering, collections::HashSet};

pub fn advanced(n: &Node) -> bool {
    n.xtype == "grid"
        && (n.page_size > 0
            || !n.sort_bind.is_empty()
            || !n.filter_bind.is_empty()
            || !n.page_bind.is_empty()
            || !n.editing_bind.is_empty()
            || n.multi_select == Some(true)
            || n.columns
                .iter()
                .any(|c| c.editor.is_some() || c.hidden || !c.sortable || !c.align.is_empty()))
}

pub fn normalize(n: &mut Node, path: &str) {
    if !advanced(n) {
        return;
    }
    if n.item_id.is_empty() {
        n.item_id = format!("grid-{}", path.replace('.', "-"));
    }
    let prefix = format!("ui_{}", n.item_id.replace('-', "_"));
    for (binding, suffix) in [
        (&mut n.bind, "rows"),
        (&mut n.sort_bind, "sort"),
        (&mut n.page_bind, "page"),
        (&mut n.selected_bind, "selected"),
        (&mut n.editing_bind, "editing"),
    ] {
        if binding.is_empty() {
            *binding = format!("{prefix}_{suffix}");
        }
    }
    if n.page_size == 0 {
        n.page_size = 10;
    }
}

pub fn validate(n: &Node) -> Result<(), String> {
    if !advanced(n) {
        return Ok(());
    }
    if n.page_size > 50 {
        return Err("Grid pageSize must be between 1 and 50".into());
    }
    if n.columns.len() > 12 || n.columns.iter().all(|c| c.hidden) {
        return Err("Grid needs 1..12 columns and at least one visible column".into());
    }
    let mut ids = HashSet::new();
    for c in &n.columns {
        if c.data_index.is_empty() || !ids.insert(&c.data_index) {
            return Err("Grid dataIndex values must be nonempty and unique".into());
        }
        if !["", "left", "center", "right"].contains(&c.align.as_str()) {
            return Err("Grid align must be left, center or right".into());
        }
        if let Some(editor) = &c.editor {
            if ![
                "textfield",
                "numberfield",
                "datefield",
                "combobox",
                "checkbox",
            ]
            .contains(&editor.xtype.as_str())
                || c.data_index.contains('.')
                || !editor.items.is_empty()
                || !editor.items_bind.is_empty()
                || !editor.handler.is_empty()
            {
                return Err("Grid editor needs a supported input xtype, top-level dataIndex, and no items/handler".into());
            }
            fields::validate(editor)?;
        }
    }
    let bindings = [
        &n.bind,
        &n.sort_bind,
        &n.page_bind,
        &n.selected_bind,
        &n.editing_bind,
    ];
    if bindings.iter().any(|b| b.is_empty() || b.contains('.'))
        || bindings.iter().collect::<HashSet<_>>().len() != bindings.len()
        || (!n.filter_bind.is_empty()
            && (n.filter_bind.contains('.') || bindings.contains(&&n.filter_bind)))
    {
        return Err("Grid bindings must be distinct top-level state keys".into());
    }
    if !n.store.is_null()
        && !n.store.is_array()
        && !n.store.get("data").is_some_and(Value::is_array)
    {
        return Err("Grid store must be an array or {data: [...]}".into());
    }
    Ok(())
}

pub fn initialize(n: &Node, state: &mut Value) {
    if advanced(n) {
        let map = state.as_object_mut().unwrap();
        let rows = if n.store.is_array() {
            n.store.clone()
        } else if let Some(rows) = n.store.get("data") {
            rows.clone()
        } else {
            json!(n.data)
        };
        map.entry(n.bind.clone()).or_insert(rows);
        map.entry(n.sort_bind.clone()).or_insert(Value::Null);
        map.entry(n.page_bind.clone()).or_insert(json!(0));
        map.entry(n.selected_bind.clone())
            .or_insert(if n.multi_select == Some(true) {
                json!([])
            } else {
                Value::Null
            });
        map.entry(n.editing_bind.clone()).or_insert(Value::Null);
    }
    for child in &n.items {
        initialize(child, state);
    }
}

fn rows<'a>(n: &Node, state: &'a Value) -> &'a [Value] {
    lookup(state, &n.bind)
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
fn id(row: &Value) -> &Value {
    row.get("id").unwrap_or(&Value::Null)
}
fn id_key(row: &Value) -> String {
    id(row).to_string()
}

pub fn validate_state(n: &Node, state: &Value) -> Result<(), String> {
    if advanced(n) {
        let rows = lookup(state, &n.bind)
            .as_array()
            .ok_or("Grid data binding must contain an array")?;
        if rows.len() > 2000 {
            return Err("Grid supports at most 2000 local rows".into());
        }
        let mut ids = HashSet::new();
        for row in rows {
            if !row.is_object()
                || !(id(row).is_string() || id(row).is_number())
                || id_key(row).len() > 200
                || !ids.insert(id_key(row))
            {
                return Err("Grid rows need unique string/number id values".into());
            }
        }
        if n.multi_select == Some(true) && !lookup(state, &n.selected_bind).is_array() {
            return Err("Multi-select Grid selectedBind must be an array".into());
        }
    }
    for child in &n.items {
        validate_state(child, state)?;
    }
    Ok(())
}

struct View {
    indices: Vec<usize>,
    count: usize,
    page: usize,
    pages: usize,
}
fn compare(a: &Value, b: &Value) -> Ordering {
    if let (Some(a), Some(b)) = (a.as_f64(), b.as_f64()) {
        a.partial_cmp(&b).unwrap_or(Ordering::Equal)
    } else {
        display(a).to_lowercase().cmp(&display(b).to_lowercase())
    }
}
fn view(n: &Node, state: &Value) -> View {
    let rows = rows(n, state);
    let query = display(lookup(state, &n.filter_bind)).trim().to_lowercase();
    let mut indices: Vec<usize> = (0..rows.len())
        .filter(|i| {
            query.is_empty()
                || n.columns.iter().any(|c| {
                    display(lookup(&rows[*i], &c.data_index))
                        .to_lowercase()
                        .contains(&query)
                })
        })
        .collect();
    let sort = lookup(state, &n.sort_bind);
    if let Some(c) = sort.get("column").and_then(Value::as_str).and_then(|name| {
        n.columns
            .iter()
            .find(|c| c.data_index == name && c.sortable)
    }) {
        let desc = sort.get("direction").and_then(Value::as_str) == Some("desc");
        indices.sort_by(|a, b| {
            let result = compare(
                lookup(&rows[*a], &c.data_index),
                lookup(&rows[*b], &c.data_index),
            );
            if desc {
                result.reverse()
            } else {
                result
            }
        });
    }
    let count = indices.len();
    let pages = count.div_ceil(n.page_size).max(1);
    let page = (lookup(state, &n.page_bind).as_u64().unwrap_or(0) as usize).min(pages - 1);
    let indices = indices
        .into_iter()
        .skip(page * n.page_size)
        .take(n.page_size)
        .collect();
    View {
        indices,
        count,
        page,
        pages,
    }
}

fn set(state: &mut Value, binding: &str, value: Value) {
    state.as_object_mut().unwrap().insert(binding.into(), value);
}
fn selected(n: &Node, state: &Value, row: &Value) -> bool {
    let selected = lookup(state, &n.selected_bind);
    if n.multi_select == Some(true) {
        selected.as_array().is_some_and(|a| a.contains(id(row)))
    } else {
        selected == id(row)
    }
}

pub fn event(n: &Node, state: &mut Value, payload: &mut Value) -> Result<(), String> {
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let v = view(n, state);
    match action.as_str() {
        "sort" => {
            let column = payload
                .get("column")
                .and_then(Value::as_str)
                .ok_or("Missing sort column")?;
            if !n
                .columns
                .iter()
                .any(|c| c.data_index == column && c.sortable && !c.hidden)
            {
                return Err("Column is not sortable".into());
            }
            let sort = lookup(state, &n.sort_bind);
            let same = sort.get("column").and_then(Value::as_str) == Some(column);
            let direction = if same && sort.get("direction").and_then(Value::as_str) == Some("asc")
            {
                "desc"
            } else {
                "asc"
            };
            let next = if same && sort.get("direction").and_then(Value::as_str) == Some("desc") {
                Value::Null
            } else {
                json!({"column":column,"direction":direction})
            };
            set(state, &n.sort_bind, next);
            set(state, &n.page_bind, json!(0));
            set(state, &n.editing_bind, Value::Null);
        }
        "page" => {
            let page = payload
                .get("value")
                .and_then(Value::as_u64)
                .ok_or("Page must be a nonnegative integer")? as usize;
            if page >= v.pages {
                return Err("Page is outside the filtered result".into());
            }
            set(state, &n.page_bind, json!(page));
            set(state, &n.editing_bind, Value::Null);
        }
        "select" | "beginEdit" => {
            let row_id = payload.get("id").ok_or("Missing row id")?;
            let index = v
                .indices
                .iter()
                .find(|i| id(&rows(n, state)[**i]) == row_id)
                .copied()
                .ok_or("Row is not on the current page")?;
            if action == "select" {
                if n.multi_select == Some(true) {
                    let old = lookup(state, &n.selected_bind)
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    let additive = payload.get("additive").and_then(Value::as_bool) == Some(true)
                        || payload.get("toggle").and_then(Value::as_bool) == Some(true);
                    let mut next = if additive { old.clone() } else { Vec::new() };
                    if payload.get("range").and_then(Value::as_bool) == Some(true) {
                        let anchor = old.last().and_then(|id_| {
                            v.indices
                                .iter()
                                .position(|i| id(&rows(n, state)[*i]) == id_)
                        });
                        let end = v.indices.iter().position(|i| *i == index).unwrap();
                        let start = anchor.unwrap_or(end);
                        next = v.indices[start.min(end)..=start.max(end)]
                            .iter()
                            .map(|i| id(&rows(n, state)[*i]).clone())
                            .collect();
                    } else if let Some(i) = next.iter().position(|id_| id_ == row_id) {
                        next.remove(i);
                    } else {
                        next.push(row_id.clone());
                    }
                    set(state, &n.selected_bind, json!(next));
                } else {
                    set(state, &n.selected_bind, row_id.clone());
                }
            } else {
                let column = payload
                    .get("column")
                    .and_then(Value::as_str)
                    .ok_or("Missing edit column")?;
                let c = n
                    .columns
                    .iter()
                    .find(|c| c.data_index == column && !c.hidden && c.editor.is_some())
                    .ok_or("Column is not editable")?;
                if n.read_only
                    || c.editor.as_ref().unwrap().read_only
                    || c.editor.as_ref().unwrap().disabled
                {
                    return Err("Cell is read-only".into());
                }
                let value = lookup(&rows(n, state)[index], column).clone();
                set(
                    state,
                    &n.editing_bind,
                    json!({"id":row_id,"column":column,"value":value}),
                );
            }
        }
        "draft" | "commitEdit" | "cancelEdit" => {
            let editing = lookup(state, &n.editing_bind).clone();
            if editing.is_null() {
                return Err("No active cell editor".into());
            }
            let column = editing
                .get("column")
                .and_then(Value::as_str)
                .ok_or("Invalid cell editor")?;
            let c = n
                .columns
                .iter()
                .find(|c| c.data_index == column && !c.hidden)
                .ok_or("Unknown edit column")?;
            let editor = c.editor.as_ref().ok_or("Column is not editable")?;
            let index = rows(n, state)
                .iter()
                .position(|r| id(r) == editing.get("id").unwrap_or(&Value::Null))
                .ok_or("Edited row no longer exists")?;
            if action == "cancelEdit" {
                set(state, &n.editing_bind, Value::Null);
                return Ok(());
            }
            if n.read_only || editor.read_only || editor.disabled {
                return Err("Cell is read-only".into());
            }
            if action == "draft" {
                if payload.get("id") != editing.get("id")
                    || payload.get("column") != editing.get("column")
                {
                    return Err("Stale cell editor".into());
                }
                let value = payload.get("value").cloned().unwrap_or(Value::Null);
                if value.to_string().len() > 10000 {
                    return Err("Cell draft is too long".into());
                }
                set(
                    state,
                    &n.editing_bind,
                    json!({"id":editing["id"],"column":column,"value":value}),
                );
            } else {
                let value = fields::event_value(editor, &editing["value"])?;
                if !editor.allow_blank && (value.is_null() || value.as_str() == Some("")) {
                    return Err("Cell value is required".into());
                }
                let old = lookup(&rows(n, state)[index], column).clone();
                state.get_mut(&n.bind).unwrap().as_array_mut().unwrap()[index]
                    .as_object_mut()
                    .unwrap()
                    .insert(column.into(), value.clone());
                *payload = json!({"action":"commitEdit","id":editing["id"],"column":column,"value":value,"oldValue":old});
                set(state, &n.editing_bind, Value::Null);
            }
        }
        _ => return Err("Unknown Grid action".into()),
    }
    Ok(())
}

pub fn reconcile(n: &Node, before: &Value, after: &mut Value) {
    if advanced(n) {
        if !n.filter_bind.is_empty()
            && lookup(before, &n.filter_bind) != lookup(after, &n.filter_bind)
        {
            set(after, &n.page_bind, json!(0));
            set(after, &n.editing_bind, Value::Null);
        }
        let ids: Vec<Value> = rows(n, after).iter().map(|r| id(r).clone()).collect();
        let current = lookup(after, &n.selected_bind);
        let next = if n.multi_select == Some(true) {
            json!(current
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|i| ids.contains(i))
                .collect::<Vec<_>>())
        } else if ids.contains(current) {
            current.clone()
        } else {
            Value::Null
        };
        set(after, &n.selected_bind, next);
        if !lookup(after, &n.editing_bind).is_null()
            && !ids.contains(&lookup(after, &n.editing_bind)["id"])
        {
            set(after, &n.editing_bind, Value::Null);
        }
    }
    for child in &n.items {
        reconcile(child, before, after);
    }
}

pub fn height(n: &Node, state: &Value) -> f64 {
    40.0 + view(n, state).indices.len().max(1) as f64 * 38.0
        + 40.0
        + if lookup(state, &n.editing_bind).is_null() {
            0.0
        } else {
            40.0
        }
}

pub fn arrange(
    n: &Node,
    state: &Value,
    x: f64,
    y: f64,
    width: f64,
    key: &str,
    out: &mut Vec<Widget>,
) {
    let start = out.len();
    let v = view(n, state);
    let mut shell = widget(n, "grid-shell", x, y, width, height(n, state), key);
    shell.text = if n.title.is_empty() {
        "データ一覧".into()
    } else {
        n.title.clone()
    };
    shell.config = json!({"rowCount":v.count,"columnCount":n.columns.iter().filter(|c| !c.hidden).count(),"multiple":n.multi_select==Some(true)});
    out.push(shell);
    let header_key = format!("{key}:header");
    let mut head = widget(n, "grid-head", x, y, width, 40.0, &header_key);
    head.config = json!({"parentKey":key});
    out.push(head);
    let check_width = if n.multi_select == Some(true) {
        28.0
    } else {
        0.0
    };
    let total: f64 = n.columns.iter().filter(|c| !c.hidden).map(|c| c.flex).sum();
    let sort = lookup(state, &n.sort_bind);
    let mut offset = check_width;
    for c in n.columns.iter().filter(|c| !c.hidden) {
        let cw = (width - check_width) * c.flex / total;
        let direction = if sort.get("column").and_then(Value::as_str) == Some(&c.data_index) {
            sort["direction"].as_str().unwrap_or("")
        } else {
            ""
        };
        let mut w = widget(
            n,
            "grid-column",
            x + offset,
            y,
            cw,
            40.0,
            &format!("{key}:column:{}", c.data_index),
        );
        w.text = format!(
            "{}{}",
            c.text,
            match direction {
                "asc" => " ↑",
                "desc" => " ↓",
                _ => "",
            }
        );
        w.payload = json!({"action":"sort","column":c.data_index});
        w.disabled = !c.sortable;
        w.config = json!({"parentKey":header_key,"direction":direction,"align":c.align});
        out.push(w);
        offset += cw;
    }
    let editing = lookup(state, &n.editing_bind);
    for (ri, index) in v.indices.iter().enumerate() {
        let row = &rows(n, state)[*index];
        let ry = y + 40.0 + ri as f64 * 38.0;
        let row_key = format!("{key}:row:{}", id_key(row));
        let selected = selected(n, state, row);
        let mut rw = widget(n, "grid-row", x, ry, width, 38.0, &row_key);
        rw.selected = selected;
        rw.config = json!({"parentKey":key,"rowIndex":v.page*n.page_size+ri+2});
        out.push(rw);
        if check_width > 0.0 {
            let mut w = widget(
                n,
                "grid-select",
                x,
                ry,
                check_width,
                38.0,
                &format!("{row_key}:check"),
            );
            w.text = if selected { "☑" } else { "☐" }.into();
            w.selected = selected;
            w.payload = json!({"action":"select","id":id(row),"toggle":true});
            w.config = json!({"parentKey":row_key});
            out.push(w);
        }
        let mut offset = check_width;
        for c in n.columns.iter().filter(|c| !c.hidden) {
            let cw = (width - check_width) * c.flex / total;
            let cell_key = format!("{key}:cell:{}:{}", id_key(row), c.data_index);
            let is_editing = editing.get("id") == Some(id(row))
                && editing.get("column").and_then(Value::as_str) == Some(&c.data_index)
                && c.editor.is_some();
            let mut w = widget(n, "grid-cell", x + offset, ry, cw, 38.0, &cell_key);
            w.text = display(lookup(row, &c.data_index));
            w.selected = selected;
            w.payload = json!({"action":"select","id":id(row),"column":c.data_index});
            w.config = json!({"parentKey":row_key,"editable":c.editor.as_ref().is_some_and(|e| !e.read_only && !e.disabled) && !n.read_only,"align":c.align});
            if is_editing {
                let mut editor = *c.editor.as_ref().unwrap().clone();
                editor.bind.clear();
                editor.value = editing["value"].clone();
                editor.field_label = c.text.clone();
                w.kind = editor.xtype.clone();
                fields::configure(&editor, state, &mut w);
                w.config["labelHeight"] = json!(0);
                w.config["parentKey"] = json!(row_key);
                w.config["gridEditor"] = json!(true);
                w.payload["action"] = json!("draft");
            }
            out.push(w);
            offset += cw;
        }
    }
    if v.indices.is_empty() {
        let mut w = widget(
            n,
            "empty",
            x,
            y + 40.0,
            width,
            38.0,
            &format!("{key}:empty"),
        );
        w.text = "一致する項目はありません".into();
        w.config = json!({"parentKey":key});
        out.push(w);
    }
    let fy = y + 40.0 + v.indices.len().max(1) as f64 * 38.0;
    for (suffix, text, bx, page, disabled) in [
        ("prev", "‹ 前", x, v.page.saturating_sub(1), v.page == 0),
        (
            "next",
            "次 ›",
            x + width - 60.0,
            v.page + 1,
            v.page + 1 >= v.pages,
        ),
    ] {
        let mut w = widget(
            n,
            "grid-page",
            bx,
            fy + 4.0,
            60.0,
            30.0,
            &format!("{key}:{suffix}"),
        );
        w.text = text.into();
        w.disabled = disabled;
        w.payload = json!({"action":"page","value":page});
        w.config = json!({"parentKey":key});
        out.push(w);
    }
    let mut info = widget(
        n,
        "label",
        x + 64.0,
        fy + 7.0,
        (width - 128.0).max(1.0),
        24.0,
        &format!("{key}:count"),
    );
    info.text = format!("{} 件 · {} / {}", v.count, v.page + 1, v.pages);
    info.config = json!({"parentKey":key});
    out.push(info);
    if !editing.is_null() {
        for (suffix, text, bx, action) in [
            ("commit", "保存 ↵", x, "commitEdit"),
            ("cancel", "取消 Esc", x + width / 2.0 + 3.0, "cancelEdit"),
        ] {
            let mut w = widget(
                n,
                "grid-page",
                bx,
                fy + 44.0,
                width / 2.0 - 3.0,
                30.0,
                &format!("{key}:{suffix}"),
            );
            w.text = text.into();
            w.payload = json!({"action":action});
            w.config = json!({"parentKey":key});
            out.push(w);
        }
    }
    if n.disabled || flag(state, &n.disabled_bind) {
        for w in &mut out[start..] {
            w.disabled = true;
        }
    }
}
