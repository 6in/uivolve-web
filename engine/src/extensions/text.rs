//! Bounded Unicode normalization and extended grapheme operations.
use rhai::{Engine, EvalAltResult, ImmutableString, INT};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;
type Result<T> = std::result::Result<T, Box<EvalAltResult>>;
const MAX_BYTES: usize = 65_536;
fn input(s: &str) -> Result<()> {
    if s.len() > MAX_BYTES {
        return Err("text: input exceeds 65536 UTF-8 bytes".into());
    }
    Ok(())
}
fn length(n: INT) -> Result<usize> {
    if !(0..=MAX_BYTES as INT).contains(&n) {
        return Err("text: length must be 0..65536".into());
    }
    Ok(n as usize)
}
fn normalize(s: &str, form: &str) -> Result<String> {
    input(s)?;
    let mut out = String::new();
    let chars: Box<dyn Iterator<Item = char> + '_> = match form {
        "NFC" => Box::new(s.nfc()),
        "NFD" => Box::new(s.nfd()),
        "NFKC" => Box::new(s.nfkc()),
        "NFKD" => Box::new(s.nfkd()),
        _ => return Err("text_normalize: expected NFC, NFD, NFKC or NFKD".into()),
    };
    for c in chars {
        if out.len() + c.len_utf8() > MAX_BYTES {
            return Err("text: output exceeds 65536 UTF-8 bytes".into());
        }
        out.push(c);
    }
    Ok(out)
}
fn pad(s: &str, n: INT, padding: &str, start: bool) -> Result<String> {
    input(s)?;
    input(padding)?;
    let n = length(n)?;
    if padding.graphemes(true).count() != 1 {
        return Err("text_pad: padding must be one nonempty grapheme".into());
    }
    let count = s.graphemes(true).count();
    let extra = n.saturating_sub(count);
    let bytes = padding
        .len()
        .checked_mul(extra)
        .and_then(|v| v.checked_add(s.len()))
        .ok_or("text_pad: size overflow")?;
    if bytes > MAX_BYTES {
        return Err("text: output exceeds 65536 UTF-8 bytes".into());
    }
    let repeated = padding.repeat(extra);
    let out = if start {
        repeated + s
    } else {
        s.to_owned() + repeated.as_str()
    };
    // Joining graphemes can merge them (combining marks, regional indicators, ZWJ).
    // Reject such padding rather than promise a length that was not produced.
    if extra > 0 && out.graphemes(true).count() != n {
        return Err("text_pad: padding merges graphemes at the join".into());
    }
    Ok(out)
}
fn truncate(s: &str, n: INT, suffix: &str) -> Result<String> {
    input(s)?;
    input(suffix)?;
    let n = length(n)?;
    if s.graphemes(true).count() <= n {
        return Ok(s.to_owned());
    }
    let tail = suffix.graphemes(true).count();
    if tail > n {
        return Err("text_truncate: suffix is longer than requested length".into());
    }
    let keep = n - tail;
    let end = s
        .grapheme_indices(true)
        .nth(keep)
        .map_or(s.len(), |(i, _)| i);
    let prefix = &s[..end];
    if prefix.len() + suffix.len() > MAX_BYTES {
        return Err("text: output exceeds 65536 UTF-8 bytes".into());
    }
    Ok(prefix.to_owned() + suffix)
}
pub fn register(engine: &mut Engine) {
    engine.register_fn("text_normalize", |s: ImmutableString| normalize(&s, "NFKC"));
    engine.register_fn(
        "text_normalize",
        |s: ImmutableString, form: ImmutableString| normalize(&s, &form),
    );
    engine.register_fn("text_trim", |s: ImmutableString| -> Result<String> {
        input(&s)?;
        Ok(s.trim().to_owned())
    });
    engine.register_fn("text_len", |s: ImmutableString| -> Result<INT> {
        input(&s)?;
        Ok(s.graphemes(true).count() as INT)
    });
    engine.register_fn(
        "text_pad_start",
        |s: ImmutableString, n: INT, p: ImmutableString| pad(&s, n, &p, true),
    );
    engine.register_fn(
        "text_pad_end",
        |s: ImmutableString, n: INT, p: ImmutableString| pad(&s, n, &p, false),
    );
    engine.register_fn(
        "text_truncate",
        |s: ImmutableString, n: INT, suffix: ImmutableString| truncate(&s, n, &suffix),
    );
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_graphemes_and_bounds_normalization_expansion() {
        assert_eq!(normalize("ＡＢＣ ﾊﾟ", "NFKC").unwrap(), "ABC パ");
        assert_eq!(truncate("👨‍👩‍👧‍👦e\u{301}🇯🇵", 2, "…").unwrap(), "👨‍👩‍👧‍👦…");
        assert_eq!(pad("e\u{301}", 3, "0", true).unwrap(), "00e\u{301}");
        assert!(pad("a", 2, "\u{301}", false).is_err());
        assert!(normalize(&"㍿".repeat(6000), "NFKC").is_err());
        assert!(pad("a", 65536, "👨‍👩‍👧‍👦", true).is_err());
    }
}
