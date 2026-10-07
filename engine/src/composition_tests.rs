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
    let mut dialogs = dialogs::Requests::default();
    let pages = pages::Requests::default();
    instance::Instance::load(
        package,
        script,
        HashMap::new(),
        None,
        |_| {},
        &mut dialogs,
        &pages,
    )
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
