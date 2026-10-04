use super::{theme, Package, Runtime};
use serde_json::{json, Value};
use std::cell::RefCell;

thread_local! {
    static RUNTIME: RefCell<Option<Runtime>> = const { RefCell::new(None) };
    static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn execute(request: Value) -> Result<Value, String> {
    let clock: Option<crate::extensions::Clock> = request
        .get("clock")
        .map(|value| serde_json::from_value(value.clone()).map_err(|e| e.to_string()))
        .transpose()?;
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
            let mut descriptors = std::collections::HashMap::new();
            if let Some(value) = request.get("descriptors") {
                let values = value.as_object().ok_or("Invalid descriptors")?;
                if values.len()>8 {return Err("At most 8 descriptors".into());}
                for (name,id) in values {
                    let id=id.as_u64().filter(|id| *id>0 && *id<=u32::MAX as u64).ok_or("Invalid descriptor buffer")? as u32;
                    descriptors.insert(name.clone(),crate::buffers::take(id)?);
                }
            }
            let mut runtime = Runtime::load_with_clock(package, script, descriptors, clock, |_| {})?;
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
            runtime.with_clock(clock, |runtime| {
                runtime.dispatch(target, request.get("payload").cloned().unwrap_or(json!({})))?;
                result(runtime)
            })
        }),
        "http_result" | "storage_result" | "file_result" | "rpc_result" | "dialog_result" => RUNTIME.with(|r| {
            let mut slot = r.borrow_mut();
            let runtime = slot.as_mut().ok_or("No screen loaded")?;
            let channel = match request["op"].as_str() {Some("storage_result")=>"Storage",Some("file_result")=>"File",Some("rpc_result")=>"RPC",Some("dialog_result")=>"Dialog",_=>"HTTP"};
            let id = request.get("id").and_then(Value::as_u64).ok_or_else(|| format!("Missing {channel} request id"))?;
            let ok = request.get("ok").and_then(Value::as_bool).ok_or_else(|| format!("Missing {channel} result ok"))?;
            let error = request.get("error").and_then(Value::as_str).unwrap_or("");
            if error.len() > 2048 { return Err(format!("{channel} error exceeds 2048 bytes")); }
            let response=json!({"ok":ok,"data":request.get("data").cloned().unwrap_or(Value::Null),"error":error});
            runtime.with_clock(clock, |runtime| {
            if request["op"]=="storage_result" {runtime.complete_storage(id,response)?;}
            else if request["op"]=="dialog_result" {runtime.complete_dialog(id,response)?;}
            else if request["op"]=="file_result" || request["op"]=="rpc_result" {
                let buffer = request.get("buffer").map(|v| v.as_u64().filter(|id| *id>0 && *id<=u32::MAX as u64).map(|id| id as u32).ok_or("Invalid buffer id")).transpose()?;
                if !ok && buffer.is_some() { return Err("Failed completion must not carry a binary buffer".into()); }
                if request["op"]=="file_result" {runtime.complete_file(id,response,buffer)?;}
                else {runtime.complete_rpc(id,response,buffer)?;}
            } else {runtime.complete_http(id,response)?;}
            result(runtime)
            })
        }),
        "host_progress" => RUNTIME.with(|r| {
            let mut slot = r.borrow_mut();
            let runtime = slot.as_mut().ok_or("No screen loaded")?;
            let id = request.get("id").and_then(Value::as_u64).ok_or("Missing host request id")?;
            let response = request.get("data").cloned().ok_or("Missing host progress data")?;
            runtime.with_clock(clock, |runtime| {
                runtime.progress_host(id, response)?;
                result(runtime)
            })
        }),
        "host_result" => RUNTIME.with(|r| {
            let mut slot = r.borrow_mut();
            let runtime = slot.as_mut().ok_or("No screen loaded")?;
            let id = request.get("id").and_then(Value::as_u64).ok_or("Missing host request id")?;
            let response = json!({
                "ok": request.get("ok").cloned().unwrap_or(Value::Null),
                "data": request.get("data").cloned().unwrap_or(Value::Null),
                "error": request.get("error").cloned().unwrap_or(Value::Null),
            });
            runtime.with_clock(clock, |runtime| {
                runtime.complete_host(id, response)?;
                result(runtime)
            })
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
