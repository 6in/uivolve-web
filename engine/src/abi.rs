use super::{theme, Package, Runtime};
use serde_json::{json, Value};
use std::cell::RefCell;

thread_local! {
    static RUNTIME: RefCell<Option<Runtime>> = const { RefCell::new(None) };
    static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn execute(request: Value) -> Result<Value, String> {
    match request.get("op").and_then(Value::as_str).unwrap_or("") {
        "theme" => {
            if let Some(value) = request.get("theme") {
                theme::apply(value.clone())?;
            }
            serde_json::to_value(theme::current()).map_err(|e| e.to_string())
        }
        "load" => {
            let package: Package =
                serde_json::from_value(request.get("package").cloned().ok_or("Missing package")?)
                    .map_err(|e| e.to_string())?;
            let script = request
                .get("script")
                .and_then(Value::as_str)
                .ok_or("Missing script")?;
            let mut runtime = Runtime::load(package, script)?;
            let result = result(&mut runtime)?;
            RUNTIME.with(|r| *r.borrow_mut() = Some(runtime));
            Ok(result)
        }
        "event" => RUNTIME.with(|r| {
            let mut slot = r.borrow_mut();
            let runtime = slot.as_mut().ok_or("No screen loaded")?;
            let target = request
                .get("target")
                .and_then(Value::as_str)
                .ok_or("Missing target")?;
            runtime.dispatch(target, request.get("payload").cloned().unwrap_or(json!({})))?;
            result(runtime)
        }),
        "http_result" | "storage_result" => RUNTIME.with(|r| {
            let mut slot = r.borrow_mut();
            let runtime = slot.as_mut().ok_or("No screen loaded")?;
            let channel = if request["op"]=="storage_result" {"Storage"} else {"HTTP"};
            let id = request.get("id").and_then(Value::as_u64).ok_or_else(|| format!("Missing {channel} request id"))?;
            let ok = request.get("ok").and_then(Value::as_bool).ok_or_else(|| format!("Missing {channel} result ok"))?;
            let error = request.get("error").and_then(Value::as_str).unwrap_or("");
            if error.len() > 2048 { return Err(format!("{channel} error exceeds 2048 bytes")); }
            let response=json!({"ok":ok,"data":request.get("data").cloned().unwrap_or(Value::Null),"error":error});
            if request["op"]=="storage_result" {runtime.complete_storage(id,response)?;} else {runtime.complete_http(id,response)?;}
            result(runtime)
        }),
        "layout" => RUNTIME.with(|r| {
            let slot = r.borrow();
            let runtime = slot.as_ref().ok_or("No screen loaded")?;
            let width = request
                .get("width")
                .and_then(Value::as_f64)
                .ok_or("Missing width")?;
            serde_json::to_value(runtime.layout(width)?).map_err(|e| e.to_string())
        }),
        _ => Err("Unknown operation".into()),
    }
}

fn result(runtime: &mut Runtime) -> Result<Value, String> {
    let mut result = json!({"state":runtime.state_json()?,"revision":runtime.revision});
    let effects = runtime.take_effects();
    if !effects.is_empty() {
        result["effects"] = serde_json::to_value(effects).map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[no_mangle]
pub extern "C" fn input_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// # Safety
/// ptr/len must describe the live allocation returned by input_alloc, exactly once.
#[no_mangle]
pub unsafe extern "C" fn input_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

/// # Safety
/// ptr/len must refer to an initialized input_alloc allocation that remains live for this call.
#[no_mangle]
pub unsafe extern "C" fn request(ptr: *const u8, len: usize) -> *const u8 {
    let result = if len > 2_000_000 {
        Err("Request exceeds 2 MB".into())
    } else {
        serde_json::from_slice(std::slice::from_raw_parts(ptr, len))
            .map_err(|e| e.to_string())
            .and_then(execute)
    };
    let value = match result {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    RESPONSE.with(|r| {
        let mut response = r.borrow_mut();
        *response = serde_json::to_vec(&value).unwrap();
        response.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn response_len() -> usize {
    RESPONSE.with(|r| r.borrow().len())
}
