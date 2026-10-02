use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Theme {
    pub version: u32,
    #[serde(default = "custom_name")]
    pub name: String,
    #[serde(default = "light_mode")]
    pub mode: String,
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
}

fn custom_name() -> String {
    "カスタム".into()
}
fn light_mode() -> String {
    "light".into()
}

impl Default for Theme {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../public/themes/light.json"))
            .expect("Built-in light theme must be valid")
    }
}

impl Theme {
    pub fn resolve(value: Value) -> Result<Self, String> {
        let candidate: Self = serde_json::from_value(value).map_err(|e| format!("Theme: {e}"))?;
        if candidate.version != 1 {
            return Err("Theme version must be 1".into());
        }
        if !["light", "dark"].contains(&candidate.mode.as_str()) {
            return Err("Theme mode must be light or dark".into());
        }
        if candidate.name.trim().is_empty() || candidate.name.chars().count() > 80 {
            return Err("Theme name must be between 1 and 80 characters".into());
        }
        let mut colors = if candidate.mode == "dark" {
            serde_json::from_str::<Self>(include_str!("../../public/themes/dark.json"))
                .expect("Built-in dark theme must be valid")
                .colors
        } else {
            Self::default().colors
        };
        for (key, color) in candidate.colors {
            if !colors.contains_key(&key) {
                return Err(format!("Unknown theme color: {key}"));
            }
            if !matches!(color.len(), 7 | 9)
                || !color.starts_with('#')
                || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err(format!("Theme color {key} must be #RRGGBB or #RRGGBBAA"));
            }
            colors.insert(key, color.to_ascii_lowercase());
        }
        Ok(Self {
            colors,
            ..candidate
        })
    }
}
