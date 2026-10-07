# PLAN — component-composition

- 作成: 2026-10-07 / gsd-lite-plan（turn 2）
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md / `.gsd-lite/reflect/` 直近 2 件 / 本ターンのプローブ `.gsd-lite/logs/component-composition/scratch/turn-002-sequences-probe.mjs`（base WASM `target/engine-compare/base-ef582d5.wasm` へ流した結果。§「決めた事項」8）

## 検証コマンド

impl の各ターンがテストに使うコマンド（対象リポジトリのルート `.` で実行）:

```bash
bun run build:wasm                 # Rust を触ったら必ず先に（Vitest は public/engine.wasm を直接読む）
bunx vp test run                   # Vitest 全体（tests/**/*.test.js）
bunx vp test run tests/<file>      # 1 ファイルだけ
bun run test:rust                  # cargo test --manifest-path engine/Cargo.toml
bun run check                      # vp check + cargo fmt --check
bun run docs:check                 # Markdown のローカルリンク
bun scripts/compare-engine-behavior.mjs --base target/engine-compare/base-ef582d5.wasm --candidate public/engine.wasm   # 差分 0 で exit 0（約 1 秒）
```

- 環境の初期化（テストの前に毎回）: なし。base WASM `target/engine-compare/base-ef582d5.wasm` が無ければ 1 回だけ `bun scripts/build-engine-variant.mjs --commit main --out target/engine-compare/base-ef582d5.wasm`（`main` = `ef582d5`。`git rev-parse --short main` で確認。約 35 秒。`target/` は gitignore）
- 整形: 変更した Markdown / JS は `bunx vp fmt <path>`、Rust は `cargo fmt --manifest-path engine/Cargo.toml`。コミット前に `bun run check`
- 最終判定（クリーンな状態から全検査。verify と T12 が使う）: `bun scripts/verify-instance-refactor.mjs`（T10 で候補のみ列と変異 M4 / M5 を組み込んだ後の形。既存 6 検査 → base 照合 差分 0 → 候補のみ probe exit 0 → 変異 M1〜M3 の照合 exit 1 → 変異 M4 / M5 の probe exit 1）

## 追従先チェックリスト

| 変更の種類                                                           | 直す場所                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 確かめ方                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 画面カタログに 1 件足す（`order-dashboard`）                         | `src/screen-catalog.js`（22 → 23 件）。`README.md:25`「21画面」と `README.md:110`「12画面」は既に古い値なので「23画面」に直す。`tests/widget-contract.test.js:59-74` / `tests/distribution.test.js:68-86` は自動で追従。`bun run build:wasm` が manifest を生成（`scripts/build.mjs:11-12`）                                                                                                                                                                               | `rg -n '21画面\|12画面\|22画面' README.md docs` が 0 件。`bunx vp test run tests/widget-contract.test.js tests/distribution.test.js` green |
| Package / Node の属性を足す（`components` / `config` / `listeners`） | `docs/screen-format.md:5`（トップレベル任意属性の列挙）、`:74`（対応属性・未知属性・`itemId` の予約文字）。契約の本文は新設 `docs/components.md` に置き、screen-format からリンク                                                                                                                                                                                                                                                                                          | `rg -n 'components' docs/screen-format.md` が 2 件以上。`bun run docs:check` green                                                         |
| ABI `load` 入力を広げる（`request.components`）                      | `docs/architecture.md:84`（操作と入力上限の段落）、`docs/architecture.md:60-68`（Instance 木）、`docs/components.md`（ABI 節）                                                                                                                                                                                                                                                                                                                                             | `rg -n 'request.components\|components' docs/architecture.md` が 1 件以上                                                                  |
| 文書を新設する（`docs/components.md`）                               | `docs/README.md:28` の行を「設計を知る → components-plan.md」から「組み込む → components.md、検討記録 → components-plan.md」へ。`docs/components-plan.md:3` の「状態:」行に段階 3 完了と `components.md` への参照                                                                                                                                                                                                                                                          | `bun run docs:check` green。`rg -n 'components.md' docs/README.md docs/components-plan.md` が各 1 件以上                                   |
| 照合スクリプトの列を増やす・候補のみ probe を足す                    | `docs/testing.md:85`（照合の段落: `handlerNodes` の走査範囲、新列 3 本、`components` 画面の除外、候補のみ証跡 `target/engine-compare/composition.json`、verify の手順と変異 5 本）。`scripts/verify-instance-refactor.mjs:1-6` のヘッダコメント                                                                                                                                                                                                                            | `rg -n 'composition.json' docs/testing.md scripts/verify-instance-refactor.mjs` が各 1 件以上                                              |
| テストファイルを足す                                                 | `docs/testing.md:25-41` の表に `tests/components-loader.test.js` / `tests/components-demo.test.js` / `engine/src/composition_tests.rs` の行                                                                                                                                                                                                                                                                                                                                | `rg -n 'components-loader\|components-demo\|composition_tests' docs/testing.md` が 3 件                                                    |
| Rhai の feature を足す（`internals`）                                | `engine/Cargo.toml:10-16`。版固定の注意を `docs/components.md` の制限節に 1 行（RESEARCH §3: `internals` の API は安定性の明記なし）                                                                                                                                                                                                                                                                                                                                       | `rg -n 'internals' engine/Cargo.toml docs/components.md` が各 1 件                                                                         |
| 子で拒否する効果関数を足す / 減らす                                  | `engine/src/composition.rs` の stub 表（名前 × 引数の数）と load 時走査の禁止名集合。正は `git grep -n register_fn engine/src`（RESEARCH §1.5 の表: `http_get`1 / `host_call`2 / `host_cancel`1 / `storage_read`1 / `storage_remove`1 / `storage_write`2 / `file_read_text`〜`file_remove` 各 2 / `file_write_text` 3 / `file_write_bytes` 3（Blob / FileBytes の 2 overload とも 3 引数）/ `rpc_call`2 / `alert`1・2・3 / `confirm`2・3 / `prompt`2・3・4 / `navigate`1） | `engine/src/composition_tests.rs` の「全関数 × 全 arity」テストが表を列挙し、`register_fn` の grep 件数と突き合わせる（P7）                |
| `validate` の xtype 固定リストの書き方を変える                       | `tests/browser/font-parity.mjs:1073` の正規表現が `lib.rs` から許可リストを読み取っている（`const XTYPES: [&str; <n>] = [...]` の形に追従させる）                                                                                                                                                                                                                                                                                                                          | `bunx vp test run tests/font-parity-runner.test.js` green（読み取れないと throw する）                                                     |
| `handlerNodes` の走査キーを広げる                                    | `scripts/compare-engine-behavior.mjs:152-156`。`tests/browser/font-parity.mjs:1485` の `NODE_CHILD_KEYS` と同じ集合（`items / columns / menu / tbar / bbar / buttons / lanes`）                                                                                                                                                                                                                                                                                            | 両ファイルの集合が一致（目視）。`compare.json` の `steps` が base 照合で増えて差分 0                                                       |
| 変異を足す（M4 / M5）                                                | `scripts/build-engine-variant.mjs:9-31` の `MUTATIONS`、`scripts/verify-instance-refactor.mjs:82-105` の手順生成、`docs/testing.md:85`「変異3本」                                                                                                                                                                                                                                                                                                                          | `rg -n '変異3本\|M1〜M3' docs scripts` が 0 件（「変異5本」「M1〜M5」に揃える）                                                            |

