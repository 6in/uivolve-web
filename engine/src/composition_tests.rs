//! Composition: declarations, component-node attributes and their placement rules.
use super::*;

const SCRIPT: &str = "fn init(s) { s } fn onSelected(s, e) { s }";

fn screen(components: Value, state: Value, items: Value) -> Package {
    serde_json::from_value(json!({
        "version": 1, "id": "parent", "title": "Parent", "script": "parent.rhai",
        "state": state,
        "components": components,
        "ui": {"xtype": "container", "items": items},
    }))
    .expect("test package")
}

/// A screen declaring one component, with the state its examples bind to.
fn declaring(items: Value) -> Package {
    screen(
        json!({"orderList": {"url": "parts/order-list.json"}}),
        json!({"query": "", "rows": []}),
        items,
    )
}

/// The error a package fails to load with. `Instance` is not `Debug`, so tests that expect a
/// rejection go through here instead of `unwrap_err`.
fn load_error(package: Package, script: &str) -> String {
    load(package, script).err().expect("expected a load error")
}

fn load(package: Package, script: &str) -> Result<instance::Instance, String> {
    load_in(
        package,
        script,
        true,
        &extensions::ExtensionContext::default(),
    )
}

/// Load a package the way a parent loads a component: no host effects, `emit` instead.
fn load_child(package: Package, script: &str) -> Result<instance::Instance, String> {
    load_in(
        package,
        script,
        false,
        &extensions::ExtensionContext::default(),
    )
}

fn child_error(package: Package, script: &str) -> String {
    load_child(package, script)
        .err()
        .expect("expected a load error")
}

fn load_in(
    package: Package,
    script: &str,
    effects: bool,
    context: &extensions::ExtensionContext,
) -> Result<instance::Instance, String> {
    let mut dialogs = dialogs::Requests::default();
    let pages = pages::Requests::default();
    instance::Instance::load(
        package,
        script,
        HashMap::new(),
        context,
        None,
        effects,
        |_| {},
        &mut dialogs,
        &pages,
    )
}

/// The smallest child package: one button whose `run` handler each effect test fills in.
fn child() -> Package {
    serde_json::from_value(json!({
        "version": 1, "id": "child", "title": "Child", "script": "child.rhai",
        "state": {"value": 0},
        "ui": {"xtype": "container", "items": [
            {"xtype": "button", "itemId": "run", "handler": "run"},
        ]},
    }))
    .expect("test child package")
}

/// Run a child handler the way `dispatch` will once the instance tree exists (T4), and return
/// the error it fails with. The committed state is never touched by a failed call.
fn run_child(instance: &instance::Instance, handler: &str) -> Result<Dynamic, String> {
    instance
        .engine
        .call_fn::<Dynamic>(
            &mut Scope::new(),
            &instance.ast,
            handler,
            (instance.state.clone(), Dynamic::from(rhai::Map::new())),
        )
        .map_err(|e| e.to_string())
}

// --- declarations ---

#[test]
fn declaration_names_and_urls_follow_their_rules() {
    let long = "a".repeat(41);
    let names = ["", "1list", "order-list", "order_list", "__text", &long];
    for name in names {
        let error = load_error(
            screen(json!({name: {"url": "child.json"}}), json!({}), json!([])),
            SCRIPT,
        );
        assert!(
            error.contains("requires 1–40 ASCII letters"),
            "{name}: {error}"
        );
    }
    for url in ["", &"u".repeat(2049)] {
        let error = load_error(
            screen(json!({"orderList": {"url": url}}), json!({}), json!([])),
            SCRIPT,
        );
        assert!(
            error.contains("needs a URL of at most 2048 bytes"),
            "{error}"
        );
    }
}

