use rhai::{Engine, EvalAltResult, ImmutableString, AST};
use serde::Serialize;
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Alert,
    Confirm,
    Prompt,
}
#[derive(Clone)]
pub struct Intent {
    operation: Operation,
    message: String,
    default_value: String,
    handler: String,
}
#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<Intent>>>,
    pending: HashMap<u64, Intent>,
    ready: Vec<Value>,
    sequence: u64,
}
impl Requests {
    pub fn register(&self, engine: &mut Engine) {
        let queue = self.queue.clone();
        engine.register_fn("alert", move |message: ImmutableString| {
            enqueue(&queue, Operation::Alert, message, "".into(), "".into())
        });
        for (function, operation) in [
            ("alert", Operation::Alert),
            ("confirm", Operation::Confirm),
            ("prompt", Operation::Prompt),
        ] {
            let queue = self.queue.clone();
            engine.register_fn(
                function,
                move |message: ImmutableString, handler: ImmutableString| {
                    enqueue(&queue, operation.clone(), message, "".into(), handler)
                },
            );
        }
        let queue = self.queue.clone();
        engine.register_fn(
            "prompt",
            move |message: ImmutableString,
                  default_value: ImmutableString,
                  handler: ImmutableString| {
                enqueue(&queue, Operation::Prompt, message, default_value, handler)
            },
        );
    }
    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }
    pub fn prepare(&self, ast: &AST) -> Result<Vec<Intent>, String> {
        let intents = std::mem::take(&mut *self.queue.borrow_mut());
        if self.pending.len() + intents.len() > 8 {
            return Err("At most 8 pending dialogs".into());
        }
        for intent in &intents {
            if !intent.handler.is_empty()
                && !ast
                    .iter_functions()
                    .any(|f| f.name == intent.handler && f.params.len() == 2)
            {
                return Err(format!(
                    "Dialog: undefined handler {}(state, response)",
                    intent.handler
                ));
            }
        }
        Ok(intents)
    }
    pub fn commit(&mut self, intents: Vec<Intent>) {
        for intent in intents {
            self.sequence += 1;
            self.ready.push(json!({"kind":"dialog", "id":self.sequence, "operation":intent.operation, "message":intent.message, "defaultValue":intent.default_value}));
            self.pending.insert(self.sequence, intent);
        }
    }
    pub fn consume(&mut self, id: u64, response: &mut Value) -> Result<String, String> {
        let intent = self
            .pending
            .remove(&id)
            .ok_or("Unknown or completed dialog request")?;
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
        Ok(intent.handler)
    }
    pub fn take(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.ready)
    }
}
fn enqueue(
    queue: &RefCell<Vec<Intent>>,
    operation: Operation,
    message: ImmutableString,
    default_value: ImmutableString,
    handler: ImmutableString,
) -> Result<(), Box<EvalAltResult>> {
    if message.len() > 4096 || default_value.len() > 4096 || handler.len() > 80 {
        return Err(
            "Dialog message/default require at most 4096 bytes; handler at most 80 bytes".into(),
        );
    }
    if !matches!(operation, Operation::Alert) && handler.is_empty() {
        return Err("confirm/prompt require a completion handler".into());
    }
    let mut queue = queue.borrow_mut();
    if queue.len() >= 8 {
        return Err("At most 8 dialogs per handler".into());
    }
    queue.push(Intent {
        operation,
        message: message.to_string(),
        default_value: default_value.to_string(),
        handler: handler.to_string(),
    });
    Ok(())
}
