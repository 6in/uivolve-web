# 画面パッケージの部品化に向けた Instance 分離

## 目的

画面パッケージ（JSON/YAML + Rhai）を ExtJS のカスタムコンポーネントのように親画面の `xtype` として組み込める仕組み（エンジン内合成）に向けて、(1) 設計文書を固定し、(2) `Runtime` を `Instance` の木へ切り出す挙動を変えないリファクタを行う。合成機能そのものは実装しない。
マイルストーン: `component-instance-refactor`。

## 背景（discuss で確認した現状）

- `engine/src/abi.rs` は `RUNTIME: RefCell<Option<Runtime>>` の単一スロット。`load` が置換する。
- `engine/src/lib.rs` の `Runtime` は `package / ui / functions / engine / extension_context / ast / state / http / host / storage / files / rpc / dialogs / pages / revision` を 1 構造体で持つ（L362-378）。`load_with_clock`（cc=77）と `dispatch`（cc=53）がこれらを横断する。
- `dynamic_ui.rs` は tabpanel の `itemsBind` を state の部品定義から展開する「テンプレート → 確定ツリー」の前例。
- `bind` は state オブジェクトの最上位キー（`dispatch` が `state.as_object_mut().insert(node.bind, …)`）。子パッケージを同じ state に平坦化するには接頭辞の書き換えが要るため、Instance ごとに state を持つ方式を採る。
- 既存の非同期契約（http / host / storage / files / rpc / dialog / navigate）は「Rhai が依頼をキューに積む → state 確定後に effects → 完了 op で handler」。

## 要求

### R1. 設計文書 `docs/components-plan.md`

- `platform-features-plan.md` と同じ「検討記録」の位置づけ。現行契約の根拠にはしない旨を冒頭に記す。合成が実装された段階で契約文書 `components.md` を別に起こす。
- 内容:
  - 使い方: 親の `components` 宣言（名前 → `url`）、`xtype` に宣言名を書いて参照、ノードの `config`（親 → 子。固定値または親 state への `bind`）と `listeners`（子の `emit` 名 → 親 handler）、子 Rhai の `emit(name, payload)` と任意の `config(state, config)` handler、`state.config` への注入。
  - Instance 木の構造: `Runtime { root: Instance, components: HashMap<itemId, Instance> }`。Scene は 1 つ。target / key は `"<itemId>/<子itemId>"` の接頭辞付き。
  - 決定事項の表（本文書「設計決定」節と同じ内容）。
  - 段階計画: 段階 3（同期のみの合成: component ノードのレイアウト + dispatch ルーティング + `emit` / `config`。子の非同期効果は禁止）、段階 4（効果の instance ルーティング）、段階 5（ローダーの再帰取得・キャッシュ・2MB 上限の扱い）、段階 6（WebMCP・契約文書・デモ）。
  - 本マイルストーン（段階 1・2）で確定した Instance のフィールド一覧。
- `docs/README.md` の表へ 1 行追加。`docs/architecture.md` の責務表へ `engine/src/instance.rs` を 1 行追加。
- `bun run docs:check` を通す。

### R2. `Runtime` → `Instance` の挙動不変リファクタ

- `engine/src/instance.rs` を新設し、`Instance` に `package / ui / functions / engine / extension_context / ast / state / http / host / storage / files / rpc` を移す。
- `Runtime` に残すもの（root 共通物）: `revision`、`dialogs`（ページ全体モーダル方針と整合）、`pages`（navigate）、`root: Instance`。`components` の HashMap は本マイルストーンでは追加しない（root のみ）。
- `load_with_clock` / `dispatch` / `commit_state` / `layout` / `measure` / `arrange*` / `complete_*` / `take_effects` / `state_json` が Instance を経由する。
- 公開シグネチャ（`Runtime::load` / `load_with_extensions` / `load_with_descriptors` / `load_with_clock` / `with_clock` / `dispatch` / `progress_host` / `complete_*` / `take_effects` / `state_json` / `layout`）は維持。`lib.rs` 内の既存テスト 4 本は無改修で通す。
- `abi.rs` は Instance 参照の差し替えのみ。op 名・入出力 JSON・エラーメッセージ文字列に差分なし。
- `*::Requests`（http / host / storage / files / rpc / dialogs / pages）は Instance / Runtime のフィールドへ移すだけで内部は変えない。
- 制限値（script 100KB、入力 2MB、Rhai の各上限、node 200 / 深さ 20、descriptors 8 等）は変えない。
- JS 側（`src/`）は変更しない。

## 受け入れ基準

1. `bun run test` / `bun run build` / `bun run check` / `bun run docs:check` が green。既存テストの期待値変更は 0 件、既存テストファイルの変更も 0 件。
2. 挙動不変の照合（堅牢性）: 既存の全画面パッケージ（`public/screens/` の全 JSON/YAML + Rhai）と、テストが使う定義について、`load` → 代表 `event`（各画面の handler を持つ部品） → `layout`（幅 240 / 800 / 4096）→ 各 `*_result` の代表ケースの応答 JSON（`ok` / `data.state` / `data.revision` / `data.effects` / Scene）が main のビルドと一致し、panic・trap が起きない。照合は WASM を 2 つ（main のビルドとリファクタ後）起こして同一リクエスト列を流す Node スクリプトで行い、結果の差分 0 を証跡として残す。差分がある場合は理由付きで列挙し、意図しない差分は差し戻し対象。`public/engine.wasm` は gitignore 対象なので、main 側は base コミット（`branch.base` の HEAD）を `git worktree` 等で取り出してビルドし、スクラッチ領域に置く。照合スクリプトは `scripts/` に置き、変異表（意図的に応答を 1 か所変えたビルドで差分が非 0 になること）を 1 件以上含める。
3. `tests/abi.test.js` が無改修で通り、`abi.rs` の op 名・応答形式に差分がない。
4. `Runtime` の公開シグネチャに差分がない（`lib.rs` 内テスト 4 本が無改修で通る）。
5. `docs/components-plan.md` の決定表・Instance フィールド一覧と、`instance.rs` / `lib.rs` の実際の構造が一致する（verify が照合）。
6. `engine/src/instance.rs` と `lib.rs` の分割後、`lib.rs` の `load_with_clock` / `dispatch` が Instance 境界をまたぐコード（2 段以上の Instance 木を前提とする分岐）を含まない。

## スコープ外

- `components` 宣言のパース・検証、component ノードのレイアウト・イベントルーティング、`emit` / `config`、子パッケージのローダー再帰取得、effects の instance ルーティング、WebMCP の合成、デモ画面、契約文書 `components.md`。
- `abi.rs` のマルチスロット化（1 インスタンス複数 Runtime）、複数 WASM インスタンスのワークスペース管理。
- JS 側の変更、画面 DSL の変更、制限値の変更、性能改善。
- ループやスキルの改修。

## 用語

- 画面パッケージ: 画面定義（JSON/YAML）と Rhai スクリプトの組。既存の `Package`。
- 部品（コンポーネント）: 親画面の `components` で宣言し `xtype` で参照する画面パッケージ。本マイルストーンでは文書上の概念のみ。
- Instance: 1 つの画面パッケージに対応する実行単位（package / ui / AST / state / 各依頼キュー）。
- root: 親画面の Instance。本マイルストーンでは唯一の Instance。
- Runtime: ABI のスロットに入る実行主体。root Instance と root 共通物（revision / dialogs / pages）を持つ。
- 挙動不変: 同じリクエスト列に対して ABI の応答 JSON が main と一致すること。
