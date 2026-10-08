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
        "",
        &extensions::ExtensionContext::default(),
    )
}

/// Load a package the way a parent loads a component: `emit` on top of the host effects, and
/// the screen-wide queues tagged with the path the parent placed it at.
fn load_child(package: Package, script: &str) -> Result<instance::Instance, String> {
    load_in(
        package,
        script,
        "a",
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
    path: &str,
    context: &extensions::ExtensionContext,
) -> Result<instance::Instance, String> {
    load_with(package, script, path, context, HashMap::new())
}

/// `load_in` for a package whose `rpc` definitions need descriptors of their own.
fn load_with(
    package: Package,
    script: &str,
    path: &str,
    context: &extensions::ExtensionContext,
    descriptors: HashMap<String, Vec<u8>>,
) -> Result<instance::Instance, String> {
    let mut dialogs = dialogs::Requests::default();
    let pages = pages::Requests::default();
    instance::Instance::load(
        package,
        script,
        descriptors,
        context,
        None,
        path,
        |_| {},
        &mut dialogs,
        &pages,
    )
}

/// The smallest child package: one button whose `run` handler each effect test fills in.
fn child_json() -> Value {
    json!({
        "version": 1, "id": "child", "title": "Child", "script": "child.rhai",
        "state": {"value": 0},
        "ui": {"xtype": "container", "items": [
            {"xtype": "button", "itemId": "run", "handler": "run"},
        ]},
    })
}

fn child() -> Package {
    serde_json::from_value(child_json()).expect("test child package")
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

/// Descriptors for a child that declares `rpc`, the same set `rpc-lab` ships with.
const DESCRIPTOR: &[u8] = include_bytes!("../../public/screens/rpc-demo.pb");

fn descriptor_set() -> HashMap<String, Vec<u8>> {
    HashMap::from([("rpc-demo.pb".to_owned(), DESCRIPTOR.to_vec())])
}

/// The `rpc` declaration of the child fixtures: one unary Connect call.
fn rpc_declaration() -> Value {
    json!({"echo": {
        "url": "http://127.0.0.1:4180/uivolve.demo.EchoService/Echo",
        "descriptor": "rpc-demo.pb", "service": "uivolve.demo.EchoService",
        "method": "Echo", "protocol": "connect", "handler": "done",
    }})
}

/// One effect kind a child may queue: the declaration it needs, the call that queues it, and
/// how many effects each channel of that instance makes ready — `(http, storage, files, rpc,
/// host)`. A child registers the same effect functions a root does, so each call is the real one.
fn effect_cases() -> Vec<(&'static str, Value, &'static str, [usize; 5])> {
    let files = json!({"vol": {"backend": "opfs", "access": "readwrite", "handler": "done"}});
    vec![
        (
            "http_get",
            json!({"requests": {"load": {"url": "d.json", "handler": "done"}}}),
            "http_get(\"load\")",
            [1, 0, 0, 0, 0],
        ),
        (
            "storage_write",
            json!({"storage": {"draft": {"backend": "opfs", "key": "draft", "handler": "done"}}}),
            "storage_write(\"draft\", #{\"a\": 1})",
            [0, 1, 0, 0, 0],
        ),
        (
            "file_write_text",
            json!({"files": files.clone()}),
            "file_write_text(\"vol\", \"f.txt\", \"text\")",
            [0, 0, 1, 0, 0],
        ),
        // `file_bytes` builds the binary value a write takes, so both halves of R1 are a child's.
        (
            "file_write_bytes",
            json!({"files": files}),
            "file_write_bytes(\"vol\", \"f.bin\", file_bytes(\"x\"))",
            [0, 0, 1, 0, 0],
        ),
        (
            "rpc_call",
            json!({"rpc": rpc_declaration()}),
            "rpc_call(\"echo\", #{\"name\": \"太郎\"})",
            [0, 0, 0, 1, 0],
        ),
        (
            "host_call",
            json!({"operations": {"op": {"connection": "c", "action": "a", "handler": "done"}}}),
            "host_call(\"op\", #{})",
            [0, 0, 0, 0, 1],
        ),
    ]
}

/// Prepare and commit what a handler of this instance queued, the way `commit_all` does it for
/// every instance of a screen, and report how many effects each channel made ready.
fn commit_effects(instance: &mut instance::Instance) -> Result<[usize; 5], String> {
    let queued = instance.prepare_effects()?;
    instance.commit_effects(queued);
    Ok([
        instance.http.take().len(),
        instance.storage.take().len(),
        instance.files.take().len(),
        instance.rpc.take().len(),
        instance.host.take().len(),
    ])
}

#[test]
fn a_child_queues_the_host_effects_it_declares_into_its_own_channels() {
    for (label, declaration, call, expected) in effect_cases() {
        let mut package = child_json();
        let mut descriptors = HashMap::new();
        for (key, value) in declaration.as_object().expect("a declaration object") {
            if key == "rpc" {
                descriptors = descriptor_set();
            }
            package[key] = value.clone();
        }
        let package: Package =
            serde_json::from_value(package).unwrap_or_else(|e| panic!("{label}: {e}"));
        let script =
            format!("fn init(s) {{ s }} fn done(s, r) {{ s }} fn run(s, e) {{ {call}; s }}");
        let mut instance = load_with(
            package,
            &script,
            "a",
            &extensions::ExtensionContext::default(),
            descriptors,
        )
        .unwrap_or_else(|e| panic!("{label} should load as a child: {e}"));
        let _ = run_child(&instance, "run").unwrap_or_else(|e| panic!("{label}: {e}"));
        assert_eq!(
            commit_effects(&mut instance).unwrap_or_else(|e| panic!("{label}: {e}")),
            expected,
            "{label}"
        );
    }
}

/// A child declaring `rpc` without the descriptors its definitions name, and the same child
/// once `load_with_bundle` carries them.
#[test]
fn a_child_declaring_rpc_needs_its_own_descriptors_bundled() {
    let root = part(
        "parent",
        json!({}),
        json!({"part": {"url": "part.json"}}),
        json!([component("part", "a", json!({}))]),
    );
    let mut package = child_json();
    package["rpc"] = rpc_declaration();
    let package: Package = serde_json::from_value(package).expect("an rpc child package");
    let script = "fn init(s) { s } fn done(s, r) { s } fn run(s, e) { rpc_call(\"echo\", #{}); s }";
    assert_eq!(
        compose_error(
            root.clone(),
            bundle(vec![("part.json", package.clone(), script)])
        ),
        "Component a: RPC descriptors do not match definitions"
    );
    let bundled = HashMap::from([(
        "part.json".to_owned(),
        Bundle {
            package,
            script: script.to_owned(),
            descriptors: descriptor_set(),
        },
    )]);
    Runtime::load_with_bundle(root, SCRIPT, HashMap::new(), None, bundled, |_| {})
        .expect("a child whose descriptors are bundled with it");
}

/// A root placing one child, for the screen-wide queues the two of them share. The child
/// declares a page of its own, so `navigate` resolves there rather than on the root.
fn sharing(child_script: &str) -> Result<Runtime, String> {
    let mut child = child_json();
    child["pages"] = json!({"next": {"url": "next.json"}});
    child["ui"] = json!({"xtype": "container", "items": [
        {"xtype": "button", "itemId": "fire", "handler": "fire"},
    ]});
    let child: Package = serde_json::from_value(child).expect("the shared child package");
    compose_script(
        part(
            "parent",
            json!({"query": ""}),
            json!({"part": {"url": "part.json"}}),
            json!([component("part", "a", json!({}))]),
        ),
        SCRIPT,
        bundle(vec![("part.json", child, child_script)]),
    )
}

#[test]
fn a_dialog_a_child_asked_for_carries_the_path_of_that_child() {
    // The `init` of the child, which is where P4 says the tag has to be there already.
    let mut runtime = sharing("fn init(s) { alert(\"hi\"); s } fn fire(s, e) { s }")
        .expect("a child that alerts from init");
    let effects = runtime.dialogs.take();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0]["kind"], json!("dialog"));
    assert_eq!(effects[0]["instance"], json!("a"));

    // An event of the child, and a root dialog next to it: only the child's effect is tagged.
    let mut runtime = sharing(
        "fn init(s) { s } fn fire(s, e) { confirm(\"m\", \"done\"); s } fn done(s, r) { s }",
    )
    .expect("a child that confirms from a handler");
    runtime
        .dispatch("a/fire", json!({}))
        .expect("the child button");
    let effects = runtime.dialogs.take();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0]["instance"], json!("a"));
    assert_eq!(effects[0]["operation"], json!("confirm"));
}

