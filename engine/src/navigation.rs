use super::{arrange as arrange_node, flag, lookup, measure, widget, Node, Widget};
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn component(n: &Node) -> bool {
    ["tabpanel", "treepanel", "menu", "menuseparator"].contains(&n.xtype.as_str())
}
pub fn normalize(n: &mut Node, path: &str) {
    if !component(n) {
        return;
    }
    if n.item_id.is_empty() {
        n.item_id = format!("nav-{}", path.replace('.', "-"));
    }
    let prefix = format!("ui_{}", n.item_id.replace('-', "_"));
    if n.xtype == "tabpanel" && n.active_bind.is_empty() {
        n.active_bind = format!("{prefix}_active");
    }
    if n.xtype == "treepanel" {
        if n.expanded_bind.is_empty() {
            n.expanded_bind = format!("{prefix}_expanded");
        }
        if n.selected_bind.is_empty() {
            n.selected_bind = format!("{prefix}_selected");
        }
    }
    if n.xtype == "menu" {
        if n.open_bind.is_empty() {
            n.open_bind = format!("{prefix}_open");
        }
        for (i, child) in n.items.iter_mut().enumerate() {
            if child.xtype.is_empty() {
                child.xtype = if child.text == "-" {
                    "menuseparator"
                } else {
                    "button"
                }
                .into();
            }
            if child.item_id.is_empty() {
                child.item_id = format!("{}-item-{i}", n.item_id);
            }
        }
    }
}

pub fn active(n: &Node, state: &Value) -> usize {
    let requested = lookup(state, &n.active_bind)
        .as_u64()
        .unwrap_or(n.active_tab as u64) as usize;
    let enabled = |i: usize| {
        n.items
            .get(i)
            .is_some_and(|c| !c.disabled && !flag(state, &c.disabled_bind))
    };
    if enabled(requested) {
        requested
    } else {
        (0..n.items.len())
            .find(|i| enabled(*i))
            .unwrap_or(usize::MAX)
    }
}

