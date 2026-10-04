// Bundled package identities; independent of renderer and WebMCP registration.
export const SCREEN_CATEGORIES = Object.freeze(
  [
    { id: "start", title: "はじめに" },
    { id: "widgets", title: "フォーム・部品" },
    { id: "layout", title: "レイアウト・画面構成" },
    { id: "network", title: "通信・Rust拡張" },
    { id: "storage", title: "データ保存" },
    { id: "apps", title: "アプリケーション例" },
  ].map(Object.freeze),
);
export const SCREEN_CATALOG = Object.freeze(
  [
    {
      id: "hello-world",
      title: "Hello World・はじめての画面",
      label: "Hello World",
      category: "start",
      description: "入力・ボタン・Rhaiの最小例",
    },
    {
      id: "dynamic-tabs",
      title: "動的タブ追加・Rhaiから部品を作る",
      label: "動的タブ追加",
      category: "start",
      description: "Rhaiからタブと入力部品を追加",
    },
    {
      id: "page-navigation",
      title: "画面遷移・画面A",
      label: "画面遷移 · 画面A",
      category: "start",
      description: "ボタンから別のYAML・Rhaiを取得して切り替え",
      file: "page-navigation.yaml",
    },
    {
      id: "page-navigation-detail",
      title: "画面遷移・画面B",
      label: "画面遷移 · 画面B",
      category: "start",
      description: "遷移先の画面と、画面Aへの戻り操作",
      file: "page-navigation-detail.yaml",
    },
    {
      id: "uivolve-forms",
      title: "uivolve フォーム部品",
      label: "フォーム部品",
      category: "widgets",
      description: "入力・選択・チェック・進捗表示",
    },
    {
      id: "dialogs",
      title: "ダイアログ",
      category: "widgets",
      description: "alert・confirm・promptとアイコン",
      file: "dialogs.yaml",
    },
    {
      id: "uivolve-gallery",
      title: "uivolve コンポーネントギャラリー",
      label: "コンポーネントギャラリー",
      category: "widgets",
      description: "図表・エディター・メディアなど",
    },
    {
      id: "components",
      title: "パネル・ウィンドウ",
      category: "layout",
      description: "折りたたみ・編集・重ねたウィンドウ",
    },
    {
      id: "layout-lab",
      title: "Grid・Card・Border レイアウト",
      label: "Grid・Card・Border・Fit",
      category: "layout",
      description: "配置・画面切り替え・余白を比較",
    },
    {
      id: "grid-lab",
      title: "Grid・タブ・ツリー・メニュー",
      category: "layout",
      description: "一覧の検索・ソート・ページ切り替え・編集",
    },
    {
      id: "http-grid",
      title: "HTTP JSON・グリッドへ表示",
      label: "HTTP JSON → Grid",
      category: "network",
      description: "ボタンからJSONを取得して一覧表示",
    },
    {
      id: "rpc-lab",
      title: "Protobuf・Unary RPC",
      category: "network",
      description: "Connect / gRPC-Web（別サーバーが必要）",
      file: "rpc-lab.yaml",
    },
    {
      id: "money-lab",
      title: "金額・税・丸め計算",
      category: "network",
      description: "小数文字列で金額・税額・負数端数を計算",
      file: "money-lab.yaml",
    },
    {
      id: "text-lab",
      title: "文字列・正規化・書記素",
      category: "network",
      description: "全角・半角の検索用正規化と絵文字の切り詰め",
      file: "text-lab.yaml",
    },
    {
      id: "date-lab",
      title: "日付・時計・期限計算",
      category: "network",
      description: "日付の検証・期限・月末計算とホストの時計",
      file: "date-lab.yaml",
    },
    {
      id: "native-extensions",
      title: "Rust拡張・正規表現",
      category: "network",
      description: "WASM内のRust関数で検索・置換・集計",
    },
    {
      id: "storage-lab",
      title: "保存・型・YAML",
      category: "storage",
      description: "IndexedDB / OPFSとstateの型チェック",
      file: "storage-lab.yaml",
    },
    {
      id: "file-lab",
      title: "OPFS・ファイル読み書き",
      category: "storage",
      description: "テキスト・バイナリ・フォルダー操作",
      file: "file-lab.yaml",
    },
    {
      id: "orders",
      title: "受注管理",
      category: "apps",
      description: "受注検索・行選択・顧客情報の編集",
    },
    {
      id: "worker-orders",
      title: "受注管理・Worker API",
      category: "apps",
      description: "サーバー不要の一覧・登録・更新・削除と日付・金額計算",
      file: "worker-orders.yaml",
    },
    {
      id: "kanban",
      title: "KANBAN・ドラッグ＆ドロップ",
      label: "KANBAN",
      category: "apps",
      description: "カードの列移動・並べ替えとRhaiによる移動検証",
      file: "kanban.yaml",
    },
    {
      id: "tasks",
      title: "タスク管理",
      category: "apps",
      description: "タスクの追加と完了状態の切り替え",
    },
  ].map(Object.freeze),
);
export function screenFile(id) {
  const entry = SCREEN_CATALOG.find((screen) => screen.id === id);
  if (!entry) throw new Error(`未知の画面です: ${id}`);
  return entry.file || `${id}.json`;
}
