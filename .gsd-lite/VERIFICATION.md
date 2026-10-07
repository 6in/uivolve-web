# VERIFICATION — component-composition

- 実施: 2026-10-08 / gsd-lite-verify（turn 15、verify_round 1）
- 対象: `git diff main...HEAD`（base `main` = `ef582d5`、HEAD = `b331343`）。コードは `engine/src/composition.rs`（新規）/ `composition_tests.rs`（新規）/ `lib.rs` / `instance.rs` / `abi.rs` / `dynamic_ui.rs` / `Cargo.toml`、JS は `src/application-loader.js` / `engine.js` / `runtime.js` / `screen-catalog.js`、スクリプトは `scripts/probe-composition.mjs`（新規）/ `compare-engine-behavior.mjs` / `build-engine-variant.mjs` / `verify-instance-refactor.mjs`、デモ 4 ファイル、Vitest 2 本新規 + `abi.test.js` 追加、文書は `docs/components.md`（新規）と追従 6 ファイル
- 判定: **差し戻し**（指摘 2 件 → PLAN の F1 / F2。残留リスク 8 件を下に記す）
- 進め方: コードレビューとセキュリティチェックを読み取り専用のサブエージェント 2 本に並行させ、親が最終判定スクリプト・堅牢性の格子プローブ・文書の照合・受け入れ基準の突き合わせを前景で行った。サブエージェントの報告は親が実物で再確認したものだけを採り、未確認の項目には「要確認」を付けた（本文書に要確認の項目は残っていない）

## 指摘（差し戻し）

1. **子 Instance の emit キューが失敗したイベントの後に残り、完了処理を誤拒否する**（`engine/src/lib.rs` `progress_host` / `complete_*` 7 本は `self.root.clear_queues()` のみ、子は `dispatch` でしか空にならない）。子 handler が `emit` の後に失敗（throw / stub 拒否 / 非 object）すると emit がキューに残り、次の `http_result` 等で root の bind 先が変わって `reconfigure` が走ると `child.emits.take()` が残留分を拾って `Component a: emit is not available in config` を返す。応答の id は消費済みなので HTTP 応答は失われる。ABI で再現（`scratch/turn-015-stale-emit.mjs`: 4 変種のうち「emit 後に throw・子に config あり」「emit 後に stub 拒否」の 2 つが `http_result` で `ok: false`、対照 2 つは `ok: true`）。R10「どの応答状態でも…」と R4「config の呼び出し」の誤動作で、応答の消失を伴うので差し戻す。サブエージェント 2 本が独立に同じ指摘を出し、親が再現した → **F1**
2. **軽微な指摘のまとめ** → **F2**: (a) `ApplicationLoader.#components` / `UiRuntime.resolveComponents` が `components: { a: {} }` / `{ a: null }` / `{ a: { url: 5 } }` で `<base>/undefined` を取りに行く、または `TypeError` を出す（受け入れ基準 4「エラーメッセージが原因を含む」の趣旨に反する。前画面は保たれる）(b) JS ローダーは**宣言単位**で循環・深さを検査し置かれていない宣言も取得するのに対し Rust は**配置単位**。契約文書にその差が無い (c) 子ノードの `webmcp` は検証されるが登録されない（接頭辞付き target は `find_path(&root.ui)` に見つからない）。文書に無い (d) `layout: accordion` の親の `items` に置いた component ノードは normalize で `collapsed` が立つが layout は panel 以外の折りたたみを見ないので折りたたみが効かない（panic / 損失なし）。文書に無い (e) `tests/components-demo.test.js` の `hands the same composed scene to the dom and the canvas renderer` は両 surface が接頭辞付き key を持つことだけを見て「同じ Scene」を比べていない（stage 幅が 400 / 500 で違う）

## 観点と確認したこと

### 最終判定と受け入れ基準 1〜7