## Tasks

- [x] T1: 照合列の拡張（R9 (a)(b)）と base 証跡
  - 完了基準:
    - `scripts/compare-engine-behavior.mjs` の `handlerNodes`（`:152-156`）が `items / columns / menu / tbar / bbar / buttons / lanes` を走査する（`tests/browser/font-parity.mjs:1485` の `NODE_CHILD_KEYS` と同じ集合）。これで `uivolve-gallery` の `saveAs / saveDraft / sendMessage / clearChat` が baseSteps に入る（プローブ `handlerNodesExtra` の 4 件。他 21 画面と font-parity 4 組は 0 件）
    - `buildPlan()` に次の 3 列を追加（決めた事項 8 の到達条件どおり）: `rpc-result-decodable`（`rpc-lab` load → `connect` → `rpc_result` ok + `@bufbuild/protobuf` で作った `uivolve.demo.EchoResponse` 15 バイト。`scripts/rpc-schema.mjs` の `registry`、`sequenceId: 7n`）、`gallery-menu`（load → `saveSplit-menu` `{action:"toggle"}` → `saveDraft` → layout 800 → `saveSplit-menu` toggle → `saveAs` → layout 800）、`gallery-bbar`（load → `galleryViews` `{action:"tab", value: <「会話」タブの index。pkg から算出>}` → `clearChat` → `chatInput` `{value:"x"}` → `sendMessage` → `sendMessage`（空入力で handler が throw する error 応答も列に残す））
    - `buildPlan()` の最初のループ（`:263-264`）で `pkg.components` が空でない画面は base 照合から除外する分岐がある（P10。T9 以降に効く）
    - `bun scripts/compare-engine-behavior.mjs --base target/engine-compare/base-ef582d5.wasm --candidate public/engine.wasm` が差分 0（現在の作業ツリーは main と同じソース）。`compare.json` の `records` に上記 3 列の label があり、`rpc_result:decodable` / `event:saveDraft`（toggle 後）/ `event:saveAs`（toggle 後）/ `event:clearChat`（tab 後）/ `event:sendMessage`（入力後）が `ok: true`。到達の根拠（revision の増分）は PROGRESS に label 単位で書く（P11）
    - `docs/testing.md:85` の照合段落を列の追加に合わせて更新（文の追加のみ）
  - 対象: `scripts/compare-engine-behavior.mjs`, `docs/testing.md`
  - 依存: なし
  - 並列サブ作業: なし

- [x] T2: 宣言とノード属性のパース・検証（R1 / R2 の `/` 予約 / P1 / P3 / P14）
  - 完了基準:
    - `Package` に `components: BTreeMap<String, composition::Declaration>`（`#[serde(default, skip_serializing_if = "BTreeMap::is_empty")]`。`Declaration { url: String }` は `deny_unknown_fields`）、`Node` に `config: Value`（既定 Null）と `listeners: BTreeMap<String, String>`（既定空）を追加（`lib.rs:32-57, 59-273`。既存 22 画面の JSON は無改修で通る）
    - 新モジュール `engine/src/composition.rs` に `validate_declarations(&Package) -> Result<BTreeSet<String>, String>`: 宣言名は `^[A-Za-z][A-Za-z0-9]{0,39}$`、`url` は空でなく 2048 バイト以下、衝突判定は「`validate` の固定リスト 48 件（`lib.rs:1020-1069`。`const XTYPES` に切り出す）に含まれる」または「`xtype` に宣言名を入れたダミー `Node` へ `fields::normalize(&mut n, "probe")` を通すと `xtype` が変わる / `port_kind` が付く」のいずれかでエラー（一覧を二重管理しない）
    - `validate`（`lib.rs:1009`）が宣言名集合と親 xtype を受け取り、component ノード（xtype ∈ 宣言名）に対して: `itemId` 必須、親は `container / panel / fieldset / window` のいずれか（toolbar / menu / tabpanel 直下・`columns[].editor` は不可）、`config` は Null か object、`config` の値が `{ "bind": "<key>" }`（キーが `bind` 1 つの object）なら `<key>` は空でなくドットを含まない、`visibleBind` はドットを含まない。component ノードには `port_kind = "component"` を付ける（layout / dispatch の判別に使う）
    - component ノードの許可属性は `xtype / itemId / config / listeners / flex / width / visibleBind` のみ。検査は `Instance::load` の `fields::normalize` より前（`instance.rs:54`）に template を `items` 走査して行い、「許可属性だけを写した既定 `Node` と `serde_json::to_value` で一致するか」で判定する（フィールド一覧を列挙しない）。同じ走査で `tbar / bbar / buttons / menu`（`Value`）と `columns[].editor` の中に宣言名の `xtype` があればエラー
    - `validate_handlers`（`lib.rs:1130`）が `node.listeners` の各値も `functions` で検査する（無ければ `"{itemId}: listener {event} references undefined handler: {handler}"`）
    - `itemId` に `/` を含むとエラー（`lib.rs:1080` の `:` 検査の隣に新しい文字列で 1 行。既存の `:` の文言は不変）
    - `dynamic_ui::expand`（`dynamic_ui.rs:42-53`）が itemsBind 由来のノードで「xtype が宣言名」「`config` が Null でない」「`listeners` が空でない」のいずれかならエラー（P3）
    - `Runtime::load_with_clock` は `package.components` が空でなければ本タスクでは `"Component packages were not bundled"` を返す（T4 で置き換える）。既存 `lib.rs` のテスト 4 本は無改修で通る
    - `engine/src/composition_tests.rs`（`lib.rs` に `#[cfg(test)] mod composition_tests;`）: 宣言名の規則違反 / 固定リスト 48 件と別名（`fields.rs:30-45` の 11 件 + `extras.rs:63-74` の 12 件 + port 化する 4 件 `splitbutton / messagebox / codeeditor / htmleditor`）を宣言名にして全部エラー（テストは match 腕の文字列を列挙せず `fields::normalize` の結果で判定する） / 不正属性（`bind` / `handler` / `items` / `layout` / `disabled` の各 1 件 + 列挙外 1 件 `text`） / `itemId` 欠落 / toolbar 直下 / `columns[].editor` / `config` が配列 / `bind` がドット付き / `listeners` の handler 無し / `/` を含む itemId / itemsBind 由来の component xtype（親 handler が `{xtype: "<宣言名>"}` を push → エラー応答で state 不変）
    - `bun scripts/compare-engine-behavior.mjs ...` 差分 0（P2: 既存経路の文字列は追加のみ）
  - 対象: `engine/src/lib.rs`, `engine/src/composition.rs`（新規）, `engine/src/composition_tests.rs`（新規）, `engine/src/dynamic_ui.rs`, `engine/src/instance.rs`
  - 依存: T1
  - 並列サブ作業: なし（`validate` のシグネチャ変更が全ファイルに波及する）

