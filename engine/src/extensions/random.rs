//! Random values drawn from the bytes the host supplies for one execution; nothing here
//! generates randomness of its own, so the engine keeps needing no imports.
use super::ExtensionContext;
use rhai::{Engine, EvalAltResult, FuncRegistration, INT};
use std::fmt::Write;

type Result<T> = std::result::Result<T, Box<EvalAltResult>>;

/// RFC 9562 §5.4: version 4 in the high nibble of octet 6, variant 10 in the high bits of
/// octet 8, the remaining 122 bits random. Lowercase hex, like `crypto.randomUUID()`.
fn uuid_string(bytes: &mut [u8]) -> String {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let mut text = String::with_capacity(36);
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            text.push('-');
        }
        let _ = write!(text, "{byte:02x}");
    }
    text
}

/// Rejection sampling: a draw landing in the incomplete last block of `span` values is
/// discarded and the next eight bytes are taken, so every value of the range is equally
/// likely. Each rejection has probability below 1/2.
fn draw_int(context: &ExtensionContext, min: INT, max: INT) -> Result<INT> {
    if min > max {
        return Err("random_int: minはmax以下にしてください".into());
    }
    if min == max {
        return Ok(min);
    }
    let span = (max as i128 - min as i128 + 1) as u128;
    let whole = 1u128 << 64;
    loop {
        let mut taken = [0u8; 8];
        taken.copy_from_slice(&context.take_random(8)?);
        let draw = u64::from_le_bytes(taken);
        if span == whole {
            return Ok((min as i128 + draw as i128) as INT);
        }
        let threshold = whole - whole % span;
        if (draw as u128) < threshold {
            return Ok((min as i128 + (draw as u128 % span) as i128) as INT);
        }
    }
}

pub fn register(engine: &mut Engine, context: &ExtensionContext) {
    let ctx = context.clone();
    // Volatile, or Rhai's `Full` optimization would fold these calls into a constant.
    FuncRegistration::new("uuid_v4")
        .with_volatility(true)
        .register_into_engine(engine, move || -> Result<String> {
            Ok(uuid_string(&mut ctx.take_random(16)?))
        });
    let ctx = context.clone();
    FuncRegistration::new("random_int")
        .with_volatility(true)
        .register_into_engine(engine, move |min: INT, max: INT| -> Result<INT> {
            draw_int(&ctx, min, max)
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::{ContextGuard, HostContext, RANDOM_BYTES};

    fn entered(bytes: Vec<u8>) -> (ExtensionContext, ContextGuard) {
        let context = ExtensionContext::default();
        let guard = context
            .enter(HostContext {
                clock: None,
                random: Some(bytes),
            })
            .unwrap();
        (context, guard)
    }

    /// How many bytes of the pool are left, measured without spending any of them.
    fn remaining(context: &ExtensionContext) -> usize {
        let slot = context.random.borrow();
        let pool = slot.as_ref().unwrap();
        pool.bytes.len() - pool.cursor
    }

    #[test]
    fn uuid_sets_version_and_variant_bits_and_prints_lowercase() {
        assert_eq!(
            uuid_string(&mut [0x00; 16]),
            "00000000-0000-4000-8000-000000000000"
        );
        assert_eq!(
            uuid_string(&mut [0xff; 16]),
            "ffffffff-ffff-4fff-bfff-ffffffffffff"
        );
    }

    #[test]
    fn pool_supplies_64_uuids_and_then_refuses_to_repeat_itself() {
        let (context, _guard) = entered(vec![0x11; RANDOM_BYTES]);
        for _ in 0..64 {
            context.take_random(16).unwrap();
        }
        assert_eq!(remaining(&context), 0);
        let error = context.take_random(16).unwrap_err().to_string();
        assert!(error.contains("使い切りました"), "{error}");
    }

    #[test]
    fn drawing_without_a_pool_names_the_missing_supply() {
        let context = ExtensionContext::default();
        let error = context.take_random(16).unwrap_err().to_string();
        assert!(error.contains("供給していません"), "{error}");
    }

    #[test]
    fn host_context_requires_exactly_1024_bytes() {
        let context = ExtensionContext::default();
        for length in [RANDOM_BYTES - 1, RANDOM_BYTES + 1] {
            let error = context
                .enter(HostContext {
                    clock: None,
                    random: Some(vec![0; length]),
                })
                .map(|_| ())
                .unwrap_err();
            assert_eq!(error, "Request random must be exactly 1024 bytes");
        }
        assert!(context
            .enter(HostContext {
                clock: None,
                random: Some(vec![0; RANDOM_BYTES]),
            })
            .is_ok());
    }

    #[test]
    fn ranges_without_a_choice_or_in_the_wrong_order_spend_nothing() {
        let (context, _guard) = entered(vec![0x22; RANDOM_BYTES]);
        assert_eq!(draw_int(&context, 5, 5).unwrap(), 5);
        assert_eq!(remaining(&context), RANDOM_BYTES);
        let error = draw_int(&context, 2, 1).unwrap_err().to_string();
        assert!(error.contains("minはmax以下にしてください"), "{error}");
        assert_eq!(remaining(&context), RANDOM_BYTES);
    }

    #[test]
    fn the_whole_integer_range_is_a_single_draw() {
        let (context, _guard) = entered(vec![0xff; RANDOM_BYTES]);
        let value = draw_int(&context, INT::MIN, INT::MAX).unwrap();
        assert_eq!(value, INT::MAX);
        assert_eq!(remaining(&context), RANDOM_BYTES - 8);
    }

    #[test]
    fn a_draw_in_the_incomplete_block_is_rejected_and_the_next_one_taken() {
        // span 3 leaves one value over, so u64::MAX is the draw that has to be discarded.
        let mut bytes = vec![0x00; RANDOM_BYTES];
        bytes[..8].fill(0xff);
        let (context, _guard) = entered(bytes);
        assert_eq!(draw_int(&context, 0, 2).unwrap(), 0);
        assert_eq!(remaining(&context), RANDOM_BYTES - 16);
    }

    #[test]
    fn the_129th_integer_of_an_execution_is_certain_to_run_out() {
        let (context, _guard) = entered(vec![0x00; RANDOM_BYTES]);
        for _ in 0..128 {
            assert_eq!(draw_int(&context, 0, 1).unwrap(), 0);
        }
        let error = draw_int(&context, 0, 1).unwrap_err().to_string();
        assert!(error.contains("使い切りました"), "{error}");
    }
}
