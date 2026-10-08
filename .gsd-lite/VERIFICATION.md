# VERIFICATION — component-effects

- 実施: 2026-10-09 / gsd-lite-verify（turn 14、verify_round 1 → 差し戻し）
- 対象: `git diff main...HEAD`（base `main` = `49c8183`、HEAD = `0eb8a20`。67 ファイル、+6128 / −1438。コードは `engine/src/{lib,abi,composition,composition_tests,dialogs,instance,pages,http}.rs` と `engine/Cargo.toml`、JS は `src/{engine,runtime,application-loader,component-tree,host-effects,http-effects,storage-effects,page-effects,screen-catalog}.js`、スクリプト 4 本、デモ 6 ファイル、Vitest 新規 2 本 + 追記 6 本、文書 11 ファイル、`vite.config.js`）
- 判定: **指摘あり（差し戻し）**。コード・テスト・最終判定・堅牢性格子・セキュリティは差し戻し事由 0 件。契約文書 `docs/components.md` の 2 点（R10 が明示した JS 文言の列挙漏れ / `host_progress` が完了を消費しない例外の未記載）を F1（文書のみ）にまとめた
- 進め方: コードレビューとセキュリティチェックを読み取り専用のサブエージェント 2 本に並行させ、親が最終判定スクリプト・ABI の堅牢性格子・文書の照合・受け入れ基準の突き合わせを前景で行った。サブエージェントの指摘は親が実物で再確認したものだけを採った（MAJOR-1 は親が先に `git grep` で独立に見つけた同じ指摘。MINOR-1 は `engine/src/host.rs:151-173` で再確認）

## 指摘（→ F1）

1. **R10 が明示した JS 文言が契約文書に無い**: `docs/components.md` の「エラー文言」節「日本語（JS）」の列挙に `コンポーネント {名前} の宣言が不正です（url を文字列で指定してください）` が無い（`git grep -F '宣言が不正です' -- docs` が 0 件。実装は `src/application-loader.js:128` / `src/runtime.js:51` にある）。REQUIREMENTS R10 の第 1 項（前回残留リスク 9）と PLAN の追従先チェックリスト「JS の日本語文言を足す」行の条件（1 件）に反する。T11 の最終確認は追従先チェックリスト 11 行のうち 9 条件を再実測していて、この行が抜けていた
2. **「handler の失敗は完了を消費する」が `host_progress` に当てはまらない**: `docs/components.md:139` は 7 op 共通の文として書いているが、`host::Requests::progress`（`host.rs:151-173`）は `pending.get` だけで消費せず、progress handler が失敗しても同じ id の `host_progress` / `host_result` はその後も届く。Rust の格子 `completion_grid` は `HostProgress { consuming: false }` でこの挙動を固定済み。文書に例外の 1 文を足す（実装は変えない）

どちらも文書だけの指摘で、データ損失・誤動作を伴わない。受け入れ 6（契約文書と実装の一対一）に掛かるため差し戻す。round 2 は「round 1 の格子の再確認 + F1 の差分の回帰」だけを行う。

## round 1 で確認したこと

### 最終判定スクリプト（クリーンな作業ツリーから）

`bun scripts/verify-instance-refactor.mjs` が exit 0（ログ `.gsd-lite/logs/component-effects/scratch/turn-014-verify.log`）。`BASE_CHECKS` 6 本 green（`vp test run` 672 passed・34 files / `cargo test` 90 passed / `bun run check` 整形 280 files・lint 109 files / `docs:check` 499 targets・59 files / `build` 114 modules）→ `compare candidate` `steps 370 / diffs 0 / normalized: effects[*].kind === "http" → kind を除去` → `probe composition` `steps 54 / problems 0 / sequences 6` → 変異 7 本すべて exit 1（照合 `layout-x-offset` diffs 171 / `dialog-draft-revision` 2 / `unknown-item-message` 1、probe `emit-skips-listener` problems 7 / `config-diff-ignored` 2 / `instance-dropped` 19 / `completion-routed-to-root` 12）。T11（turn 13）の 2 回の実行と同じ値

### ABI の堅牢性格子（round 1 で一括。`scratch/turn-014-robust-probe.mjs`、raw ABI、HEAD の `public/engine.wasm`）

