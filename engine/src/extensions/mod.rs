//! Shared native functions available to every downloaded Rhai page.
use rhai::{Array, Engine, EvalAltResult, INT};
use serde::{Deserialize, Serialize};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
pub mod date;
mod decimal;
mod random;
mod regex;
mod text;

/// Bytes the host has to supply for one execution that wants random values.
pub const RANDOM_BYTES: usize = 1024;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Clock {
    pub now_ms: INT,
    pub tz_offset_minutes: i32,
}

/// What the host adds to a single execution. Both parts are optional: a screen that reads
/// neither clock nor random values runs without them.
#[derive(Clone, Default)]
pub struct HostContext {
    pub clock: Option<Clock>,
    pub random: Option<Vec<u8>>,
}

/// The randomness of one execution. Drawing never wraps around: once the bytes are spent the
/// functions fail rather than repeat themselves.
struct RandomPool {
    bytes: Vec<u8>,
    cursor: usize,
}

#[derive(Clone, Default)]
pub struct ExtensionContext {
    clock: Rc<Cell<Option<Clock>>>,
    random: Rc<RefCell<Option<RandomPool>>>,
}

pub struct ContextGuard {
    context: ExtensionContext,
    clock: Option<Clock>,
    random: Option<RandomPool>,
}
impl Drop for ContextGuard {
    fn drop(&mut self) {
        self.context.clock.set(self.clock);
        self.context.random.replace(self.random.take());
    }
}
impl ExtensionContext {
    pub fn enter(&self, host: HostContext) -> Result<ContextGuard, String> {
        if let Some(clock) = host.clock {
            date::from_ms(clock.now_ms, clock.tz_offset_minutes).map_err(|e| e.to_string())?;
        }
        if host
            .random
            .as_ref()
            .is_some_and(|b| b.len() != RANDOM_BYTES)
        {
            return Err(format!(
                "Request random must be exactly {RANDOM_BYTES} bytes"
            ));
        }
        let clock = self.clock.replace(host.clock);
        let random = self
            .random
            .replace(host.random.map(|bytes| RandomPool { bytes, cursor: 0 }));
        Ok(ContextGuard {
            context: self.clone(),
            clock,
            random,
        })
    }
    fn clock(&self) -> Result<Clock, Box<EvalAltResult>> {
        self.clock
            .get()
            .ok_or_else(|| "clock: host did not supply a clock for this execution".into())
    }
    /// Hand out `n` bytes of this execution's randomness, or fail without spending any.
    fn take_random(&self, n: usize) -> Result<Vec<u8>, Box<EvalAltResult>> {
        let mut slot = self.random.borrow_mut();
        let pool = slot
            .as_mut()
            .ok_or("random: ホストがこの実行に乱数を供給していません")?;
        if pool.bytes.len() - pool.cursor < n {
            return Err("random: この実行の乱数1,024バイトを使い切りました".into());
        }
        let bytes = pool.bytes[pool.cursor..pool.cursor + n].to_vec();
        pool.cursor += n;
        Ok(bytes)
    }
}

pub fn register(engine: &mut Engine) {
    register_with_context(engine, &ExtensionContext::default());
}

pub fn register_with_context(engine: &mut Engine, context: &ExtensionContext) {
    regex::register(engine);
    engine.register_fn("sum_ints", sum_ints);
    date::register(engine, context);
    random::register(engine, context);
    decimal::register(engine);
    text::register(engine);
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
    fn random_is_scoped_to_one_execution_and_survives_a_failed_one() {
        let package: Package = serde_json::from_value(json!({
            "version":1,"id":"random","title":"Random","script":"random.rhai","state":{},
            "ui":{"xtype":"panel","items":[
                {"xtype":"button","itemId":"run","handler":"run"},
                {"xtype":"button","itemId":"over","handler":"over"}
            ]}
        }))
        .unwrap();
        let mut runtime = Runtime::load(
            package,
            "fn init(s){s} \
             fn run(s,e){let a=[]; for i in 0..64 {a.push(uuid_v4());} s.keys=a; s} \
             fn over(s,e){let a=[]; for i in 0..65 {a.push(uuid_v4());} s.keys=a; s}",
        )
        .unwrap();
        let host = |byte: u8| HostContext {
            clock: None,
            random: Some(vec![byte; RANDOM_BYTES]),
        };
        assert!(runtime
            .dispatch("run", json!({}))
            .unwrap_err()
            .contains("供給していません"));
        // The 65th UUID of an execution has no bytes left, and the failure leaves no state.
        let error = runtime
            .with_host_context(host(0x5a), |runtime| runtime.dispatch("over", json!({})))
            .unwrap_err();
        assert!(error.contains("使い切りました"), "{error}");
        assert_eq!(runtime.state_json().unwrap()["keys"], json!(null));
        // A new execution starts from a full pool even after that failure.
        runtime
            .with_host_context(host(0x5a), |runtime| runtime.dispatch("run", json!({})))
            .unwrap();
        let keys = runtime.state_json().unwrap()["keys"].clone();
        assert_eq!(keys.as_array().unwrap().len(), 64);
        assert_eq!(keys[0], "5a5a5a5a-5a5a-4a5a-9a5a-5a5a5a5a5a5a");
        // Nothing of the pool is held past the execution that was given it.
        assert!(runtime
            .dispatch("run", json!({}))
            .unwrap_err()
            .contains("供給していません"));
        assert_eq!(
            runtime
                .with_host_context(
                    HostContext {
                        clock: None,
                        random: Some(vec![0; RANDOM_BYTES - 1]),
                    },
                    |runtime| runtime.dispatch("run", json!({}))
                )
                .unwrap_err(),
            "Request random must be exactly 1024 bytes"
        );
    }

    #[test]
    fn full_optimization_keeps_clock_and_random_calls_out_of_constants() {
        let package: Package = serde_json::from_value(json!({
            "version":1,"id":"volatile","title":"Volatile","script":"volatile.rhai","state":{},
            "ui":{"xtype":"button","itemId":"run","handler":"run"}
        }))
        .unwrap();
        let clock = Clock {
            now_ms: 1791088440123,
            tz_offset_minutes: 540,
        };
        // Both are supplied while the script compiles: without volatility the optimizer would
        // fold these calls into one constant each.
        let mut runtime = Runtime::load_with_host_context(
            package,
            "fn init(s){s.a=uuid_v4();s.b=uuid_v4();s.t=now_ms();s} \
             fn run(s,e){s.c=uuid_v4();s.t=now_ms();s}",
            std::collections::HashMap::new(),
            HostContext {
                clock: Some(clock),
                random: Some((0..RANDOM_BYTES).map(|i| i as u8).collect()),
            },
            std::collections::HashMap::new(),
            |engine| {
                engine.set_optimization_level(rhai::OptimizationLevel::Full);
            },
        )
        .unwrap();
        let state = runtime.state_json().unwrap();
        let (a, b) = (state["a"].clone(), state["b"].clone());
        assert_ne!(a, b);
        assert_eq!(state["t"], clock.now_ms);
        let later = Clock {
            now_ms: clock.now_ms + 1,
            ..clock
        };
        runtime
            .with_host_context(
                HostContext {
                    clock: Some(later),
                    random: Some(vec![0xc3; RANDOM_BYTES]),
                },
                |runtime| runtime.dispatch("run", json!({})),
            )
            .unwrap();
        let state = runtime.state_json().unwrap();
        assert_ne!(state["c"], a);
        assert_ne!(state["c"], b);
        assert_eq!(state["t"], later.now_ms);
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
