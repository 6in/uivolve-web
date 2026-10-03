use crate::{fields, Node};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Types {
    One(String),
    Many(Vec<String>),
}
impl Types {
    fn names(&self) -> Vec<&str> {
        match self {
            Self::One(name) => vec![name],
            Self::Many(names) => names.iter().map(String::as_str).collect(),
        }
    }
    fn has(&self, name: &str) -> bool {
        self.names().contains(&name)
    }
}
fn yes() -> bool {
    true
}
fn is_true(value: &bool) -> bool {
    *value
}
fn equal_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) if a.is_f64() || b.is_f64() => {
            a.as_f64() == b.as_f64()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal_json(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|other| equal_json(value, other)))
        }
        _ => a == b,
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Schema {
    #[serde(rename = "type")]
    pub types: Types,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, Schema>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required: Vec<String>,
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub additional_properties: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<Box<Schema>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_length: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_items: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_items: Option<usize>,
    #[serde(default, rename = "enum", skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<Value>>,
}

impl Schema {
    pub fn definition(&self) -> Result<(), String> {
        if self.types.names() != vec!["object"] {
            return Err("stateSchema root type must be object".into());
        }
        self.check_definition(0, &mut 0)
    }
    fn check_definition(&self, depth: usize, count: &mut usize) -> Result<(), String> {
        *count += 1;
        let names = self.types.names();
        if depth > 12 || *count > 200 {
            return Err("stateSchema exceeds 200 nodes or 12 nesting levels".into());
        }
        if names.is_empty()
            || names.len() > 7
            || names.iter().collect::<HashSet<_>>().len() != names.len()
            || names.iter().any(|name| {
                ![
                    "object", "array", "string", "number", "integer", "boolean", "null",
                ]
                .contains(name)
            })
        {
            return Err("stateSchema: invalid or duplicate type".into());
        }
        if (!self.properties.is_empty() || !self.required.is_empty() || !self.additional_properties)
            && !self.types.has("object")
        {
            return Err("stateSchema: object constraints need object type".into());
        }
        if (self.items.is_some() || self.min_items.is_some() || self.max_items.is_some())
            && !self.types.has("array")
        {
            return Err("stateSchema: array constraints need array type".into());
        }
        if (self.min_length.is_some() || self.max_length.is_some()) && !self.types.has("string") {
            return Err("stateSchema: string constraints need string type".into());
        }
        if (self.minimum.is_some() || self.maximum.is_some())
            && !self.types.has("number")
            && !self.types.has("integer")
        {
            return Err("stateSchema: numeric constraints need numeric type".into());
        }
        if self.required.len() > 200
            || self.required.iter().collect::<HashSet<_>>().len() != self.required.len()
            || self
                .required
                .iter()
                .any(|name| !self.properties.contains_key(name))
        {
            return Err("stateSchema: required must name distinct declared properties".into());
        }
        if self.minimum.zip(self.maximum).is_some_and(|(a, b)| a > b)
            || self
                .min_length
                .zip(self.max_length)
                .is_some_and(|(a, b)| a > b)
            || self
                .min_items
                .zip(self.max_items)
                .is_some_and(|(a, b)| a > b)
        {
            return Err("stateSchema: minimum exceeds maximum".into());
        }
        if self
            .choices
            .as_ref()
            .is_some_and(|values| values.is_empty() || values.len() > 100)
        {
            return Err("stateSchema: enum needs 1–100 values".into());
        }
        for (name, schema) in &self.properties {
            if name.is_empty() || name.len() > 128 {
                return Err("stateSchema: invalid property name".into());
            }
            schema.check_definition(depth + 1, count)?;
        }
        if let Some(items) = &self.items {
            items.check_definition(depth + 1, count)?;
        }
        Ok(())
    }

    pub fn validate(&self, value: &Value) -> Result<(), String> {
        self.check_value(value, "state")
    }
    fn check_value(&self, value: &Value, path: &str) -> Result<(), String> {
        let actual = match value {
            Value::Null => "null",
            Value::Bool(_) => "boolean",
            Value::String(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
            Value::Number(n) => {
                if n.as_f64().is_some_and(|n| n.fract() == 0.0) {
                    "integer"
                } else {
                    "number"
                }
            }
        };
        if !self.types.has(actual) && !(actual == "integer" && self.types.has("number")) {
            return Err(format!(
                "stateSchema {path}: expected {}, got {actual}",
                self.types.names().join(" | ")
            ));
        }
        let error = |constraint: &str| Err(format!("stateSchema {path}: violates {constraint}"));
        if self
            .choices
            .as_ref()
            .is_some_and(|values| !values.iter().any(|choice| equal_json(choice, value)))
        {
            return error("enum");
        }
        if let Some(n) = value.as_f64() {
            if self.minimum.is_some_and(|min| n < min) || self.maximum.is_some_and(|max| n > max) {
                return error("minimum/maximum");
            }
        }
        if let Some(text) = value.as_str() {
            let len = text.chars().count();
            if self.min_length.is_some_and(|min| len < min)
                || self.max_length.is_some_and(|max| len > max)
            {
                return error("minLength/maxLength");
            }
        }
        if let Some(values) = value.as_array() {
            if self.min_items.is_some_and(|min| values.len() < min)
                || self.max_items.is_some_and(|max| values.len() > max)
            {
                return error("minItems/maxItems");
            }
            if let Some(items) = &self.items {
                for (i, value) in values.iter().enumerate() {
                    items.check_value(value, &format!("{path}[{i}]"))?;
                }
            }
        }
        if let Some(values) = value.as_object() {
            for name in &self.required {
                if !values.contains_key(name) {
                    return Err(format!(
                        "stateSchema {path}.{name}: required property is missing"
                    ));
                }
            }
            for (name, value) in values {
                if let Some(schema) = self.properties.get(name) {
                    schema.check_value(value, &format!("{path}.{name}"))?;
                } else if !self.additional_properties {
                    return Err(format!(
                        "stateSchema {path}.{name}: additional property is not allowed"
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn bindings(&self, ui: &Node) -> Result<(), String> {
        if fields::input(ui) {
            if let Some(schema) = self.properties.get(&ui.bind) {
                let expected = match ui.xtype.as_str() {
                    "checkbox" => "boolean",
                    "numberfield" | "slider" => "number",
                    "listbox" if ui.multi_select == Some(true) => "array",
                    _ => "string",
                };
                if !schema.types.has(expected)
                    && !(expected == "number" && schema.types.has("integer"))
                {
                    return Err(format!(
                        "stateSchema bind {} / {}: {} needs {expected}",
                        ui.bind, ui.item_id, ui.xtype
                    ));
                }
                if expected == "array"
                    && schema
                        .items
                        .as_ref()
                        .is_some_and(|items| !items.types.has("string"))
                {
                    return Err(format!(
                        "stateSchema bind {} / {}: multi-select items need string",
                        ui.bind, ui.item_id
                    ));
                }
            }
        }
        for child in &ui.items {
            self.bindings(child)?;
        }
        Ok(())
    }
}