- [x] T3: 子 Instance の実行環境（R5 / R1 子宣言の拒否 / R3 子 window の拒否 / P6 / P7 / P8 / P13 / init 中 emit）
  - 完了基準:
    - `engine/Cargo.toml` の rhai features に `internals` を追加（`--locked` のまま通る）。`bun run build:wasm` が通り、`public/engine.wasm` のサイズ増は +14,142 バイト（内訳は PROGRESS turn 5。feature 単体 ~2,499・`AST::walk` の実体化 3,957・合成コード ~7,686）
    - `Instance::load` が `effects: bool` と `context: &extensions::ExtensionContext` を受け取る（`declared` は自分の `package.components` から作るので引数にしない）。`effects == false`（子）では `http / host / storage / files / rpc` の `register` と `dialogs.register` / `pages.register` を呼ばず、代わりに `composition::register_stubs(&mut engine)` を呼ぶ。stub は追従先チェックリストの表の全関数 × 全 arity を `Dynamic` 引数で登録し、`Err("{name} is not available in components")` を返す（P7）
    - `composition::Emits`（`pages::Requests` と同形: `Rc<RefCell<Vec<(String, Value)>>>`、`register` / `take` / `clear`）。`emit(name: ImmutableString, payload: Dynamic)` は `rhai::serde::from_dynamic` に失敗したら `"emit {name}: payload must be JSON-serializable"`（P15）、9 件目で `"At most 8 emits per handler"`。root（`effects == true`）には登録しない（root の `emit` は Rhai の関数未定義エラー）
    - 子の `init` 後にキューが空でなければ `"emit is only available in event handlers, not init"`（`instance.rs:184-186` と同形）
    - `effects == false` のとき compile 後に `ast.walk` で `ASTNode::Expr(Expr::FnCall | Expr::MethodCall)` / `ASTNode::Stmt(Stmt::FnCall)` の `call.name` を stub 表の名前集合と照合し、最初の一致で `"{fn} is not available in components (line {l}, position {p})"`（P8。`scratch/turn-001-walk-probe.rs:10-21` の形）
    - 子パッケージの `requests / operations / storage / files / rpc / pages / webmcp` が空でなければ `"requests, operations, storage, files, rpc, pages and webmcp are not available in components (reserved for a later stage)"`（`operations` は REQUIREMENTS R1 の列挙外だが `host_call` 拒否と整合するため加える。メモ参照）
    - 子の `validate` 後に ui 全体（`items` 再帰。`collect_windows` と違い state を見ない）を走査し `xtype == "window"`（messagebox 由来の `port_kind == "messagebox"` を含む）があれば `"window is not available in components (reserved for a later stage)"`（P13）
    - `ExtensionContext` は `Runtime::load_with_*` で 1 つ作り、全 Instance に clone を渡す（`extensions/mod.rs:17-20` の `Rc<Cell>` を共有）。`Runtime::with_clock`（`lib.rs:418-425`）は無改修で全 Engine に効く（P6）
    - `composition_tests.rs`: 表の全関数 × 全 arity を子 handler から 1 回ずつ直接呼ぶ script は load 時に落ち、文言に関数名が含まれる / `Fn("<name>").call(...)` は load を通り、event で実行時拒否され文言に関数名と「not available in components」が含まれ state 不変（表の全関数） / `emit("x", Fn("init"))` が event エラー / 9 件の emit がエラー / init 中の emit が load エラー / 子の深さ 3 に `window` と `messagebox` を置いて load エラー / 子の `requests` 等 7 種それぞれで load エラー / 子 handler の `date_today()` が固定 clock の日付（P6）。これらは本タスクでは `Instance::load` を直接呼ぶ（Runtime の木は T4）
    - 照合 差分 0（root の経路は `effects == true` で無変更）
  - 対象: `engine/Cargo.toml`, `engine/src/instance.rs`, `engine/src/composition.rs`, `engine/src/composition_tests.rs`, `engine/src/lib.rs`（`load_with_*` の context 生成）
  - 依存: T2
  - 並列サブ作業: なし

- [x] T4: Runtime の Instance 木と同梱ロード（R2 / R1 の config 注入 / R6 の Rust 側 / P12 の Rust 側）
  - 完了基準:
    - `Runtime` に `components: BTreeMap<String, Instance>`（キー = 接頭辞付き itemId パス `"a"` / `"a/b"`。BTreeMap の理由はメモ）。`pub fn load_with_components(package, script, descriptors, clock, components: HashMap<String, (Package, String)>, register)` を追加し、既存 `load / load_with_extensions / load_with_descriptors / load_with_clock` は空の map でそれを呼ぶ（公開シグネチャ不変。受け入れ基準 6）
    - ロード順: root `Instance::load`（init まで）→ root の template（`package.ui`）を `items` 走査して component ノードを文書順に列挙 → 各ノードで `composition::evaluate_config(node, &parent_state_json)`（`{bind}` は親 state の最上位キー。無ければ `"Component {path}: config bind {key} is not in the parent state"`）→ 同梱本体 `components[decl.url]` を引き（無ければ `"Component {path}: package {url} was not bundled"`）、子 `Package` の `state["config"]` に評価済み config を入れてから子 `Instance::load`（`effects == false`。`init` は `state.config` を読める。`config` handler は呼ばない）→ 子の宣言で再帰（パスは `"a/b"`）
    - 制限: 深さ > 3 で `"Component {path}: nesting depth exceeds 3"`、Instance 総数 > 8（root 含む）で `"At most 8 instances per screen (root included); exceeded at component {path}"`、ロード中スタックに同じ `url` があれば `"Component {path}: circular reference to {url}"`。node 200 / 深さ 20 / script 100KB / state 1MB / Rhai 上限は `Instance::load` が Instance ごとに検査（既存。子の失敗は `"Component {path}: "` を前置）
    - `abi.rs` の `load` が `request.components`（`{ "<url>": { "package": {...}, "script": "..." } }`、8 件まで。超えたら `"At most 8 component packages"`、形が違えば `"Invalid components"`）を `HashMap<String, (Package, String)>` に変換して `load_with_components` へ渡す。既存 op の応答形式・エラー文字列は不変
    - `Runtime::state_json` は root のみ（既存のまま）
    - `composition_tests.rs`: 同じ子を `a` / `b` に置き、`a` の中に `c`（深さ 3）→ `components` のキーが `a` / `a/c` / `b`、各 `state.config` が注入値 / 深さ 4 でエラー / 9 Instance でエラー（8 ちょうどは通る）/ 循環（子が自分の url を宣言）でエラー / 本体未同梱 / `config` の bind 先キーが親 state に無い / 子 script 100,001 バイトでエラー文言に `Component {path}` / 子 node 201 でエラー / どのエラーでも `Runtime::load_with_components` は `Err` を返し（前画面は `abi.rs:39-41` が保つ）panic しない
    - `tests/abi.test.js` に raw ABI で `components` 付き `load` が `ok` になるケースと 9 件で `ok: false` のケースを追加（既存ケースの期待値は不変）
    - 照合 差分 0
  - 対象: `engine/src/lib.rs`, `engine/src/abi.rs`, `engine/src/composition.rs`, `engine/src/composition_tests.rs`, `tests/abi.test.js`
  - 依存: T3
  - 並列サブ作業: なし

