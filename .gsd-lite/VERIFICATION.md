# VERIFICATION — component-composition

- 実施: 2026-10-08 / gsd-lite-verify（turn 18、verify_round 2）。round 1（turn 15）の記録は末尾に残す
- 対象: `git diff main...HEAD`（base `main` = `ef582d5`、HEAD = `4d56497`）。round 2 の回帰確認の中心は修正ラウンドの差分 `4177ca1...HEAD`（`engine/src/lib.rs` の `clear_queues` 化（27 行の変更）、`engine/src/composition_tests.rs` +125、`src/application-loader.js` / `src/runtime.js` の宣言ガード、`tests/components-loader.test.js` +27、`tests/components-demo.test.js` +14、`docs/components.md` +4 文）
- 判定: **合格**（指摘 0 件。残留リスク 9 件を下に記す。F1 / F2 は完了基準どおり）
- 進め方: round 2 は申し送りどおり「round 1 の格子の再確認 + F1 / F2 の差分の回帰」だけを行い、新しいクラスの探索はしていない。修正差分が小さい（Rust 27 行・JS 10 行）ためサブエージェントは使わず親が前景で読んだ。本文書の数値はすべて本ターンに自分で実行して得た値で、「要確認」の項目は 1 件（F1 の新テストが修正前に落ちることは impl の報告。親は ABI プローブで同じ事実を独立に確認した）

## round 2 で確認したこと

### 最終判定スクリプト（クリーンな作業ツリーから）

`bun scripts/verify-instance-refactor.mjs` が exit 0。18 手順すべて期待どおり、合計 60.7 秒。`cargo test` 61 本（round 1 から +2）/ Vitest 651 本 32 ファイル（+2）/ `compare candidate` `steps 370 / diffs 0 / ok 348 / error 22 / sequences 44` / `probe composition` `steps 13 / problems 0` / 変異 5 本が `diffs 171 / 2 / 1`、`problems 3 / 2` で exit 1。`bun run check`（275 ファイル整形 / 106 ファイル lint / `cargo fmt --check`）と `bun run docs:check`（59 ファイル 484 リンク）green。証跡 `target/engine-compare/compare.json` / `composition.json` / `mutant-*.json`

### round 1 の格子の再確認（`public/engine.wasm` = F1 入りのビルド）

- `scratch/turn-015-robustness-probe.mjs`: 98 ケース、トラップ 0。応答の文言は round 1 と同じ（A 同梱の形 13 / B stale emit 対照 / C target 12 / D node 19 / E 子パッケージ 12 / F 宣言 12 / G emit 7 / H layout 7）
- `scratch/turn-015-stale-emit.mjs`: 4 変種（対照 / emit 後 throw・config あり / emit 後 throw・config なし / emit 後 stub 拒否）がすべて `http_result true revision 2 query "changed"`。round 1 で `ok: false` だった 2 変種が直っている
- `scratch/turn-015-strings.mjs`: `git diff main...HEAD -- engine/src` の `"..."` リテラルは追加 504 / 削除 68 / **削除のみ 0**。M1〜M5 の `from` は `lib.rs` に各 1 回

### F1 の回帰（子 Instance の emit キューの残留）

- `Runtime::clear_queues(&self)`（`lib.rs:568-573`）が root と `components` 全部の `Instance::clear_queues()` を回し、`Instance::clear_queues`（`instance.rs:251-258`）は `http / host / storage / files / rpc / emits` の 6 キューを空にする
- 呼び出し 8 か所（`dispatch` `:577` / `progress_host` `:813` / `complete_host` `:838` / `complete_http` `:863` / `complete_storage` `:889` / `complete_file` `:920` / `complete_rpc` `:952` / `complete_dialog` `:976`）が `self.root.clear_queues()` から 1 行置換で `self.clear_queues()` になり、各関数内の位置・順序は不変（diff は各 1 行の `-`/`+` のみ）。`self.root.clear_queues()` は helper の中にだけ残る（自己再帰なし）。PLAN F1 の「8 関数 / 9 か所」は impl が実物（7 関数 + `dispatch` = 8 か所）に訂正済みで、`grep` の件数と一致
- `reconfigure`（`lib.rs:721-750`）: `config` handler を `call_fn` する**前**に `child.emits.clear()`、後に `take().is_empty()` の判定。既存文言 `Component {path}: emit is not available in config` は不変
- テスト 2 本が完了基準の表と対応: `a_stale_announcement_does_not_poison_a_later_completion`（表 1〜2 行目を `throw` / `stub` の 2 変種でループ。`dispatch("fetch")` → `take_effects()[0]["id"]` → `dispatch("a/shout")` が `Err` で revision 1 → `complete_http` が `Ok` で revision 2、root の `query` と子の `config` / `configs` / `seen` を確認）/ `a_configuration_travels_down_three_levels_at_run_time`（表 4 行目。`chain.json` の `config` が自分の `relayed` を書き、`a/c` の `config` が 1 回呼ばれ revision 1）。表 3 行目は既存 `a_child_cannot_announce_anything_while_it_is_being_reconfigured` が維持
- `docs/components.md:89` に「失敗したイベントで子が積んだ `emit` は捨てられ、次のイベントや完了処理（`http_result` 等）に持ち越さない」の 1 文

