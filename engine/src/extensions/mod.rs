//! Shared native functions available to every downloaded Rhai page.
use rhai::{Array, Engine, EvalAltResult, INT};
use serde::{Deserialize, Serialize};
use std::{cell::Cell, rc::Rc};
pub mod date;
mod regex;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Clock {
    pub now_ms: INT,
    pub tz_offset_minutes: i32,
}

#[derive(Clone, Default)]
pub struct ExtensionContext {
    clock: Rc<Cell<Option<Clock>>>,
}

pub struct ClockGuard {
    context: ExtensionContext,
    previous: Option<Clock>,
}
impl Drop for ClockGuard {
    fn drop(&mut self) {
        self.context.clock.set(self.previous);
    }
}
impl ExtensionContext {
    pub fn enter(&self, clock: Option<Clock>) -> Result<ClockGuard, String> {
        if let Some(clock) = clock {
            date::from_ms(clock.now_ms, clock.tz_offset_minutes).map_err(|e| e.to_string())?;
        }
        let previous = self.clock.replace(clock);
        Ok(ClockGuard {
            context: self.clone(),
            previous,
        })
    }
    fn clock(&self) -> Result<Clock, Box<EvalAltResult>> {
        self.clock
            .get()
            .ok_or_else(|| "clock: host did not supply a clock for this execution".into())
    }
}

pub fn register(engine: &mut Engine) {
    register_with_context(engine, &ExtensionContext::default());
}

pub fn register_with_context(engine: &mut Engine, context: &ExtensionContext) {
    regex::register(engine);
    engine.register_fn("sum_ints", sum_ints);
    date::register(engine, context);
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
    fn runtime_clock_scopes_preserve_old_api_and_clear_after_errors() {
        let package: Package = serde_json::from_value(json!({
            "version":1,"id":"clock","title":"Clock","script":"clock.rhai","state":{},
            "ui":{"xtype":"button","itemId":"run","handler":"run"}
        }))
        .unwrap();
        let mut runtime = Runtime::load_with_extensions(
            package.clone(),
            "fn init(s){s.date=date_add_days(\"2026-10-04\",1);s} fn run(s,e){s.now=now_ms();s}",
            |engine| {
                engine.set_optimization_level(rhai::OptimizationLevel::Full);
            },
        )
        .unwrap();
        let clock = Clock {
            now_ms: 1791088440123,
            tz_offset_minutes: 540,
        };
        runtime
            .with_clock(Some(clock), |runtime| runtime.dispatch("run", json!({})))
            .unwrap();
        assert_eq!(runtime.state_json().unwrap()["now"], clock.now_ms);
        assert!(runtime
            .dispatch("run", json!({}))
            .unwrap_err()
            .contains("host did not supply"));
        let mut failed = Runtime::load_with_clock(
            package,
            "fn init(s){s} fn run(s,e){s.now=now_ms();throw \"failed\";s}",
            std::collections::HashMap::new(),
            Some(clock),
            |_| {},
        )
        .unwrap();
        assert!(failed
            .with_clock(Some(clock), |runtime| runtime.dispatch("run", json!({})))
            .is_err());
        assert!(failed
            .dispatch("run", json!({}))
            .unwrap_err()
            .contains("host did not supply"));
        let later = Clock {
            now_ms: clock.now_ms + 1,
            ..clock
        };
        runtime
            .with_clock(Some(later), |runtime| runtime.dispatch("run", json!({})))
            .unwrap();
        assert_eq!(runtime.state_json().unwrap()["now"], later.now_ms);
    }

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