- [x] T5: レイアウトの合成（R3 / P4 / P5 / P14）
  - 完了基準:
    - 方式 (H): `composition::LayoutScope`（thread_local `RefCell<Option<Scope>>`、`Scope { instances: BTreeMap<String, (Node, Value)>, stack: Vec<String> }`）とガード。`Runtime::layout` は `self.components` が空でないときだけ各子の `ui` clone と `state_json` でスコープを張る（既存画面はコスト 0）
    - `measure`（`lib.rs:1209`）と `arrange_sized`（`lib.rs:1293`）の先頭に `node.port_kind == "component"` の分岐を 1 つずつ足す。`measure`: `visibleBind` があり親 state で false なら 0、そうでなければ接頭辞を push → 子 `ui` を子 state で `measure` → pop。`arrange_sized`: 同じ条件で子を `arrange_sized(&child.ui, &child.state, x, y, width, "root", allocated_height, widgets)` し、戻ったら `widgets[start..]` の `key` に `"{path}/"` を前置、`target` は空でないものだけ前置（`payload` は触らない）。`Runtime::layout` の `arrange(&self.root.ui, &state, 16.0,` の行（M1 の対象 `build-engine-variant.mjs:13`）は変えない
    - `collect_windows` / `find_path`（webmcp 付与 `lib.rs:957-966`）は無改修（子に window は無く、接頭辞付き target は見つからない = root のみ）
    - `composition_tests.rs`: 親子で同じ itemId `search` を持つ画面の layout で `widgets` の key が全件一意、子の key が `"<itemId>/"` で始まり target も `"<itemId>/search"`（P4）/ 同じ子を `a` / `b` に置き `a` の中に `c` → key に `a/c/` と `b/` が出て、`a` と `b` の state が独立に変わる（P5）/ 子の高さ（grid の行数）が親の vbox の後続ノードの `y` に反映 / `visibleBind` false の component は widgets 0 件で高さ 0 / 幅 240 と 4096 で全 widget の座標が有限・寸法が非負 / disabled な親 panel の下の子 widget が `disabled`（`lib.rs:1487-1491` の伝播）
    - 照合 差分 0
  - 対象: `engine/src/lib.rs`, `engine/src/composition.rs`, `engine/src/composition_tests.rs`
  - 依存: T4
  - 並列サブ作業: なし

- [x] T6: dispatch のルーティングと Instance ごとの確定（R4 前半 / P2）
  - 完了基準:
    - `Runtime::dispatch`（`lib.rs:427-550`）の「`find_path` から `call_fn` まで」を `impl instance::Instance` ブロックとして **`lib.rs` 内に**移動する（`"Unknown itemId: {target}"` が `lib.rs` に 1 回だけ残り、M3 `build-engine-variant.mjs:27` が壊れない）: `fn run_event(&self, target: &str, payload: Value) -> Result<Option<Dynamic>, String>`（`None` = 捨てた）と、捨てる条件のブロック（`lib.rs:452-469`）を `fn blocked(&self, path: &[&Node], state: &Value, target: &str) -> bool` に分ける。本文は移動のみで順序を変えない
    - `Runtime::route(&self, target) -> Result<Option<(String, String)>, String>`: `target` を最初の `/` で分け、前半を現在の Instance の ui で `find_path`（無ければ `Unknown itemId: {target}`（全体の文字列））、ノードが component でなければ同じエラー、`blocked` または component の `visibleBind` が false なら `Ok(None)`、該当子 Instance へ後半を渡して繰り返す。`/` が無ければ `(現在の Instance のキー, target)`
    - `commit_state`（`lib.rs:762-819`）の前半を `Instance::prepare_commit(&self, next: Dynamic) -> Result<(Dynamic, Node), String>`、代入を `Instance::apply(&mut self, state, ui)` に分け、`Runtime::commit_all(&mut self, root_next: Dynamic, children: Vec<(String, Dynamic)>)` が root の prepare → 子の prepare → root のキュー prepare / navigate 排他 / `buffers::capacity` → root apply → 子 apply（キー順）→ `revision += 1` を行う。既存 `commit_state(next)` は `commit_all(next, vec![])`（順序不変）
    - `dispatch`: `route` の結果が子なら子の `run_event` → `Some(next)` なら `commit_all(root の現在 state, vec![(key, next)])`（emit / config は T7）。子の失敗は `"Component {path}: "` を前置
    - `composition_tests.rs`: 子 grid への `"a/orders"` event で子の `selected` が変わり `revision` が 1 だけ進む / 親の disabled panel の下の子への event は捨てられ revision 不変 / `visibleBind` false の component への event は捨てられる / 深さ 3 の `"a/c/button"` が届く / `"a/nope"` と `"nope/x"` が `Unknown itemId` / 子 handler の throw で親子とも state 不変
    - 照合 差分 0（root の経路は移動のみ）。`git diff main -- engine/src` の `"..."` 文字列集合が追加のみ（PROGRESS に確認方法と結果）
  - 対象: `engine/src/lib.rs`, `engine/src/instance.rs`, `engine/src/composition_tests.rs`
  - 依存: T5
  - 並列サブ作業: なし

- [x] T7: emit / listeners / config のトランザクション（R4 後半 / R10 の listener・config 系）
  - 完了基準:
    - 順序（DECISIONS Round 1）: 子 handler → 子の `Emits::take()` を順に → 各 emit について親 Instance の template から該当 component ノード（`item_id == 子のキー末尾`）の `listeners[name]` を引き、あれば親 handler を `(親の候補 state, #{ target: "<component itemId>", action: "<emit 名>", value: <payload> })` で呼ぶ（無ければ無視）。親が root でなければ親の emit をさらにその親へ（上方向のみ、深さ 3 で打ち切り）→ 候補 state が変わった各 Instance について、その直下の component ノードの `evaluate_config` を「候補 state」と「現在の確定 state」で比べ、変わった子だけ `state.config` を更新し、子の `functions` に `config` があれば `config(state, #{ config: <map> })` を呼ぶ（子の候補 state があればそれに対して。emit 元自身を含む）。`config` 後に子の emit キューが空でなければ `"emit is not available in config"`。config 更新は下方向へ再帰 → `commit_all`。どこかで失敗したら親子とも変更なし、revision 不変
    - 親 handler のエラー文言は既存形 `"{script} / {itemId} / {handler}: {e}"`、子 config のエラーは `"Component {path}: {script} / config: {e}"`
    - `composition_tests.rs`: 子 grid 選択 → `emit("selected", #{...})` → 親 listener が `notice` を書き換え、revision +1 / `listeners` に無い emit は無視され revision は +1（子 state は確定）/ 親 handler が `query` を変える → bind した 2 つの子の `state.config.query` が変わり各 `config` handler が走る、変わらない子は呼ばれない（呼び出し回数を state に記録して検証）/ 親 listener の throw で親子とも不変 / 子 `config` の throw で親子とも不変 / `config` 内の emit がエラー / 深さ 3 で `a/c` の emit → `a` の listener → `a` の emit → root の listener が順に届く / 子 state は `state_json`（root）に現れず、子から親 state は見えない（`config` 以外のキーが無い）
    - 照合 差分 0
  - 対象: `engine/src/lib.rs`, `engine/src/composition.rs`, `engine/src/composition_tests.rs`
  - 依存: T6
  - 並列サブ作業: なし

