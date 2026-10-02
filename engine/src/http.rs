use rhai::{Engine, EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub url: String,
    pub handler: String,
}

#[derive(Serialize)]
pub struct Effect {
    pub id: u64,
    pub request: String,
    pub url: String,
}

// Native functions only enqueue intentions. The host receives them after state validation.
#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<String>>>,
    pending: HashMap<u64, String>,
    ready: Vec<Effect>,
    sequence: u64,
}

impl Requests {
    pub fn register(&self, engine: &mut Engine) {
        let queue = self.queue.clone();
        engine.register_fn(
            "http_get",
            move |name: ImmutableString| -> Result<(), Box<EvalAltResult>> {
                let mut queue = queue.borrow_mut();
                if queue.len() >= 8 {
                    return Err("At most 8 HTTP requests per handler".into());
                }
                queue.push(name.to_string());
                Ok(())
            },
        );
    }

    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }

    pub fn prepare(&self, definitions: &HashMap<String, Request>) -> Result<Vec<String>, String> {
        let names = std::mem::take(&mut *self.queue.borrow_mut());
        if self.pending.len() + names.len() > 8 {
            return Err("At most 8 pending HTTP requests".into());
        }
        for (i, name) in names.iter().enumerate() {
            if !definitions.contains_key(name) {
                return Err(format!("Unknown HTTP request: {name}"));
            }
            if names[..i].contains(name) || self.pending.values().any(|n| n == name) {
                return Err(format!("HTTP request already pending: {name}"));
            }
        }
        Ok(names)
    }

    pub fn commit(&mut self, names: Vec<String>, definitions: &HashMap<String, Request>) {
        for name in names {
            self.sequence += 1;
            self.ready.push(Effect {
                id: self.sequence,
                request: name.clone(),
                url: definitions[&name].url.clone(),
            });
            self.pending.insert(self.sequence, name);
        }
    }

    pub fn consume(&mut self, id: u64) -> Result<String, String> {
        self.pending
            .remove(&id)
            .ok_or("Unknown or completed HTTP request".into())
    }

    pub fn take(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.ready)
    }
}