parts-lab（子 3 種）を load し、子の http effect（`products`）・子の storage effect（`note` の init）・子の dialog（`approval`）を積んだ状態で **315 ステップ・problems 0**。各ステップで (1) 応答が返る（トラップ 0）、(2) `ok: false`、(3) 直後の `layout:800` が格子の前に取った基準とバイト列一致、を確認し、格子の後に正しい `instance` で 3 本の完了が通って `revision` が +1 / +2 / +3 と進むこと、消費済みの再送が `Component products: Unknown or completed HTTP request` で layout 不変であることまで見た。

- `instance` × 7 op（`http_result` / `storage_result` / `file_result` / `rpc_result` / `dialog_result` / `host_result` / `host_progress`）: 形の不正 15 種（`null` / `0` / `-1` / `1.5` / `true` / `[]` / `{}` / `["products"]` / `""` / `"/"` / `"/products"` / `"products/"` / `"products//x"` / `"a:b"` / `"products:1"`）→ `Invalid component instance`。形は合うが存在しない 16 種（`../products` / `products/..` / 前後の空白 / `\u0000` / `\n` / DEL / C1 `\u0085` / ` ` / BOM / 非 ASCII / 大文字 / 深いパス / 100,000 文字 / `\` / `products\note`）→ `Unknown component instance: …`。他 Instance を名乗る（id の持ち主以外の 2 つ）→ `Component {other}: Unknown or completed …`。`instance` 省略で子の id を root へ → `Unknown or completed …`
- `id` 11 種（`-1` / `0` / `1.5` / 2^53 / 2^64 / 1e300 / `"1"` / `null` / `true` / `[]` / `{}`）× 3 op、`id` 欠落 → `Missing HTTP request id`、`ok` 欠落・文字列 → `Missing HTTP result ok`、`error` 3,000 バイト → `HTTP error exceeds 2048 bytes`
- `buffer` 8 種（`0` / `-1` / `1.5` / 2^32 / `"1"` / 未割当 7 / `[]` / `{}`）× `file_result` / `rpc_result`、失敗完了に buffer → `Failed completion must not carry a binary buffer`
- 封筒: `data` と `instance` の 100,000 段ネスト（serde の再帰上限がエラー文字列で返りスタックを壊さない）、トップレベルが配列 / 文字列 / `null`、壊れた JSON、空入力、`op` が数値、未知 op、`clock` が文字列、2,000,001 バイト → `Request exceeds 2 MB`。`layout` に `instance` を付けても無視される（ok）

### コードレビュー（サブエージェント A + 親の再確認）

- トランザクション: `Runtime::complete` → `complete_at`（`lib.rs:985-1032`）→ `Instance::complete`（handler のみ。`lib.rs:1442-1564`）→ `commit_event`（emit 上方 → config 下方 → `commit_all`）で 1 commit・`revision += 1`。`commit_all`（`:1069-1140`）は root + 全子の `prepare_commit` / `prepare_effects` と dialogs / pages の `prepare` を全部集め、navigate 排他と `buffers::capacity` を全 Instance 合計で判定してから `apply` / `commit_effects` を並べる。途中の `Err` で何も動かない
- 不正な完了: `abi.rs:36-42` `take_instance`（キー無し → root / `String` かつ `valid_instance_path` → path / それ以外 → `Invalid component instance`）を 7 op が通り、`complete_at` の `components.contains_key` で `Unknown component instance`。`dialogs::Requests::consume(id, response, expected)`（`dialogs.rs:348-389`）は origin 不一致で `pending` を触らない。`dispatch(":dialog:…")` は `expected = None` で origin 側の Instance を走らせる。`Instance::complete` の `Completion::Dialog` の `unreachable!` は `complete_at` が先に `Dialog` を取り分けるので到達しない
- `take_effects`（`:1034-1065`）: root 7 連結 → `components`（BTreeMap）順に `Instance::take_effects`（http → storage → files → rpc → host）、`as_object_mut().insert("instance", path)`（`host_cancel` 含む）
- snapshot キャッシュ: `instance.state` / `instance.ui` の書き込みは `apply` のみ（`*snapshot = None` 同居）。テストの `set_state` も `apply` 経由
- JS: `host-effects.js` の `#lastId` / `#active` / `#operations` は path キー、cancel は同 path のみ、上限 8 は `activeById.size`。`http / storage / page-effects.js` は `resetInstances` + `bases.get(effect.instance ?? "")`、未登録は `onError` で WASM に送らない。`runtime.js:362-393` は `instanceTable` → 各 Instance の `hostEffects.prepare` を `engine.load` の前に行い、成功後に 6 本の `resetInstances`。`engine.js` の `withInstance` は `=== undefined` 判定、descriptors の buffer は `allocated` を `finally` で解放
- scope: Rust `component_scope`（`composition.rs:216-231`）と JS `scopeProblem`（`component-tree.js:34-43`）は等価（各要素 `[A-Za-z0-9_-]` かつ `__` 無し、連結後 80 バイト以内）。検査条件（storage または files を宣言する子のみ）も両側一致。`tests/helpers/component-scope-cases.json` 15 行を `composition_tests.rs:1062` と `tests/components-loader.test.js:240` の両方が読む
- テストの実質: `completion_grid` は 7 チャネル × 6 列で `screen_states`（root / `a` / `a/c`）・`revision`・再完了成功（pending 不変）を各セルで検証。`tests/abi.test.js` は不正 5 連の直後に `layout` 応答の文字列一致。`tests/parts-lab.test.js` 6 本（DOM / Canvas の Scene 一致、保存 → 再 load → 復元、相対 URL `/app/data/products.json`、confirm → emit → 親 state）。`tests/components-effects.test.js` 11 本
- 変異: `MUTATIONS` 7 本の `from` は `engine/src/lib.rs` に各 1 回（最終判定の build 7 本が全部 exit 0）
- 公開シグネチャ: `git diff main -- engine/src/lib.rs | grep '^[-+].*pub fn'` は追加 `load_with_bundle` / `complete` と、`complete_storage` / `complete_dialog` の `mut response` を落とした 2 行のみ（型・引数・呼び出し側不変）。既存 pub fn 16 本は全部残っている。`abi.rs` の op 名 11 個不変