- [x] T8: JS ローダー・エンジン・ランタイム（R6 / P9 / P12）
  - 完了基準:
    - `ApplicationLoader.fetch`（`application-loader.js:93-111`）の `network-only` で descriptors の後に子を再帰取得する: `screen.components` の各 `url` を `httpUrl(decl.url, url)` で解決 → 本文 → `parsePackage` → script（子 URL 基準）→ descriptors → さらにその子。取得した `screen.components[name].url` は絶対 `href` に書き換え、`candidate.components = { "<href>": { screen, script } }` を返す。同じ `href` は 1 回だけ取得。制限: 取得中スタックに同じ `href` → `コンポーネント <name> の循環参照: <href>`、深さ > 3 → `コンポーネントの入れ子が3段を超えています: <href>`、配置数（`ui.items` を再帰し xtype が宣言名のノードを数える。root を 1 と数える）> 8 → `コンポーネントの数が8を超えています（rootを含む）: <href>`。`network-first`（`:112-148`）と `restore` は `screen.components` が空でなければ `componentsを持つ画面は配信キャッシュ（network-first）に対応していません`
    - `WasmEngine.load`（`engine.js:70-88`）が `options.components`（`{ href: { screen, script } }`）を `request.components = { href: { package: screen, script } }` に入れる。`components` が空でないときだけ同梱後の JSON バイト数を先に測り、2,000,000 超なら `リクエストが2 MBを超えています（同梱後 <n> バイト。最大の子: <href> <m> バイト）` を throw（`call` の既存文言 `:53` は不変）
    - `UiRuntime.compile`（`runtime.js:308-350`）に `components` オプション。`resolveComponents(screen, source, bundled, clock)` が `screen.components[name].url` を `source` 基準の絶対 `href` に書き換え、`bundled[href]` が無ければ `コンポーネント <name> の本体がありません（URLから読み込んでください）`。各子 `screen` にも `prepareScreen(child, childUrl, clock)`（P9）。`engine.load(..., { clock, components })` 成功後に `this.components = components`。`load` は `candidate.components` を渡し、エディタの「変更を適用」（`main.js:187-189` 経由。引数なし）は `this.components` を再利用する
    - `tests/components-loader.test.js`（`tests/files-cache-rpc.test.js:225-253` の `responses` Map 方式）: 親 + 子 2 つ + 孫の再帰取得と URL の書き換え / 循環 / 深さ 4 / 配置 9（8 は通る）/ `network-first` 拒否 / 子の script 100KB 超（`application-loader.js:104` の既存文言）/ `WasmEngine.load` の 2MB 事前検査（子 2 つの `state` を各約 1.1MB にして超過。文言に `href`、`layout` が前画面のまま）/ `UiRuntime.compile` で子の `datepicker` に固定 clock の `today` が入る（P9。`tests/runtime.test.js:145-167` の `host` fixture を流用）/ 「変更を適用」の再利用（`compile` を `components` なしで呼ぶ → 直前の子で `ok`、url を変えると本体なしエラー）
    - `bunx vp test run` green、`bun run check` green
  - 対象: `src/application-loader.js`, `src/engine.js`, `src/runtime.js`, `tests/components-loader.test.js`（新規）, `tests/abi.test.js`（T4 で足した分の調整があれば）
  - 依存: T7
  - 並列サブ作業:
    - A: ローダーの再帰取得・制限・`network-first` 拒否（対象: `src/application-loader.js`, `tests/components-loader.test.js` のローダー節）
    - B: `WasmEngine.load` の `components` と 2MB 事前検査、`UiRuntime.compile` の `components` / `prepareScreen` / 再利用（対象: `src/engine.js`, `src/runtime.js`, `tests/components-loader.test.js` のエンジン・ランタイム節。A と同じテストファイルに書くときは `describe` を分け、親がマージする）

- [x] T9: デモ画面（R7）と Vitest
  - 完了基準:
    - 子 `public/screens/parts/order-list.json` + `order-list.rhai`: `orders.json:7-18` と同じ 4 件を `state.orders`、`state.config = { status: "", query: "" }`、ui は metric（件数）+ grid `itemId: "orders"`（`bind: "visible"`, `selectedBind: "selected"`, `handler: "select"`、列は 受注番号 / 顧客名 / 金額）。rhai: `refresh` が `state.config.status`（空なら全件）と `state.config.query`（顧客名・受注番号の部分一致）で絞る、`fn init(s) { refresh(s) }`、`fn config(s, e) { refresh(s) }`、`fn select(s, e) { s.selected = e.id; emit("selected", #{ id, number, customer }); s }`。`id` は `order-list`、title「受注一覧（部品）」。カタログには載せない
    - 親 `public/screens/order-dashboard.json` + `order-dashboard.rhai`: `id: "order-dashboard"`, `title: "受注ダッシュボード"`, `components: { "orderList": { "url": "parts/order-list.json" } }`, state `{ query: "", notice: "部品の一覧から受注を選んでください。" }`, ui は vbox: textfield `filter`（`bind: "query"`, `handler: "filterChanged"`）/ hbox に component ノード 2 つ `itemId: "open"`（`config: { status: "受注", query: { bind: "query" } }`）と `itemId: "shipped"`（`config: { status: "出荷済", query: { bind: "query" } }`）、どちらも `listeners: { selected: "onSelected" }` / label `bind: "notice"`。rhai: `fn init(s) { s }`、`fn filterChanged(s, e) { s }`、`fn onSelected(s, e) { s.notice = (if e.target == "open" { "受注" } else { "出荷済" }) + " の部品で " + e.value.number + " / " + e.value.customer + " を選択しました。"; s }`
    - `src/screen-catalog.js` に `{ id: "order-dashboard", title: "受注ダッシュボード", category: "apps", description: "..." }` を `orders` の次に追加。`README.md:25` / `:110` の画面数を「23画面」に。`bun run build:wasm` の manifest 生成が親で壊れない（`publish-packages.mjs:9-56` は `components` を読まない）
    - `tests/components-demo.test.js`: raw ABI（`tests/abi.test.js:14-28` の `raw`）で親 + 子を同梱した `load` が `ok`、`layout` 240 / 800 / 4096 で key が一意かつ `open/orders:header` と `shipped/orders:header` がある / `filter` `{value:"山田"}` 後に `open/orders:row:*` が減る（受注側のみ一致）/ `open/orders` `{id:1}` 後に `state.notice` に「受注」「SO-001」「山田商事」、`shipped/orders` `{id:2}` 後に「出荷済」「SO-002」/ 各 event で `revision` が 1 ずつ進む / `UiRuntime`（`tests/runtime.test.js:68-144` のモックレンダラーと `:145-167` の `host` を流用）で `load("screens/order-dashboard.json")` が両 surface の scene に `open/...` と `shipped/...` の widget を持つ（DOM / Canvas 両レンダラーへ同じ Scene が渡ることの検証。実ブラウザは任意）
    - `bunx vp test run tests/widget-contract.test.js tests/distribution.test.js tests/components-demo.test.js` green、`bun run build` green
  - 対象: `public/screens/parts/order-list.json`, `public/screens/parts/order-list.rhai`, `public/screens/order-dashboard.json`, `public/screens/order-dashboard.rhai`, `src/screen-catalog.js`, `README.md`, `tests/components-demo.test.js`（新規）
  - 依存: T8
  - 並列サブ作業:
    - A: 子・親パッケージ 4 ファイルとカタログ・README（対象: `public/screens/parts/*`, `public/screens/order-dashboard.*`, `src/screen-catalog.js`, `README.md`）
    - B: `tests/components-demo.test.js`（A のファイル名・itemId・期待文言は本 PLAN の記述に従う。対象: `tests/components-demo.test.js`）

