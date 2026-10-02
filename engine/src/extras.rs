use super::{display, flag, lookup, widget, Node, Widget};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};
use std::ops::Deref;

#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Columns {
    List(Vec<super::Column>),
    Count(usize),
}
impl Default for Columns {
    fn default() -> Self {
        Self::List(Vec::new())
    }
}
impl Deref for Columns {
    type Target = [super::Column];
    fn deref(&self) -> &Self::Target {
        match self {
            Self::List(v) => v,
            Self::Count(_) => &[],
        }
    }
}
impl<'a> IntoIterator for &'a Columns {
    type Item = &'a super::Column;
    type IntoIter = std::slice::Iter<'a, super::Column>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
pub fn deserialize_items<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Node>, D::Error> {
    Vec::<Value>::deserialize(d)?
        .into_iter()
        .map(|v| {
            let value = if v.is_string() {
                json!({"xtype":"__text", "text":v})
            } else {
                v
            };
            serde_json::from_value(value).map_err(serde::de::Error::custom)
        })
        .collect()
}
fn node(value: Value) -> Node {
    serde_json::from_value(value).expect("internal component config")
}
fn bar(value: &Value) -> Option<Node> {
    if value.is_null() {
        None
    } else {
        serde_json::from_value(if value.is_array() {
            json!({"xtype":"toolbar","items":value})
        } else {
            value.clone()
        })
        .ok()
    }
}
pub fn normalize(n: &mut Node, path: &str) {
    let alias = match n.xtype.as_str() {
        "box" => "component",
        "tbar" => "toolbar",
        "imagecomponent" => "image",
        "uxiframe" => "iframe",
        "cartesian" => "chart",
        "polar" => "chart",
        "forcegraph" => "networkgraph",
        "chat" => "chatpanel",
        "console" => "terminal",
        "code" => "codeeditor",
        "diff" => "diffeditor",
        "msgbox" => "messagebox",
        other => other,
    }
    .to_owned();
    if n.xtype == "polar" && n.series.is_null() {
        n.series = json!({"type":"pie"});
    }
    n.xtype = alias;
    if n.xtype == "button" && !n.menu.is_null() && n.item_id.is_empty() {
        n.item_id = format!("port-{}", path.replace('.', "-"));
    }
    if n.item_id.is_empty()
        && (component(n)
            || ["splitbutton", "messagebox", "codeeditor", "htmleditor"]
                .contains(&n.xtype.as_str()))
    {
        n.item_id = format!("port-{}", path.replace('.', "-"));
    }
    if ["codeeditor", "htmleditor"].contains(&n.xtype.as_str()) {
        n.port_kind = n.xtype.clone();
        n.xtype = "textarea".into();
        if n.field_label.is_empty() {
            n.field_label = if n.title.is_empty() {
                if n.port_kind == "htmleditor" {
                    "HTMLソース"
                } else {
                    "コード"
                }
                .into()
            } else {
                n.title.clone()
            };
        }
    }
    if n.xtype == "messagebox" {
        n.port_kind = "messagebox".into();
        n.xtype = "window".into();
        if n.visible_bind.is_empty() {
            n.visible_bind = format!("ui_{}_visible", n.item_id);
        }
        if n.selected_bind.is_empty() {
            n.selected_bind = format!("ui_{}_response", n.item_id);
        }
        if n.bind.is_empty() {
            n.bind = format!("ui_{}_prompt", n.item_id);
        }
        let labels: Vec<String> = if let Some(v) = n.buttons.as_str() {
            match v {
                "okcancel" => vec!["OK", "キャンセル"],
                "yesno" => vec!["はい", "いいえ"],
                "yesnocancel" => vec!["はい", "いいえ", "キャンセル"],
                "ok" => vec!["OK"],
                _ => vec![v],
            }
            .iter()
            .map(|s| s.to_string())
            .collect()
        } else if let Some(v) = n.buttons.as_array() {
            v.iter().map(display).collect()
        } else {
            vec!["OK".into()]
        };
        n.items = vec![node(
            json!({"xtype":"component","value":if n.message.is_empty(){n.html.clone()}else{n.message.clone()},"height":64}),
        )];
        if n.prompt {
            n.items.push(node(json!({"xtype":"textfield","itemId":format!("{}-prompt",n.item_id),"bind":n.bind,"value":n.value,"fieldLabel":"入力"})));
        }
        let mut buttons = node(json!({"xtype":"container","layout":"hbox"}));
        for (i, label) in labels.iter().enumerate() {
            buttons.items.push(node(json!({"xtype":"dialogbutton","itemId":format!("{}-answer-{i}",n.item_id),"text":label,"inputValue":label,"handler":n.handler,"variant":if i==0{"primary"}else{""}})));
        }
        n.items.push(buttons);
        n.buttons = Value::Null;
    }
    if n.xtype == "splitbutton" && n.menu.is_null() {
        n.xtype = "button".into();
    }
    if n.xtype == "splitbutton" || (n.xtype == "button" && !n.menu.is_null()) {
        let mut main = n.clone();
        main.menu = Value::Null;
        main.xtype = "button".into();
        main.item_id = format!("{}-main", n.item_id);
        let mut menu = bar(&n.menu).unwrap_or_else(|| node(json!({"xtype":"menu","items":[]})));
        menu.xtype = "menu".into();
        menu.item_id = format!("{}-menu", n.item_id);
        menu.text = "▾".into();
        menu.flex = 0.2;
        n.xtype = "container".into();
        n.layout = "hbox".into();
        n.handler.clear();
        n.menu = Value::Null;
        n.items = vec![main, menu];
    }
    if n.xtype == "toolbar" {
        for (i, c) in n.items.iter_mut().enumerate() {
            if c.xtype == "__text" {
                c.xtype = match c.text.as_str() {
                    "->" => "tbfill",
                    "-" => "tbseparator",
                    s if s.trim().is_empty() => "tbspacer",
                    _ => "tbtext",
                }
                .into();
            }
            if c.xtype.is_empty() {
                c.xtype = "button".into();
            }
            if c.xtype == "button" && c.item_id.is_empty() {
                c.item_id = format!("{}-item-{i}", n.item_id);
            }
        }
    }
    if ["radiogroup", "checkboxgroup"].contains(&n.xtype.as_str()) {
        let radio = n.xtype == "radiogroup";
        for c in &mut n.items {
            if c.xtype.is_empty() {
                c.xtype = if radio { "radio" } else { "checkbox" }.into();
            }
            if radio && c.name.is_empty() {
                c.name = if !n.bind.is_empty() {
                    n.bind.clone()
                } else if !n.name.is_empty() {
                    n.name.clone()
                } else {
                    format!("ui_{}_group", n.item_id)
                };
            }
            c.read_only |= n.read_only;
        }
    }
    if n.layout == "accordion" {
        n.port_kind = "accordion".into();
        let active = n.items.iter().position(|c| !c.collapsed).unwrap_or(0);
        for (i, c) in n.items.iter_mut().enumerate() {
            c.collapsible = true;
            c.collapsed = i != active;
        }
    }
    if n.xtype == "menu" {
        for c in &mut n.items {
            if c.xtype == "__text" {
                c.xtype = if c.text == "-" {
                    "menuseparator"
                } else {
                    "button"
                }
                .into();
            }
        }
    }
    if n.xtype == "datepicker" {
        if n.bind.is_empty() {
            n.bind = format!("ui_{}_date", n.item_id);
        }
        if n.page_bind.is_empty() {
            n.page_bind = format!("ui_{}_month", n.item_id);
        }
    }
    if n.xtype == "pagingtoolbar" {
        if n.page_size == 0 {
            n.page_size = 25;
        }
        if n.page_bind.is_empty() {
            n.page_bind = format!("ui_{}_page", n.item_id);
        }
    }
    if n.xtype == "toast" && n.visible_bind.is_empty() {
        n.visible_bind = format!("ui_{}_visible", n.item_id);
    }
    if ["panel", "form", "window", "fieldset", "chatpanel"].contains(&n.xtype.as_str())
        && n.port_kind != "messagebox"
    {
        if let Some(t) = bar(&n.tbar) {
            n.items.insert(0, t);
        } else if !n.tbar.is_null() {
            n.xtype = "invalid-tbar".into();
        }
        if let Some(b) = bar(&n.bbar) {
            n.items.push(b);
        } else if !n.bbar.is_null() {
            n.xtype = "invalid-bbar".into();
        }
        if !n.buttons.is_null() {
            if let Some(b) = bar(&n.buttons) {
                n.items.push(b);
            } else {
                n.xtype = "invalid-buttons".into();
            }
        }
        n.tbar = Value::Null;
        n.bbar = Value::Null;
        n.buttons = Value::Null;
    }
}
pub fn component(n: &Node) -> bool {
    [
        "toolbar",
        "tbfill",
        "tbseparator",
        "tbspacer",
        "tbtext",
        "radiogroup",
        "checkboxgroup",
        "datepicker",
        "pagingtoolbar",
        "dialogbutton",
        "toast",
        "component",
        "markdown",
        "diffeditor",
        "chatpanel",
        "terminal",
        "image",
        "video",
        "iframe",
        "chart",
        "draw",
        "gitgraph",
        "networkgraph",
        "mermaid",
    ]
    .contains(&n.xtype.as_str())
}
pub fn event_component(n: &Node) -> bool {
    ["datepicker", "pagingtoolbar", "dialogbutton", "toast"].contains(&n.xtype.as_str())
}
fn insert(state: &mut Value, key: &str, value: Value) {
    if !state.as_object().unwrap().contains_key(key) {
        state.as_object_mut().unwrap().insert(key.into(), value);
    }
}
pub fn initialize(n: &Node, state: &mut Value) {
    if n.port_kind == "messagebox" {
        insert(state, &n.visible_bind, json!(!n.hidden));
        insert(state, &n.selected_bind, Value::Null);
    }
    if n.xtype == "toast" {
        insert(state, &n.visible_bind, json!(!n.hidden));
    }
    if n.xtype == "datepicker" {
        let initial = if let Some(value) = n.value.as_str() {
            value.to_string()
        } else {
            n.today.clone()
        };
        insert(state, &n.bind, json!(initial));
        let selected = display(lookup(state, &n.bind));
        insert(
            state,
            &n.page_bind,
            json!(selected.get(..7).unwrap_or("2026-01")),
        );
    }
    if n.xtype == "pagingtoolbar" {
        insert(state, &n.page_bind, json!(0));
    }
    for c in &n.items {
        initialize(c, state);
    }
}
pub fn validate(n: &Node) -> Result<(), String> {
    if n.port_kind == "messagebox" {
        let keys = [&n.bind, &n.visible_bind, &n.selected_bind];
        if keys.iter().any(|k| k.is_empty() || k.contains('.'))
            || keys[0] == keys[1]
            || keys[1] == keys[2]
            || keys[0] == keys[2]
        {
            return Err("Dialog bindings must be distinct top-level keys".into());
        }
    }
    if n.height
        .is_some_and(|h| !h.is_finite() || !(24.0..=1200.0).contains(&h))
    {
        return Err("height must be 24..1200".into());
    }
    if n.xtype == "__text" {
        return Err("String items are supported only in toolbar/menu".into());
    }
    if ["radiogroup", "checkboxgroup"].contains(&n.xtype.as_str())
        && (n.items.is_empty()
            || n.items.len() > 24
            || n.items.iter().any(|c| {
                c.xtype
                    != if n.xtype == "radiogroup" {
                        "radio"
                    } else {
                        "checkbox"
                    }
            }))
    {
        return Err("Check groups require 1..24 matching fields".into());
    }
    if let Columns::Count(c) = n.columns {
        if !(n.layout == "grid" && (1..=12).contains(&c))
            && (!["radiogroup", "checkboxgroup"].contains(&n.xtype.as_str())
                || !(1..=8).contains(&c))
        {
            return Err(
                "Numeric columns require check groups (1..8) or grid layout (1..12)".into(),
            );
        }
    }
    if n.xtype == "datepicker" && (!n.today.is_empty() && date(&n.today).is_none()) {
        return Err("today must be YYYY-MM-DD".into());
    }
    if n.xtype == "datepicker"
        && !n.value.is_null()
        && !n
            .value
            .as_str()
            .is_some_and(|v| v.is_empty() || date(v).is_some())
    {
        return Err("Calendar value must be YYYY-MM-DD or empty".into());
    }
    for key in if n.xtype == "datepicker" {
        vec![&n.bind, &n.page_bind]
    } else if n.xtype == "pagingtoolbar" {
        vec![&n.page_bind]
    } else if n.xtype == "toast" {
        vec![&n.visible_bind]
    } else {
        vec![]
    } {
        if key.is_empty() || key.contains('.') {
            return Err("Component state bindings must be top-level".into());
        }
    }
    if n.xtype == "datepicker" && n.bind == n.page_bind {
        return Err("Date and month bindings must differ".into());
    }
    if n.xtype == "pagingtoolbar" && !(1..=2000).contains(&n.page_size) {
        return Err("pageSize must be 1..2000".into());
    }
    if n.xtype == "pagingtoolbar" && n.total > 1_000_000_000 {
        return Err("Page total exceeds 1000000000".into());
    }
    for url in [&n.src, &n.url, &n.poster_url] {
        if !url.is_empty()
            && (url.chars().any(|c| c.is_control())
                || url.contains('\\')
                || url.split('/').next().unwrap_or("").contains(':')
                    && !url.starts_with("http://")
                    && !url.starts_with("https://"))
        {
            return Err("Media URL must be relative or HTTP/HTTPS".into());
        }
    }
    if n.max_lines.is_some_and(|v| v == 0 || v > 500) {
        return Err("maxLines must be 1..500".into());
    }
    if n.lines.len() > 500 || n.messages.len() > 100 {
        return Err("Terminal/chat content exceeds its limit".into());
    }
    super::figures::validate(n)?;
    Ok(())
}
pub fn validate_state(n: &Node, state: &Value) -> Result<(), String> {
    if n.layout == "accordion"
        && n.items
            .iter()
            .filter(|c| !flag(state, &c.collapsed_bind))
            .count()
            > 1
    {
        return Err("Accordion permits only one expanded panel".into());
    }
    if n.port_kind == "messagebox"
        && (!lookup(state, &n.visible_bind).is_boolean()
            || !(lookup(state, &n.selected_bind).is_null()
                || lookup(state, &n.selected_bind).is_string()))
    {
        return Err("Invalid dialog visibility/response state".into());
    }
    if n.xtype == "datepicker" {
        let value = display(lookup(state, &n.bind));
        if !lookup(state, &n.bind).is_string() {
            return Err("Calendar selection must be a string".into());
        }
        if !value.is_empty() && date(&value).is_none() {
            return Err("Invalid calendar selection".into());
        }
        if month(&display(lookup(state, &n.page_bind))).is_none() {
            return Err("Invalid calendar month".into());
        }
    }
    if n.xtype == "pagingtoolbar" {
        if !n.bind.is_empty()
            && lookup(state, &n.bind)
                .as_u64()
                .is_none_or(|v| v > 1_000_000_000)
        {
            return Err("Page total must be an integer between 0 and 1000000000".into());
        }
        if lookup(state, &n.page_bind)
            .as_u64()
            .is_none_or(|v| v >= page_count(n, state) as u64)
        {
            return Err("Page state is outside the available pages".into());
        }
    }
    if n.xtype == "toast" && !lookup(state, &n.visible_bind).is_boolean() {
        return Err("Toast visibility must be bool".into());
    }
    if ["chart", "draw", "gitgraph", "networkgraph", "mermaid"].contains(&n.xtype.as_str()) {
        super::figures::validate_state(n, state)?;
    }
    if ["chatpanel", "terminal"].contains(&n.xtype.as_str()) && !n.bind.is_empty() {
        let a = lookup(state, &n.bind)
            .as_array()
            .ok_or("Chat/terminal binding must contain an array")?;
        if a.len() > if n.xtype == "chatpanel" { 100 } else { 500 } {
            return Err("Bound content is too large".into());
        }
    }
    for c in &n.items {
        validate_state(c, state)?;
    }
    Ok(())
}
pub fn hidden(path: &[&Node], state: &Value) -> bool {
    path.iter()
        .any(|n| n.xtype == "toast" && !flag(state, &n.visible_bind))
}
pub fn accordion(path: &[&Node], state: &mut Value) {
    if let Some(parent) = path.iter().rev().nth(1).filter(|n| n.layout == "accordion") {
        let child = path.last().unwrap();
        if flag(state, &child.collapsed_bind) {
            return;
        }
        for c in &parent.items {
            if !c.collapsed_bind.is_empty() {
                state[&c.collapsed_bind] = json!(c.item_id != child.item_id);
            }
        }
    }
}
pub fn event(n: &Node, path: &[&Node], state: &mut Value, p: &mut Value) -> Result<(), String> {
    let action = p["action"].as_str().unwrap_or("");
    match n.xtype.as_str() {
        "toast" => {
            if action != "close" || !n.closable {
                return Err("Toast cannot be closed".into());
            }
            state[&n.visible_bind] = json!(false);
        }
        "dialogbutton" => {
            if action != "answer" {
                return Err("Invalid dialog action".into());
            }
            let parent = path
                .iter()
                .rev()
                .find(|n| n.port_kind == "messagebox")
                .ok_or("Missing dialog parent")?;
            state[&parent.visible_bind] = json!(false);
            state[&parent.selected_bind] = n.input_value.clone();
            *p = json!({"action":"answer","id":n.input_value,"value":lookup(state,&parent.bind)});
        }
        "pagingtoolbar" => {
            let page = p["value"].as_u64().ok_or("Invalid page")? as usize;
            if action != "page" || page >= page_count(n, state) {
                return Err("Invalid page".into());
            }
            state[&n.page_bind] = json!(page);
        }
        "datepicker" => {
            if n.read_only {
                return Err("Calendar is read-only".into());
            }
            if action == "month" {
                let value = p["value"].as_str().ok_or("Invalid month")?;
                if month(value).is_none() {
                    return Err("Invalid month".into());
                }
                state[&n.page_bind] = json!(value);
            } else if action == "select" {
                let value = p["value"].as_str().ok_or("Invalid date")?;
                let (year, m, _) = date(value).ok_or("Invalid date")?;
                let (vy, vm) = month(&display(lookup(state, &n.page_bind))).unwrap();
                if !calendar_dates(vy, vm).contains(&value.to_string())
                    && !(n.show_today && value == n.today)
                {
                    return Err("Date is outside the visible calendar".into());
                }
                state[&n.bind] = json!(value);
                state[&n.page_bind] = json!(format!("{year:04}-{m:02}"));
            } else {
                return Err("Invalid calendar action".into());
            }
        }
        _ => return Err("Invalid component event".into()),
    }
    Ok(())
}
fn total(n: &Node, state: &Value) -> usize {
    if n.bind.is_empty() {
        n.total
    } else {
        lookup(state, &n.bind)
            .as_u64()
            .map(|v| v as usize)
            .unwrap_or(n.total)
    }
}
fn page_count(n: &Node, state: &Value) -> usize {
    total(n, state).div_ceil(n.page_size).max(1)
}
fn group_columns(n: &Node) -> usize {
    match n.columns {
        Columns::Count(c) => c,
        _ => n.items.len().clamp(1, 4),
    }
}
pub fn height(n: &Node, state: &Value, width: f64) -> f64 {
    match n.xtype.as_str() {
        "toolbar" => {
            n.items
                .iter()
                .map(|c| super::measure(c, state, width / n.items.len().max(1) as f64))
                .fold(36.0, f64::max)
                + 8.0
        }
        "tbfill" | "tbseparator" | "tbspacer" | "tbtext" | "dialogbutton" | "pagingtoolbar" => 38.0,
        "radiogroup" | "checkboxgroup" => {
            28.0 + n.items.len().div_ceil(group_columns(n)) as f64 * 44.0
        }
        "datepicker" => {
            if n.show_today && !n.today.is_empty() {
                316.0
            } else {
                276.0
            }
        }
        "toast" => {
            if flag(state, &n.visible_bind) {
                82.0
            } else {
                0.0
            }
        }
        "chatpanel" => n.height.unwrap_or(280.0) + super::content_height(n, state, width),
        "image" | "video" | "iframe" => n.height.unwrap_or(200.0),
        _ => n.height.unwrap_or(260.0),
    }
}
fn control(
    n: &Node,
    key: &str,
    text: &str,
    action: &str,
    value: Value,
    x: f64,
    y: f64,
    w: f64,
    out: &mut Vec<Widget>,
) {
    let mut b = widget(n, "extra-button", x, y, w, 34.0, key);
    b.text = text.into();
    b.payload = json!({"action":action,"value":value});
    b.disabled = n.disabled || n.read_only;
    out.push(b);
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
    let h = height(n, state, width);
    match n.xtype.as_str() {
        "toolbar" => {
            let mut shell = widget(n, "toolbar", x, y, width, h, key);
            shell.text.clear();
            out.push(shell);
            let fixed: f64 = n
                .items
                .iter()
                .filter(|c| c.xtype != "tbfill")
                .map(|c| match c.xtype.as_str() {
                    "tbseparator" => 10.0,
                    "tbspacer" => 8.0,
                    _ => toolbar_width(c),
                })
                .sum();
            let gap = 6.0_f64.min(width / n.items.len().max(1) as f64);
            let gaps = gap * n.items.len().saturating_sub(1) as f64;
            let available = (width - fixed - gaps).max(0.0);
            let fills = n
                .items
                .iter()
                .filter(|c| c.xtype == "tbfill")
                .count()
                .max(1);
            let shrink = ((width - gaps).max(0.0) / fixed.max(1.0)).min(1.0);
            let mut offset = 0.0;
            for (i, c) in n.items.iter().enumerate() {
                let cw = if c.xtype == "tbfill" {
                    available / fills as f64
                } else {
                    (match c.xtype.as_str() {
                        "tbseparator" => 10.0,
                        "tbspacer" => 8.0,
                        _ => toolbar_width(c),
                    }) * shrink
                };
                let ck = if c.item_id.is_empty() {
                    format!("{key}-item-{i}")
                } else {
                    c.item_id.clone()
                };
                super::arrange(c, state, x + offset, y + 4.0, cw, &ck, out);
                offset += cw + gap;
            }
        }
        "radiogroup" | "checkboxgroup" => {
            let mut label = widget(n, "label", x, y, width, 24.0, &format!("{key}-label"));
            label.text = n.field_label.clone();
            out.push(label);
            let columns = group_columns(n);
            let cw = (width - 8.0 * (columns - 1) as f64) / columns as f64;
            for (i, c) in n.items.iter().enumerate() {
                super::arrange(
                    c,
                    state,
                    x + (i % columns) as f64 * (cw + 8.0),
                    y + 28.0 + (i / columns) as f64 * 44.0,
                    cw,
                    &c.item_id,
                    out,
                );
            }
        }
        "datepicker" => {
            let (yr, m) = month(&display(lookup(state, &n.page_bind))).unwrap();
            let cw = width / 7.0;
            let shift = |delta: i32| {
                let z = yr * 12 + m - 1 + delta;
                format!("{:04}-{:02}", z.div_euclid(12), z.rem_euclid(12) + 1)
            };
            control(
                n,
                &format!("{key}:prev"),
                "‹",
                "month",
                json!(shift(-1)),
                x,
                y,
                36.0,
                out,
            );
            out.last_mut().unwrap().disabled |= yr == 1 && m == 1;
            control(
                n,
                &format!("{key}:next"),
                "›",
                "month",
                json!(shift(1)),
                x + width - 36.0,
                y,
                36.0,
                out,
            );
            out.last_mut().unwrap().disabled |= yr == 9999 && m == 12;
            let mut title = widget(
                n,
                "label",
                x + 40.0,
                y + 7.0,
                width - 80.0,
                24.0,
                &format!("{key}:title"),
            );
            title.text = format!("{yr}年 {m}月");
            out.push(title);
            for (i, s) in ["日", "月", "火", "水", "木", "金", "土"]
                .iter()
                .enumerate()
            {
                let mut w = widget(
                    n,
                    "label",
                    x + i as f64 * cw + 8.0,
                    y + 40.0,
                    cw,
                    24.0,
                    &format!("{key}:weekday:{i}"),
                );
                w.text = s.to_string();
                out.push(w);
            }
            let start_day = weekday(yr, m, 1);
            for i in 0..42 {
                let mut day = i - start_day + 1;
                let mut year = yr;
                let mut mo = m;
                if day < 1 {
                    mo -= 1;
                    if mo == 0 {
                        year -= 1;
                        mo = 12;
                    }
                    day += days(year, mo);
                } else if day > days(year, mo) {
                    day -= days(year, mo);
                    mo += 1;
                    if mo == 13 {
                        year += 1;
                        mo = 1;
                    }
                }
                let value = format!("{year:04}-{mo:02}-{day:02}");
                control(
                    n,
                    &format!("{key}:day:{i}"),
                    &day.to_string(),
                    "select",
                    json!(value),
                    x + (i % 7) as f64 * cw,
                    y + 68.0 + (i / 7) as f64 * 34.0,
                    cw - 2.0,
                    out,
                );
                let w = out.last_mut().unwrap();
                w.disabled |= date(&value).is_none();
                w.selected = display(lookup(state, &n.bind)) == value;
                if mo != m {
                    w.variant = "muted".into();
                }
            }
            if n.show_today && !n.today.is_empty() {
                control(
                    n,
                    &format!("{key}:today"),
                    if n.today_text.is_empty() {
                        "今日"
                    } else {
                        &n.today_text
                    },
                    "select",
                    json!(n.today),
                    x,
                    y + 278.0,
                    width,
                    out,
                );
            }
        }
        "pagingtoolbar" => {
            let count = page_count(n, state);
            let page = lookup(state, &n.page_bind).as_u64().unwrap_or(0) as usize;
            let page = page.min(count - 1);
            let cw = (width / 6.0).min(64.0);
            for (i, (label, p)) in [
                ("«", 0),
                ("‹", page.saturating_sub(1)),
                ("›", (page + 1).min(count - 1)),
                ("»", count - 1),
            ]
            .iter()
            .enumerate()
            {
                control(
                    n,
                    &format!("{key}:page:{i}"),
                    label,
                    "page",
                    json!(p),
                    x + i as f64 * cw,
                    y,
                    cw - 4.0,
                    out,
                );
                out.last_mut().unwrap().disabled |= *p == page;
            }
            let mut info = widget(
                n,
                "label",
                x + cw * 4.0,
                y + 7.0,
                width - cw * 4.0,
                24.0,
                &format!("{key}:info"),
            );
            info.text = format!("{} / {} · {} 件", page + 1, count, total(n, state));
            out.push(info);
        }
        "dialogbutton" => {
            let mut b = widget(n, "button", x, y, width, 38.0, key);
            b.payload = json!({"action":"answer","id":n.input_value});
            out.push(b);
        }
        "toast" => {
            if h > 0.0 {
                let mut w = widget(n, "toast", x, y, width, h, key);
                w.text = format!(
                    "{}\n{}",
                    n.title,
                    if n.message.is_empty() {
                        &n.text
                    } else {
                        &n.message
                    }
                );
                out.push(w);
                if n.closable {
                    control(
                        n,
                        &format!("{key}:close"),
                        "×",
                        "close",
                        Value::Null,
                        x + width - 38.0,
                        y + 4.0,
                        32.0,
                        out,
                    );
                }
            }
        }
        "image" | "video" | "iframe" => {
            let mut w = widget(n, &n.xtype, x, y, width, h, key);
            w.text = if n.title.is_empty() {
                n.alt.clone()
            } else {
                n.title.clone()
            };
            w.config = json!({"src":if n.url.is_empty(){&n.src}else{&n.url},"alt":n.alt,"poster":n.poster_url,"controls":n.controls,"muted":n.muted,"loop":n.r#loop,"autoplay":n.autoplay});
            out.push(w);
        }
        "chart" | "draw" | "gitgraph" | "networkgraph" | "mermaid" => {
            let mut w = widget(n, "figure", x, y, width, h, key);
            w.text = if n.title.is_empty() {
                n.xtype.clone()
            } else {
                n.title.clone()
            };
            w.config = super::figures::render(n, state);
            out.push(w);
        }
        "chatpanel" => {
            let messages = if n.bind.is_empty() {
                n.messages.clone()
            } else {
                lookup(state, &n.bind)
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            };
            let mut lines = vec![];
            for msg in messages {
                lines.push(json!({"text":format!("{}: {}",msg["name"].as_str().unwrap_or(msg["from"].as_str().unwrap_or("bot")),msg["text"].as_str().unwrap_or("")),"tone":if msg["from"]=="user"{"accent"}else{"text"}}));
            }
            if n.typing {
                lines.push(json!({"text":"入力中…","tone":"muted"}));
            }
            document(n, &lines, x, y, width, n.height.unwrap_or(280.0), key, out);
            super::arrange_children(n, state, x, y + n.height.unwrap_or(280.0), width, key, out);
        }
        "tbfill" | "tbspacer" => {}
        "tbseparator" => {
            let mut w = widget(n, "separator", x, y, width, h, key);
            w.text.clear();
            out.push(w);
        }
        "tbtext" => {
            out.push(widget(n, "label", x, y + 7.0, width, 24.0, key));
        }
        _ => {
            let content = if n.bind.is_empty() {
                if !n.value.is_null() {
                    display(&n.value)
                } else if !n.html.is_empty() {
                    n.html.clone()
                } else {
                    n.text.clone()
                }
            } else {
                display(lookup(state, &n.bind))
            };
            let mut lines: Vec<Value> = if n.xtype == "terminal" {
                let values = if n.bind.is_empty() {
                    n.lines.clone()
                } else {
                    lookup(state, &n.bind)
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(display)
                        .collect()
                };
                values
                    .into_iter()
                    .rev()
                    .take(n.max_lines.unwrap_or(100))
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .map(|s| json!({"text":s,"code":true}))
                    .collect()
            } else if n.xtype == "diffeditor" {
                super::figures::diff(&n.original, &content)
            } else {
                let mut fenced = false;
                content
                    .lines()
                    .filter_map(|line| {
                        if n.xtype == "markdown" && line.starts_with("```") {
                            fenced = !fenced;
                            return None;
                        }
                        let heading = n.xtype == "markdown" && !fenced && line.starts_with('#');
                        let text = if heading {
                            line.trim_start_matches('#').trim().to_string()
                        } else if n.xtype == "markdown" && !fenced && line.starts_with("- ") {
                            format!("• {}", &line[2..])
                        } else {
                            line.to_string()
                        };
                        Some(json!({"text":text,"heading":heading,"code":fenced}))
                    })
                    .collect()
            };
            if lines.is_empty() {
                lines.push(json!({"text":""}));
            }
            document(n, &lines, x, y, width, h, key, out);
        }
    }
    if n.disabled || flag(state, &n.disabled_bind) {
        for w in &mut out[start..] {
            w.disabled = true;
        }
    }
}
fn toolbar_width(c: &Node) -> f64 {
    if super::fields::input(c) {
        return 150.0;
    }
    (c.text
        .chars()
        .map(|ch| if ch.is_ascii() { 7.0 } else { 12.0 })
        .sum::<f64>()
        + 24.0)
        .clamp(54.0, 170.0)
}
fn document(
    n: &Node,
    lines: &[Value],
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    key: &str,
    out: &mut Vec<Widget>,
) {
    let mut w = widget(n, "document", x, y, width, height, key);
    w.text = n.title.clone();
    w.config = json!({"lines":lines,"format":n.xtype});
    out.push(w);
}
fn month(v: &str) -> Option<(i32, i32)> {
    let (y, m) = v.split_once('-')?;
    if y.len() != 4 || m.len() != 2 || !y.bytes().chain(m.bytes()).all(|c| c.is_ascii_digit()) {
        return None;
    }
    let y = y.parse().ok()?;
    let m = m.parse().ok()?;
    if (1..=9999).contains(&y) && (1..=12).contains(&m) {
        Some((y, m))
    } else {
        None
    }
}
fn date(v: &str) -> Option<(i32, i32, i32)> {
    if v.len() != 10 {
        return None;
    }
    let (y, m) = month(v.get(..7)?)?;
    if !v.get(8..)?.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let day = v.get(8..)?.parse().ok()?;
    if v.as_bytes()[7] != b'-' || day < 1 || day > days(y, m) {
        None
    } else {
        Some((y, m, day))
    }
}
fn calendar_dates(yr: i32, m: i32) -> Vec<String> {
    (0..42)
        .map(|i| {
            let mut day = i - weekday(yr, m, 1) + 1;
            let (mut year, mut mo) = (yr, m);
            if day < 1 {
                mo -= 1;
                if mo == 0 {
                    year -= 1;
                    mo = 12;
                }
                day += days(year, mo);
            } else if day > days(year, mo) {
                day -= days(year, mo);
                mo += 1;
                if mo == 13 {
                    year += 1;
                    mo = 1;
                }
            }
            format!("{year:04}-{mo:02}-{day:02}")
        })
        .collect()
}
fn days(y: i32, m: i32) -> i32 {
    match m {
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}
fn weekday(y: i32, m: i32, d: i32) -> i32 {
    let offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    (y + y / 4 - y / 100 + y / 400 + offsets[(m - 1) as usize] + d) % 7
}
