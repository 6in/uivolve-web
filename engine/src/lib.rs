use rhai::{Dynamic, Engine, Scope, AST};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::rc::Rc;
mod abi;
pub use abi::{input_alloc, input_free, request, response_len};
mod theme;
use theme::Theme;
mod buffers;
mod composition;
#[cfg(test)]
mod composition_tests;
mod dialogs;
mod dynamic_ui;
pub mod extensions;
mod extras;
mod fields;
mod figures;
mod files;
pub use files::FileBytes;
mod grid;
mod host;
mod http;
mod instance;
mod kanban;
mod layouts;
mod metadata;
mod navigation;
mod pages;
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
    pub operations: HashMap<String, host::Operation>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub pages: HashMap<String, pages::Definition>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub storage: HashMap<String, storage::Definition>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub files: HashMap<String, files::Definition>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub rpc: HashMap<String, rpc::Definition>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub components: BTreeMap<String, composition::Declaration>,
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
    /// Configuration a component node hands to its child package (`composition`).
    #[serde(default)]
    pub config: Value,
    /// Emit name -> parent handler, for component nodes (`composition`).
    #[serde(default)]
    pub listeners: BTreeMap<String, String>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lanes: Vec<kanban::Lane>,
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
    pub dialog: Option<Value>,
}

#[derive(Serialize)]
pub struct Modal {
    pub key: String,
    pub target: String,
    pub layer: usize,
}

pub struct Runtime {
    root: instance::Instance,
    /// The component instances of the screen, keyed by prefixed itemId path (`"a"`, `"a/b"`).
    /// Ordered so that children commit and report failures in the same order every run.
    components: BTreeMap<String, instance::Instance>,
    dialogs: dialogs::Requests,
    pages: pages::Requests,
    pub revision: u32,
}

/// The response of one effect, on its way back to the instance that queued it. `Runtime` takes
/// the instance path next to it, so the host answers an effect with the two things the effect
/// itself carried: its `instance` and its `id`.
pub enum Completion {
    Http {
        id: u64,
        response: Value,
    },
    Storage {
        id: u64,
        response: Value,
    },
    File {
        id: u64,
        response: Value,
        buffer: Option<u32>,
    },
    Rpc {
        id: u64,
        response: Value,
        buffer: Option<u32>,
    },
    Host {
        id: u64,
        response: Value,
    },
    HostProgress {
        id: u64,
        data: Value,
    },
    Dialog {
        id: u64,
        response: Value,
    },
}

/// What the five own channels of one instance queued during a handler, checked by `prepare` and
/// waiting for the whole screen to pass before any of them is committed.
struct Queued {
    http: Vec<String>,
    host: Vec<host::Intent>,
    storage: Vec<storage::Intent>,
    files: Vec<files::Intent>,
    rpc: Vec<rpc::Intent>,
}

impl Queued {
    fn is_empty(&self) -> bool {
        self.http.is_empty()
            && self.host.is_empty()
            && self.storage.is_empty()
            && self.files.is_empty()
            && self.rpc.is_empty()
    }

    /// The binary bytes and buffer count this instance would hand out, for the screen-wide
    /// budget `buffers::capacity` enforces across every instance together.
    fn size(&self) -> (usize, usize) {
        let (file_bytes, file_count) = files::Requests::size(&self.files);
        let (rpc_bytes, rpc_count) = rpc::Requests::size(&self.rpc);
        (file_bytes + rpc_bytes, file_count + rpc_count)
    }
}

/// Everything a component package needs to become an instance: what `load_with_bundle` is
/// handed for each declaration URL of the screen.
pub struct Bundle {
    pub package: Package,
    pub script: String,
    /// RPC descriptors by the name the `rpc` definitions of this package reference.
    pub descriptors: HashMap<String, Vec<u8>>,
}

/// The state a component load carries across the levels of the instance tree.
struct Composing<'a> {
    /// Child packages by declaration URL. The same package placed twice is bundled once.
    bundled: &'a HashMap<String, Bundle>,
    context: &'a extensions::ExtensionContext,
    dialogs: &'a mut dialogs::Requests,
    pages: &'a pages::Requests,
    /// The id of the root package: the head of the storage scope of every instance below it.
    root_id: String,
    /// URLs of the instances between the root and the one being loaded.
    loading: Vec<String>,
    loaded: BTreeMap<String, instance::Instance>,
    /// Instances loaded so far, the root included.
    count: usize,
}

