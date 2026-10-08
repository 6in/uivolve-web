# 画面パッケージの部品化（段階 3: 同期のみの合成）

マイルストーン: `component-composition`。設計文書 `docs/components-plan.md`（段階 1・2 で固定）の段階 3 を実装し、親画面の `components` 宣言と `xtype` 参照で既存の画面パッケージを部品として埋め込めるようにする。子の非同期効果は禁止（段階 4 で解放）。

## 背景（discuss で確認した現状）

- `Runtime { root: Instance, dialogs, pages, revision }`（`engine/src/lib.rs`）。`Instance`（`engine/src/instance.rs`）は `package / ui / functions / engine / extension_context / ast / state / http / host / storage / files / rpc` の 12 フィールド。`components` の HashMap は未追加。
- `Package` / `Node` は `#[serde(deny_unknown_fields)]`（`lib.rs:33`, `lib.rs:60-273`）。`components` / `config` / `listeners` は現在すべて未知属性としてエラー。`listeners` 属性はエンジン・JS のどこにも存在しない。
- xtype は `validate`（`lib.rs:1020-1073`）の固定リストで検査し、別名は `fields::normalize`（`fields.rs:27-48`）で先に正規化する。
- dispatch（`lib.rs:427-550`）は `target` を itemId で `find_path` し、disabled / 非表示 / 最前面 window 外のイベントを黙って捨て、`node.bind` へ入力値を書き、`node.handler` を `call_fn(state, event)` で呼ぶ。event map は `{target, action, value, id, column, oldValue, beforeId}`。
- `commit_state`（`lib.rs:762-819`）は検証（state object / 1MB / resolve / validate_handlers / grid reconcile / stateSchema / 各 `prepare` / navigate 排他 / buffers）がすべて通ってから `state` / `ui` / commit を代入し `revision += 1`。`take_effects` の順は http → storage → files → rpc → dialogs → pages → host。
- Rhai の効果関数は `Instance::load`（`instance.rs:65-80`）で Instance ごとに登録: `http_get` / `storage_read` / `storage_write` / `storage_remove` / `file_*` / `rpc_call` / `host_call` / `host_cancel` / `alert` / `confirm` / `prompt` / `navigate`。拡張（date / decimal / text / regex / `sum_ints`）は副作用なし。
- rhai は `internals` feature なしでビルド（`engine/Cargo.toml`）。`AST::walk` は使えず、load 時に「どの関数を呼ぶか」を検出する仕組みはない。
- 制限: node 200 / 深さ 20（`lib.rs:1017`, `dynamic_ui.rs:27`）、script 100KB（`instance.rs:51`、JS 側 `application-loader.js:104` ほか）、state 1MB（`lib.rs:998`）、リクエスト 2,000,000 バイト（`abi.rs:139`, `engine.js:53`）、パッケージ本文 1,000,000 バイト（`package-format.js:7`）、取得 1 ファイル 1MB（`resource-client.js:221`）。
- `ApplicationLoader.fetch(url, {mode})`（`application-loader.js:93`）: `network-only` はパッケージ本文と、パッケージ URL 基準で解決した script / descriptors を取得（キャッシュなし）。`network-first` は `url + ".manifest.json"` を検証して OPFS にキャッシュし、NETWORK 失敗時に復元する。
- load 失敗時は前画面を保つ（Rust は成功後のみ `RUNTIME` を書く `abi.rs:39-41`、JS は `runtime.js:330` で throw）。照合列 `failed-load-keeps-previous` が固定している。
- 画面カタログ `src/screen-catalog.js` は 22 件。`tests/widget-contract.test.js` が id 一意・title 一致・`fn init` 存在を検査する。`public/screens/*.manifest.json` と `public/screens/packages/` は生成物で gitignore。カタログに id `components`（パネル・ウィンドウ `components.json`）が既にある。
- 照合スクリプト: `scripts/compare-engine-behavior.mjs`（照合列は `buildPlan()` にハードコード: 22 画面 × load / layout 240・800・4096 / handler 付き itemId へ event + 手書き列 15 本）、`scripts/build-engine-variant.mjs`（`--commit` / `--mutation`）、`scripts/verify-instance-refactor.mjs`（`BASE_CHECKS` 6 本 → base 照合 exit 0 → 変異 3 本 exit 1）。証跡は `target/engine-compare/`。
- itemId はコロン禁止（`lib.rs:1080`）、`/` は現状許可だが既存 22 画面・tests に `/` を含む itemId はない。`window` xtype を使う既存画面は `components.json` のみ。
- `storage::safe_key`（`storage.rs:49`）は英数と `-` `_` のみ。子の storage / files scope は段階 4 の課題（本マイルストーンでは子の storage / files を禁止するので未使用）。
- thread_local: `abi.rs` RUNTIME / RESPONSE、`dialogs.rs` SEQUENCE、`buffers.rs` STORE、`files.rs` BYTE_USAGE、`theme.rs` CURRENT。Instance ごとの `sequence` は `http / storage / files / host / rpc` の `Requests` が持つ（子では未使用）。

