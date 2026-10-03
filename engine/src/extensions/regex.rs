use ::regex::{Regex, RegexBuilder};
use rhai::{Array, Dynamic, Engine, EvalAltResult, ImmutableString};
use std::{cell::RefCell, collections::VecDeque, rc::Rc};

const MAX_PATTERN: usize = 1024;
const MAX_TEXT: usize = 65_536;
const MAX_RESULTS: usize = 256;
const MAX_REPLACEMENT: usize = 4096;
const CACHE_SIZE: usize = 8;
type NativeResult<T> = Result<T, Box<EvalAltResult>>;

#[derive(Default)]
struct Cache(VecDeque<(ImmutableString, Regex)>);

impl Cache {
    fn get(&mut self, pattern: ImmutableString) -> NativeResult<Regex> {
        if pattern.len() > MAX_PATTERN {
            return Err("regex: pattern exceeds 1024 UTF-8 bytes".into());
        }
        if let Some(index) = self.0.iter().position(|(key, _)| key == &pattern) {
            let entry = self.0.remove(index).unwrap();
            let regex = entry.1.clone();
            self.0.push_back(entry);
            return Ok(regex);
        }
        let regex = RegexBuilder::new(&pattern)
            .size_limit(1_048_576)
            .dfa_size_limit(262_144)
            .nest_limit(64)
            .build()
            .map_err(|e| Box::<EvalAltResult>::from(format!("regex: {e}")))?;
        if self.0.len() == CACHE_SIZE {
            self.0.pop_front();
        }
        self.0.push_back((pattern, regex.clone()));
        Ok(regex)
    }
}

fn text_limit(text: &str) -> NativeResult<()> {
    if text.len() > MAX_TEXT {
        return Err("regex: text exceeds 65536 UTF-8 bytes".into());
    }
    Ok(())
}

fn append(output: &mut String, text: &str) -> NativeResult<()> {
    if output.len() + text.len() > MAX_TEXT {
        return Err("regex: output exceeds 65536 UTF-8 bytes".into());
    }
    output.push_str(text);
    Ok(())
}

pub fn register(engine: &mut Engine) {
    // Compiled patterns belong to this Rhai engine and are shared across its native functions.
    let cache = Rc::new(RefCell::new(Cache::default()));
    let compiled = cache.clone();
    engine.register_fn(
        "regex_is_match",
        move |pattern: ImmutableString, text: ImmutableString| -> NativeResult<bool> {
            text_limit(&text)?;
            Ok(compiled.borrow_mut().get(pattern)?.is_match(&text))
        },
    );
    let compiled = cache.clone();
    engine.register_fn(
        "regex_find_all",
        move |pattern: ImmutableString, text: ImmutableString| -> NativeResult<Array> {
            text_limit(&text)?;
            let regex = compiled.borrow_mut().get(pattern)?;
            let mut matches = Array::new();
            for found in regex.find_iter(&text) {
                if matches.len() == MAX_RESULTS {
                    return Err("regex: at most 256 matches".into());
                }
                matches.push(Dynamic::from(found.as_str().to_owned()));
            }
            Ok(matches)
        },
    );
    let compiled = cache.clone();
    engine.register_fn(
        "regex_captures",
        move |pattern: ImmutableString, text: ImmutableString| -> NativeResult<Array> {
            text_limit(&text)?;
            let regex = compiled.borrow_mut().get(pattern)?;
            if regex.captures_len() > MAX_RESULTS {
                return Err("regex: at most 256 capture groups including group 0".into());
            }
            let Some(captures) = regex.captures(&text) else {
                return Ok(Array::new());
            };
            if captures.iter().flatten().map(|m| m.len()).sum::<usize>() > MAX_TEXT {
                return Err("regex: output exceeds 65536 UTF-8 bytes".into());
            }
            Ok(captures
                .iter()
                .map(|m| m.map_or(Dynamic::UNIT, |m| Dynamic::from(m.as_str().to_owned())))
                .collect())
        },
    );
    engine.register_fn(
        "regex_replace_all",
        move |pattern: ImmutableString,
              text: ImmutableString,
              replacement: ImmutableString|
              -> NativeResult<ImmutableString> {
            text_limit(&text)?;
            if replacement.len() > MAX_REPLACEMENT {
                return Err("regex: replacement exceeds 4096 UTF-8 bytes".into());
            }
            let regex = cache.borrow_mut().get(pattern)?;
            let mut output = String::new();
            let mut end = 0;
            for (index, captures) in regex.captures_iter(&text).enumerate() {
                if index == MAX_RESULTS {
                    return Err("regex: at most 256 replacements".into());
                }
                let found = captures.get(0).unwrap();
                append(&mut output, &text[end..found.start()])?;
                expand(&captures, &replacement, &mut output)?;
                end = found.end();
            }
            append(&mut output, &text[end..])?;
            Ok(output.into())
        },
    );
}

