// Bundled package identities; independent of renderer and WebMCP registration.
export const SCREEN_CATALOG = Object.freeze(
  [
    { id: "orders", title: "受注管理" },
    { id: "tasks", title: "タスク管理" },
    { id: "hello-world", title: "Hello World・はじめての画面" },
    { id: "dynamic-tabs", title: "動的タブ追加・Rhaiから部品を作る" },
    { id: "http-grid", title: "HTTP JSON・グリッドへ表示" },
    { id: "native-extensions", title: "Rust拡張・正規表現" },
    { id: "storage-lab", title: "保存・型・YAML", file: "storage-lab.yaml" },
    { id: "file-lab", title: "OPFS・ファイル読み書き", file: "file-lab.yaml" },
    { id: "rpc-lab", title: "Protobuf・Unary RPC", file: "rpc-lab.yaml" },
    { id: "components", title: "パネル・ウィンドウ" },
    { id: "uivolve-forms", title: "uivolve フォーム部品" },
    { id: "grid-lab", title: "Grid・タブ・ツリー・メニュー" },
    { id: "uivolve-gallery", title: "uivolve コンポーネントギャラリー" },
    { id: "layout-lab", title: "Grid・Card・Border レイアウト" },
  ].map(Object.freeze),
);
export function screenFile(id) {
  const entry = SCREEN_CATALOG.find((screen) => screen.id === id);
  if (!entry) throw new Error(`未知の画面です: ${id}`);
  return entry.file || `${id}.json`;
}