### F2 の回帰（宣言の形の検査と軽微な追従）

- `src/application-loader.js:141-144` と `src/runtime.js:48-51`: `typeof declaration?.url !== "string"` なら URL 解決の前に同一文言 `コンポーネント {name} の宣言が不正です（url を文字列で指定してください）` を throw。`resolveComponents` は `compile` の状態更新より前に走るので前画面は不変
- テスト: ローダー節 `refuses a declaration without a string url before fetching anything`（`{}` / `null` / `{url: 5}` の 3 形。`reads` のキーが親の json / rhai の 2 件 = 子 URL の取得 0 回）/ ランタイム節 `refuses a declaration without a string url and keeps the loaded screen`（同 3 形。`runtime.screen.id` と `layout(400)` が不変）/ `hands the same composed scene to the dom and the canvas renderer` は両 stage を 400 にして最後の `render` 引数の `widgets` を `toEqual`（既存の `open/` / `shipped/` の assert も残る）
- `docs/components.md` の 3 文: 許可属性節 `:37`（accordion には置かない）/ 制限節 `:120`（ローダーは宣言単位・Rust は配置単位）/ 段階 4 以降 `:162`（子ノードの `webmcp` は検証されるが登録されない）

### 受け入れ基準 1〜7

| #   | 基準                               | 確認方法と結果                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 全検査 green、既存期待値の変更なし | 最終判定 18 手順 exit 0（上記）。`git diff main...HEAD --numstat -- tests/` は `abi.test.js` 38 / 0、`components-demo.test.js` 236 / 0（新規）、`components-loader.test.js` 449 / 0（新規）、`browser/font-parity.mjs` 1 / 1（xtype 許可リスト読み取りの正規表現。期待値ではない）                                                                  |
| 2   | 挙動照合と候補のみ列の証跡         | `compare candidate` 差分 0（370 歩 44 列）、変異 5 本すべて exit 1、`probe composition` 13 歩 problems 0（load ok → `filter` → layout 800 で open 1 行 / shipped 0 行 → 子選択で notice に SO-001 / SO-002 → revision 0→1→2→3）。証跡 3 種が `target/engine-compare/` に存在                                                                        |
| 3   | デモ（両レンダラー）               | `tests/components-demo.test.js` 5 本 green。`UiRuntime` 経由は dom / canvas を同幅 400 にして最後の Scene の `widgets` が `toEqual` かつ両方に `open/` と `shipped/` の key（round 1 の指摘 2(e) 解消）。カタログ 23 件に `order-dashboard`                                                                                                         |
| 4   | 制限と拒否（R2 / R5 / R6 / R10）   | PROGRESS turn 14 の R10 対応表 18 行 + round 1 の格子 98 ケースの再確認（トラップ 0）。round 1 の指摘 1（完了経路の誤拒否）は `turn-015-stale-emit.mjs` 4 変種 ok と新テストで、指摘 2(a)（JS の `TypeError` / `<base>/undefined`）は新テスト 2 本で解消                                                                                            |
| 5   | 契約文書と実装の一致               | round 1 で突き合わせた 24 件の文言は修正ラウンドで変わっていない（`git diff 4177ca1...HEAD -- docs/components.md` は追加 4 文のみ）。追加 4 文は上記 F1 / F2 の節で実装と照合。`components-plan.md:3` の段階 3 完了注記は不変。追従先チェックリストの `git grep -E '21画面\|12画面\|22画面\|変異3本\|M1〜M3' -- README.md docs scripts src` は 0 件 |
| 6   | 公開シグネチャ                     | 修正ラウンドで足したのは private `fn clear_queues(&self)` のみ。`git diff 4177ca1...HEAD -- engine/src/lib.rs` に `pub fn` の変更なし（`dispatch` の `-`/`+` は helper 挿入による位置移動で署名は同一）。`cargo test` の `tests::` 4 本 green                                                                                                       |
| 7   | 整形                               | `bun run check` green（最終判定の手順 4）。`git status` クリーンで開始                                                                                                                                                                                                                                                                              |

