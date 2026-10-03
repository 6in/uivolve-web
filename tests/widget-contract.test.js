import { expect, it } from "vite-plus/test";
import {
  isButton,
  isField,
  isEditor,
  isInteractive,
  isBlocked,
  widgetActions,
} from "../src/widget-contract.js";
import { SCREEN_CATALOG, SCREEN_CATEGORIES, screenFile } from "../src/screen-catalog.js";
import { parsePackage, packageFormat } from "../src/package-format.js";
import { SCREEN_CATALOG as legacyCatalog } from "../src/webmcp.js";
import { fieldKinds as legacyFields } from "../src/field-control.js";
import { readFile } from "node:fs/promises";

const widget = (kind, config = {}, extra = {}) => ({
  kind,
  config,
  disabled: false,
  layer: 0,
  payload: {},
  ...extra,
});
it("distinguishes physical controls, read-only focus, semantic Card actions and display widgets", () => {
  const field = widget("textfield", { readOnly: true });
  expect(isField(field)).toBe(true);
  expect(isEditor(field)).toBe(true);
  expect(isInteractive(field)).toBe(true);
  expect(isBlocked(field, {})).toBe(true);
  const card = widget("card", {}, { payload: { action: "card" } });
  expect(isInteractive(card)).toBe(false);
  expect(isButton(card)).toBe(false);
  expect(widgetActions(card)).toEqual(["card"]);
  for (const kind of ["label", "displayfield", "panel", "grid-shell", "figure", "unknown"]) {
    expect(isInteractive(widget(kind))).toBe(false);
    expect(widgetActions(widget(kind))).toEqual([]);
  }
});
it("preserves Grid editor and menu actions while enforcing disabled/modal guards", () => {
  expect(
    widgetActions(widget("grid-cell", { editable: true }, { payload: { action: "select" } })),
  ).toEqual(["select", "beginEdit"]);
  expect(
    widgetActions(widget("textfield", { gridEditor: true }, { payload: { action: "draft" } })),
  ).toEqual(["draft", "commitEdit", "cancelEdit"]);
  expect(widgetActions(widget("menu-trigger", {}, { payload: { action: "toggle" } }))).toEqual([
    "toggle",
    "close",
  ]);
  const button = widget("button", {}, { disabled: true });
  expect(isInteractive(button)).toBe(false);
  expect(isBlocked(button, {})).toBe(true);
  expect(isBlocked(widget("button"), { modal: { layer: 1 } })).toBe(true);
  expect(isBlocked(widget("button", {}, { layer: 1 }), { modal: { layer: 1 } })).toBe(false);
  expect(isEditor(widget("checkbox"))).toBe(false);
  expect(isEditor(widget("slider"))).toBe(false);
  expect(legacyFields).toContain("textfield");
});
it("keeps catalog identities compatible and resolves every bundled package and script", async () => {
  expect(legacyCatalog).toBe(SCREEN_CATALOG);
  expect(new Set(SCREEN_CATALOG.map((s) => s.id)).size).toBe(SCREEN_CATALOG.length);
  const categories = new Set(SCREEN_CATEGORIES.map((category) => category.id));
  for (const { id, title, category, description } of SCREEN_CATALOG) {
    const url = new URL(`../public/screens/${screenFile(id)}`, import.meta.url);
    const screen = parsePackage(await readFile(url, "utf8"), packageFormat(url));
    expect(screen.id).toBe(id);
    expect(screen.title).toBe(title);
    expect(categories.has(category)).toBe(true);
    expect(description).toBeTruthy();
    expect(await readFile(new URL(screen.script, url), "utf8")).toContain("fn init");
  }
  for (const category of categories)
    expect(SCREEN_CATALOG.some((screen) => screen.category === category)).toBe(true);
});
