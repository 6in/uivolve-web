use rhai::{Engine, EvalAltResult, ImmutableString, Map};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Operation {
    pub connection: String,
    pub action: String,
    pub handler: String,
    #[serde(default = "empty_options")]
    pub options: Value,
}

fn empty_options() -> Value {
    json!({})
}

pub struct Intent {
    operation: String,
    args: Value,
}

#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<Intent>>>,
    pending: HashMap<u64, String>,
    ready: Vec<Value>,
    sequence: u64,
}

impl Requests {
    pub fn register(&self, engine: &mut Engine) {
        let queue = self.queue.clone();
        engine.register_fn(
            "host_call",
            move |operation: ImmutableString, args: Map| -> Result<(), Box<EvalAltResult>> {
                let mut queue = queue.borrow_mut();
                if queue.len() >= 8 {
                    return Err("At most 8 host calls per handler".into());
                }
                let args: Value = rhai::serde::from_dynamic(&args.into())?;
                if serde_json::to_vec(&args).map_err(|e| e.to_string())?.len() > 100_000 {
                    return Err("Host arguments exceed 100 KB".into());
                }
                queue.push(Intent {
                    operation: operation.to_string(),
                    args,
                });
                Ok(())
            },
        );
    }

    pub fn validate(
        definitions: &HashMap<String, Operation>,
        functions: &std::collections::HashSet<String>,
    ) -> Result<(), String> {
        if definitions.len() > 64 {
            return Err("At most 64 host operation definitions".into());
        }
        for (name, definition) in definitions {
            if !crate::storage::safe_key(name)
                || !crate::storage::safe_key(&definition.connection)
                || definition.action.is_empty()
                || definition.action.len() > 80
                || !definition.options.is_object()
                || serde_json::to_vec(&definition.options)
                    .map_err(|e| e.to_string())?
                    .len()
                    > 100_000
            {
                return Err(format!("Invalid host operation: {name}"));
            }
            if !functions.contains(&definition.handler) {
                return Err(format!(
                    "Host operation {name}: undefined handler {}",
                    definition.handler
                ));
            }
        }
        Ok(())
    }

    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }

    pub fn prepare(&self, definitions: &HashMap<String, Operation>) -> Result<Vec<Intent>, String> {
        let intents = std::mem::take(&mut *self.queue.borrow_mut());
        if self.pending.len() + intents.len() > 8 {
            return Err("At most 8 pending host calls".into());
        }
        for intent in &intents {
            if !definitions.contains_key(&intent.operation) {
                return Err(format!("Unknown host operation: {}", intent.operation));
            }
        }
        Ok(intents)
    }

    pub fn commit(&mut self, intents: Vec<Intent>) {
        for intent in intents {
            self.sequence += 1;
            self.pending.insert(self.sequence, intent.operation.clone());
            self.ready.push(json!({
                "kind":"host", "v":1, "id":self.sequence,
                "operation":intent.operation, "args":intent.args,
            }));
        }
    }

    pub fn consume(&mut self, id: u64) -> Result<String, String> {
        self.pending
            .remove(&id)
            .ok_or("Unknown or completed host call".into())
    }

    pub fn take(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.ready)
    }
}

pub fn validate_result(response: &Value) -> Result<(), String> {
    let ok = response
        .get("ok")
        .and_then(Value::as_bool)
        .ok_or("Missing host result ok")?;
    if serde_json::to_vec(response)
        .map_err(|e| e.to_string())?
        .len()
        > 1_000_000
    {
        return Err("Host result exceeds 1 MB".into());
    }
    if ok {
        if !response["error"].is_null() {
            return Err("Successful host result must not carry an error".into());
        }
    } else {
        let error = response["error"].as_object().ok_or("Missing host error")?;
        for key in ["code", "message", "outcome"] {
            let text = error
                .get(key)
                .and_then(Value::as_str)
                .ok_or("Invalid host error")?;
            if text.is_empty() || text.len() > 2048 {
                return Err("Invalid host error".into());
            }
        }
        if !matches!(
            error["outcome"].as_str(),
            Some("not-started" | "failed" | "committed" | "unknown")
        ) || !error.get("retryable").is_some_and(Value::is_boolean)
            || !response["data"].is_null()
        {
            return Err("Invalid host error outcome, retryable or data".into());
        }
    }
    Ok(())
}