- [x] T10: 候補のみ照合の証跡と最終判定スクリプト（R9 候補のみ列 / P10 / 変異 M4・M5）
  - 完了基準:
    - 新規 `scripts/probe-composition.mjs --candidate <wasm> [--evidence target/engine-compare/composition.json]`: 固定 clock（`compare-engine-behavior.mjs:12` と同じ）で 1 本の列を流し、各ステップの `{label, ok, error, revision, bytes}` と要約を証跡 JSON に書き、期待に外れたら exit 1。列: `order-dashboard` を `parts/order-list` 同梱で load → layout 240 / 800 / 4096（key 一意、`open/orders:header` と `shipped/orders:header`）→ `filter` `{value:"山田"}`（revision 1）→ layout 800（`open/orders:row:*` が 1 件・`shipped/orders:row:*` が 0 件。行は `event` 応答に出ないので layout を 1 歩足す）→ `open/orders` `{id:1}`（revision 2、`state.notice` に「SO-001」）→ `shipped/orders` `{id:2}`（revision 3、「SO-002」）→ 拒否の列: 子 handler に `Fn("http_get").call("x")` を持つ fixture を load（ok）→ event で `ok: false`、error に `http_get` と `not available in components`、その後の layout が前と同じ → 子に `http_get("x")` を直書きした fixture の load が `ok: false`
    - `scripts/build-engine-variant.mjs` の `MUTATIONS` に M4 `emit-skips-listener`（emit を取り出しても親 listener を呼ばない）と M5 `config-diff-ignored`（config の差分判定を常に「変化なし」にする）を追加（`from` は T7 のコードから一意に出現する行を選ぶ。`probe: "composition"` を付ける）
    - `scripts/verify-instance-refactor.mjs` の `buildSteps` が compare の後に `probe composition`（expect 0）を足し、`MUTATIONS` のうち `probe` 付きは compare ではなく probe（expect 1）で検査する
    - `bun scripts/verify-instance-refactor.mjs` が OK（既存 6 検査 → base 差分 0 → probe 0 → M1〜M3 の照合 1 → M4 / M5 の probe 1）。所要の表を PROGRESS に写す（値は表のまま）
    - `docs/testing.md:85` を手順の形に合わせて更新（変異 5 本、候補のみ証跡のファイル名）
  - 対象: `scripts/probe-composition.mjs`（新規）, `scripts/build-engine-variant.mjs`, `scripts/verify-instance-refactor.mjs`, `docs/testing.md`
  - 依存: T9
  - 並列サブ作業: なし

- [x] T11: 契約文書と追従（R8）
  - 完了基準:
    - 新設 `docs/components.md`（冒頭に「状態: 実装済み契約（段階 3）」）: 用語（コンポーネント / ウィジェット（組み込み部品）/ component ノード / 接頭辞付き itemId）/ 宣言 `components`（名前の規則・衝突・url）/ component ノードの許可属性 / `config`（固定値・`{bind}`・`state.config` への注入・`config(state, event)` の引数と呼び出し時機）/ `emit` と `listeners`（event map の 3 キー・未登録 emit の無視・上限 8・init / config 中の禁止・root での未定義）/ トランザクション順序（子 handler → emit → listener → config 差分 → 検証 → 親 → 子の代入、revision 1 つ、失敗時は親子とも不変）/ Scene と event の接頭辞 / 制限（Instance 8・深さ 3・Instance ごとの既存上限・2MB 据え置き・`/` 予約）/ 拒否（子の効果関数 19 種は load 時走査 + 実行時 stub。「拒否の根拠は実行時」と `Fn("name")` の注意（P8）、子の宣言 7 種、子の `window`、`network-first`、エディタ適用は直前の子を再利用）/ stateSchema を持つ子は `additionalProperties: false` なら `config` を `properties` に含める（`state_schema.rs:224-231`）/ ExtJS との違い（bubbling・`false` 戻り値・`scope` は無い）/ `internals` feature の版固定注意 / 段階 4 以降の課題（子の非同期効果、window、キャッシュ、WebMCP 合成、`with_clock` の context 共有を前提にすること、連鎖深さ 4 → 本構造では 2 段で打ち切り）/ 証跡はファイル名を指す（`target/engine-compare/composition.json`。生の値は写さない）
    - `docs/components-plan.md:3-4` の冒頭に段階 3 完了（2026-10 のマイルストーン）と `components.md` への参照を足す。`:74`「本マイルストーンでは components の HashMap は追加しない」は検討記録として残し、冒頭の注記で現状を指す
    - `docs/screen-format.md:5` に `components` を、`:74` に `config / listeners` と `/` の予約を追加し `components.md` へリンク。`docs/architecture.md:60-68`（Instance 木・ロード順）と `:84`（`load` 入力の `components`）を追従。`docs/README.md:28` の行を更新（`components.md` を先に）。`README.md` に「受注ダッシュボード」の 1 行（`:65` の受注一覧の次）。`docs/testing.md` の表に新テスト 3 本の行
    - `bun run docs:check` green。Markdown 表の桁揃えで差分が膨らんだファイルは `git diff -w --stat` の値を PROGRESS に併記
  - 対象: `docs/components.md`（新規）, `docs/components-plan.md`, `docs/screen-format.md`, `docs/architecture.md`, `docs/README.md`, `README.md`, `docs/testing.md`
  - 依存: T10
  - 並列サブ作業:
    - A: `docs/components.md` 新設（対象: `docs/components.md`）
    - B: 既存文書の追従 6 ファイル（対象: `docs/components-plan.md`, `docs/screen-format.md`, `docs/architecture.md`, `docs/README.md`, `README.md`, `docs/testing.md`）

- [x] T12: 最終判定と R10 の総点検
  - 完了基準:
    - `bun scripts/verify-instance-refactor.mjs` が OK（所要の表を PROGRESS に写す）
    - R10 の 18 ケースそれぞれに対応するテスト名（Rust の `fn` 名 / Vitest の `it` 文言）を表にして PROGRESS に書く（対応先の無いケースが 0 件）。REQUIREMENTS §受け入れ基準 1〜7 も同様に「どのコマンド / テストで確かめたか」を 1 行ずつ
    - `bun run fmt` 相当（`bunx vp fmt` / `cargo fmt`）済みで `bun run check` green、`git status` がクリーン
  - 対象: `.gsd-lite/PROGRESS.md`（コードの変更は原則なし。失敗があればそのタスクに戻す）
  - 依存: T11
  - 並列サブ作業: なし

## 決めた事項

