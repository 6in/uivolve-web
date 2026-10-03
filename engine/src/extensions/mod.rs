//! Shared native functions available to every downloaded Rhai page.
use rhai::{Array, Engine, EvalAltResult, INT};
mod regex;

pub fn register(engine: &mut Engine) {
    regex::register(engine);
    engine.register_fn("sum_ints", sum_ints);
}

fn sum_ints(values: Array) -> Result<INT, Box<EvalAltResult>> {
    if values.len() > 10_000 {
        return Err("sum_ints: at most 10000 values".into());
    }
    values.into_iter().try_fold(0 as INT, |sum, value| {
        let value = value
            .try_cast::<INT>()
            .ok_or("sum_ints: every value must be an integer")?;
        sum.checked_add(value)
            .ok_or_else(|| "sum_ints: integer overflow".into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Package, Runtime};
    use serde_json::json;

    #[test]
    fn applications_can_register_typed_functions_without_changing_runtime_or_renderers() {
        let package: Package = serde_json::from_value(json!({
            "version":1,"id":"custom","title":"Custom","script":"custom.rhai","state":{},
            "ui":{"xtype":"button","itemId":"calculate","handler":"calculate"}
        }))
        .unwrap();
        let mut runtime = Runtime::load_with_extensions(
            package,
            "fn init(s) {s.value=twice(21); s} fn calculate(s,e) {s.value=twice(s.value); s}",
            |engine| {
                engine.register_fn("twice", |value: INT| -> Result<INT, Box<EvalAltResult>> {
                    value.checked_mul(2).ok_or_else(|| "twice: overflow".into())
                });
            },
        )
        .unwrap();
        assert_eq!(runtime.state_json().unwrap()["value"], 42);
        runtime.dispatch("calculate", json!({})).unwrap();
        assert_eq!(runtime.state_json().unwrap()["value"], 84);
    }
}