impl Composing<'_> {
    /// Load the component nodes of `parent` in document order, each with its own config, and
    /// recurse into the components they declare in turn.
    fn load(
        &mut self,
        parent: &instance::Instance,
        prefix: &str,
        depth: usize,
    ) -> Result<(), String> {
        let mut nodes = Vec::new();
        composition::component_nodes(&parent.package.ui, &mut nodes);
        if nodes.is_empty() {
            return Ok(());
        }
        let state = parent.state_json()?;
        for node in nodes {
            let path = match prefix.is_empty() {
                true => node.item_id.clone(),
                false => format!("{prefix}/{}", node.item_id),
            };
            if depth + 1 > 3 {
                return Err(format!("Component {path}: nesting depth exceeds 3"));
            }
            self.count += 1;
            if self.count > 8 {
                return Err(format!(
                    "At most 8 instances per screen (root included); exceeded at component {path}"
                ));
            }
            let url = &parent
                .package
                .components
                .get(&node.xtype)
                .ok_or_else(|| format!("Component {path}: {} is not declared", node.xtype))?
                .url;
            if self.loading.contains(url) {
                return Err(format!("Component {path}: circular reference to {url}"));
            }
            let config = composition::evaluate_config(node, &state)
                .map_err(|error| format!("Component {path}: {error}"))?;
            let bundle = self
                .bundled
                .get(url)
                .ok_or_else(|| format!("Component {path}: package {url} was not bundled"))?;
            let url = url.clone();
            let mut package = bundle.package.clone();
            // `init` reads the parent's configuration from `state.config`; the `config` handler
            // only runs for the changes that follow.
            let Some(state) = package.state.as_object_mut() else {
                return Err(format!("Component {path}: Initial state must be an object"));
            };
            state.insert("config".into(), config);
            // A child keying host effects of its own has to be told apart from every other
            // placement, so its path has to compose a scope.
            if !package.storage.is_empty() || !package.files.is_empty() {
                composition::component_scope(&self.root_id, &path)
                    .map_err(|error| format!("Component {path}: {error}"))?;
            }
            // The same package placed twice gets its own copy: `rpc.initialize` consumes them.
            let child = instance::Instance::load(
                package,
                &bundle.script,
                bundle.descriptors.clone(),
                self.context,
                None,
                &path,
                |_| {},
                self.dialogs,
                self.pages,
            )
            .map_err(|error| format!("Component {path}: {error}"))?;
            self.loading.push(url);
            self.load(&child, &path, depth + 1)?;
            self.loading.pop();
            self.loaded.insert(path, child);
        }
        Ok(())
    }
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
        package: Package,
        script: &str,
        descriptors: HashMap<String, Vec<u8>>,
        register: impl FnOnce(&mut Engine),
    ) -> Result<Self, String> {
        Self::load_with_clock(package, script, descriptors, None, register)
    }

    pub fn load_with_clock(
        package: Package,
        script: &str,
        descriptors: HashMap<String, Vec<u8>>,
        clock: Option<extensions::Clock>,
        register: impl FnOnce(&mut Engine),
    ) -> Result<Self, String> {
        Self::load_with_components(
            package,
            script,
            descriptors,
            clock,
            HashMap::new(),
            register,
        )
    }

    /// Load a screen together with the packages its `components` declare, keyed by the URL of
    /// the declaration. Children carrying `rpc` definitions need descriptors of their own, which
    /// `load_with_bundle` takes; this entry point bundles them without any.
    pub fn load_with_components(
        package: Package,
        script: &str,
        descriptors: HashMap<String, Vec<u8>>,
        clock: Option<extensions::Clock>,
        components: HashMap<String, (Package, String)>,
        register: impl FnOnce(&mut Engine),
    ) -> Result<Self, String> {
        let components = components
            .into_iter()
            .map(|(url, (package, script))| {
                (
                    url,
                    Bundle {
                        package,
                        script,
                        descriptors: HashMap::new(),
                    },
                )
            })
            .collect();
        Self::load_with_bundle(package, script, descriptors, clock, components, register)
    }

    /// Each placement of a bundled package becomes an instance of its own, loaded after the
    /// instance holding it so that its `config` sees a parent that finished `init`.
    pub fn load_with_bundle(
        package: Package,
        script: &str,
        descriptors: HashMap<String, Vec<u8>>,
        clock: Option<extensions::Clock>,
        components: HashMap<String, Bundle>,
        register: impl FnOnce(&mut Engine),
    ) -> Result<Self, String> {
        let mut dialogs = dialogs::Requests::default();
        let pages = pages::Requests::default();
        // One context per screen: every instance of the tree shares this clock.
        let context = extensions::ExtensionContext::default();
        let root = instance::Instance::load(
            package,
            script,
            descriptors,
            &context,
            clock,
            "",
            register,
            &mut dialogs,
            &pages,
        )?;
        let mut composing = Composing {
            bundled: &components,
            context: &context,
            dialogs: &mut dialogs,
            pages: &pages,
            root_id: root.package.id.clone(),
            loading: Vec::new(),
            loaded: BTreeMap::new(),
            count: 1,
        };
        composing.load(&root, "", 1)?;
        let components = composing.loaded;
        Ok(Self {
            root,
            components,
            dialogs,
            pages,
            revision: 0,
        })
    }

    pub fn with_clock<T>(
        &mut self,
        clock: Option<extensions::Clock>,
        execute: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        let _clock_guard = self.root.extension_context.enter(clock)?;
        execute(self)
    }

    /// Drop whatever the instances of the screen queued for a previous event. Every entry point
    /// that runs a handler starts from here, so an `emit` a failed child left behind never
    /// reaches the next event or completion.
    fn clear_queues(&self) {
        self.root.clear_queues();
        for instance in self.components.values() {
            instance.clear_queues();
        }
    }

    pub fn dispatch(&mut self, target: &str, payload: Value) -> Result<(), String> {
        self.pages.clear();
        self.clear_queues();
        self.dialogs.clear();
        if self.dialogs.active().is_some() {
            return match self.dialogs.event(target, &payload)? {
                dialogs::Event::Ignore => Ok(()),
                dialogs::Event::Draft => {
                    self.revision += 1;
                    Ok(())
                }
                dialogs::Event::Answer(id, data) => {
                    self.complete_dialog(id, json!({"ok":true,"data":data,"error":""}))
                }
            };
        }
        if target.starts_with(":dialog:") {
            return Ok(());
        }
        let Some((key, target)) = self.route(target)? else {
            return Ok(());
        };
        let next = match key.is_empty() {
            true => self.root.run_event(&target, payload)?,
            false => self
                .instance(&key)?
                .run_event(&target, payload)
                .map_err(|e| format!("Component {key}: {e}"))?,
        };
        match next {
            Some(next) => self.commit_event(key, next),
            None => Ok(()),
        }
    }

    /// Carry one handler result across the instances it touches and commit them together: the
    /// emits of the instance travel up to the listeners of its parents, the configurations the
    /// moved states resolve to travel back down, and `commit_all` moves the screen at the end.
    /// A failure anywhere leaves every instance — and the revision — where it was.
    fn commit_event(&mut self, key: String, next: Dynamic) -> Result<(), String> {
        let mut candidates = BTreeMap::new();
        candidates.insert(key.clone(), next);
        self.propagate_emits(&mut candidates, key)?;
        let mut visited = BTreeSet::new();
        for path in candidates.keys().cloned().collect::<Vec<_>>() {
            self.propagate_config(&mut candidates, &path, &mut visited)?;
        }
        let root_next = candidates
            .remove("")
            .unwrap_or_else(|| self.root.state.clone());
        self.commit_all(root_next, candidates.into_iter().collect())
    }

    /// Hand the emits of an instance to the listeners its parent declared on the node holding
    /// it, then do the same with whatever the parent emitted in turn. Emits only ever travel
    /// up, so the walk ends at the root, which has no `emit` of its own.
    fn propagate_emits(
        &self,
        candidates: &mut BTreeMap<String, Dynamic>,
        mut path: String,
    ) -> Result<(), String> {
        while !path.is_empty() {
            let emits = self.instance(&path)?.emits.take();
            if emits.is_empty() {
                return Ok(());
            }
            let (parent_path, item_id) = match path.rsplit_once('/') {
                Some((parent, item_id)) => (parent.to_owned(), item_id.to_owned()),
                None => (String::new(), path.clone()),
            };
            let parent = self.instance(&parent_path)?;
            let node = component_node(parent, &item_id)
                .ok_or_else(|| format!("Component {path}: no component node to emit to"))?;
            let mut next = self.candidate(candidates, &parent_path)?;
            let mut announced = false;
            for (name, payload) in emits {
                // An emit nobody listens for is not an error: the child announces, the parent
                // decides which announcements concern it.
                let Some(handler) = node.listeners.get(&name) else {
                    continue;
                };
                let event = rhai::serde::to_dynamic(
                    json!({"target": item_id, "action": name, "value": payload}),
                )
                .map_err(|e| e.to_string())?;
                next = parent
                    .engine
                    .call_fn(&mut Scope::new(), &parent.ast, handler, (next, event))
                    .map_err(|e| {
                        let error =
                            format!("{} / {item_id} / {handler}: {e}", parent.package.script);
                        match parent_path.is_empty() {
                            true => error,
                            false => format!("Component {parent_path}: {error}"),
                        }
                    })?;
                announced = true;
            }
            if announced {
                candidates.insert(parent_path.clone(), next);
            }
            path = parent_path;
        }
        Ok(())
    }

    /// Re-resolve the `config` of every component an instance holds against its candidate state
    /// and hand down the ones that changed. A child whose configuration moved runs its `config`
    /// handler, which may move its own children's configurations in turn.
    fn propagate_config(
        &self,
        candidates: &mut BTreeMap<String, Dynamic>,
        path: &str,
        visited: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        if !visited.insert(path.to_owned()) {
            return Ok(());
        }
        let parent = self.instance(path)?;
        let candidate: Value = rhai::serde::from_dynamic(&self.candidate(candidates, path)?)
            .map_err(|e| e.to_string())?;
        let committed = parent.state_json()?;
        let mut nodes = Vec::new();
        composition::component_nodes(&parent.ui, &mut nodes);
        for node in nodes {
            let child_path = match path.is_empty() {
                true => node.item_id.clone(),
                false => format!("{path}/{}", node.item_id),
            };
            let resolve = |state: &Value| {
                composition::evaluate_config(node, state)
                    .map_err(|e| format!("Component {child_path}: {e}"))
            };
            let config = resolve(&candidate)?;
            if config == resolve(&committed)? {
                continue;
            }
            self.reconfigure(candidates, &child_path, config)?;
            self.propagate_config(candidates, &child_path, visited)?;
        }
        Ok(())
    }

    /// Put a changed configuration into the state of the instance it belongs to and let its
    /// `config` handler react. The handler is the child's chance to recompute what it derives
    /// from the configuration; announcing anything from there has no event to answer to.
    fn reconfigure(
        &self,
        candidates: &mut BTreeMap<String, Dynamic>,
        path: &str,
        config: Value,
    ) -> Result<(), String> {
        let child = self.instance(path)?;
        let mut state: Value = rhai::serde::from_dynamic(&self.candidate(candidates, path)?)
            .map_err(|e| e.to_string())?;
        state
            .as_object_mut()
            .ok_or_else(|| format!("Component {path}: State must be an object"))?
            .insert("config".into(), config.clone());
        let mut next = rhai::serde::to_dynamic(state).map_err(|e| e.to_string())?;
        if child.functions.contains("config") {
            let event =
                rhai::serde::to_dynamic(json!({"config": config})).map_err(|e| e.to_string())?;
            // Only what this `config` call queues may count as an emit from a configuration.
            child.emits.clear();
            next = child
                .engine
                .call_fn(&mut Scope::new(), &child.ast, "config", (next, event))
                .map_err(|e| format!("Component {path}: {} / config: {e}", child.package.script))?;
            if !child.emits.take().is_empty() {
                return Err(format!("Component {path}: emit is not available in config"));
            }
        }
        candidates.insert(path.to_owned(), next);
        Ok(())
    }

    /// The state an instance would commit: what the event moved it to, or where it still is.
    fn candidate(
        &self,
        candidates: &BTreeMap<String, Dynamic>,
        path: &str,
    ) -> Result<Dynamic, String> {
        match candidates.get(path) {
            Some(next) => Ok(next.clone()),
            None => Ok(self.instance(path)?.state.clone()),
        }
    }

    /// The instance a prefixed itemId path names, the empty path being the root.
    fn instance(&self, path: &str) -> Result<&instance::Instance, String> {
        match path.is_empty() {
            true => Ok(&self.root),
            false => self.components.get(path).ok_or_else(|| unknown_item(path)),
        }
    }

    /// The script of an instance, for the queues the whole screen shares: a dialog handler is
    /// validated against the instance that asked for the dialog.
    fn ast_of(&self, origin: &str) -> Option<&AST> {
        self.instance(origin).ok().map(|instance| &instance.ast)
    }

    /// The `pages` an instance declared, for the same reason.
    fn pages_of(&self, origin: &str) -> Option<&HashMap<String, pages::Definition>> {
        self.instance(origin)
            .ok()
            .map(|instance| &instance.package.pages)
    }

    /// The instance an event belongs to and the itemId inside it. Each `/` of a target names a
    /// component node of the instance resolved so far. `None` means the event is dropped,
    /// because a component on the way is hidden or sits under a disabled part of its parent.
    fn route(&self, target: &str) -> Result<Option<(String, String)>, String> {
        let mut instance = &self.root;
        let mut key = String::new();
        let mut rest = target;
        while let Some((head, tail)) = rest.split_once('/') {
            let state = instance.state_json()?;
            let mut path = Vec::new();
            if !find_path(&instance.ui, head, &mut path) {
                return Err(unknown_item(target));
            }
            let node = *path.last().unwrap();
            if node.port_kind != "component" {
                return Err(unknown_item(target));
            }
            if instance.blocked(&path, &state, head) || hidden_component(node, &state) {
                return Ok(None);
            }
            key = if key.is_empty() {
                head.to_owned()
            } else {
                format!("{key}/{head}")
            };
            instance = self
                .components
                .get(&key)
                .ok_or_else(|| unknown_item(target))?;
            rest = tail;
        }
        Ok(Some((key, rest.to_owned())))
    }

    pub fn progress_host(&mut self, id: u64, response: Value) -> Result<(), String> {
        self.complete("", Completion::HostProgress { id, data: response })
    }

    pub fn complete_host(&mut self, id: u64, response: Value) -> Result<(), String> {
        self.complete("", Completion::Host { id, response })
    }

    pub fn complete_http(&mut self, id: u64, response: Value) -> Result<(), String> {
        self.complete("", Completion::Http { id, response })
    }

    pub fn complete_storage(&mut self, id: u64, response: Value) -> Result<(), String> {
        self.complete("", Completion::Storage { id, response })
    }

    pub fn complete_file(
        &mut self,
        id: u64,
        response: Value,
        buffer: Option<u32>,
    ) -> Result<(), String> {
        self.complete(
            "",
            Completion::File {
                id,
                response,
                buffer,
            },
        )
    }

    pub fn complete_rpc(
        &mut self,
        id: u64,
        response: Value,
        buffer: Option<u32>,
    ) -> Result<(), String> {
        self.complete(
            "",
            Completion::Rpc {
                id,
                response,
                buffer,
            },
        )
    }

    /// Answering a dialog without naming an instance: the queue is the screen's, so the request
    /// alone says which instance asked. This is how `dispatch` delivers `:dialog:{id}:ok`.
    pub fn complete_dialog(&mut self, id: u64, response: Value) -> Result<(), String> {
        self.complete_at("", Completion::Dialog { id, response }, None)
    }

    /// Deliver the response of one effect to the instance that queued it. `instance` is the
    /// prefixed itemId path the effect carried, the empty path being the root.
    pub fn complete(&mut self, instance: &str, completion: Completion) -> Result<(), String> {
        self.complete_at(instance, completion, Some(instance))
    }

    /// `expected` is what a dialog completion must match: the host names the instance it read
    /// off the effect, so naming the wrong one may not swallow somebody else's dialog.
    fn complete_at(
        &mut self,
        instance: &str,
        completion: Completion,
        expected: Option<&str>,
    ) -> Result<(), String> {
        self.pages.clear();
        self.clear_queues();
        self.dialogs.clear();
        if !instance.is_empty() && !self.components.contains_key(instance) {
            return Err(format!("Unknown component instance: {instance}"));
        }
        let (path, next) = match completion {
            // The dialog stack belongs to the screen, so the request itself — not the caller —
            // decides which instance runs the handler.
            Completion::Dialog { id, mut response } => {
                let (handler, origin) = self
                    .dialogs
                    .consume(id, &mut response, expected)
                    .map_err(|error| composition::blame(instance, error))?;
                let next = self
                    .instance(&origin)?
                    .complete_dialog(&handler, response)
                    .map_err(|error| composition::blame(&origin, error))?;
                (origin, next)
            }
            completion => {
                let target = match instance.is_empty() {
                    true => &mut self.root,
                    false => self
                        .components
                        .get_mut(instance)
                        .expect("the instance resolved above"),
                };
                let next = target
                    .complete(completion)
                    .map_err(|error| composition::blame(instance, error))?;
                (instance.to_owned(), next)
            }
        };
        self.commit_event(path, next)
    }

    pub fn take_effects(&mut self) -> Vec<Value> {
        let mut effects: Vec<Value> = self
            .root
            .http
            .take()
            .into_iter()
            .map(|effect| serde_json::to_value(effect).unwrap())
            .chain(
                self.root
                    .storage
                    .take()
                    .into_iter()
                    .map(|effect| serde_json::to_value(effect).unwrap()),
            )
            .chain(self.root.files.take())
            .chain(self.root.rpc.take())
            .chain(self.dialogs.take())
            .chain(self.pages.take())
            .chain(self.root.host.take())
            .collect();
        // The effects of the children follow the root's, each naming the instance the host has
        // to send the response back to. The root's carry no `instance` at all.
        for (path, instance) in &mut self.components {
            effects.extend(instance.take_effects().into_iter().map(|mut effect| {
                if let Some(object) = effect.as_object_mut() {
                    object.insert("instance".to_owned(), json!(path));
                }
                effect
            }));
        }
        effects
    }

    /// Commit one event across the instances it moved: everything is checked before anything is
    /// moved, so a failure anywhere leaves the whole screen — root and children — untouched.
    fn commit_all(
        &mut self,
        root_next: Dynamic,
        children: Vec<(String, Dynamic)>,
    ) -> Result<(), String> {
        let (next, ui) = self.root.prepare_commit(root_next)?;
        let mut children: Vec<(String, Dynamic)> = children;
        children.sort_by(|(a, _), (b, _)| a.cmp(b));
        let mut prepared = Vec::new();
        for (key, child_next) in children {
            let instance = self
                .components
                .get(&key)
                .ok_or_else(|| unknown_item(&key))?;
            let (state, child_ui) = instance
                .prepare_commit(child_next)
                .map_err(|e| format!("Component {key}: {e}"))?;
            prepared.push((key, state, child_ui));
        }
        let queued = self.root.prepare_effects()?;
        let dialog_intents = self
            .dialogs
            .prepare(&|origin| self.ast_of(origin))
            .map_err(|(origin, error)| composition::blame(&origin, error))?;
        let page_intents = self
            .pages
            .prepare(&|origin| self.pages_of(origin))
            .map_err(|(origin, error)| composition::blame(&origin, error))?;
        // Every instance queues into channels of its own, but the screen still moves as one: the
        // exclusion below and the buffer budget count all of them together.
        let mut child_queued = Vec::new();
        for (path, instance) in &self.components {
            let queued = instance
                .prepare_effects()
                .map_err(|error| composition::blame(path, error))?;
            child_queued.push((path.clone(), queued));
        }
        if !page_intents.is_empty()
            && (!queued.is_empty()
                || !dialog_intents.is_empty()
                || child_queued.iter().any(|(_, queued)| !queued.is_empty()))
        {
            return Err(
                "Navigation cannot be combined with other effects in the same handler".into(),
            );
        }
        let (mut bytes, mut count) = queued.size();
        for (_, queued) in &child_queued {
            let (child_bytes, child_count) = queued.size();
            bytes += child_bytes;
            count += child_count;
        }
        buffers::capacity(bytes, count)?;
        self.root.apply(next, ui);
        self.root.commit_effects(queued);
        self.dialogs.commit(dialog_intents);
        self.pages.commit(page_intents);
        for (key, state, ui) in prepared {
            self.components
                .get_mut(&key)
                .expect("a component prepared above")
                .apply(state, ui);
        }
        for (key, queued) in child_queued {
            self.components
                .get_mut(&key)
                .expect("a component prepared above")
                .commit_effects(queued);
        }
        self.revision += 1;
        Ok(())
    }

    pub fn state_json(&self) -> Result<Value, String> {
        self.root.state_json()
    }

    /// Snapshot the component instances for one layout pass. `measure` and `arrange_sized`
    /// reach the children through it instead of carrying a context down every call.
    fn layout_scope(&self) -> Result<Option<composition::LayoutScope>, String> {
        if self.components.is_empty() {
            return Ok(None);
        }
        let mut instances = BTreeMap::new();
        for (path, instance) in &self.components {
            // A child only moves through `apply`, which clears this; until then every layout
            // pass reuses the tree and the serialized state the first one built.
            let mut snapshot = instance.snapshot.borrow_mut();
            let shared = match snapshot.as_ref() {
                Some(shared) => shared.clone(),
                None => {
                    let shared = Rc::new((instance.ui.clone(), instance.state_json()?));
                    *snapshot = Some(shared.clone());
                    shared
                }
            };
            instances.insert(path.clone(), shared);
        }
        Ok(Some(composition::enter_layout(instances)))
    }

    pub fn layout(&self, width: f64) -> Result<Scene, String> {
        if !width.is_finite() || !(240.0..=4096.0).contains(&width) {
            return Err("Viewport width must be between 240 and 4096".into());
        }
        let state = self.root.state_json()?;
        let _components = self.layout_scope()?;
        let mut widgets = Vec::new();
        let mut windows = Vec::new();
        collect_windows(&self.root.ui, &state, &mut windows);
        let mut height = windows
            .iter()
            .fold(
                measure(&self.root.ui, &state, width - 32.0) + 32.0,
                |h, n| {
                    h.max(
                        (content_height(
                            n,
                            &state,
                            n.width.unwrap_or(window_width()).min(width - 32.0) - 28.0,
                        ) + 56.0)
                            .max(n.height.unwrap_or(0.0))
                            + 32.0,
                    )
                },
            )
            .max(if windows.is_empty() { 0.0 } else { 320.0 });
        arrange(
            &self.root.ui,
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
            find_path(&self.root.ui, &node.item_id, &mut path);
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
        if let Some(dialog_modal) =
            self.dialogs
                .layout(width, &mut height, windows.len() + 1, &mut widgets)
        {
            modal = Some(dialog_modal);
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
            if find_path(&self.root.ui, &widget.target, &mut path) {
                let metadata = &path.last().unwrap().webmcp;
                if !metadata.is_empty() {
                    widget.config["webmcp"] =
                        serde_json::to_value(metadata).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(Scene {
            webmcp: self.root.package.webmcp.clone(),
            state_schema: self.root.package.state_schema.clone(),
            theme: theme::current(),
            width,
            height,
            widgets,
            modal,
            popup,
            dialog: self.dialogs.snapshot(),
        })
    }
}

/// What one instance does with an event of its own: resolve the target in its component tree,
/// drop the event when the tree hides it, apply the built-in behaviour and call the handler.
/// It stays next to the layout because every helper it needs describes a component tree.
impl instance::Instance {
    /// `Ok(None)` when the event is dropped, `Ok(Some(next))` when a handler (or a built-in
    /// binding) produced a candidate state. Nothing is committed here.
    fn run_event(&self, target: &str, mut payload: Value) -> Result<Option<Dynamic>, String> {
        let mut state = self.state_json()?;
        let mut path = Vec::new();
        if !find_path(&self.ui, target, &mut path) {
            return Err(unknown_item(target));
        }
        let node = *path.last().unwrap();
        if self.blocked(&path, &state, target) {
            return Ok(None);
        }
        let action = payload
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        if fields::input(node) && node.read_only {
            return Ok(None);
        }
        navigation::close_other_menus(&self.ui, &mut state, &path);
        if node.xtype == "kanban" {
            kanban::event(node, &mut state, &mut payload)?;
        } else if extras::event_component(node) {
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
            let event = rhai::serde::to_dynamic(json!({ "target": target, "action": action, "value": event_value.unwrap_or_else(|| payload.get("value").cloned().unwrap_or(Value::Null)), "id": payload.get("id").cloned().unwrap_or(Value::Null), "column": payload.get("column").cloned().unwrap_or(Value::Null), "oldValue": payload.get("oldValue").cloned().unwrap_or(Value::Null), "beforeId": payload.get("beforeId").cloned().unwrap_or(Value::Null) }))
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
        Ok(Some(next))
    }

    /// Whether the tree between the root of this instance and `target` swallows the event: a
    /// window above it, something disabled or collapsed, or a hidden tab, card or menu.
    fn blocked(&self, path: &[&Node], state: &Value, target: &str) -> bool {
        let mut windows = Vec::new();
        collect_windows(&self.ui, state, &mut windows);
        let scope = path.iter().rev().find(|n| n.xtype == "window");
        windows
            .last()
            .is_some_and(|w| scope.map(|n| n.item_id.as_str()) != Some(w.item_id.as_str()))
            || path.iter().any(|n| {
                (!n.disabled_bind.is_empty() && flag(state, &n.disabled_bind))
                    || n.disabled
                    || (n.xtype == "window" && !flag(state, &n.visible_bind))
                    || (n.item_id != target && is_panel(n) && flag(state, &n.collapsed_bind))
            })
            || navigation::hidden(path, state)
            || extras::hidden(path, state)
            || layouts::hidden(path, state)
    }

    /// The candidate state the response of one of this instance's own effects produces. Like
    /// `run_event` it only runs the handler: the level above commits it across the screen, and
    /// names this instance if it failed.
    fn complete(&mut self, completion: Completion) -> Result<Dynamic, String> {
        match completion {
            Completion::HostProgress { id, data } => {
                let name = self.host.progress(id, &data)?;
                let handler = self.package.operations[&name].options["progressHandler"]
                    .as_str()
                    .ok_or("Host operation has no progress handler")?
                    .to_string();
                let response = rhai::serde::to_dynamic(data).map_err(|e| e.to_string())?;
                self.engine
                    .call_fn(
                        &mut Scope::new(),
                        &self.ast,
                        &handler,
                        (self.state.clone(), response),
                    )
                    .map_err(|e| {
                        format!(
                            "{} / host progress {} / {}: {e}",
                            self.package.script, name, handler
                        )
                    })
            }
            Completion::Host { id, response } => {
                host::validate_result(&response)?;
                let name = self.host.consume(id)?;
                let handler = &self.package.operations[&name].handler;
                let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
                self.engine
                    .call_fn(
                        &mut Scope::new(),
                        &self.ast,
                        handler,
                        (self.state.clone(), response),
                    )
                    .map_err(|e| {
                        format!("{} / host {} / {}: {e}", self.package.script, name, handler)
                    })
            }
            Completion::Http { id, response } => {
                let name = self.http.consume(id)?;
                let handler = &self.package.requests[&name].handler;
                let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
                // Use current state, including edits made while the HTTP request was in flight.
                self.engine
                    .call_fn(
                        &mut Scope::new(),
                        &self.ast,
                        handler,
                        (self.state.clone(), response),
                    )
                    .map_err(|e| {
                        format!("{} / HTTP {} / {}: {e}", self.package.script, name, handler)
                    })
            }
            Completion::Storage { id, mut response } => {
                let (name, operation) = self.storage.consume(id)?;
                response["operation"] =
                    serde_json::to_value(operation).map_err(|e| e.to_string())?;
                response["request"] = json!(name);
                let handler = &self.package.storage[&name].handler;
                let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
                self.engine
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
                    })
            }
            Completion::File {
                id,
                response,
                buffer,
            } => {
                let mut response: rhai::Map = rhai::serde::to_dynamic(response)
                    .map_err(|e| e.to_string())?
                    .cast();
                let name = self.files.consume(id, &mut response, buffer)?;
                let handler = &self.package.files[&name].handler;
                self.engine
                    .call_fn(
                        &mut Scope::new(),
                        &self.ast,
                        handler,
                        (self.state.clone(), Dynamic::from_map(response)),
                    )
                    .map_err(|e| {
                        format!("{} / file {} / {}: {e}", self.package.script, name, handler)
                    })
            }
            Completion::Rpc {
                id,
                mut response,
                buffer,
            } => {
                let name = self.rpc.consume(id, &mut response, buffer)?;
                let handler = &self.package.rpc[&name].handler;
                let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
                self.engine
                    .call_fn(
                        &mut Scope::new(),
                        &self.ast,
                        handler,
                        (self.state.clone(), response),
                    )
                    .map_err(|e| {
                        format!("{} / RPC {} / {}: {e}", self.package.script, name, handler)
                    })
            }
            // The dialog queue belongs to the screen, not to an instance: `Runtime` consumes the
            // request itself to learn who asked, then calls `complete_dialog` below.
            Completion::Dialog { .. } => {
                unreachable!("a dialog is routed by the instance that asked for it")
            }
        }
    }

    /// Run the completion handler a dialog this instance asked for named. An empty handler is
    /// the `alert` case: the answer only closes the dialog.
    fn complete_dialog(&self, handler: &str, response: Value) -> Result<Dynamic, String> {
        if handler.is_empty() {
            return Ok(self.state.clone());
        }
        let response = rhai::serde::to_dynamic(response).map_err(|e| e.to_string())?;
        self.engine
            .call_fn(
                &mut Scope::new(),
                &self.ast,
                handler,
                (self.state.clone(), response),
            )
            .map_err(|e| format!("{} / dialog / {}: {e}", self.package.script, handler))
    }

    /// `prepare` the five channels this instance owns. The error names nothing: the level above
    /// decides whether to blame the instance.
    fn prepare_effects(&self) -> Result<Queued, String> {
        Ok(Queued {
            http: self.http.prepare(&self.package.requests)?,
            host: self.host.prepare(&self.package.operations)?,
            storage: self.storage.prepare(&self.package.storage)?,
            files: self.files.prepare(&self.package.files)?,
            rpc: self.rpc.prepare()?,
        })
    }

    /// Hand the channels what `prepare_effects` checked. Infallible like `apply`, and run in the
    /// same pass: once the screen starts moving, no instance may fail any more.
    fn commit_effects(&mut self, queued: Queued) {
        self.http.commit(queued.http, &self.package.requests);
        self.host.commit(queued.host);
        self.storage.commit(queued.storage, &self.package.storage);
        self.files.commit(queued.files);
        self.rpc.commit(queued.rpc, &self.package.rpc);
    }

    /// Everything `commit_all` checks before any instance of a screen is moved: the candidate
    /// state and the component tree it resolves to. Returns them for `apply`.
    fn prepare_commit(&self, next: Dynamic) -> Result<(Dynamic, Node), String> {
        // Commit only after successful execution and serialization. Failed handlers preserve the old state.
        let mut candidate: Value = rhai::serde::from_dynamic(&next).map_err(|e| e.to_string())?;
        if !candidate.is_object() {
            return Err("Handler must return a state object".into());
        }
        check_state(&next)?;
        let ui = dynamic_ui::resolve(&self.package.ui, &candidate, &self.declared)?;
        validate_handlers(&ui, &self.functions)?;
        dynamic_ui::initialize_added(&self.ui, &ui, &mut candidate);
        grid::reconcile(&ui, &self.state_json()?, &mut candidate);
        // Built-in defaults/reconciliation can also touch bindings. Resolve the final state,
        // so the committed component tree always describes exactly the committed data.
        let ui = dynamic_ui::resolve(&self.package.ui, &candidate, &self.declared)?;
        validate_handlers(&ui, &self.functions)?;
        validate_ui_state(&ui, &candidate)?;
        if let Some(schema) = &self.package.state_schema {
            schema.bindings(&ui)?;
            schema.validate(&candidate)?;
        }
        let next = rhai::serde::to_dynamic(candidate).map_err(|e| e.to_string())?;
        check_state(&next)?;
        Ok((next, ui))
    }

    /// Move this instance onto what `prepare_commit` checked. Infallible on purpose: once any
    /// instance of a screen is moved, none of them may fail any more.
    fn apply(&mut self, state: Dynamic, ui: Node) {
        self.state = state;
        self.ui = ui;
        *self.snapshot.borrow_mut() = None;
    }
}

fn unknown_item(target: &str) -> String {
    format!("Unknown itemId: {target}")
}

/// The component node of an instance that holds the child placed under `item_id`, i.e. the node
/// carrying the `listeners` and the `config` of that placement.
fn component_node<'a>(instance: &'a instance::Instance, item_id: &str) -> Option<&'a Node> {
    let mut nodes = Vec::new();
    composition::component_nodes(&instance.ui, &mut nodes);
    nodes.into_iter().find(|node| node.item_id == item_id)
}