### セキュリティ（サブエージェント B + 親の再確認）

CRITICAL / HIGH / MEDIUM なし。`instance` は `BTreeMap` のキーとしてしか使われず storage / FS に届かない。scope はホストが Instance 表から決め、子のスクリプト・effect から名乗れない。OPFS / IndexedDB の名前は従来どおり `safeName` / `safeKey` が門番。相対 URL は `http:` / `https:` のみで認証情報付きを拒否（root と同じ規則、回帰なし）。秘密情報のハードコード 0、新規依存 0、`Cargo.lock` 不変（rhai の `internals` を外しただけ）。LOW 2 件は下の残留リスク 1・2

### 文書の主張

- 追従先チェックリストの `git grep` 条件: 古い件数（`19個` / `宣言7種` / `23画面` / `変異5本` / `拒否2本` / `internals` / `STUBS` / `rejectSequences` / `!effect.kind`）は 0 件。8 文書の `instance` 記載は各 1 件以上（architecture 3 / components-plan 5 / dialogs 1 / files-cache-rpc 2 / host-adapters-design 1 / http-adapter 1 / platform-features 1 / tutorial-http-grid 1）。`docs/testing.md` の新テスト 2 行と probe 6 列・変異 7 本の記述は実測と一致
- `docs/components.md` の英語 6 文言と日本語 2 文言は実装の文字列と一致。**抜けているのは上の指摘 1 の 1 文言**。effect の形・連結順・`instance` の受理形・scope 規則は `lib.rs` / `abi.rs` / `composition.rs` / `component-tree.js` と一致。**指摘 2 のとおり `host_progress` の例外だけ本文が広い**
- `docs/ai-development.md:26`（T10 で発見した「子に通信・保存・ダイアログを書くコードを生成しない」の逆転）は直っている
- PROGRESS turn 13 の受け入れ 1〜9 / 直交表 / 受け入れ 5 の 5 項目 / P1〜P14 の表に出てくる `fn` 名・テスト名・probe ラベルは `cargo test` の出力と `tests/*.test.js` の `it(...)`、probe のステップ名に実在する

