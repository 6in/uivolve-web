import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
let module_, bytes, package_, script, engine;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  module_ = await WebAssembly.compile(bytes);
  package_ = JSON.parse(
    await readFile(new URL("../public/screens/grid-lab.json", import.meta.url), "utf8"),
  );
  script = await readFile(new URL("../public/screens/grid-lab.rhai", import.meta.url), "utf8");
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(module_, {})).exports, bytes.length);
});
const cells = (column) =>
  engine.layout(500).widgets.filter((w) => w.kind === "grid-cell" && w.payload.column === column);
const draft = (id, column, value) => {
  engine.dispatch("inventory", { action: "beginEdit", id, column });
  return engine.dispatch("inventory", { action: "draft", id, column, value });
};
it("activates common Grid behavior for column-only configuration", () => {
  const screen = {
    version: 1,
    id: "column-config",
    title: "Columns",
    script: "columns.rhai",
    state: { rows: [{ id: 1, name: "Visible", secret: "Hidden" }] },
    ui: {
      xtype: "grid",
      itemId: "columns",
      bind: "rows",
      columns: [
        { text: "Name", dataIndex: "name", align: "right", sortable: false },
        { text: "Secret", dataIndex: "secret", hidden: true },
      ],
    },
  };
  engine.load(screen, "fn init(state) { state }");
  const widgets = engine.layout(500).widgets;
  expect(widgets.some((w) => w.kind === "grid-shell")).toBe(true);
  expect(widgets.some((w) => w.kind === "grid-cell" && w.payload.column === "secret")).toBe(false);
  expect(() => engine.dispatch("columns", { action: "sort", column: "name" })).toThrow();
});
it("bounds rendering while sorting numbers, filtering all rows, paging, and preserving stable ID selection", () => {
  expect(engine.load(package_, script).state.records).toHaveLength(500);
  expect(cells("id").map((w) => w.payload.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  engine.dispatch("inventory", { action: "select", id: 2 });
  engine.dispatch("inventory", { action: "select", id: 3, additive: true });
  expect(engine.dispatch("inventory", { action: "page", value: 1 }).state.selectedIds).toEqual([
    2, 3,
  ]);
  expect(cells("id")[0].payload.id).toBe(9);
  engine.dispatch("inventory", { action: "sort", column: "quantity" });
  expect(cells("quantity").map((w) => Number(w.text))).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
  engine.dispatch("inventory", { action: "sort", column: "quantity" });
  expect(Number(cells("quantity")[0].text)).toBe(99);
  engine.dispatch("inventory", { action: "sort", column: "quantity" });
  expect(cells("id")[0].payload.id).toBe(1);
  engine.dispatch("inventory", { action: "page", value: 30 });
  const filtered = engine.dispatch("gridSearch", { value: "出荷済" });
  expect(filtered.state.page).toBe(0);
  expect(engine.layout(500).widgets.find((w) => w.kind === "grid-shell").config.rowCount).toBe(166);
  expect(cells("status").every((w) => w.text === "出荷済")).toBe(true);
  expect(cells("id")).toHaveLength(8);
  expect(filtered.state.selectedIds).toEqual([2, 3]);
  const empty = engine.dispatch("gridSearch", { value: "no-match" });
  expect(cells("id")).toHaveLength(0);
  expect(engine.layout(500).widgets.some((w) => w.kind === "empty")).toBe(true);
  expect(() => engine.dispatch("inventory", { action: "page", value: 1 })).toThrow();
  expect(engine.dispatch("views", { action: "tab", value: 2 }).state.selectedIds).toEqual(
    empty.state.selectedIds,
  );
});
it("edits stable IDs with shared drafts, typed validation, cancellation and atomic Rhai rollback", () => {
  engine.load(package_, script);
  draft(2, "customer", "日本語の顧客");
  expect(engine.layout(500).widgets.find((w) => w.config.gridEditor).value).toBe("日本語の顧客");
  const saved = engine.dispatch("inventory", { action: "commitEdit" });
  expect(saved.state.records[1].customer).toBe("日本語の顧客");
  expect(saved.state.records[0].customer).toBe("顧客 1");
  expect(saved.state.edited).toBe(1);
  draft(2, "customer", "取消する値");
  expect(engine.dispatch("inventory", { action: "cancelEdit" }).state.records[1].customer).toBe(
    "日本語の顧客",
  );
  const invalid = draft(2, "quantity", 9000);
  expect(() => engine.dispatch("inventory", { action: "commitEdit" })).toThrow(/500/);
  expect(
    engine.dispatch("inventory", { action: "draft", id: 2, column: "quantity", value: 9000 }).state
      .records[1].quantity,
  ).toBe(invalid.state.records[1].quantity);
  engine.dispatch("inventory", { action: "draft", id: 2, column: "quantity", value: 20 });
  expect(engine.dispatch("inventory", { action: "commitEdit" }).state.records[1].quantity).toBe(20);
  const outside = draft(2, "quantity", -1);
  expect(() => engine.dispatch("inventory", { action: "commitEdit" })).toThrow(/minValue/);
  expect(engine.dispatch("inventory", { action: "cancelEdit" }).state.records[1].quantity).toBe(
    outside.state.records[1].quantity,
  );
  engine.dispatch("inventory", { action: "sort", column: "id" });
  engine.dispatch("inventory", { action: "sort", column: "id" });
  const id = cells("id")[0].payload.id;
  draft(id, "customer", "並べ替え後の編集");
  const after = engine.dispatch("inventory", { action: "commitEdit" });
  expect(after.state.records.find((r) => r.id === id).customer).toBe("並べ替え後の編集");
  expect(after.state.records.find((r) => r.id === 1).customer).toBe("顧客 1");
});
it("rejects forged, off-page, stale and noneditable operations without changing state", () => {
  engine.load(package_, script);
  for (const payload of [
    { action: "select", id: 999 },
    { action: "select", id: 9 },
    { action: "page", value: -1 },
    { action: "page", value: 500 },
    { action: "sort", column: "forged" },
    { action: "beginEdit", id: 1, column: "id" },
    { action: "beginEdit", id: 1, column: "memo" },
    { action: "commitEdit" },
  ])
    expect(() => engine.dispatch("inventory", payload)).toThrow();
  const editing = draft(1, "customer", "draft");
  expect(() =>
    engine.dispatch("inventory", { action: "draft", id: 2, column: "customer", value: "stale" }),
  ).toThrow(/Stale/);
  expect(engine.dispatch("views", { action: "tab", value: 2 }).state.cellEdit).toEqual(
    editing.state.cellEdit,
  );
  const hidden = engine.dispatch("inventory", { action: "commitEdit" });
  expect(hidden.state.records[0].customer).toBe("顧客 1");
  expect(() => engine.dispatch("views", { action: "tab", value: 3 })).toThrow(/disabled/);
});
it("supports Shift ranges, page-spanning selection, tab state, tree visibility and menu dismissal", () => {
  engine.load(package_, script);
  engine.dispatch("inventory", { action: "select", id: 2 });
  expect(
    engine.dispatch("inventory", { action: "select", id: 5, range: true }).state.selectedIds,
  ).toEqual([2, 3, 4, 5]);
  engine.dispatch("inventory", { action: "page", value: 1 });
  expect(
    engine.dispatch("inventory", { action: "select", id: 9, toggle: true }).state.selectedIds,
  ).toEqual([2, 3, 4, 5, 9]);
  const closed = engine.dispatch("clearSelection");
  expect(closed.state.selectedIds).toEqual([2, 3, 4, 5, 9]);
  engine.dispatch("actions", { action: "toggle" });
  expect(engine.layout(500).popup.target).toBe("actions");
  expect(engine.dispatch("clearSelection").state.selectedIds).toEqual([]);
  expect(engine.layout(500).popup).toBeNull();
  engine.dispatch("views", { action: "tab", value: 2 });
  engine.dispatch("tabMemo", { value: "入力を保持" });
  engine.dispatch("views", { action: "tab", value: 1 });
  engine.dispatch("categories", { action: "toggle", id: "orders" });
  expect(() => engine.dispatch("categories", { action: "select", id: "shipped" })).toThrow(
    /hidden/,
  );
  engine.dispatch("categories", { action: "toggle", id: "orders" });
  const tree = engine.dispatch("categories", { action: "select", id: "shipped" });
  expect(tree.state.query).toBe("出荷済");
  expect(tree.state.activeView).toBe(0);
  expect(engine.dispatch("views", { action: "tab", value: 2 }).state.memo).toBe("入力を保持");
});
it("validates row identities and column contracts, and preserves an old screen after a bad replacement", () => {
  engine.load(package_, script);
  const bad = structuredClone(package_);
  bad.ui.items[2].items[0].items[1].columns[1].editor.xtype = "unsupported";
  expect(() => engine.load(bad, script)).toThrow(/editor/);
  const broken =
    script + "\nfn fail(state,event) { state.records[0].id=state.records[1].id; state }";
  const invalid = structuredClone(package_);
  invalid.ui.items.push({ xtype: "button", itemId: "fail", handler: "fail" });
  engine.load(invalid, broken);
  expect(() => engine.dispatch("fail")).toThrow(/unique/);
  expect(cells("id")[0].payload.id).toBe(1);
  const readOnly = structuredClone(package_);
  readOnly.ui.items[2].items[0].items[1].readOnly = true;
  engine.load(readOnly, script);
  expect(() =>
    engine.dispatch("inventory", { action: "beginEdit", id: 1, column: "customer" }),
  ).toThrow(/read-only/);
});