| #   | 基準                               | 確認方法と結果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 全検査 green、既存期待値の変更なし | クリーンな作業ツリーで `bun scripts/verify-instance-refactor.mjs` を実行し exit 0（18 手順すべて期待どおり、合計 58.1 秒。`cargo test` 59 本 / Vitest 649 本 32 ファイル）。`git diff main...HEAD --stat -- tests/` は `abi.test.js` +38 / 新規 2 本 / `browser/font-parity.mjs` 1 行（xtype 許可リスト読み取りの正規表現。期待値ではない）                                                                                                                                                                                                                      |
| 2   | 挙動照合と候補のみ列の証跡         | `compare candidate` `steps 370 / diffs 0 / ok 348 / error 22 / sequences 44`。変異 5 本が `diffs 171 / 2 / 1`、`problems 3 / 2` でいずれも exit 1。`probe composition` `steps 13 / problems 0`（load ok → filter で両子 1 / 0 行 → 子選択で notice に SO-001 / SO-002 → revision 0→1→2→3）。証跡 `target/engine-compare/compare.json` / `composition.json` / `mutant-*.json`                                                                                                                                                                                     |
| 3   | デモ（両レンダラー）               | `tests/components-demo.test.js` 5 本 green（raw ABI 4 + `UiRuntime` 1）。`UiRuntime` 経由は dom / canvas の両 surface に `open/` と `shipped/` の key が渡ることを見る。「同じ Scene」の比較は無い（指摘 2(e)、F2）。カタログ 23 件に `order-dashboard`                                                                                                                                                                                                                                                                                                          |
| 4   | 制限と拒否（R2 / R5 / R6 / R10）   | PROGRESS turn 14 の R10 対応表 18 行の Rust `fn` 名 22 件すべてが `cargo test` の出力に、Vitest の `it` 文言 8 件すべてが `git grep -F` で存在。堅牢性の格子プローブ（下記）98 ケースでトラップ 0。ただし指摘 1（完了経路の誤拒否）と指摘 2(a)（JS の TypeError）                                                                                                                                                                                                                                                                                                |
| 5   | 契約文書と実装の一致               | `docs/components.md` の文言 24 件（名前・URL・属性・配置・config・emit 上限・init / config 中・上限 7 値・JS 文言 4 件・拒否 19 関数・宣言 7 種・window・network-first・本体なし・stateSchema）を `composition.rs` / `lib.rs` / `abi.rs` / `engine.js` / `application-loader.js` / `runtime.js` / `state_schema.rs:229` と突き合わせて一致。別名 9 件は `fields.rs:30-44` / `extras.rs:63-74` に存在。トランザクション順序 8 段は `commit_event` → `propagate_emits` → `propagate_config` → `commit_all` の順と一致。足りない記述は指摘 2(b)(c)(d) と F1 の 1 文 |
| 6   | 公開シグネチャ                     | 既存 `pub fn` は無変更（`load_with_clock` は `load_with_components` へ委譲）。`git diff main --unified=0 -- engine/src/lib.rs` の最後のハンクが `+1763,12` で、既存テスト（`lib.rs:1966` の `mod tests`）に差分なし。`cargo test` の `tests::` 4 本 green                                                                                                                                                                                                                                                                                                        |
| 7   | 整形                               | `bun run check` green（274 ファイル整形 / 106 ファイル lint / `cargo fmt --check`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 堅牢性の格子（round 1 で一括。`scratch/turn-015-robustness-probe.mjs`、`public/engine.wasm` へ raw ABI）

入力経路 × 面を 98 ケース流し、すべて JSON 応答（トラップ 0）。

