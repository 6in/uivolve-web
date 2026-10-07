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
        "Component open: package parts/order-list.json was not bundled"
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

// --- the instance tree of a screen ---

/// A package of the composition fixtures: `components` declares, `items` places.
fn part(id: &str, state: Value, components: Value, items: Value) -> Package {
    serde_json::from_value(json!({
        "version": 1, "id": id, "title": id, "script": format!("{id}.rhai"),
        "state": state,
        "components": components,
        "ui": {"xtype": "container", "items": items},
    }))
    .unwrap_or_else(|e| panic!("{id}: {e}"))
}

fn component(xtype: &str, item_id: &str, config: Value) -> Value {
    json!({"xtype": xtype, "itemId": item_id, "config": config})
}

const CHILD_SCRIPT: &str = "fn init(s) { s }";
/// Carries what the parent configured into the state a grandchild can bind to.
const MIDDLE_SCRIPT: &str = "fn init(s) { s.label = s.config.query; s }";

/// `leaf.json` — no declarations of its own, so it ends every branch.
fn leaf() -> Package {
    part(
        "leaf",
        json!({"value": 0}),
        json!({}),
        json!([{"xtype": "metric", "text": "件数", "bind": "value"}]),
    )
}

/// `middle.json` — declares `leaf` and places it as `c`, one level further down.
fn middle() -> Package {
    part(
        "middle",
        json!({"label": ""}),
        json!({"leaf": {"url": "leaf.json"}}),
        json!([
            {"xtype": "metric", "text": "ラベル", "bind": "label"},
            component("leaf", "c", json!({"query": {"bind": "label"}})),
        ]),
    )
}

/// A screen placing `middle` as `a` and the same `leaf` the middle uses as `b`.
fn composed() -> Package {
    part(
        "parent",
        json!({"query": "x"}),
        json!({"middle": {"url": "middle.json"}, "leaf": {"url": "leaf.json"}}),
        json!([
            component(
                "middle",
                "a",
                json!({"status": "受注", "query": {"bind": "query"}})
            ),
            component("leaf", "b", json!({"status": "出荷済"})),
        ]),
    )
}

fn bundle(parts: Vec<(&str, Package, &str)>) -> HashMap<String, (Package, String)> {
    parts
        .into_iter()
        .map(|(url, package, script)| (url.to_owned(), (package, script.to_owned())))
        .collect()
}

fn bundled() -> HashMap<String, (Package, String)> {
    bundle(vec![
        ("middle.json", middle(), MIDDLE_SCRIPT),
        ("leaf.json", leaf(), CHILD_SCRIPT),
    ])
}

fn compose(
    package: Package,
    components: HashMap<String, (Package, String)>,
) -> Result<Runtime, String> {
    Runtime::load_with_components(package, SCRIPT, HashMap::new(), None, components, |_| {})
}

/// The error a screen fails to compose with. `Runtime` is not `Debug`, so rejections go
/// through here instead of `unwrap_err`.
fn compose_error(package: Package, components: HashMap<String, (Package, String)>) -> String {
    compose(package, components)
        .err()
        .expect("expected a load error")
}

#[test]
fn bundled_components_load_into_a_tree_keyed_by_the_prefixed_item_id() {
    let runtime = compose(composed(), bundled()).expect("a composed screen");
    assert_eq!(
        runtime.components.keys().collect::<Vec<_>>(),
        ["a", "a/c", "b"]
    );
    // Each instance keeps its own state; the parent's never leaves the root.
    let config =
        |path: &str| runtime.components[path].state_json().expect("child state")["config"].clone();
    assert_eq!(config("a"), json!({"status": "受注", "query": "x"}));
    // The grandchild binds a key `init` of the middle instance derived from its own config.
    assert_eq!(config("a/c"), json!({"query": "x"}));
    assert_eq!(config("b"), json!({"status": "出荷済"}));
    assert_eq!(
        runtime.state_json().expect("root state"),
        json!({"query": "x"})
    );
    assert_eq!(runtime.revision, 0);
}