## 残留リスク（差し戻さない理由つき）

1. **layout ごとの子スナップショット**: `layout_scope()` が毎回 全子の `ui.clone()` と `state_json()`（最大 1 MB × 7）を作る。既存画面はコスト 0、合成画面でも数 KB のデモでは問題ないが、大きな子 state では resize 連打で重くなる。要件に性能基準は無い。段階 4 以降で `revision` をキーにキャッシュする余地
2. **`engine.js` の 2 MB 事前検査の窓**: `clock` を足す前の大きさで判定するので、約 50 バイトの窓では詳細文言ではなく `call` の既存文言になる。拒否自体は Rust 側（`abi.rs`）でも必ず起きる
3. **`file_bytes` が stub 表に無い**: 純粋なコンストラクタで効果ではないため契約の 19 関数に含めていない。子で呼ぶと「not available in components」ではなく Rhai の関数未定義で落ちる（効果は到達しない。文言の不一致のみ）
4. **エラー文言の識別子の揺れ**: Instance 上限は `exceeded at component {path}`（末尾）、`requires itemId` / 配置違反は xtype を使う。すべて `composition_tests.rs` と `components.md` に固定・記載済みなので変えない
5. **`probe-composition.mjs` の例外経路**: WASM が不正（`compile` 失敗）や ABI の trap は未処理例外で exit 1、証跡を書かない。最終判定では `build:wasm` 直後の WASM にしか使わないので実害なし
6. **`commit_all` の `children.sort_by`**: 呼び出し元が BTreeMap を畳むので常に整列済み。無害な冗長
7. **宣言 `url` の 2048 バイトがエラー文言にそのまま入る**: `Component {path}: package {url} was not bundled` が最長 2 KB 強になる。ABI 応答の上限内で、JS 側は絶対 URL を渡すので通常は短い
8. **テストの見落とし**: `a_child_cannot_announce_anything_while_it_is_being_reconfigured` が子 state の不変を見ない（同じ経路の `a_child_that_refuses_a_configuration_…` が親子とも見ているので実質カバー）。`component_nodes_accept_only_their_own_attributes` に accordion / radiogroup 配下のケースが無い（順序を入れ替えると `extras.rs:206` の `collapsible` 付与で属性検査が落ちる形なので、入れ替え自体は `cargo test` で検出される見込み）
9. **F2 の JS 文言が契約文書に無い**（round 2 で追加）: `docs/components.md:16` は「エントリは `url` のみで、他のキーは読み込みエラー」と形の規則を書いているが、`url` が文字列でないときの JS 文言 `コンポーネント {名前} の宣言が不正です（url を文字列で指定してください）` は列挙していない（`:117` の JS 文言 3 件の並びに無い）。規則と実装は一致しており文言の列挙漏れだけなので差し戻さない。次に `components.md` を触るときに `:117` の括弧内へ 1 件足す

## リモート運用

- `origin` = `https://github.com/6in/uivolve-web.git`（github.com）。`gh` は認証済み（account `6in`）。本ラウンドで `git push -u origin gsd-lite/component-composition` → `gh pr create --base main` を行い、PR の URL を下に記録する
- PR: （push / 作成後に追記）

---

## round 1 の記録（turn 15、差し戻し。指摘は F1 / F2 で解消済み）

