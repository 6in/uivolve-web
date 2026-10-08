# PROGRESS — component-effects

## turn 1 — research — effect / 完了 / scope / JS 配送の現状と挿入点を RESEARCH.md に集約

- やったこと: `engine/src/{http,storage,files,rpc,host,dialogs,pages,abi,instance,composition}.rs` と `lib.rs` の完了経路・`take_effects`・`commit_all`・`layout_scope`、`src/{runtime,engine,http-effects,storage-effects,host-effects,page-effects,rpc-client,storage-client,file-client,opfs,application-loader}.js`、照合 / probe / 変異 / 最終判定スクリプト、前回 VERIFICATION の残留リスク 1・3・9 を読み、サブエージェント 2 本（official_docs: Rhai / OPFS / Web Locks / serde、similar_oss: Elm / OTP / redux-loop / Pulumi / ExtJS）の報告を §3 / §4 に要約した。落とし穴 14 件と要件への提案 12 件を記録
- 想定外: (1) R5 の区切り `__` は itemId `a__b` とパス `a/b` で同じ scope になる（要素に `__` を禁止する 1 行で解決。BLOCKED にはしない）。(2) 子の `rpc` は ABI に descriptors の同梱が無く今のままでは必ず load エラー（R1 の前提として plan に入れる）。(3) `HostEffects.#lastId` が画面 1 本なので root と子の同じ id が衝突する。(4) `UiRuntime` には `dialog_result` を送る経路が無い（独自ホスト用 ABI のみ）。(5) `http-grid.json` は静的 JSON を取得する画面で worker mock API は使わない（R9 の文言とずれ）
- やり直し: 0 回
- 次への注意: plan は §7 の提案 1（scope の `__` 禁止）・2（段階 3 の拒否テスト 5 件 + probe 2 列の撤去を受け入れ 1 の免除として列挙）・3（http の子の検証は `resources.text` 差し替え）を DECISIONS に書いてから PLAN を組む。公開シグネチャは §1.5 (b)（`complete(instance, Completion)` 1 本）を推奨。origin タグ (T) で `dialogs` / `pages` の Intent に主を持たせる。R8 は `apply` が唯一の書き込み点なので lazy snapshot で足りるが、テスト helper `set_state` を `apply` 経由に直す。lean-ctx の MCP は未接続（通常ツールで進めてよい）。`git grep` はフラグを pattern の前に置く
