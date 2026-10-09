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

/// The script `child_json` needs, for the tests that fill in a declaration keyed to `run`.
const CHILD_RUN_SCRIPT: &str = "fn init(s) { s } fn run(s, e) { s }";

/// A screen declaring one component from `url` and placing it at `item_id`: the only way to see
/// the `Component {path}: ` prefix a composed load puts in front of a child's own error.
fn placing(url: &str, item_id: &str) -> Package {
    part(
        "parent",
        json!({}),
        json!({"child": {"url": url}}),
        json!([component("child", item_id, json!({}))]),
    )
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
        assert_eq!(error, "window is not available in components", "{xtype}");
        // The same template is fine on a root, so the rejection is about being a component.
        load(package, SCRIPT).unwrap_or_else(|e| panic!("{xtype} should load on a root: {e}"));
    }
}

#[test]
fn a_child_may_declare_host_effects_and_the_tool_surface() {
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
        // A child describes itself for the tool surface too; `Scene.webmcp` stays the root's.
        ("webmcp", json!({"description": "部品", "tags": ["part"]})),
    ];
    // `rpc` needs descriptors of its own, which
    // `a_child_declaring_rpc_needs_its_own_descriptors_bundled` covers.
    for (key, value) in declarations {
        let mut package = child_json();
        package[key] = value;
        let package: Package =
            serde_json::from_value(package).unwrap_or_else(|e| panic!("{key}: {e}"));
        load_child(package, CHILD_RUN_SCRIPT)
            .unwrap_or_else(|e| panic!("{key} should load on a child: {e}"));
    }
    // The limits are the root's; only the placement is added in front of the message.
    let mut package = child_json();
    package["webmcp"] = json!({"description": "x".repeat(2001)});
    let package: Package = serde_json::from_value(package).expect("a child with webmcp");
    let error = compose_error(
        placing("child.json", "part"),
        bundle(vec![("child.json", package, CHILD_RUN_SCRIPT)]),
    );
    assert!(error.starts_with("Component part: "), "{error}");
    assert!(
        error.ends_with("webmcp: description/label/tags exceed limits or have duplicate tags"),
        "{error}"
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

// --- the storage scope of an instance ---

/// One row of `tests/helpers/component-scope-cases.json`, the table the JS side reads as well.
/// A `scope` of `null` is a pair the rule has to refuse.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopeCase {
    root_id: String,
    path: String,
    scope: Option<String>,
}

const STORING_SCRIPT: &str = "fn init(s) { s } fn landed(s, r) { s }";

/// A child package keying a storage request of its own, so its placement needs a scope. With
/// `json!({})` it declares neither storage nor files and the rule leaves it alone.
fn storing(declarations: Value) -> Package {
    serde_json::from_value(json!({
        "version": 1, "id": "part", "title": "part", "script": "part.rhai",
        "state": {"value": 0},
        "storage": declarations,
        "ui": {"xtype": "container", "items": [
            {"xtype": "metric", "text": "件数", "bind": "value"},
        ]},
    }))
    .expect("the storing child package")
}

fn stored() -> Value {
    json!({"draft": {"backend": "opfs", "key": "draft", "handler": "landed"}})
}

/// A screen whose id (`orders`) heads the scope of every instance below it. One itemId places
/// the child on the root; two place it under a middle instance, at the path they spell.
fn scoped(item_ids: &[&str], declarations: Value) -> Result<Runtime, String> {
    let (deepest, above) = item_ids.split_last().expect("at least one itemId");
    let placement = json!([component("part", deepest, json!({}))]);
    let mut parts = vec![("part.json", storing(declarations), STORING_SCRIPT)];
    let (url, items) = match above {
        [] => ("part.json", placement),
        [item_id] => {
            parts.push((
                "mid.json",
                part(
                    "mid",
                    json!({}),
                    json!({"part": {"url": "part.json"}}),
                    placement,
                ),
                CHILD_SCRIPT,
            ));
            ("mid.json", json!([component("part", item_id, json!({}))]))
        }
        _ => panic!("at most two levels"),
    };
    compose(
        part("orders", json!({}), json!({"part": {"url": url}}), items),
        bundle(parts),
    )
}

#[test]
fn the_storage_scope_of_an_instance_is_the_root_id_joined_with_its_path() {
    let cases: Vec<ScopeCase> = serde_json::from_str(include_str!(
        "../../tests/helpers/component-scope-cases.json"
    ))
    .expect("the component scope cases");
    assert!(!cases.is_empty(), "the table has rows");
    for case in cases {
        let scope = composition::component_scope(&case.root_id, &case.path);
        let named = format!("{} + {}", case.root_id, case.path);
        match case.scope {
            Some(expected) => assert_eq!(scope, Ok(expected), "{named}"),
            None => assert!(scope.is_err(), "{named}: {scope:?}"),
        }
    }
}

#[test]
fn a_child_keying_storage_cannot_be_placed_at_an_item_id_carrying_the_scope_separator() {
    assert_eq!(
        scoped(&["a__b"], stored())
            .err()
            .expect("expected a load error"),
        "Component a__b: storage scope orders__a__b requires \
         1–80 ASCII letters, digits, - or _ without \"__\" in any part"
    );
    // The same child reached through two levels composes the same scope legibly.
    let runtime = scoped(&["a", "b"], stored()).expect("a composed screen");
    assert_eq!(runtime.components.keys().collect::<Vec<_>>(), ["a", "a/b"]);
}

#[test]
fn a_child_keying_nothing_is_placed_at_any_item_id_the_template_allows() {
    let runtime = scoped(&["a__b"], json!({})).expect("a composed screen");
    assert_eq!(runtime.components.keys().collect::<Vec<_>>(), ["a__b"]);
}