- 対象: `git diff main...HEAD`（HEAD = `b331343`）。コードは `engine/src/composition.rs`（新規）/ `composition_tests.rs`（新規）/ `lib.rs` / `instance.rs` / `abi.rs` / `dynamic_ui.rs` / `Cargo.toml`、JS は `src/application-loader.js` / `engine.js` / `runtime.js` / `screen-catalog.js`、スクリプトは `scripts/probe-composition.mjs`（新規）/ `compare-engine-behavior.mjs` / `build-engine-variant.mjs` / `verify-instance-refactor.mjs`、デモ 4 ファイル、Vitest 2 本新規 + `abi.test.js` 追加、文書は `docs/components.md`（新規）と追従 6 ファイル
- 進め方: コードレビューとセキュリティチェックを読み取り専用のサブエージェント 2 本に並行させ、親が最終判定スクリプト・堅牢性の格子プローブ・文書の照合・受け入れ基準の突き合わせを前景で行った。サブエージェントの報告は親が実物で再確認したものだけを採った

### 指摘（差し戻し → 解消）

1. **子 Instance の emit キューが失敗したイベントの後に残り、完了処理を誤拒否する**（`engine/src/lib.rs` `progress_host` / `complete_*` 7 本は `self.root.clear_queues()` のみ、子は `dispatch` でしか空にならない）。子 handler が `emit` の後に失敗（throw / stub 拒否 / 非 object）すると emit がキューに残り、次の `http_result` 等で root の bind 先が変わって `reconfigure` が走ると `child.emits.take()` が残留分を拾って `Component a: emit is not available in config` を返す。応答の id は消費済みなので HTTP 応答は失われる。ABI で再現（`scratch/turn-015-stale-emit.mjs`: 4 変種のうち 2 つが `http_result` で `ok: false`）。R10「どの応答状態でも…」と R4「config の呼び出し」の誤動作で、応答の消失を伴うので差し戻した。サブエージェント 2 本が独立に同じ指摘を出し、親が再現した → **F1（turn 16 で解消）**
2. **軽微な指摘のまとめ** → **F2（turn 17 で解消）**: (a) `ApplicationLoader.#components` / `UiRuntime.resolveComponents` が `components: { a: {} }` / `{ a: null }` / `{ a: { url: 5 } }` で `<base>/undefined` を取りに行く、または `TypeError` を出す (b) JS ローダーは**宣言単位**で循環・深さを検査し置かれていない宣言も取得するのに対し Rust は**配置単位**。契約文書にその差が無い (c) 子ノードの `webmcp` は検証されるが登録されない。文書に無い (d) `layout: accordion` の親の `items` に置いた component ノードは折りたたみが効かない。文書に無い (e) `tests/components-demo.test.js` の `hands the same composed scene to the dom and the canvas renderer` は両 surface が接頭辞付き key を持つことだけを見て「同じ Scene」を比べていない（stage 幅が 400 / 500 で違う）

### 堅牢性の格子（round 1 で一括。`scratch/turn-015-robustness-probe.mjs`、raw ABI）

入力経路 × 面を 98 ケース流し、すべて JSON 応答（トラップ 0）。

- `request.components` の形 13: 配列 / 文字列 / 数値 / null / entry が null・配列・空 / `package` が数値・未知フィールド / `script` が数値・欠落 → すべて `Invalid components` か serde の文言。9 件 → `At most 8 component packages`。使われない同梱は黙って通る
- event target 12: `/` / `a/` / `a//boom` / `/a/boom` / `a/boom/` / `a/b/c/d/e` / 空 / `nope/x` / `a/nope` / `a` / `filter/x` → `Unknown itemId: <全体>`、`Component a: Unknown itemId: nope`、`This component does not accept events` のいずれか。拒否後の layout は ok
- component ノード 19: config が配列 / 文字列 / `{bind: ""}` / `{bind: "a.b"}` / `{bind: 5}` / `{bind: ["x"]}` / 無いキー / null 値のキー（ok）/ 2 キー object（固定値、ok）/ null（ok）。listeners が数値・配列（serde）/ 未定義 handler。visibleBind にドット / 非 bool（隠れる: event は捨てられ revision 0、widgets 0）。itemId に `/` / `:`。`bind` 属性 → 拒否、`items: []` → 既定と同値で通る（空なので無害）
- 子パッケージ 12: state が配列 / null / 文字列 → `Component a: Initial state must be an object`。version 2 / ui null / 自己参照（`Component a/m: circular reference`）/ window / requests / `http_get("x")` 直書き（line, position 付き）/ `"x".http_get()` のメソッド形も拒否 / 子が `fn http_get` を定義するだけなら通る（呼べば拒否）/ state に `config` が既にあれば注入で上書き
- 宣言 12: 空名 / `/` 入り / 41 文字 / url 空 / 2049 バイト / 余分なキー / null / 文字列 / 組み込み `grid` / 別名 `msgbox` → それぞれの文言。root の ui 自体が component ノード → misplaced。url 2048 バイト（上限ちょうど）は宣言として通り未同梱で落ちる（残留リスク 7）
- emit 7: 名前が数値 → Rhai の関数未定義、payload が FnPtr → `payload must be JSON-serializable`、9 件目 → `At most 8 emits per handler`、handler が非 object → `Handler must return a state object`、子が自分の `state.config` を文字列で上書き → ok（契約外だが害なし）
- layout 7: 239 / 4097 / NaN / 文字列 → 既存の文言。失敗した reload の後も前画面の `a/` widgets が残る