1. ABI `load` の同梱形は `request.components = { "<絶対 URL>": { "package": <Package JSON>, "script": "<Rhai>" } }`（`descriptors` と同じ別キー。`abi.rs:30-38` の隣）。JS が `screen.components[name].url` を絶対 `href` に書き換えてから送り、Rust は `url` を不透明なキーとして引く。同じ子を 2 か所に置いても本体は 1 つ、Instance は 2 つ（RESEARCH §2 / §7）
2. `Package.components` は `BTreeMap<String, composition::Declaration>` + `#[serde(default, skip_serializing_if = "BTreeMap::is_empty")]`（`lib.rs:41-52` の `requests` 等と同形）。REQUIREMENTS R1 の `Option<BTreeMap>` と意味は同じ（RESEARCH §7）
3. `Runtime.components` は `BTreeMap<String, Instance>`（REQUIREMENTS R2 は `HashMap`）。理由: 子の apply 順・エラーの発生順を決定的にし、照合と証跡の再現性を保つ。キーは接頭辞付き itemId パス（`"a"` / `"a/b"`）
4. component ノードの判別は `port_kind = "component"`（`lib.rs:271-272`。`#[serde(skip)]` の内部フィールド。既存の `messagebox` / `accordion` と同じ使い方）。layout の分岐は `measure` と `arrange_sized` の先頭 2 か所のみ（方式 (H)、RESEARCH §1.3）
5. component ノードの許可属性検査は「許可属性だけを写した既定 `Node` と `serde_json::to_value` で一致するか」で行い、`fields::normalize` より前に template を走査する（normalize が親の `layout: accordion` や `radiogroup` で子のフィールドを書き換える `extras.rs:187-212` の影響を受けないため）。親 xtype の規則（`container / panel / fieldset / window`）と `itemId` 必須は normalize 後の `validate` で見る
6. 宣言名は `^[A-Za-z][A-Za-z0-9]{0,39}$`（`__text` / `invalid-*` / `port-*` 等の内部名と `-` `:` `/` を構造的に排除）。衝突は固定リスト 48 件 ∪ ダミー `Node` の normalize 結果（P1）
7. 子で拒否する宣言は `requests / operations / storage / files / rpc / pages / webmcp` の 7 種（REQUIREMENTS R1 の 6 種 + `operations`。`host_call` を拒否する以上 `operations` は使えないため。メッセージは 1 文言）
8. 照合列の到達条件（本ターンに base `ef582d5` へ流して確認。証跡はプローブの標準出力。値は PROGRESS に label 単位で記す）: `rpc_result` にデコード可能な `EchoResponse`（15 バイト）を返すと handler に届き revision が進む / `saveAs` / `saveDraft` は直接では `ok` だが revision 不変、`saveSplit-menu` `{action:"toggle"}` の後は届く（`saveAs` は window を開き `modal` が出る）/ `sendMessage` / `clearChat` は直接では revision 不変、`galleryViews` `{action:"tab", value: 4}` の後は届く（`sendMessage` は `chatInput` に入力しないと handler が throw して error 応答）/ `handlerNodes` を `items / menu / tbar / bbar / buttons` に広げると増えるのは `uivolve-gallery` の 4 件のみ。「会話」タブの index は pkg から算出する（固定値 4 を書かない）
9. `emit` の event map は `#{ target, action, value }` の 3 キーのみ（DECISIONS 細目）。`listeners` に無い emit は無視。上限 8 / handler。init 中・config 中はエラー。root では未定義（登録しない）
10. config の bind 差分判定は「親の候補 state と現在の確定 state で `evaluate_config` の結果（`serde_json::Value`）が `!=`」。load 時は差分に関係なく全子へ注入し `config` handler は呼ばない（DECISIONS 細目）
11. 深さ 3 の emit は上方向にだけ連鎖する（`a/c` → `a` の listener → `a` の emit → root の listener）。config は下方向にだけ連鎖する。両方向が交わらないのでピンポンは構造的に起きない（DECISIONS Round 1 の読み替え）
12. エラー文言: 子 Instance で起きた失敗は `"Component {path}: "` を前置する（root は無変更）。英語の文言は既存の `lib.rs` / `instance.rs` の体裁、JS の文言は既存の日本語の体裁（`engine.js:53` / `application-loader.js:104`）。既存の文字列は 1 つも変えない（P2。M3 の `"Unknown itemId: {target}"` と M1 / M2 の `from` 文字列が `lib.rs` に 1 回ずつ残ること）
13. `Instance::run_event` / `blocked` / `prepare_commit` / `apply` は `lib.rs` 内の `impl instance::Instance` ブロックに置く（文字列と本文の移動先を `lib.rs` に留め、照合の変異 M1〜M3 を壊さない）
14. 「変更を適用」（エディタ。`main.js:187-189`）は直前の `load` で取得した子（`UiRuntime.components`）を再利用し、url が一致しない子は本体なしエラー。`components.md` の制限に書く
15. `tests/abi.test.js` の追加は `components` 付き `load` の `ok` と 9 件超過の 2 ケースのみ。既存ケースの期待値は不変
16. Rust の新テストは `engine/src/composition_tests.rs` 1 本（節: 宣言 / Instance 環境 / 木とロード / layout / dispatch / トランザクション）。`lib.rs` の既存テスト 4 本（`lib.rs:1494-1585`）は触らない
17. Vitest の新ファイルは `tests/components-loader.test.js`（T8）と `tests/components-demo.test.js`（T9）の 2 本。Vitest は Node 環境（`vite.config.js:16`。DOM 環境なし）なので、両レンダラーの描画は `tests/runtime.test.js:68-144` のモックで「両 surface に同じ Scene が渡る」ことを確かめる
18. 変異は M1〜M3（既存。照合で検出）+ M4 / M5（T10。候補のみ probe で検出）。`verify-instance-refactor.mjs` は `probe` 付きの変異を probe で検査する

## メモ

### 振り返り（直近 2 件）の提案の採否

| 提案（出典）                                                 | 採否   | 反映先 / 理由                                                                               |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| 照合列を base に流してから固定（instance-refactor #1）       | 採用   | 本ターンで `turn-002-sequences-probe.mjs` を base に流した（決めた事項 8）                  |
| research / plan の成果物を `bunx vp fmt`（#2）               | 採用   | 本ターンの終了手順。REQUIREMENTS 進め方の制約                                               |
| サブエージェント依頼文の禁止事項（#3）                       | 採用   | 下の「サブエージェントへの依頼文」                                                          |
| PROGRESS の前ターンのエントリを編集しない（#4）              | 採用   | 下の「impl への注意」                                                                       |
| lean-ctx の project root（#5、font-parity #6）               | 対象外 | ループ運用側の作業。今ターンも未接続で Read / Bash で進めた（PROGRESS には書かない方針）    |
| verify のサブエージェントを観点別に分ける（#6）              | 採用   | 下の「verify への申し送り」に観点を列挙                                                     |
| サブエージェント起動後は `git show HEAD:<path>` で読む（#7） | 採用   | 下の「impl への注意」                                                                       |
| turns.jsonl の usage 内訳（#8）                              | 対象外 | ループ側                                                                                    |
| 表の桁揃え差分は `git diff -w --stat` を併記（#9）           | 採用   | T11 完了基準                                                                                |
| PR に `.gsd-lite/` を含めるか discuss で聞く（#10）          | 済     | DECISIONS 終了シーケンス（含める）                                                          |
| 段階 3 の research は残留リスク 1・2 を入力に（#11）         | 済     | R9 (a)(b)、T1                                                                               |
| Chromium 起動プローブ（font-parity #1）                      | 不採用 | 実ブラウザを必須にしていない（受け入れ基準 3）                                              |
| 並列サブ作業を最終タスクに置かない・600 秒（#2）             | 採用   | T12 は並列なし。T8 / T9 / T11 のサブ作業は「結果をファイルに書いて終わる」形                |
| 検査を足すタスクに変異表（#3）                               | 採用   | T10 の M4 / M5（役割の無効化 2 件）。T2〜T7 の Rust テストは拒否ケースを 1 件ずつ持つ       |
| 台帳に生の値を写さない（#4）                                 | 採用   | `components.md` / `testing.md` は証跡ファイル名を指す（T11）                                |
| runner が所要を出す（#5）                                    | 済     | `verify-instance-refactor.mjs:120-136` の表                                                 |
| 画面 × 部品 × 状態の一覧と補助 fixture を最初から（#7）      | 採用   | T9 のデモと T10 の拒否 fixture を計画に含めた。Rust の fixture は `composition_tests.rs` 内 |
| PROGRESS の恒常注意を 1 か所に（#8）                         | 済     | PROGRESS 冒頭                                                                               |
| 1 本で多 suite の検査ファイルを分割（#9）                    | 採用   | Vitest を loader / demo の 2 本に分け、Rust は 1 本だが節で分ける                           |
| verify は未確認に「要確認」を付ける（#10）                   | 申送   | verify への申し送り                                                                         |
| `origin` の判定（#11）                                       | 不要   | 今回は `origin` あり（DECISIONS）                                                           |