#[test]
fn an_instance_tree_stays_within_three_levels() {
    // Three distinct packages, so the depth is reached before the circular check can fire.
    let deep = |id: &str, url: &str, item_id: &str| {
        part(
            id,
            json!({}),
            json!({"part": {"url": url}}),
            json!([component("part", item_id, json!({}))]),
        )
    };
    let components = bundle(vec![
        ("one.json", deep("one", "two.json", "b"), CHILD_SCRIPT),
        ("two.json", deep("two", "three.json", "c"), CHILD_SCRIPT),
        ("three.json", leaf(), CHILD_SCRIPT),
    ]);
    let root = part(
        "parent",
        json!({}),
        json!({"part": {"url": "one.json"}}),
        json!([component("part", "a", json!({}))]),
    );
    assert_eq!(
        compose_error(root, components),
        "Component a/b/c: nesting depth exceeds 3"
    );
}

#[test]
fn a_screen_holds_at_most_eight_instances_including_the_root() {
    let components = bundle(vec![("leaf.json", leaf(), CHILD_SCRIPT)]);
    let screen = |count: usize| {
        part(
            "parent",
            json!({}),
            json!({"leaf": {"url": "leaf.json"}}),
            Value::Array(
                (0..count)
                    .map(|i| component("leaf", &format!("c{i}"), json!({})))
                    .collect(),
            ),
        )
    };
    let runtime = compose(screen(7), components.clone()).expect("seven components");
    assert_eq!(runtime.components.len(), 7);
    assert_eq!(
        compose_error(screen(8), components),
        "At most 8 instances per screen (root included); exceeded at component c7"
    );
}

#[test]
fn a_component_cannot_reach_itself_through_its_own_declarations() {
    let recursive = part(
        "loop",
        json!({}),
        json!({"part": {"url": "loop.json"}}),
        json!([component("part", "b", json!({}))]),
    );
    let root = part(
        "parent",
        json!({}),
        json!({"part": {"url": "loop.json"}}),
        json!([component("part", "a", json!({}))]),
    );
    assert_eq!(
        compose_error(root, bundle(vec![("loop.json", recursive, CHILD_SCRIPT)])),
        "Component a/b: circular reference to loop.json"
    );
}

#[test]
fn a_component_needs_its_package_bundled_and_a_config_the_parent_state_answers() {
    assert_eq!(
        compose_error(
            composed(),
            bundle(vec![("leaf.json", leaf(), CHILD_SCRIPT)])
        ),
        "Component a: package middle.json was not bundled"
    );
    let unbound = part(
        "parent",
        json!({"query": "x"}),
        json!({"leaf": {"url": "leaf.json"}}),
        json!([component("leaf", "a", json!({"q": {"bind": "missing"}}))]),
    );
    assert_eq!(
        compose_error(unbound, bundled()),
        "Component a: config bind missing is not in the parent state"
    );
}

#[test]
fn the_per_instance_limits_of_a_child_name_the_component_that_broke_them() {
    let root = part(
        "parent",
        json!({}),
        json!({"leaf": {"url": "leaf.json"}}),
        json!([component("leaf", "a", json!({}))]),
    );
    let long = format!("{CHILD_SCRIPT} // {}", "x".repeat(100_001));
    assert_eq!(
        compose_error(
            root.clone(),
            bundle(vec![("leaf.json", leaf(), long.as_str())])
        ),
        "Component a: Script exceeds 100 KB"
    );
    let crowded = part(
        "leaf",
        json!({}),
        json!({}),
        Value::Array(
            (0..201)
                .map(|_| json!({"xtype": "label", "text": "x"}))
                .collect(),
        ),
    );
    assert_eq!(
        compose_error(
            root.clone(),
            bundle(vec![("leaf.json", crowded, CHILD_SCRIPT)])
        ),
        "Component a: UI exceeds 200 nodes or 20 nesting levels"
    );
    // A child whose state is not an object is refused rather than indexed into.
    let mut scalar = leaf();
    scalar.state = json!(1);
    assert_eq!(
        compose_error(root, bundle(vec![("leaf.json", scalar, CHILD_SCRIPT)])),
        "Component a: Initial state must be an object"
    );
}