### コードレビュー（Rust）

- 移動したコード: `run_event` / `blocked` / `prepare_commit` / `apply` は旧 `dispatch` / `commit_state` の本文と同順（`find_path` → `blocked` → `action` → `read_only` → `close_other_menus` → 組み込み 7 分岐 → `event_value` → `bind` 書き込み → `call_fn`。`prepare_commit` は `from_dynamic` → object → `check_state` → resolve → `validate_handlers` → `initialize_added` → `grid::reconcile` → resolve → `validate_handlers` → `validate_ui_state` → schema → `to_dynamic` → `check_state`）。`commit_all` は root prepare → 子 prepare（キー順）→ root のキュー prepare 7 連 → `buffers::capacity` → root apply → root commit 7 連 → 子 apply → `revision += 1`
- 上限の境界: 深さ `depth + 1 > 3`（root = 1）、Instance `count > 8`（root 込み）、emit `len() >= 8` で 9 件目拒否。JS の `countInstances`（root = 1、`> 8`）と `visit`（`depth + 1 > 3`）が同じ値。Rust / JS の循環検出とも test で固定
- 原子性: 検証はすべて `apply` の前。`apply` は代入のみ。`get_mut(...).expect` は直前の `get` で存在確認済み。`Ok(None)`（捨てる）では commit も revision も動かない。失敗の経路で親子とも不変（test 3 本 + probe `reject-at-runtime` の layout 同一）
- emit / config の連鎖: `propagate_emits` は path を 1 段ずつ短くして root で終わる。`propagate_config` は BTreeMap のキー順（祖先が先）+ `visited` で各 Instance 1 回。emit 元が自分の候補 state を保ったまま reconfigure される（`candidate(path)` を読む）
- LayoutScope: `let _components` が `layout` の終わりまで生き、Drop で thread_local を None に戻す。`with_component` は `RefCell` の borrow を閉じてから `f` を呼ぶので再入で二重 borrow にならない。スコープ外（dispatch 中の `measure` 等）では `None` → 0
- panic 経路: `composition.rs` の `expect` 2 件は `{"xtype": <英数>}` / `{}` から全既定の `Node` を作るだけで入力に依存しない。`unwrap` は `find_path == true` の直後のみ。`Value::get` は非 object で `None`。`as_object_mut` は `ok_or_else` で守る。`Composing::load` は子 state が object でないときに `IndexMut` ではなく `Err` にする

### コードレビュー（JS・スクリプト・テスト）

- ローダー: `#download` は既存 `network-only` と同順（本文 → `parsePackage` → script 100 KB → descriptors）。`#components` は深さ優先で `declaration.url` を絶対 href に書き換え、循環 → 深さ → 既取得 skip → 再帰、最後に `countInstances`。`network-first` と `restore` は `withoutComponents` を通し、`restore` は components 拒否を `catch {}` に飲ませず前世代へ落ちない
- `WasmEngine.load`: `components` が空なら key を付けない。2 MB 事前検査は同梱後の JSON バイト数で、最大の子を名指し。`call` の既存文言は不変
- `UiRuntime.compile`: `resolveComponents` が url を絶対化して未同梱を拒否、子と孫に `prepareScreen`。成功後に `this.components = bundled`。`load` は `candidate.components ?? {}` を渡し、引数なしの `compile` は直前の子を再利用（決めた事項 14 どおり、文書化済み）
- `probe-composition.mjs`: 引数不正・WASM 不在 exit 2、problems 有 exit 1、無 exit 0 を実行で確認。`verify-instance-refactor.mjs` は `probe` 付き変異を probe で検査
- テストの妥当性: Rust の失敗系は親子の state を取り直して `==`、revision を固定。Vitest の 2MB は `layout` と `screen.id` の不変を見る。完了経路（`complete_*`）を合成画面で流すテストが無く、指摘 1 を素通りした → F1 で追加。3 段の config 連鎖は load 時のみで実行時のテストが無い → F1 で追加