fn roots(n: &Node, state: &Value) -> Vec<Value> {
    if !n.bind.is_empty() {
        return lookup(state, &n.bind)
            .as_array()
            .cloned()
            .unwrap_or_default();
    }
    if n.root_visible && n.root.is_object() {
        vec![n.root.clone()]
    } else {
        n.root
            .get("children")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or(n.children.clone())
    }
}
struct Row {
    data: Value,
    id: Value,
    depth: usize,
    branch: bool,
    expanded: bool,
}
fn collect(
    data: &[Value],
    depth: usize,
    prefix: &str,
    expanded: &[Value],
    visible_only: bool,
    out: &mut Vec<Row>,
) {
    for (i, d) in data.iter().enumerate() {
        let path = format!("{prefix}{i}");
        let id = d.get("id").cloned().unwrap_or(json!(format!("@{path}")));
        let children = d
            .get("children")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let branch = d.get("leaf").and_then(Value::as_bool) != Some(true) && !children.is_empty();
        let open = expanded.contains(&id);
        out.push(Row {
            data: d.clone(),
            id,
            depth,
            branch,
            expanded: open,
        });
        if branch && (!visible_only || open) && depth < 20 && out.len() < 500 {
            collect(
                children,
                depth + 1,
                &format!("{path}/"),
                expanded,
                visible_only,
                out,
            );
        }
    }
}
fn tree_rows(n: &Node, state: &Value, visible: bool) -> Vec<Row> {
    let expanded = lookup(state, &n.expanded_bind)
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut rows = Vec::new();
    collect(&roots(n, state), 0, "", &expanded, visible, &mut rows);
    rows
}
fn validate_tree(
    data: &[Value],
    depth: usize,
    count: &mut usize,
    ids: &mut HashSet<String>,
    prefix: &str,
) -> Result<(), String> {
    for (i, d) in data.iter().enumerate() {
        *count += 1;
        if *count > 500 || depth > 20 {
            return Err("Tree supports at most 500 nodes and 20 levels".into());
        }
        if !d.is_object() {
            return Err("Tree nodes must be objects".into());
        }
        let path = format!("{prefix}{i}");
        let id = d.get("id").cloned().unwrap_or(json!(format!("@{path}")));
        if !(id.is_string() || id.is_number()) || !ids.insert(id.to_string()) {
            return Err("Tree node ids must be unique strings or numbers".into());
        }
        if let Some(children) = d.get("children") {
            validate_tree(
                children
                    .as_array()
                    .ok_or("Tree children must be an array")?,
                depth + 1,
                count,
                ids,
                &format!("{path}/"),
            )?;
        }
    }
    Ok(())
}
pub fn validate(n: &Node) -> Result<(), String> {
    if !component(n) {
        return Ok(());
    }
    for binding in [
        &n.active_bind,
        &n.expanded_bind,
        &n.selected_bind,
        &n.open_bind,
    ] {
        if binding.contains('.') {
            return Err("Navigation state bindings must be top-level keys".into());
        }
    }
    if n.xtype == "tabpanel" {
        let invalid_static =
            n.items_bind.is_empty() && (n.items.is_empty() || n.active_tab >= n.items.len());
        if invalid_static || n.items.len() > 8 {
            return Err(
                "tabpanel needs 1..8 items (0..8 with itemsBind) and a valid activeTab index"
                    .into(),
            );
        }
    }
    if n.xtype == "menu"
        && (n.items.is_empty()
            || n.items.len() > 12
            || n.items
                .iter()
                .any(|i| !["button", "menuseparator"].contains(&i.xtype.as_str())))
    {
        return Err("menu needs 1..12 button/separator items".into());
    }
    if n.xtype == "treepanel" {
        if !n.columns.is_empty() {
            return Err("Tree columns are not supported yet".into());
        }
        if !n.root.is_null() && !n.root.is_object() {
            return Err("Tree root must be an object".into());
        }
        if n.bind.is_empty() {
            validate_tree(&roots(n, &json!({})), 0, &mut 0, &mut HashSet::new(), "")?;
        }
    }
    Ok(())
}
pub fn validate_state(n: &Node, state: &Value) -> Result<(), String> {
    if n.xtype == "treepanel" {
        if !n.bind.is_empty() && !lookup(state, &n.bind).is_array() {
            return Err("Tree bind must refer to an array".into());
        }
        validate_tree(&roots(n, state), 0, &mut 0, &mut HashSet::new(), "")?;
    }
    for c in &n.items {
        validate_state(c, state)?;
    }
    Ok(())
}
pub fn initialize(n: &Node, state: &mut Value) {
    if n.xtype == "tabpanel" {
        state
            .as_object_mut()
            .unwrap()
            .entry(n.active_bind.clone())
            .or_insert(json!(n.active_tab));
    }
    if n.xtype == "menu" {
        state
            .as_object_mut()
            .unwrap()
            .entry(n.open_bind.clone())
            .or_insert(json!(false));
    }
    if n.xtype == "treepanel" {
        let defaults: Vec<Value> = tree_rows(n, state, false)
            .into_iter()
            .filter(|r| r.data.get("expanded").and_then(Value::as_bool) == Some(true))
            .map(|r| r.id)
            .collect();
        state
            .as_object_mut()
            .unwrap()
            .entry(n.expanded_bind.clone())
            .or_insert(json!(defaults));
        state
            .as_object_mut()
            .unwrap()
            .entry(n.selected_bind.clone())
            .or_insert(Value::Null);
    }
    for c in &n.items {
        initialize(c, state);
    }
}
pub fn hidden(path: &[&Node], state: &Value) -> bool {
    path.windows(2).any(|pair| {
        let n = pair[0];
        (n.xtype == "menu" && !flag(state, &n.open_bind))
            || (n.xtype == "tabpanel"
                && n.items
                    .get(active(n, state))
                    .is_none_or(|c| !std::ptr::eq(c, pair[1])))
    })
}
pub fn close_other_menus(n: &Node, state: &mut Value, path: &[&Node]) {
    if n.xtype == "menu" && path.last().is_none_or(|p| p.item_id != n.item_id) {
        state
            .as_object_mut()
            .unwrap()
            .insert(n.open_bind.clone(), json!(false));
    }
    for c in &n.items {
        close_other_menus(c, state, path);
    }
}
pub fn event(n: &Node, state: &mut Value, payload: &Value) -> Result<(), String> {
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    match n.xtype.as_str() {
        "tabpanel" => {
            let i = payload
                .get("value")
                .and_then(Value::as_u64)
                .ok_or("Tab index must be an integer")? as usize;
            let c = n.items.get(i).ok_or("Unknown tab")?;
            if action != "tab" || c.disabled || flag(state, &c.disabled_bind) {
                return Err("Tab is disabled or action is invalid".into());
            }
            state
                .as_object_mut()
                .unwrap()
                .insert(n.active_bind.clone(), json!(i));
        }
        "menu" => {
            let open = match action {
                "toggle" => !flag(state, &n.open_bind),
                "close" => false,
                _ => return Err("Menu requires toggle or close".into()),
            };
            state
                .as_object_mut()
                .unwrap()
                .insert(n.open_bind.clone(), json!(open));
        }
        "treepanel" => {
            let row = tree_rows(n, state, true)
                .into_iter()
                .find(|r| Some(&r.id) == payload.get("id"))
                .ok_or("Tree node is hidden or unknown")?;
            if row.data.get("disabled").and_then(Value::as_bool) == Some(true) {
                return Err("Tree node is disabled".into());
            }
            if action == "toggle" && row.branch {
                let mut expanded = lookup(state, &n.expanded_bind)
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                if let Some(i) = expanded.iter().position(|id| id == &row.id) {
                    expanded.remove(i);
                } else {
                    expanded.push(row.id);
                }
                state
                    .as_object_mut()
                    .unwrap()
                    .insert(n.expanded_bind.clone(), json!(expanded));
            } else if action == "select" {
                state
                    .as_object_mut()
                    .unwrap()
                    .insert(n.selected_bind.clone(), row.id);
            } else {
                return Err("Tree requires select or branch toggle".into());
            }
        }
        _ => return Err("This navigation component does not accept events".into()),
    }
    Ok(())
}
pub fn height(n: &Node, state: &Value, width: f64) -> f64 {
    match n.xtype.as_str() {
        "tabpanel" => {
            42.0 + n
                .items
                .get(active(n, state))
                .map(|c| measure(c, state, width))
                .unwrap_or(0.0)
        }
        "treepanel" => 42.0 + tree_rows(n, state, true).len().max(1) as f64 * 34.0,
        "menuseparator" => 8.0,
        _ => 38.0,
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
    match n.xtype.as_str() {
        "tabpanel" => {
            let mut shell = widget(n, "tabbar", x, y, width, 38.0, key);
            shell.text = n.title.clone();
            out.push(shell);
            let cw = width / n.items.len().max(1) as f64;
            let active = active(n, state);
            for (i, c) in n.items.iter().enumerate() {
                let mut w = widget(
                    n,
                    "tab",
                    x + cw * i as f64,
                    y,
                    cw,
                    38.0,
                    &format!("{key}:tab:{i}"),
                );
                w.text = if c.title.is_empty() {
                    format!("タブ {}", i + 1)
                } else {
                    c.title.clone()
                };
                w.selected = i == active;
                w.disabled = c.disabled || flag(state, &c.disabled_bind);
                w.payload = json!({"action":"tab","value":i});
                w.config = json!({"parentKey":key});
                out.push(w);
            }
            if let Some(c) = n.items.get(active) {
                let child_key = if c.item_id.is_empty() {
                    format!("{key}.{active}")
                } else {
                    c.item_id.clone()
                };
                arrange_node(c, state, x, y + 42.0, width, &child_key, out);
            }
        }
        "treepanel" => {
            let mut shell = widget(n, "tree-shell", x, y, width, height(n, state, width), key);
            shell.text = n.title.clone();
            out.push(shell);
            for (i, row) in tree_rows(n, state, true).into_iter().enumerate() {
                let ry = y + 42.0 + i as f64 * 34.0;
                let inset = (row.depth as f64 * 16.0).min((width - 60.0).max(0.0));
                let disabled = row.data.get("disabled").and_then(Value::as_bool) == Some(true);
                let row_key = format!("{key}:node:{}", row.id);
                if row.branch {
                    let mut w = widget(
                        n,
                        "tree-toggle",
                        x + inset,
                        ry,
                        28.0,
                        34.0,
                        &format!("{row_key}:toggle"),
                    );
                    w.text = if row.expanded { "▾" } else { "▸" }.into();
                    w.disabled = disabled;
                    w.payload = json!({"action":"toggle","id":row.id});
                    w.config = json!({"parentKey":key,"expanded":row.expanded});
                    out.push(w);
                }
                let mut w = widget(
                    n,
                    "tree-node",
                    x + inset + 28.0,
                    ry,
                    (width - inset - 28.0).max(1.0),
                    34.0,
                    &row_key,
                );
                w.text = row
                    .data
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .into();
                w.disabled = disabled;
                w.selected = lookup(state, &n.selected_bind) == &row.id;
                w.payload = json!({"action":"select","id":row.id});
                w.config = json!({"parentKey":key,"branch":row.branch,"expanded":row.expanded,"depth":row.depth});
                out.push(w);
            }
        }
        "menu" => {
            let mut trigger = widget(n, "menu-trigger", x, y, width, 38.0, key);
            trigger.text = if n.text.is_empty() {
                if n.title.is_empty() {
                    "操作 ▾".into()
                } else {
                    format!("{} ▾", n.title)
                }
            } else {
                format!("{} ▾", n.text)
            };
            trigger.selected = flag(state, &n.open_bind);
            trigger.payload = json!({"action":"toggle"});
            trigger.config = json!({"menu":n.item_id});
            out.push(trigger);
            if flag(state, &n.open_bind) {
                let ph: f64 = n
                    .items
                    .iter()
                    .map(|c| {
                        if c.xtype == "menuseparator" {
                            8.0
                        } else {
                            34.0
                        }
                    })
                    .sum::<f64>()
                    + 8.0;
                let pw = width.clamp(180.0, 240.0);
                let px = (x + width - pw).max(16.0);
                let mut surface = widget(
                    n,
                    "menu-surface",
                    px,
                    y + 42.0,
                    pw,
                    ph,
                    &format!("{key}:popup"),
                );
                surface.config = json!({"popup":true,"menu":n.item_id});
                out.push(surface);
                let mut offset = 46.0;
                for c in &n.items {
                    let h = if c.xtype == "menuseparator" {
                        8.0
                    } else {
                        34.0
                    };
                    let mut w = widget(
                        c,
                        if c.xtype == "menuseparator" {
                            "menuseparator"
                        } else {
                            "menu-item"
                        },
                        px + 4.0,
                        y + offset,
                        pw - 8.0,
                        h,
                        &c.item_id,
                    );
                    w.disabled = c.disabled || flag(state, &c.disabled_bind);
                    w.config =
                        json!({"popup":true,"menu":n.item_id,"parentKey":format!("{key}:popup")});
                    out.push(w);
                    offset += h;
                }
            }
        }
        _ => {
            out.push(widget(n, "menuseparator", x, y, width, 8.0, key));
        }
    }
    if n.disabled || flag(state, &n.disabled_bind) {
        for w in &mut out[start..] {
            w.disabled = true;
        }
    }
}
