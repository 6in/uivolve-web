//! Decimal strings with exact intermediates and one explicit rounding step.
use num_bigint::BigInt;
use num_traits::{Signed, ToPrimitive, Zero};
use rhai::{Array, Engine, EvalAltResult, ImmutableString, INT};
use rust_decimal::Decimal;

type Result<T> = std::result::Result<T, Box<EvalAltResult>>;
const MAX_BYTES: usize = 64;

fn parse(s: &str) -> Result<Decimal> {
    if s.is_empty() || s.len() > MAX_BYTES {
        return Err("decimal: expected 1..64 bytes".into());
    }
    let unsigned = s.strip_prefix('-').unwrap_or(s);
    let mut parts = unsigned.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next();
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || parts.next().is_some()
        || fraction
            .is_some_and(|f| f.is_empty() || f.len() > 28 || !f.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("decimal: expected -?digits[.digits], scale 0..28".into());
    }
    // from_str_exact rejects underflow rather than silently rounding input.
    Decimal::from_str_exact(s).map_err(|_| "decimal: outside 96-bit coefficient range".into())
}
fn scale(n: INT) -> Result<u32> {
    if !(0..=28).contains(&n) {
        return Err("decimal: scale must be 0..28".into());
    }
    Ok(n as u32)
}
fn power(n: u32) -> BigInt {
    BigInt::from(10).pow(n)
}
fn coefficient(d: Decimal, scale: u32) -> BigInt {
    BigInt::from(d.mantissa()) * power(scale - d.scale())
}
fn decimal(mut coefficient: BigInt, mut scale: u32) -> Result<Decimal> {
    if coefficient.is_zero() {
        return Ok(Decimal::ZERO);
    }
    while scale > 0 && (&coefficient % 10_u32).is_zero() {
        coefficient /= 10_u32;
        scale -= 1;
    }
    if scale > 28 {
        return Err("decimal: exact result needs more than 28 decimal places".into());
    }
    let value = coefficient
        .to_i128()
        .ok_or("decimal: coefficient overflow")?;
    Decimal::try_from_i128_with_scale(value, scale)
        .map_err(|_| "decimal: coefficient overflow".into())
}
fn canonical(d: Decimal) -> String {
    if d.is_zero() {
        "0".into()
    } else {
        d.normalize().to_string()
    }
}
fn mode(s: &str) -> Result<()> {
    if !["down", "up", "half_up", "half_even"].contains(&s) {
        return Err("decimal: unknown rounding mode".into());
    }
    Ok(())
}
fn quotient(mut numerator: BigInt, mut denominator: BigInt, rounding: &str) -> Result<BigInt> {
    mode(rounding)?;
    if denominator.is_zero() {
        return Err("decimal: division by zero".into());
    }
    if denominator.is_negative() {
        numerator = -numerator;
        denominator = -denominator;
    }
    let mut q = &numerator / &denominator;
    let remainder = (&numerator % &denominator).abs();
    let increment = match rounding {
        "up" => !remainder.is_zero(),
        "half_up" => &remainder * 2_u32 >= denominator,
        "half_even" => {
            let doubled = &remainder * 2_u32;
            doubled > denominator || (doubled == denominator && !(&q % 2_u32).is_zero())
        }
        _ => false,
    };
    if increment {
        q += if numerator.is_negative() { -1 } else { 1 };
    }
    Ok(q)
}
fn round(d: Decimal, target: u32, rounding: &str) -> Result<Decimal> {
    mode(rounding)?;
    if target >= d.scale() {
        return Ok(d);
    }
    decimal(
        quotient(
            BigInt::from(d.mantissa()),
            power(d.scale() - target),
            rounding,
        )?,
        target,
    )
}
fn add(a: Decimal, b: Decimal, subtract: bool) -> Result<Decimal> {
    let s = a.scale().max(b.scale());
    let b = coefficient(b, s);
    decimal(coefficient(a, s) + if subtract { -b } else { b }, s)
}
fn multiply(a: Decimal, b: Decimal) -> Result<Decimal> {
    decimal(
        BigInt::from(a.mantissa()) * BigInt::from(b.mantissa()),
        a.scale() + b.scale(),
    )
}
fn divide(a: Decimal, b: Decimal, target: u32, rounding: &str) -> Result<Decimal> {
    let numerator = BigInt::from(a.mantissa()) * power(b.scale() + target);
    let denominator = BigInt::from(b.mantissa()) * power(a.scale());
    decimal(quotient(numerator, denominator, rounding)?, target)
}
fn sum(values: Array) -> Result<String> {
    if values.len() > 10_000 {
        return Err("dec_sum: at most 10000 values".into());
    }
    let mut bytes = 0_usize;
    let mut total = BigInt::zero();
    // Accumulate all coefficients at scale 28; only the final result needs to fit.
    for value in values {
        let value = value
            .try_cast::<ImmutableString>()
            .ok_or("dec_sum: every value must be a decimal string")?;
        bytes += value.len();
        if bytes > 65_536 {
            return Err("dec_sum: inputs exceed 65536 bytes".into());
        }
        total += coefficient(parse(&value)?, 28);
    }
    Ok(canonical(decimal(total, 28)?))
}
fn format(s: &str, pattern: &str) -> Result<String> {
    let (target, grouped, percent, currency) = match pattern {
        "#,##0" => (0, true, false, false),
        "#,##0.00" => (2, true, false, false),
        "0.0%" => (1, false, true, false),
        "¥#,##0" => (0, true, false, true),
        _ => return Err("num_format: unsupported pattern".into()),
    };
    let d = parse(s)?;
    // Percentage scaling is performed before rounding, without a Decimal overflow.
    let n = BigInt::from(d.mantissa())
        * if percent {
            BigInt::from(100)
        } else {
            BigInt::from(1)
        };
    let scaled = if d.scale() > target {
        quotient(n, power(d.scale() - target), "half_up")?
    } else {
        n * power(target - d.scale())
    };
    let negative = scaled.is_negative();
    let mut digits = scaled.abs().to_string();
    while digits.len() <= target as usize {
        digits.insert(0, '0');
    }
    let whole_end = digits.len() - target as usize;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if currency {
        out.push('¥');
    }
    for (i, c) in digits[..whole_end].chars().enumerate() {
        if grouped && i > 0 && (whole_end - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if target > 0 {
        out.push('.');
        out.push_str(&digits[whole_end..]);
    }
    if percent {
        out.push('%');
    }
    if out.len() > 128 {
        return Err("num_format: output exceeds 128 bytes".into());
    }
    Ok(out)
}
pub fn register(engine: &mut Engine) {
    engine.register_fn("dec_is_valid", |s: ImmutableString| parse(&s).is_ok());
    engine.register_fn(
        "dec_add",
        |a: ImmutableString, b: ImmutableString| -> Result<String> {
            Ok(canonical(add(parse(&a)?, parse(&b)?, false)?))
        },
    );
    engine.register_fn(
        "dec_sub",
        |a: ImmutableString, b: ImmutableString| -> Result<String> {
            Ok(canonical(add(parse(&a)?, parse(&b)?, true)?))
        },
    );
    engine.register_fn(
        "dec_mul",
        |a: ImmutableString, b: ImmutableString| -> Result<String> {
            Ok(canonical(multiply(parse(&a)?, parse(&b)?)?))
        },
    );
    engine.register_fn(
        "dec_div",
        |a: ImmutableString, b: ImmutableString, n: INT, m: ImmutableString| -> Result<String> {
            Ok(canonical(divide(parse(&a)?, parse(&b)?, scale(n)?, &m)?))
        },
    );
    engine.register_fn(
        "dec_round",
        |a: ImmutableString, n: INT, m: ImmutableString| -> Result<String> {
            Ok(canonical(round(parse(&a)?, scale(n)?, &m)?))
        },
    );
    engine.register_fn(
        "dec_cmp",
        |a: ImmutableString, b: ImmutableString| -> Result<INT> {
            Ok(match parse(&a)?.cmp(&parse(&b)?) {
                std::cmp::Ordering::Less => -1,
                std::cmp::Ordering::Equal => 0,
                std::cmp::Ordering::Greater => 1,
            })
        },
    );
    engine.register_fn("dec_sum", sum);
    engine.register_fn("num_format", |s: ImmutableString, p: ImmutableString| {
        format(&s, &p)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_arithmetic_and_single_rounding() {
        assert_eq!(
            canonical(add(parse("0.1").unwrap(), parse("0.2").unwrap(), false).unwrap()),
            "0.3"
        );
        // The true quotient is just below 0.5. A rounded intermediate would produce 1.
        assert_eq!(
            canonical(
                divide(
                    parse("1").unwrap(),
                    parse("2.0000000000000000000000000001").unwrap(),
                    0,
                    "half_up"
                )
                .unwrap()
            ),
            "0"
        );
        assert!(multiply(
            parse("0.0000000000000000000000000001").unwrap(),
            parse("0.1").unwrap()
        )
        .is_err());
        assert!(add(Decimal::MAX, parse("0.1").unwrap(), false).is_err());
        assert_eq!(
            canonical(divide(Decimal::MAX, Decimal::MAX, 28, "half_even").unwrap()),
            "1"
        );
    }
    #[test]
    fn negative_rounding_and_formatting() {
        for (mode, expected) in [
            ("down", "-2"),
            ("up", "-3"),
            ("half_up", "-3"),
            ("half_even", "-2"),
        ] {
            assert_eq!(
                canonical(round(parse("-2.5").unwrap(), 0, mode).unwrap()),
                expected
            );
        }
        assert_eq!(format("-1234.5", "¥#,##0").unwrap(), "-¥1,235");
        assert_eq!(format("-0.004", "#,##0.00").unwrap(), "0.00");
        assert_eq!(format("0.125", "0.0%").unwrap(), "12.5%");
    }
}
