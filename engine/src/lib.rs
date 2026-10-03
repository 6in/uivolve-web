use rhai::{Dynamic, Engine, Scope, AST};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
mod abi;
pub use abi::{input_alloc, input_free, request, response_len};
mod theme;
use theme::Theme;
mod buffers;
mod dynamic_ui;
pub mod extensions;
mod extras;
mod fields;
mod figures;
mod files;
pub use files::FileBytes;
mod grid;
mod http;
mod layouts;
mod metadata;
mod navigation;
mod rpc;
mod state_schema;
mod storage;
pub use buffers::{buffer_free, buffer_len, buffer_ptr, buffer_store};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Package {
    pub version: u32,
    pub id: String,
    pub title: String,
    pub script: String,
    pub state: Value,
    pub ui: Node,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub requests: HashMap<String, http::Request>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub storage: HashMap<String, storage::Definition>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub files: HashMap<String, files::Definition>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub rpc: HashMap<String, rpc::Definition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_schema: Option<state_schema::Schema>,
    #[serde(default, skip_serializing_if = "metadata::Metadata::is_empty")]
    pub webmcp: metadata::Metadata,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Node {
    #[serde(default, skip_serializing_if = "metadata::Metadata::is_empty")]
    pub webmcp: metadata::Metadata,
    #[serde(default)]
    pub xtype: String,
    #[serde(default)]
    pub item_id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub layout: layouts::Layout,
    #[serde(default)]
    pub bind: String,
    #[serde(default)]
    pub selected_bind: String,
    #[serde(default)]
    pub disabled_bind: String,
    #[serde(default)]
    pub collapsed_bind: String,
    #[serde(default)]
    pub visible_bind: String,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub region: String,
    #[serde(default = "one_usize")]
    pub col_span: usize,
    #[serde(default)]
    pub active_item: usize,
    #[serde(default)]
    pub handler: String,
    #[serde(default)]
    pub variant: String,
    #[serde(default = "one")]
    pub flex: f64,
    #[serde(default)]
    #[serde(deserialize_with = "extras::deserialize_items")]
    pub items: Vec<Node>,
    #[serde(default)]
    pub items_bind: String,
    #[serde(default)]
    pub columns: extras::Columns,
    #[serde(default)]
    pub field_label: String,
    #[serde(default)]
    pub box_label: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub input_value: Value,
    #[serde(default)]
    pub checked: bool,
    #[serde(default)]
    pub empty_text: String,
    #[serde(default)]
    pub input_type: String,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default = "yes")]
    pub allow_blank: bool,
    #[serde(default)]
    pub min_length: Option<usize>,
    #[serde(default)]
    pub max_length: Option<usize>,
    #[serde(default)]
    pub min_value: Option<f64>,
    #[serde(default)]
    pub max_value: Option<f64>,
    #[serde(default = "one")]
    pub increment: f64,
    #[serde(default = "four")]
    pub rows: usize,
    #[serde(default = "five")]
    pub size: usize,
    #[serde(default)]
    pub multi_select: Option<bool>,
    #[serde(default)]
    pub options: Vec<Value>,
    #[serde(default)]
    pub store: Value,
    #[serde(default)]
    pub data: Vec<Value>,
    #[serde(default = "display_field")]
    pub display_field: String,
    #[serde(default = "value_field")]
    pub value_field: String,
    #[serde(default)]
    pub collapsible: bool,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub checkbox_toggle: bool,
    #[serde(default)]
    pub ui: String,
    #[serde(default)]
    pub page_size: usize,
    #[serde(default)]
    pub page_bind: String,
    #[serde(default)]
    pub sort_bind: String,
    #[serde(default)]
    pub filter_bind: String,
    #[serde(default)]
    pub editing_bind: String,
    #[serde(default)]
    pub active_tab: usize,
    #[serde(default)]
    pub active_bind: String,
    #[serde(default)]
    pub expanded_bind: String,
    #[serde(default)]
    pub open_bind: String,
    #[serde(default)]
    pub root: Value,
    #[serde(default)]
    pub root_visible: bool,
    #[serde(default)]
    pub children: Vec<Value>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub src: String,
    #[serde(default)]
    pub alt: String,
    #[serde(default)]
    pub url: String,
    #[serde(default, alias = "poster")]
    pub poster_url: String,
    #[serde(default)]
    pub autoplay: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub r#loop: bool,
    #[serde(default = "yes")]
    pub controls: bool,
    #[serde(default)]
    pub html: String,
    #[serde(default, alias = "msg")]
    pub message: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub icon_cls: String,
    #[serde(default)]
    pub prompt: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default = "yes")]
    pub closable: bool,
    #[serde(default)]
    pub buttons: Value,
    #[serde(default)]
    pub tbar: Value,
    #[serde(default)]
    pub bbar: Value,
    #[serde(default)]
    pub menu: Value,
    #[serde(default)]
    pub language: String,
    #[serde(default = "yes")]
    pub line_numbers: bool,
    #[serde(default)]
    pub original: String,
    #[serde(default = "yes")]
    pub side_by_side: bool,
    #[serde(default)]
    pub lines: Vec<String>,
    #[serde(default)]
    pub max_lines: Option<usize>,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub typing: bool,
    #[serde(default)]
    pub series: Value,
    #[serde(default)]
    pub sprites: Vec<Value>,
    #[serde(default)]
    pub branches: Vec<String>,
    #[serde(default)]
    pub commits: Vec<Value>,
    #[serde(default)]
    pub nodes: Vec<Value>,
    #[serde(default)]
    pub edges: Vec<Value>,
    #[serde(default = "yes")]
    pub show_today: bool,
    #[serde(default)]
    pub today_text: String,
    #[serde(default)]
    pub today: String,
    #[serde(default)]
    pub total: usize,
    #[serde(default = "yes")]
    pub display_info: bool,
    #[serde(default)]
    pub display_msg: String,
    #[serde(default)]
    pub empty_msg: String,
    #[serde(default)]
    pub align: String,
    #[serde(skip)]
    pub port_kind: String,
}

