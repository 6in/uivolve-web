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

pub enum Intent {
    Call { operation: String, args: Value },
    Cancel { operation: String },
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
                if queue
                    .iter()
                    .filter(|intent| matches!(intent, Intent::Call { .. }))
                    .count()
                    >= 8
                {
                    return Err("At most 8 host calls per handler".into());
                }
                let args: Value = rhai::serde::from_dynamic(&args.into())?;
                if serde_json::to_vec(&args).map_err(|e| e.to_string())?.len() > 100_000 {
                    return Err("Host arguments exceed 100 KB".into());
                }
                queue.push(Intent::Call {
                    operation: operation.to_string(),
                    args,
                });
                Ok(())
            },
        );
        let queue = self.queue.clone();
        engine.register_fn("host_cancel", move |operation: ImmutableString| {
            queue.borrow_mut().push(Intent::Cancel {
                operation: operation.to_string(),
            });
        });
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
            if let Some(handler) = definition.options.get("progressHandler") {
                if !handler
                    .as_str()
                    .is_some_and(|name| functions.contains(name))
                {
                    return Err(format!("Host operation {name}: undefined progress handler"));
                }
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
        if self.pending.len()
            + intents
                .iter()
                .filter(|intent| matches!(intent, Intent::Call { .. }))
                .count()
            > 8
        {
            return Err("At most 8 pending host calls".into());
        }
        for intent in &intents {
            if let Intent::Call { operation, .. } = intent {
                if !definitions.contains_key(operation) {
                    return Err(format!("Unknown host operation: {operation}"));
                }
            }
        }
        Ok(intents)
    }

    pub fn commit(&mut self, intents: Vec<Intent>) {
        for intent in intents {
            match intent {
                Intent::Cancel { operation } => {
                    if self.pending.values().any(|name| name == &operation) {
                        self.ready
                            .push(json!({"kind":"host_cancel", "v":1, "operation":operation}));
                    }
                }
                Intent::Call { operation, args } => {
                    self.sequence += 1;
                    self.pending.insert(self.sequence, operation.clone());
                    self.ready.push(json!({
                        "kind":"host", "v":1, "id":self.sequence,
                        "operation":operation, "args":args,
                    }));
                }
            }
        }
    }

    pub fn progress(&self, id: u64, response: &Value) -> Result<String, String> {
        let operation = self
            .pending
            .get(&id)
            .ok_or("Unknown or completed host call")?;
        let object = response.as_object().ok_or("Invalid host progress")?;
        let transferred = response["transferred"]
            .as_u64()
            .filter(|value| *value <= 9_007_199_254_740_991);
        let total = &response["total"];
        if object.len() != 3
            || !object.contains_key("total")
            || response["operation"].as_str() != Some(operation.as_str())
            || transferred.is_none()
            || !(total.is_null()
                || total.as_u64().is_some_and(|value| {
                    value <= 9_007_199_254_740_991 && value >= transferred.unwrap()
                }))
        {
            return Err("Invalid host progress".into());
        }
        Ok(operation.clone())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_is_independent_and_progress_keeps_pending() {
        let mut requests = Requests::default();
        requests.commit(vec![
            Intent::Call {
                operation: "download".into(),
                args: json!({}),
            },
            Intent::Call {
                operation: "other".into(),
                args: json!({}),
            },
            Intent::Cancel {
                operation: "download".into(),
            },
            Intent::Cancel {
                operation: "unknown".into(),
            },
        ]);
        let effects = requests.take();
        assert_eq!(effects.len(), 3);
        assert_eq!(effects[2]["kind"], "host_cancel");
        let progress = json!({"operation":"download", "transferred":0, "total":null});
        assert_eq!(requests.progress(1, &progress).unwrap(), "download");
        assert!(requests.progress(2, &progress).is_err());
        assert!(requests
            .progress(
                1,
                &json!({"operation":"download", "transferred":2, "total":1})
            )
            .is_err());
        assert_eq!(requests.consume(1).unwrap(), "download");
        assert!(requests.progress(1, &progress).is_err());
        assert_eq!(requests.consume(2).unwrap(), "other");
    }
}
