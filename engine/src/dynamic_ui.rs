use super::{fields, initialize_ui, Node};
use serde_json::Value;
use std::collections::{BTreeSet, HashSet};

pub fn validate(node: &Node) -> Result<(), String> {
    if !node.items_bind.is_empty()
        && (node.xtype != "tabpanel"
            || node.items_bind.contains('.')
            || node.items_bind == node.active_bind)
    {
        return Err(
            "itemsBind requires a tabpanel and a top-level key distinct from activeBind".into(),
        );
    }
    Ok(())
}

pub fn resolve(
    template: &Node,
    state: &Value,
    declared: &BTreeSet<String>,
) -> Result<Node, String> {
    let mut ui = template.clone();
    expand(&mut ui, state, 0, &mut 0, declared)?;
    super::validate(&ui, &mut HashSet::new(), &mut 0, 0, declared, "")?;
    Ok(ui)
}

fn expand(
    node: &mut Node,
    state: &Value,
    depth: usize,
    count: &mut usize,
    declared: &BTreeSet<String>,
) -> Result<(), String> {
    *count += 1;
    if depth > 20 || *count > 200 {
        return Err("UI exceeds 200 nodes or 20 nesting levels".into());
    }
    validate(node)?;
    if !node.items_bind.is_empty() {
        if !node.items.is_empty() {
            return Err("items and itemsBind cannot be combined".into());
        }
        let configs = state
            .get(&node.items_bind)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("itemsBind {} must refer to an array", node.items_bind))?;
        if configs.len() > 8 {
            return Err("Dynamic tabpanel supports at most 8 tabs".into());
        }
        for config in configs {
            // Bound raw data before serde/normalization recursively traverses it.
            check_config(config, depth + 1, &mut 0)?;
            let mut child: Node = serde_json::from_value(config.clone())
                .map_err(|e| format!("itemsBind {}: {e}", node.items_bind))?;
            if child.item_id.is_empty() {
                return Err("Dynamic tabs require an explicit, stable itemId".into());
            }
            // Components are placed by the template, so the parent cannot grow one from state.
            if declared.contains(&child.xtype)
                || !child.config.is_null()
                || !child.listeners.is_empty()
            {
                return Err("Dynamic tabs cannot carry components, config or listeners".into());
            }
            let path = format!("dynamic-{}", child.item_id);
            fields::normalize(&mut child, &path);
            node.items.push(child);
        }
    }
    for child in &mut node.items {
        expand(child, state, depth + 1, count, declared)?;
    }
    Ok(())
}

fn check_config(value: &Value, depth: usize, count: &mut usize) -> Result<(), String> {
    *count += 1;
    if depth > 64 || *count > 10_000 {
        return Err("Dynamic config exceeds 10000 objects/arrays or 64 nesting levels".into());
    }
    // Only nested objects/arrays add depth; ordinary component attributes do not.
    match value {
        Value::Array(values) => {
            for child in values {
                if child.is_object() || child.is_array() {
                    check_config(child, depth + 1, count)?;
                }
            }
        }
        Value::Object(values) => {
            for child in values.values() {
                if child.is_object() || child.is_array() {
                    check_config(child, depth + 1, count)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn initialize_added(before: &Node, after: &Node, state: &mut Value) {
    fn ids(node: &Node, found: &mut HashSet<String>) {
        if !node.item_id.is_empty() {
            found.insert(node.item_id.clone());
        }
        for child in &node.items {
            ids(child, found);
        }
    }
    fn walk(node: &Node, existing: &HashSet<String>, state: &mut Value) {
        if !node.item_id.is_empty() && !existing.contains(&node.item_id) {
            initialize_ui(node, state);
        } else {
            for child in &node.items {
                walk(child, existing, state);
            }
        }
    }
    let mut existing = HashSet::new();
    ids(before, &mut existing);
    walk(after, &existing, state);
}