#[test]
fn declaration_names_cannot_shadow_a_built_in_xtype_or_alias() {
    // Aliases are rejected because normalization rewrites them, not because they are listed
    // here: every candidate below is checked against `fields::normalize` first.
    let aliases = [
        "form",
        "fieldcontainer",
        "textareafield",
        "checkboxfield",
        "radiofield",
        "combo",
        "multiselect",
        "sliderfield",
        "progress",
        "gridpanel",
        "tree",
        "box",
        "tbar",
        "imagecomponent",
        "uxiframe",
        "cartesian",
        "polar",
        "forcegraph",
        "chat",
        "console",
        "code",
        "diff",
        "msgbox",
        "splitbutton",
        "messagebox",
        "codeeditor",
        "htmleditor",
    ];
    for name in aliases {
        let mut probe: Node = serde_json::from_value(json!({"xtype": name})).unwrap();
        fields::normalize(&mut probe, "probe");
        assert!(
            probe.xtype != name || !probe.port_kind.is_empty(),
            "{name} is no longer rewritten by normalize"
        );
    }
    for name in XTYPES.iter().copied().chain(aliases) {
        let error = load_error(
            screen(json!({name: {"url": "child.json"}}), json!({}), json!([])),
            SCRIPT,
        );
        assert!(
            error.contains("collides with a built-in xtype"),
            "{name}: {error}"
        );
    }
}

// --- component nodes ---

#[test]
fn component_nodes_accept_only_their_own_attributes() {
    for (attribute, value) in [
        ("bind", json!("query")),
        ("handler", json!("onSelected")),
        ("items", json!([{"xtype": "label"}])),
        ("layout", json!("hbox")),
        ("disabled", json!(true)),
        ("text", json!("x")),
    ] {
        let mut node = json!({"xtype": "orderList", "itemId": "open"});
        node[attribute] = value;
        let error = load_error(declaring(json!([node])), SCRIPT);
        assert!(
            error.contains(&format!("attribute {attribute} is not supported")),
            "{attribute}: {error}"
        );
    }
}

#[test]
fn component_nodes_require_an_item_id_and_a_container_parent() {
    let error = load_error(declaring(json!([{"xtype": "orderList"}])), SCRIPT);
    assert!(error.contains("requires itemId"), "{error}");
    let error = load_error(
        declaring(
            json!([{"xtype": "toolbar", "items": [{"xtype": "orderList", "itemId": "open"}]}]),
        ),
        SCRIPT,
    );
    assert!(
        error.contains("supported only in the items of a container"),
        "{error}"
    );
}

#[test]
fn components_cannot_be_placed_in_bars_or_column_editors() {
    let error = load_error(
        declaring(json!([{
            "xtype": "panel", "itemId": "wrap",
            "tbar": [{"xtype": "orderList", "itemId": "open"}],
        }])),
        SCRIPT,
    );
    assert!(
        error.contains("supported only in the items of a container"),
        "{error}"
    );
    let error = load_error(
        declaring(json!([{
            "xtype": "grid", "itemId": "rows", "bind": "rows",
            "columns": [{
                "text": "A", "dataIndex": "a",
                "editor": {"xtype": "orderList", "itemId": "open"},
            }],
        }])),
        SCRIPT,
    );
    assert!(
        error.contains("supported only in the items of a container"),
        "{error}"
    );
}

#[test]
fn component_config_must_be_an_object_binding_top_level_keys() {
    let error = load_error(
        declaring(json!([{"xtype": "orderList", "itemId": "open", "config": [1]}])),
        SCRIPT,
    );
    assert!(error.contains("config must be an object"), "{error}");
    let error = load_error(
        declaring(
            json!([{"xtype": "orderList", "itemId": "open", "config": {"query": {"bind": "a.b"}}}]),
        ),
        SCRIPT,
    );
    assert!(
        error.contains("config query must bind a non-empty top-level state key"),
        "{error}"
    );
}

#[test]
fn component_listeners_must_name_a_defined_handler() {
    let error = load_error(
        declaring(
            json!([{"xtype": "orderList", "itemId": "open", "listeners": {"selected": "missing"}}]),
        ),
        SCRIPT,
    );
    assert!(
        error.contains("listener selected references undefined handler: missing"),
        "{error}"
    );
}

#[test]
fn item_ids_cannot_contain_the_component_path_separator() {
    let error = load_error(
        declaring(json!([{"xtype": "label", "itemId": "a/b"}])),
        SCRIPT,
    );
    assert!(error.contains("must not contain '/'"), "{error}");
}

