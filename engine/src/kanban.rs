use super::{flag, widget, Node, Widget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Lane {
    pub id: String,
    pub title: String,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

pub fn validate(node: &Node) -> Result<(), String> {
    if node.xtype != "kanban" {
        if !node.lanes.is_empty() {
            return Err("lanes is supported only on kanban".into());
        }
        return Ok(());
    }
    if node.item_id.is_empty() || node.bind.is_empty() || node.bind.contains('.') {
        return Err("kanban requires itemId and a top-level bind".into());
    }
    let mut ids = HashSet::new();
    if !(1..=6).contains(&node.lanes.len())
        || node.lanes.iter().any(|lane| {
            !identifier(&lane.id)
                || !ids.insert(&lane.id)
                || lane.title.is_empty()
                || lane.title.len() > 160
        })
        || !node.items.is_empty()
    {
        return Err("kanban requires 1..6 unique lanes with id/title and no items".into());
    }
    Ok(())
}

pub fn initialize(node: &Node, state: &mut Value) {
    if node.xtype == "kanban" {
        state
            .as_object_mut()
            .unwrap()
            .entry(node.bind.clone())
            .or_insert(json!([]));
    }
    for child in &node.items {
        initialize(child, state);
    }
}

fn cards<'a>(node: &Node, state: &'a Value) -> &'a [Value] {
    // State validation runs before layout and after every handler.
    state
        .get(&node.bind)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub fn validate_state(node: &Node, state: &Value) -> Result<(), String> {
    if node.xtype == "kanban" {
        let rows = state
            .get(&node.bind)
            .and_then(Value::as_array)
            .ok_or("kanban bind must be an array")?;
        if rows.len() > 100 {
            return Err("kanban supports at most 100 cards".into());
        }
        let mut ids = HashSet::new();
        for card in rows {
            let id = card.get("id").and_then(Value::as_str).unwrap_or("");
            let title = card.get("title").and_then(Value::as_str).unwrap_or("");
            let lane = card.get("lane").and_then(Value::as_str).unwrap_or("");
            if !identifier(id)
                || !ids.insert(id)
                || title.is_empty()
                || title.len() > 160
                || !node.lanes.iter().any(|l| l.id == lane)
                || card
                    .get("description")
                    .is_some_and(|v| !v.is_string() || v.as_str().unwrap().len() > 320)
                || card.get("disabled").is_some_and(|v| !v.is_boolean())
            {
                return Err("kanban card needs a unique id, title, known lane and valid description/disabled".into());
            }
        }
    }
    for child in &node.items {
        validate_state(child, state)?;
    }
    Ok(())
}

pub fn event(node: &Node, state: &mut Value, payload: &mut Value) -> Result<(), String> {
    if node.read_only {
        return Err("kanban is read-only".into());
    }
    if payload.get("action").and_then(Value::as_str) != Some("move") {
        return Err("kanban event requires action: move".into());
    }
    let id = payload
        .get("id")
        .and_then(Value::as_str)
        .ok_or("kanban move needs a card id")?
        .to_owned();
    let lane = payload
        .get("value")
        .and_then(Value::as_str)
        .ok_or("kanban move needs a destination lane")?
        .to_owned();
    if !node.lanes.iter().any(|l| l.id == lane) {
        return Err("Unknown kanban lane".into());
    }
    let before = match payload.get("beforeId") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.clone()),
        _ => return Err("kanban beforeId must be a string or null".into()),
    };
    let rows = state
        .get_mut(&node.bind)
        .and_then(Value::as_array_mut)
        .ok_or("kanban bind must be an array")?;
    let from = rows
        .iter()
        .position(|card| card["id"] == id)
        .ok_or("Unknown kanban card")?;
    if rows[from]["disabled"] == true {
        return Err("kanban card is disabled".into());
    }
    if let Some(before) = &before {
        if before == &id
            || !rows
                .iter()
                .any(|card| card["id"] == *before && card["lane"] == lane)
        {
            return Err(
                "kanban beforeId must reference another card in the destination lane".into(),
            );
        }
    }
    let mut card = rows.remove(from);
    payload["oldValue"] = card["lane"].clone();
    payload["column"] = json!(lane);
    payload["beforeId"] = json!(before);
    card["lane"] = json!(lane);
    let to = if let Some(before) = before {
        rows.iter().position(|c| c["id"] == before).unwrap()
    } else {
        rows.iter()
            .rposition(|c| c["lane"] == lane)
            .map_or(rows.len(), |i| i + 1)
    };
    rows.insert(to, card);
    Ok(())
}

