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
    /// Queued navigations as (page name, origin): the instance that asked, the empty path being
    /// the root. One navigation per handler stays a screen-wide rule.
    queue: Rc<RefCell<Vec<(String, String)>>>,
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

    pub fn register(&self, engine: &mut Engine, origin: &str) {
        let queue = self.queue.clone();
        let from = origin.to_owned();
        engine.register_fn(
            "navigate",
            move |name: ImmutableString| -> Result<(), Box<EvalAltResult>> {
                let mut queue = queue.borrow_mut();
                if !queue.is_empty() {
                    return Err("At most one navigation per handler".into());
                }
                queue.push((name.to_string(), from.clone()));
                Ok(())
            },
        );
    }

    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }

    /// `pages_of` resolves the `pages` an origin declared: a child navigates through its own
    /// definitions, not through the ones the root happens to carry.
    pub fn prepare<'a>(
        &self,
        pages_of: &dyn Fn(&str) -> Option<&'a HashMap<String, Definition>>,
    ) -> Result<Vec<Value>, crate::composition::Blame> {
        let names = std::mem::take(&mut *self.queue.borrow_mut());
        if self.ready.len() + names.len() > 8 {
            // Screen-wide: one undelivered queue for the whole screen.
            return Err((String::new(), "At most 8 undelivered navigations".into()));
        }
        names
            .into_iter()
            .map(|(name, origin)| {
                let page = pages_of(&origin)
                    .and_then(|definitions| definitions.get(&name))
                    .ok_or_else(|| (origin.clone(), format!("Unknown page: {name}")))?;
                let mut effect = json!({"kind":"navigate", "page":name, "url":page.url});
                if !origin.is_empty() {
                    effect["instance"] = json!(origin);
                }
                Ok(effect)
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