- `request.components` の形 13: 配列 / 文字列 / 数値 / null / entry が null・配列・空 / `package` が数値・未知フィールド / `script` が数値・欠落 → すべて `Invalid components` か serde の文言。9 件 → `At most 8 component packages`。使われない同梱は黙って通る
- event target 12: `/` / `a/` / `a//boom` / `/a/boom` / `a/boom/` / `a/b/c/d/e` / 空 / `nope/x` / `a/nope` / `a` / `filter/x` → `Unknown itemId: <全体>`、`Component a: Unknown itemId: nope`、`This component does not accept events` のいずれか。拒否後の layout は ok
- component ノード 19: config が配列 / 文字列 / `{bind: ""}` / `{bind: "a.b"}` / `{bind: 5}` / `{bind: ["x"]}` / 無いキー / null 値のキー（ok）/ 2 キー object（固定値、ok）/ null（ok）。listeners が数値・配列（serde）/ 未定義 handler。visibleBind にドット / 非 bool（隠れる: event は捨てられ revision 0、widgets 0）。itemId に `/` / `:`。`bind` 属性 → 拒否、`items: []` → 既定と同値で通る（空なので無害）
- 子パッケージ 12: state が配列 / null / 文字列 → `Component a: Initial state must be an object`。version 2 / ui null / 自己参照（`Component a/m: circular reference`）/ window / requests / `http_get("x")` 直書き（line, position 付き）/ `"x".http_get()` のメソッド形も拒否 / 子が `fn http_get` を定義するだけなら通る（呼べば拒否）/ state に `config` が既にあれば注入で上書き
- 宣言 12: 空名 / `/` 入り / 41 文字 / url 空 / 2049 バイト / 余分なキー / null / 文字列 / 組み込み `grid` / 別名 `msgbox` → それぞれの文言。root の ui 自体が component ノード → misplaced。url 2048 バイト（上限ちょうど）は宣言として通り未同梱で落ちる（**文言に 2048 文字の URL がそのまま入る**。残留リスク 7）
- emit 7: 名前が数値 → Rhai の関数未定義、payload が FnPtr → `payload must be JSON-serializable`、9 件目 → `At most 8 emits per handler`、handler が非 object → `Handler must return a state object`、子が自分の `state.config` を文字列で上書き → ok（契約外だが害なし）
- layout 7: 239 / 4097 / NaN / 文字列 → 既存の文言。失敗した reload の後も前画面の `a/` widgets が残る

### コードレビュー（Rust）

- 移動したコード: `run_event` / `blocked` / `prepare_commit` / `apply` は旧 `dispatch` / `commit_state` の本文と同順（`find_path` → `blocked` → `action` → `read_only` → `close_other_menus` → 組み込み 7 分岐 → `event_value` → `bind` 書き込み → `call_fn`。`prepare_commit` は `from_dynamic` → object → `check_state` → resolve → `validate_handlers` → `initialize_added` → `grid::reconcile` → resolve → `validate_handlers` → `validate_ui_state` → schema → `to_dynamic` → `check_state`）。`commit_all` は root prepare → 子 prepare（キー順）→ root のキュー prepare 7 連 → `buffers::capacity` → root apply → root commit 7 連 → 子 apply → `revision += 1`
- 既存文字列の不変（P2）: `git diff main...HEAD -- engine/src` の `"..."` リテラルは追加 483 / 削除 68 / **削除のみ 0**（`scratch/turn-015-strings.mjs`）。M1〜M5 の `from` は `lib.rs` に各 1 回
- 上限の境界: 深さ `depth + 1 > 3`（root = 1）、Instance `count > 8`（root 込み）、emit `len() >= 8` で 9 件目拒否。JS の `countInstances`（root = 1、`> 8`）と `visit`（`depth + 1 > 3`）が同じ値。Rust / JS の循環検出とも test で固定
- 原子性: 検証はすべて `apply` の前。`apply` は代入のみ。`get_mut(...).expect` は直前の `get` で存在確認済み。`Ok(None)`（捨てる）では commit も revision も動かない。失敗の経路で親子とも不変（test 3 本 + probe `reject-at-runtime` の layout 同一）
- emit / config の連鎖: `propagate_emits` は path を 1 段ずつ短くして root で終わる。`propagate_config` は BTreeMap のキー順（祖先が先）+ `visited` で各 Instance 1 回。emit 元が自分の候補 state を保ったまま reconfigure される（`candidate(path)` を読む）
- LayoutScope: `let _components` が `layout` の終わりまで生き、Drop で thread_local を None に戻す。`with_component` は `RefCell` の borrow を閉じてから `f` を呼ぶので再入で二重 borrow にならない。スコープ外（dispatch 中の `measure` 等）では `None` → 0
- panic 経路: `composition.rs` の `expect` 2 件は `{"xtype": <英数>}` / `{}` から全既定の `Node` を作るだけで入力に依存しない。`unwrap` は `find_path == true` の直後のみ。`Value::get` は非 object で `None`。`as_object_mut` は `ok_or_else` で守る。`Composing::load` は子 state が object でないときに `IndexMut` ではなく `Err` にする
- 冗長: `commit_all` の `children.sort_by` は BTreeMap 由来で不要（無害。残留リスク 6）