#[test]
fn a_navigation_a_child_asked_for_resolves_and_is_tagged_in_that_child() {
    // The page name is looked up in the `pages` of the child, which the root does not declare.
    let mut runtime = sharing("fn init(s) { s } fn fire(s, e) { navigate(\"next\"); s }")
        .expect("a child that navigates from a handler");
    runtime
        .dispatch("a/fire", json!({}))
        .expect("the child button");
    let effects = runtime.pages.take();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0]["kind"], json!("navigate"));
    assert_eq!(effects[0]["page"], json!("next"));
    assert_eq!(effects[0]["instance"], json!("a"));

    // A page neither the child nor the root declares names the child that asked for it.
    let mut runtime = sharing("fn init(s) { s } fn fire(s, e) { navigate(\"nope\"); s }")
        .expect("a child that navigates to nothing");
    assert_eq!(
        dispatch_error(&mut runtime, "a/fire", json!({})),
        "Component a: Unknown page: nope"
    );
    assert_eq!(runtime.revision, 0);
}

#[test]
fn a_child_cannot_navigate_from_init_and_names_itself_when_it_does() {
    let error = sharing("fn init(s) { navigate(\"next\"); s } fn fire(s, e) { s }")
        .err()
        .expect("a child that navigates from init");
    assert_eq!(
        error,
        "Component a: navigate is only available in event handlers, not init"
    );
}

#[test]
fn a_dialog_handler_of_a_child_is_looked_up_in_the_script_of_that_child() {
    // The root script knows no `done`; the child does, so the dialog is accepted.
    let mut runtime = sharing(
        "fn init(s) { s } fn fire(s, e) { confirm(\"m\", \"done\"); s } fn done(s, r) { s }",
    )
    .expect("a child whose script defines the handler");
    assert!(!SCRIPT.contains("done"), "the root must not define it");
    runtime
        .dispatch("a/fire", json!({}))
        .expect("the child button");
    assert_eq!(runtime.dialogs.take().len(), 1);

    // Without it the child is named, rather than the root being searched instead.
    let mut runtime = sharing("fn init(s) { s } fn fire(s, e) { confirm(\"m\", \"done\"); s }")
        .expect("a child without the handler");
    assert_eq!(
        dispatch_error(&mut runtime, "a/fire", json!({})),
        "Component a: Dialog: undefined handler done(state, response)"
    );
    assert_eq!(runtime.revision, 0);
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
fn a_child_may_declare_host_effects_but_not_the_tool_surface() {
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
    ];
    // `rpc` needs descriptors of its own, which
    // `a_child_declaring_rpc_needs_its_own_descriptors_bundled` covers.
    for (key, value) in declarations {
        let mut package = child_json();
        package[key] = value;
        let package: Package =
            serde_json::from_value(package).unwrap_or_else(|e| panic!("{key}: {e}"));
        load_child(package, "fn init(s) { s } fn run(s, e) { s }")
            .unwrap_or_else(|e| panic!("{key} should load on a child: {e}"));
    }
    // The tool surface stays screen-wide: a child publishing one would speak for the root.
    let mut package = child_json();
    package["webmcp"] = json!({"description": "child"});
    let package: Package = serde_json::from_value(package).expect("a child with webmcp");
    assert_eq!(
        child_error(package, "fn init(s) { s } fn run(s, e) { s }"),
        "webmcp is not available in components (reserved for a later stage)"
    );
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
        "a",
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
    compose_script(package, SCRIPT, components)
}