fn initialize_ui(ui: &Node, state: &mut Value) {
    fields::initialize(ui, state);
    grid::initialize(ui, state);
    navigation::initialize(ui, state);
    extras::initialize(ui, state);
    layouts::initialize(ui, state);
    kanban::initialize(ui, state);
}

fn validate_ui_state(ui: &Node, state: &Value) -> Result<(), String> {
    grid::validate_state(ui, state)?;
    navigation::validate_state(ui, state)?;
    extras::validate_state(ui, state)?;
    kanban::validate_state(ui, state)?;
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

/// Every xtype `validate` accepts. A declared component name must not shadow one of these.
const XTYPES: [&str; 48] = [
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
    "kanban",
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
];

fn validate(
    node: &Node,
    ids: &mut HashSet<String>,
    count: &mut usize,
    depth: usize,
    declared: &BTreeSet<String>,
    parent: &str,
) -> Result<(), String> {
    node.webmcp.validate()?;
    *count += 1;
    if *count > 200 || depth > 20 {
        return Err("UI exceeds 200 nodes or 20 nesting levels".into());
    }
    let component = declared.contains(&node.xtype);
    if !component && !XTYPES.contains(&node.xtype.as_str()) {
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
    if node.item_id.contains('/') {
        return Err("itemId must not contain '/' (reserved for component paths)".into());
    }
    // A component node carries no widget attributes, so none of the checks below apply to it.
    if component {
        return composition::validate_node(node, parent);
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
    kanban::validate(node)?;
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
        validate(child, ids, count, depth + 1, declared, &node.xtype)?;
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
    for (event, handler) in &node.listeners {
        if !functions.contains(handler) {
            return Err(format!(
                "{}: listener {event} references undefined handler: {handler}",
                node.item_id
            ));
        }
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

/// A component node the parent currently hides. `visibleBind` is the one binding a parent
/// keeps over a child; without it the component is always laid out.
fn hidden_component(node: &Node, state: &Value) -> bool {
    !node.visible_bind.is_empty() && !flag(state, &node.visible_bind)
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
    if node.port_kind == "component" {
        if hidden_component(node, state) {
            return 0.0;
        }
        return composition::with_component(&node.item_id, |ui, child| measure(ui, child, width))
            .unwrap_or(0.0);
    }
    if node.xtype == "kanban" {
        return kanban::height(node, state, width);
    }
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
    if node.port_kind == "component" {
        if !hidden_component(node, state) {
            let start = widgets.len();
            let arranged = composition::with_component(&node.item_id, |ui, child| {
                arrange_sized(ui, child, x, y, width, "root", allocated_height, widgets)
            });
            if arranged.is_some() {
                composition::prefix_widgets(&node.item_id, &mut widgets[start..]);
            }
        }
        return;
    }
    if node.xtype == "kanban" {
        kanban::arrange(node, state, x, y, width, key, widgets);
        return;
    }
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
    fn host_progress_and_cancel_roll_back_without_consuming_completion() {
        let package: Package = serde_json::from_value(json!({
            "version":1, "id":"host", "title":"Host", "script":"host.rhai",
            "state":{"count":0},
            "operations":{"download":{"connection":"api", "action":"http.download", "handler":"done", "options":{"progressHandler":"progress"}}},
            "ui":{"xtype":"container", "items":[{"xtype":"button", "itemId":"fail", "handler":"fail"}]}
        })).unwrap();
        let code = "fn init(s){host_call(\"download\", #{});s} fn fail(s,e){host_cancel(\"download\");throw \"bad\";s} fn progress(s,p){host_cancel(\"download\");42} fn done(s,r){s.count+=1;s}";
        let mut runtime = Runtime::load(package, code).unwrap();
        let id = runtime.take_effects()[0]["id"].as_u64().unwrap();
        assert!(runtime.dispatch("fail", json!({})).is_err());
        assert!(runtime.take_effects().is_empty());
        assert!(runtime
            .progress_host(
                id,
                json!({"operation":"download", "transferred":0, "total":null})
            )
            .is_err());
        assert!(runtime.take_effects().is_empty());
        assert_eq!(runtime.state_json().unwrap()["count"], 0);
        runtime
            .complete_host(id, json!({"ok":true, "data":null, "error":null}))
            .unwrap();
        assert_eq!(runtime.state_json().unwrap()["count"], 1);
    }

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
