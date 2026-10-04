//! Pure Gregorian calculations; clocks are supplied by the host, never read here.
use super::ExtensionContext;
use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, NaiveTime, TimeDelta, TimeZone};
use rhai::{Engine, EvalAltResult, FuncRegistration, ImmutableString, INT};

type Result<T> = std::result::Result<T, Box<EvalAltResult>>;

pub fn leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        2 => {
            if leap_year(year) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

pub fn parse_month(value: &str) -> Option<(i32, u32)> {
    let b = value.as_bytes();
    if b.len() != 7
        || b[4] != b'-'
        || b.iter()
            .enumerate()
            .any(|(i, c)| i != 4 && !c.is_ascii_digit())
    {
        return None;
    }
    let year: i32 = value[..4].parse().ok()?;
    let month: u32 = value[5..].parse().ok()?;
    ((1..=9999).contains(&year) && (1..=12).contains(&month)).then_some((year, month))
}

pub fn parse_date(value: &str) -> Result<NaiveDate> {
    let b = value.as_bytes();
    if b.len() != 10 || b[7] != b'-' || !b[8..].iter().all(u8::is_ascii_digit) {
        return Err("date: expected YYYY-MM-DD".into());
    }
    let (year, month) = value
        .get(..7)
        .and_then(parse_month)
        .ok_or("date: invalid year or month")?;
    let day = value[8..].parse().map_err(|_| "date: invalid day")?;
    NaiveDate::from_ymd_opt(year, month, day).ok_or_else(|| "date: invalid day".into())
}

pub fn weekday(year: i32, month: u32, day: u32) -> Option<u32> {
    Some(
        NaiveDate::from_ymd_opt(year, month, day)?
            .weekday()
            .num_days_from_sunday(),
    )
}

fn checked_date(value: NaiveDate) -> Result<NaiveDate> {
    if !(1..=9999).contains(&value.year()) {
        return Err("date: outside 0001..9999".into());
    }
    Ok(value)
}
fn date_string(value: NaiveDate) -> Result<String> {
    Ok(checked_date(value)?.format("%Y-%m-%d").to_string())
}

pub fn offset(minutes: i32) -> Result<FixedOffset> {
    if !(-840..=840).contains(&minutes) {
        return Err("datetime: offset must be -840..840 minutes".into());
    }
    FixedOffset::east_opt(minutes * 60).ok_or_else(|| "datetime: invalid offset".into())
}
pub fn from_ms(ms: INT, minutes: i32) -> Result<DateTime<FixedOffset>> {
    let value = DateTime::from_timestamp_millis(ms)
        .ok_or("datetime: invalid epoch milliseconds")?
        .with_timezone(&offset(minutes)?);
    checked_date(value.date_naive())?;
    Ok(value)
}
fn datetime_string(value: DateTime<FixedOffset>) -> Result<String> {
    checked_date(value.date_naive())?;
    Ok(value.format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string())
}

fn parse_datetime(value: &str) -> Result<DateTime<FixedOffset>> {
    if !value.is_ascii() || ![20, 24, 25, 29].contains(&value.len()) {
        return Err("datetime: expected YYYY-MM-DDTHH:mm:ss[.SSS](Z|+/-HH:mm)".into());
    }
    let b = value.as_bytes();
    if b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return Err("datetime: invalid separators".into());
    }
    let number = |start: usize, end: usize| -> Result<u32> {
        if !b[start..end].iter().all(u8::is_ascii_digit) {
            return Err("datetime: invalid digits".into());
        }
        value[start..end]
            .parse()
            .map_err(|_| "datetime: invalid digits".into())
    };
    let date = parse_date(&value[..10])?;
    let (millis, start) = if b[19] == b'.' {
        if value.len() < 24 {
            return Err("datetime: missing millisecond digits or offset".into());
        }
        (number(20, 23)?, 23)
    } else {
        (0, 19)
    };
    let minutes = if &value[start..] == "Z" {
        0
    } else {
        if value.len() - start != 6 || !matches!(b[start], b'+' | b'-') || b[start + 3] != b':' {
            return Err("datetime: invalid offset".into());
        }
        let hours = number(start + 1, start + 3)?;
        let mins = number(start + 4, start + 6)?;
        if mins > 59 || hours > 14 || (hours == 14 && mins != 0) {
            return Err("datetime: invalid offset".into());
        }
        (hours * 60 + mins) as i32 * if b[start] == b'-' { -1 } else { 1 }
    };
    let time =
        NaiveTime::from_hms_milli_opt(number(11, 13)?, number(14, 16)?, number(17, 19)?, millis)
            .ok_or("datetime: invalid time (24:00 and leap seconds are unsupported)")?;
    offset(minutes)?
        .from_local_datetime(&date.and_time(time))
        .single()
        .ok_or_else(|| "datetime: outside supported range".into())
}