### RESEARCH の「盗める点」の採否

| 点                                                 | 採否 | 理由 / 反映先                                                                                           |
| -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| ダミー Node に normalize を通す衝突判定（§1.1）    | 採用 | T2、決めた事項 6                                                                                        |
| `pages::Requests` 形の emit キュー（§1.5）         | 採用 | T3 `composition::Emits`                                                                                 |
| `Dynamic` 引数で名前 × arity の stub（§1.5）       | 採用 | T3。`register` を呼ばない方式（上書きではなく）                                                         |
| `Instance::load` に効果登録フラグ（§1.5）          | 採用 | T3 `effects: bool`                                                                                      |
| layout (H) thread_local スナップショット（§1.3）   | 採用 | T5。(B) は 35 か所の差分で照合に守られない、(F) は bind 14 本の書き換え漏れが静かに別キーを読むため却下 |
| `commit_state` の prepare / apply 分割（§1.4）     | 採用 | T6 `commit_all`                                                                                         |
| `ExtensionContext` の共有（§1.5 / P6）             | 採用 | T3                                                                                                      |
| `request.components[絶対URL]`（§2）                | 採用 | 決めた事項 1                                                                                            |
| `internals` の `AST::walk` で load 時検出（§3）    | 採用 | T3。`Fn("name")` は拾えないので実行時 stub を根拠にする（契約に明記）                                   |
| ExtJS の listeners / fireEvent の意味論（§4）      | 採用 | 未登録 emit の無視のみ。bubbling / `false` 戻り値 / `scope` は「対応しない」と契約に明記                |
| Elm の translator パターン（§4）                   | 語彙 | 契約文書の説明にだけ使う                                                                                |
| 「変更を適用」は直前 load の子を再利用（§7）       | 採用 | 決めた事項 14                                                                                           |
| R10 の効果関数列を load 時 / 実行時の 2 列に（§7） | 採用 | T3 / T10                                                                                                |
| R9 (b) の 2 段列（§7）                             | 採用 | T1、決めた事項 8                                                                                        |
| 原子的な確定（失敗したら親子とも不変）             | 採用 | T6 / T7（最短実装を理由に落とさない）                                                                   |

### 落とし穴（RESEARCH §6）の担当タスク

P1 → T2 / P2 → T2〜T7 の照合 差分 0 と T6 の文字列集合確認 / P3 → T2 / P4 → T5 / P5 → T5 / P6 → T3 / P7 → T3 / P8 → T3・T10 / P9 → T8 / P10 → T1・T10 / P11 → T1 / P12 → T8 / P13 → T3 / P14 → T5（`validate` は接頭辞なしの ui に対してのみ走る）/ P15 → T3 / P16 → 恒常注意（PROGRESS 冒頭）

### R10 の担当タスク

循環参照 → T4（Rust）・T8（JS）/ 深さ 3 超 → T4・T8 / Instance 数 8 超 → T4・T8 / 未知の宣言名 → T2（既存 `Unknown xtype`）/ 宣言名と組み込み xtype の衝突 → T2 / component ノードの不正属性 → T2 / `config` の bind 先が無い → T2（規則）・T4（load）・T7（commit）/ `listeners` の handler が無い → T2 / 子の効果関数呼び出し → T3（直書き = load 時、`Fn` = 実行時。各関数 1 回以上）・T10 / 子 ui の `window` → T3 / 子の宣言 → T3 / 親 listener の失敗 → T7 / 子 `config` handler の失敗 → T7 / `config` 内の `emit` → T7 / `init` 中の `emit` → T3 / 2MB 超過 → T8（JS 事前検査）+ T4 の Rust 側は既存 `abi.rs:139` のまま / 子 script 100KB 超 → T4・T8 / 子 node 200 超 → T4

### 並行性・境界値・異常系

- 並行性: 単一スレッド WASM・同期 Rhai なので無い。`thread_local` の LayoutScope はガードで必ず解除する（T5 のテストで layout 失敗後も次の layout が通ることを確かめる）
- 境界値: Instance 8 / 深さ 3 / 2MB / 100KB / node 200 / emit 8 は「ちょうど」と「+1」の両方を固定する（T3 / T4 / T8）
- 異常系: すべての拒否は「エラー応答 + 親子の state / 前画面が不変」を同じテスト内で確かめる（state を取り直して `==`）。panic / trap は `cargo test` で `should_panic` を使わず、ABI の `raw` 呼び出しが `ok: false` の JSON を返すことで確かめる（T4 / T10）

### impl への注意

- 1 ターン 1 タスク。タスクの完了基準をすべて満たしてからコミット（`gsd-lite(impl): T<n> <要約>`）。Rust を触ったら `bun run build:wasm` → `bunx vp test run` → `bun run test:rust` → 照合 → `bun run check` の順
- PROGRESS の前ターンのエントリは編集しない。固定項目名（やったこと / 想定外 / やり直し / 次への注意）に接尾辞や補足を付けない
- サブエージェント起動後に親が同じファイルを読むときは `git show HEAD:<path>`（未追跡なら `bun -e` で読む）
- `.gsd-lite/` 配下は Read ツールと `git grep -n -A<N> -E '<pattern>' -- <paths>`（フラグは pattern の前）。`cat` はフックが拒否する
- `go` / `goto` を Rhai の関数名にしない（予約語。RESEARCH §3）
- `Instance::load` の既存の検査順序（`instance.rs:39-195`）を変えない。子向けの分岐は既存行の間に足す
- 2 段階のサイズ検査: JS（同梱後、どの子かを名指し）と Rust（`abi.rs:139` の 2MB。文言不変）の両方を残す

### サブエージェントへの依頼文（T8 / T9 / T11 で使う。必ず入れる）

- `git checkout` / `git restore` / `git stash` / `git reset` を使わない
- 整形は対象ファイルだけ `bunx vp fmt <path>`
- 結果はファイルに書いて終わる（親がテスト・コミットする）
- 本 PLAN の該当タスクの完了基準と「決めた事項」を再議論しない

### verify への申し送り

- 観点を分けて確かめる: (1) 移動したコード（`run_event` / `blocked` / `prepare_commit`）の本文一致と順序 (2) 既存文字列の不変（`git diff main -- engine/src` の `"..."` 集合が追加のみ、M1〜M3 の `from` が 1 回ずつ）(3) `components.md` の記述と `composition.rs` / `composition_tests.rs` の一致（制限値・順序・文言）(4) スクリプトの exit code と引数検証（`probe-composition.mjs` / `verify-instance-refactor.mjs`）(5) R10 の 18 ケースとテストの対応表
- 自分で再確認していない報告には「要確認」を付ける
- 証跡: `target/engine-compare/compare.json` / `mutant-*.json` / `composition.json`（gitignore。値は PROGRESS に写さない）

### タスク数

12 タスク（目安 8〜15 の範囲内）。T2〜T7 は `lib.rs` を順に書き換えるため並列化せず、JS（T8）・デモ（T9）・文書（T11）だけサブ作業を持つ。
