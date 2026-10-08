//! Screen composition: a package may declare child packages under `components` and place them
//! as nodes whose `xtype` is the declared name. This module owns the declaration rules and the
//! shape of a component node; loading the children into an instance tree lives on `Runtime`.
use super::{fields, metadata, Node, Package, Widget, XTYPES};
use rhai::{Dynamic, Engine, EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};

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

/// A failure of one instance of the tree paired with the path it happened at. The queues a
/// whole screen shares report it this way, so whoever catches it decides whether to name the
/// instance — a load is already named by the level above it, a running screen is not.
pub type Blame = (String, String);

/// Name the instance a failure belongs to. The root says nothing: its errors are the screen's.
pub fn blame(origin: &str, error: impl std::fmt::Display) -> String {
    match origin.is_empty() {
        true => error.to_string(),
        false => format!("Component {origin}: {error}"),
    }
}

/// The one declaration a child package still may not carry: `webmcp` publishes the screen-wide
/// tool surface, which belongs to the root. Effects themselves are a child's to queue.
pub fn reject_effect_declarations(package: &Package) -> Result<(), String> {
    if metadata::Metadata::is_empty(&package.webmcp) {
        return Ok(());
    }
    Err("webmcp is not available in components (reserved for a later stage)".into())
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

thread_local! {
    /// The instance tree `measure` and `arrange_sized` reach into while a composed screen is
    /// laid out. A screen without components never opens it, so it costs those screens nothing.
    static LAYOUT: RefCell<Option<Scope>> = const { RefCell::new(None) };
}

struct Scope {
    /// Ui and state of every component instance, by prefixed itemId path.
    instances: BTreeMap<String, Rc<(Node, Value)>>,
    /// The itemIds of the component nodes between the root and the one being laid out.
    stack: Vec<String>,
}

/// Holds the layout scope open. Dropping it clears the scope, so neither an error on the way
/// out nor a panic can leave a stale tree behind for the next layout.
pub struct LayoutScope(());

impl Drop for LayoutScope {
    fn drop(&mut self) {
        LAYOUT.with(|scope| *scope.borrow_mut() = None);
    }
}

/// Open a layout scope over the instance tree of a screen.
pub fn enter_layout(instances: BTreeMap<String, (Node, Value)>) -> LayoutScope {
    let instances = instances
        .into_iter()
        .map(|(path, instance)| (path, Rc::new(instance)))
        .collect();
    LAYOUT.with(|scope| {
        *scope.borrow_mut() = Some(Scope {
            instances,
            stack: Vec::new(),
        });
    });
    LayoutScope(())
}

/// Run `f` against the instance placed at the component node `item_id`, with the ui and state
/// of that instance and the scope pointing at it. `None` when no scope is open or nothing is
/// placed there — a composed screen is then laid out as if the node were empty.
pub fn with_component<T>(item_id: &str, f: impl FnOnce(&Node, &Value) -> T) -> Option<T> {
    let instance = LAYOUT.with(|scope| {
        let mut scope = scope.borrow_mut();
        let scope = scope.as_mut()?;
        let path = match scope.stack.is_empty() {
            true => item_id.to_owned(),
            false => format!("{}/{item_id}", scope.stack.join("/")),
        };
        let instance = scope.instances.get(&path)?.clone();
        scope.stack.push(item_id.to_owned());
        Some(instance)
    })?;
    let laid_out = f(&instance.0, &instance.1);
    LAYOUT.with(|scope| {
        if let Some(scope) = scope.borrow_mut().as_mut() {
            scope.stack.pop();
        }
    });
    Some(laid_out)
}

/// Move the widgets an instance produced into the namespace of the node holding it: keys and
/// event targets inside an instance are its own itemIds, and only the prefix tells two
/// placements of the same package apart. Nesting composes one prefix per level.
pub fn prefix_widgets(item_id: &str, widgets: &mut [Widget]) {
    for widget in widgets {
        widget.key = format!("{item_id}/{}", widget.key);
        if !widget.target.is_empty() {
            widget.target = format!("{item_id}/{}", widget.target);
        }
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