#[test]
fn dynamic_tabs_cannot_carry_components_config_or_listeners() {
    // A declared name reaches `expand` while the template is resolved against the state.
    let error = load_error(
        screen(
            json!({"orderList": {"url": "parts/order-list.json"}}),
            json!({"tabs": [{"xtype": "orderList", "itemId": "open", "title": "受注"}]}),
            json!([{"xtype": "tabpanel", "itemId": "tabs", "itemsBind": "tabs"}]),
        ),
        SCRIPT,
    );
    assert!(
        error.contains("Dynamic tabs cannot carry components"),
        "{error}"
    );
    // A handler that grows one is rejected without touching the committed state.
    let package: Package = serde_json::from_value(json!({
        "version": 1, "id": "parent", "title": "Parent", "script": "parent.rhai",
        "state": {"tabs": [{"xtype": "panel", "itemId": "one", "title": "一"}]},
        "ui": {"xtype": "container", "items": [
            {"xtype": "tabpanel", "itemId": "tabs", "itemsBind": "tabs"},
            {"xtype": "button", "itemId": "add", "handler": "add"},
        ]},
    }))
    .unwrap();
    let script = "fn init(s) { s } fn add(s, e) { s.tabs.push(#{ xtype: \"panel\", itemId: \"two\", title: \"二\", config: #{ status: \"受注\" } }); s }";
    let mut runtime = Runtime::load(package, script).expect("dynamic tab screen");
    let before = runtime.state_json().unwrap();
    assert!(runtime
        .dispatch("add", json!({}))
        .unwrap_err()
        .contains("Dynamic tabs cannot carry components"));
    assert_eq!(runtime.state_json().unwrap(), before);
}

#[test]
fn a_declared_component_node_loads_and_waits_for_its_package() {
    let package = declaring(json!([{
        "xtype": "orderList", "itemId": "open",
        "config": {"status": "受注", "query": {"bind": "query"}},
        "listeners": {"selected": "onSelected"},
    }]));
    let instance = load(package.clone(), SCRIPT).expect("component template");
    assert_eq!(instance.ui.items[0].port_kind, "component");
    assert_eq!(instance.declared, BTreeSet::from(["orderList".to_string()]));
    assert_eq!(
        Runtime::load(package, SCRIPT).err().unwrap(),
        "Component packages were not bundled"
    );
}

// --- the instance environment of a child ---

/// `"a", "b", ...`: a stub takes `Dynamic` arguments, so only the count has to match.
fn arguments(arity: usize) -> String {
    (0..arity)
        .map(|i| format!("\"{}\"", (b'a' + i as u8) as char))
        .collect::<Vec<_>>()
        .join(", ")
}

#[test]
fn effect_functions_written_out_in_a_child_script_are_rejected_at_load() {
    for (name, arities) in composition::STUBS {
        for arity in arities {
            let script = format!(
                "fn init(s) {{ s }} fn run(s, e) {{ {name}({}); s }}",
                arguments(*arity)
            );
            let error = child_error(child(), &script);
            assert!(
                error.contains(name) && error.contains("is not available in components"),
                "{name}/{arity}: {error}"
            );
            assert!(
                error.contains("line 1, position "),
                "{name}/{arity}: {error}"
            );
        }
    }
}

#[test]
fn effect_functions_reached_through_a_function_pointer_are_rejected_when_the_handler_runs() {
    for (name, arities) in composition::STUBS {
        for arity in arities {
            // `Fn("navigate")` hides the name from the load-time walk; the stub answers instead.
            let script = format!(
                "fn init(s) {{ s }} fn run(s, e) {{ let f = Fn(\"{name}\"); f.call({}); s.value = 1; s }}",
                arguments(*arity)
            );
            let instance = load_child(child(), &script)
                .unwrap_or_else(|e| panic!("{name}/{arity} should load: {e}"));
            let before = instance.state_json().expect("child state");
            let error = run_child(&instance, "run").expect_err("the stub must refuse");
            assert!(
                error.contains(name) && error.contains("is not available in components"),
                "{name}/{arity}: {error}"
            );
            assert_eq!(instance.state_json().expect("child state"), before);
        }
    }
}

