# PROGRESS — component-composition

恒常注意（全ターン共通）:

- `.gsd-lite/` 配下の読みは Read ツール、検索は `git grep -n -A<N> -E '<pattern>' -- <paths>`（フラグは pattern の前。後ろに置くと revision 扱いで失敗）。`cat` は lean-ctx フックが拒否する
- 変更した Markdown / JS は `bunx vp fmt <path>`、Rust は `cargo fmt --manifest-path engine/Cargo.toml`。コミット前に `bun run check`
- サブエージェント依頼文には「`git checkout` / `git restore` / `git stash` / `git reset` を使わない」「整形は対象ファイルだけ `bunx vp fmt <path>`」「結果はファイルに書いて終わる」を入れる

## turn 1 — research — Rhai internals の実測・合成の挿入点・照合列の到達確認

- やったこと: `engine/src` / `src` / `scripts` の挿入点を洗い出し RESEARCH.md §1-2 に整理。scratch worktree で rhai `internals` を足して release WASM をビルド（+2,499 バイト、33 秒）し `AST::walk` の検出範囲を Rust テストで実測（closure 内は拾う、`Fn("name")` は拾えない）。`rpc_result` 成功経路（Protobuf 15 バイト）と menu / bbar の handler 4 件の到達条件を現行 WASM で実測。落とし穴 P1〜P16 と要件への提案を記録
- 想定外: (1) `git grep` のフラグを pattern の後ろに置くと `fatal: unable to resolve revision` で失敗（4 回）。(2) lean-ctx MCP が未接続で `ctx_*` ツールが無く、通常の Read / Bash で進めた（PROGRESS には書かない方針だが初回のみ記録）。(3) `Fn("navigate")` は `walk` に `FnCall` として現れない（定数畳み込みで `FnPtr`）— 実行時拒否が必須という DECISIONS の前提を裏付けた
- やり直し: 1 回（walk probe の関数名 `go` が Rhai 予約語で ParseError → `jump` に改名）
- 次への注意: plan は RESEARCH §5 の到達条件（menu は toggle 後、bbar は tab 4 切替後、`sendMessage` は `chatInput` 入力後）を列に写し、PLAN 固定前に base WASM（`main` = ef582d5。`target/engine-compare/base-ef582d5.wasm` は未作成）へ 1 度流す。layout の文脈受け渡しは (H) thread_local スナップショットを推奨、(B) 明示文脈が代替（§1.3）。ABI の同梱形は `request.components[絶対URL]`（§2）。`.gsd-lite/*.md` は `bunx vp fmt` 済みでコミットする
