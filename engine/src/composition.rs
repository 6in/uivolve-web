//! Screen composition: a package may declare child packages under `components` and place them
//! as nodes whose `xtype` is the declared name. This module owns the declaration rules and the
//! shape of a component node; loading the children into an instance tree lives on `Runtime`.
use super::{fields, Node, Package, XTYPES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// One `components` entry: where the child package is fetched from.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Declaration {
    pub url: String,
}

/// Check `package.components` and return the declared names usable as an `xtype`.
pub fn validate_declarations(package: &Package) -> Result<BTreeSet<String>, String> {
    for (name, declaration) in &package.components {
        if !valid_name(name) {
            return Err(format!(
                "Component name {name} requires 1–40 ASCII letters or digits starting with a letter"
            ));
        }
        if reserved(name) {
            return Err(format!(
                "Component name {name} collides with a built-in xtype"
            ));
        }
        if declaration.url.is_empty() || declaration.url.len() > 2048 {
            return Err(format!(
                "Component {name} needs a URL of at most 2048 bytes"
            ));
        }
    }
    Ok(package.components.keys().cloned().collect())
}

fn valid_name(name: &str) -> bool {
    (1..=40).contains(&name.len())
        && name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric())
}

/// A declared name must not shadow anything the widget layer already answers to: the xtype
/// allowlist, or any name normalization rewrites into another xtype or a port.
fn reserved(name: &str) -> bool {
    if XTYPES.contains(&name) {
        return true;
    }
    let mut probe: Node =
        serde_json::from_value(json!({"xtype": name})).expect("a node with only an xtype");
    fields::normalize(&mut probe, "probe");
    probe.xtype != name || !probe.port_kind.is_empty()
}

/// Mark the component nodes of a template and reject placements a child cannot occupy. Runs on
/// the raw template, before `fields::normalize` rewrites attributes of nodes under an accordion
/// or a radiogroup.
pub fn prepare_template(node: &mut Node, declared: &BTreeSet<String>) -> Result<(), String> {
    if declared.is_empty() {
        return Ok(());
    }
    if declared.contains(&node.xtype) {
        if let Some(key) = unsupported_attribute(node) {
            return Err(format!(
                "Component {}: attribute {key} is not supported (only xtype, itemId, config, listeners, flex, width and visibleBind)",
                if node.item_id.is_empty() { &node.xtype } else { &node.item_id }
            ));
        }
        node.port_kind = "component".into();
        return Ok(());
    }
    for bar in [&node.tbar, &node.bbar, &node.buttons, &node.menu] {
        reject_value(bar, declared)?;
    }
    for column in &node.columns {
        if let Some(editor) = &column.editor {
            reject_node(editor, declared)?;
        }
    }
    for child in &mut node.items {
        prepare_template(child, declared)?;
    }
    Ok(())
}

/// Rules for a component node once `fields::normalize` has run: placement, the shape of
/// `config`, and the bindings the parent may hand down.
pub fn validate_node(node: &Node, parent: &str) -> Result<(), String> {
    if node.item_id.is_empty() {
        return Err(format!("Component {} requires itemId", node.xtype));
    }
    if !["container", "panel", "fieldset", "window"].contains(&parent) {
        return Err(misplaced(&node.xtype));
    }
    if !node.config.is_null() && !node.config.is_object() {
        return Err(format!(
            "Component {}: config must be an object",
            node.item_id
        ));
    }
    for (key, value) in node.config.as_object().into_iter().flatten() {
        if let Some(target) = bind_target(value) {
            if !target.as_str().is_some_and(top_level) {
                return Err(format!(
                    "Component {}: config {key} must bind a non-empty top-level state key",
                    node.item_id
                ));
            }
        }
    }
    if node.visible_bind.contains('.') {
        return Err(format!(
            "Component {}: visibleBind must be a top-level state key",
            node.item_id
        ));
    }
    Ok(())
}

/// `{ "bind": <key> }` — the only object shape a component config value may take. Anything
/// else is handed to the child verbatim.
pub fn bind_target(value: &Value) -> Option<&Value> {
    let fields = value.as_object()?;
    if fields.len() != 1 {
        return None;
    }
    fields.get("bind")
}

fn top_level(key: &str) -> bool {
    !key.is_empty() && !key.contains('.')
}

fn misplaced(xtype: &str) -> String {
    format!("Component {xtype}: components are supported only in the items of a container, panel, fieldset or window")
}

/// The first attribute (by name) that a component node carries but may not. Compares the node
/// against one holding only the supported attributes, so the full field list stays in one place.
fn unsupported_attribute(node: &Node) -> Option<String> {
    let mut supported: Node = serde_json::from_value(json!({})).expect("a node with only defaults");
    supported.xtype = node.xtype.clone();
    supported.item_id = node.item_id.clone();
    supported.config = node.config.clone();
    supported.listeners = node.listeners.clone();
    supported.flex = node.flex;
    supported.width = node.width;
    supported.visible_bind = node.visible_bind.clone();
    let expected = serde_json::to_value(&supported).ok()?;
    let actual = serde_json::to_value(node).ok()?;
    actual
        .as_object()?
        .iter()
        .find(|(key, value)| expected.get(key) != Some(value))
        .map(|(key, _)| key.clone())
}

fn reject_node(node: &Node, declared: &BTreeSet<String>) -> Result<(), String> {
    if declared.contains(&node.xtype) {
        return Err(misplaced(&node.xtype));
    }
    for child in &node.items {
        reject_node(child, declared)?;
    }
    Ok(())
}

fn reject_value(value: &Value, declared: &BTreeSet<String>) -> Result<(), String> {
    match value {
        Value::Array(values) => {
            for child in values {
                reject_value(child, declared)?;
            }
        }
        Value::Object(fields) => {
            if let Some(name) = fields.get("xtype").and_then(Value::as_str) {
                if declared.contains(name) {
                    return Err(misplaced(name));
                }
            }
            for child in fields.values() {
                reject_value(child, declared)?;
            }
        }
        _ => {}
    }
    Ok(())
}
