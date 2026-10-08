const encoder = new TextEncoder();
// The Instance tree the engine will build, flattened by path: every node whose xtype names a
// declaration of the screen it belongs to is one Instance, keyed by the itemIds of its placement
// joined by `/`. The root is keyed by the empty string and counts as one of the eight.
export function instanceTable(screen, href, packages) {
  const table = new Map([["", { url: href, screen }]]);
  const counter = { total: 1 };
  const visit = (parent, prefix) => {
    const declarations = parent.components ?? {};
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (typeof node.xtype === "string" && Object.hasOwn(declarations, node.xtype)) {
        const url = declarations[node.xtype].url;
        if (++counter.total > 8)
          throw new Error(`コンポーネントの数が8を超えています（rootを含む）: ${url}`);
        const path = prefix ? `${prefix}/${node.itemId}` : `${node.itemId}`;
        table.set(path, { url, screen: packages[url].screen });
        visit(packages[url].screen, path);
      }
      if (Array.isArray(node.items)) for (const item of node.items) walk(item);
    };
    walk(parent.ui);
  };
  visit(screen, "");
  return table;
}
// The storage scope of the Instance at `path`: the id of the root package and the itemIds of the
// path joined by `__`, the root itself keeping its id. Composed without being checked.
export function componentScope(rootId, path) {
  return [rootId, ...(path ? path.split("/") : [])].join("__");
}
// `null` when the scope composed for `path` is usable, otherwise the refusal to report. No part
// may carry `__` of its own, so two placements never compose the same scope out of different paths.
export function scopeProblem(rootId, path) {
  const parts = [rootId, ...(path ? path.split("/") : [])];
  const scope = parts.join("__");
  if (
    parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part) && !part.includes("__")) &&
    encoder.encode(scope).length <= 80
  )
    return null;
  return `コンポーネント ${path} の保存領域 ${scope} が不正です（英数字・-・_ で80バイト以内、各要素に __ を含めない）`;
}
