use super::{Modal, Widget};
use rhai::{Dynamic, Engine, EvalAltResult, ImmutableString, Map, AST};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, VecDeque},
    rc::Rc,
};

thread_local! {
    // Scene keys must not alias controls from a replaced screen in the same engine.
    static SEQUENCE: Cell<u64> = const { Cell::new(0) };
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Alert,
    Confirm,
    Prompt,
}
impl Operation {
    fn default_icon(&self) -> NamedIcon {
        match self {
            Self::Alert => NamedIcon::Info,
            Self::Confirm => NamedIcon::Question,
            Self::Prompt => NamedIcon::Input,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum NamedIcon {
    Info,
    Success,
    Warning,
    Error,
    Question,
    Input,
    None,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TextIcon {
    text: String,
    #[serde(default)]
    alt: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ImageIcon {
    src: String,
    #[serde(default)]
    alt: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(untagged)]
enum Icon {
    Named(NamedIcon),
    Text(TextIcon),
    Image(ImageIcon),
}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Options {
    icon: Option<Icon>,
}
impl Icon {
    fn validate(&self) -> Result<(), Box<EvalAltResult>> {
        match self {
            Self::Named(_) => Ok(()),
            Self::Text(icon) => {
                if icon.text.trim().is_empty() || icon.text.len() > 64 || icon.alt.len() > 160 {
                    return Err(
                        "Dialog icon text requires 1..64 bytes; alt at most 160 bytes".into(),
                    );
                }
                Ok(())
            }
            Self::Image(icon) => {
                let src = &icon.src;
                if src.is_empty()
                    || src.len() > 2048
                    || icon.alt.len() > 160
                    || src.chars().any(|c| c.is_control() || c.is_whitespace())
                    || src.contains('\\')
                {
                    return Err("Dialog icon src requires 1..2048 bytes without whitespace, controls or backslashes; alt at most 160 bytes".into());
                }
                if let Some((scheme, _)) = src.split_once(':') {
                    if !scheme.contains('/')
                        && !scheme.contains('?')
                        && !scheme.contains('#')
                        && !["http", "https"].contains(&scheme.to_ascii_lowercase().as_str())
                    {
                        return Err("Dialog icon src requires HTTP/HTTPS or a relative URL".into());
                    }
                }
                Ok(())
            }
        }
    }
}
#[derive(Clone)]
pub struct Intent {
    /// The instance that asked for the dialog: the empty path for the root, the prefixed
    /// itemId path of the component otherwise. The handler runs there, and there alone.
    origin: String,
    operation: Operation,
    message: String,
    default_value: String,
    handler: String,
    icon: Icon,
    draft: String,
}
pub enum Event {
    Ignore,
    Draft,
    Answer(u64, Value),
}
#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<Intent>>>,
    pending: HashMap<u64, Intent>,
    order: VecDeque<u64>,
    ready: Vec<Value>,
}
impl Requests {
    /// `origin` is the instance these functions enqueue for; every closure carries its own copy
    /// so the queue the whole screen shares still says who asked.
    pub fn register(&self, engine: &mut Engine, origin: &str) {
        let queue = self.queue.clone();
        let from = origin.to_owned();
        engine.register_fn("alert", move |message: ImmutableString| {
            enqueue(
                &queue,
                &from,
                Operation::Alert,
                message,
                "".into(),
                "".into(),
                None,
            )
        });
        let queue = self.queue.clone();
        let from = origin.to_owned();
        engine.register_fn("alert", move |message: ImmutableString, options: Map| {
            enqueue(
                &queue,
                &from,
                Operation::Alert,
                message,
                "".into(),
                "".into(),
                Some(options),
            )
        });
        for (function, operation) in [
            ("alert", Operation::Alert),
            ("confirm", Operation::Confirm),
            ("prompt", Operation::Prompt),
        ] {
            let queue = self.queue.clone();
            let from = origin.to_owned();
            let plain_operation = operation.clone();
            engine.register_fn(
                function,
                move |message: ImmutableString, handler: ImmutableString| {
                    enqueue(
                        &queue,
                        &from,
                        plain_operation.clone(),
                        message,
                        "".into(),
                        handler,
                        None,
                    )
                },
            );
            let queue = self.queue.clone();
            let from = origin.to_owned();
            engine.register_fn(
                function,
                move |message: ImmutableString, handler: ImmutableString, options: Map| {
                    enqueue(
                        &queue,
                        &from,
                        operation.clone(),
                        message,
                        "".into(),
                        handler,
                        Some(options),
                    )
                },
            );
        }
        let queue = self.queue.clone();
        let from = origin.to_owned();
        engine.register_fn(
            "prompt",
            move |message: ImmutableString,
                  default_value: ImmutableString,
                  handler: ImmutableString| {
                enqueue(
                    &queue,
                    &from,
                    Operation::Prompt,
                    message,
                    default_value,
                    handler,
                    None,
                )
            },
        );
        let queue = self.queue.clone();
        let from = origin.to_owned();
        engine.register_fn(
            "prompt",
            move |message: ImmutableString,
                  default_value: ImmutableString,
                  handler: ImmutableString,
                  options: Map| {
                enqueue(
                    &queue,
                    &from,
                    Operation::Prompt,
                    message,
                    default_value,
                    handler,
                    Some(options),
                )
            },
        );
    }
    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }
    /// `ast_of` resolves the script of an origin: a completion handler is validated against the
    /// instance that asked for the dialog, never against the root that happens to own the queue.
    pub fn prepare<'a>(
        &self,
        ast_of: &dyn Fn(&str) -> Option<&'a AST>,
    ) -> Result<Vec<Intent>, crate::composition::Blame> {
        let intents = std::mem::take(&mut *self.queue.borrow_mut());
        if self.pending.len() + intents.len() > 8 {
            // Screen-wide: the stack belongs to the root whoever filled it.
            return Err((String::new(), "At most 8 pending dialogs".into()));
        }
        for intent in &intents {
            if intent.handler.is_empty() {
                continue;
            }
            let defined = ast_of(&intent.origin).is_some_and(|ast| {
                ast.iter_functions()
                    .any(|f| f.name == intent.handler && f.params.len() == 2)
            });
            if !defined {
                return Err((
                    intent.origin.clone(),
                    format!(
                        "Dialog: undefined handler {}(state, response)",
                        intent.handler
                    ),
                ));
            }
        }
        Ok(intents)
    }
    pub fn commit(&mut self, intents: Vec<Intent>) {
        for intent in intents {
            let id = SEQUENCE.with(|sequence| {
                let id = sequence.get() + 1;
                sequence.set(id);
                id
            });
            let mut effect = json!({"kind":"dialog", "id":id, "operation":intent.operation, "message":intent.message, "defaultValue":intent.default_value, "icon":intent.icon});
            if !intent.origin.is_empty() {
                effect["instance"] = json!(intent.origin);
            }
            self.ready.push(effect);
            self.pending.insert(id, intent);
            self.order.push_back(id);
        }
    }
    pub fn active(&self) -> Option<(u64, &Intent)> {
        let id = *self.order.front()?;
        self.pending.get(&id).map(|intent| (id, intent))
    }
    pub fn snapshot(&self) -> Option<Value> {
        let (id, intent) = self.active()?;
        let mut data = json!({"id":id,"operation":intent.operation,"title":title(&intent.operation),"message":intent.message,"icon":intent.icon});
        if matches!(intent.operation, Operation::Prompt) {
            data["value"] = json!(intent.draft);
        }
        Some(data)
    }
    pub fn event(&mut self, target: &str, payload: &Value) -> Result<Event, String> {
        let Some((id, _)) = self.active() else {
            return Ok(Event::Ignore);
        };
        let key = format!(":dialog:{id}");
        let intent = self.pending.get_mut(&id).unwrap();
        let action = payload["action"].as_str().unwrap_or("");
        if target == format!("{key}:input") && matches!(intent.operation, Operation::Prompt) {
            if !["", "accept"].contains(&action) {
                return Err("Invalid dialog input action".into());
            }
            let value = payload["value"]
                .as_str()
                .ok_or("Dialog input must be a string")?;
            if value.len() > 4096 {
                return Err("Dialog input exceeds 4096 bytes".into());
            }
            if action == "accept" {
                return Ok(Event::Answer(id, json!(value)));
            }
            intent.draft = value.into();
            return Ok(Event::Draft);
        }
        if target == format!("{key}:ok") && action.is_empty() {
            let data = match intent.operation {
                Operation::Alert => Value::Null,
                Operation::Confirm => json!(true),
                Operation::Prompt => json!(intent.draft),
            };
            return Ok(Event::Answer(id, data));
        }
        if (target == key && action == "close")
            || (target == format!("{key}:cancel")
                && action.is_empty()
                && !matches!(intent.operation, Operation::Alert))
        {
            return Ok(Event::Answer(
                id,
                if matches!(intent.operation, Operation::Confirm) {
                    json!(false)
                } else {
                    Value::Null
                },
            ));
        }
        // Background, queued and stale dialog controls do not mutate the active screen.
        Ok(Event::Ignore)
    }
    /// `expected` is the instance the caller claims the dialog belongs to. A mismatch leaves the
    /// request pending, so naming the wrong instance cannot swallow somebody else's dialog.
    pub fn consume(
        &mut self,
        id: u64,
        response: &mut Value,
        expected: Option<&str>,
    ) -> Result<(String, String), String> {
        const UNKNOWN: &str = "Unknown or completed dialog request";
        if let Some(expected) = expected {
            match self.pending.get(&id) {
                Some(intent) if intent.origin == expected => {}
                _ => return Err(UNKNOWN.into()),
            }
        }
        let intent = self.pending.remove(&id).ok_or(UNKNOWN)?;
        self.order.retain(|queued| *queued != id);
        let ok = response["ok"].as_bool().ok_or("Missing dialog result ok")?;
        let data = &response["data"];
        if ok {
            let valid = match intent.operation {
                Operation::Alert => data.is_null(),
                Operation::Confirm => data.is_boolean(),
                Operation::Prompt => {
                    data.is_null() || data.as_str().is_some_and(|s| s.len() <= 4096)
                }
            };
            if !valid {
                return Err("Invalid dialog response type or size".into());
            }
        } else if !data.is_null() {
            return Err("Failed dialog result must have null data".into());
        }
        response["cancelled"] = json!(
            ok && match intent.operation {
                Operation::Alert => false,
                Operation::Confirm => data == &Value::Bool(false),
                Operation::Prompt => data.is_null(),
            }
        );
        response["operation"] =
            serde_json::to_value(intent.operation).map_err(|e| e.to_string())?;
        Ok((intent.handler, intent.origin))
    }
    pub fn take(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.ready)
    }
    pub fn layout(
        &self,
        width: f64,
        height: &mut f64,
        layer: usize,
        widgets: &mut Vec<Widget>,
    ) -> Option<Modal> {
        let (id, intent) = self.active()?;
        let key = format!(":dialog:{id}");
        let ww = 440.0_f64.min(width - 32.0);
        let content_width = ww - 32.0;
        let lines = wrap_message(&intent.message, (content_width / 14.0).floor() as usize);
        let mh = (lines.len() as f64 * 22.0).clamp(22.0, 220.0);
        let prompt = matches!(intent.operation, Operation::Prompt);
        let wh = 58.0 + mh + 12.0 + if prompt { 78.0 } else { 0.0 } + 40.0 + 20.0;
        *height = height.max(320.0).max(wh + 32.0);
        let x = (width - ww) / 2.0;
        let y = (*height - wh) / 2.0;
        let mut add = |kind: &str,
                       suffix: &str,
                       px,
                       py,
                       pw,
                       ph,
                       text: &str,
                       payload: Value,
                       config: Value| {
            let part_key = if suffix.is_empty() {
                key.clone()
            } else {
                format!("{key}:{suffix}")
            };
            let target = if ["window", "window-close"].contains(&kind) {
                key.clone()
            } else {
                part_key.clone()
            };
            let mut w = Widget {
                layer,
                key: part_key,
                target,
                kind: kind.into(),
                x: px,
                y: py,
                width: pw,
                height: ph,
                text: text.into(),
                value: String::new(),
                variant: String::new(),
                disabled: false,
                selected: false,
                cells: vec![],
                fractions: vec![],
                payload,
                config,
            };
            if kind == "textfield" {
                w.value = intent.draft.clone();
            }
            if suffix == "ok" {
                w.variant = "primary".into();
            }
            widgets.push(w);
        };
        add(
            "backdrop",
            "backdrop",
            0.0,
            0.0,
            width,
            *height,
            "",
            json!({}),
            json!({}),
        );
        let has_icon = !matches!(intent.icon, Icon::Named(NamedIcon::None));
        add(
            "window",
            "",
            x,
            y,
            ww,
            wh,
            title(&intent.operation),
            json!({}),
            json!({"dialog":true,"icon":has_icon}),
        );
        add(
            "window-close",
            "close",
            x + ww - 42.0,
            y + 8.0,
            32.0,
            30.0,
            "×",
            json!({"action":"close"}),
            json!({}),
        );
        if has_icon {
            add(
                "dialog-icon",
                "icon",
                x + 14.0,
                y + 8.0,
                32.0,
                32.0,
                "",
                json!({}),
                json!({"icon":intent.icon,"operation":intent.operation}),
            );
        }
        add(
            "dialog-message",
            "message",
            x + 16.0,
            y + 58.0,
            content_width,
            mh,
            &intent.message,
            json!({}),
            json!({"lines":lines}),
        );
        if prompt {
            add(
                "textfield",
                "input",
                x + 16.0,
                y + 58.0 + mh + 12.0,
                content_width,
                62.0,
                "入力内容",
                json!({}),
                json!({"dialog":true,"labelHeight":22,"inputType":"text","placeholder":"","required":false,"readOnly":false,"maxLength":4096,"minLength":null}),
            );
        }
        let button_width = 88.0_f64.min((content_width - 10.0) / 2.0);
        if !matches!(intent.operation, Operation::Alert) {
            add(
                "button",
                "cancel",
                x + ww - 16.0 - button_width * 2.0 - 10.0,
                y + wh - 60.0,
                button_width,
                40.0,
                "キャンセル",
                json!({}),
                json!({}),
            );
        }
        add(
            "button",
            "ok",
            x + ww - 16.0 - button_width,
            y + wh - 60.0,
            button_width,
            40.0,
            "OK",
            json!({}),
            json!({}),
        );
        Some(Modal {
            key: key.clone(),
            target: key,
            layer,
        })
    }
}
fn title(operation: &Operation) -> &'static str {
    match operation {
        Operation::Alert => "お知らせ",
        Operation::Confirm => "確認",
        Operation::Prompt => "入力",
    }
}
fn wrap_message(message: &str, columns: usize) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in message.split('\n') {
        let chars: Vec<char> = paragraph.chars().collect();
        if chars.is_empty() {
            lines.push(String::new());
        } else {
            lines.extend(
                chars
                    .chunks(columns.max(1))
                    .map(|chunk| chunk.iter().collect::<String>()),
            );
        }
    }
    lines
}
fn enqueue(
    queue: &RefCell<Vec<Intent>>,
    origin: &str,
    operation: Operation,
    message: ImmutableString,
    default_value: ImmutableString,
    handler: ImmutableString,
    options: Option<Map>,
) -> Result<(), Box<EvalAltResult>> {
    if message.len() > 4096 || default_value.len() > 4096 || handler.len() > 80 {
        return Err(
            "Dialog message/default require at most 4096 bytes; handler at most 80 bytes".into(),
        );
    }
    if !matches!(operation, Operation::Alert) && handler.is_empty() {
        return Err("confirm/prompt require a completion handler".into());
    }
    let options: Options = match options {
        Some(options) => rhai::serde::from_dynamic(&Dynamic::from_map(options))
            .map_err(|e| -> Box<EvalAltResult> { format!("Dialog options: {e}").into() })?,
        None => Options::default(),
    };
    let icon = options
        .icon
        .unwrap_or_else(|| Icon::Named(operation.default_icon()));
    icon.validate()?;
    let mut queue = queue.borrow_mut();
    if queue.len() >= 8 {
        return Err("At most 8 dialogs per handler".into());
    }
    queue.push(Intent {
        origin: origin.to_owned(),
        operation,
        message: message.to_string(),
        default_value: default_value.to_string(),
        draft: default_value.to_string(),
        handler: handler.to_string(),
        icon,
    });
    Ok(())
}
