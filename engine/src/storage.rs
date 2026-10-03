use rhai::{Dynamic, Engine, EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cell::RefCell, collections::HashMap, rc::Rc};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Indexeddb,
    Opfs,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub backend: Backend,
    pub key: String,
    pub handler: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Read,
    Write,
    Remove,
}
#[derive(Clone)]
pub struct Intent {
    name: String,
    operation: Operation,
    data: Value,
}
#[derive(Serialize)]
pub struct Effect {
    kind: &'static str,
    id: u64,
    request: String,
    backend: Backend,
    key: String,
    operation: Operation,
    data: Value,
}
#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<Intent>>>,
    pending: HashMap<u64, (String, Operation)>,
    ready: Vec<Effect>,
    sequence: u64,
}
pub fn safe_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
impl Requests {
    pub fn register(&self, engine: &mut Engine) {
        for (function, operation) in [
            ("storage_read", Operation::Read),
            ("storage_remove", Operation::Remove),
        ] {
            let queue = self.queue.clone();
            engine.register_fn(
                function,
                move |name: ImmutableString| -> Result<(), Box<EvalAltResult>> {
                    enqueue(&queue, name.to_string(), operation.clone(), Value::Null)
                },
            );
        }
        let queue = self.queue.clone();
        engine.register_fn(
            "storage_write",
            move |name: ImmutableString, value: Dynamic| -> Result<(), Box<EvalAltResult>> {
                let data: Value = rhai::serde::from_dynamic(&value)
                    .map_err(|e| Box::<EvalAltResult>::from(e.to_string()))?;
                if serde_json::to_vec(&data)
                    .map_err(|e| Box::<EvalAltResult>::from(e.to_string()))?
                    .len()
                    > 1_000_000
                {
                    return Err("Storage JSON exceeds 1 MB".into());
                }
                enqueue(&queue, name.to_string(), Operation::Write, data)
            },
        );
    }
    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }
    pub fn prepare(
        &self,
        definitions: &HashMap<String, Definition>,
    ) -> Result<Vec<Intent>, String> {
        let intents = std::mem::take(&mut *self.queue.borrow_mut());
        if self.pending.len() + intents.len() > 8 {
            return Err("At most 8 pending storage requests".into());
        }
        for (i, intent) in intents.iter().enumerate() {
            let definition = definitions
                .get(&intent.name)
                .ok_or_else(|| format!("Unknown storage request: {}", intent.name))?;
            // Different aliases of the same physical record must also be serialized.
            let same_record = |name: &String| {
                let other = &definitions[name];
                std::mem::discriminant(&definition.backend)
                    == std::mem::discriminant(&other.backend)
                    && definition.key == other.key
            };
            if intents[..i].iter().any(|other| same_record(&other.name))
                || self.pending.values().any(|(name, _)| same_record(name))
            {
                return Err(format!("Storage request already pending: {}", intent.name));
            }
        }
        Ok(intents)
    }
    pub fn commit(&mut self, intents: Vec<Intent>, definitions: &HashMap<String, Definition>) {
        for intent in intents {
            self.sequence += 1;
            let definition = &definitions[&intent.name];
            self.ready.push(Effect {
                kind: "storage",
                id: self.sequence,
                request: intent.name.clone(),
                backend: definition.backend.clone(),
                key: definition.key.clone(),
                operation: intent.operation.clone(),
                data: intent.data,
            });
            self.pending
                .insert(self.sequence, (intent.name, intent.operation));
        }
    }
    pub fn consume(&mut self, id: u64) -> Result<(String, Operation), String> {
        self.pending
            .remove(&id)
            .ok_or("Unknown or completed storage request".into())
    }
    pub fn take(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.ready)
    }
}
fn enqueue(
    queue: &RefCell<Vec<Intent>>,
    name: String,
    operation: Operation,
    data: Value,
) -> Result<(), Box<EvalAltResult>> {
    let mut queue = queue.borrow_mut();
    if queue.len() >= 8 {
        return Err("At most 8 storage requests per handler".into());
    }
    queue.push(Intent {
        name,
        operation,
        data,
    });
    Ok(())
}