/// Compose a screen whose root script the test brings along, for the listeners it declares.
fn compose_script(
    package: Package,
    script: &str,
    components: HashMap<String, (Package, String)>,
) -> Result<Runtime, String> {
    Runtime::load_with_components(package, script, HashMap::new(), None, components, |_| {})
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

// --- what a child announces, and what a moved parent state hands back down ---

/// The child of the transaction fixtures: a grid whose selection announces itself, a button that
/// announces something nobody listens for, and a `config` handler recording what it was handed.
const REPORT_SCRIPT: &str = "fn init(s) { s }
fn config(s, e) { s.configs += 1; s.seen = e.config.query; s }
fn select(s, e) { s.picked = e.id; emit(\"selected\", #{\"id\": e.id}); s }
fn whisper(s, e) { s.picked = 7; emit(\"unheard\", #{\"id\": 0}); s }";

/// The same child, refusing the configuration it is handed.
const ANGRY_SCRIPT: &str = "fn init(s) { s }
fn config(s, e) { throw \"the child refused the configuration\"; }
fn select(s, e) { s }
fn whisper(s, e) { s }";

/// The same child, announcing something from `config` — where no event is open to answer it.
const LOUD_SCRIPT: &str = "fn init(s) { s }
fn config(s, e) { emit(\"configured\", #{}); s }
fn select(s, e) { s }
fn whisper(s, e) { s }";

/// The middle of the chain: it listens to its own child and announces that further up.
const RELAY_SCRIPT: &str = "fn init(s) { s }
fn onPicked(s, e) { s.relayed = e.value.id; emit(\"picked\", #{\"id\": e.value.id, \"from\": e.target}); s }";

/// The root of the transaction fixtures: one listener per announcement it expects, and one that
/// refuses what it is told.
const PARENT_SCRIPT: &str = "fn init(s) { s }
fn onSelected(s, e) { s.notice = e.target + \"/\" + e.action + \"/\" + e.value.id; s }
fn onPicked(s, e) { s.notice = \"relay \" + e.value.from + \" \" + e.value.id; s }
fn boom(s, e) { throw \"the parent refused\"; }";

/// A component node that also names the handlers its parent answers announcements with.
fn listening(xtype: &str, item_id: &str, config: Value, listeners: Value) -> Value {
    json!({"xtype": xtype, "itemId": item_id, "config": config, "listeners": listeners})
}

/// One child body, with whichever of the scripts above the test bundles under its URL.
fn emitting(id: &str) -> Package {
    part(
        id,
        json!({
            "picked": 0, "configs": 0, "seen": "",
            "rows": [{"id": 1, "number": "SO-001"}, {"id": 2, "number": "SO-002"}],
        }),
        json!({}),
        json!([
            {
                "xtype": "grid", "itemId": "orders", "bind": "rows",
                "selectedBind": "picked", "handler": "select",
                "columns": [{"text": "番号", "dataIndex": "number"}],
            },
            {"xtype": "button", "itemId": "shout", "text": "知らせる", "handler": "whisper"},
        ]),
    )
}

/// `relay.json` — holds a `report` as `c`, so an announcement has two levels to climb.
fn relay_part() -> Package {
    part(
        "relay",
        json!({"relayed": 0}),
        json!({"report": {"url": "report.json"}}),
        json!([listening(
            "report",
            "c",
            json!({}),
            json!({"selected": "onPicked"})
        )]),
    )
}

/// A screen declaring every transaction fixture; each test places the ones it needs.
fn reporting(items: Value) -> Package {
    part(
        "parent",
        json!({"query": "", "notice": ""}),
        json!({
            "report": {"url": "report.json"},
            "angry": {"url": "angry.json"},
            "loud": {"url": "loud.json"},
            "relay": {"url": "relay.json"},
        }),
        items,
    )
}

fn report_bundle() -> HashMap<String, (Package, String)> {
    bundle(vec![
        ("report.json", emitting("report"), REPORT_SCRIPT),
        ("angry.json", emitting("angry"), ANGRY_SCRIPT),
        ("loud.json", emitting("loud"), LOUD_SCRIPT),
        ("relay.json", relay_part(), RELAY_SCRIPT),
    ])
}

/// A root-side textfield, so a test can move the key the configurations bind to.
fn filter_field() -> Value {
    json!({"xtype": "textfield", "itemId": "filter", "bind": "query", "fieldLabel": "絞り込み"})
}

fn reporting_screen(items: Value) -> Runtime {
    compose_script(reporting(items), PARENT_SCRIPT, report_bundle()).expect("a composed screen")
}

#[test]
fn an_emit_reaches_the_listener_the_parent_declared_on_the_node_holding_the_child() {
    let mut runtime = reporting_screen(json!([listening(
        "report",
        "a",
        json!({}),
        json!({"selected": "onSelected"})
    )]));
    runtime
        .dispatch("a/orders", json!({"id": 2}))
        .expect("the grid event of the child");
    // The event map names the placement, the announcement and its payload.
    assert_eq!(
        runtime.state_json().expect("root state")["notice"],
        json!("a/selected/2")
    );
    assert_eq!(child_state(&runtime, "a")["picked"], json!(2));
    // Child and parent moved inside one revision.
    assert_eq!(runtime.revision, 1);
}

#[test]
fn an_emit_no_listener_answers_still_commits_the_child_that_announced_it() {
    let mut runtime = reporting_screen(json!([listening(
        "report",
        "a",
        json!({}),
        json!({"selected": "onSelected"})
    )]));
    runtime
        .dispatch("a/shout", json!({}))
        .expect("the button of the child");
    assert_eq!(child_state(&runtime, "a")["picked"], json!(7));
    assert_eq!(
        runtime.state_json().expect("root state")["notice"],
        json!("")
    );
    assert_eq!(runtime.revision, 1);
}

#[test]
fn a_moved_parent_state_reconfigures_the_components_bound_to_what_changed() {
    let mut runtime = reporting_screen(json!([
        filter_field(),
        component("report", "bound", json!({"query": {"bind": "query"}})),
        component("report", "also", json!({"query": {"bind": "query"}})),
        component("report", "fixed", json!({"status": "受注"})),
    ]));
    runtime
        .dispatch("filter", json!({"value": "山田"}))
        .expect("the root textfield");
    for path in ["bound", "also"] {
        let child = child_state(&runtime, path);
        assert_eq!(child["config"], json!({"query": "山田"}), "{path}");
        assert_eq!(child["configs"], json!(1), "{path}");
        assert_eq!(child["seen"], json!("山田"), "{path}");
    }
    // A configuration the parent spelled out never changes, so its handler is never called.
    let fixed = child_state(&runtime, "fixed");
    assert_eq!(fixed["config"], json!({"status": "受注"}));
    assert_eq!(fixed["configs"], json!(0));
    assert_eq!(runtime.revision, 1);
    // The same value again leaves every configuration where it is.
    runtime
        .dispatch("filter", json!({"value": "山田"}))
        .expect("the root textfield");
    assert_eq!(child_state(&runtime, "bound")["configs"], json!(1));
    assert_eq!(runtime.revision, 2);
}

#[test]
fn the_state_of_a_child_stays_out_of_the_root_and_the_parent_state_out_of_the_child() {
    let mut runtime = reporting_screen(json!([
        filter_field(),
        listening(
            "report",
            "a",
            json!({"query": {"bind": "query"}}),
            json!({"selected": "onSelected"})
        ),
    ]));
    runtime
        .dispatch("filter", json!({"value": "山田"}))
        .expect("the root textfield");
    runtime
        .dispatch("a/orders", json!({"id": 1}))
        .expect("the grid event of the child");
    // The root state is its own keys only, whichever instance the events moved.
    assert_eq!(
        runtime.state_json().expect("root state"),
        json!({"query": "山田", "notice": "a/selected/1"})
    );
    // The child sees the parent only through the configuration it was handed.
    let child = child_state(&runtime, "a");
    assert_eq!(
        child
            .as_object()
            .expect("a child state")
            .keys()
            .collect::<Vec<_>>(),
        ["config", "configs", "picked", "rows", "seen"]
    );
    assert_eq!(child["config"], json!({"query": "山田"}));
}

#[test]
fn an_announcement_climbs_one_level_at_a_time_to_the_root() {
    let mut runtime = reporting_screen(json!([listening(
        "relay",
        "a",
        json!({}),
        json!({"picked": "onPicked"})
    )]));
    assert_eq!(runtime.components.keys().collect::<Vec<_>>(), ["a", "a/c"]);
    runtime
        .dispatch("a/c/orders", json!({"id": 1}))
        .expect("the grid event of the grandchild");
    assert_eq!(child_state(&runtime, "a/c")["picked"], json!(1));
    // The middle answered its own child and announced that further up itself.
    assert_eq!(child_state(&runtime, "a")["relayed"], json!(1));
    assert_eq!(
        runtime.state_json().expect("root state")["notice"],
        json!("relay c 1")
    );
    assert_eq!(runtime.revision, 1);
}

#[test]
fn a_listener_that_refuses_leaves_the_whole_screen_where_it_was() {
    let mut runtime = reporting_screen(json!([listening(
        "report",
        "a",
        json!({}),
        json!({"selected": "boom"})
    )]));
    let root = runtime.state_json().expect("root state");
    let child = child_state(&runtime, "a");
    let error = dispatch_error(&mut runtime, "a/orders", json!({"id": 2}));
    assert!(error.starts_with("parent.rhai / a / boom:"), "{error}");
    assert!(error.contains("the parent refused"), "{error}");
    assert_eq!(runtime.state_json().expect("root state"), root);
    assert_eq!(child_state(&runtime, "a"), child);
    assert_eq!(runtime.revision, 0);
}

#[test]
fn a_child_that_refuses_a_configuration_leaves_the_whole_screen_where_it_was() {
    let mut runtime = reporting_screen(json!([
        filter_field(),
        component("angry", "a", json!({"query": {"bind": "query"}})),
    ]));
    let child = child_state(&runtime, "a");
    let error = dispatch_error(&mut runtime, "filter", json!({"value": "山田"}));
    assert!(
        error.starts_with("Component a: angry.rhai / config:"),
        "{error}"
    );
    assert!(
        error.contains("the child refused the configuration"),
        "{error}"
    );
    assert_eq!(
        runtime.state_json().expect("root state"),
        json!({"query": "", "notice": ""})
    );
    assert_eq!(child_state(&runtime, "a"), child);
    assert_eq!(runtime.revision, 0);
}

/// The same child, announcing something and then failing: one variant throws, the other walks
/// into an undefined variable. Either way the announcement has no event left.
const STALE_SCRIPTS: [(&str, &str); 2] = [
    (
        "throw",
        "fn init(s) { s }
fn config(s, e) { s.configs += 1; s.seen = e.config.query; s }
fn select(s, e) { s }
fn whisper(s, e) { emit(\"unheard\", #{\"id\": 0}); throw \"the child refused\"; }",
    ),
    (
        "error",
        "fn init(s) { s }
fn config(s, e) { s.configs += 1; s.seen = e.config.query; s }
fn select(s, e) { s }
fn whisper(s, e) { emit(\"unheard\", #{\"id\": 0}); nope.x; s }",
    ),
];

/// A root holding an HTTP request of its own, so a completion can arrive after a failed event.
const REQUESTING_SCRIPT: &str = "fn init(s) { s }
fn fetch(s, e) { http_get(\"ping\"); s }
fn pong(s, r) { s.query = \"山田\"; s }";

fn requesting(items: Value) -> Package {
    serde_json::from_value(json!({
        "version": 1, "id": "parent", "title": "parent", "script": "parent.rhai",
        "state": {"query": "", "notice": ""},
        "components": {"stale": {"url": "stale.json"}},
        "requests": {"ping": {"url": "x.json", "handler": "pong"}},
        "ui": {"xtype": "container", "items": items},
    }))
    .expect("the requesting screen")
}

#[test]
fn a_stale_announcement_does_not_poison_a_later_completion() {
    for (label, script) in STALE_SCRIPTS {
        let mut runtime = compose_script(
            requesting(json!([
                {"xtype": "button", "itemId": "fetch", "text": "取得", "handler": "fetch"},
                component("stale", "a", json!({"query": {"bind": "query"}})),
            ])),
            REQUESTING_SCRIPT,
            bundle(vec![("stale.json", emitting("stale"), script)]),
        )
        .expect("a composed screen");
        runtime
            .dispatch("fetch", json!({}))
            .expect("the root button");
        let id = runtime.take_effects()[0]["id"]
            .as_u64()
            .expect("an http request id");
        // The child announces and then fails, so the event — announcement included — rolls back.
        assert!(runtime.dispatch("a/shout", json!({})).is_err(), "{label}");
        assert_eq!(runtime.revision, 1, "{label}");
        // The completion moves the key the configuration binds to: the child is reconfigured,
        // and what the failed event queued is no longer there to be taken for a config emit.
        runtime
            .complete_http(id, json!({"ok": true, "data": {}}))
            .unwrap_or_else(|e| panic!("{label}: {e}"));
        assert_eq!(runtime.revision, 2, "{label}");
        assert_eq!(
            runtime.state_json().expect("root state")["query"],
            json!("山田"),
            "{label}"
        );
        let child = child_state(&runtime, "a");
        assert_eq!(child["config"], json!({"query": "山田"}), "{label}");
        assert_eq!(child["configs"], json!(1), "{label}");
        assert_eq!(child["seen"], json!("山田"), "{label}");
    }
}

/// A middle that hands what it was configured with down to its own child.
const CHAIN_SCRIPT: &str = "fn init(s) { s }
fn config(s, e) { s.relayed = e.config.query; s }";

/// `chain.json` — holds a `report` as `c`, bound to the key its own `config` handler writes.
fn chain_part() -> Package {
    part(
        "chain",
        json!({"relayed": ""}),
        json!({"report": {"url": "report.json"}}),
        json!([component(
            "report",
            "c",
            json!({"query": {"bind": "relayed"}})
        )]),
    )
}

#[test]
fn a_configuration_travels_down_three_levels_at_run_time() {
    let mut runtime = compose_script(
        part(
            "parent",
            json!({"query": "", "notice": ""}),
            json!({"chain": {"url": "chain.json"}}),
            json!([
                filter_field(),
                component("chain", "a", json!({"query": {"bind": "query"}})),
            ]),
        ),
        PARENT_SCRIPT,
        bundle(vec![
            ("chain.json", chain_part(), CHAIN_SCRIPT),
            ("report.json", emitting("report"), REPORT_SCRIPT),
        ]),
    )
    .expect("a composed screen");
    assert_eq!(runtime.components.keys().collect::<Vec<_>>(), ["a", "a/c"]);
    runtime
        .dispatch("filter", json!({"value": "山田"}))
        .expect("the root textfield");
    // The middle wrote what it was handed into its own state, which the grandchild binds to.
    assert_eq!(child_state(&runtime, "a")["relayed"], json!("山田"));
    let leaf = child_state(&runtime, "a/c");
    assert_eq!(leaf["config"], json!({"query": "山田"}));
    assert_eq!(leaf["configs"], json!(1));
    assert_eq!(leaf["seen"], json!("山田"));
    // Three instances moved, one revision.
    assert_eq!(runtime.revision, 1);
}

#[test]
fn a_child_cannot_announce_anything_while_it_is_being_reconfigured() {
    let mut runtime = reporting_screen(json!([
        filter_field(),
        component("loud", "a", json!({"query": {"bind": "query"}})),
    ]));
    assert_eq!(
        dispatch_error(&mut runtime, "filter", json!({"value": "山田"})),
        "Component a: emit is not available in config"
    );
    assert_eq!(
        runtime.state_json().expect("root state"),
        json!({"query": "", "notice": ""})
    );
    assert_eq!(runtime.revision, 0);
}

// --- the routing of completions ---

/// The `rpc` declaration of the fixtures, pointed at a handler of the caller's choosing.
fn rpc_for(handler: &str) -> Value {
    let mut declaration = rpc_declaration();
    declaration["echo"]["handler"] = json!(handler);
    declaration
}

/// One button per effect kind, the two metrics the completion handlers write, and whatever
/// component node the instance places below them.
fn effecting_items(extra: Value) -> Value {
    let mut items: Vec<Value> = [
        "fire_http",
        "fire_storage",
        "fire_file",
        "fire_rpc",
        "fire_host",
        "fire_dialog",
        "fire_named",
        "fire_two",
    ]
    .iter()
    .map(|name| json!({"xtype": "button", "itemId": name, "handler": name}))
    .collect();
    items.push(json!({"xtype": "metric", "text": "最後", "bind": "last"}));
    items.push(json!({"xtype": "metric", "text": "通知", "bind": "notice"}));
    items.extend(extra.as_array().expect("the extra items").iter().cloned());
    Value::Array(items)
}

/// An instance of the routing fixtures: one declaration of every kind, so a completion of every
/// kind can be addressed to it. The eight HTTP requests are the per-instance maximum, which is
/// what lets a test queue a ninth one and be refused.
fn effecting(id: &str, components: Value, items: Value) -> Package {
    let requests: serde_json::Map<String, Value> = (1..=8)
        .map(|n| {
            (
                format!("r{n}"),
                json!({"url": format!("r{n}.json"), "handler": "done_http"}),
            )
        })
        .collect();
    serde_json::from_value(json!({
        "version": 1, "id": id, "title": id, "script": format!("{id}.rhai"),
        "state": {"last": "", "notice": ""},
        "components": components,
        "requests": requests,
        "storage": {"draft": {"backend": "opfs", "key": "draft", "handler": "done_storage"}},
        "files": {"vol": {"backend": "opfs", "access": "readwrite", "handler": "done_file"}},
        "rpc": rpc_for("done_rpc"),
        "operations": {"op": {
            "connection": "c", "action": "a", "handler": "done_host",
            "options": {"progressHandler": "on_progress"},
        }},
        "pages": {"next": {"url": "next.json"}},
        "ui": {"xtype": "container", "items": effecting_items(items)},
    }))
    .unwrap_or_else(|e| panic!("{id}: {e}"))
}

/// The script every instance of the routing fixtures runs. A child announces each completion to
/// its parent, which is the whole path R3 asks for: host → instance → handler → parent.
fn effecting_script(announce: bool) -> String {
    let announcement = match announce {
        true => "emit(\"done\", #{\"kind\": k});",
        false => "",
    };
    let announce_two = match announce {
        true => "emit(\"done\", #{\"kind\": \"two\"});",
        false => "",
    };
    format!(
        "fn init(s) {{ s }}
fn land(s, k) {{ s.last = k; {announcement} s }}
fn fire_http(s, e) {{ http_get(\"r1\"); s }}
fn fire_storage(s, e) {{ storage_write(\"draft\", #{{\"a\": 1}}); s }}
fn fire_file(s, e) {{ file_write_text(\"vol\", \"f.txt\", \"text\"); s }}
fn fire_rpc(s, e) {{ rpc_call(\"echo\", #{{\"name\": \"太郎\"}}); s }}
fn fire_host(s, e) {{ host_call(\"op\", #{{}}); s }}
fn fire_dialog(s, e) {{ confirm(\"m\", \"done_dialog\"); s }}
fn fire_named(s, e) {{ http_get(e.value); s }}
fn fire_two(s, e) {{ http_get(\"r1\"); http_get(\"r2\"); {announce_two} s }}
fn done_http(s, r) {{ land(s, \"http\") }}
fn done_storage(s, r) {{ land(s, \"storage\") }}
fn done_file(s, r) {{ land(s, \"file\") }}
fn done_rpc(s, r) {{ land(s, \"rpc\") }}
fn done_host(s, r) {{ land(s, \"host\") }}
fn on_progress(s, r) {{ land(s, \"progress\") }}
fn done_dialog(s, r) {{ land(s, \"dialog\") }}
fn on_done(s, e) {{ s.notice = e.target + \":\" + e.value.kind; s }}
fn refuse(s, e) {{ throw \"the parent refused\"; }}
fn flee(s, e) {{ navigate(\"next\"); s }}"
    )
}

/// A root, a child `a` and a grandchild `a/c`, each declaring one effect of every kind. The
/// listener the root answers the announcements of `a` with is the test's choice: `on_done`
/// records what arrived, `refuse` throws, `flee` navigates.
fn routing(listener: &str) -> Runtime {
    let leaf = effecting("leaf", json!({}), json!([]));
    let middle = effecting(
        "middle",
        json!({"part": {"url": "leaf.json"}}),
        json!([listening(
            "part",
            "c",
            json!({}),
            json!({"done": "on_done"})
        )]),
    );
    let root = effecting(
        "parent",
        json!({"part": {"url": "middle.json"}}),
        json!([listening("part", "a", json!({}), json!({"done": listener}))]),
    );
    let child_script = effecting_script(true);
    let bundled = HashMap::from([
        (
            "middle.json".to_owned(),
            Bundle {
                package: middle,
                script: child_script.clone(),
                descriptors: descriptor_set(),
            },
        ),
        (
            "leaf.json".to_owned(),
            Bundle {
                package: leaf,
                script: child_script,
                descriptors: descriptor_set(),
            },
        ),
    ]);
    Runtime::load_with_bundle(
        root,
        &effecting_script(false),
        descriptor_set(),
        None,
        bundled,
        |_| {},
    )
    .expect("the routing screen")
}

/// The error a completion fails with. `Runtime` is not `Debug`, so rejections go through here.
fn complete_error(runtime: &mut Runtime, instance: &str, completion: Completion) -> String {
    runtime
        .complete(instance, completion)
        .err()
        .expect("expected a failed completion")
}

/// The `(instance, kind)` of every effect the host is handed, in the order it is handed them.
fn effect_order(runtime: &mut Runtime) -> Vec<(String, String)> {
    runtime
        .take_effects()
        .iter()
        .map(|effect| {
            (
                effect["instance"].as_str().unwrap_or("").to_owned(),
                effect["kind"].as_str().expect("an effect kind").to_owned(),
            )
        })
        .collect()
}

/// An HTTP response that succeeds, the shape every channel of these fixtures accepts.
fn answered() -> Value {
    json!({"ok": true, "data": {}, "error": ""})
}

#[test]
fn the_effect_of_a_child_names_the_instance_the_response_has_to_come_back_to() {
    let mut runtime = routing("on_done");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let effects = runtime.take_effects();
    assert_eq!(effects.len(), 1);
    assert_eq!(
        effects[0]
            .as_object()
            .expect("an effect object")
            .keys()
            .collect::<Vec<_>>(),
        ["id", "instance", "kind", "request", "url"]
    );
    assert_eq!(effects[0]["instance"], json!("a"));
    assert_eq!(effects[0]["kind"], json!("http"));
    assert_eq!(effects[0]["request"], json!("r1"));
    assert_eq!(effects[0]["url"], json!("r1.json"));

    // The root answers for itself, so its own effects carry no instance at all.
    runtime
        .dispatch("fire_http", json!({}))
        .expect("the root button");
    let effects = runtime.take_effects();
    assert_eq!(effects.len(), 1);
    assert_eq!(
        effects[0]
            .as_object()
            .expect("an effect object")
            .keys()
            .collect::<Vec<_>>(),
        ["id", "kind", "request", "url"]
    );
}

#[test]
fn two_instances_number_their_requests_apart_and_are_told_apart_by_the_instance() {
    let mut runtime = routing("on_done");
    runtime
        .dispatch("fire_http", json!({}))
        .expect("the root button");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let effects = runtime.take_effects();
    assert_eq!(effects.len(), 2);
    // Each channel counts for itself, so the first request of every instance is id 1.
    assert_eq!(effects[0]["id"], json!(1));
    assert_eq!(effects[1]["id"], json!(1));
    assert!(effects[0].get("instance").is_none(), "{:?}", effects[0]);
    assert_eq!(effects[1]["instance"], json!("a"));
}

#[test]
fn a_completion_of_a_child_travels_up_to_the_listeners_of_the_root() {
    let mut runtime = routing("on_done");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let revision = runtime.revision;
    runtime
        .complete(
            "a",
            Completion::Http {
                id: 1,
                response: answered(),
            },
        )
        .expect("the completion of the child");
    assert_eq!(child_state(&runtime, "a")["last"], json!("http"));
    assert_eq!(
        runtime.state_json().expect("root state")["notice"],
        json!("a:http")
    );
    // The response moved two instances; the screen still counts one step.
    assert_eq!(runtime.revision, revision + 1);
}

#[test]
fn a_listener_that_refuses_a_completion_rolls_the_screen_back_but_not_the_request() {
    let mut runtime = routing("refuse");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let before = runtime.state_json().expect("root state");
    let child_before = child_state(&runtime, "a");
    let revision = runtime.revision;
    let error = complete_error(
        &mut runtime,
        "a",
        Completion::Http {
            id: 1,
            response: answered(),
        },
    );
    assert!(error.contains("the parent refused"), "{error}");
    assert_eq!(runtime.state_json().expect("root state"), before);
    assert_eq!(child_state(&runtime, "a"), child_before);
    assert_eq!(runtime.revision, revision);
    // The response was delivered once: the request is gone whether the screen moved or not.
    assert_eq!(
        complete_error(
            &mut runtime,
            "a",
            Completion::Http {
                id: 1,
                response: answered()
            }
        ),
        "Component a: Unknown or completed HTTP request"
    );
}

/// One completion kind: the button that queues it, the response the host sends back, and what
/// the handler of that kind writes into `last`.
fn completion_cases() -> Vec<(&'static str, fn(u64) -> Completion, &'static str)> {
    vec![
        (
            "fire_http",
            (|id| Completion::Http {
                id,
                response: answered(),
            }) as fn(u64) -> Completion,
            "http",
        ),
        (
            "fire_storage",
            |id| Completion::Storage {
                id,
                response: answered(),
            },
            "storage",
        ),
        (
            "fire_file",
            |id| Completion::File {
                id,
                response: answered(),
                buffer: None,
            },
            "file",
        ),
        // A failed call is the one RPC completion that needs no encoded response message.
        (
            "fire_rpc",
            |id| Completion::Rpc {
                id,
                response: json!({"ok": false, "data": null, "error": "no"}),
                buffer: None,
            },
            "rpc",
        ),
        (
            "fire_host",
            |id| Completion::Host {
                id,
                response: json!({"ok": true, "data": null, "error": null}),
            },
            "host",
        ),
        (
            "fire_host",
            |id| Completion::HostProgress {
                id,
                data: json!({"operation": "op", "transferred": 0, "total": null}),
            },
            "progress",
        ),
        (
            "fire_dialog",
            |id| Completion::Dialog {
                id,
                response: json!({"ok": true, "data": true, "error": ""}),
            },
            "dialog",
        ),
    ]
}

#[test]
fn every_kind_of_completion_reaches_a_child_and_a_grandchild() {
    for path in ["a", "a/c"] {
        for (button, completion, expected) in completion_cases() {
            let mut runtime = routing("on_done");
            runtime
                .dispatch(&format!("{path}/{button}"), json!({}))
                .unwrap_or_else(|e| panic!("{path} {button}: {e}"));
            let effects = runtime.take_effects();
            assert_eq!(effects.len(), 1, "{path} {button}");
            assert_eq!(effects[0]["instance"], json!(path), "{path} {button}");
            let id = effects[0]["id"].as_u64().expect("an effect id");
            runtime
                .complete(path, completion(id))
                .unwrap_or_else(|e| panic!("{path} {button} {expected}: {e}"));
            assert_eq!(
                child_state(&runtime, path)["last"],
                json!(expected),
                "{path} {button} {expected}"
            );
        }
    }
}

#[test]
fn a_dialog_of_a_child_is_answered_through_the_screen_as_well_as_through_the_instance() {
    for path in ["a", "a/c"] {
        let mut runtime = routing("on_done");
        runtime
            .dispatch(&format!("{path}/fire_dialog"), json!({}))
            .expect("the dialog button");
        let id = runtime.take_effects()[0]["id"]
            .as_u64()
            .expect("a dialog id");
        // The screen-wide route: the modal of the active dialog, which names no instance.
        runtime
            .dispatch(&format!(":dialog:{id}:ok"), json!({}))
            .unwrap_or_else(|e| panic!("{path}: {e}"));
        assert_eq!(
            child_state(&runtime, path)["last"],
            json!("dialog"),
            "{path}"
        );
    }
}

#[test]
fn the_root_keeps_the_ids_of_its_own_requests_apart_from_the_ones_of_a_child() {
    // The id of the child, sent back without an instance, is nothing the root ever handed out.
    let mut runtime = routing("on_done");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let id = runtime.take_effects()[0]["id"]
        .as_u64()
        .expect("an effect id");
    assert_eq!(
        complete_error(
            &mut runtime,
            "",
            Completion::Http {
                id,
                response: answered()
            }
        ),
        "Unknown or completed HTTP request"
    );

    // Once the root has a request of its own with that id, the same answer is its own.
    runtime
        .dispatch("fire_http", json!({}))
        .expect("the root button");
    assert_eq!(runtime.take_effects()[0]["id"].as_u64(), Some(id));
    runtime
        .complete(
            "",
            Completion::Http {
                id,
                response: answered(),
            },
        )
        .expect("the completion of the root");
    assert_eq!(
        runtime.state_json().expect("root state")["last"],
        json!("http")
    );
    // The request of the child is still waiting for an answer addressed to it.
    assert_eq!(child_state(&runtime, "a")["last"], json!(""));
}

#[test]
fn naming_the_wrong_instance_reaches_nothing_and_swallows_nothing() {
    let mut runtime = routing("on_done");
    assert_eq!(
        complete_error(
            &mut runtime,
            "nope",
            Completion::Http {
                id: 1,
                response: answered()
            }
        ),
        "Unknown component instance: nope"
    );

    // A dialog of the root, claimed by a child: the request stays pending for its real owner.
    runtime
        .dispatch("fire_dialog", json!({}))
        .expect("the root dialog button");
    let id = runtime.take_effects()[0]["id"]
        .as_u64()
        .expect("a dialog id");
    let response = json!({"ok": true, "data": true, "error": ""});
    assert_eq!(
        complete_error(
            &mut runtime,
            "a",
            Completion::Dialog {
                id,
                response: response.clone()
            }
        ),
        "Component a: Unknown or completed dialog request"
    );
    assert_eq!(child_state(&runtime, "a")["last"], json!(""));
    runtime
        .complete("", Completion::Dialog { id, response })
        .expect("the owner of the dialog");
    assert_eq!(
        runtime.state_json().expect("root state")["last"],
        json!("dialog")
    );
}

#[test]
fn a_navigation_of_the_root_cannot_be_combined_with_the_effects_of_a_child() {
    // The handler of the child queues two requests and announces; the listener of the root
    // answers by navigating. The exclusion counts the effects of every instance together.
    let mut runtime = routing("flee");
    assert_eq!(
        dispatch_error(&mut runtime, "a/fire_two", json!({})),
        "Navigation cannot be combined with other effects in the same handler"
    );
    assert_eq!(runtime.revision, 0);
    assert_eq!(child_state(&runtime, "a")["last"], json!(""));
    assert_eq!(
        runtime.state_json().expect("root state")["notice"],
        json!("")
    );
    assert!(runtime.take_effects().is_empty());
    // Nothing of what the failed handler queued became pending, in either instance.
    let mut runtime = routing("on_done");
    runtime
        .dispatch("a/fire_two", json!({}))
        .expect("the child button");
    assert_eq!(runtime.take_effects().len(), 2);
}

#[test]
fn the_pending_requests_of_a_child_are_counted_in_that_child_alone() {
    let mut runtime = routing("on_done");
    for n in 1..=8 {
        runtime
            .dispatch("a/fire_named", json!({"value": format!("r{n}")}))
            .unwrap_or_else(|e| panic!("r{n}: {e}"));
    }
    assert_eq!(runtime.take_effects().len(), 8);
    assert_eq!(
        dispatch_error(&mut runtime, "a/fire_named", json!({"value": "r1"})),
        "Component a: At most 8 pending HTTP requests"
    );
    // The root counts its own, so it still has all eight of them left.
    for n in 1..=8 {
        runtime
            .dispatch("fire_named", json!({"value": format!("r{n}")}))
            .unwrap_or_else(|e| panic!("r{n}: {e}"));
    }
    assert_eq!(runtime.take_effects().len(), 8);
    assert_eq!(
        dispatch_error(&mut runtime, "fire_named", json!({"value": "r1"})),
        "At most 8 pending HTTP requests"
    );
}

#[test]
fn the_effects_of_the_root_come_first_and_the_children_follow_in_path_order() {
    let mut runtime = routing("on_done");
    for target in [
        "a/c/fire_host",
        "a/c/fire_http",
        "a/fire_host",
        "a/fire_http",
        "fire_host",
        "fire_http",
    ] {
        runtime
            .dispatch(target, json!({}))
            .unwrap_or_else(|e| panic!("{target}: {e}"));
    }
    // Within an instance the channels report in a fixed order, and the instances follow the
    // keys of the tree — not the order the handlers happened to run in.
    assert_eq!(
        effect_order(&mut runtime),
        [
            ("", "http"),
            ("", "host"),
            ("a", "http"),
            ("a", "host"),
            ("a/c", "http"),
            ("a/c", "host"),
        ]
        .map(|(instance, kind)| (instance.to_owned(), kind.to_owned()))
    );
}

#[test]
fn an_instance_path_the_host_sends_back_has_to_be_a_path() {
    for path in ["a", "a/b", "a/b/c", "open"] {
        assert!(composition::valid_instance_path(path), "{path}");
    }
    for path in ["", "/a", "a/", "a//b", "a:b", ":dialog:1:ok", "/"] {
        assert!(!composition::valid_instance_path(path), "{path}");
    }
}
