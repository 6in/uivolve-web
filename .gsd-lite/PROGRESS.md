# PROGRESS — component-instance-refactor

恒常の注意（毎ターン写さない。変わったらここを直す）:

- 入口は `gsd-lite-loop.sh --where`（本マイルストーンは mode=repo、`$MS` = `.gsd-lite`、`$TARGET` = `.`）。
- lean-ctx フックが `.gsd-lite/` `scripts/` `tests/` 配下への `cat` / `sed` / `grep` / `tail` を「project root 外」で拒否する。読みは Read ツール、検索は `git grep`（追跡ファイル）/ `bun -e`（未追跡）。`sha256sum` / `cp` / `rm` / `cargo` / `bun` / `git worktree` は通る。lean-ctx の MCP ツール自体は未接続。
- base（main = `35120e0`）の WASM は `.gsd-lite/logs/component-instance-refactor/base-main-35120e0.wasm` に保存済み（gitignore）。無ければ RESEARCH §3 の手順で 30 秒で再現できる。`bun run build:wasm` は `public/engine.wasm` を上書きするので base と混同しない。

## turn 1 — research — 現状構造の棚卸し・画面一覧・照合の実測・Rhai 公式

- やったこと: `Runtime` 全フィールドの利用箇所と thread_local を表にし、22 画面の handler / 非同期機能の一覧を Node 実行で作り、base と現行の WASM に 230 リクエストを流して差分 0 / 同一 WASM 2 インスタンスで差分 0 / 変異で差分 137 を実測。Rhai 1.26 の Engine / AST / call_fn / no_module を公式から確認。RESEARCH.md に落とし穴 14 件と検証方法、要件への提案 4 件を書いた。重大発見なし（BLOCKED しない）
- 想定外: (1) 同一ソースを別 `--target-dir` で 3 回ビルドした WASM の sha256 が 3 つとも違う（1 byte 差）。バイト比較は照合に使えないことが確定。(2) `engine/` だけを写した変異コピーが `include_str!("../../public/themes/*.json")` で compile error。`public/themes` を足して解決。(3) lean-ctx フックが `cat scripts/build.mjs` 等を拒否（前回振り返りどおり）。(4) ランダムな `Engine` 生成コストや `no_module` の API 単位の影響は公式ページに明記が無く、「モジュール読み込み無効」の範囲でしか書けなかった
- やり直し: 1 回（変異ビルド。`public/themes` 不足で compile error → 写して再ビルド 7 秒）
- 次への注意: plan は RESEARCH §5 の P1〜P14 をタスクの完了基準に対応付ける。照合スクリプトは `scratch/turn-001-compare.mjs` を雛形にしつつ、差分表示を「最初に異なる JSON 経路」に変える（P7 の変異で先頭 200 文字では差分箇所が読めなかった）。空 payload で失敗する部品種（slider / checkbox / panel / window / grid / kanban）の代表 payload を plan で決める。`git worktree list` は 1 行（本ターンで後始末済み）、scratch の target dir も削除済み

## turn 2 — plan — 4 タスク（T1 照合・変種ビルド script / T2 Instance リファクタ / T3 設計文書と追従 / T4 最終判定 runner と全検査）

- やったこと: REQUIREMENTS / DECISIONS / RESEARCH と `lib.rs:362-1142` / `abi.rs` / 7 つの `Requests::clear` / docs の追従先を実物から読み、PLAN.md を作成。Instance の 12 フィールドとメソッド 3 本（`load` / `clear_queues` / `state_json`）、`commit_state` と `take_effects` を Runtime に残す理由、代表 payload 表、追加シーケンス 15 本、変異表 M1〜M3、落とし穴 P1〜P14 の担当表、振り返り提案の採否を「決めた事項」「メモ」に固定した。`abi.rs` は `revision` が `pub` のまま Runtime に残るので無改修で済む見込み
- 想定外: (1) lean-ctx の MCP ツール（`ctx_*`）が ToolSearch で見つからず未接続。通常ツールで進めた（恒常注意どおり）。(2) スキル本文の `.gsd-lite/gsd-lite-loop.sh` 相対パスは存在せず、PATH 上の `gsd-lite-loop.sh --where` で解決（前回振り返りどおり）。(3) `git grep -A4` はオプション順の都合で失敗し、各 `clear` の本文は Read で 7 か所読んだ
- やり直し: 1 回（ツール指定修正: `git grep ... -A4` のオプション位置でエラー → Read に切替）
- 次への注意: T1 は base WASM を `scripts/build-engine-variant.mjs --commit 35120e0` で作り直して script 自体を実証する（research 保存分の `.gsd-lite/logs/.../base-main-35120e0.wasm` は比較用の予備）。変異 M1〜M3 の `from` 文字列は「ちょうど 1 回」を script が検査するので、refactor（T2）後に動いたら `from` だけ直して PLAN 決めた事項 9 に訂正行を書く。`public/screens/rpc-demo.pb` は `bun run build:wasm` が生成する（gitignore）ので照合の前に必ず 1 回回す