#[test]
fn every_effect_function_the_host_registers_has_a_stub() {
    // Each call below resolves against a root engine, so no table entry is a dead name. The
    // argument types are the real signatures, unlike the `Dynamic` stubs.
    let calls: [(&str, &str); 24] = [
        ("alert", "\"m\""),
        ("alert", "\"m\", #{}"),
        ("alert", "\"m\", \"onDone\", #{}"),
        ("confirm", "\"m\", \"onDone\""),
        ("confirm", "\"m\", \"onDone\", #{}"),
        ("file_list", "\"vol\", \"f\""),
        ("file_mkdir", "\"vol\", \"f\""),
        ("file_read_bytes", "\"vol\", \"f\""),
        ("file_read_text", "\"vol\", \"f\""),
        ("file_remove", "\"vol\", \"f\""),
        ("file_stat", "\"vol\", \"f\""),
        ("file_write_bytes", "\"vol\", \"f\", file_bytes(\"x\")"),
        ("file_write_text", "\"vol\", \"f\", \"text\""),
        ("host_call", "\"op\", #{}"),
        ("host_cancel", "\"op\""),
        ("http_get", "\"req\""),
        ("navigate", "\"page\""),
        ("prompt", "\"m\", \"onDone\""),
        ("prompt", "\"m\", \"default\", \"onDone\""),
        ("prompt", "\"m\", \"default\", \"onDone\", #{}"),
        ("rpc_call", "\"call\", #{}"),
        ("storage_read", "\"key\""),
        ("storage_remove", "\"key\""),
        ("storage_write", "\"key\", #{}"),
    ];
    let mut table: BTreeSet<(&str, usize)> = BTreeSet::new();
    for (name, arities) in composition::STUBS {
        for arity in arities {
            table.insert((name, *arity));
        }
    }
    let mut resolved: BTreeSet<(&str, usize)> = BTreeSet::new();
    let root = load(child(), "fn init(s) { s } fn run(s, e) { s }").expect("root instance");
    for (name, args) in calls {
        let script = format!("fn probe(s, e) {{ {name}({args}); s }}");
        let ast = root.engine.compile(&script).expect(&script);
        let error = root
            .engine
            .call_fn::<Dynamic>(
                &mut Scope::new(),
                &ast,
                "probe",
                (root.state.clone(), Dynamic::from(rhai::Map::new())),
            )
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(
            !error.contains("Function not found"),
            "{script} does not resolve on a root engine: {error}"
        );
        resolved.insert((name, args.split(',').count()));
    }
    assert_eq!(resolved, table);

    // A new effect function must be added to `STUBS`, so the registration count is pinned.
    // Four of these register values rather than effects: `len` and three `file_bytes`.
    let sites: usize = [
        include_str!("dialogs.rs"),
        include_str!("files.rs"),
        include_str!("host.rs"),
        include_str!("http.rs"),
        include_str!("pages.rs"),
        include_str!("rpc.rs"),
        include_str!("storage.rs"),
    ]
    .iter()
    .map(|source| source.matches("register_fn(").count())
    .sum();
    assert_eq!(
        sites, 21,
        "an effect module gained or lost a register_fn: check composition::STUBS"
    );
}

#[test]
fn a_child_emit_queues_a_json_payload_up_to_eight_per_handler() {
    let instance = load_child(
        child(),
        "fn init(s) { s } fn run(s, e) { emit(\"selected\", #{ id: 1 }); s }",
    )
    .expect("child with an emit");
    let _ = run_child(&instance, "run").expect("the emit is queued");
    assert_eq!(
        instance.emits.take(),
        vec![("selected".to_string(), json!({"id": 1}))]
    );
    assert!(
        instance.emits.take().is_empty(),
        "the queue is drained once"
    );

    let instance = load_child(
        child(),
        "fn init(s) { s } fn run(s, e) { emit(\"bad\", Fn(\"init\")); s }",
    )
    .expect("child with an unserializable payload");
    let error = run_child(&instance, "run").expect_err("a function pointer is not JSON");
    assert!(
        error.contains("emit bad: payload must be JSON-serializable"),
        "{error}"
    );

    let instance = load_child(
        child(),
        "fn init(s) { s } fn run(s, e) { for i in 0..9 { emit(\"tick\", #{}); } s }",
    )
    .expect("child with nine emits");
    let error = run_child(&instance, "run").expect_err("the ninth emit is refused");
    assert!(error.contains("At most 8 emits per handler"), "{error}");
}