#[test]
fn a_composed_storage_scope_stops_at_eighty_bytes() {
    // `orders__` leaves 72 bytes for the itemId of the placement.
    let fits = "p".repeat(72);
    assert!(scoped(&[&fits], stored()).is_ok(), "80 bytes");
    let overflows = "p".repeat(73);
    assert_eq!(
        scoped(&[&overflows], stored())
            .err()
            .expect("expected a load error"),
        format!(
            "Component {overflows}: storage scope orders__{overflows} requires \
             1–80 ASCII letters, digits, - or _ without \"__\" in any part"
        )
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
    let next = rhai::serde::to_dynamic(state).expect("a state map");
    let ui = instance.ui.clone();
    instance.apply(next, ui);
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

/// `described.json` — a child whose button carries the node metadata of a part.
fn described() -> Package {
    part(
        "described",
        json!({"value": 0}),
        json!({}),
        json!([
            {"xtype": "button", "itemId": "fire", "text": "呼ぶ", "handler": "run",
             "webmcp": {"description": "呼ぶ", "tags": ["call"]}},
        ]),
    )
}

fn described_bundle() -> HashMap<String, (Package, String)> {
    bundle(vec![("described.json", described(), CHILD_RUN_SCRIPT)])
}

/// What `described`'s button publishes, once the layout has found the node that declared it.
fn fire_metadata() -> Value {
    json!({"description": "呼ぶ", "tags": ["call"]})
}

#[test]
fn a_child_node_publishes_its_webmcp_on_the_prefixed_widget() {
    let runtime = compose(
        part(
            "parent",
            json!({}),
            json!({"described": {"url": "described.json"}}),
            json!([
                {"xtype": "button", "itemId": "own", "text": "親", "handler": "onSelected",
                 "webmcp": {"description": "親のボタン"}},
                component("described", "b", json!({})),
            ]),
        ),
        described_bundle(),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(
        widget_at(&scene, "b/fire").config["webmcp"],
        fire_metadata()
    );
    // A root node keeps the metadata it always had.
    assert_eq!(
        widget_at(&scene, "own").config["webmcp"],
        json!({"description": "親のボタン"})
    );
}

/// `labelled.json` — a child whose only node declares metadata without an itemId to publish it
/// under, the way the root of a screen does.
fn labelled() -> Package {
    part(
        "labelled",
        json!({"value": 0}),
        json!({}),
        json!([{"xtype": "label", "text": "子", "webmcp": {"description": "子のラベル"}}]),
    )
}

#[test]
fn a_node_without_an_item_id_publishes_its_webmcp_on_no_widget() {
    let mut root = part(
        "parent",
        json!({"query": ""}),
        json!({"labelled": {"url": "labelled.json"}}),
        json!([
            {"xtype": "label", "text": "親", "webmcp": {"description": "rootのラベル"}},
            {"xtype": "textfield", "itemId": "search", "bind": "query", "fieldLabel": "検索",
             "webmcp": {"description": "絞り込みの語"}},
            component("labelled", "a", json!({})),
        ]),
    );
    // The root node carries no itemId either, and `find_path` answers it for the empty one.
    root.ui.webmcp.description = "rootのコンテナ".into();
    let parts = bundle(vec![("labelled.json", labelled(), CHILD_SCRIPT)]);
    let runtime = compose(root, parts).expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    let keys = keys(&scene);
    // A widget without a target has no node of its own to publish, in any instance.
    for widget in scene.widgets.iter().filter(|w| w.target.is_empty()) {
        assert!(
            widget.config.get("webmcp").is_none(),
            "{} carries webmcp in {keys:?}",
            widget.key
        );
    }
    // The two labels, keyed by their index because neither declared an itemId.
    for key in ["root.0", "a/root.0"] {
        assert!(
            widget_at(&scene, key).config.get("webmcp").is_none(),
            "{key} carries webmcp in {keys:?}"
        );
    }
    // A node with an itemId still publishes what it declared.
    assert_eq!(
        widget_at(&scene, "search").config["webmcp"],
        json!({"description": "絞り込みの語"})
    );
}

#[test]
fn a_grandchild_node_publishes_its_webmcp_under_the_full_instance_path() {
    let runtime = compose(
        part(
            "parent",
            json!({}),
            json!({"middle": {"url": "middle.json"}}),
            json!([component("middle", "a", json!({}))]),
        ),
        bundle(vec![
            (
                "middle.json",
                part(
                    "middle",
                    json!({}),
                    json!({"described": {"url": "described.json"}}),
                    json!([component("described", "c", json!({}))]),
                ),
                CHILD_SCRIPT,
            ),
            ("described.json", described(), CHILD_RUN_SCRIPT),
        ]),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    // Splitting at the first `/` would look for an itemId `c/fire` in the instance `a`.
    assert_eq!(
        widget_at(&scene, "a/c/fire").config["webmcp"],
        fire_metadata()
    );
}

#[test]
fn one_package_placed_twice_publishes_the_same_webmcp_under_each_key() {
    let runtime = compose(
        part(
            "parent",
            json!({}),
            json!({"described": {"url": "described.json"}}),
            json!([
                component("described", "b", json!({})),
                component("described", "d", json!({})),
            ]),
        ),
        described_bundle(),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    let left = widget_at(&scene, "b/fire");
    let right = widget_at(&scene, "d/fire");
    assert_eq!(left.config["webmcp"], fire_metadata());
    assert_eq!(left.config["webmcp"], right.config["webmcp"]);
    assert_ne!(left.key, right.key);
}

// --- the component summaries of a scene ---

/// The tool surface `described_leaf` declares for its whole package.
fn leaf_webmcp() -> Value {
    json!({"description": "件数を出す部品。", "label": "明細", "tags": ["leaf"]})
}

/// `leaf.json` with a package-level `webmcp`, so a summary has something to carry.
fn described_leaf() -> Package {
    let mut package = leaf();
    package.webmcp = serde_json::from_value(leaf_webmcp()).expect("a webmcp block");
    package
}

/// `bundled()` with the leaf declaring its tool surface under both of its placements.
fn described_bundled() -> HashMap<String, (Package, String)> {
    bundle(vec![
        ("middle.json", middle(), MIDDLE_SCRIPT),
        ("leaf.json", described_leaf(), CHILD_SCRIPT),
    ])
}

/// The `components` of a serialized scene. `None` is the key being left out of the response.
fn summaries(scene: &Scene) -> Option<Value> {
    serde_json::to_value(scene)
        .expect("a serialized scene")
        .get("components")
        .cloned()
}

/// The summaries as `(instance, hidden)` pairs, for the tests that watch the visibility alone.
fn visibility(scene: &Scene) -> Vec<(String, bool)> {
    scene
        .components
        .iter()
        .map(|summary| (summary.instance.clone(), summary.hidden))
        .collect()
}

/// A screen placing one child behind a `visibleBind` of the root.
fn hiding(xtype: &str, url: &str, ready: bool) -> Package {
    part(
        "parent",
        json!({"query": "", "ready": ready}),
        json!({xtype: {"url": url}}),
        json!([
            {"xtype": xtype, "itemId": "a", "config": {}, "visibleBind": "ready"},
            {"xtype": "label", "itemId": "footer", "text": "合計"},
        ]),
    )
}

#[test]
fn a_screen_without_components_leaves_the_summaries_out_of_the_scene() {
    let runtime = compose(
        part(
            "parent",
            json!({}),
            json!({}),
            json!([{"xtype": "label", "itemId": "caption", "text": "単独"}]),
        ),
        HashMap::new(),
    )
    .expect("a screen without children");
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(summaries(&scene), None);
}

#[test]
fn every_component_instance_is_summarized_in_path_order() {
    let runtime = compose(composed(), described_bundled()).expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(
        summaries(&scene),
        Some(json!([
            {"instance": "a", "id": "middle", "title": "middle", "hidden": false},
            {"instance": "a/c", "id": "leaf", "title": "leaf",
             "webmcp": leaf_webmcp(), "hidden": false},
            {"instance": "b", "id": "leaf", "title": "leaf",
             "webmcp": leaf_webmcp(), "hidden": false},
        ]))
    );
}

#[test]
fn the_tool_surface_of_the_screen_stays_the_one_the_root_declared() {
    let mut package = composed();
    package.webmcp = serde_json::from_value(json!({"description": "画面"})).expect("a webmcp");
    let runtime = compose(package, described_bundled()).expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    // The children publish their own surfaces in the summaries, never in the screen's block.
    assert_eq!(
        serde_json::to_value(&scene.webmcp).expect("the metadata of the screen"),
        json!({"description": "画面"})
    );
    assert_eq!(
        scene
            .components
            .iter()
            .filter(|summary| !summary.webmcp.is_empty())
            .count(),
        2
    );
}

#[test]
fn a_component_the_parent_hides_is_summarized_as_hidden() {
    let mut runtime =
        compose(hiding("list", "list.json", false), list_bundle()).expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(visibility(&scene), vec![("a".to_owned(), true)]);
    assert!(
        !scene.widgets.iter().any(|w| w.key.starts_with("a/")),
        "{:?}",
        keys(&scene)
    );
    set_state(&mut runtime.root, "ready", json!(true));
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(visibility(&scene), vec![("a".to_owned(), false)]);
    assert!(
        scene.widgets.iter().any(|w| w.key.starts_with("a/")),
        "{:?}",
        keys(&scene)
    );
}

#[test]
fn hiding_a_component_hides_the_ones_it_carries_below_it() {
    let mut runtime = compose(
        hiding("middle", "middle.json", false),
        bundle(vec![
            ("middle.json", middle_list(), CHILD_SCRIPT),
            ("list.json", list_part(), CHILD_SCRIPT),
        ]),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(
        visibility(&scene),
        vec![("a".to_owned(), true), ("a/c".to_owned(), true)]
    );
    set_state(&mut runtime.root, "ready", json!(true));
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(
        visibility(&scene),
        vec![("a".to_owned(), false), ("a/c".to_owned(), false)]
    );
}

/// A child whose own state carries the key its parent binds the placement to.
fn shadowing() -> Package {
    part(
        "shadow",
        json!({"ready": false}),
        json!({}),
        json!([{"xtype": "label", "itemId": "caption", "text": "影"}]),
    )
}

#[test]
fn the_visibility_of_a_component_is_read_from_the_state_of_its_parent() {
    let mut runtime = compose(
        hiding("shadow", "shadow.json", true),
        bundle(vec![("shadow.json", shadowing(), CHILD_SCRIPT)]),
    )
    .expect("a composed screen");
    // The child holds a `ready` of its own, and it is the parent's that answers the placement.
    assert_eq!(child_state(&runtime, "a")["ready"], json!(false));
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(visibility(&scene), vec![("a".to_owned(), false)]);
    set_state(&mut runtime.root, "ready", json!(false));
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(visibility(&scene), vec![("a".to_owned(), true)]);
}

#[test]
fn an_event_that_moves_a_child_leaves_the_summaries_where_they_were() {
    let mut runtime = compose(
        acting(json!([flag_field(), component("part", "a", json!({}))])),
        panel_bundle(),
    )
    .expect("a composed screen");
    let before = summaries(&runtime.layout(800.0).expect("a scene"));
    runtime
        .dispatch("a/button", json!({}))
        .expect("the button of the child");
    assert_eq!(child_state(&runtime, "a")["count"], json!(1));
    // The summaries come from the packages, so a state the event moved cannot reach them.
    assert_eq!(summaries(&runtime.layout(800.0).expect("a scene")), before);
}

#[test]
fn one_package_placed_twice_is_summarized_once_per_placement() {
    let runtime = compose(
        part(
            "parent",
            json!({}),
            json!({"leaf": {"url": "leaf.json"}}),
            json!([
                component("leaf", "open", json!({})),
                component("leaf", "shipped", json!({})),
            ]),
        ),
        described_bundled(),
    )
    .expect("a composed screen");
    let scene = runtime.layout(800.0).expect("a scene");
    assert_eq!(
        visibility(&scene),
        vec![("open".to_owned(), false), ("shipped".to_owned(), false)]
    );
    let open = &scene.components[0];
    let shipped = &scene.components[1];
    assert_eq!(open.id, shipped.id);
    assert_ne!(open.instance, shipped.instance);
    assert_eq!(
        serde_json::to_value(&open.webmcp).expect("the metadata of a placement"),
        leaf_webmcp()
    );
    assert_eq!(
        serde_json::to_value(&open.webmcp).expect("the metadata of a placement"),
        serde_json::to_value(&shipped.webmcp).expect("the metadata of its twin")
    );
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

/// The ui and state a layout pass last snapshotted for one instance, or `None` while no pass
/// has serialized it yet. Identity is the point: the `Rc` tells reuse from re-serialization.
fn snapshot_of(runtime: &Runtime, path: &str) -> Option<Rc<(Node, Value)>> {
    runtime.components[path].snapshot.borrow().clone()
}

#[test]
fn two_layout_passes_over_the_same_state_reuse_the_snapshot_of_every_child() {
    let runtime = reporting_screen(json!([
        filter_field(),
        component("report", "bound", json!({"query": {"bind": "query"}})),
        component("report", "fixed", json!({"status": "受注"})),
    ]));
    // Loading serializes nothing for the layout: the first pass is what fills the cache.
    assert!(snapshot_of(&runtime, "bound").is_none());
    assert!(snapshot_of(&runtime, "fixed").is_none());
    runtime.layout(800.0).expect("a scene");
    let bound = snapshot_of(&runtime, "bound").expect("bound after one pass");
    let fixed = snapshot_of(&runtime, "fixed").expect("fixed after one pass");
    runtime.layout(640.0).expect("a scene");
    for (path, before) in [("bound", &bound), ("fixed", &fixed)] {
        let after = snapshot_of(&runtime, path).expect(path);
        assert!(Rc::ptr_eq(before, &after), "{path} was serialized again");
    }
}

#[test]
fn a_dispatch_drops_the_snapshot_of_the_instances_it_moved_and_leaves_the_rest() {
    let mut runtime = reporting_screen(json!([
        filter_field(),
        component("report", "bound", json!({"query": {"bind": "query"}})),
        component("report", "fixed", json!({"status": "受注"})),
    ]));
    runtime.layout(800.0).expect("a scene");
    let bound = snapshot_of(&runtime, "bound").expect("bound after one pass");
    let fixed = snapshot_of(&runtime, "fixed").expect("fixed after one pass");
    // An event inside one child moves that child only.
    runtime
        .dispatch("bound/orders", json!({"id": 2}))
        .expect("the grid event of the child");
    assert!(snapshot_of(&runtime, "bound").is_none());
    assert!(Rc::ptr_eq(
        &fixed,
        &snapshot_of(&runtime, "fixed").expect("fixed")
    ));
    runtime.layout(800.0).expect("a scene");
    let moved = snapshot_of(&runtime, "bound").expect("bound after the event");
    assert!(!Rc::ptr_eq(&bound, &moved));
    // Moving the root reconfigures the child bound to what changed, and only that one.
    runtime
        .dispatch("filter", json!({"value": "山田"}))
        .expect("the root textfield");
    assert!(snapshot_of(&runtime, "bound").is_none());
    assert!(Rc::ptr_eq(
        &fixed,
        &snapshot_of(&runtime, "fixed").expect("fixed")
    ));
    // The pass after the event sees the moved state, not the one it cached before it.
    runtime.layout(800.0).expect("a scene");
    let reconfigured = snapshot_of(&runtime, "bound").expect("bound after the root moved");
    assert!(!Rc::ptr_eq(&moved, &reconfigured));
    assert_eq!(reconfigured.1["config"], json!({"query": "山田"}));
    assert_eq!(reconfigured.1["picked"], json!(2));
}

#[test]
fn a_rejected_layout_leaves_no_scope_behind_for_the_next_one() {
    let runtime = reporting_screen(json!([component("report", "a", json!({}))]));
    // `Scene` is not `Debug`, so the rejection goes through `err` instead of `expect_err`.
    assert_eq!(
        runtime
            .layout(100.0)
            .err()
            .expect("a width below the floor"),
        "Viewport width must be between 240 and 4096"
    );
    assert!(composition::with_component("a", |_, _| ()).is_none());
    let scene = runtime.layout(800.0).expect("a scene");
    assert!(
        keys(&scene).iter().any(|key| key.starts_with("a/")),
        "{:?}",
        keys(&scene)
    );
    assert!(composition::with_component("a", |_, _| ()).is_none());
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
        "fire_file_read",
        "fire_rpc",
        "fire_host",
        "fire_dialog",
        "fire_named",
        "fire_two",
        "fire_fail",
        "arm",
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
        "state": {"last": "", "notice": "", "fail": "", "fat": []},
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
fn fatten() {{
    let one = \"x\";
    while one.len() < 60000 {{ one += one; }}
    let rows = [];
    for i in 0..20 {{ rows.push(one); }}
    rows
}}
fn land(s, k) {{
    if s.fail == \"before\" {{ throw \"the handler refused\"; }}
    if s.fail == \"fat\" {{ s.fat = fatten(); }}
    s.last = k;
    {announcement}
    if s.fail == \"after\" {{ throw \"the handler refused\"; }}
    s
}}
fn arm(s, e) {{ s.fail = e.value; s }}
fn fire_fail(s, e) {{ throw \"the handler refused\"; }}
fn fire_http(s, e) {{ http_get(\"r1\"); s }}
fn fire_storage(s, e) {{ storage_write(\"draft\", #{{\"a\": 1}}); s }}
fn fire_file(s, e) {{ file_write_text(\"vol\", \"f.txt\", \"text\"); s }}
fn fire_file_read(s, e) {{ file_read_bytes(\"vol\", \"f.txt\"); s }}
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

/// One row of the completion grid: the button that queues an effect of that channel, the
/// response the host sends back, what the handler of that kind writes into `last`, and the two
/// things that differ per channel — the message a request that is no longer pending is refused
/// with, and whether the host may send the same response twice.
struct Channel {
    button: &'static str,
    make: fn(u64) -> Completion,
    landed: &'static str,
    unknown: &'static str,
    /// Every channel but `host_progress` consumes the request when the response arrives, a
    /// failed handler included: the host is never asked to send that one again.
    consuming: bool,
    /// Every channel but the dialogs numbers its requests per instance, so two instances can
    /// hold the same id. The dialog queue belongs to the screen, and its ids are unique in it.
    per_instance_ids: bool,
}

/// The rows of the grid: one per kind of completion the host can deliver.
fn completion_cases() -> Vec<Channel> {
    vec![
        Channel {
            button: "fire_http",
            make: |id| Completion::Http {
                id,
                response: answered(),
            },
            landed: "http",
            unknown: "Unknown or completed HTTP request",
            consuming: true,
            per_instance_ids: true,
        },
        Channel {
            button: "fire_storage",
            make: |id| Completion::Storage {
                id,
                response: answered(),
            },
            landed: "storage",
            unknown: "Unknown or completed storage request",
            consuming: true,
            per_instance_ids: true,
        },
        Channel {
            button: "fire_file",
            make: |id| Completion::File {
                id,
                response: answered(),
                buffer: None,
            },
            landed: "file",
            unknown: "Unknown or completed file request",
            consuming: true,
            per_instance_ids: true,
        },
        // A failed call is the one RPC completion that needs no encoded response message; the
        // successful one carries a buffer and has a cell of its own below.
        Channel {
            button: "fire_rpc",
            make: |id| Completion::Rpc {
                id,
                response: json!({"ok": false, "data": null, "error": "no"}),
                buffer: None,
            },
            landed: "rpc",
            unknown: "Unknown or completed RPC call",
            consuming: true,
            per_instance_ids: true,
        },
        Channel {
            button: "fire_host",
            make: |id| Completion::Host {
                id,
                response: json!({"ok": true, "data": null, "error": null}),
            },
            landed: "host",
            unknown: "Unknown or completed host call",
            consuming: true,
            per_instance_ids: true,
        },
        Channel {
            button: "fire_host",
            make: |id| Completion::HostProgress {
                id,
                data: json!({"operation": "op", "transferred": 0, "total": null}),
            },
            landed: "progress",
            unknown: "Unknown or completed host call",
            consuming: false,
            per_instance_ids: true,
        },
        Channel {
            button: "fire_dialog",
            make: |id| Completion::Dialog {
                id,
                response: json!({"ok": true, "data": true, "error": ""}),
            },
            landed: "dialog",
            unknown: "Unknown or completed dialog request",
            consuming: true,
            per_instance_ids: false,
        },
    ]
}

#[test]
fn every_kind_of_completion_reaches_a_child_and_a_grandchild() {
    for path in ["a", "a/c"] {
        for channel in completion_cases() {
            let mut runtime = routing("on_done");
            let id = queue_effect(&mut runtime, path, &channel);
            runtime
                .complete(path, (channel.make)(id))
                .unwrap_or_else(|e| panic!("{path} {}: {e}", channel.landed));
            assert_eq!(
                child_state(&runtime, path)["last"],
                json!(channel.landed),
                "{path} {}",
                channel.landed
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

// --- the grid of entrances, results and instances ---
//
// Every cell below runs the whole screen, so a wrong route shows up as a state that moved, a
// revision that counted or a request that was swallowed — not as a panic. None of these tests
// is `should_panic`: a panic anywhere in the grid fails the suite.

/// The target of an event or a button of `path`, the root being the unprefixed one.
fn target_of(path: &str, item_id: &str) -> String {
    match path.is_empty() {
        true => item_id.to_owned(),
        false => format!("{path}/{item_id}"),
    }
}

/// The message `instance` is refused with: the instance that failed names itself, the root does
/// not have to.
fn blamed(instance: &str, message: &str) -> String {
    match instance.is_empty() {
        true => message.to_owned(),
        false => format!("Component {instance}: {message}"),
    }
}

fn instance_state(runtime: &Runtime, path: &str) -> Value {
    match path.is_empty() {
        true => runtime.state_json().expect("root state"),
        false => child_state(runtime, path),
    }
}

/// The state of every instance of the screen, root first: what a refused completion may not move.
fn screen_states(runtime: &Runtime) -> Vec<Value> {
    let mut states = vec![runtime.state_json().expect("root state")];
    states.extend(
        runtime
            .components
            .values()
            .map(|instance| instance.state_json().expect("a child state")),
    );
    states
}

/// Tell the completion handlers of `path` to fail: `before` throws on arrival, `after` throws
/// once it has already written and announced, `fat` grows the state past a megabyte.
fn arm_failure(runtime: &mut Runtime, path: &str, how: &str) {
    runtime
        .dispatch(&target_of(path, "arm"), json!({"value": how}))
        .unwrap_or_else(|e| panic!("arming {path} with {how}: {e}"));
}

/// Queue one effect of `channel` in `path` and return the id the host has to answer with. The
/// effect names the instance it has to come back to, and the root's names none.
fn queue_effect(runtime: &mut Runtime, path: &str, channel: &Channel) -> u64 {
    runtime
        .dispatch(&target_of(path, channel.button), json!({}))
        .unwrap_or_else(|e| panic!("{path} {}: {e}", channel.landed));
    let effects = runtime.take_effects();
    assert_eq!(effects.len(), 1, "{path} {}", channel.landed);
    assert_eq!(
        effects[0].get("instance").and_then(Value::as_str),
        (!path.is_empty()).then_some(path),
        "{path} {}",
        channel.landed
    );
    effects[0]["id"].as_u64().expect("an effect id")
}

/// 正常: the response reaches the instance that asked, the screen counts one step, and the only
/// other instance that moves is the parent the child announced to.
fn grid_normal(channel: &Channel) {
    for path in ["", "a", "a/c"] {
        let label = format!("{path} {}", channel.landed);
        let mut runtime = routing("on_done");
        let id = queue_effect(&mut runtime, path, channel);
        let revision = runtime.revision;
        runtime
            .complete(path, (channel.make)(id))
            .unwrap_or_else(|e| panic!("{label}: {e}"));
        assert_eq!(
            instance_state(&runtime, path)["last"],
            json!(channel.landed),
            "{label}"
        );
        assert_eq!(runtime.revision, revision + 1, "{label}");
        // A child announces what arrived to the parent holding it; nobody else is told.
        let heard = match path {
            "" => json!(""),
            "a" => json!(format!("a:{}", channel.landed)),
            _ => json!(format!("c:{}", channel.landed)),
        };
        let parent = match path {
            "a/c" => "a",
            _ => "",
        };
        assert_eq!(instance_state(&runtime, parent)["notice"], heard, "{label}");
        for other in ["", "a", "a/c"].iter().filter(|other| **other != path) {
            assert_eq!(
                instance_state(&runtime, other)["last"],
                json!(""),
                "{label}"
            );
        }
    }
}

/// handler 失敗: the instance that threw names itself, no instance moves, and the request is
/// gone all the same — except on the one channel that does not consume it.
fn grid_handler_failure(channel: &Channel) {
    for path in ["", "a", "a/c"] {
        let label = format!("{path} {}", channel.landed);
        let mut runtime = routing("on_done");
        arm_failure(&mut runtime, path, "before");
        let id = queue_effect(&mut runtime, path, channel);
        let before = screen_states(&runtime);
        let revision = runtime.revision;
        let error = complete_error(&mut runtime, path, (channel.make)(id));
        assert!(error.starts_with(&blamed(path, "")), "{label}: {error}");
        assert!(error.contains("the handler refused"), "{label}: {error}");
        assert_eq!(screen_states(&runtime), before, "{label}");
        assert_eq!(runtime.revision, revision, "{label}");
        let again = complete_error(&mut runtime, path, (channel.make)(id));
        match channel.consuming {
            true => assert_eq!(again, blamed(path, channel.unknown), "{label}"),
            // Progress reports leave the request pending, so this one arrives again — and is
            // refused by the handler, not by the channel.
            false => assert!(again.contains("the handler refused"), "{label}: {again}"),
        }
    }
}

/// 不正な `instance`: a path that names no instance of this screen reaches nothing and swallows
/// nothing. `a//c` is a path no instance can have, `zzz` one no instance has here.
fn grid_bad_instance(channel: &Channel) {
    let label = channel.landed;
    let mut runtime = routing("on_done");
    let id = queue_effect(&mut runtime, "a", channel);
    let before = screen_states(&runtime);
    let revision = runtime.revision;
    for bad in ["zzz", "a//c"] {
        assert_eq!(
            complete_error(&mut runtime, bad, (channel.make)(id)),
            format!("Unknown component instance: {bad}"),
            "{label} {bad}"
        );
    }
    assert_eq!(screen_states(&runtime), before, "{label}");
    assert_eq!(runtime.revision, revision, "{label}");
    runtime
        .complete("a", (channel.make)(id))
        .unwrap_or_else(|e| panic!("{label} after the bad paths: {e}"));
    assert_eq!(child_state(&runtime, "a")["last"], json!(label), "{label}");
}

/// 他 Instance の id: the id of one instance, addressed to another. The other has nothing with
/// that id, and the one that asked still gets its answer.
fn grid_foreign_id(channel: &Channel) {
    let label = channel.landed;
    let mut runtime = routing("on_done");
    let id = queue_effect(&mut runtime, "a", channel);
    let before = screen_states(&runtime);
    let revision = runtime.revision;
    for other in ["", "a/c"] {
        assert_eq!(
            complete_error(&mut runtime, other, (channel.make)(id)),
            blamed(other, channel.unknown),
            "{label} {other}"
        );
    }
    assert_eq!(screen_states(&runtime), before, "{label}");
    assert_eq!(runtime.revision, revision, "{label}");
    runtime
        .complete("a", (channel.make)(id))
        .unwrap_or_else(|e| panic!("{label} after the foreign ids: {e}"));
    assert_eq!(child_state(&runtime, "a")["last"], json!(label), "{label}");
}

/// 重複: the same response, twice. The second one is refused on every channel that consumed the
/// request, and delivered again on the one that did not.
fn grid_repeated(channel: &Channel) {
    let label = channel.landed;
    let mut runtime = routing("on_done");
    let id = queue_effect(&mut runtime, "a", channel);
    runtime
        .complete("a", (channel.make)(id))
        .unwrap_or_else(|e| panic!("{label}: {e}"));
    let revision = runtime.revision;
    match channel.consuming {
        true => {
            assert_eq!(
                complete_error(&mut runtime, "a", (channel.make)(id)),
                blamed("a", channel.unknown),
                "{label}"
            );
            assert_eq!(runtime.revision, revision, "{label}");
        }
        false => {
            runtime
                .complete("a", (channel.make)(id))
                .unwrap_or_else(|e| panic!("{label} twice: {e}"));
            assert_eq!(runtime.revision, revision + 1, "{label}");
        }
    }
}

/// `instance` 省略: the id of a child, sent back to nobody. The root answers for itself, so it
/// looks the id up among its own requests — and finds nothing, unless it queued one of its own.
fn grid_without_an_instance(channel: &Channel) {
    let label = channel.landed;
    let mut runtime = routing("on_done");
    let id = queue_effect(&mut runtime, "a", channel);
    assert_eq!(
        complete_error(&mut runtime, "", (channel.make)(id)),
        channel.unknown,
        "{label}"
    );
    if !channel.per_instance_ids {
        return;
    }
    // The root numbers its own requests from one as well, so the same id is its own here.
    let own = queue_effect(&mut runtime, "", channel);
    assert_eq!(own, id, "{label}");
    runtime
        .complete("", (channel.make)(own))
        .unwrap_or_else(|e| panic!("{label} of the root: {e}"));
    assert_eq!(
        runtime.state_json().expect("root state")["last"],
        json!(label),
        "{label}"
    );
    // The request of the child is still waiting for an answer addressed to it.
    assert_eq!(child_state(&runtime, "a")["last"], json!(""), "{label}");
}

#[test]
fn completion_grid() {
    for channel in completion_cases() {
        grid_normal(&channel);
        grid_handler_failure(&channel);
        grid_bad_instance(&channel);
        grid_foreign_id(&channel);
        grid_repeated(&channel);
        grid_without_an_instance(&channel);
    }
}

#[test]
fn the_dispatch_entrance_of_the_grid_names_its_instance_in_the_item_id() {
    // An event carries no instance: the prefix of the itemId is the whole of the addressing.
    let http = &completion_cases()[0];
    for path in ["", "a", "a/c"] {
        let mut runtime = routing("on_done");
        queue_effect(&mut runtime, path, http);
        assert_eq!(runtime.revision, 1, "{path}");

        let mut runtime = routing("on_done");
        let before = screen_states(&runtime);
        let error = dispatch_error(&mut runtime, &target_of(path, "fire_fail"), json!({}));
        assert!(error.starts_with(&blamed(path, "")), "{path}: {error}");
        assert!(error.contains("the handler refused"), "{path}: {error}");
        assert_eq!(screen_states(&runtime), before, "{path}");
        assert_eq!(runtime.revision, 0, "{path}");
        assert!(runtime.take_effects().is_empty(), "{path}");
    }
    // A prefix that names no instance is an itemId that does not exist, not an instance error.
    let mut runtime = routing("on_done");
    for target in ["zzz/fire_http", "a//c/fire_http"] {
        assert_eq!(
            dispatch_error(&mut runtime, target, json!({})),
            format!("Unknown itemId: {target}")
        );
    }
    assert_eq!(runtime.revision, 0);
}

/// `EchoResponse { name: "太郎", sequence_id: 7, payload: [1, 2, 3] }` — the 15 bytes a
/// successful RPC completion has to carry: field 1 as a six-byte string, field 2 as a varint,
/// field 3 as three bytes. The same message `scripts/compare-engine-behavior.mjs` encodes.
const ECHO_RESPONSE: [u8; 15] = [
    0x0a, 0x06, 0xe5, 0xa4, 0xaa, 0xe9, 0x83, 0x8e, 0x10, 0x07, 0x1a, 0x03, 0x01, 0x02, 0x03,
];

#[test]
fn a_completion_that_carries_a_binary_buffer_reaches_the_instance_that_asked() {
    for path in ["", "a", "a/c"] {
        let mut runtime = routing("on_done");
        // The decodable response message: the one RPC completion that reaches a handler.
        runtime
            .dispatch(&target_of(path, "fire_rpc"), json!({}))
            .unwrap_or_else(|e| panic!("{path} rpc: {e}"));
        let id = runtime.take_effects()[0]["id"]
            .as_u64()
            .expect("an effect id");
        let buffer = buffers::put(ECHO_RESPONSE.to_vec()).expect("a response buffer");
        runtime
            .complete(
                path,
                Completion::Rpc {
                    id,
                    response: answered(),
                    buffer: Some(buffer),
                },
            )
            .unwrap_or_else(|e| panic!("{path} rpc: {e}"));
        assert_eq!(
            instance_state(&runtime, path)["last"],
            json!("rpc"),
            "{path}"
        );

        // `read_bytes` is the file completion that hands the handler the bytes it read.
        runtime
            .dispatch(&target_of(path, "fire_file_read"), json!({}))
            .unwrap_or_else(|e| panic!("{path} read_bytes: {e}"));
        let id = runtime.take_effects()[0]["id"]
            .as_u64()
            .expect("an effect id");
        let buffer = buffers::put(vec![1, 2, 3]).expect("a file buffer");
        runtime
            .complete(
                path,
                Completion::File {
                    id,
                    response: answered(),
                    buffer: Some(buffer),
                },
            )
            .unwrap_or_else(|e| panic!("{path} read_bytes: {e}"));
        assert_eq!(
            instance_state(&runtime, path)["last"],
            json!("file"),
            "{path}"
        );
    }
}

#[test]
fn a_response_that_arrives_after_the_screen_was_rebuilt_reaches_nothing() {
    let mut runtime = routing("on_done");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let id = runtime.take_effects()[0]["id"]
        .as_u64()
        .expect("an effect id");
    drop(runtime);

    // The host still holds the id the old screen handed out; the new one never did.
    let mut runtime = routing("on_done");
    let before = screen_states(&runtime);
    assert_eq!(
        complete_error(
            &mut runtime,
            "a",
            Completion::Http {
                id,
                response: answered()
            }
        ),
        "Component a: Unknown or completed HTTP request"
    );
    assert_eq!(screen_states(&runtime), before);
    assert_eq!(runtime.revision, 0);
}

#[test]
fn a_completion_that_fails_after_it_announced_leaves_no_trace_in_its_parent() {
    let mut runtime = routing("on_done");
    arm_failure(&mut runtime, "a", "after");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let id = runtime.take_effects()[0]["id"]
        .as_u64()
        .expect("an effect id");
    let before = screen_states(&runtime);
    let revision = runtime.revision;
    let error = complete_error(
        &mut runtime,
        "a",
        Completion::Http {
            id,
            response: answered(),
        },
    );
    assert!(error.contains("the handler refused"), "{error}");
    // The announcement reached the listener of the root before the handler threw; neither the
    // instance nor its parent kept any of it.
    assert_eq!(screen_states(&runtime), before);
    assert_eq!(runtime.revision, revision);

    // Nothing is poisoned: the next response of another channel lands and is announced.
    arm_failure(&mut runtime, "a", "");
    runtime
        .dispatch("a/fire_host", json!({}))
        .expect("the child button");
    let id = runtime.take_effects()[0]["id"]
        .as_u64()
        .expect("an effect id");
    runtime
        .complete(
            "a",
            Completion::Host {
                id,
                response: json!({"ok": true, "data": null, "error": null}),
            },
        )
        .expect("the next completion of the child");
    assert_eq!(child_state(&runtime, "a")["last"], json!("host"));
    assert_eq!(
        runtime.state_json().expect("root state")["notice"],
        json!("a:host")
    );
}

/// The routing root again, holding `loud.json` as `a`: a child that announces from `config`,
/// bound to the key the completion handlers of the root write.
fn routing_into_a_loud_child() -> Runtime {
    let root = effecting(
        "parent",
        json!({"loud": {"url": "loud.json"}}),
        json!([component("loud", "a", json!({"query": {"bind": "last"}}))]),
    );
    Runtime::load_with_bundle(
        root,
        &effecting_script(false),
        descriptor_set(),
        None,
        HashMap::from([(
            "loud.json".to_owned(),
            Bundle {
                package: emitting("loud"),
                script: LOUD_SCRIPT.to_owned(),
                descriptors: HashMap::new(),
            },
        )]),
        |_| {},
    )
    .expect("the screen holding a loud child")
}

#[test]
fn a_completion_that_reconfigures_a_child_cannot_make_it_announce() {
    let mut runtime = routing_into_a_loud_child();
    runtime
        .dispatch("fire_http", json!({}))
        .expect("the root button");
    let id = runtime.take_effects()[0]["id"]
        .as_u64()
        .expect("an effect id");
    let before = screen_states(&runtime);
    let revision = runtime.revision;
    assert_eq!(
        complete_error(
            &mut runtime,
            "",
            Completion::Http {
                id,
                response: answered()
            }
        ),
        "Component a: emit is not available in config"
    );
    assert_eq!(screen_states(&runtime), before);
    assert_eq!(runtime.revision, revision);
}

/// Rhai counts the strings of a value together, so `set_max_string_size(100_000)`
/// (`instance.rs:114`) refuses a state this big before `check_state` ever sees it: the megabyte
/// guard of `lib.rs` is the second line of defence, not the first. Either way the completion of
/// a child that grows without bound is refused in that child's name and moves no instance.
#[test]
fn a_completion_that_grows_the_state_without_bound_moves_no_instance() {
    let mut runtime = routing("on_done");
    arm_failure(&mut runtime, "a", "fat");
    runtime
        .dispatch("a/fire_http", json!({}))
        .expect("the child button");
    let id = runtime.take_effects()[0]["id"]
        .as_u64()
        .expect("an effect id");
    let before = screen_states(&runtime);
    let revision = runtime.revision;
    assert_eq!(
        complete_error(
            &mut runtime,
            "a",
            Completion::Http {
                id,
                response: answered()
            }
        ),
        "Component a: middle.rhai / HTTP r1 / done_http: Length of string too large"
    );
    assert_eq!(screen_states(&runtime), before);
    assert_eq!(runtime.revision, revision);
}

/// A completion names its instance by path, so the path is the one part of the request a host can
/// make arbitrarily long. 256 bytes is the cap: anything longer is refused on length alone, before
/// the shape of the path is ever judged, and the refusal does not quote the path back.
#[test]
fn a_completion_naming_an_instance_longer_than_256_bytes_is_refused_on_length() {
    let at_the_cap = "a".repeat(256);
    assert_eq!(
        crate::abi::take_instance(&json!({"instance": at_the_cap.clone()})),
        Ok(at_the_cap)
    );
    let too_long = "a".repeat(257);
    let err = crate::abi::take_instance(&json!({"instance": too_long.clone()}))
        .expect_err("a path over the cap");
    assert_eq!(err, "Component instance path exceeds 256 bytes");
    assert!(!err.contains(&too_long));
    // The length is judged first, so a path that is both too long and malformed is refused for
    // its length; and the cap counts UTF-8 bytes, not characters, so 86 three-byte characters are
    // already over it.
    for path in [
        format!("{}:{}", "a".repeat(200), "b".repeat(57)),
        "あ".repeat(86),
        format!("{}/x", "a".repeat(255)),
    ] {
        assert_eq!(
            crate::abi::take_instance(&json!({"instance": path})),
            Err("Component instance path exceeds 256 bytes".to_owned())
        );
    }
    // A completion with no instance of its own is still the root's.
    assert_eq!(crate::abi::take_instance(&json!({})), Ok(String::new()));
}