// --- laying out an instance tree ---

/// `list.json` — a child tall enough to move what follows it, holding an itemId (`search`) its
/// parent uses as well.
fn list_part() -> Package {
    part(
        "list",
        json!({"query": "", "rows": [{"number": "SO-001"}, {"number": "SO-002"}]}),
        json!({}),
        json!([
            {"xtype": "textfield", "itemId": "search", "bind": "query", "fieldLabel": "絞り込み"},
            {
                "xtype": "grid", "itemId": "orders", "bind": "rows",
                "columns": [{"text": "番号", "dataIndex": "number"}],
            },
        ]),
    )
}

/// `middle.json` of the layout fixtures — places the same list one level further down.
fn middle_list() -> Package {
    part(
        "middle",
        json!({}),
        json!({"list": {"url": "list.json"}}),
        json!([
            {"xtype": "label", "itemId": "caption", "text": "内訳"},
            component("list", "c", json!({})),
        ]),
    )
}

/// A screen declaring `list` and placing whatever the test puts in `items`.
fn listing(items: Value) -> Package {
    part(
        "parent",
        json!({"query": "", "ready": false}),
        json!({"list": {"url": "list.json"}}),
        items,
    )
}

fn list_bundle() -> HashMap<String, (Package, String)> {
    bundle(vec![("list.json", list_part(), CHILD_SCRIPT)])
}

/// Replace one top-level key of an instance state. Stands in for the dispatch of a later task,
/// which is what moves a child state once the screen is running.
fn set_state(instance: &mut instance::Instance, key: &str, value: Value) {
    let mut state = instance.state_json().expect("an instance state");
    state[key] = value;
    instance.state = rhai::serde::to_dynamic(state).expect("a state map");
}

fn keys(scene: &Scene) -> Vec<String> {
    scene.widgets.iter().map(|w| w.key.clone()).collect()
}

fn count_rows(scene: &Scene, prefix: &str) -> usize {
    scene
        .widgets
        .iter()
        .filter(|w| w.key.starts_with(&format!("{prefix}orders:row:")))
        .count()
}

fn widget_at<'a>(scene: &'a Scene, key: &str) -> &'a Widget {
    scene
        .widgets
        .iter()
        .find(|w| w.key == key)
        .unwrap_or_else(|| panic!("no widget {key} in {:?}", keys(scene)))
}

