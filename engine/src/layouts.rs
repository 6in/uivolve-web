use super::{flag, lookup, measure, widget, Node, Widget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Layout {
    Name(String),
    Options(Options),
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub columns: Option<usize>,
    #[serde(default)]
    pub gap: Option<f64>,
    #[serde(default)]
    pub padding: Option<f64>,
    #[serde(default)]
    pub min_column_width: Option<f64>,
}
impl Default for Layout {
    fn default() -> Self {
        Self::Name(String::new())
    }
}
impl From<&str> for Layout {
    fn from(s: &str) -> Self {
        Self::Name(s.into())
    }
}
impl PartialEq<&str> for Layout {
    fn eq(&self, s: &&str) -> bool {
        self.as_str() == *s
    }
}
impl fmt::Display for Layout {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}
impl Layout {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Name(s) => s,
            Self::Options(o) => &o.kind,
        }
    }
    pub fn is_empty(&self) -> bool {
        self.as_str().is_empty()
    }
    pub fn gap(&self) -> f64 {
        match self {
            Self::Options(o) => o.gap.unwrap_or(12.0),
            _ => 12.0,
        }
    }
    pub fn padding(&self) -> f64 {
        match self {
            Self::Options(o) => o.padding.unwrap_or(0.0),
            _ => 0.0,
        }
    }
    fn columns(&self, n: &Node) -> usize {
        match self {
            Self::Options(o) if o.columns.is_some() => o.columns.unwrap(),
            _ => match n.columns {
                super::extras::Columns::Count(c) => c,
                _ => 2,
            },
        }
    }
    fn min_column_width(&self) -> f64 {
        match self {
            Self::Options(o) => o.min_column_width.unwrap_or(120.0),
            _ => 120.0,
        }
    }
}
fn container(n: &Node) -> bool {
    ["container", "panel", "fieldset", "window"].contains(&n.xtype.as_str())
}
pub fn normalize(n: &mut Node, path: &str) {
    if n.layout == "card" {
        if n.item_id.is_empty() {
            n.item_id = format!("layout-{}", path.replace('.', "-"));
        }
        if n.active_bind.is_empty() {
            n.active_bind = format!("ui_{}_active", n.item_id.replace('-', "_"));
        }
    }
}
pub fn initialize(n: &Node, state: &mut Value) {
    if n.layout == "card" {
        state
            .as_object_mut()
            .unwrap()
            .entry(n.active_bind.clone())
            .or_insert(json!(n.active_item));
    }
    for c in &n.items {
        initialize(c, state);
    }
}
pub fn active(n: &Node, state: &Value) -> usize {
    lookup(state, &n.active_bind)
        .as_u64()
        .unwrap_or(n.active_item as u64) as usize
}
pub fn hidden(path: &[&Node], state: &Value) -> bool {
    path.windows(2).any(|p| {
        p[0].layout == "card"
            && p[0]
                .items
                .get(active(p[0], state))
                .is_none_or(|c| !std::ptr::eq(c, p[1]))
    })
}
pub fn event(n: &Node, state: &mut Value, p: &Value) -> Result<(), String> {
    let index = p["value"].as_u64().ok_or("Card index must be an integer")?;
    if p["action"] != "card" || index >= n.items.len() as u64 {
        return Err("Invalid card index/action".into());
    }
    let c = &n.items[index as usize];
    if c.disabled || flag(state, &c.disabled_bind) {
        return Err("Card is disabled".into());
    }
    state[&n.active_bind] = json!(index);
    Ok(())
}
pub fn validate_state(n: &Node, state: &Value) -> Result<(), String> {
    if n.layout == "card"
        && lookup(state, &n.active_bind)
            .as_u64()
            .is_none_or(|i| i >= n.items.len() as u64)
    {
        return Err("Card state must be a valid integer index".into());
    }
    for c in &n.items {
        validate_state(c, state)?;
    }
    Ok(())
}
pub fn validate(n: &Node) -> Result<(), String> {
    if !n.layout.is_empty()
        && !["vbox", "hbox", "accordion", "grid", "card", "border", "fit"]
            .contains(&n.layout.as_str())
    {
        return Err(format!("Unsupported layout: {}", n.layout));
    }
    if !n.layout.is_empty() && !container(n) {
        return Err("Layout is supported only on containers/panels/windows".into());
    }
    if let Layout::Options(o) = &n.layout {
        if o.kind.is_empty() {
            return Err("Layout options require a nonempty type".into());
        }
        for v in [o.gap, o.padding].into_iter().flatten() {
            if !v.is_finite() || !(0.0..=64.0).contains(&v) {
                return Err("Layout gap/padding must be 0..64".into());
            }
        }
        if o.columns.is_some() && n.layout != "grid" {
            return Err("Layout columns requires grid layout".into());
        }
        if o.min_column_width
            .is_some_and(|v| !v.is_finite() || !(40.0..=1200.0).contains(&v))
            || o.min_column_width.is_some() && n.layout != "grid"
        {
            return Err("minColumnWidth requires grid layout and 40..1200".into());
        }
    }
    if n.layout == "grid" && !(1..=12).contains(&n.layout.columns(n)) {
        return Err("Grid layout requires 1..12 columns".into());
    }
    if n.layout == "card"
        && (n.items.is_empty()
            || n.items.len() > 32
            || n.active_item >= n.items.len()
            || n.active_bind.is_empty()
            || n.active_bind.contains('.')
            || n.items.iter().any(|c| c.xtype == "window"))
    {
        return Err(
            "Card requires 1..32 non-window items, valid activeItem and top-level activeBind"
                .into(),
        );
    }
    if n.layout == "fit" && children(n).len() != 1 {
        return Err("Fit requires exactly one flow child".into());
    }
    if n.layout == "border" {
        let mut regions = std::collections::HashSet::new();
        for (_, c) in children(n) {
            if !["north", "south", "west", "east", "center"].contains(&c.region.as_str())
                || !regions.insert(&c.region)
            {
                return Err("Border requires unique north/south/west/east/center regions".into());
            }
        }
        if !regions.contains(&"center".to_string()) {
            return Err("Border requires a center region".into());
        }
    }
    for c in &n.items {
        if c.col_span == 0
            || c.col_span
                > if n.layout == "grid" {
                    n.layout.columns(n)
                } else {
                    1
                }
        {
            return Err("colSpan requires grid layout and must fit its configured columns".into());
        }
        if !c.region.is_empty() && n.layout != "border" {
            return Err("region requires a border parent".into());
        }
    }
    if n.width
        .is_some_and(|v| !v.is_finite() || !(24.0..=1200.0).contains(&v))
    {
        return Err("width must be 24..1200".into());
    }
    Ok(())
}
#[derive(Clone)]
pub struct Slot {
    pub index: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
fn children(n: &Node) -> Vec<(usize, &Node)> {
    n.items
        .iter()
        .enumerate()
        .filter(|(_, c)| c.xtype != "window")
        .collect()
}
fn region<'a>(n: &'a Node, name: &str) -> Option<(usize, &'a Node)> {
    children(n).into_iter().find(|(_, c)| c.region == name)
}
fn flow_gap(n: &Node, w: f64, count: usize) -> f64 {
    let gap = n.layout.gap().min(w / 8.0);
    if n.layout == "hbox" {
        gap.min(w / (2.0 * count.max(1) as f64))
    } else {
        gap
    }
}
fn side_widths(n: &Node, w: f64) -> (f64, f64, f64) {
    let gap = n.layout.gap().min(w / 8.0);
    let west = region(n, "west").map_or(0.0, |(_, c)| c.width.unwrap_or(180.0));
    let east = region(n, "east").map_or(0.0, |(_, c)| c.width.unwrap_or(180.0));
    let count = usize::from(west > 0.0) + usize::from(east > 0.0);
    let budget = (w - gap * count as f64).max(0.0);
    let scale = ((budget - 64.0_f64.min(budget / 2.0)).max(0.0) / (west + east).max(1.0)).min(1.0);
    (west * scale, east * scale, gap)
}
fn grid_rows(n: &Node, state: &Value, w: f64) -> Vec<Vec<Slot>> {
    let gap = n.layout.gap().min(w / 8.0);
    let cols = (((w + gap) / (n.layout.min_column_width() + gap)).floor() as usize)
        .clamp(1, n.layout.columns(n));
    let cw = ((w - gap * (cols - 1) as f64) / cols as f64).max(0.0);
    let mut rows = vec![];
    let (mut row, mut used) = (vec![], 0);
    for (i, c) in children(n) {
        let span = c.col_span.min(cols);
        if used + span > cols {
            rows.push(row);
            row = vec![];
            used = 0;
        }
        let width = cw * span as f64 + gap * (span - 1) as f64;
        row.push(Slot {
            index: i,
            x: used as f64 * (cw + gap),
            y: 0.0,
            width,
            height: measure(c, state, width),
        });
        used += span;
    }
    if !row.is_empty() {
        rows.push(row);
    }
    rows
}
pub fn natural_height(n: &Node, state: &Value, width: f64) -> f64 {
    let pad = n.layout.padding().min(width / 4.0);
    let w = (width - 2.0 * pad).max(0.0);
    let cs = children(n);
    let gap = flow_gap(n, w, cs.len());
    let body = match n.layout.as_str() {
        "grid" => {
            let rows = grid_rows(n, state, w);
            rows.iter()
                .map(|r| r.iter().map(|s| s.height).fold(0.0, f64::max))
                .sum::<f64>()
                + gap * rows.len().saturating_sub(1) as f64
        }
        "card" => cs
            .iter()
            .map(|(_, c)| measure(c, state, w))
            .fold(0.0, f64::max),
        "fit" => cs.first().map_or(0.0, |(_, c)| measure(c, state, w)),
        "border" => {
            let (west, east, gap) = side_widths(n, w);
            let middle = (w
                - west
                - east
                - gap * (usize::from(west > 0.0) + usize::from(east > 0.0)) as f64)
                .max(0.0);
            let mid = [("west", west), ("center", middle), ("east", east)]
                .into_iter()
                .map(|(r, w)| region(n, r).map_or(0.0, |(_, c)| measure(c, state, w)))
                .fold(0.0, f64::max);
            mid + region(n, "north").map_or(0.0, |(_, c)| measure(c, state, w) + gap)
                + region(n, "south").map_or(0.0, |(_, c)| measure(c, state, w) + gap)
        }
        "hbox" => {
            let total: f64 = cs.iter().map(|(_, c)| c.flex).sum();
            let available = (w - gap * cs.len().saturating_sub(1) as f64).max(0.0);
            cs.iter()
                .map(|(_, c)| measure(c, state, available * c.flex / total))
                .fold(0.0, f64::max)
        }
        _ => {
            cs.iter().map(|(_, c)| measure(c, state, w)).sum::<f64>()
                + gap * cs.len().saturating_sub(1) as f64
        }
    };
    body + 2.0 * pad
}
pub fn slots(n: &Node, state: &Value, width: f64, height: f64) -> Vec<Slot> {
    let pad = n.layout.padding().min(width / 4.0);
    let w = (width - pad * 2.0).max(0.0);
    let h = (height - pad * 2.0).max(0.0);
    let cs = children(n);
    let gap = flow_gap(n, w, cs.len());
    let mut result = vec![];
    match n.layout.as_str() {
        "grid" => {
            let mut y = 0.0;
            for row in grid_rows(n, state, w) {
                let rh = row.iter().map(|s| s.height).fold(0.0, f64::max);
                for mut s in row {
                    s.y = y;
                    s.height = rh;
                    result.push(s);
                }
                y += rh + gap;
            }
        }
        "card" => {
            let i = active(n, state);
            if n.items.get(i).is_some() {
                result.push(Slot {
                    index: i,
                    x: 0.0,
                    y: 0.0,
                    width: w,
                    height: h,
                });
            }
        }
        "fit" => {
            if let Some((i, _)) = cs.first() {
                result.push(Slot {
                    index: *i,
                    x: 0.0,
                    y: 0.0,
                    width: w,
                    height: h,
                });
            }
        }
        "border" => {
            let (west, east, gap) = side_widths(n, w);
            let top = region(n, "north").map_or(0.0, |(_, c)| measure(c, state, w) + gap);
            let bottom = region(n, "south").map_or(0.0, |(_, c)| measure(c, state, w) + gap);
            let mh = (h - top - bottom).max(0.0);
            let left = if west > 0.0 { west + gap } else { 0.0 };
            let right = if east > 0.0 { east + gap } else { 0.0 };
            for (name, x, y, width, height) in [
                ("north", 0.0, 0.0, w, (top - gap).max(0.0)),
                ("south", 0.0, h - bottom + gap, w, (bottom - gap).max(0.0)),
                ("west", 0.0, top, west, mh),
                ("east", w - east, top, east, mh),
                ("center", left, top, (w - left - right).max(0.0), mh),
            ] {
                if let Some((i, _)) = region(n, name) {
                    result.push(Slot {
                        index: i,
                        x,
                        y,
                        width,
                        height,
                    });
                }
            }
        }
        "hbox" => {
            let total: f64 = cs.iter().map(|(_, c)| c.flex).sum();
            let available = (w - gap * cs.len().saturating_sub(1) as f64).max(0.0);
            let mut x = 0.0;
            for (i, c) in cs {
                let width = available * c.flex / total;
                result.push(Slot {
                    index: i,
                    x,
                    y: 0.0,
                    width,
                    height: measure(c, state, width),
                });
                x += width + gap;
            }
        }
        _ => {
            let mut y = 0.0;
            for (i, c) in cs {
                let height = measure(c, state, w);
                result.push(Slot {
                    index: i,
                    x: 0.0,
                    y,
                    width: w,
                    height,
                });
                y += height + gap;
            }
        }
    }
    for s in &mut result {
        s.x += pad;
        s.y += pad;
    }
    result
}
pub fn describe_card(
    n: &Node,
    state: &Value,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    key: &str,
    out: &mut Vec<Widget>,
) {
    if n.layout == "card" {
        let mut w = widget(n, "card", x, y, width, height, &format!("{key}:card"));
        w.text.clear();
        w.payload = json!({"action":"card"});
        w.config = json!({"activeItem":active(n,state),"count":n.items.len(),"titles":n.items.iter().map(|c|c.title.clone()).collect::<Vec<_>>()});
        out.push(w);
    }
}