## 要求

### R1. 宣言とパース（Rust）

- `Package` に `components: Option<BTreeMap<String, ComponentDecl>>`（名前 → `{ url }`。JS が同梱した本体を受ける形は research / plan で決める）を追加。宣言名は xtype の固定リスト・別名（`fields::normalize` の対象）と衝突したらエラー。
- `Node` に `config`（map。値は固定値または `{ "bind": "<親 state 最上位キー>" }`）と `listeners`（map。`emit` 名 → 親 handler 名）を追加。
- component ノード（`xtype` が宣言名）に許す属性: `xtype / itemId（必須）/ config / listeners / flex / width / visibleBind`。それ以外（`bind` / `handler` / `items` / `columns` 等）はエラー。
- `listeners` の handler 名は親 `functions` に存在すること（`validate_handlers` と同じ検査）。`config` の `bind` は親 state の最上位キー（ドットなし）であること。
- 子パッケージの `version` / `script` / `state` / `ui` / `stateSchema` は既存の load と同じ検査を Instance ごとに行う。子の `requests` / `storage` / `files` / `rpc` / `pages` / `webmcp` 宣言は load エラー（段階 4 以降で解放。理由を含むメッセージ）。

### R2. Instance 木と制限

- `Runtime.components: HashMap<String, Instance>`。キーは接頭辞付き itemId パス（`"<itemId>/<子itemId>"`。深さ 3 なら `"a/b"` まで）。
- 制限は Instance ごと（node 200 / 深さ 20 / script 100KB / state 1MB / Rhai 上限）。全体で Instance 数 8（root を含む）、ネスト深さ 3（root = 1）。超えたら load エラー。
- `/` を itemId の予約文字に加える（コロンと同じ扱い。既存画面に使用例なし）。
- 同じ子パッケージを複数個所に置ける（Instance は別。Rhai engine / AST も Instance ごと）。

### R3. レイアウト

- component ノードの位置で子 `ui` を子 `state` で layout し、親の矩形に埋める（子の高さが親レイアウトに反映される）。Scene は 1 つ。Scene のノード id / `key` は接頭辞付き（`"<itemId>/<子itemId>"`）。
- 子 ui に `window` を含むパッケージは load エラー（理由付き。解放は段階 4 以降の課題として `components.md` に記す）。最前面 window の判定と z 順は root の window だけを見る。
- `window` 以外の xtype（grid / tabpanel の `itemsBind` / kanban / navigation 系を含む）は子でも使える。dispatch の組み込み処理は該当 Instance の `ui` / `state` に対して行う。

### R4. dispatch ルーティング・config・emit

- `target` が接頭辞付きなら該当 Instance へ振り分け、子の `ui` / `state` / `functions` / `engine` で既存の dispatch 手順（捨てる条件、組み込み処理、bind 書き込み、handler 呼び出し）を実行する。親の disabled / 非表示 / window 最前面の判定は親側の経路で先に適用する。
- `emit(name, payload)` を子の Rhai に登録。親の `listeners[name]` があれば親 handler を `(state, event)` で呼ぶ。`event = #{ target: "<component itemId>", action: "<emit 名>", value: <payload> }`。`listeners` に無い `emit` は無視。root（親）での `emit` は未定義（エラー）。`init` 中の `emit` はエラー（`navigate` と同じ）。`config` handler 内の `emit` はエラー。
- `config`: load 時は子 `state.config` に評価済み config（bind 解決後）を注入してから `init`。以後、親 handler が返した state で bind 値が変わった子だけ `state.config` を更新し、子が `config(state, event)`（`event = #{ config: <map> }`）を定義していれば呼ぶ。
- トランザクション: 1 イベントで 1 commit、revision は 1 つ。順序は 子 handler → 集めた emit を親 listener へ順に → 親 state の bind 差分で影響する子（emit 元自身を含む）の config を順に → 親子すべての検証が通ってから 親 → 子 の順に代入。どこかで失敗したら親子とも変更なし。
- 子の `state` は親から見えない（WebMCP / `state_json` は root のみ）。親の state は子から見えない（`config` 経由のみ）。

