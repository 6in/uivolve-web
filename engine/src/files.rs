use crate::{buffers, storage::safe_key};
use rhai::{Blob, Dynamic, Engine, EvalAltResult, ImmutableString};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};

thread_local! { static BYTE_USAGE: Cell<usize> = const { Cell::new(0) }; }
struct Bytes(Vec<u8>);
impl Drop for Bytes {
    fn drop(&mut self) {
        BYTE_USAGE.with(|used| used.set(used.get() - self.0.len()));
    }
}
/// A bounded, immutable binary value for Rhai. Sharing avoids JSON arrays and
/// Rhai's array/BLOB limit, while keeping the existing array limit unchanged.
#[derive(Clone)]
pub struct FileBytes(Rc<Bytes>);
impl FileBytes {
    pub fn new(bytes: Vec<u8>) -> Result<Self, String> {
        if bytes.len() > buffers::LIMIT {
            return Err("FileBytes exceeds 1 MB".into());
        }
        BYTE_USAGE.with(|used| {
            if used.get() + bytes.len() > 8_000_000 {
                return Err("FileBytes capacity exceeds 8 MB".into());
            }
            used.set(used.get() + bytes.len());
            Ok(Self(Rc::new(Bytes(bytes))))
        })
    }
    pub fn as_slice(&self) -> &[u8] {
        &self.0 .0
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Opfs,
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    Read,
    Readwrite,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub backend: Backend,
    pub access: Access,
    pub handler: String,
}
#[derive(Clone)]
pub struct Intent {
    name: String,
    path: String,
    operation: String,
    text: Option<String>,
    bytes: Option<Blob>,
}
struct Pending {
    intent: Intent,
    buffer: Option<u32>,
}
#[derive(Default)]
pub struct Requests {
    queue: Rc<RefCell<Vec<Intent>>>,
    pending: HashMap<u64, Pending>,
    sequence: u64,
    ready: Vec<Value>,
}
pub fn path(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 1024
        || value.contains(['\\', '\0'])
        || value.split('/').count() > 16
        || value
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == ".." || p.len() > 255)
    {
        return Err("File path must be a relative path inside the volume".into());
    }
    Ok(())
}
impl Requests {
    pub fn register(&self, engine: &mut Engine) {
        engine.register_type_with_name::<FileBytes>("FileBytes");
        engine.register_fn("len", |bytes: &mut FileBytes| {
            bytes.as_slice().len() as rhai::INT
        });
        engine.register_indexer_get(
            |bytes: &mut FileBytes, index: rhai::INT| -> Result<rhai::INT, Box<EvalAltResult>> {
                let index = usize::try_from(index).map_err(|_| "FileBytes index out of bounds")?;
                bytes
                    .as_slice()
                    .get(index)
                    .map(|b| *b as rhai::INT)
                    .ok_or_else(|| "FileBytes index out of bounds".into())
            },
        );
        engine.register_fn(
            "file_bytes",
            |size: rhai::INT, fill: rhai::INT| -> Result<FileBytes, Box<EvalAltResult>> {
                if !(0..=buffers::LIMIT as rhai::INT).contains(&size) || !(0..=255).contains(&fill)
                {
                    return Err("FileBytes requires 0–1 MB size and 0–255 fill".into());
                }
                FileBytes::new(vec![fill as u8; size as usize]).map_err(Into::into)
            },
        );
        engine.register_fn(
            "file_bytes",
            |text: ImmutableString| -> Result<FileBytes, Box<EvalAltResult>> {
                FileBytes::new(text.as_bytes().to_vec()).map_err(Into::into)
            },
        );
        engine.register_fn(
            "file_bytes",
            |bytes: Blob| -> Result<FileBytes, Box<EvalAltResult>> {
                FileBytes::new(bytes).map_err(Into::into)
            },
        );
        for op in ["read_text", "read_bytes", "mkdir", "list", "stat", "remove"] {
            let queue = self.queue.clone();
            engine.register_fn(
                format!("file_{op}"),
                move |name: ImmutableString,
                      file: ImmutableString|
                      -> Result<(), Box<EvalAltResult>> {
                    enqueue(&queue, name.to_string(), file.to_string(), op, None, None)
                },
            );
        }
        let queue = self.queue.clone();
        engine.register_fn(
            "file_write_text",
            move |name: ImmutableString,
                  file: ImmutableString,
                  text: ImmutableString|
                  -> Result<(), Box<EvalAltResult>> {
                enqueue(
                    &queue,
                    name.to_string(),
                    file.to_string(),
                    "write_text",
                    Some(text.to_string()),
                    None,
                )
            },
        );
        let queue = self.queue.clone();
        engine.register_fn(
            "file_write_bytes",
            move |name: ImmutableString,
                  file: ImmutableString,
                  bytes: Blob|
                  -> Result<(), Box<EvalAltResult>> {
                enqueue(
                    &queue,
                    name.to_string(),
                    file.to_string(),
                    "write_bytes",
                    None,
                    Some(bytes),
                )
            },
        );
        let queue = self.queue.clone();
        engine.register_fn(
            "file_write_bytes",
            move |name: ImmutableString,
                  file: ImmutableString,
                  bytes: FileBytes|
                  -> Result<(), Box<EvalAltResult>> {
                enqueue(
                    &queue,
                    name.to_string(),
                    file.to_string(),
                    "write_bytes",
                    None,
                    Some(bytes.as_slice().to_vec()),
                )
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
            return Err("At most 8 pending file requests".into());
        }
        for (i, intent) in intents.iter().enumerate() {
            let definition = definitions
                .get(&intent.name)
                .ok_or_else(|| format!("Unknown file volume: {}", intent.name))?;
            if definition.access == Access::Read
                && ["write_text", "write_bytes", "mkdir", "remove"]
                    .contains(&intent.operation.as_str())
            {
                return Err(format!("File volume {} is read-only", intent.name));
            }
            // Serialize a whole volume, including parent directory operations.
            if intents[..i].iter().any(|p| p.name == intent.name)
                || self.pending.values().any(|p| p.intent.name == intent.name)
            {
                return Err(format!("File volume already pending: {}", intent.name));
            }
        }
        buffers::capacity(
            intents
                .iter()
                .filter_map(|i| i.bytes.as_ref())
                .map(Vec::len)
                .sum(),
            intents.iter().filter(|i| i.bytes.is_some()).count(),
        )?;
        Ok(intents)
    }
    pub fn commit(&mut self, intents: Vec<Intent>) {
        for mut intent in intents {
            self.sequence += 1;
            let buffer = intent
                .bytes
                .take()
                .map(|b| buffers::put(b).expect("prepared buffer capacity"));
            let mut effect = json!({"kind":"file", "id":self.sequence, "volume":intent.name, "path":intent.path, "operation":intent.operation});
            if let Some(text) = &intent.text {
                effect["data"] = json!(text);
            }
            if let Some(id) = buffer {
                effect["buffer"] = json!(id);
            }
            self.ready.push(effect);
            self.pending
                .insert(self.sequence, Pending { intent, buffer });
        }
    }
    pub fn size(intents: &[Intent]) -> (usize, usize) {
        (
            intents
                .iter()
                .filter_map(|i| i.bytes.as_ref())
                .map(Vec::len)
                .sum(),
            intents.iter().filter(|i| i.bytes.is_some()).count(),
        )
    }
    pub fn consume(
        &mut self,
        id: u64,
        response: &mut rhai::Map,
        buffer: Option<u32>,
    ) -> Result<String, String> {
        let pending = self
            .pending
            .remove(&id)
            .ok_or("Unknown or completed file request")?;
        if let Some(id) = pending.buffer {
            buffers::release(id);
        }
        response.insert("operation".into(), pending.intent.operation.clone().into());
        response.insert("path".into(), pending.intent.path.into());
        response.insert("volume".into(), pending.intent.name.clone().into());
        if pending.intent.operation == "read_bytes"
            && response
                .get("ok")
                .is_some_and(|v| v.as_bool().unwrap_or(false))
            && buffer.is_none()
        {
            return Err("read_bytes success requires a binary buffer".into());
        }
        if let Some(id) = buffer {
            let data = buffers::take(id)?;
            if pending.intent.operation != "read_bytes" {
                return Err("Binary completion requires read_bytes".into());
            }
            response.insert("data".into(), Dynamic::from(FileBytes::new(data)?));
        }
        Ok(pending.intent.name)
    }
    pub fn take(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.ready)
    }
}
impl Drop for Requests {
    fn drop(&mut self) {
        for p in self.pending.values() {
            if let Some(id) = p.buffer {
                buffers::release(id);
            }
        }
    }
}
fn enqueue(
    queue: &RefCell<Vec<Intent>>,
    name: String,
    file: String,
    operation: &str,
    text: Option<String>,
    bytes: Option<Blob>,
) -> Result<(), Box<EvalAltResult>> {
    if !safe_key(&name) {
        return Err("Invalid file volume name".into());
    }
    if !(file.is_empty() && ["list", "stat"].contains(&operation)) {
        path(&file)?;
    }
    if text.as_ref().is_some_and(|t| t.len() > 100_000)
        || bytes.as_ref().is_some_and(|b| b.len() > buffers::LIMIT)
    {
        return Err("File content exceeds size limit".into());
    }
    let mut queue = queue.borrow_mut();
    if queue.len() >= 8 {
        return Err("At most 8 file requests per handler".into());
    }
    queue.push(Intent {
        name,
        path: file,
        operation: operation.into(),
        text,
        bytes,
    });
    Ok(())
}