fn yes() -> bool {
    true
}
fn four() -> usize {
    4
}
fn five() -> usize {
    5
}
fn display_field() -> String {
    "text".into()
}
fn value_field() -> String {
    "value".into()
}

fn one() -> f64 {
    1.0
}
fn one_usize() -> usize {
    1
}

fn window_width() -> f64 {
    400.0
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Column {
    pub text: String,
    pub data_index: String,
    #[serde(default = "one")]
    pub flex: f64,
    #[serde(default = "yes")]
    pub sortable: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub align: String,
    #[serde(default)]
    pub editor: Option<Box<Node>>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Widget {
    pub layer: usize,
    pub key: String,
    pub target: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub text: String,
    pub value: String,
    pub variant: String,
    pub disabled: bool,
    pub selected: bool,
    pub cells: Vec<String>,
    pub fractions: Vec<f64>,
    pub payload: Value,
    pub config: Value,
}

#[derive(Serialize)]
pub struct Scene {
    #[serde(skip_serializing_if = "metadata::Metadata::is_empty")]
    pub webmcp: metadata::Metadata,
    #[serde(rename = "stateSchema", skip_serializing_if = "Option::is_none")]
    pub state_schema: Option<state_schema::Schema>,
    pub theme: Theme,
    pub width: f64,
    pub height: f64,
    pub widgets: Vec<Widget>,
    pub modal: Option<Modal>,
    pub popup: Option<Value>,
}

#[derive(Serialize)]
pub struct Modal {
    pub key: String,
    pub target: String,
    pub layer: usize,
}

pub struct Runtime {
    package: Package,
    ui: Node,
    functions: HashSet<String>,
    engine: Engine,
    ast: AST,
    state: Dynamic,
    http: http::Requests,
    storage: storage::Requests,
    files: files::Requests,
    rpc: rpc::Requests,
    pub revision: u32,
}

impl Runtime {
    pub fn load(package: Package, script: &str) -> Result<Self, String> {
        Self::load_with_extensions(package, script, |_| {})
    }

    /// Register application-specific native functions before compiling the downloaded script.
    pub fn load_with_extensions(
        package: Package,
        script: &str,
        register: impl FnOnce(&mut Engine),
    ) -> Result<Self, String> {
        Self::load_with_descriptors(package, script, HashMap::new(), register)
    }
    pub fn load_with_descriptors(
        mut package: Package,
        script: &str,
        descriptors: HashMap<String, Vec<u8>>,
        register: impl FnOnce(&mut Engine),
    ) -> Result<Self, String> {
        if package.version != 1 {
            return Err("Unsupported package version (expected 1)".into());
        }
        if !package.state.is_object() {
            return Err("Initial state must be an object".into());
        }
        package.webmcp.validate()?;
        if let Some(schema) = &package.state_schema {
            schema.definition()?;
            schema.validate(&package.state)?;
        }
        if script.len() > 100_000 {
            return Err("Script exceeds 100 KB".into());
        }
        fields::normalize(&mut package.ui, "root");
        validate(&package.ui, &mut HashSet::new(), &mut 0, 0)?;
        let initial_ui = dynamic_ui::resolve(&package.ui, &package.state)?;
        initialize_ui(&initial_ui, &mut package.state);
        if let Some(schema) = &package.state_schema {
            schema.bindings(&initial_ui)?;
            schema.validate(&package.state)?;
        }
        if package.ui.xtype == "window" {
            return Err("A window must be inside a container or panel".into());
        }
        let mut engine = Engine::new();
        extensions::register(&mut engine);
        let mut http = http::Requests::default();
        http.register(&mut engine);
        let mut storage = storage::Requests::default();
        storage.register(&mut engine);
        let mut files = files::Requests::default();
        files.register(&mut engine);
        let mut rpc = rpc::Requests::default();
        rpc.initialize(&package.rpc, descriptors)?;
        rpc.register(&mut engine);
        register(&mut engine);
        engine.set_max_operations(50_000);
        engine.set_max_call_levels(32);
        engine.set_max_expr_depths(64, 32);
        engine.set_max_array_size(10_000);
        engine.set_max_map_size(32_000);
        engine.set_max_string_size(100_000);
        let ast = engine
            .compile(script)
            .map_err(|e| format!("{}: {e}", package.script))?;
        let functions: HashSet<String> = ast.iter_functions().map(|f| f.name.to_owned()).collect();
        if !functions.contains("init") {
            return Err("Script must define init(state)".into());
        }
        validate_handlers(&initial_ui, &functions)?;
        if package.requests.len() > 8 {
            return Err("At most 8 HTTP request definitions".into());
        }
        for (name, request) in &package.requests {
            if name.is_empty()
                || name.len() > 80
                || request.url.is_empty()
                || request.url.len() > 2048
            {
                return Err("HTTP request needs a name and a URL of at most 2048 bytes".into());
            }
            if !functions.contains(&request.handler) {
                return Err(format!(
                    "HTTP request {name}: undefined handler {}",
                    request.handler
                ));
            }
        }
        if package.storage.len() > 8 {
            return Err("At most 8 storage definitions".into());
        }
        if !package.storage.is_empty() && !storage::safe_key(&package.id) {
            return Err(
                "Storage requires a page id with 1–80 ASCII letters, digits, - or _".into(),
            );
        }
        for (name, definition) in &package.storage {
            if !storage::safe_key(name) || !storage::safe_key(&definition.key) {
                return Err(
                    "Storage names and keys require 1–80 ASCII letters, digits, - or _".into(),
                );
            }
            if !functions.contains(&definition.handler) {
                return Err(format!(
                    "Storage request {name}: undefined handler {}",
                    definition.handler
                ));
            }
        }
        if package.files.len() > 8 {
            return Err("At most 8 file volumes".into());
        }
        if !package.files.is_empty() && !storage::safe_key(&package.id) {
            return Err("Files require a safe page id".into());
        }
        for (name, definition) in &package.files {
            if !storage::safe_key(name) {
                return Err("Invalid file volume name".into());
            }
            if !functions.contains(&definition.handler) {
                return Err(format!(
                    "File volume {name}: undefined handler {}",
                    definition.handler
                ));
            }
        }
        for (name, definition) in &package.rpc {
            if !functions.contains(&definition.handler) {
                return Err(format!(
                    "RPC {name}: undefined handler {}",
                    definition.handler
                ));
            }
        }
        let state = rhai::serde::to_dynamic(&package.state).map_err(|e| e.to_string())?;
        let state: Dynamic = engine
            .call_fn(&mut Scope::new(), &ast, "init", (state,))
            .map_err(|e| format!("{} / init: {e}", package.script))?;
        check_state(&state)?;
        let mut initial: Value = rhai::serde::from_dynamic(&state).map_err(|e| e.to_string())?;
        let ui = dynamic_ui::resolve(&package.ui, &initial)?;
        validate_handlers(&ui, &functions)?;
        dynamic_ui::initialize_added(&initial_ui, &ui, &mut initial);
        let ui = dynamic_ui::resolve(&package.ui, &initial)?;
        validate_handlers(&ui, &functions)?;
        validate_ui_state(&ui, &initial)?;
        if let Some(schema) = &package.state_schema {
            schema.bindings(&ui)?;
            schema.validate(&initial)?;
        }
        let state = rhai::serde::to_dynamic(initial).map_err(|e| e.to_string())?;
        check_state(&state)?;
        let names = http.prepare(&package.requests)?;
        let intents = storage.prepare(&package.storage)?;
        let file_intents = files.prepare(&package.files)?;
        let rpc_intents = rpc.prepare()?;
        let (file_bytes, file_count) = files::Requests::size(&file_intents);
        let (rpc_bytes, rpc_count) = rpc::Requests::size(&rpc_intents);
        buffers::capacity(file_bytes + rpc_bytes, file_count + rpc_count)?;
        http.commit(names, &package.requests);
        storage.commit(intents, &package.storage);
        files.commit(file_intents);
        rpc.commit(rpc_intents, &package.rpc);
        Ok(Self {
            package,
            ui,
            functions,
            engine,
            ast,
            state,
            http,
            storage,
            files,
            rpc,
            revision: 0,
        })
    }

    pub fn dispatch(&mut self, target: &str, mut payload: Value) -> Result<(), String> {
        self.http.clear();
        self.storage.clear();
        self.files.clear();
        self.rpc.clear();
        let mut state = self.state_json()?;
        let mut path = Vec::new();
        if !find_path(&self.ui, target, &mut path) {
            return Err(format!("Unknown itemId: {target}"));
        }
        let node = *path.last().unwrap();
        let mut windows = Vec::new();
        collect_windows(&self.ui, &state, &mut windows);
        let scope = path.iter().rev().find(|n| n.xtype == "window");
        if windows
            .last()
            .is_some_and(|w| scope.map(|n| n.item_id.as_str()) != Some(w.item_id.as_str()))
            || path.iter().any(|n| {
                (!n.disabled_bind.is_empty() && flag(&state, &n.disabled_bind))
                    || n.disabled
                    || (n.xtype == "window" && !flag(&state, &n.visible_bind))
                    || (n.item_id != target && is_panel(n) && flag(&state, &n.collapsed_bind))
            })
            || navigation::hidden(&path, &state)
            || extras::hidden(&path, &state)
            || layouts::hidden(&path, &state)
        {
            return Ok(());
        }
        let action = payload
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        if fields::input(node) && node.read_only {
            return Ok(());
        }
        navigation::close_other_menus(&self.ui, &mut state, &path);
        if extras::event_component(node) {
            extras::event(node, &path, &mut state, &mut payload)?;
        } else if grid::advanced(node) {
            grid::event(node, &mut state, &mut payload)?;
        } else if navigation::component(node) {
            navigation::event(node, &mut state, &payload)?;
        } else if node.layout == "card" && action == "card" {
            layouts::event(node, &mut state, &payload)?;
        } else if is_panel(node) {
            if action != "toggle" || node.collapsed_bind.is_empty() {
                return Err("Panel event requires action: toggle and collapsedBind".into());
            }
            let collapsed = !flag(&state, &node.collapsed_bind);
            state
                .as_object_mut()
                .unwrap()
                .insert(node.collapsed_bind.clone(), json!(collapsed));
            extras::accordion(&path, &mut state);
        } else if node.xtype == "window" {
            if !node.closable {
                return Err("Window cannot be closed".into());
            }
            if action != "close" {
                return Err("Window event requires action: close".into());
            }
            state
                .as_object_mut()
                .unwrap()
                .insert(node.visible_bind.clone(), json!(false));
        } else if node.layout == "card" {
            return Err("Card event requires action: card".into());
        } else if !fields::input(node) && !["button", "grid"].contains(&node.xtype.as_str()) {
            return Err("This component does not accept events".into());
        }
        let event_value = if fields::input(node) {
            Some(fields::event_value(
                node,
                payload.get("value").unwrap_or(&Value::Null),
            )?)
        } else {
            None
        };
        if let Some(value) = &event_value {
            state
                .as_object_mut()
                .ok_or("State must be an object")?
                .insert(node.bind.clone(), value.clone());
        }
        let mut next = rhai::serde::to_dynamic(state).map_err(|e| e.to_string())?;
        if !node.handler.is_empty() {
            let event = rhai::serde::to_dynamic(json!({ "target": target, "action": action, "value": event_value.unwrap_or_else(|| payload.get("value").cloned().unwrap_or(Value::Null)), "id": payload.get("id").cloned().unwrap_or(Value::Null), "column": payload.get("column").cloned().unwrap_or(Value::Null), "oldValue": payload.get("oldValue").cloned().unwrap_or(Value::Null) }))
                .map_err(|e| e.to_string())?;
            next = self
                .engine
                .call_fn(&mut Scope::new(), &self.ast, &node.handler, (next, event))
                .map_err(|e| {
                    format!(
                        "{} / {} / {}: {e}",
                        self.package.script, target, node.handler
                    )
                })?;
        }
        self.commit_state(next)
    }

    pub fn complete_http(&mut self, id: u64, response: Value) -> Result<(), String> {
        let name = self.http.consume(id)?;
        self.http.clear();
        self.storage.clear();
        self.files.clear();
        self.rpc.clear();
        let handler = &self.package.requests[&name].handler;
        let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
        // Use current state, including edits made while the HTTP request was in flight.
        let next = self
            .engine
            .call_fn(
                &mut Scope::new(),
                &self.ast,
                handler,
                (self.state.clone(), response),
            )
            .map_err(|e| format!("{} / HTTP {} / {}: {e}", self.package.script, name, handler))?;
        self.commit_state(next)
    }

    pub fn complete_storage(&mut self, id: u64, mut response: Value) -> Result<(), String> {
        let (name, operation) = self.storage.consume(id)?;
        self.http.clear();
        self.storage.clear();
        self.files.clear();
        self.rpc.clear();
        response["operation"] = serde_json::to_value(operation).map_err(|e| e.to_string())?;
        response["request"] = json!(name);
        let handler = &self.package.storage[&name].handler;
        let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
        let next = self
            .engine
            .call_fn(
                &mut Scope::new(),
                &self.ast,
                handler,
                (self.state.clone(), response),
            )
            .map_err(|e| {
                format!(
                    "{} / storage {} / {}: {e}",
                    self.package.script, name, handler
                )
            })?;
        self.commit_state(next)
    }

    pub fn complete_file(
        &mut self,
        id: u64,
        response: Value,
        buffer: Option<u32>,
    ) -> Result<(), String> {
        self.http.clear();
        self.storage.clear();
        self.files.clear();
        self.rpc.clear();
        let mut response: rhai::Map = rhai::serde::to_dynamic(response)
            .map_err(|e| e.to_string())?
            .cast();
        let name = self.files.consume(id, &mut response, buffer)?;
        let handler = &self.package.files[&name].handler;
        let next = self
            .engine
            .call_fn(
                &mut Scope::new(),
                &self.ast,
                handler,
                (self.state.clone(), Dynamic::from_map(response)),
            )
            .map_err(|e| format!("{} / file {} / {}: {e}", self.package.script, name, handler))?;
        self.commit_state(next)
    }

    pub fn complete_rpc(
        &mut self,
        id: u64,
        mut response: Value,
        buffer: Option<u32>,
    ) -> Result<(), String> {
        self.http.clear();
        self.storage.clear();
        self.files.clear();
        self.rpc.clear();
        let name = self.rpc.consume(id, &mut response, buffer)?;
        let handler = &self.package.rpc[&name].handler;
        let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
        let next = self
            .engine
            .call_fn(
                &mut Scope::new(),
                &self.ast,
                handler,
                (self.state.clone(), response),
            )
            .map_err(|e| format!("{} / RPC {} / {}: {e}", self.package.script, name, handler))?;
        self.commit_state(next)
    }
    pub fn take_effects(&mut self) -> Vec<Value> {
        self.http
            .take()
            .into_iter()
            .map(|effect| serde_json::to_value(effect).unwrap())
            .chain(
                self.storage
                    .take()
                    .into_iter()
                    .map(|effect| serde_json::to_value(effect).unwrap()),
            )
            .chain(self.files.take())
            .chain(self.rpc.take())
            .collect()
    }

    fn commit_state(&mut self, mut next: Dynamic) -> Result<(), String> {
        // Commit only after successful execution and serialization. Failed handlers preserve the old state.
        let mut candidate: Value = rhai::serde::from_dynamic(&next).map_err(|e| e.to_string())?;
        if !candidate.is_object() {
            return Err("Handler must return a state object".into());
        }
        check_state(&next)?;
        let ui = dynamic_ui::resolve(&self.package.ui, &candidate)?;
        validate_handlers(&ui, &self.functions)?;
        dynamic_ui::initialize_added(&self.ui, &ui, &mut candidate);
        grid::reconcile(&ui, &self.state_json()?, &mut candidate);
        // Built-in defaults/reconciliation can also touch bindings. Resolve the final state,
        // so the committed component tree always describes exactly the committed data.
        let ui = dynamic_ui::resolve(&self.package.ui, &candidate)?;
        validate_handlers(&ui, &self.functions)?;
        validate_ui_state(&ui, &candidate)?;
        if let Some(schema) = &self.package.state_schema {
            schema.bindings(&ui)?;
            schema.validate(&candidate)?;
        }
        next = rhai::serde::to_dynamic(candidate).map_err(|e| e.to_string())?;
        check_state(&next)?;
        let names = self.http.prepare(&self.package.requests)?;
        let intents = self.storage.prepare(&self.package.storage)?;
        let file_intents = self.files.prepare(&self.package.files)?;
        let rpc_intents = self.rpc.prepare()?;
        let (file_bytes, file_count) = files::Requests::size(&file_intents);
        let (rpc_bytes, rpc_count) = rpc::Requests::size(&rpc_intents);
        buffers::capacity(file_bytes + rpc_bytes, file_count + rpc_count)?;
        self.state = next;
        self.ui = ui;
        self.http.commit(names, &self.package.requests);
        self.storage.commit(intents, &self.package.storage);
        self.files.commit(file_intents);
        self.rpc.commit(rpc_intents, &self.package.rpc);
        self.revision += 1;
        Ok(())
    }

    pub fn state_json(&self) -> Result<Value, String> {
        rhai::serde::from_dynamic(&self.state).map_err(|e| e.to_string())
    }

    pub fn layout(&self, width: f64) -> Result<Scene, String> {
        if !width.is_finite() || !(240.0..=4096.0).contains(&width) {
            return Err("Viewport width must be between 240 and 4096".into());
        }
        let state = self.state_json()?;
        let mut widgets = Vec::new();
        let mut windows = Vec::new();
        collect_windows(&self.ui, &state, &mut windows);
        let mut height = windows
            .iter()
            .fold(measure(&self.ui, &state, width - 32.0) + 32.0, |h, n| {
                h.max(
                    (content_height(
                        n,
                        &state,
                        n.width.unwrap_or(window_width()).min(width - 32.0) - 28.0,
                    ) + 56.0)
                        .max(n.height.unwrap_or(0.0))
                        + 32.0,
                )
            })
            .max(if windows.is_empty() { 0.0 } else { 320.0 });
        arrange(
            &self.ui,
            &state,
            16.0,
            16.0,
            width - 32.0,
            "root",
            &mut widgets,
        );
        let mut modal = None;
        for (i, node) in windows.iter().enumerate() {
            let layer = i + 1;
            let ww = node.width.unwrap_or(window_width()).min(width - 32.0);
            let wh =
                (content_height(node, &state, ww - 28.0) + 56.0).max(node.height.unwrap_or(0.0));
            let x = (width - ww) / 2.0;
            let y = (height - wh) / 2.0;
            let start = widgets.len();
            let mut backdrop = widget(
                node,
                "backdrop",
                0.0,
                0.0,
                width,
                height,
                &format!("{}:backdrop", node.item_id),
            );
            backdrop.text.clear();
            widgets.push(backdrop);
            let mut shell = widget(node, "window", x, y, ww, wh, &node.item_id);
            shell.text = node.title.clone();
            widgets.push(shell);
            let mut close = widget(
                node,
                "window-close",
                x + ww - 42.0,
                y + 6.0,
                32.0,
                30.0,
                &format!("{}:close", node.item_id),
            );
            close.text = "×".into();
            close.payload = json!({ "action": "close" });
            if node.closable {
                widgets.push(close);
            }
            arrange_children_sized(
                node,
                &state,
                x + 14.0,
                y + 42.0,
                ww - 28.0,
                wh - 56.0,
                &node.item_id,
                &mut widgets,
            );
            let mut path = Vec::new();
            find_path(&self.ui, &node.item_id, &mut path);
            let disabled = path
                .iter()
                .any(|n| n.disabled || flag(&state, &n.disabled_bind));
            for w in &mut widgets[start..] {
                w.layer = layer;
                w.disabled |= disabled;
            }
            modal = Some(Modal {
                key: node.item_id.clone(),
                target: node.item_id.clone(),
                layer,
            });
        }
        if let Some(m) = &modal {
            for w in &mut widgets {
                if w.layer != m.layer {
                    w.disabled = true;
                }
            }
        }
        height = widgets
            .iter()
            .filter(|w| w.kind == "menu-surface")
            .fold(height, |h, w| h.max(w.y + w.height + 16.0));
        for w in &mut widgets {
            if w.kind == "backdrop" {
                w.height = height;
            }
        }
        widgets.sort_by_key(|w| {
            (
                w.layer,
                w.config
                    .get("popup")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
        });
        let popup = widgets
            .iter()
            .rev()
            .find(|w| w.kind == "menu-surface" && !w.disabled)
            .map(|w| json!({"target":w.target,"layer":w.layer}));
        for widget in &mut widgets {
            let mut path = Vec::new();
            if find_path(&self.ui, &widget.target, &mut path) {
                let metadata = &path.last().unwrap().webmcp;
                if !metadata.is_empty() {
                    widget.config["webmcp"] =
                        serde_json::to_value(metadata).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(Scene {
            webmcp: self.package.webmcp.clone(),
            state_schema: self.package.state_schema.clone(),
            theme: theme::current(),
            width,
            height,
            widgets,
            modal,
            popup,
        })
    }
}

fn initialize_ui(ui: &Node, state: &mut Value) {
    fields::initialize(ui, state);
    grid::initialize(ui, state);
    navigation::initialize(ui, state);
    extras::initialize(ui, state);
    layouts::initialize(ui, state);
}

fn validate_ui_state(ui: &Node, state: &Value) -> Result<(), String> {
    grid::validate_state(ui, state)?;
    navigation::validate_state(ui, state)?;
    extras::validate_state(ui, state)?;
    layouts::validate_state(ui, state)
}

fn check_state(state: &Dynamic) -> Result<(), String> {
    let value: Value = rhai::serde::from_dynamic(state).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Handler must return a state object".into());
    }
    if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 1_000_000 {
        return Err("State exceeds 1 MB".into());
    }
    Ok(())
}

fn validate(
    node: &Node,
    ids: &mut HashSet<String>,
    count: &mut usize,
    depth: usize,
) -> Result<(), String> {
    node.webmcp.validate()?;
    *count += 1;
    if *count > 200 || depth > 20 {
        return Err("UI exceeds 200 nodes or 20 nesting levels".into());
    }
    if ![
        "container",
        "panel",
        "window",
        "label",
        "metric",
        "textfield",
        "textarea",
        "numberfield",
        "datefield",
        "checkbox",
        "radio",
        "combobox",
        "listbox",
        "displayfield",
        "slider",
        "progressbar",
        "fieldset",
        "button",
        "grid",
        "tabpanel",
        "treepanel",
        "menu",
        "menuseparator",
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
    .contains(&node.xtype.as_str())
    {
        return Err(format!("Unknown xtype: {}", node.xtype));
    }
    if !node.flex.is_finite() || node.flex <= 0.0 {
        return Err("flex must be positive".into());
    }
    if !node.item_id.is_empty() && !ids.insert(node.item_id.clone()) {
        return Err(format!("Duplicate itemId: {}", node.item_id));
    }
    if node.item_id.contains(':') {
        return Err("itemId must not contain ':' (reserved for internal widget keys)".into());
    }
    dynamic_ui::validate(node)?;
    if ["textfield", "button", "grid"].contains(&node.xtype.as_str()) && node.item_id.is_empty() {
        return Err(format!("{} requires itemId", node.xtype));
    }
    if !node.collapsed_bind.is_empty()
        && (!is_panel(node) || node.item_id.is_empty() || node.collapsed_bind.contains('.'))
    {
        return Err("collapsedBind requires a panel with itemId and a top-level binding".into());
    }
    if node.xtype == "window"
        && (node.item_id.is_empty()
            || node.visible_bind.is_empty()
            || node.visible_bind.contains('.')
            || !node.width.unwrap_or(window_width()).is_finite()
            || !(240.0..=1200.0).contains(&node.width.unwrap_or(window_width())))
    {
        return Err(
            "window requires itemId, top-level visibleBind, and width between 240 and 1200".into(),
        );
    }
    if !["window", "toast"].contains(&node.xtype.as_str()) && !node.visible_bind.is_empty() {
        return Err("visibleBind is supported only on window".into());
    }
    if fields::input(node) && (node.bind.is_empty() || node.bind.contains('.')) {
        return Err("Input fields require a top-level state binding".into());
    }
    fields::validate(node)?;
    grid::validate(node)?;
    navigation::validate(node)?;
    extras::validate(node)?;
    layouts::validate(node)?;
    if node.xtype == "grid"
        && (node.columns.is_empty()
            || node
                .columns
                .iter()
                .any(|c| !c.flex.is_finite() || c.flex <= 0.0))
    {
        return Err("grid requires columns with positive flex".into());
    }
    for child in &node.items {
        validate(child, ids, count, depth + 1)?;
    }
    Ok(())
}

fn validate_handlers(node: &Node, functions: &HashSet<String>) -> Result<(), String> {
    if !node.handler.is_empty() && !functions.contains(&node.handler) {
        return Err(format!(
            "{} references undefined handler: {}",
            node.item_id, node.handler
        ));
    }
    for child in &node.items {
        validate_handlers(child, functions)?;
    }
    Ok(())
}

fn find_path<'a>(node: &'a Node, id: &str, path: &mut Vec<&'a Node>) -> bool {
    path.push(node);
    if node.item_id == id {
        return true;
    }
    for child in &node.items {
        if find_path(child, id, path) {
            return true;
        }
    }
    path.pop();
    false
}

fn flag(state: &Value, path: &str) -> bool {
    !path.is_empty() && lookup(state, path).as_bool() == Some(true)
}

fn is_panel(node: &Node) -> bool {
    ["panel", "fieldset"].contains(&node.xtype.as_str())
}

fn collect_windows<'a>(node: &'a Node, state: &Value, windows: &mut Vec<&'a Node>) {
    if node.xtype == "window" {
        if !flag(state, &node.visible_bind) {
            return;
        }
        windows.push(node);
    }
    if is_panel(node) && flag(state, &node.collapsed_bind) {
        return;
    }
    if node.xtype == "tabpanel" {
        if let Some(child) = node.items.get(navigation::active(node, state)) {
            collect_windows(child, state, windows);
        }
        return;
    }
    if node.layout == "card" {
        if let Some(child) = node.items.get(layouts::active(node, state)) {
            collect_windows(child, state, windows);
        }
        return;
    }
    for child in &node.items {
        collect_windows(child, state, windows);
    }
}

fn lookup<'a>(state: &'a Value, path: &str) -> &'a Value {
    path.split('.')
        .fold(state, |value, key| value.get(key).unwrap_or(&Value::Null))
}

fn display(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        _ => value.to_string(),
    }
}

fn content_height(node: &Node, state: &Value, width: f64) -> f64 {
    layouts::natural_height(node, state, width)
}

fn measure(node: &Node, state: &Value, width: f64) -> f64 {
    if extras::component(node) {
        return extras::height(node, state, width);
    }
    if grid::advanced(node) {
        return grid::height(node, state);
    }
    if navigation::component(node) {
        return navigation::height(node, state, width);
    }
    match node.xtype.as_str() {
        "window" => 0.0,
        "container" | "panel" | "fieldset" => {
            if is_panel(node) && flag(state, &node.collapsed_bind) {
                return 42.0;
            }
            let inset = if is_panel(node) {
                14.0_f64.min(width / 4.0)
            } else {
                0.0
            };
            (content_height(node, state, (width - 2.0 * inset).max(0.0))
                + if is_panel(node) { 56.0 } else { 0.0 })
            .max(node.height.unwrap_or(0.0))
        }
        "metric" => 82.0,
        "textfield" | "numberfield" | "datefield" | "combobox" | "displayfield" | "slider" => 62.0,
        "textarea" => 24.0 + node.rows as f64 * 20.0 + 16.0,
        "listbox" => 24.0 + node.size as f64 * 28.0 + 2.0,
        "checkbox" | "radio" => {
            if node.field_label.is_empty() {
                38.0
            } else {
                62.0
            }
        }
        "progressbar" => 30.0,
        "grid" => {
            38.0 + 42.0
                * lookup(state, &node.bind)
                    .as_array()
                    .map_or(1, |v| v.len().clamp(1, 100)) as f64
        }
        "button" => 38.0,
        _ => 24.0,
    }
}

fn widget(node: &Node, kind: &str, x: f64, y: f64, width: f64, height: f64, key: &str) -> Widget {
    Widget {
        layer: 0,
        key: key.into(),
        target: node.item_id.clone(),
        kind: kind.into(),
        x,
        y,
        width,
        height,
        text: node.text.clone(),
        value: String::new(),
        variant: node.variant.clone(),
        disabled: false,
        selected: false,
        cells: Vec::new(),
        fractions: Vec::new(),
        payload: json!({}),
        config: json!({}),
    }
}

fn arrange(
    node: &Node,
    state: &Value,
    x: f64,
    y: f64,
    width: f64,
    key: &str,
    widgets: &mut Vec<Widget>,
) {
    arrange_sized(node, state, x, y, width, key, None, widgets)
}
fn arrange_sized(
    node: &Node,
    state: &Value,
    x: f64,
    y: f64,
    width: f64,
    key: &str,
    allocated_height: Option<f64>,
    widgets: &mut Vec<Widget>,
) {
    if extras::component(node) {
        extras::arrange(node, state, x, y, width, key, widgets);
        return;
    }
    if grid::advanced(node) {
        grid::arrange(node, state, x, y, width, key, widgets);
        return;
    }
    if navigation::component(node) {
        navigation::arrange(node, state, x, y, width, key, widgets);
        return;
    }
    let height = measure(node, state, width).max(allocated_height.unwrap_or(0.0));
    match node.xtype.as_str() {
        "window" => {}
        "container" | "panel" | "fieldset" => {
            let panel = is_panel(node);
            let (cx, cy, cw) = if panel {
                let mut w = widget(node, &node.xtype, x, y, width, height, key);
                w.text = if node.collapsed_bind.is_empty() {
                    node.title.clone()
                } else {
                    String::new()
                };
                widgets.push(w);
                if !node.collapsed_bind.is_empty() {
                    let mut toggle = widget(
                        node,
                        "panel-toggle",
                        x + 1.0,
                        y + 1.0,
                        width - 2.0,
                        40.0,
                        &format!("{key}:toggle"),
                    );
                    toggle.selected = flag(state, &node.collapsed_bind);
                    toggle.text =
                        format!("{} {}", if toggle.selected { "▸" } else { "▾" }, node.title);
                    toggle.disabled = node.disabled || flag(state, &node.disabled_bind);
                    toggle.payload = json!({ "action": "toggle" });
                    widgets.push(toggle);
                    if flag(state, &node.collapsed_bind) {
                        return;
                    }
                }
                let inset = 14.0_f64.min(width / 4.0);
                (x + inset, y + 42.0, (width - 2.0 * inset).max(0.0))
            } else {
                (x, y, width)
            };
            let body_height = height - if panel { 56.0 } else { 0.0 };
            arrange_children_sized(node, state, cx, cy, cw, body_height, key, widgets);
        }
        "grid" => {
            let total: f64 = node.columns.iter().map(|c| c.flex).sum();
            let fractions: Vec<f64> = node.columns.iter().map(|c| c.flex / total).collect();
            let mut header = widget(
                node,
                "grid-header",
                x,
                y,
                width,
                38.0,
                &format!("{key}:header"),
            );
            header.cells = node.columns.iter().map(|c| c.text.clone()).collect();
            header.fractions = fractions.clone();
            widgets.push(header);
            if let Some(rows) = lookup(state, &node.bind)
                .as_array()
                .filter(|r| !r.is_empty())
            {
                for (i, row) in rows.iter().take(100).enumerate() {
                    let mut w = widget(
                        node,
                        "row",
                        x,
                        y + 38.0 + i as f64 * 42.0,
                        width,
                        42.0,
                        &format!("{key}:row:{i}"),
                    );
                    w.cells = node
                        .columns
                        .iter()
                        .map(|c| display(lookup(row, &c.data_index)))
                        .collect();
                    w.fractions = fractions.clone();
                    w.disabled = node.disabled
                        || !node.disabled_bind.is_empty()
                            && lookup(state, &node.disabled_bind).as_bool() == Some(true);
                    w.payload = json!({ "id": row.get("id").unwrap_or(&Value::Null) });
                    w.selected = row
                        .get("id")
                        .is_some_and(|id| id == lookup(state, &node.selected_bind));
                    widgets.push(w);
                }
            } else {
                let mut w = widget(
                    node,
                    "empty",
                    x,
                    y + 38.0,
                    width,
                    42.0,
                    &format!("{key}:empty"),
                );
                w.text = "一致する項目はありません".into();
                widgets.push(w);
            }
        }
        kind => {
            let mut w = widget(node, kind, x, y, width, height, key);
            if !node.bind.is_empty() {
                w.value = display(lookup(state, &node.bind));
            }
            if kind == "label" && !node.bind.is_empty() {
                w.text = w.value.clone();
            }
            w.disabled = node.disabled
                || !node.disabled_bind.is_empty()
                    && lookup(state, &node.disabled_bind).as_bool() == Some(true);
            fields::configure(node, state, &mut w);
            widgets.push(w);
        }
    }
}

fn arrange_children(
    node: &Node,
    state: &Value,
    x: f64,
    y: f64,
    width: f64,
    key: &str,
    widgets: &mut Vec<Widget>,
) {
    arrange_children_sized(
        node,
        state,
        x,
        y,
        width,
        content_height(node, state, width),
        key,
        widgets,
    );
}
fn arrange_children_sized(
    node: &Node,
    state: &Value,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    key: &str,
    widgets: &mut Vec<Widget>,
) {
    let start = widgets.len();
    layouts::describe_card(node, state, x, y, width, height, key, widgets);
    for slot in layouts::slots(node, state, width, height) {
        let i = slot.index;
        let child = &node.items[i];
        let child_key = if child.item_id.is_empty() {
            format!("{key}.{i}")
        } else {
            child.item_id.clone()
        };
        let stretch = ["grid", "card", "border", "fit"].contains(&node.layout.as_str());
        arrange_sized(
            child,
            state,
            x + slot.x,
            y + slot.y,
            slot.width,
            &child_key,
            if stretch { Some(slot.height) } else { None },
            widgets,
        );
    }
    if node.disabled || flag(state, &node.disabled_bind) {
        for w in &mut widgets[start..] {
            w.disabled = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo() -> Package {
        serde_json::from_str(include_str!("../../public/screens/orders.json")).unwrap()
    }
    const SCRIPT: &str = include_str!("../../public/screens/orders.rhai");

    #[test]
    fn downloaded_screen_scripts_filter_select_and_save() {
        let mut runtime = Runtime::load(demo(), SCRIPT).unwrap();
        runtime.dispatch("search", json!({"value":"山田"})).unwrap();
        assert_eq!(
            runtime.state_json().unwrap()["visible"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        runtime.dispatch("search", json!({"value":""})).unwrap();
        runtime.dispatch("orders", json!({"id":2})).unwrap();
        runtime
            .dispatch("customer", json!({"value":"更新された顧客"}))
            .unwrap();
        runtime.dispatch("save", json!({})).unwrap();
        assert_eq!(
            runtime.state_json().unwrap()["orders"][1]["customer"],
            "更新された顧客"
        );
        assert!(runtime
            .layout(500.0)
            .unwrap()
            .widgets
            .iter()
            .any(|w| w.selected));
    }

    #[test]
    fn bad_scripts_and_unknown_widgets_are_rejected() {
        assert!(Runtime::load(demo(), "fn init(").is_err());
        assert!(Runtime::load(demo(), "fn init(s) { s }").is_err());
        let mut package = demo();
        package.ui.xtype = "unknown".into();
        assert!(Runtime::load(package, SCRIPT).is_err());
    }

    // A failed or runaway handler cannot commit partial state changes.
    #[test]
    fn event_failure_rolls_back_and_execution_is_bounded() {
        let script = format!("{SCRIPT}\nfn fail(s, e) {{ s.query = \"bad\"; while true {{}} s }}");
        let mut package = demo();
        package.ui.items.push(
            serde_json::from_value(json!({"xtype":"button", "itemId":"fail", "handler":"fail"}))
                .unwrap(),
        );
        let mut runtime = Runtime::load(package, &script).unwrap();
        let before = runtime.state_json().unwrap();
        assert!(runtime
            .dispatch("fail", json!({}))
            .unwrap_err()
            .contains("operations"));
        assert_eq!(runtime.state_json().unwrap(), before);
    }
}