### R5. 子の非同期効果の拒否

- 子 Instance の Rhai engine には `http_get / storage_* / file_* / rpc_call / host_call / host_cancel / alert / confirm / prompt / navigate` を「子では使えない」エラーを返す形で登録（実行時拒否。handler 失敗 → 変更なし）。
- research で rhai の AST 走査が無理なく使えると分かれば（`internals` feature の追加コスト・WASM サイズを含めて判断）、load 時にも検出して load エラーにする。無理なら実行時拒否のみ。

### R6. ローダー（JS）

- `ApplicationLoader` が親の `components` の `url`（親パッケージ URL 基準）を再帰取得し、子の script も子パッケージ URL 基準で解決。循環（URL の同一性）と深さ 3 超、Instance 数 8 超は取得時にエラー。
- 1 回の `load` に同梱（ABI `load` 入力の拡張。既存 op の応答形式・エラー文字列は不変）。リクエスト 2,000,000 バイト上限は据え置き。JS 側で同梱後のサイズを先に検査し、超えたら「どの子で超えたか」を含むエラーで前画面を保つ（Rust 側の 2MB 検査もそのまま）。パッケージ本文 1,000,000 バイト・script 100KB は子にも同じく適用。
- `components` を持つ親の `network-first` は拒否（manifest / キャッシュは段階 5）。

### R7. デモ

- 子パッケージ: `public/screens/parts/order-list.json` + `order-list.rhai`（受注管理を部品化。`config` で絞り込み（例: `status` と `query`）、grid 選択で `emit("selected", #{ id, number, customer })`）。カタログには載せない。
- 親: `public/screens/order-dashboard.json` + `order-dashboard.rhai`（id `order-dashboard`、title「受注ダッシュボード」、category `apps`）。フィルタ入力（親 state に bind）→ 2 つの子（例: 受注 / 出荷済で `status` の固定値が違う）へ `config` で連動、子の `selected` を `listeners` で受けて親の通知欄に「どちらの部品で何を選んだか」を表示。`src/screen-catalog.js` に登録し `tests/widget-contract.test.js` / `tests/distribution.test.js` を通す。`bun run build:wasm` の manifest 生成が親の `components` を含んでも壊れないこと（子は manifest 対象外）。

### R8. 文書

- 契約文書 `docs/components.md`（状態: 実装済み契約）を新設。`components-plan.md` は検討記録として残し、段階 3 完了の旨と `components.md` への参照を冒頭に足す。
- `docs/screen-format.md`（`components` / `config` / `listeners` / 予約文字 `/` / 制限）、`docs/architecture.md`（Instance 木）、`docs/README.md`、`README.md` を追従。`bun run docs:check` green。

### R9. 挙動照合

- `scripts/verify-instance-refactor.mjs` + `scripts/compare-engine-behavior.mjs` を流用し、base（`main`）WASM と候補で既存 22 画面 + 手書き列の差分 0。変異 3 本は exit 1。
- 照合列の拡張（前回の残留リスク）: (a) `rpc_result` の成功経路（デコード可能な Protobuf 応答で handler が呼ばれる列）を足す。(b) `handlerNodes` の走査を `items` 以外の `menu` / `bbar` / `tbar` / `buttons` に広げる。拡張した列は PLAN に固定する前に base WASM へ 1 度流し、各列が意図した経路に届くこと（`ok` と effects の有無、`okResponses` の label 内訳）を確かめる。
- 新デモ画面（親・子）は base が load できないので base との差分照合から除外し、「候補のみ」の列（固定クロックで load / layout 240・800・4096 / フィルタ入力 event / 子 grid 選択 event（emit → 親 listener）/ 子の効果関数呼び出しの拒否）として応答 JSON を `target/engine-compare/` に証跡として残す（次回の base になる）。合わせて Rust 単体テスト / Vitest で検証する。

### R10. 堅牢性

- どの入力・応答状態でも panic / trap を出さない。次の各ケースで「エラー応答 + 親子の state / 前画面は不変」をテストで固定する: 循環参照、深さ 3 超、Instance 数 8 超、未知の宣言名、宣言名と組み込み xtype の衝突、component ノードの不正属性、`config` の `bind` 先が無い、`listeners` の handler が無い、子の効果関数呼び出し（各関数 1 回以上）、子 ui の `window`、子の `requests` 等の宣言、親 listener の失敗、子 `config` handler の失敗、`config` 内の `emit`、`init` 中の `emit`、2MB 超過、子 script の 100KB 超過、子の node 200 超過。

## 受け入れ基準

