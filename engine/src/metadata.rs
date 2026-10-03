use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}
impl Metadata {
    pub fn is_empty(&self) -> bool {
        self.description.is_empty() && self.label.is_empty() && self.tags.is_empty()
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.description.len() > 2000
            || self.label.len() > 160
            || self.tags.len() > 8
            || self.tags.iter().any(|tag| tag.is_empty() || tag.len() > 80)
            || self.tags.iter().collect::<HashSet<_>>().len() != self.tags.len()
        {
            return Err(
                "webmcp: description/label/tags exceed limits or have duplicate tags".into(),
            );
        }
        Ok(())
    }
}
