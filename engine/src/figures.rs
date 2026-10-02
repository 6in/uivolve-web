use super::{display, lookup, Node};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
const COLORS: [&str; 6] = [
    "#157fcc", "#ef8137", "#4caf50", "#9061c2", "#d9a520", "#cd5c5c",
];
fn data(n: &Node, state: &Value) -> Vec<Value> {
    if !n.bind.is_empty() {
        lookup(state, &n.bind)
            .as_array()
            .cloned()
            .unwrap_or_default()
    } else if let Some(v) = n.store.as_array() {
        v.clone()
    } else if let Some(v) = n.store["data"].as_array() {
        v.clone()
    } else {
        n.data.clone()
    }
}
fn series(n: &Node) -> Value {
    if let Some(a) = n.series.as_array() {
        a.first().cloned().unwrap_or(json!({}))
    } else if n.series.is_object() {
        n.series.clone()
    } else {
        json!({})
    }
}
fn numeric(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().unwrap_or(default)
}
fn text(v: &Value, key: &str, default: &str) -> String {
    v[key].as_str().unwrap_or(default).into()
}
fn line(out: &mut Vec<Value>, x: f64, y: f64, x2: f64, y2: f64, color: &str) {
    out.push(json!({"type":"line","fromX":x,"fromY":y,"toX":x2,"toY":y2,"strokeStyle":color,"lineWidth":1.5}));
}
fn label(out: &mut Vec<Value>, x: f64, y: f64, text: &str, color: &str) {
    out.push(json!({"type":"text","x":x,"y":y,"text":text,"fillStyle":color,"fontSize":12}));
}
fn rect(out: &mut Vec<Value>, x: f64, y: f64, width: f64, height: f64, color: &str) {
    out.push(json!({"type":"rect","x":x,"y":y,"width":width,"height":height,"fillStyle":color,"radius":3}));
}
fn circle(out: &mut Vec<Value>, x: f64, y: f64, r: f64, color: &str) {
    out.push(json!({"type":"circle","cx":x,"cy":y,"r":r,"fillStyle":color}));
}
fn color_ok(s: &str) -> bool {
    s == "none"
        || [
            "text",
            "border",
            "background",
            "surface",
            "accent",
            "muted",
            "selected",
            "primary",
        ]
        .contains(&s)
        || (s.starts_with('#')
            && [7, 9].contains(&s.len())
            && s[1..].chars().all(|c| c.is_ascii_hexdigit()))
}
pub fn validate(n: &Node) -> Result<(), String> {
    if n.sprites.len() > 200
        || n.nodes.len() > 50
        || n.edges.len() > 100
        || n.commits.len() > 100
        || n.branches.len() > 12
    {
        return Err("Figure data exceeds its component limit".into());
    }
    for sp in &n.sprites {
        if !["rect", "circle", "ellipse", "line", "path", "text"]
            .contains(&sp["type"].as_str().unwrap_or(""))
        {
            return Err("Unknown draw sprite type".into());
        }
        for key in [
            "x",
            "y",
            "cx",
            "cy",
            "r",
            "rx",
            "ry",
            "width",
            "height",
            "fromX",
            "fromY",
            "toX",
            "toY",
            "lineWidth",
            "fontSize",
            "radius",
        ] {
            if let Some(v) = sp.get(key) {
                if v.as_f64().is_none_or(|v| v.abs() > 10000.0) {
                    return Err(format!("Invalid sprite number: {key}"));
                }
            }
        }
        for key in [
            "r",
            "rx",
            "ry",
            "width",
            "height",
            "lineWidth",
            "fontSize",
            "radius",
        ] {
            if sp[key].as_f64().is_some_and(|v| v < 0.0) {
                return Err(format!("Sprite {key} must be nonnegative"));
            }
        }
        if sp
            .get("opacity")
            .is_some_and(|v| v.as_f64().is_none_or(|v| !(0.0..=1.0).contains(&v)))
        {
            return Err("Sprite opacity must be 0..1".into());
        }
        for key in ["fillStyle", "strokeStyle"] {
            if let Some(v) = sp.get(key) {
                if !v.as_str().is_some_and(color_ok) {
                    return Err("Sprite colors must be hex or a theme token".into());
                }
            }
        }
        if sp["path"].as_str().is_some_and(|s| s.len() > 5000) {
            return Err("Sprite path is too long".into());
        }
    }
    if n.xtype == "chart" {
        let s = series(n);
        if !["bar", "line", "area", "pie"].contains(&s["type"].as_str().unwrap_or("bar")) {
            return Err("Unsupported chart series".into());
        }
        if n.series.as_array().is_some_and(|v| v.len() > 1) {
            return Err("Only the first chart series descriptor is supported".into());
        }
    }
    if n.xtype == "chart" && !n.bind.is_empty() {
        let mut local = n.clone();
        local.bind.clear();
        validate_state(&local, &json!({}))
    } else {
        validate_state(n, &json!({}))
    }
}
pub fn validate_state(n: &Node, state: &Value) -> Result<(), String> {
    if n.xtype == "chart" {
        if !n.bind.is_empty() && !lookup(state, &n.bind).is_array() {
            return Err("Chart binding must contain an array".into());
        }
        let rows = data(n, state);
        if rows.len() > 50 {
            return Err("Charts support up to 50 data points".into());
        }
        let s = series(n);
        let fields = if let Some(v) = s["yField"].as_array() {
            v.iter().map(display).collect::<Vec<_>>()
        } else {
            vec![text(&s, "yField", "value")]
        };
        if fields.is_empty() || fields.len() > 4 {
            return Err("Charts support 1..4 value fields".into());
        }
        for r in &rows {
            for f in &fields {
                if r[f]
                    .as_f64()
                    .is_none_or(|v| v.abs() > 1e12 || s["type"] == "pie" && v < 0.0)
                {
                    return Err(
                        "Chart values must be finite numbers; pie values must be nonnegative"
                            .into(),
                    );
                }
            }
        }
    }
    if n.xtype == "networkgraph" {
        let mut ids = HashSet::new();
        for node in &n.nodes {
            let id = node["id"].as_str().ok_or("Graph node needs string id")?;
            if id.is_empty() || !ids.insert(id) {
                return Err("Graph node IDs must be unique".into());
            }
            if node
                .get("color")
                .is_some_and(|v| !v.as_str().is_some_and(color_ok))
            {
                return Err("Invalid node color".into());
            }
        }
        for e in &n.edges {
            if !ids.contains(e["from"].as_str().unwrap_or(""))
                || !ids.contains(e["to"].as_str().unwrap_or(""))
            {
                return Err("Graph edge refers to unknown node".into());
            }
        }
    }
    if n.xtype == "gitgraph" {
        let mut branches = n.branches.clone();
        for c in &n.commits {
            let b = text(c, "branch", "main");
            if !branches.contains(&b) {
                branches.push(b);
            }
        }
        if branches.len() > 12 {
            return Err("Git graph supports at most 12 branches".into());
        }
        let mut ids = HashSet::new();
        for c in &n.commits {
            let id = c["id"].as_str().ok_or("Commit needs string id")?;
            if !ids.insert(id) {
                return Err("Commit IDs must be unique".into());
            }
        }
        for c in &n.commits {
            if let Some(parents) = c["parents"].as_array() {
                for p in parents {
                    if !ids.contains(p.as_str().unwrap_or("")) {
                        return Err("Unknown parent commit".into());
                    }
                }
            }
        }
    }
    if n.xtype == "mermaid" {
        let value = if n.bind.is_empty() {
            display(&n.value)
        } else {
            display(lookup(state, &n.bind))
        };
        if !value.is_empty() {
            mermaid(&value)?;
        }
    }
    Ok(())
}
pub fn render(n: &Node, state: &Value) -> Value {
    let mut out = vec![];
    let mut height = 260.0;
    match n.xtype.as_str() {
        "draw" => {
            out = n.sprites.clone();
            for s in &mut out {
                let coordinates: &[&str] = match s["type"].as_str().unwrap_or("") {
                    "rect" => &["x", "y", "width", "height"],
                    "circle" => &["cx", "cy", "r"],
                    "ellipse" => &["cx", "cy", "rx", "ry"],
                    "line" => &["fromX", "fromY", "toX", "toY"],
                    "text" => &["x", "y"],
                    _ => &[],
                };
                for key in coordinates {
                    if s.get(*key).is_none() {
                        s[*key] = json!(0);
                    }
                }
                if s["type"] == "text" && s.get("fontSize").is_none() {
                    s["fontSize"] = json!(12);
                }
                if s["type"] == "text" && s.get("fillStyle").is_none() {
                    s["fillStyle"] = json!("text");
                }
                if s["type"] == "line" && s.get("strokeStyle").is_none() {
                    s["strokeStyle"] = json!("text");
                }
            }
        }
        "chart" => chart(n, state, &mut out),
        "networkgraph" => network(n, &mut out),
        "gitgraph" => {
            height = (n.commits.len() as f64 * 32.0 + 16.0).max(60.0);
            git(n, &mut out);
        }
        "mermaid" => {
            let value = if n.bind.is_empty() {
                display(&n.value)
            } else {
                display(lookup(state, &n.bind))
            };
            if let Ok((nodes, edges, lr)) = mermaid(&value) {
                let cw = if lr {
                    460.0 / nodes.len().max(1) as f64
                } else {
                    440.0
                };
                let ch = if lr {
                    200.0
                } else {
                    240.0 / nodes.len().max(1) as f64
                };
                for e in edges {
                    let a = nodes.iter().position(|v| v.0 == e.0).unwrap();
                    let b = nodes.iter().position(|v| v.0 == e.1).unwrap();
                    let (x, y, x2, y2) = if lr {
                        (
                            a as f64 * cw + cw * 0.9,
                            130.0,
                            b as f64 * cw + cw * 0.1,
                            130.0,
                        )
                    } else {
                        (
                            230.0,
                            a as f64 * ch + ch * 0.85,
                            230.0,
                            b as f64 * ch + ch * 0.15,
                        )
                    };
                    line(&mut out, x, y, x2, y2, "muted");
                    line(&mut out, x2, y2, x2 - 5.0, y2 - 5.0, "muted");
                }
                for (i, (_, title)) in nodes.iter().enumerate() {
                    let (x, y, w, h) = if lr {
                        (i as f64 * cw + cw * 0.1, 100.0, cw * 0.8, 60.0)
                    } else {
                        (40.0, i as f64 * ch + ch * 0.15, 380.0, ch * 0.7)
                    };
                    rect(&mut out, x, y, w, h, "selected");
                    label(&mut out, x + 8.0, y + h / 2.0, title, "text");
                }
            }
        }
        _ => {}
    }
    if out.is_empty() {
        label(&mut out, 16.0, 30.0, "データがありません", "muted");
    }
    json!({"viewWidth":460.0,"viewHeight":height,"sprites":out,"format":n.xtype})
}
fn chart(n: &Node, state: &Value, out: &mut Vec<Value>) {
    let rows = data(n, state);
    let s = series(n);
    let kind = s["type"].as_str().unwrap_or("bar");
    let xf = text(&s, "xField", "name");
    let fields = if let Some(a) = s["yField"].as_array() {
        a.iter().map(display).collect::<Vec<_>>()
    } else {
        vec![text(&s, "yField", "value")]
    };
    if rows.is_empty() {
        return;
    }
    if kind == "pie" {
        let sum: f64 = rows.iter().map(|r| numeric(r, &fields[0], 0.0)).sum();
        if sum <= 0.0 {
            return;
        }
        let mut angle = -std::f64::consts::FRAC_PI_2;
        for (i, r) in rows.iter().enumerate() {
            let next = angle + numeric(r, &fields[0], 0.0) / sum * std::f64::consts::TAU;
            out.push(json!({"type":"sector","cx":145.0,"cy":130.0,"r":100.0,"start":angle,"end":next,"fillStyle":COLORS[i%6]}));
            if i < 10 {
                circle(out, 280.0, 25.0 + i as f64 * 22.0, 4.0, COLORS[i % 6]);
                label(
                    out,
                    292.0,
                    25.0 + i as f64 * 22.0,
                    &format!("{} {}", display(&r[&xf]), display(&r[&fields[0]])),
                    "text",
                );
            }
            angle = next;
        }
        return;
    }
    let min = rows
        .iter()
        .flat_map(|r| fields.iter().map(move |f| numeric(r, f, 0.0)))
        .fold(0.0, f64::min);
    let max = rows
        .iter()
        .flat_map(|r| fields.iter().map(move |f| numeric(r, f, 0.0)))
        .fold(1.0, f64::max);
    let y_of = |v: f64| 220.0 - (v - min) / (max - min) * 175.0;
    let zero = y_of(0.0);
    let cw = 398.0 / rows.len() as f64;
    for i in 0..5 {
        let value = min + (max - min) * i as f64 / 4.0;
        let y = y_of(value);
        line(out, 48.0, y, 446.0, y, "border");
        label(out, 3.0, y, &format!("{value:.0}"), "muted");
    }
    for (i, r) in rows.iter().enumerate() {
        if rows.len() <= 12 || i % rows.len().div_ceil(12) == 0 {
            label(
                out,
                48.0 + (i as f64 + 0.1) * cw,
                240.0,
                &display(&r[&xf]),
                "text",
            );
        }
    }
    for (k, f) in fields.iter().enumerate() {
        label(out, 48.0 + k as f64 * 95.0, 18.0, f, COLORS[k]);
        let mut prev = None;
        for (i, r) in rows.iter().enumerate() {
            let value = numeric(r, f, 0.0);
            let px = 48.0 + (i as f64 + 0.5) * cw;
            let py = y_of(value);
            if kind == "bar" {
                let bw = cw * 0.7 / fields.len() as f64;
                rect(
                    out,
                    px - cw * 0.35 + k as f64 * bw,
                    py.min(zero),
                    bw * 0.9,
                    (py - zero).abs(),
                    COLORS[k],
                );
            } else {
                if let Some((x, y)) = prev {
                    line(out, x, y, px, py, COLORS[k]);
                    if kind == "area" {
                        out.push(json!({"type":"polygon","points":[[x,zero],[x,y],[px,py],[px,zero]],"fillStyle":COLORS[k],"opacity":0.2}));
                    }
                }
                circle(out, px, py, 3.0, COLORS[k]);
                prev = Some((px, py));
            }
        }
    }
}
fn network(n: &Node, out: &mut Vec<Value>) {
    let count = n.nodes.len();
    if count == 0 {
        return;
    }
    let mut pos: Vec<(f64, f64)> = (0..count)
        .map(|i| {
            let a = i as f64 / count as f64 * std::f64::consts::TAU;
            (230.0 + a.cos() * 130.0, 130.0 + a.sin() * 90.0)
        })
        .collect();
    let index: HashMap<&str, usize> = n
        .nodes
        .iter()
        .enumerate()
        .map(|(i, v)| (v["id"].as_str().unwrap_or(""), i))
        .collect();
    for _ in 0..50 {
        let mut delta = vec![(0.0, 0.0); count];
        for i in 0..count {
            for j in i + 1..count {
                let dx = pos[i].0 - pos[j].0;
                let dy = pos[i].1 - pos[j].1;
                let d2 = (dx * dx + dy * dy).max(25.0);
                let f = 120.0 / d2;
                delta[i].0 += dx * f;
                delta[i].1 += dy * f;
                delta[j].0 -= dx * f;
                delta[j].1 -= dy * f;
            }
        }
        for edge in &n.edges {
            let a = index[edge["from"].as_str().unwrap()];
            let b = index[edge["to"].as_str().unwrap()];
            let dx = pos[b].0 - pos[a].0;
            let dy = pos[b].1 - pos[a].1;
            delta[a].0 += dx * 0.015;
            delta[a].1 += dy * 0.015;
            delta[b].0 -= dx * 0.015;
            delta[b].1 -= dy * 0.015;
        }
        for i in 0..count {
            pos[i].0 = (pos[i].0 + delta[i].0).clamp(35.0, 425.0);
            pos[i].1 = (pos[i].1 + delta[i].1).clamp(25.0, 220.0);
        }
    }
    for edge in &n.edges {
        let a = pos[index[edge["from"].as_str().unwrap()]];
        let b = pos[index[edge["to"].as_str().unwrap()]];
        line(out, a.0, a.1, b.0, b.1, "border");
    }
    let mut groups = vec![];
    for (i, v) in n.nodes.iter().enumerate() {
        let g = display(&v["group"]);
        if !groups.contains(&g) {
            groups.push(g.clone());
        }
        let color = v["color"]
            .as_str()
            .unwrap_or(COLORS[groups.iter().position(|x| x == &g).unwrap() % 6]);
        circle(
            out,
            pos[i].0,
            pos[i].1,
            numeric(v, "r", 9.0).clamp(3.0, 30.0),
            color,
        );
        label(
            out,
            pos[i].0 - 20.0,
            pos[i].1 + 24.0,
            v["text"].as_str().unwrap_or(v["id"].as_str().unwrap()),
            "text",
        );
    }
}
fn git(n: &Node, out: &mut Vec<Value>) {
    let mut branches = n.branches.clone();
    for c in &n.commits {
        let b = text(c, "branch", "main");
        if !branches.contains(&b) {
            branches.push(b);
        }
    }
    let lane = |v: &Value| {
        branches
            .iter()
            .position(|b| b == v["branch"].as_str().unwrap_or("main"))
            .unwrap_or(0)
    };
    let x = |v: &Value| 16.0 + lane(v) as f64 * 26.0;
    let ids: HashMap<&str, usize> = n
        .commits
        .iter()
        .enumerate()
        .map(|(i, c)| (c["id"].as_str().unwrap_or(""), i))
        .collect();
    for (i, c) in n.commits.iter().enumerate() {
        let y = 20.0 + i as f64 * 32.0;
        if let Some(parents) = c["parents"].as_array() {
            for p in parents {
                if let Some(&j) = ids.get(p.as_str().unwrap_or("")) {
                    line(
                        out,
                        x(c),
                        y,
                        x(&n.commits[j]),
                        20.0 + j as f64 * 32.0,
                        COLORS[lane(c) % 6],
                    );
                }
            }
        }
    }
    for (i, c) in n.commits.iter().enumerate() {
        let y = 20.0 + i as f64 * 32.0;
        circle(out, x(c), y, 5.0, COLORS[lane(c) % 6]);
        label(
            out,
            branches.len() as f64 * 26.0 + 24.0,
            y,
            &format!(
                "{} · {} {}",
                text(c, "branch", "main"),
                text(c, "message", ""),
                text(c, "tag", "")
            ),
            "text",
        );
    }
}
type Flow = (Vec<(String, String)>, Vec<(String, String)>, bool);
fn mermaid(source: &str) -> Result<Flow, String> {
    if source.len() > 10000 {
        return Err("Mermaid source is too long".into());
    }
    let mut statements = source
        .split(['\n', ';'])
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let first = statements.next().unwrap_or("");
    let lr = matches!(first, "flowchart LR" | "graph LR");
    if !lr
        && !matches!(
            first,
            "flowchart TD" | "flowchart TB" | "graph TD" | "graph TB"
        )
    {
        return Err("Mermaid subset supports flowchart/graph LR or TD with --> edges".into());
    }
    let mut nodes: Vec<(String, String)> = vec![];
    let mut edges = vec![];
    for statement in statements {
        if statement.starts_with("%%") {
            continue;
        }
        let parts: Vec<_> = statement.split("-->").collect();
        if parts.len() < 2 {
            return Err("Mermaid statement requires -->".into());
        }
        let mut ids = vec![];
        for part in parts {
            let part = part.trim();
            let end = part.find(['[', '(', '{']).unwrap_or(part.len());
            let id = part[..end].trim();
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                return Err("Unsupported Mermaid node syntax".into());
            }
            let title = if end < part.len() {
                let closing = match part.as_bytes()[end] {
                    b'[' => ']',
                    b'(' => ')',
                    _ => '}',
                };
                if !part.ends_with(closing) {
                    return Err("Unclosed Mermaid node label".into());
                }
                part[end + 1..part.len() - 1].to_string()
            } else {
                id.into()
            };
            if !nodes.iter().any(|n| n.0 == id) {
                nodes.push((id.into(), title));
            }
            ids.push(id.to_string());
        }
        for pair in ids.windows(2) {
            edges.push((pair[0].clone(), pair[1].clone()));
        }
    }
    if nodes.len() > 12 || edges.len() > 24 {
        return Err("Mermaid subset supports at most 12 nodes/24 edges".into());
    }
    Ok((nodes, edges, lr))
}
pub fn diff(original: &str, value: &str) -> Vec<Value> {
    let a: Vec<_> = original.lines().take(200).collect();
    let b: Vec<_> = value.lines().take(200).collect();
    let mut lcs = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut out = vec![];
    while i < a.len() || j < b.len() {
        let (text, tone) = if i < a.len() && j < b.len() && a[i] == b[j] {
            let s = format!("  {}", a[i]);
            i += 1;
            j += 1;
            (s, "text")
        } else if j < b.len() && (i == a.len() || lcs[i][j + 1] >= lcs[i + 1][j]) {
            let s = format!("+ {}", b[j]);
            j += 1;
            (s, "accent")
        } else {
            let s = format!("- {}", a[i]);
            i += 1;
            (s, "danger")
        };
        out.push(json!({"text":text,"tone":tone,"code":true}));
    }
    out
}