1. `bun run test` / `bun run build` / `bun run check` / `bun run docs:check` が green。既存テストの期待値変更は `tests/abi.test.js` の `load` 入力拡張に伴う追加のみ（既存ケースの期待値は不変）。
2. 挙動照合: 拡張後の照合列（R9 (a)(b) を含む）で base（`main`）WASM と候補の差分 0、変異 3 本が exit 1。証跡 `target/engine-compare/compare.json` と `mutant-*.json`。候補のみの列の証跡 JSON が存在し、ダッシュボードの load が `ok`、フィルタ event 後に 2 つの子の `state.config` が更新され、子 grid 選択 event 後に親 state の通知欄が変わり、`revision` が 1 イベントにつき 1 だけ進む。
3. デモ: 選択メニューに「受注ダッシュボード」があり、DOM / Canvas 両レンダラーで 2 つの部品とフィルタ入力が描画され、フィルタ入力で両部品の一覧が絞られ、部品の行選択で親の通知欄に選択内容が出る。Vitest（`tests/`）に load / layout / event の検証を置く（実ブラウザは必須としない）。
4. 制限と拒否: R2 / R5 / R6 / R10 の各ケースが Rust 単体テストまたは Vitest で固定され、エラーメッセージが原因（どの子・どの関数・どの上限か）を含む。
5. 契約: `docs/components.md` の記述（宣言・属性・config / emit の意味・トランザクション順序・制限・拒否・段階 4 以降の課題）と実装が一致する（verify が照合）。`screen-format.md` / `architecture.md` / `docs/README.md` / `README.md` の追従があり `docs:check` green。`components-plan.md` の冒頭に段階 3 完了と `components.md` への参照がある。
6. 公開シグネチャ: `Runtime` の既存 `pub fn`（`load` / `load_with_*` / `dispatch` / `complete_*` / `take_effects` / `state_json` / `layout`）は維持。`lib.rs` 内の既存テスト 4 本が無改修で通る。
7. 成果物の整形: research / plan / impl の各ターンで変更した Markdown / JS は `bunx vp fmt <path>`、Rust は `cargo fmt` 済み（`bun run check` green）。

## 進め方の制約（前回振り返りの採用分）

- 照合列（R9）を PLAN に固定する前に、plan が base WASM（`target/engine-compare/base-<short>.wasm`。無ければ `scripts/build-engine-variant.mjs --commit main` で作る）へ 1 度流し、各列が意図した経路に届くこと（`ok` と effects の有無、label 内訳）を確かめてから固定する。
- サブエージェントへの依頼文には「`git checkout` / `git restore` / `git stash` / `git reset` を使わない」「整形は対象ファイルだけ `bunx vp fmt <path>`」「結果はファイルに書いて終わる」を必ず入れる。
- research / plan / impl のターン終了前に、変更した Markdown / JS は `bunx vp fmt <path>`、Rust は `cargo fmt --manifest-path engine/Cargo.toml` で整形し、`bun run check` が赤くないことを確かめる。
- `.gsd-lite/` 配下の読み取りは lean-ctx フックが `cat` を拒否するため Read ツールと `git grep` / `git show` を使う。

## スコープ外

- 子の非同期効果（http / storage / files / rpc / host / dialogs / navigate）の instance ルーティング（段階 4）
- 子パッケージのキャッシュ・manifest・`network-first`（段階 5）
- WebMCP の合成（段階 6）。WebMCP は root の state / tools のみ
- 子の storage / files scope の区切り文字、`http` effect の `kind`
- `abi.rs` のマルチスロット化、複数 WASM のワークスペース
- 性能改善、既存制限値の変更（2MB の扱いは discuss の決定に従う）
- ループ・スキルの改修

## 用語

- 画面パッケージ: 画面定義（JSON/YAML）と Rhai スクリプトの組。既存の `Package`。
- コンポーネント（部品）: 親画面の `components` で宣言し `xtype` で参照する画面パッケージ。契約文書では「コンポーネント」、組み込み xtype は「ウィジェット（組み込み部品）」と呼び分ける。
- component ノード: `xtype` に宣言名を書いた親 ui のノード。
- Instance: 1 画面パッケージ分の実行単位（`engine/src/instance.rs`）。root と子。
- 接頭辞付き itemId: `"<component itemId>/<子 itemId>"`。Scene の key・event の target・`Runtime.components` のキーに使う。
- config: 親 → 子の値渡し。固定値または `{ bind: <親 state キー> }`。子の `state.config` に注入。
- emit / listeners: 子 → 親の通知。子 Rhai の `emit(name, payload)` と親ノードの `listeners[name] = 親 handler`。
