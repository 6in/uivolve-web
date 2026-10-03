use rhai::{Engine, EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub url: String,
}

#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<String>>>,
    ready: Vec<Value>,
}

impl Requests {
    pub fn validate(definitions: &HashMap<String, Definition>) -> Result<(), String> {
        if definitions.len() > 8 {
            return Err("At most 8 page definitions".into());
        }
        for (name, page) in definitions {
            if name.is_empty()
                || name.len() > 80
                || page.url.trim().is_empty()
                || page.url.len() > 2048
            {
                return Err("Page needs a name and a URL of at most 2048 bytes".into());
            }
        }
        Ok(())
    }

    pub fn register(&self, engine: &mut Engine) {
        let queue = self.queue.clone();
        engine.register_fn(
            "navigate",
            move |name: ImmutableString| -> Result<(), Box<EvalAltResult>> {
                let mut queue = queue.borrow_mut();
                if !queue.is_empty() {
                    return Err("At most one navigation per handler".into());
                }
                queue.push(name.to_string());
                Ok(())
            },
        );
    }

    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }

    pub fn prepare(&self, definitions: &HashMap<String, Definition>) -> Result<Vec<Value>, String> {
        let names = std::mem::take(&mut *self.queue.borrow_mut());
        if self.ready.len() + names.len() > 8 {
            return Err("At most 8 undelivered navigations".into());
        }
        names
            .into_iter()
            .map(|name| {
                let page = definitions
                    .get(&name)
                    .ok_or_else(|| format!("Unknown page: {name}"))?;
                Ok(json!({"kind":"navigate", "page":name, "url":page.url}))
            })
            .collect()
    }

    pub fn commit(&mut self, effects: Vec<Value>) {
        self.ready.extend(effects);
    }

    pub fn take(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.ready)
    }
}