#[test]
fn component_widgets_carry_the_prefix_that_keeps_a_shared_item_id_unique() {
    let runtime = compose(
        listing(json!([
            {"xtype": "textfield", "itemId": "search", "bind": "query", "fieldLabel": "検索"},
            component("list", "a", json!({})),
        ])),
        list_bundle(),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    let keys = keys(&scene);
    assert_eq!(
        keys.iter().collect::<BTreeSet<_>>().len(),
        keys.len(),
        "{keys:?}"
    );
    assert!(keys.contains(&"search".to_owned()), "{keys:?}");
    // The child keeps its own itemIds; only the prefix tells the two `search` fields apart.
    assert_eq!(widget_at(&scene, "a/search").target, "a/search");
    assert_eq!(widget_at(&scene, "search").target, "search");
    for widget in scene.widgets.iter().filter(|w| w.key.starts_with("a/")) {
        assert!(
            widget.target.is_empty() || widget.target.starts_with("a/"),
            "{} targets {}",
            widget.key,
            widget.target
        );
    }
    // Nothing of the child leaks into the root state or the window layer.
    assert_eq!(
        runtime.state_json().expect("root state"),
        json!({"query": "", "ready": false})
    );
    assert!(scene.modal.is_none());
}

#[test]
fn two_placements_of_one_package_lay_out_and_move_on_their_own() {
    let mut runtime = compose(
        part(
            "parent",
            json!({}),
            json!({"middle": {"url": "middle.json"}, "list": {"url": "list.json"}}),
            json!([
                component("middle", "a", json!({})),
                component("list", "b", json!({})),
            ]),
        ),
        bundle(vec![
            ("middle.json", middle_list(), CHILD_SCRIPT),
            ("list.json", list_part(), CHILD_SCRIPT),
        ]),
    )
    .expect("a composed screen");
    // The template the loader walks and the resolved ui the layout walks place the same nodes.
    let item_ids = |ui: &Node| {
        let mut nodes = Vec::new();
        composition::component_nodes(ui, &mut nodes);
        nodes
            .iter()
            .map(|n| n.item_id.clone())
            .collect::<Vec<String>>()
    };
    assert_eq!(
        item_ids(&runtime.root.package.ui),
        item_ids(&runtime.root.ui)
    );
    let scene = runtime.layout(800.0).expect("a scene");
    let keys = keys(&scene);
    assert_eq!(
        keys.iter().collect::<BTreeSet<_>>().len(),
        keys.len(),
        "{keys:?}"
    );
    assert!(keys.contains(&"a/c/orders:header".to_owned()), "{keys:?}");
    assert!(keys.contains(&"b/orders:header".to_owned()), "{keys:?}");
    assert_eq!(widget_at(&scene, "a/c/search").target, "a/c/search");
    assert_eq!(
        (count_rows(&scene, "a/c/"), count_rows(&scene, "b/")),
        (2, 2)
    );
    // Moving one instance leaves its twin where it was.
    set_state(
        runtime.components.get_mut("b").expect("b"),
        "rows",
        json!([{"number": "SO-009"}]),
    );
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(
        (count_rows(&scene, "a/c/"), count_rows(&scene, "b/")),
        (2, 1)
    );
}

#[test]
fn the_height_of_a_child_moves_what_the_parent_places_after_it() {
    let mut runtime = compose(
        listing(json!([
            component("list", "a", json!({})),
            {"xtype": "label", "itemId": "footer", "text": "合計"},
        ])),
        list_bundle(),
    )
    .expect("a composed screen");
    let footer = |runtime: &Runtime| {
        let scene = runtime.layout(800.0).expect("a scene");
        (widget_at(&scene, "footer").y, scene.height)
    };
    let (before, height) = footer(&runtime);
    set_state(
        runtime.components.get_mut("a").expect("a"),
        "rows",
        json!([{"number": "1"}, {"number": "2"}, {"number": "3"}, {"number": "4"}]),
    );
    let (after, taller) = footer(&runtime);
    // Two more grid rows of 42 push the footer and the screen down by the same amount.
    assert_eq!(after - before, 84.0);
    assert_eq!(taller - height, 84.0);
}

#[test]
fn a_component_the_parent_hides_lays_out_nothing() {
    let mut runtime = compose(
        listing(json!([
            {"xtype": "list", "itemId": "a", "config": {}, "visibleBind": "ready"},
            {"xtype": "label", "itemId": "footer", "text": "合計"},
        ])),
        list_bundle(),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    assert!(
        !scene.widgets.iter().any(|w| w.key.starts_with("a/")),
        "{:?}",
        keys(&scene)
    );
    let hidden = widget_at(&scene, "footer").y;
    set_state(&mut runtime.root, "ready", json!(true));
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(count_rows(&scene, "a/"), 2);
    assert!(widget_at(&scene, "footer").y > hidden);
}

#[test]
fn a_disabled_parent_disables_the_widgets_of_the_child_below_it() {
    let runtime = compose(
        listing(json!([{
            "xtype": "panel", "itemId": "wrap", "title": "受注", "disabled": true,
            "items": [component("list", "a", json!({}))],
        }])),
        list_bundle(),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    let child: Vec<&Widget> = scene
        .widgets
        .iter()
        .filter(|w| w.key.starts_with("a/"))
        .collect();
    assert!(!child.is_empty());
    assert!(child.iter().all(|w| w.disabled), "{:?}", keys(&scene));
}

#[test]
fn a_composed_screen_lays_out_at_every_viewport_width() {
    let runtime = compose(
        part(
            "parent",
            json!({}),
            json!({"middle": {"url": "middle.json"}, "list": {"url": "list.json"}}),
            json!([
                component("middle", "a", json!({})),
                component("list", "b", json!({})),
            ]),
        ),
        bundle(vec![
            ("middle.json", middle_list(), CHILD_SCRIPT),
            ("list.json", list_part(), CHILD_SCRIPT),
        ]),
    )
    .expect("a composed screen");
    assert!(runtime.layout(239.0).is_err());
    for width in [240.0, 800.0, 4096.0] {
        let scene = runtime.layout(width).expect("a scene");
        assert!(scene.height.is_finite() && scene.height >= 0.0);
        for w in &scene.widgets {
            assert!(
                w.x.is_finite() && w.y.is_finite() && w.width >= 0.0 && w.height >= 0.0,
                "{} at {width}: {} {} {} {}",
                w.key,
                w.x,
                w.y,
                w.width,
                w.height
            );
        }
    }
    // The scope of a finished layout is closed, so no instance tree outlives its pass.
    assert!(composition::with_component("b", |_, _| ()).is_none());
}

// --- routing an event to the instance that owns it ---

const PANEL_SCRIPT: &str = "fn init(s) { s }
fn select(s, e) { s.selected = e.id; s }
fn press(s, e) { s.count += 1; s }
fn refuse(s, e) { throw \"the child refused\"; }";

/// `panel.json` — a child holding the three outcomes an event can have: a grid selection and a
/// button that move its own state, and a handler that fails.
fn panel_part() -> Package {
    part(
        "panel",
        json!({
            "selected": 0, "count": 0,
            "rows": [{"id": 1, "number": "SO-001"}, {"id": 2, "number": "SO-002"}],
        }),
        json!({}),
        json!([
            {
                "xtype": "grid", "itemId": "orders", "bind": "rows",
                "selectedBind": "selected", "handler": "select",
                "columns": [{"text": "番号", "dataIndex": "number"}],
            },
            {"xtype": "button", "itemId": "button", "text": "押す", "handler": "press"},
            {"xtype": "button", "itemId": "boom", "text": "失敗", "handler": "refuse"},
        ]),
    )
}

/// `middle.json` of the dispatch fixtures — one more level between the root and the panel.
fn middle_panel() -> Package {
    part(
        "middle",
        json!({}),
        json!({"part": {"url": "panel.json"}}),
        json!([component("part", "c", json!({}))]),
    )
}

/// A screen declaring both dispatch fixtures, with a root binding of its own.
fn acting(items: Value) -> Package {
    part(
        "parent",
        json!({"ready": false}),
        json!({"part": {"url": "panel.json"}, "mid": {"url": "middle.json"}}),
        items,
    )
}

fn panel_bundle() -> HashMap<String, (Package, String)> {
    bundle(vec![
        ("panel.json", panel_part(), PANEL_SCRIPT),
        ("middle.json", middle_panel(), CHILD_SCRIPT),
    ])
}

/// A root-side checkbox, so a test can move the root state without a handler of its own.
fn flag_field() -> Value {
    json!({"xtype": "checkbox", "itemId": "flag", "bind": "ready", "fieldLabel": "表示"})
}

fn child_state(runtime: &Runtime, path: &str) -> Value {
    runtime.components[path]
        .state_json()
        .expect("a child state")
}

fn dispatch_error(runtime: &mut Runtime, target: &str, payload: Value) -> String {
    runtime
        .dispatch(target, payload)
        .err()
        .expect("expected a dispatch error")
}

#[test]
fn an_event_prefixed_with_a_component_moves_that_instance_alone() {
    let mut runtime = compose(
        acting(json!([flag_field(), component("part", "a", json!({}))])),
        panel_bundle(),
    )
    .expect("a composed screen");
    runtime
        .dispatch("a/orders", json!({"id": 2}))
        .expect("the grid event of the child");
    assert_eq!(child_state(&runtime, "a")["selected"], json!(2));
    // One event is one revision, whichever instance it moved.
    assert_eq!(runtime.revision, 1);
    assert_eq!(
        runtime.state_json().expect("root state"),
        json!({"ready": false})
    );
    // A root event afterwards still moves the root and leaves the child where it is.
    runtime
        .dispatch("flag", json!({"value": true}))
        .expect("the root checkbox");
    assert_eq!(
        runtime.state_json().expect("root state"),
        json!({"ready": true})
    );
    assert_eq!(child_state(&runtime, "a")["selected"], json!(2));
    assert_eq!(runtime.revision, 2);
}

#[test]
fn an_event_for_a_child_under_a_disabled_parent_is_dropped() {
    let mut runtime = compose(
        acting(json!([{
            "xtype": "panel", "itemId": "wrap", "title": "受注", "disabled": true,
            "items": [component("part", "a", json!({}))],
        }])),
        panel_bundle(),
    )
    .expect("a composed screen");
    runtime
        .dispatch("a/button", json!({}))
        .expect("a dropped event");
    assert_eq!(child_state(&runtime, "a")["count"], json!(0));
    assert_eq!(runtime.revision, 0);
}

#[test]
fn an_event_for_a_component_the_parent_hides_is_dropped() {
    let mut runtime = compose(
        acting(json!([
            flag_field(),
            {"xtype": "part", "itemId": "a", "config": {}, "visibleBind": "ready"},
        ])),
        panel_bundle(),
    )
    .expect("a composed screen");
    runtime
        .dispatch("a/button", json!({}))
        .expect("a dropped event");
    assert_eq!(child_state(&runtime, "a")["count"], json!(0));
    assert_eq!(runtime.revision, 0);
    // Shown by the parent, the very same event arrives.
    runtime
        .dispatch("flag", json!({"value": true}))
        .expect("the root checkbox");
    runtime
        .dispatch("a/button", json!({}))
        .expect("the button of the child");
    assert_eq!(child_state(&runtime, "a")["count"], json!(1));
    assert_eq!(runtime.revision, 2);
}

#[test]
fn an_event_reaches_a_component_three_levels_down() {
    let mut runtime = compose(
        acting(json!([component("mid", "a", json!({}))])),
        panel_bundle(),
    )
    .expect("a composed screen");
    assert_eq!(runtime.components.keys().collect::<Vec<_>>(), ["a", "a/c"]);
    runtime
        .dispatch("a/c/button", json!({}))
        .expect("the button of the grandchild");
    assert_eq!(child_state(&runtime, "a/c")["count"], json!(1));
    assert_eq!(runtime.revision, 1);
}

#[test]
fn an_event_with_no_instance_to_route_it_to_is_an_unknown_item_id() {
    let mut runtime = compose(
        acting(json!([flag_field(), component("part", "a", json!({}))])),
        panel_bundle(),
    )
    .expect("a composed screen");
    // Unknown inside the child: the child names its own itemId, the path says where.
    assert_eq!(
        dispatch_error(&mut runtime, "a/nope", json!({})),
        "Component a: Unknown itemId: nope"
    );
    // Unknown, or not a component, on the way down: the route names the whole target.
    assert_eq!(
        dispatch_error(&mut runtime, "nope/x", json!({})),
        "Unknown itemId: nope/x"
    );
    assert_eq!(
        dispatch_error(&mut runtime, "flag/x", json!({})),
        "Unknown itemId: flag/x"
    );
    assert_eq!(runtime.revision, 0);
}

#[test]
fn a_failing_child_handler_leaves_the_whole_screen_where_it_was() {
    let mut runtime = compose(
        acting(json!([flag_field(), component("part", "a", json!({}))])),
        panel_bundle(),
    )
    .expect("a composed screen");
    runtime
        .dispatch("flag", json!({"value": true}))
        .expect("the root checkbox");
    let root = runtime.state_json().expect("root state");
    let child = child_state(&runtime, "a");
    let error = dispatch_error(&mut runtime, "a/boom", json!({}));
    assert!(
        error.starts_with("Component a: panel.rhai / boom / refuse:"),
        "{error}"
    );
    assert!(error.contains("the child refused"), "{error}");
    assert_eq!(runtime.state_json().expect("root state"), root);
    assert_eq!(child_state(&runtime, "a"), child);
    assert_eq!(runtime.revision, 1);
}
