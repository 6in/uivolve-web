# REQUIREMENTS — 段階 6: WebMCP の合成（子の webmcp を画面 1 登録へまとめる）

状態: discuss 完了（2026-10-10）。research から無人ループで進める。前提は PR #4（component-loader、段階 5）がマージ済みの main。

## 背景（事実。discuss で調査済み）

- WebMCP は `src/webmcp.js` → `src/ui-tools.js` の 5 ツール（`ui_list_screens` / `ui_get_screen` / `ui_get_state` / `ui_dispatch` / `ui_load_screen`）を `document.modelContext.registerTool` で **画面 1 登録**している（`registerUiTools`）。契約は `docs/webmcp.md`、記述の上限は `docs/platform-features.md`「WebMCP の記述」（label 160 バイト / description 2,000 バイト / tags 8 件・各 1〜80 バイト・重複なし。`engine/src/metadata.rs`）。
- 子 Instance のウィジェットは**既に** Scene に接頭辞付き key（`"<componentノードのitemId>/<子のitemId>"`、`engine/src/composition.rs` の `prefix_widgets`）で出ており、`ui_get_screen.widgets[]` に並び、`ui_dispatch` は接頭辞付き key をそのまま `Runtime::dispatch` へ渡せる。
- 未実装は 2 点。(1) **子ノード（部品）単位の `webmcp`**: `Scene` 生成（`engine/src/lib.rs` の `find_path(&self.root.ui, …)`）が root の UI 木しか探さないので、子ノードの `webmcp` は `Node::webmcp.validate()` で検証はされるが `widgets[].metadata.webmcp` に出ない。(2) **子パッケージ直下の `webmcp`**: `composition::reject_effect_declarations` が `webmcp is not available in components (reserved for a later stage)` で load を拒否する（probe 列 `child-webmcp-refused`、`engine/src/composition_tests.rs:713`）。
- `Scene.webmcp` は root パッケージの `webmcp` で、`src/runtime.js` の `snapshot()` が `screen.webmcp` に載せる。
- 子 Instance の state は WASM 応答（`engine/src/abi.rs` の `result()` = root の `state_json()` + `revision` + `effects`）に含まれない。`ui_get_state` は `snapshot.state`（root）だけを読む。
- デモ: `public/screens/parts-lab.json`（子 `products` → `http-grid.json`、`note` → `parts/note-pad.json`、`approval` → `parts/approval.json`）、`public/screens/order-dashboard.json`（子 `parts/order-list.json` を 2 か所）。どの子パッケージも `webmcp` を宣言していない。
- 前回（段階 5）VERIFICATION の残留リスク 3・5 は既存バグ: `screen.id` 非文字列 / `rpc` の値 `null` で `TypeError`（`parsePackage`）、OPFS の `current.json` が `null` だと `save` が毎回 `TypeError`。

## 用語集

| 用語                  | 意味                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| instance              | 接頭辞付き itemId（`"note"` / `"outer/inner"`）。Instance の識別パス。root は空文字列                      |
| 部品の webmcp         | UI ノード（widget）に書く `webmcp: {label, description, tags}`。`widgets[].metadata.webmcp` に出る         |
| パッケージの webmcp   | パッケージ直下（トップレベル）の `webmcp`。root のものは `screen.webmcp`                                   |
| 子パッケージの webmcp | 子パッケージ直下の `webmcp`。本マイルストーンで受け入れ、`ui_get_screen.components[]` に instance 別で出す |
| 画面 1 登録           | WebMCP のツール登録は画面（root）で 1 回。子ごとにツールを登録しない                                       |

## スコープ内（WHAT）

### R0. 前回残留リスクの小バグ 2 件（最初のテストタスク）

- `parsePackage`（`src/application-loader.js` 側）で `screen.id` を文字列に限定し、`rpc` の各値を object に限定する。違反は既存の日本語契約文言の体系で拒否し、`TypeError` を出さない。
- OPFS の `current.json` が `null`（または object でない）のとき、`restore` / `save` が `TypeError` を出さず、`restore` と同じ扱い（保存版なしとして処理を続ける）にする。
- どちらも plan が T1 相当の最初のテストタスクに置く（回帰テスト付き）。

### R0b. 前回残留リスク 1: `network-only` の宣言件数上限

- 1 パッケージの `components` 宣言は **8 件まで**（Rust の「画面あたり Instance 8（root 含む）」と同じ数）。ローダー（`src/application-loader.js` の `#walk`。`network-only` / `network-first` / 復元の全経路）と生成スクリプト（`scripts/publish-packages.mjs`）の両方で、取得・列挙の**前に**検査する。
- 超過は既存の日本語契約文言の体系で拒否し、`docs/files-cache-rpc.md` と `docs/components.md`「エラー文言」節に文言を列挙する。

### R0c. 前回残留リスク 10: `manifest()` の基準統一

- `src/application-loader.js` の `manifest()` に画面 URL を渡し、子キーの重複判定と 2 MB 超過文言の「最大の子」の表示を**画面 URL 基準**に統一する（配信ファイルの `url` だけ sidecar 基準で解決する）。`#childIndex` と同じ基準になる。
- 通常の相対キーでは既存の挙動（受け入れ / 拒否 / 文言）が変わらないことを回帰テストで押さえる。画面 URL 基準でだけ衝突するキー（`""` + `parent.json` 等）は `マニフェストのコンポーネント情報が不正です` の重複として拒否する。

