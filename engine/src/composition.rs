//! Screen composition: a package may declare child packages under `components` and place them
//! as nodes whose `xtype` is the declared name. This module owns the declaration rules and the
//! shape of a component node; loading the children into an instance tree lives on `Runtime`.
use super::{fields, metadata, Node, Package, XTYPES};
use rhai::{ASTNode, Dynamic, Engine, EvalAltResult, Expr, ImmutableString, Stmt, AST};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{any::TypeId, cell::RefCell, collections::BTreeSet, rc::Rc};

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

/// The component nodes of a template in document order, the order their instances load in. A
/// component node carries no items of its own, so the walk never descends into one.
pub fn component_nodes<'a>(node: &'a Node, found: &mut Vec<&'a Node>) {
    for child in &node.items {
        if child.port_kind == "component" {
            found.push(child);
        } else {
            component_nodes(child, found);
        }
    }
}

/// Resolve the `config` of a component node against the state of the instance holding it: a
/// `{ "bind": key }` value reads that top-level key, anything else is handed down verbatim.
pub fn evaluate_config(node: &Node, state: &Value) -> Result<Value, String> {
    let mut resolved = serde_json::Map::new();
    for (key, value) in node.config.as_object().into_iter().flatten() {
        let value = match bind_target(value).and_then(Value::as_str) {
            Some(target) => state
                .get(target)
                .cloned()
                .ok_or_else(|| format!("config bind {target} is not in the parent state"))?,
            None => value.clone(),
        };
        resolved.insert(key.clone(), value);
    }
    Ok(Value::Object(resolved))
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

/// Every host function that queues an asynchronous effect, with the argument counts it is
/// registered under. A child instance gets a rejecting stub for each one instead of the real
/// registration, so the refusal is the same whether the call is written out or reached through
/// a function pointer. `composition_tests` keeps this table honest against the effect modules.
pub const STUBS: [(&str, &[usize]); 19] = [
    ("alert", &[1, 2, 3]),
    ("confirm", &[2, 3]),
    ("file_list", &[2]),
    ("file_mkdir", &[2]),
    ("file_read_bytes", &[2]),
    ("file_read_text", &[2]),
    ("file_remove", &[2]),
    ("file_stat", &[2]),
    ("file_write_bytes", &[3]),
    ("file_write_text", &[3]),
    ("host_call", &[2]),
    ("host_cancel", &[1]),
    ("http_get", &[1]),
    ("navigate", &[1]),
    ("prompt", &[2, 3, 4]),
    ("rpc_call", &[2]),
    ("storage_read", &[1]),
    ("storage_remove", &[1]),
    ("storage_write", &[2]),
];

/// Register the rejecting stubs of `STUBS`. Every argument is declared as `Dynamic`, so a stub
/// answers each call shape the real function answers whatever the argument types; registering
/// them raw keeps one compiled body for all of them.
pub fn register_stubs(engine: &mut Engine) {
    for (name, arities) in STUBS {
        for arity in arities {
            let types = vec![TypeId::of::<Dynamic>(); *arity];
            engine.register_raw_fn(name, types, move |_, _| -> Result<(), Box<EvalAltResult>> {
                Err(format!("{name} is not available in components").into())
            });
        }
    }
}

/// Refuse a child script that names an effect function anywhere, including inside a closure.
/// A pointer built from a string (`Fn("navigate")`) is invisible here; the stubs catch those.
pub fn reject_effect_calls(ast: &AST) -> Result<(), String> {
    let mut found = None;
    ast.walk(&mut |path| {
        let call = match path.last() {
            Some(ASTNode::Expr(Expr::FnCall(call, position)))
            | Some(ASTNode::Expr(Expr::MethodCall(call, position))) => Some((call, position)),
            Some(ASTNode::Stmt(Stmt::FnCall(call, position))) => Some((call, position)),
            _ => None,
        };
        let Some((call, position)) = call else {
            return true;
        };
        if !STUBS.iter().any(|(name, _)| *name == call.name.as_str()) {
            return true;
        }
        found = Some(format!(
            "{} is not available in components (line {}, position {})",
            call.name,
            position.line().unwrap_or(0),
            position.position().unwrap_or(0)
        ));
        false
    });
    found.map_or(Ok(()), Err)
}

/// Declarations a child package may not carry: every one of them queues host effects or
/// publishes something screen-wide.
pub fn reject_effect_declarations(package: &Package) -> Result<(), String> {
    if package.requests.is_empty()
        && package.operations.is_empty()
        && package.storage.is_empty()
        && package.files.is_empty()
        && package.rpc.is_empty()
        && package.pages.is_empty()
        && metadata::Metadata::is_empty(&package.webmcp)
    {
        return Ok(());
    }
    Err(
        "requests, operations, storage, files, rpc, pages and webmcp are not available in components (reserved for a later stage)"
            .into(),
    )
}

/// A child owns no window layer: the screen-wide modal stack and its focus belong to the root.
/// Covers `messagebox`, which `fields::normalize` rewrites into a `window`.
pub fn reject_windows(node: &Node) -> Result<(), String> {
    if node.xtype == "window" {
        return Err("window is not available in components (reserved for a later stage)".into());
    }
    for child in &node.items {
        reject_windows(child)?;
    }
    Ok(())
}

/// `emit(name, payload)` of a child handler: the queue the parent drains to find its listeners.
/// Same shape as `pages::Requests` — the queue is shared with the Rhai engine, the drained
/// emits are not.
#[derive(Clone, Default)]
pub struct Emits {
    queue: Rc<RefCell<Vec<(String, Value)>>>,
}

impl Emits {
    pub fn register(&self, engine: &mut Engine) {
        let queue = self.queue.clone();
        engine.register_fn(
            "emit",
            move |name: ImmutableString, payload: Dynamic| -> Result<(), Box<EvalAltResult>> {
                let payload: Value = rhai::serde::from_dynamic(&payload).map_err(|_| {
                    Box::<EvalAltResult>::from(format!(
                        "emit {name}: payload must be JSON-serializable"
                    ))
                })?;
                let mut queue = queue.borrow_mut();
                if queue.len() >= 8 {
                    return Err("At most 8 emits per handler".into());
                }
                queue.push((name.to_string(), payload));
                Ok(())
            },
        );
    }

    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }

    /// Drain the queue. The caller decides what the emits mean: during `init` nothing may be
    /// queued, after a handler the parent looks for a matching listener.
    pub fn take(&self) -> Vec<(String, Value)> {
        std::mem::take(&mut *self.queue.borrow_mut())
    }
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
