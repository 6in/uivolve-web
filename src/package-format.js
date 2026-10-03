import { isAlias, isMap, parseDocument, stringify, visit } from "yaml";

export function packageFormat(url) {
  return /\.ya?ml$/i.test(new URL(url, "https://example.test/").pathname) ? "yaml" : "json";
}
export function parsePackage(text, format = "json") {
  if (new TextEncoder().encode(text).length > 1_000_000)
    throw new Error("画面定義が1 MBを超えています");
  let value;
  if (format === "json") value = JSON.parse(text);
  else if (format === "yaml") {
    const doc = parseDocument(text, {
      version: "1.2",
      schema: "core",
      uniqueKeys: true,
      merge: false,
    });
    if (doc.errors.length || doc.warnings.length)
      throw new Error(`YAML: ${(doc.errors[0] || doc.warnings[0]).message}`);
    visit(doc, (_, node) => {
      if (isAlias(node)) throw new Error("YAMLエイリアスは未対応です");
      if (isMap(node) && node.items.some((pair) => typeof pair.key?.value !== "string"))
        throw new Error("YAMLのキーは文字列で指定してください");
      if (node?.tag) throw new Error("YAMLタグは未対応です");
    });
    value = doc.toJS({ maxAliasCount: 0 });
  } else throw new Error("画面定義はJSONまたはYAMLを指定してください");
  let count = 0;
  const validate = (value, depth) => {
    if (depth > 64 || ++count > 32_000) throw new Error("画面定義が複雑すぎます");
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("有限の数値を指定してください");
    if (value && typeof value === "object")
      for (const child of Object.values(value)) validate(child, depth + 1);
  };
  validate(value, 0);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("画面定義はオブジェクトで指定してください");
  return value;
}
export function stringifyPackage(value, format = "json") {
  return format === "yaml"
    ? stringify(value, { aliasDuplicateObjects: false })
    : JSON.stringify(value, null, 2);
}
