use super::{
    buffers, check_state, composition, dialogs, dynamic_ui, extensions, fields, files, host, http,
    initialize_ui, pages, rpc, storage, validate, validate_handlers, validate_ui_state, Node,
    Package,
};
use rhai::{Dynamic, Engine, Scope, AST};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::rc::Rc;

/// One loaded screen package: its own script engine, resolved component tree, state and
/// request queues. The queues shared across a whole screen (dialogs, pages) stay on `Runtime`.
pub(crate) struct Instance {
    pub(crate) package: Package,
    pub(crate) ui: Node,
    /// Component names this package declares, i.e. the extra xtypes its template may use.
    pub(crate) declared: BTreeSet<String>,
    pub(crate) functions: HashSet<String>,
    pub(crate) engine: Engine,
    pub(crate) extension_context: extensions::ExtensionContext,
    pub(crate) ast: AST,
    pub(crate) state: Dynamic,
    pub(crate) http: http::Requests,
    pub(crate) host: host::Requests,
    pub(crate) storage: storage::Requests,
    pub(crate) files: files::Requests,
    pub(crate) rpc: rpc::Requests,
    /// What a child handler announced to its parent. Never registered on a root engine.
    pub(crate) emits: composition::Emits,
    /// Ui and serialized state as the last layout pass saw them. `apply` is the only thing that
    /// moves an instance, so it is also the only thing that has to clear this.
    pub(crate) snapshot: RefCell<Option<Rc<(Node, Value)>>>,
}

impl Instance {
    /// `path` is where this instance sits in the tree: the empty path loads a root, any other
    /// one loads the package as a component, which gains `emit` and tags the screen-wide
    /// requests it queues with its path. `context` is shared by every instance of a screen, so
    /// `Runtime::with_clock` reaches the children too.
    pub(crate) fn load(
        mut package: Package,
        script: &str,
        descriptors: HashMap<String, Vec<u8>>,
        context: &extensions::ExtensionContext,
        clock: Option<extensions::Clock>,
        path: &str,
        register: impl FnOnce(&mut Engine),
        dialogs: &mut dialogs::Requests,
        pages: &pages::Requests,
    ) -> Result<Self, String> {
        let component = !path.is_empty();
        let extension_context = context.clone();
        // Without a clock of its own an instance keeps the one the caller is already holding.
        let _clock_guard = match clock {
            Some(_) => Some(extension_context.enter(clock)?),
            None => None,
        };
        if package.version != 1 {
            return Err("Unsupported package version (expected 1)".into());
        }
        if !package.state.is_object() {
            return Err("Initial state must be an object".into());
        }
        if component {
            composition::reject_effect_declarations(&package)?;
        }
        package.webmcp.validate()?;
        pages::Requests::validate(&package.pages)?;
        let declared = composition::validate_declarations(&package)?;
        if let Some(schema) = &package.state_schema {
            schema.definition()?;
            schema.validate(&package.state)?;
        }
        if script.len() > 100_000 {
            return Err("Script exceeds 100 KB".into());
        }
        composition::prepare_template(&mut package.ui, &declared)?;
        fields::normalize(&mut package.ui, "root");
        validate(&package.ui, &mut HashSet::new(), &mut 0, 0, &declared, "")?;
        let initial_ui = dynamic_ui::resolve(&package.ui, &package.state, &declared)?;
        if component {
            composition::reject_windows(&initial_ui)?;
        }
        initialize_ui(&initial_ui, &mut package.state);
        if let Some(schema) = &package.state_schema {
            schema.bindings(&initial_ui)?;
            schema.validate(&package.state)?;
        }
        if package.ui.xtype == "window" {
            return Err("A window must be inside a container or panel".into());
        }
        let mut engine = Engine::new();
        extensions::register_with_context(&mut engine, &extension_context);
        let mut http = http::Requests::default();
        let mut host = host::Requests::default();
        let mut storage = storage::Requests::default();
        let mut files = files::Requests::default();
        let mut rpc = rpc::Requests::default();
        let emits = composition::Emits::default();
        http.register(&mut engine);
        host.register(&mut engine);
        storage.register(&mut engine);
        files.register(&mut engine);
        rpc.initialize(&package.rpc, descriptors)?;
        rpc.register(&mut engine);
        dialogs.register(&mut engine, path);
        pages.register(&mut engine, path);
        // Only a child has a parent to announce to.
        if component {
            emits.register(&mut engine);
        }
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
        host::Requests::validate(&package.operations, &functions)?;
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
        let ui = dynamic_ui::resolve(&package.ui, &initial, &declared)?;
        validate_handlers(&ui, &functions)?;
        dynamic_ui::initialize_added(&initial_ui, &ui, &mut initial);
        let ui = dynamic_ui::resolve(&package.ui, &initial, &declared)?;
        validate_handlers(&ui, &functions)?;
        if component {
            composition::reject_windows(&ui)?;
        }
        validate_ui_state(&ui, &initial)?;
        if let Some(schema) = &package.state_schema {
            schema.bindings(&ui)?;
            schema.validate(&initial)?;
        }
        let state = rhai::serde::to_dynamic(initial).map_err(|e| e.to_string())?;
        check_state(&state)?;
        let names = http.prepare(&package.requests)?;
        let host_intents = host.prepare(&package.operations)?;
        let intents = storage.prepare(&package.storage)?;
        let file_intents = files.prepare(&package.files)?;
        let rpc_intents = rpc.prepare()?;
        // During a load only this instance has anything queued, so both lookups answer for
        // `path` alone and nothing else can resolve. The level above names the instance, so a
        // blame of its own would be said twice.
        let dialog_intents = dialogs
            .prepare(&|origin| (origin == path).then_some(&ast))
            .map_err(|(_, error)| error)?;
        if !pages
            .prepare(&|origin| (origin == path).then_some(&package.pages))
            .map_err(|(_, error)| error)?
            .is_empty()
        {
            return Err("navigate is only available in event handlers, not init".into());
        }
        if !emits.take().is_empty() {
            return Err("emit is only available in event handlers, not init".into());
        }
        let (file_bytes, file_count) = files::Requests::size(&file_intents);
        let (rpc_bytes, rpc_count) = rpc::Requests::size(&rpc_intents);
        buffers::capacity(file_bytes + rpc_bytes, file_count + rpc_count)?;
        http.commit(names, &package.requests);
        host.commit(host_intents);
        storage.commit(intents, &package.storage);
        files.commit(file_intents);
        rpc.commit(rpc_intents, &package.rpc);
        dialogs.commit(dialog_intents);
        Ok(Self {
            package,
            ui,
            declared,
            functions,
            engine,
            extension_context,
            ast,
            state,
            http,
            host,
            storage,
            files,
            rpc,
            emits,
            snapshot: RefCell::new(None),
        })
    }

    /// The effects this instance committed, in the order the host is handed them. The queues a
    /// whole screen shares (dialogs, pages) are not here: the root reports them once for
    /// everybody, already tagged with the instance that asked.
    pub(crate) fn take_effects(&mut self) -> Vec<Value> {
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
            .chain(self.host.take())
            .collect()
    }

    /// Drop every queued-but-uncommitted request of this instance.
    pub(crate) fn clear_queues(&self) {
        self.http.clear();
        self.host.clear();
        self.storage.clear();
        self.files.clear();
        self.rpc.clear();
        self.emits.clear();
    }

    pub(crate) fn state_json(&self) -> Result<Value, String> {
        rhai::serde::from_dynamic(&self.state).map_err(|e| e.to_string())
    }
}
