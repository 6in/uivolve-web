# VERIFICATION — component-instance-refactor

- 実施: 2026-10-07 / gsd-lite-verify（turn 7、verify_round 1）
- 対象: `git diff main...HEAD`（base `main` = `35120e0`、HEAD = `9071c03`）。コードは `engine/src/instance.rs`（新規）/ `engine/src/lib.rs`、スクリプトは `scripts/compare-engine-behavior.mjs` / `build-engine-variant.mjs` / `verify-instance-refactor.mjs`（新規 3 本）、文書は `docs/components-plan.md`（新規）と追従 4 か所
- 判定: **合格**（差し戻し 0 件。残留リスク 4 件を下に記す）
- 進め方: コードレビューとセキュリティチェックを読み取り専用のサブエージェント 2 本に並行させ、親が最終判定スクリプトと受け入れ基準の照合を前景で行った

## 観点と確認したこと

### 受け入れ基準 1〜6

| #   | 基準                                             | 確認方法と結果                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 全検査 green、既存テストの期待値・ファイル変更 0 | クリーンな作業ツリー（`git status --porcelain` 空）で `bun scripts/verify-instance-refactor.mjs` を前景で 1 回通し exit 0（13 手順すべて期待どおり、合計 37.2 秒）。`git diff main...HEAD --stat -- tests/ engine/src/extensions/ src/` が空                                                              |
| 2   | 挙動不変の照合（差分 0 と変異表）                | gate 内の照合 `steps 346 / diffs 0 / ok 325 / error 21 / sequences 41`（T1 の訂正行と一致）。変異 M1 / M2 / M3 が `diffs 165 / 2 / 1` でいずれも exit 1（歯あり）。証跡は `target/engine-compare/compare.json` と `mutant-*.json`                                                                         |
| 3   | `abi.rs` と `tests/abi.test.js` 無改修           | `git diff main...HEAD --stat -- engine/src/abi.rs` 空。`tests/` 無改修で Vitest green                                                                                                                                                                                                                     |
| 4   | `Runtime` の公開シグネチャ不変                   | `git diff main...HEAD -- engine/src/lib.rs` に `pub fn` 行の差分なし（grep 0 行）。`lib.rs` 内テスト 4 本を含む `cargo test` green                                                                                                                                                                        |
| 5   | 文書とコードの一致                               | `git grep -c -E "^    pub\(crate\) [a-z_]+:" -- engine/src/instance.rs` = 12、`docs/components-plan.md` の Instance 表も 12 行で名前・型・順序が `instance.rs:13-24` と一致。Runtime 4 フィールド表も `lib.rs:363-368` と一致。メソッド 3 本・clear 順・effects 連結順・`abi.rs` 無改修の記述も実物どおり |
| 6   | `lib.rs` に Instance 境界をまたぐ分岐なし        | `git grep -n -E "components\|HashMap<String, Instance>\|instances" -- engine/src/lib.rs engine/src/instance.rs` が 0 行                                                                                                                                                                                   |

### コードレビュー（Rust）

- `Instance::load` は旧 `load_with_clock` 本文と同順（`enter(clock)` → version → state → webmcp → pages → schema → 100 KB → normalize → validate → resolve → … → `init` → prepare 7 連 → `buffers::capacity` → commit 6 連）。`dialogs.register / prepare / commit` と `pages.register / prepare` の位置も同じ
- `clear` の順序は `dispatch` / `progress_host` / `complete_host` / `complete_rpc` / `complete_dialog` で同一。`complete_http` / `complete_storage` は `pages.clear` → `consume` → `clear_queues` → `dialogs.clear` を保つ。`complete_file` だけ `pages.clear()` が 3 番目から 1 番目へ動くが、7 本の `clear` はいずれも自分の `RefCell` を空にするだけで観測不能（PLAN 決めた事項 2 のとおり）
- `commit_state` の prepare / commit 順と `take_effects` の連結順（http → storage → files → rpc → dialogs → pages → host）は不変
- エラー文字列の集合: main と HEAD（`lib.rs` + `instance.rs`）で全リテラル 199 / `Err(` `format!(` 由来 61 がともに差 0（`scratch/turn-004-strings.mjs` を再実行）。`Err(` の件数は main 41 = HEAD 23 + 18
- 数値リテラルの多重集合が main と一致（制限値の差分なし）。`unwrap / expect` は `lib.rs` で 27 → 27、`instance.rs` は 0（新しい panic 経路なし）
- `dialogs` / `pages` を `Instance::load` の前に生成する順序変更は、両方 `#[derive(Default)]` で Drop 実装なし。副作用のある Drop（`files.rs` / `rpc.rs`）の相対順序は不変

### コードレビュー（スクリプト・文書）

