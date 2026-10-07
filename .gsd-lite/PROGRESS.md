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

## turn 2 — plan — 12 タスク（照合拡張 1 / Rust 6 / JS 1 / デモ 1 / 証跡 1 / 文書 1 / 最終判定 1）

- やったこと: base WASM `target/engine-compare/base-ef582d5.wasm` を `build-engine-variant.mjs --commit main` で作り、拡張照合列を `scratch/turn-002-sequences-probe.mjs` で base へ流して到達を確認（`rpc_result` デコード可能応答で revision 1→2・`state.message` が届く / `saveSplit-menu` toggle 後の `saveDraft` で revision 1→2、`saveAs` で revision 2 + `modal` promptDialog / `galleryViews` tab 4 後の `clearChat` で 1→2、`chatInput` 入力後の `sendMessage` で 2→3、空入力の `sendMessage` は handler throw の error 応答 / 直接 event は全部 `ok` で revision 0 / 拡張走査の追加は gallery の 4 件のみ）。PLAN.md を 12 タスク・決めた事項 18 件・追従先 9 行で作成。layout は (H)、dispatch の移動先は `lib.rs` 内 `impl Instance`（変異 M1〜M3 を壊さないため）、`Runtime.components` は BTreeMap、子で拒否する宣言に `operations` を追加
- 想定外: (1) README.md の画面数「21画面」「12画面」が既に古い（カタログ 22 件）。追従先チェックリストで「23画面」に揃える。(2) 属性検査を normalize 後に「既定 Node と比較」する案は `extras.rs:187-212`（accordion / radiogroup が子のフィールドを書き換える）で誤検出するため、normalize 前の template 走査に変更。(3) `extras::normalize` 等の `register_fn` を `git grep` の 1 行パターンで引くと複数行登録が漏れる（RESEARCH §1.5 の表を正とし、テストで `register_fn` の件数と突き合わせる形にした）
- やり直し: 0 回
- 次への注意: T1 は `handlerNodes` の走査拡張で `uivolve-gallery` の baseSteps が 4 組増え、新列 3 本を足しても base と候補が同じソースなので差分 0 になるはず。差分が出たら列の `build` が `ctx.latest` / `ctx.at` で id を解決しているかを疑う。「会話」タブの index は pkg から算出（プローブでは 4）。T2 以降は Rust を触るたび `bun run build:wasm` を先に。lean-ctx MCP は未接続のまま（PROGRESS には書かない）

## turn 3 — impl — T1 照合列の拡張と base 証跡

- やったこと: `compare-engine-behavior.mjs` の `handlerNodes` を font-parity の `NODE_CHILD_KEYS` と同じ 7 キー走査（配列・非オブジェクトを弾く形）にし、新列 3 本（`rpc-result-decodable` / `gallery-menu` / `gallery-bbar`）と `pkg.components` が空でない画面を除外する分岐を `buildPlan()` に追加。`docs/testing.md` の照合段落に走査キー・新列 3 本・components 除外の 3 文を足した。base `ef582d5` との照合は 346 歩 41 列 → 370 歩 44 列で差分 0（内訳: gallery の新 handler 4 件 × event+layout = 8 歩、新列 3+7+6 = 16 歩）
- 想定外: (1) PLAN 訂正: `handlerNodes` の走査キー `items / menu / tbar / bbar / buttons` → `items / columns / menu / tbar / bbar / buttons / lanes`（根拠: `tests/browser/font-parity.mjs:1485` の `NODE_CHILD_KEYS` は 7 キーで、PLAN の「同じ集合」という指定と列挙が食い違っていた。`scratch/turn-003-childkeys-probe.mjs` で全 22 画面 + font-parity fixture 4 本について 5 キー版と 7 キー版の走査結果が順序まで完全一致することを実測したので、font-parity と literally 同じ集合を採り、追従先チェックリストの「両ファイルの集合が一致」を満たせる方に寄せた）。(2) `columns` を辿っても `columns[].editor` に `handler`+`itemId` を持つノードは現状 0 件（上記プローブ）
- やり直し: 0 回
- 次への注意: T1 の到達証跡（`scratch/turn-003-revisions.mjs` を `public/engine.wasm` に流した revision。label 単位、P11）: `rpc-result-decodable` load 0 → `event:connect` 1 → `rpc_result:decodable` 2（EchoResponse 15 バイト）/ `gallery-menu` load 0 → `saveSplit-menu` 1 → `saveDraft` 2 → `saveSplit-menu:2` 3 → `saveAs` 4 / `gallery-bbar` load 0 → `galleryViews`（tab 4）1 → `clearChat` 2 → `chatInput` 3 → `sendMessage` 4 → `sendMessage:2` は `ok: false`（空入力で handler が throw。文言は `uivolve-gallery.rhai / sendMessage / sendMessage: Runtime error: メッセージを入力してください。 (line 23, position 21)`）/ 全画面列の直接 event（`saveAs` / `saveDraft` / `sendMessage` / `clearChat`）は 4 件とも `ok: true` で revision 0 のまま。T2 は Rust を触るので `bun run build:wasm` → `bunx vp test run` → `bun run test:rust` → 照合 → `bun run check` の順。`validate` のシグネチャ変更が `lib.rs` / `instance.rs` / `dynamic_ui.rs` に波及するので呼び出し元を先に `git grep -n 'validate('` で洗う。`docs/testing.md:85` は T10 でも触る（変異 5 本・`composition.json`）ので、今回足した 3 文の後ろに続ける形にする