### コードレビュー（JS・スクリプト・テスト）

- ローダー: `#download` は既存 `network-only` と同順（本文 → `parsePackage` → script 100 KB → descriptors）。`#components` は深さ優先で `declaration.url` を絶対 href に書き換え、循環 → 深さ → 既取得 skip → 再帰、最後に `countInstances`。`network-first` と `restore` は `withoutComponents` を通し、`restore` は components 拒否を `catch {}` に飲ませず前世代へ落ちない（turn 10 (2) の構造変更を確認）
- `WasmEngine.load`: `components` が空なら key を付けない。2 MB 事前検査は同梱後の JSON バイト数で、最大の子を名指し。`call` の既存文言は不変。事前検査は `clock` を足す前の大きさを見る（約 50 バイトの窓。残留リスク 2）
- `UiRuntime.compile`: `resolveComponents` が url を絶対化して未同梱を拒否、子と孫に `prepareScreen`。成功後に `this.components = bundled`。`load` は `candidate.components ?? {}` を渡し、引数なしの `compile` は直前の子を再利用（決めた事項 14 どおり、文書化済み）
- `probe-composition.mjs`: 引数不正・WASM 不在 exit 2、problems 有 exit 1、無 exit 0 を実行で確認。WASM 不正や trap は未処理例外（exit 1、証跡なし。残留リスク 5）。`verify-instance-refactor.mjs` は `probe` 付き変異を probe で検査（出力の表で `probe emit-skips-listener` / `probe config-diff-ignored` が 1 / 1）
- テストの妥当性: Rust の失敗系は親子の state を取り直して `==`、revision を固定。Vitest の 2MB は `layout` と `screen.id` の不変を見る。`a_child_cannot_announce_anything_while_it_is_being_reconfigured` は root の state と revision を見るが子 state は見ない（残留リスク 8）。完了経路（`complete_*`）を合成画面で流すテストが無く、指摘 1 を素通りした → F1 で追加。3 段の config 連鎖は load 時のみで実行時のテストが無い → F1 で追加

### セキュリティチェック

- サンドボックス: 子 engine には効果 7 モジュールの `register` を呼ばず stub だけを登録（`instance.rs:95-105`）。`Fn("...")` / `call` / `eval`（`disable_symbol` 無し）/ メソッド形はすべて子 engine で解決されるので本物に届かない。`no_module` で `import` 無し。`AST::walk` は関数本体とクロージャに降りる。子が `fn http_get` を定義しても、呼び出し箇所は名前で拒否され、仮に走っても子自身のコード
- 共有状態: `ExtensionContext` は `Rc<Cell<Option<Clock>>>` のみ、子は `clock: None` で `enter` しないので root の clock を消さない。`dialogs::SEQUENCE` / `files::BYTE_USAGE` / `buffers::STORE` は効果関数経由でしか触れない。拡張（date / decimal / text / regex）は純粋、regex キャッシュは engine ごとに有界
- 境界の検証: 宣言名 `^[A-Za-z][A-Za-z0-9]{0,39}$`、`reserved` が XTYPES ∪ normalize の書き換え先。`itemId` の `/` `:` は `dynamic_ui::expand` の**後**の `validate` で見るので itemsBind 由来も対象。`port_kind` は `#[serde(skip)]` で `prepare_template` だけが立て、`route` が `port_kind == "component"` を要求するので JSON から component ノードを偽装できない。`unsupported_attribute` は serialize 比較なので列挙漏れが無い
- DoS: 深さ 3 / Instance 8 / 2 MB が JS と Rust の 2 段。`propagate_emits` は path が単調に短くなり、`propagate_config` は `visited` + config 中 emit 禁止でピンポン無し。`AST::walk` は 100 KB 以下の script に線形
- JS: `httpUrl` が子にも適用され http / https のみ・資格情報なし。クロスオリジンは root と同じく許可（回帰ではない）。cycle 検出は stack 照合が skip より先。`network-first` / `restore` の両経路が拒否
- 秘密情報・インジェクション: 追加行に資格情報なし。利用者文字列はすべて `format!` の引数。`spawn` は引数配列、`shell: true` / `eval` / `new Function` なし