- 照合スクリプトは `--base` / `--candidate` 両必須・WASM 不在・不正 flag で exit 2（実行して確認）。固定 clock を `load / event / *_result / host_progress` に付け、応答は文字列一致、最初に異なる JSON 経路を表示、ハッシュは使わない。base で確定した動的 id と `buffer_store` の列を candidate にそのまま再生するので、id の差も応答差分として出る。手順内で例外が出ると要約を出さずに落ちる設計なので、手順の取りこぼしで `diffs = 0` になることはない
- 変種ビルドは `git worktree add` → cargo → `cp` → `finally` で `worktree remove --force`。変異は `engine/`（`engine/target` 除外）+ `public/themes/` を写し、`from` がちょうど 1 回のときだけ置換（0 回・複数回は exit 2。`--mutation nope` / mode 両指定 も exit 2 を実行で確認）。作業ツリーの `engine/` は触らない（実行後も `git status --porcelain` 空）
- 最終判定スクリプトは手順配列どおりに回し、変異で exit 0 なら「歯なし」として 1 を返す。`--base-commit` 不正 / 不明 flag は exit 2（実行で確認）
- 文書: `components-plan.md` の冒頭定型・設計決定 8 論点・段階計画・フィールド表・残課題（thread_local 5 か所の列挙）を実物と照合して一致。`docs/testing.md:85` の手順列は `BASE_CHECKS` と一致、「変異3本」= `MUTATIONS.length`。`architecture.md` 2 行 + 2 文、`README.md:99`、`docs/README.md` 1 行はいずれも存在。PLAN「追従先チェックリスト」5 行の確かめ方を再実行してすべて成立。`Runtime` API を使う 4 文書は無変更（diff 空）

### セキュリティチェック

- 入力検証と上限: `Instance::load` に移った検査はすべて同順で残る（version / state object / webmcp / pages / schema / script 100 KB / node 200・深さ 20 / Engine 6 上限 / `init` 必須 / http・storage・files 各 8 件 / URL 2048 / `safe_key` / rpc handler / `check_state` 2 回 / `buffers::capacity` / init 中の navigate 禁止）。`abi.rs` の 8 descriptors・2 MB も不変
- 秘密情報: 追加行にトークン・資格情報・個人情報なし（公開リポジトリ URL のみ）
- インジェクション: 3 スクリプトの子プロセスはすべて引数配列の `spawn / spawnSync`。`shell: true` / `exec` / `eval` / `new Function` / 動的 import なし。`WebAssembly.instantiate` の imports は `{}`
- 作業ツリーへの書き込みは gate の `build:wasm` / `build` が従来どおり行うもののみ

### 文書の主張・期待値の変更

- 冒頭要約と本文の不一致・古い件数なし。impl が PROGRESS に書いた「既存テストの期待値の変更: なし」は `git diff` で裏づけ
- PLAN の訂正行（T1 直下の 4 値、決めた事項 8 の 5 件、決めた事項 9 の `from`、追従先チェックリスト 1 行目）は実測を正としたもので、要件・決定には触れていない

## 残留リスク（差し戻さない理由つき）

1. **`rpc-result` 列が `complete_rpc` の Rhai handler 経路に届いていない**: `rpc_result:ok` の 4 byte バッファは Protobuf デコードに失敗し（tag 0 不正）、その失敗が id を消費するので `rpc_result:failed` は「完了済み id」のエラーになる。handler の本文（`lib.rs:691-719`）は他の `complete_*` と同型の機械置換で、文字列集合と数値集合の一致で裏づけられるが、応答照合では実証されていない。PLAN 決めた事項 8 が「デコード失敗ならそのエラーを照合」と明示して受け入れた形なので差し戻さない。段階 4 で `rpc_result` の成功経路（デコード可能な応答）を列に足すこと
2. **`handlerNodes` が `items` しか降りない**: `menu` / `bbar` / `tbar` / `buttons` 配下の handler（`uivolve-gallery` の `saveAs` / `saveDraft` / `sendMessage` / `clearChat`）は dispatch されていない。dispatch の経路は同じで、他の 22 画面の 137 handler で差分 0 のため差し戻さない。照合列を広げるときに `handlerNodes` の走査先を増やす
3. **スクリプトの堅牢性（ローカル開発用ツール）**: 子プロセスにタイムアウトなし（`max_operations` を失った変種は差分ではなくハングになる）。`--commit` を `git` に `--` 区切りなしで渡す。`rmSync` の対象が `--scratch` + 固定接尾辞。`rpc-demo.pb` 不在は exit 2 ではなく ENOENT で落ちる。SIGTERM が cargo 実行中に来ると `finally` を通らず worktree が残り得る（`git worktree prune` で回復）。いずれも開発者が自分の引数で回す道具で、要件に堅牢性の基準はない
4. **文書の言い回し**: `docs/testing.md:85`「全画面のload・イベント・完了・layout」と `components-plan.md:10` の現在形「親子を扱う」は上記 1・2 の範囲で広めに読める。`components-plan.md:4` と「使い方」節の冒頭が段階 3 以降と限定しているので差し戻さない

## リモート運用

- `origin` = `https://github.com/6in/uivolve-web.git`、`gh` 認証済み。ブランチを push して PR を作成する（ローカルマージはしない）
- PR: <https://github.com/6in/uivolve-web/pull/1>（base `main`、ブランチ `gsd-lite/component-instance-refactor`。マージは人間 / CI）