### R1. 部品（子ノード）の webmcp の合成

- 子 Instance 内の UI ノードに書いた `webmcp` を、Scene 生成時にその widget の `config.webmcp` に載せ、`ui_get_screen.widgets[].metadata.webmcp` に出す。入れ子（深さ 3）の子でも同じ。
- 上限・検証は root と同じ（`metadata::Metadata::validate`。既に子ノードにも掛かっている）。
- 同じ子パッケージを 2 か所に置いたとき、両方の widget が同じ `metadata.webmcp` を持ち、接頭辞付き key だけが配置を区別する。

### R2. 子パッケージの webmcp の受け入れと公開

- `webmcp is not available in components (reserved for a later stage)` の拒否を無くす。子パッケージ直下の `webmcp` は root と同じ上限で検証する。
- `ui_get_screen` の応答に `components: [{ instance, id, title, webmcp, hidden }]` を足す（`webmcp` は宣言が空なら省略）。順序は instance の辞書順。子の無い画面は `components: []`。
- **非表示の子も一覧に含める**: 親の `visibleBind` が false で widgets が出ない Instance（`engine/src/lib.rs` の `hidden_component` と同じ判定。祖先が非表示なら子孫も非表示）は `hidden: true`。表示中は `hidden: false`。load 済みの全 Instance が並ぶ。
- 一覧の出所は WASM（`Scene` に `components` を足す）。JS 側で推測しない。
- `screen.webmcp` は root のものだけ。子の tags を root へ混ぜない。
- 子パッケージの webmcp 一覧は説明情報であり、共通ツールの許可 action・入力 schema・認可を変えない（既存の契約と同じ）。

### R2b. デモ画面

- `public/screens/parts/note-pad.json` / `parts/approval.json` / `parts/order-list.json` にパッケージ直下の `webmcp` と主な部品の `webmcp` を足す（order-list は order-dashboard の 2 か所配置で同じ metadata が 2 つの instance に出る例になる）。
- 配信マニフェスト（`*.manifest.json`）は `bun run build:wasm` / `publish:packages` で再生成する（revision が変わる）。

### R3. 据え置き（変えないこと）

- `ui_get_state` / `stateKeys` / `stateSchema` は root の state だけ。子 Instance の state は読めない（widgets[].value で見る）。
- ツールの数（5）と登録単位（画面 1 登録）は変えない。子ごとのツール登録はしない。
- `ui_dispatch` の契約（接頭辞付き key をそのまま渡す）は変えない。
- `widgets[]` の形は変えない（`instance` フィールドは足さない）。所属 Instance は key の接頭辞で読む。`components[].instance` と key の接頭辞の突き合わせ規則を `docs/webmcp.md` に書く。

### R4. 堅牢性

- どの入力・ツール引数・画面状態（子あり / なし / 非表示の子 / 2 か所に置いた子 / 再 load 直後）でもトレースバック（未捕捉例外）を出さず、既存の画面・state・revision を失わない。ツールの失敗は `{ok:false, error:{code, message}}` で返す。

## 受け入れ基準

1. 子ノードの `webmcp` が `ui_get_screen.widgets[].metadata.webmcp` に出る（parts-lab の深さ 1、入れ子の深さ 2 以上のケースを自動テストで押さえる）。
2. 子パッケージ直下の `webmcp` を持つ木が load でき、`ui_get_screen.components[]` に instance 別で出る。上限超過は root と同じ文言で拒否される。
3. `ui_get_screen.screen.webmcp` は root のものだけで、子の宣言で変わらない。
4. `ui_get_state` / `stateKeys` は root state のままで、子の state は出ない（回帰）。
5. probe（`scripts/probe-composition.mjs`）の `child-webmcp-refused` 列を受け入れ列に置き換え、`target/engine-compare/composition.json` を再生成して照合が通る。
6. R0 の 2 件に回帰テストがあり、`TypeError` が出ない。R0b の 9 件目の宣言がローダーと生成スクリプトの両方で拒否され、8 件は通る。R0c で通常の相対キーの既存テストが変わらず通り、画面 URL 基準でだけ衝突するキーが重複として拒否される。
   6b. 非表示の子が `components[]` に `hidden: true` で出て、表示に切り替わると `hidden: false` になり widgets が出る。
7. 契約文書（`docs/components.md` の「段階6以降の課題」「エラー文言」「子の `webmcp`」、`docs/webmcp.md`、`docs/platform-features.md`、`docs/components-plan.md` 段階計画、`docs/ai-development.md`）が実装と一致する。`reserved for a later stage` の文言が `src/ engine/ docs/ scripts/ tests/` に残らない。
8. R4 の堅牢性基準を満たす。
9. `bun run check`（lint / fmt）、Vitest、`cargo test`、`bun run build:wasm` が green。

## スコープ外

- `widgets[].instance` の追加（key の接頭辞で足りる）。
- 前回残留リスクのうち 2 / 4 / 6 / 7 / 8 / 9（仕様または設計として文書化済み）。
- 子 Instance の state / stateSchema の WebMCP 公開（R3）。
- 子ごとの専用ツール登録、DSL からの専用ツール宣言、外部 MCP サーバー、クロスオリジン公開（`docs/webmcp.md`「次の拡張点」のまま）。
- 子の `window`（モーダル層の親子共有）。
- WebMCP 有効 Chromium での実機確認（自動テスト + probe 照合で受け入れる）。
