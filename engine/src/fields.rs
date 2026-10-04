use super::{display, flag, lookup, Node, Widget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
pub struct Choice {
    pub value: String,
    pub text: String,
}

pub fn input(node: &Node) -> bool {
    [
        "textfield",
        "textarea",
        "numberfield",
        "datefield",
        "checkbox",
        "radio",
        "combobox",
        "listbox",
        "slider",
    ]
    .contains(&node.xtype.as_str())
}

pub fn normalize(node: &mut Node, path: &str) {
    super::extras::normalize(node, path);
    let xtype = match node.xtype.as_str() {
        "form" => "panel",
        "fieldcontainer" => "container",
        "textareafield" => "textarea",
        "checkboxfield" => "checkbox",
        "radiofield" => "radio",
        "combo" => "combobox",
        "multiselect" => {
            if node.multi_select.is_none() {
                node.multi_select = Some(true);
            }
            "listbox"
        }
        "sliderfield" => "slider",
        "progress" => "progressbar",
        "gridpanel" => "grid",
        "tree" => "treepanel",
        other => other,
    };
    node.xtype = xtype.into();
    super::grid::normalize(node, path);
    super::navigation::normalize(node, path);
    super::layouts::normalize(node, path);
    if node.variant.is_empty() {
        node.variant = node.ui.clone();
    }
    if input(node) || node.collapsible || node.checkbox_toggle {
        if node.item_id.is_empty() {
            node.item_id = format!("field-{}", path.replace('.', "-"));
        }
    }
    if input(node) && node.bind.is_empty() {
        node.bind = if node.name.is_empty() {
            format!("ui_{}", node.item_id.replace('-', "_"))
        } else {
            node.name.clone()
        };
    }
    if node.xtype == "radio" && node.input_value.is_null() {
        node.input_value = if node.value.is_null() {
            json!(node.item_id)
        } else {
            json!(display(&node.value))
        };
    }
    if (node.collapsible || node.checkbox_toggle) && node.collapsed_bind.is_empty() {
        node.collapsed_bind = format!("ui_{}_collapsed", node.item_id.replace('-', "_"));
    }
    for (i, child) in node.items.iter_mut().enumerate() {
        normalize(child, &format!("{path}.{i}"));
    }
}

pub fn choices(node: &Node) -> Result<Vec<Choice>, String> {
    let from_options = !node.options.is_empty();
    let rows = if from_options {
        &node.options
    } else if let Some(rows) = node.store.as_array() {
        rows
    } else if let Some(rows) = node.store.get("data").and_then(Value::as_array) {
        rows
    } else if node.store.is_null() {
        &node.data
    } else {
        return Err("store must be an array or an object containing data".into());
    };
    if rows.len() > 100 {
        return Err("Choice fields support at most 100 options".into());
    }
    let mut ids = HashSet::new();
    rows.iter()
        .map(|row| {
            let (value, text) = if let Some(o) = row.as_object() {
                let vk = if from_options {
                    "value"
                } else {
                    &node.value_field
                };
                let tk = if from_options {
                    "text"
                } else {
                    &node.display_field
                };
                let value = o.get(vk).ok_or_else(|| format!("Option is missing {vk}"))?;
                if !value.is_string() && !value.is_number() {
                    return Err("Option values must be strings or numbers".into());
                }
                (display(value), display(o.get(tk).unwrap_or(value)))
            } else if row.is_string() || row.is_number() {
                (display(row), display(row))
            } else {
                return Err("Options must be strings, numbers, or value/text objects".into());
            };
            if !ids.insert(value.clone()) {
                return Err(format!("Duplicate option value: {value}"));
            }
            if value.len() > 1000 || text.len() > 2000 {
                return Err("Option text is too long".into());
            }
            Ok(Choice { value, text })
        })
        .collect()
}

pub fn validate(node: &Node) -> Result<(), String> {
    if !input(node) && !["progressbar", "displayfield"].contains(&node.xtype.as_str()) {
        return Ok(());
    }
    if !(1..=12).contains(&node.rows) || !(1..=12).contains(&node.size) {
        return Err("rows and size must be between 1 and 12".into());
    }
    if !node.increment.is_finite() || node.increment <= 0.0 {
        return Err("increment must be positive".into());
    }
    if node.min_value.is_some_and(|n| !n.is_finite())
        || node.max_value.is_some_and(|n| !n.is_finite())
        || matches!((node.min_value, node.max_value), (Some(min), Some(max)) if min >= max)
    {
        return Err("minValue must be lower than maxValue".into());
    }
    if node.xtype == "slider" && node.min_value.unwrap_or(0.0) >= node.max_value.unwrap_or(100.0) {
        return Err("slider needs a positive range".into());
    }
    if node.max_length.is_some_and(|n| n > 10_000)
        || matches!((node.min_length, node.max_length), (Some(min), Some(max)) if min > max)
    {
        return Err("Invalid minLength/maxLength".into());
    }
    if !node.input_type.is_empty()
        && !["text", "email", "url", "password", "search", "tel"]
            .contains(&node.input_type.as_str())
    {
        return Err("Unsupported inputType".into());
    }
    if ["combobox", "listbox"].contains(&node.xtype.as_str()) {
        choices(node)?;
    }
    if node.xtype == "radio" && !node.input_value.is_string() {
        return Err("radio inputValue must be a string".into());
    }
    Ok(())
}

pub fn initialize(node: &Node, state: &mut Value) {
    let existing: HashSet<String> = state.as_object().unwrap().keys().cloned().collect();
    fn walk(node: &Node, state: &mut Value, existing: &HashSet<String>) {
        if input(node) && !existing.contains(&node.bind) {
            let value = match node.xtype.as_str() {
                "checkbox" => {
                    if node.value.is_boolean() {
                        node.value.clone()
                    } else {
                        json!(node.checked)
                    }
                }
                "radio" => {
                    if node.checked {
                        node.input_value.clone()
                    } else {
                        json!("")
                    }
                }
                "numberfield" => {
                    if node.value.is_number() {
                        node.value.clone()
                    } else {
                        Value::Null
                    }
                }
                "slider" => json!(node.value.as_f64().unwrap_or(node.min_value.unwrap_or(0.0))),
                "listbox" if node.multi_select == Some(true) => {
                    if let Some(values) = node.value.as_array() {
                        json!(values.iter().map(display).collect::<Vec<_>>())
                    } else if node.value.is_null() {
                        json!([])
                    } else {
                        json!([display(&node.value)])
                    }
                }
                "combobox" | "listbox" => {
                    if !node.value.is_null() {
                        json!(display(&node.value))
                    } else if node.empty_text.is_empty() {
                        json!(choices(node)
                            .unwrap()
                            .first()
                            .map(|o| o.value.as_str())
                            .unwrap_or(""))
                    } else {
                        json!("")
                    }
                }
                _ => json!(display(&node.value)),
            };
            let state = state.as_object_mut().unwrap();
            if !state.contains_key(&node.bind) || (node.xtype == "radio" && node.checked) {
                state.insert(node.bind.clone(), value);
            }
        }
        if !node.collapsed_bind.is_empty() {
            state
                .as_object_mut()
                .unwrap()
                .entry(node.collapsed_bind.clone())
                .or_insert(json!(node.collapsed));
        }
        for child in &node.items {
            walk(child, state, existing);
        }
    }
    walk(node, state, &existing);
}

pub fn event_value(node: &Node, value: &Value) -> Result<Value, String> {
    match node.xtype.as_str() {
        "checkbox" => value
            .as_bool()
            .map(|v| json!(v))
            .ok_or("Checkbox event needs a boolean".into()),
        "numberfield" | "slider" => {
            if node.xtype == "numberfield" && value.is_null() {
                return Ok(Value::Null);
            }
            let n = value
                .as_f64()
                .filter(|v| v.is_finite())
                .ok_or("Numeric event needs a finite number")?;
            let min = node.min_value.unwrap_or(if node.xtype == "slider" {
                0.0
            } else {
                f64::MIN
            });
            let max = node.max_value.unwrap_or(if node.xtype == "slider" {
                100.0
            } else {
                f64::MAX
            });
            if n < min || n > max {
                return Err("Value is outside minValue/maxValue".into());
            }
            if node.xtype == "slider" {
                let n = ((min + ((n - min) / node.increment).round() * node.increment)
                    .clamp(min, max)
                    * 1e9)
                    .round()
                    / 1e9;
                Ok(json!(n))
            } else {
                Ok(value.clone())
            }
        }
        "listbox" if node.multi_select == Some(true) => {
            let values = value
                .as_array()
                .ok_or("Multi-select event needs an array")?;
            let options = choices(node)?;
            let mut seen = HashSet::new();
            for value in values {
                let value = value.as_str().ok_or("Selected values must be strings")?;
                if !seen.insert(value) || !options.iter().any(|o| o.value == value) {
                    return Err("Invalid or duplicate selected option".into());
                }
            }
            Ok(value.clone())
        }
        kind => {
            let s = value.as_str().ok_or("Input event needs a string value")?;
            if s.len() > 10_000
                || node
                    .max_length
                    .is_some_and(|n| s.encode_utf16().count() > n)
            {
                return Err("Input exceeds its length limit".into());
            }
            if kind == "radio" && value != &node.input_value {
                return Err("Invalid radio option".into());
            }
            if ["combobox", "listbox"].contains(&kind)
                && !(s.is_empty() && node.allow_blank)
                && !choices(node)?.iter().any(|o| o.value == s)
            {
                return Err("Unknown selected option".into());
            }
            if kind == "datefield"
                && !s.is_empty()
                && crate::extensions::date::parse_date(s).is_err()
            {
                return Err("Date must be a valid YYYY-MM-DD".into());
            }
            Ok(value.clone())
        }
    }
}

pub fn configure(node: &Node, state: &Value, w: &mut Widget) {
    if !input(node) && !["progressbar", "displayfield"].contains(&node.xtype.as_str()) {
        return;
    }
    let raw = if node.bind.is_empty() {
        node.value.clone()
    } else {
        lookup(state, &node.bind).clone()
    };
    if !node.field_label.is_empty() {
        w.text = node.field_label.clone();
    }
    if !node.allow_blank && !w.text.is_empty() {
        w.text.push_str(" *");
    }
    w.value = display(&raw);
    let options = if ["combobox", "listbox"].contains(&node.xtype.as_str()) {
        choices(node).unwrap()
    } else {
        Vec::new()
    };
    let checked = if node.xtype == "radio" {
        raw == node.input_value
    } else {
        raw.as_bool().unwrap_or(node.checked)
    };
    w.selected = checked;
    if node.xtype == "displayfield" && node.bind.is_empty() && node.value.is_null() {
        w.value = node.text.clone();
    }
    if node.xtype == "progressbar" {
        let n = raw.as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
        w.text = if node.text.is_empty() {
            format!("{}%", (n * 100.0).round())
        } else {
            node.text.clone()
        };
        w.config = json!({ "fraction": n });
    } else {
        w.config = json!({ "rawValue": raw, "boxLabel": node.box_label, "checked": checked, "inputValue": node.input_value, "name": node.name, "group": node.bind, "placeholder": node.empty_text, "inputType": node.input_type, "readOnly": node.read_only, "required": !node.allow_blank, "minLength": node.min_length, "maxLength": node.max_length, "min": node.min_value, "max": node.max_value, "step": node.increment, "rows": node.rows, "size": node.size, "multiple": node.multi_select.unwrap_or(false), "options": options, "labelHeight": if ["checkbox", "radio"].contains(&node.xtype.as_str()) && node.field_label.is_empty() { 0 } else { 24 } });
    }
    if ["codeeditor", "htmleditor"].contains(&node.port_kind.as_str()) {
        w.config["monospace"] = json!(true);
        w.config["language"] = json!(node.language);
        w.config["lineNumbers"] = json!(node.line_numbers);
        w.config["sourceKind"] = json!(node.port_kind);
    }
    w.disabled |= node.disabled
        || flag(state, &node.disabled_bind)
        || (node.read_only
            && ["checkbox", "radio", "combobox", "listbox", "slider"]
                .contains(&node.xtype.as_str()));
}