### 文書の主張・期待値の変更

- 古い件数なし: `git grep -E '21画面|12画面|22画面|変異3本|M1〜M3'` が `README.md` / `docs` / `scripts` / `src` で 0 件。PLAN 追従先チェックリスト 10 行の「確かめ方」を再実行してすべて成立（`components` が screen-format 4 / architecture 3 / docs/README 2、`components.md` が docs/README 1・components-plan 2、`composition.json` が testing 1・verify 1、新テスト 3 本 3 件、`internals` が Cargo.toml 2・components.md 1）
- `docs/testing.md:88`「スクリプト4本」= compare / probe / build-variant / verify、「変異5本」= `MUTATIONS.length`。`docs/components.md:10`「48種」= `XTYPES` の長さ。`README.md:25` / `:111`「23画面」= カタログ 23 件
- impl の「既存テストの期待値の変更: なし」は `git diff main...HEAD --numstat -- tests/` で裏づけ（`abi.test.js` 38 / 0、`font-parity.mjs` 1 / 1 は読み取り正規表現）。PLAN の訂正（T1 走査キー 7 種、T2 48 件 / 11 件、T3 arity と +14,142 バイト、T4 state object 検査、T5 接頭辞 1 段ずつ、T6 `unknown_item`、T7 `commit_state` → `commit_event`、T8 `clock` 引数、T10 layout 1 歩追加）はいずれも実測を正としたもので要件・決定に触れていない

## 残留リスク（差し戻さない理由つき）

1. **layout ごとの子スナップショット**: `layout_scope()` が毎回 全子の `ui.clone()` と `state_json()`（最大 1 MB × 7）を作る。既存画面はコスト 0、合成画面でも数 KB のデモでは問題ないが、大きな子 state では resize 連打で重くなる。要件に性能基準は無い。段階 4 以降で `revision` をキーにキャッシュする余地
2. **`engine.js` の 2 MB 事前検査の窓**: `clock` を足す前の大きさで判定するので、約 50 バイトの窓では詳細文言ではなく `call` の既存文言になる。拒否自体は Rust 側（`abi.rs`）でも必ず起きる
3. **`file_bytes` が stub 表に無い**: 純粋なコンストラクタで効果ではないため契約の 19 関数に含めていない。子で呼ぶと「not available in components」ではなく Rhai の関数未定義で落ちる（効果は到達しない。文言の不一致のみ）
4. **エラー文言の識別子の揺れ**: Instance 上限は `exceeded at component {path}`（末尾）、`requires itemId` / 配置違反は xtype を使う。すべて `composition_tests.rs` と `components.md` に固定・記載済みなので変えない
5. **`probe-composition.mjs` の例外経路**: WASM が不正（`compile` 失敗）や ABI の trap は未処理例外で exit 1、証跡を書かない。最終判定では `build:wasm` 直後の WASM にしか使わないので実害なし
6. **`commit_all` の `children.sort_by`**: 呼び出し元が BTreeMap を畳むので常に整列済み。無害な冗長
7. **宣言 `url` の 2048 バイトがエラー文言にそのまま入る**: `Component {path}: package {url} was not bundled` が最長 2 KB 強になる。ABI 応答の上限内で、JS 側は絶対 URL を渡すので通常は短い
8. **テストの見落とし 2 件**: `a_child_cannot_announce_anything_while_it_is_being_reconfigured` が子 state の不変を見ない（同じ経路の `a_child_that_refuses_a_configuration_…` が親子とも見ているので実質カバー）。`a_declared_component_node_loads_and_waits_for_its_package` は `prepare_template` が normalize より前に走ることを直接は固定しない（`component_nodes_accept_only_their_own_attributes` の accordion / radiogroup 配下のケースが無い。P14 の回帰は照合と probe では見えないが、順序を入れ替えると `extras.rs:206` の `collapsible` 付与で属性検査が落ちる形なので、入れ替え自体が `cargo test` で検出される見込み）

## リモート運用（本ラウンドでは行わない）

- `origin` = `https://github.com/6in/uivolve-web.git`。差し戻しのため push / PR は作成しない。合格後のラウンドで `git push -u origin gsd-lite/component-composition` → `gh pr create --base main`