fn add_days(value: &str, n: INT) -> Result<String> {
    let date = parse_date(value)?;
    let day = INT::from(date.num_days_from_ce())
        .checked_add(n)
        .ok_or("date: day overflow")?;
    let day = i32::try_from(day).map_err(|_| "date: day overflow")?;
    date_string(NaiveDate::from_num_days_from_ce_opt(day).ok_or("date: day overflow")?)
}
fn add_months(value: &str, n: INT) -> Result<String> {
    let date = parse_date(value)?;
    let index = INT::from(date.year() - 1) * 12 + INT::from(date.month() - 1);
    let target = index
        .checked_add(n)
        .filter(|n| (0..9999 * 12).contains(n))
        .ok_or("date: month overflow")?;
    let year = (target / 12 + 1) as i32;
    let month = (target % 12 + 1) as u32;
    let day = date.day().min(days_in_month(year, month));
    date_string(NaiveDate::from_ymd_opt(year, month, day).ok_or("date: invalid result")?)
}
fn add_years(value: &str, n: INT) -> Result<String> {
    let date = parse_date(value)?;
    let year = INT::from(date.year())
        .checked_add(n)
        .filter(|n| (1..=9999).contains(n))
        .ok_or("date: year overflow")? as i32;
    let day = date.day().min(days_in_month(year, date.month()));
    date_string(NaiveDate::from_ymd_opt(year, date.month(), day).ok_or("date: invalid result")?)
}

fn format(value: &str, pattern: &str) -> Result<String> {
    if pattern.len() > 256 {
        return Err("date_format: pattern exceeds 256 bytes".into());
    }
    let datetime = if value.len() == 10 {
        None
    } else {
        Some(parse_datetime(value)?)
    };
    let date = match &datetime {
        Some(dt) => dt.date_naive(),
        None => parse_date(value)?,
    };
    let tokens = ["YYYY", "ddd", "MM", "DD", "HH", "mm", "ss", "M", "D"];
    let mut rest = pattern;
    let mut output = String::new();
    while !rest.is_empty() {
        if let Some(token) = tokens.iter().find(|token| rest.starts_with(**token)) {
            let text = match *token {
                "YYYY" => format!("{:04}", date.year()),
                "MM" => format!("{:02}", date.month()),
                "M" => date.month().to_string(),
                "DD" => format!("{:02}", date.day()),
                "D" => date.day().to_string(),
                "ddd" => ["月", "火", "水", "木", "金", "土", "日"]
                    [date.weekday().num_days_from_monday() as usize]
                    .to_string(),
                token => {
                    let dt = datetime
                        .as_ref()
                        .ok_or("date_format: time token requires DateTime")?;
                    dt.format(match token {
                        "HH" => "%H",
                        "mm" => "%M",
                        _ => "%S",
                    })
                    .to_string()
                }
            };
            output.push_str(&text);
            rest = &rest[token.len()..];
        } else {
            let c = rest.chars().next().ok_or("date_format: invalid pattern")?;
            output.push(c);
            rest = &rest[c.len_utf8()..];
        }
        if output.len() > 1024 {
            return Err("date_format: output exceeds 1024 bytes".into());
        }
    }
    Ok(output)
}

