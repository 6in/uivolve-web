use std::{cell::RefCell, collections::HashMap};

pub const LIMIT: usize = 1_000_000;
thread_local! {
    static STORE: RefCell<Store> = RefCell::new(Store::default());
}
#[derive(Default)]
struct Store {
    sequence: u32,
    values: HashMap<u32, Vec<u8>>,
}
pub fn capacity(bytes: usize, count: usize) -> Result<(), String> {
    STORE.with(|s| {
        let s = s.borrow();
        if s.values.len() + count > 32
            || s.values.values().map(Vec::len).sum::<usize>() + bytes > 16_000_000
        {
            Err("Binary buffer capacity exceeded".into())
        } else {
            Ok(())
        }
    })
}
pub fn put(bytes: Vec<u8>) -> Result<u32, String> {
    if bytes.len() > LIMIT {
        return Err("Binary buffer exceeds 1 MB".into());
    }
    capacity(bytes.len(), 1)?;
    STORE.with(|s| {
        let mut s = s.borrow_mut();
        s.sequence = s
            .sequence
            .checked_add(1)
            .ok_or("Binary buffer ids exhausted")?;
        let id = s.sequence;
        s.values.insert(id, bytes);
        Ok(id)
    })
}
pub fn take(id: u32) -> Result<Vec<u8>, String> {
    STORE.with(|s| {
        s.borrow_mut()
            .values
            .remove(&id)
            .ok_or("Unknown binary buffer".into())
    })
}
pub fn release(id: u32) {
    STORE.with(|s| {
        s.borrow_mut().values.remove(&id);
    });
}

/// # Safety
/// ptr/len must refer to initialized input_alloc memory, live for this call.
#[no_mangle]
pub unsafe extern "C" fn buffer_store(ptr: *const u8, len: usize) -> u32 {
    if len > LIMIT {
        return 0;
    }
    put(std::slice::from_raw_parts(ptr, len).to_vec()).unwrap_or(0)
}
// The pointer remains valid until this id is released. Hosts must copy immediately,
// recreate their memory view after allocation, and never mutate the returned bytes.
#[no_mangle]
pub extern "C" fn buffer_ptr(id: u32) -> *const u8 {
    STORE.with(|s| {
        s.borrow()
            .values
            .get(&id)
            .map_or(std::ptr::null(), |v| v.as_ptr())
    })
}
#[no_mangle]
pub extern "C" fn buffer_len(id: u32) -> usize {
    STORE.with(|s| s.borrow().values.get(&id).map_or(0, Vec::len))
}
#[no_mangle]
pub extern "C" fn buffer_free(id: u32) {
    release(id);
}