const GAP: f64 = 10.0;
const CARD_HEIGHT: f64 = 86.0;
fn stacked(node: &Node, width: f64) -> bool {
    width < node.lanes.len() as f64 * 132.0 + (node.lanes.len() - 1) as f64 * GAP
}
fn lane_height(count: usize) -> f64 {
    (56.0 + count as f64 * (CARD_HEIGHT + GAP)).max(200.0)
}
pub fn height(node: &Node, state: &Value, width: f64) -> f64 {
    let heights = node.lanes.iter().map(|lane| {
        lane_height(
            cards(node, state)
                .iter()
                .filter(|c| c["lane"] == lane.id)
                .count(),
        )
    });
    if stacked(node, width) {
        heights.sum::<f64>() + (node.lanes.len() - 1) as f64 * GAP
    } else {
        heights.fold(200.0, f64::max)
    }
}

pub fn arrange(
    node: &Node,
    state: &Value,
    x: f64,
    y: f64,
    width: f64,
    key: &str,
    out: &mut Vec<Widget>,
) {
    let vertical = stacked(node, width);
    let lane_width = if vertical {
        width
    } else {
        (width - (node.lanes.len() - 1) as f64 * GAP) / node.lanes.len() as f64
    };
    let mut top = y;
    let disabled = node.disabled || node.read_only || flag(state, &node.disabled_bind);
    for (i, lane) in node.lanes.iter().enumerate() {
        let rows: Vec<_> = cards(node, state)
            .iter()
            .filter(|c| c["lane"] == lane.id)
            .collect();
        let lx = if vertical {
            x
        } else {
            x + i as f64 * (lane_width + GAP)
        };
        let h = if vertical {
            lane_height(rows.len())
        } else {
            height(node, state, width)
        };
        let lane_key = format!("{key}:lane:{}", lane.id);
        let mut w = widget(node, "kanban-lane", lx, top, lane_width, h, &lane_key);
        w.text = lane.title.clone();
        w.disabled = disabled;
        w.config = json!({"lane":lane.id,"count":rows.len(),"readOnly":node.read_only});
        out.push(w);
        if rows.is_empty() {
            let mut empty = widget(
                node,
                "empty",
                lx + 10.0,
                top + 66.0,
                (lane_width - 20.0).max(0.0),
                42.0,
                &format!("{lane_key}:empty"),
            );
            empty.text = "ここへドロップ".into();
            empty.config = json!({"parentKey":lane_key});
            out.push(empty);
        }
        for (index, card) in rows.iter().enumerate() {
            let mut w = widget(
                node,
                "kanban-card",
                lx + 10.0,
                top + 46.0 + index as f64 * (CARD_HEIGHT + GAP),
                (lane_width - 20.0).max(0.0),
                CARD_HEIGHT,
                &format!("{key}:card:{}", card["id"].as_str().unwrap()),
            );
            w.text = card["title"].as_str().unwrap().into();
            w.value = card
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into();
            w.disabled = disabled || card["disabled"] == true;
            w.payload = json!({"action":"move","id":card["id"],"value":lane.id,"beforeId":null});
            w.config = json!({"parentKey":lane_key,"lane":lane.id,"laneTitle":lane.title,"index":index,"readOnly":node.read_only});
            out.push(w);
        }
        if vertical {
            top += h + GAP;
        }
    }
}