// Match regex's $ref / ${ref} / $$ syntax, checking every append before allocation.
fn expand(
    captures: &::regex::Captures<'_>,
    mut replacement: &str,
    output: &mut String,
) -> NativeResult<()> {
    while let Some(index) = replacement.find('$') {
        append(output, &replacement[..index])?;
        let tail = &replacement[index + 1..];
        if let Some(tail) = tail.strip_prefix('$') {
            append(output, "$")?;
            replacement = tail;
            continue;
        }
        let reference = if tail.starts_with('{') {
            tail.find('}').map(|end| (&tail[1..end], end + 1))
        } else {
            let end = tail
                .bytes()
                .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
                .count();
            (end > 0).then_some((&tail[..end], end))
        };
        if let Some((name, consumed)) = reference {
            let found = name
                .parse::<usize>()
                .map_or_else(|_| captures.name(name), |index| captures.get(index));
            if let Some(found) = found {
                append(output, found.as_str())?;
            }
            replacement = &tail[consumed..];
        } else {
            append(output, "$")?;
            replacement = tail;
        }
    }
    append(output, replacement)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_expansion_matches_regex_semantics() {
        let regex = Regex::new(r"(?<word>日本語)(x)?").unwrap();
        let captures = regex.captures("日本語").unwrap();
        for replacement in [
            "$0",
            "$1$2",
            "${1}語",
            "$word",
            "$$",
            "$",
            "$未定義",
            "${word}",
            "${missing}",
            "${}",
            "${word",
            "$1a",
            "$01",
            "$9999999999999999999999999999",
            "前$$$word 後",
        ] {
            let mut expected = String::new();
            captures.expand(replacement, &mut expected);
            let mut actual = String::new();
            expand(&captures, replacement, &mut actual).unwrap();
            assert_eq!(actual, expected, "replacement: {replacement}");
        }
    }

    #[test]
    fn expansion_checks_size_before_appending_large_groups() {
        let regex = Regex::new("(?s)(.*)").unwrap();
        let text = "x".repeat(MAX_TEXT);
        let captures = regex.captures(&text).unwrap();
        let mut output = String::new();
        assert!(expand(&captures, "$1$1", &mut output).is_err());
        assert_eq!(output.len(), MAX_TEXT);
    }

    #[test]
    fn compiled_pattern_cache_is_bounded_and_reuses_recent_entries() {
        let mut cache = Cache::default();
        for i in 0..CACHE_SIZE {
            cache.get(format!("pattern{i}").into()).unwrap();
        }
        cache.get("pattern0".into()).unwrap();
        cache.get("next".into()).unwrap();
        assert_eq!(cache.0.len(), CACHE_SIZE);
        assert!(cache.0.iter().any(|(p, _)| p == "pattern0"));
        assert!(!cache.0.iter().any(|(p, _)| p == "pattern1"));
    }
}