pub fn register(engine: &mut Engine, context: &ExtensionContext) {
    let ctx = context.clone();
    FuncRegistration::new("date_today")
        .with_purity(false)
        .register_into_engine(engine, move || -> Result<String> {
            let c = ctx.clock()?;
            date_string(from_ms(c.now_ms, c.tz_offset_minutes)?.date_naive())
        });
    let ctx = context.clone();
    FuncRegistration::new("datetime_now")
        .with_purity(false)
        .register_into_engine(engine, move || -> Result<String> {
            let c = ctx.clock()?;
            datetime_string(from_ms(c.now_ms, c.tz_offset_minutes)?)
        });
    let ctx = context.clone();
    FuncRegistration::new("now_ms")
        .with_purity(false)
        .register_into_engine(engine, move || -> Result<INT> { Ok(ctx.clock()?.now_ms) });
    let ctx = context.clone();
    FuncRegistration::new("tz_offset_minutes")
        .with_purity(false)
        .register_into_engine(engine, move || -> Result<INT> {
            Ok(ctx.clock()?.tz_offset_minutes.into())
        });
    engine.register_fn("date_is_valid", |s: ImmutableString| parse_date(&s).is_ok());
    engine.register_fn("date_year", |s: ImmutableString| -> Result<INT> {
        Ok(parse_date(&s)?.year().into())
    });
    engine.register_fn("date_month", |s: ImmutableString| -> Result<INT> {
        Ok(parse_date(&s)?.month().into())
    });
    engine.register_fn("date_day", |s: ImmutableString| -> Result<INT> {
        Ok(parse_date(&s)?.day().into())
    });
    engine.register_fn("date_weekday", |s: ImmutableString| -> Result<INT> {
        Ok(parse_date(&s)?.weekday().number_from_monday().into())
    });
    engine.register_fn("date_is_leap_year", |year: INT| -> Result<bool> {
        if !(1..=9999).contains(&year) {
            return Err("date: invalid year".into());
        }
        Ok(leap_year(year as i32))
    });
    engine.register_fn(
        "date_days_in_month",
        |year: INT, month: INT| -> Result<INT> {
            if !(1..=9999).contains(&year) || !(1..=12).contains(&month) {
                return Err("date: invalid year or month".into());
            }
            Ok(days_in_month(year as i32, month as u32).into())
        },
    );
    engine.register_fn("date_add_days", |s: ImmutableString, n: INT| {
        add_days(&s, n)
    });
    engine.register_fn("date_add_months", |s: ImmutableString, n: INT| {
        add_months(&s, n)
    });
    engine.register_fn("date_add_years", |s: ImmutableString, n: INT| {
        add_years(&s, n)
    });
    engine.register_fn(
        "date_diff_days",
        |a: ImmutableString, b: ImmutableString| -> Result<INT> {
            Ok(parse_date(&b)?
                .signed_duration_since(parse_date(&a)?)
                .num_days())
        },
    );
    engine.register_fn(
        "date_start_of_month",
        |s: ImmutableString| -> Result<String> {
            let d = parse_date(&s)?;
            date_string(d.with_day(1).ok_or("date: invalid month")?)
        },
    );
    engine.register_fn(
        "date_end_of_month",
        |s: ImmutableString| -> Result<String> {
            let d = parse_date(&s)?;
            date_string(
                d.with_day(days_in_month(d.year(), d.month()))
                    .ok_or("date: invalid month")?,
            )
        },
    );
    engine.register_fn(
        "datetime_add_minutes",
        |s: ImmutableString, n: INT| -> Result<String> {
            let dt = parse_datetime(&s)?;
            let duration = TimeDelta::try_minutes(n).ok_or("datetime: minute overflow")?;
            datetime_string(
                dt.checked_add_signed(duration)
                    .ok_or("datetime: minute overflow")?,
            )
        },
    );
    engine.register_fn("datetime_to_ms", |s: ImmutableString| -> Result<INT> {
        Ok(parse_datetime(&s)?.timestamp_millis())
    });
    let ctx = context.clone();
    FuncRegistration::new("datetime_from_ms")
        .with_purity(false)
        .register_into_engine(engine, move |ms: INT| -> Result<String> {
            datetime_string(from_ms(ms, ctx.clock()?.tz_offset_minutes)?)
        });
    engine.register_fn("date_format", |s: ImmutableString, p: ImmutableString| {
        format(&s, &p)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_gregorian_boundaries_and_month_clamping() {
        for year in [1900, 2100] {
            assert!(!leap_year(year));
        }
        for year in [2000, 2024] {
            assert!(leap_year(year));
        }
        for s in [
            "0000-01-01",
            "2026-02-29",
            "2026-1-01",
            "2026/01/01",
            "2026-13-01",
            "日付-01-01",
        ] {
            assert!(parse_date(s).is_err());
        }
        assert_eq!(add_days("2000-02-28", 1).unwrap(), "2000-02-29");
        assert_eq!(add_days("1970-01-01", -1).unwrap(), "1969-12-31");
        assert_eq!(add_months("2024-01-31", 1).unwrap(), "2024-02-29");
        assert_eq!(add_months("2026-03-31", -1).unwrap(), "2026-02-28");
        assert_eq!(add_years("2024-02-29", 1).unwrap(), "2025-02-28");
        assert!(add_days("0001-01-01", -1).is_err());
        assert!(add_days("9999-12-31", 1).is_err());
        assert!(add_months("2026-01-01", INT::MAX).is_err());
        assert!(add_years("2026-01-01", INT::MIN).is_err());
        for day in [1, 365, 719163, 3652059] {
            let date = NaiveDate::from_num_days_from_ce_opt(day).unwrap();
            assert_eq!(parse_date(&date_string(date).unwrap()).unwrap(), date);
        }
    }
    #[test]
    fn retains_milliseconds_offsets_and_negative_epochs() {
        for ms in [-62135596800000, -1, 0, 1791088440123, 253402300799999] {
            let text = datetime_string(from_ms(ms, 0).unwrap()).unwrap();
            assert_eq!(parse_datetime(&text).unwrap().timestamp_millis(), ms);
        }
        assert_eq!(
            datetime_string(from_ms(-1, 540).unwrap()).unwrap(),
            "1970-01-01T08:59:59.999+09:00"
        );
        assert_eq!(
            parse_datetime("2026-10-04T00:00:00Z")
                .unwrap()
                .timestamp_millis(),
            1791072000000
        );
        for text in [
            "2026-10-04T24:00:00Z",
            "2026-10-04T00:00:60Z",
            "2026-10-04T00:00:00.1Z",
            "2026-10-04T00:00:00+14:01",
            "2026-10-04T00:00:00+09:99",
            "2026-10-04T00:00:00",
            "2026-10-04T00:00:00.123+",
        ] {
            assert!(parse_datetime(text).is_err(), "{text}");
        }
        assert!(format("2026-10-04", "HH:mm").is_err());
        assert_eq!(
            format("2026-10-04", "YYYY年M月D日(ddd)").unwrap(),
            "2026年10月4日(日)"
        );
    }
}