#[test]
fn emit_is_refused_during_init_and_undefined_on_a_root() {
    let error = child_error(
        child(),
        "fn init(s) { emit(\"ready\", #{}); s } fn run(s, e) { s }",
    );
    assert_eq!(error, "emit is only available in event handlers, not init");
    // A root has no parent to announce to, so `emit` is simply not a function there.
    let instance = load(
        child(),
        "fn init(s) { s } fn run(s, e) { emit(\"ready\", #{}); s }",
    )
    .expect("root instance");
    let error = run_child(&instance, "run").expect_err("emit is undefined on a root");
    assert!(error.contains("Function not found: emit"), "{error}");
}

#[test]
fn a_child_cannot_own_a_window_at_any_depth() {
    for xtype in ["window", "messagebox"] {
        let package: Package = serde_json::from_value(json!({
            "version": 1, "id": "child", "title": "Child", "script": "child.rhai",
            "state": {"open": false},
            "ui": {"xtype": "container", "items": [{"xtype": "panel", "itemId": "wrap", "items": [
                {"xtype": xtype, "itemId": "dialog", "visibleBind": "open", "width": 320.0},
            ]}]},
        }))
        .expect("child with a window");
        let error = child_error(package.clone(), SCRIPT);
        assert_eq!(
            error, "window is not available in components (reserved for a later stage)",
            "{xtype}"
        );
        // The same template is fine on a root, so the rejection is about being a component.
        load(package, SCRIPT).unwrap_or_else(|e| panic!("{xtype} should load on a root: {e}"));
    }
}

#[test]
fn a_child_cannot_declare_host_effects_or_metadata() {
    let declarations = [
        (
            "requests",
            json!({"load": {"url": "https://x/y", "handler": "run"}}),
        ),
        (
            "operations",
            json!({"op": {"connection": "c", "action": "a", "handler": "run"}}),
        ),
        ("pages", json!({"next": {"url": "next.json"}})),
        (
            "storage",
            json!({"draft": {"backend": "opfs", "key": "draft", "handler": "run"}}),
        ),
        (
            "files",
            json!({"vol": {"backend": "opfs", "access": "read", "handler": "run"}}),
        ),
        (
            "rpc",
            json!({"echo": {
                "url": "https://x/y", "descriptor": "d", "service": "s", "method": "m",
                "protocol": "connect", "handler": "run",
            }}),
        ),
        ("webmcp", json!({"description": "child"})),
    ];
    for (key, value) in declarations {
        let mut package = json!({
            "version": 1, "id": "child", "title": "Child", "script": "child.rhai",
            "state": {}, "ui": {"xtype": "container", "items": []},
        });
        package[key] = value;
        let package: Package =
            serde_json::from_value(package).unwrap_or_else(|e| panic!("{key}: {e}"));
        let error = child_error(package, SCRIPT);
        assert_eq!(
            error,
            "requests, operations, storage, files, rpc, pages and webmcp are not available in components (reserved for a later stage)",
            "{key}"
        );
    }
}

#[test]
fn a_child_reads_the_clock_its_parent_is_holding() {
    // One context for the whole screen: the parent enters the clock, the child inherits it.
    let context = extensions::ExtensionContext::default();
    let _guard = context
        .enter(Some(extensions::Clock {
            now_ms: 1_791_088_440_123,
            tz_offset_minutes: 540,
        }))
        .expect("a valid clock");
    let instance = load_in(
        child(),
        "fn init(s) { s.today = date_today(); s } fn run(s, e) { s }",
        false,
        &context,
    )
    .expect("child with a clock");
    assert_eq!(
        instance.state_json().expect("child state")["today"],
        "2026-10-04"
    );
}
