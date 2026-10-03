use crate::{buffers, storage::safe_key};
use prost_reflect::{prost::Message, DescriptorPool, DynamicMessage, MethodDescriptor};
use rhai::{Dynamic, Engine, EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, rc::Rc};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Protocol {
    Connect,
    GrpcWeb,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Definition {
    pub url: String,
    pub descriptor: String,
    pub service: String,
    pub method: String,
    pub protocol: Protocol,
    pub handler: String,
    #[serde(default)]
    pub idempotent: bool,
}
pub struct Intent {
    name: String,
    bytes: Vec<u8>,
}
struct Pending {
    name: String,
    buffer: u32,
}
#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<(String, Value)>>>,
    methods: HashMap<String, MethodDescriptor>,
    pending: HashMap<u64, Pending>,
    sequence: u64,
    ready: Vec<Value>,
}
impl Requests {
    pub fn initialize(
        &mut self,
        definitions: &HashMap<String, Definition>,
        descriptors: HashMap<String, Vec<u8>>,
    ) -> Result<(), String> {
        if definitions.len() > 8 || descriptors.len() > 8 {
            return Err("At most 8 RPC definitions/descriptors".into());
        }
        let wanted: std::collections::HashSet<_> = definitions
            .values()
            .map(|d| d.descriptor.as_str())
            .collect();
        if wanted.len() != descriptors.len()
            || wanted.iter().any(|key| !descriptors.contains_key(*key))
        {
            return Err("RPC descriptors do not match definitions".into());
        }
        let mut pools = HashMap::new();
        for (key, bytes) in descriptors {
            if bytes.len() > buffers::LIMIT {
                return Err("Descriptor exceeds 1 MB".into());
            }
            pools.insert(
                key,
                DescriptorPool::decode(bytes.as_slice()).map_err(|e| format!("Descriptor: {e}"))?,
            );
        }
        for (name, definition) in definitions {
            if !safe_key(name) || definition.url.is_empty() || definition.url.len() > 2048 {
                return Err("Invalid RPC name/URL".into());
            }
            let service = pools[&definition.descriptor]
                .get_service_by_name(&definition.service)
                .ok_or_else(|| format!("Unknown RPC service: {}", definition.service))?;
            let method = service
                .methods()
                .find(|m| m.name() == definition.method)
                .ok_or_else(|| format!("Unknown RPC method: {}", definition.method))?;
            if method.is_client_streaming() || method.is_server_streaming() {
                return Err("Only Unary RPC is supported".into());
            }
            self.methods.insert(name.clone(), method);
        }
        Ok(())
    }
    pub fn register(&self, engine: &mut Engine) {
        let queue = self.queue.clone();
        engine.register_fn(
            "rpc_call",
            move |name: ImmutableString, data: Dynamic| -> Result<(), Box<EvalAltResult>> {
                let value: Value = rhai::serde::from_dynamic(&data).map_err(|e| e.to_string())?;
                if !value.is_object() {
                    return Err("RPC request must be a map".into());
                }
                let mut queue = queue.borrow_mut();
                if queue.len() >= 8 {
                    return Err("At most 8 RPC calls per handler".into());
                }
                queue.push((name.to_string(), value));
                Ok(())
            },
        );
    }
    pub fn clear(&self) {
        self.queue.borrow_mut().clear();
    }
    pub fn prepare(&self) -> Result<Vec<Intent>, String> {
        let queue = std::mem::take(&mut *self.queue.borrow_mut());
        if self.pending.len() + queue.len() > 8 {
            return Err("At most 8 pending RPC calls".into());
        }
        let mut result = Vec::<Intent>::new();
        for (name, value) in queue {
            let method = self
                .methods
                .get(&name)
                .ok_or_else(|| format!("Unknown RPC request: {name}"))?;
            if result.iter().any(|i| i.name == name)
                || self.pending.values().any(|p| p.name == name)
            {
                return Err(format!("RPC request already pending: {name}"));
            }
            let message = DynamicMessage::deserialize(method.input(), value)
                .map_err(|e| format!("RPC {name}: {e}"))?;
            let bytes = message.encode_to_vec();
            if bytes.len() > buffers::LIMIT {
                return Err("RPC request exceeds 1 MB".into());
            }
            result.push(Intent { name, bytes });
        }
        Ok(result)
    }
    pub fn size(intents: &[Intent]) -> (usize, usize) {
        (intents.iter().map(|i| i.bytes.len()).sum(), intents.len())
    }
    pub fn commit(&mut self, intents: Vec<Intent>, definitions: &HashMap<String, Definition>) {
        for intent in intents {
            let definition = &definitions[&intent.name];
            let buffer = buffers::put(intent.bytes).expect("prepared buffer capacity");
            self.sequence += 1;
            self.ready.push(json!({"kind":"rpc","id":self.sequence,"request":intent.name,"url":definition.url,"protocol":definition.protocol,"idempotent":definition.idempotent,"buffer":buffer}));
            self.pending.insert(
                self.sequence,
                Pending {
                    name: intent.name,
                    buffer,
                },
            );
        }
    }
    pub fn consume(
        &mut self,
        id: u64,
        response: &mut Value,
        buffer: Option<u32>,
    ) -> Result<String, String> {
        let pending = self
            .pending
            .remove(&id)
            .ok_or("Unknown or completed RPC call")?;
        buffers::release(pending.buffer);
        if response["ok"] == true {
            let bytes = buffers::take(buffer.ok_or("RPC success requires a binary buffer")?)?;
            let message =
                DynamicMessage::decode(self.methods[&pending.name].output(), bytes.as_slice())
                    .map_err(|e| format!("RPC response: {e}"))?;
            let data = serde_json::to_value(message).map_err(|e| e.to_string())?;
            if serde_json::to_vec(&data).map_err(|e| e.to_string())?.len() > 1_000_000 {
                return Err("RPC decoded JSON exceeds 1 MB".into());
            }
            response["data"] = data;
        }
        response["request"] = json!(pending.name);
        Ok(pending.name)
    }
    pub fn take(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.ready)
    }
}
impl Drop for Requests {
    fn drop(&mut self) {
        for p in self.pending.values() {
            buffers::release(p.buffer);
        }
    }
}