### 受け入れ基準 1〜9（round 1 時点）

| #   | 基準                 | 結果                                                                                                                                                 |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 全検査 green         | 最終判定の `BASE_CHECKS` 6 本 exit 0。期待値変更は PROGRESS の 3 見出し（`kind` 起因 1 件 / arity 起因 3 ファイル 6 箇所 / 撤去起因 5 本）に列挙済み |
| 2   | 挙動照合             | diffs 0（正規化は http の `kind` のみ）。変異 7 本すべて exit 1                                                                                      |
| 3   | 候補のみ probe       | 54 steps・problems 0。`parts-lab` 列が R9 の 3 項目を含む                                                                                            |
| 4   | ルーティングの格子   | `completion_grid` + `the_dispatch_entrance_of_the_grid_names_its_instance_in_the_item_id`。直交表の 8 行すべてに担当あり                             |
| 5   | 堅牢性               | 5 項目に担当あり（PROGRESS turn 13 の表）+ 本ターンの ABI 格子 315 ステップ トラップ 0                                                               |
| 6   | 契約文書と実装の一致 | **未達（指摘 1・2）**。それ以外の文言・形・規則は一致                                                                                                |
| 7   | 公開シグネチャ       | 既存 pub fn の名前・引数不変、op 名 11 個不変                                                                                                        |
| 8   | デモ                 | `tests/parts-lab.test.js` 6 本 green（Scene 一致 / 保存 → reload → 復元 / http の行 / confirm → emit → 親 state）                                    |
| 9   | 整形                 | `bun run check` green、`.gsd-lite/*.md` は `bunx vp fmt` 済み、`git status` クリーンで開始                                                           |

## 残留リスク（差し戻さない理由つき）

1. **`Unknown component instance: {instance}` に送られた文字列がそのまま載る**（`lib.rs:1001`）。`valid_instance_path` は長さを見ないので最大 2 MB 弱の文字列が応答と `onError` の表示に写る。トラップ・state 変化は無く（格子で 100,000 文字を確認）、表示は `textContent` 経由で HTML 注入にはならない。要件に文言長の基準は無い。次に `abi.rs` を触るときに `instance` の長さを 80 × 3 + 2 程度で切るか、文言側で切り詰める余地
2. **root の `id` に `__` があっても scope を持つ子がいなければ通る**: root `a__b`（子なし）と root `a` + storage 宣言の子 `b` が別画面として同じ scope `a__b` を組める。画面をまたぐ衝突は root の `id` が同じ別画面でも起きる既存の性質で、同一画面内の衝突（R5 の対象）は `__` 禁止で防げている
3. **`配送先が未登録です` の経路に自動テストが無い**（`http / storage / page-effects.js`）。通常経路では `instanceTable` のキーしか `instance` に出ない（`names only instances the shared table holds, three levels deep and twice over` で固定）ので防壁にしか当たらない。文書 `components.md:193` の契約（`onError` に落として `complete` を呼ばない）を固定する 1 本があるとよい
4. **`HostEffects` の同時操作上限が Instance ごと（最大 8 × 8 = 64）**: 決定どおり（R7 / DECISIONS Round 5）で、`components.md` の制限表に「Instance 数 × 上限」と書いてある。エンジン側の `At most 8 pending host calls` も Instance ごとなので整合
5. **`http / storage-effects.js` で配送先が無いとき WASM の pending が残る**: `onError` だけで完了を送らないので、その id は次の `load` / `compile` の `reset*` まで pending のまま。表が stale になる経路は `compile` の成功後にしか無く、そのとき世代が進んで古い effect は捨てられるので実害なし
6. **`docs/components.md:193` の「空白が 2 つ並ぶ」**: root 由来の effect で `配送先が未登録です` が出ることは `reset` 直後には無い（`""` は常に表にある）ので、実際には子の path だけが入る。文書の注記は無害

## リモート運用（合格時に行う）

- `origin` = `https://github.com/6in/uivolve-web.git`（github.com）。`gh` は認証済み（account `6in`）。合格ラウンドで `git push -u origin gsd-lite/component-effects` → `gh pr create --base main --head gsd-lite/component-effects --body-file <scratch>` を行い、URL をここと PROGRESS に記録する