### セキュリティチェック

- サンドボックス: 子 engine には効果 7 モジュールの `register` を呼ばず stub だけを登録（`instance.rs:95-105`）。`Fn("...")` / `call` / `eval` / メソッド形はすべて子 engine で解決されるので本物に届かない。`no_module` で `import` 無し。`AST::walk` は関数本体とクロージャに降りる。子が `fn http_get` を定義しても、呼び出し箇所は名前で拒否され、仮に走っても子自身のコード
- 共有状態: `ExtensionContext` は `Rc<Cell<Option<Clock>>>` のみ、子は `clock: None` で `enter` しないので root の clock を消さない。`dialogs::SEQUENCE` / `files::BYTE_USAGE` / `buffers::STORE` は効果関数経由でしか触れない。拡張（date / decimal / text / regex）は純粋、regex キャッシュは engine ごとに有界
- 境界の検証: 宣言名 `^[A-Za-z][A-Za-z0-9]{0,39}$`、`reserved` が XTYPES ∪ normalize の書き換え先。`itemId` の `/` `:` は `dynamic_ui::expand` の**後**の `validate` で見るので itemsBind 由来も対象。`port_kind` は `#[serde(skip)]` で `prepare_template` だけが立て、`route` が `port_kind == "component"` を要求するので JSON から component ノードを偽装できない。`unsupported_attribute` は serialize 比較なので列挙漏れが無い
- DoS: 深さ 3 / Instance 8 / 2 MB が JS と Rust の 2 段。`propagate_emits` は path が単調に短くなり、`propagate_config` は `visited` + config 中 emit 禁止でピンポン無し。`AST::walk` は 100 KB 以下の script に線形
- JS: `httpUrl` が子にも適用され http / https のみ・資格情報なし。クロスオリジンは root と同じく許可（回帰ではない）。cycle 検出は stack 照合が skip より先。`network-first` / `restore` の両経路が拒否
- 秘密情報・インジェクション: 追加行に資格情報なし。利用者文字列はすべて `format!` の引数。`spawn` は引数配列、`shell: true` / `eval` / `new Function` なし

### 文書の主張・期待値の変更（round 1）

- 古い件数なし: `git grep -E '21画面|12画面|22画面|変異3本|M1〜M3'` が `README.md` / `docs` / `scripts` / `src` で 0 件。PLAN 追従先チェックリスト 10 行の「確かめ方」を再実行してすべて成立
- `docs/testing.md:88`「スクリプト4本」= compare / probe / build-variant / verify、「変異5本」= `MUTATIONS.length`。`docs/components.md:10`「48種」= `XTYPES` の長さ。`README.md:25` / `:111`「23画面」= カタログ 23 件
- `docs/components.md` の文言 24 件（名前・URL・属性・配置・config・emit 上限・init / config 中・上限 7 値・JS 文言 4 件・拒否 19 関数・宣言 7 種・window・network-first・本体なし・stateSchema）を `composition.rs` / `lib.rs` / `abi.rs` / `engine.js` / `application-loader.js` / `runtime.js` / `state_schema.rs:229` と突き合わせて一致。トランザクション順序 8 段は `commit_event` → `propagate_emits` → `propagate_config` → `commit_all` の順と一致
- PLAN の訂正（T1 走査キー 7 種、T2 48 件 / 11 件、T3 arity と +14,142 バイト、T4 state object 検査、T5 接頭辞 1 段ずつ、T6 `unknown_item`、T7 `commit_state` → `commit_event`、T8 `clock` 引数、T10 layout 1 歩追加）はいずれも実測を正としたもので要件・決定に触れていない
