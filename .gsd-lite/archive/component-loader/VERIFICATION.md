# VERIFICATION — component-loader（段階 5: 子を含む画面の配信キャッシュ）

- 実施: 2026-10-09 / gsd-lite-verify（turn 14、verify round 2。round 1 は turn 11）
- 対象: `git diff main...HEAD`（main `aa79bd1` → HEAD `308eb0a`。39 ファイル / +4,209 / −1,216）。round 1 の HEAD `844162e` からの差分は F1（`docs/components.md` / `docs/files-cache-rpc.md`）と F2（`src/application-loader.js` 1 行 + `tests/components-loader.test.js` 1 本 + `docs/files-cache-rpc.md` 1 句）だけ
- 実行エンジン: Claude Code（Claude Fable 5.1）。round 2 はサブエージェントなし（round 1 の格子の再確認 + F1 / F2 の回帰だけで、新しいクラスの探索はしない）
- 判定: **合格**。受け入れ基準 1〜9 を満たし、round 1 の指摘 F1 / F2 は完了基準どおりに直っている。リモートは github.com なので push + PR 作成（ローカルマージはしない）
- PR: https://github.com/6in/uivolve-web/pull/4（`gsd-lite/component-loader` → `main`。マージは人間 / CI）

## round 2 で確認したこと

### 最終判定（クリーンな状態から再実行）

`git status --short` が空の HEAD `308eb0a` で `bun scripts/verify-instance-refactor.mjs` → exit 0（`.gsd-lite/logs/component-loader/scratch/turn-014-verify.log`。85.9 秒）。F2 で `src/application-loader.js` が 1 行動いたので再実行が必要だった。

| 手順                                                   | 結果                                         |
| ------------------------------------------------------ | -------------------------------------------- |
| `bun run build:wasm` / `bunx vp test run`              | 0 / 0（Vitest 35 files / **716** passed）    |
| `bun run test:rust` / `bun run check`                  | 0 / 0（cargo 91 passed）                     |
| `bun run docs:check` / `bun run build`                 | 0 / 0                                        |
| base `aa79bd1` との照合 / probe composition            | 370 ステップ 差分 0 / 54 ステップ problems 0 |
| 変異 7 本（`build-engine-variant.mjs` の `MUTATIONS`） | 各 exit 1（検出 171・2・1・7・2・19・12 件） |

Vitest は round 1 の 715 から 716 に増えた（F2 のテスト 1 本）。

### round 1 の格子の再確認（新規探索なし）

- `bun .gsd-lite/logs/component-loader/scratch/turn-011-lattice.mjs` → 83 ケース / NG 0（round 1 と同じ出力。F2 後も変化なし）
- `bun .gsd-lite/logs/component-loader/scratch/turn-009-checks.mjs` → 追従先チェックリスト 14 行 / NG 0
- `bun .gsd-lite/logs/component-loader/scratch/turn-010-t8-checks.mjs` → T8 固有 11 条件 / NG 0（`lib.rs` 0 行差分、`withoutComponents` 0 件、デモ 3 画面の sidecar が version 2、生成物は gitignore 済み、`git status` 空）

### F1 の回帰（契約文書 4 か所）

PLAN F1 の期待結果の表を再実行:

| 条件                                                                              | 実測                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `git grep -n -F 'sha256 / size' -- docs`                                          | 0 件                                                                 |
| `git grep -n -F '`components`の形' -- docs/components.md docs/files-cache-rpc.md` | 0 件                                                                 |
| `git grep -c -F '通信に失敗し、利用できる保存版もありません' -- (2 文書)`         | 1 / 1                                                                |
| `git grep -n -F 'publish-packages' -- docs/components.md`                         | 3 件（`:202` 宣言不正、`:208` 2 MB、`:257` 循環・深さ・Instance 数） |
| `turn-009-checks.mjs`                                                             | 14 行 / NG 0                                                         |
| `bun run check` / `bun run docs:check`                                            | exit 0（最終判定に含む）                                             |

4 件とも実装と一対一になった: `docs/components.md:181` は sha256 だけ（`sameHashes` と一致）、`:205` と `docs/files-cache-rpc.md:109` は「子エントリの形」と「`components` 自体は `配信マニフェストが不正です`」に分けた（`manifest()` の先頭の判定と一致）、`:202` / `:257` は生成スクリプトの帰属と `{URL}` が絶対ファイルパスになる 1 句、`通信に失敗し、利用できる保存版もありません` の基本形と括弧付きの派生が両文書にある（`restore` の末尾と一致）。

### F2 の回帰（子キーの絶対化の基準）

- コード: `fetch` の network-first は `#childIndex(metadata, url)`（`application-loader.js:415`）、`restore` は `#childIndex(metadata, url)` と `#fromStore(directory, metadata, url, signal)`（`:568,:573`）、`save` は `httpUrl(children[i], candidate.url)`（`:462`）。3 入口とも root の画面 URL 基準で揃った。`manifest(value, sidecar)`（`:386-389`）と `#fromManifest(index, sidecar, signal)` の `open`（`:420`）は配信ファイルの `url` の基準なので sidecar のまま（F2 の完了基準どおり）
- テスト: `tests/components-loader.test.js` に `resolves a child key against the screen URL rather than the sidecar` が 1 本。impl は修正前に `status: "network"` で通ること（差別力）を turn 13 で実測している
- `bunx vp test run tests/components-loader.test.js tests/publish-packages.test.js tests/files-cache-rpc.test.js` → 3 files / 83 passed（既存の相対キーのテストは期待値不変）
- 文書: `docs/files-cache-rpc.md:105` に「`base` は root の画面 URL（sidecar ではない）で、配信からの取得・`save`・`restore` のすべてで同じ基準」
- round 1 の申し送り（格子はキーだけ替えて revision を再計算していなかったので、形の検査の先に到達していなかった）に従い、`scratch/turn-014-lattice-f2.mjs` で基準に依存するキーを **revision 再計算つき**で流した → 10 ケース / NG 0:
  - 宣言済みの `a.json` の横に `""` / `?x` / `#f` / `parent.json` / `parent.json.manifest.json` / `zzz.json` を足す → すべて `（宣言に無い子: {画面 URL 基準の href}）` で拒否（`""` → `parent.json`、`?x` → `parent.json?x`、`#f` → `parent.json#f`）
  - F2 のシナリオ（唯一の子キー `"?x"`、宣言が sidecar + `?x`）→ `（マニフェストに無い子: …parent.json.manifest.json?x）` で拒否し、子の配信ファイルは開かれない
  - 宣言が画面 URL 基準の `parent.json?x` を指す木 → candidate の `components` キーが `…/parent.json?x` の 1 つで、`save` → 通信障害 → `restore` が同じキーで往復する（F2 の背景だった「`fetch` が通した木を `save` が拒否する」が消えている）
  - 画面 URL 基準でだけ衝突する 2 キー（`""` と `parent.json`）→ `manifest()` の重複判定は sidecar 基準なので通るが、`#childIndex` で 1 エントリに畳まれ `（宣言に無い子: …parent.json）` で拒否。`TypeError` にも無言の candidate にもならない

### 既存テストの期待値の変更

F1 / F2 とも無し（F2 は追加 1 本のみ。impl の PROGRESS turn 12 / 13 の記載と `git diff 844162e HEAD -- tests` が一致）。round 1 で確認した T5 の暫定 1 本の削除はそのまま。

### セキュリティ（F2 の差分だけ）

`#childIndex` に渡す `url` は `fetch` 冒頭の `httpUrl(value)` が検証済みの `URL`（`:360`）。キーは引き続き `httpUrl(key, base)` を通るので `javascript:` / `data:` / 認証情報付きは round 1 と同じく `マニフェストのコンポーネント情報が不正です`。新しい露出は無い。

## round 1 の記録（turn 11。要約）

受け入れ基準 1〜9 は round 1 ですべて OK（根拠の行番号は turn 11 の VERIFICATION、PROGRESS turn 10 の表）。round 1 の格子は 83 ケース / NG 0。サブエージェント A（契約文書 ↔ 実装の一対一）の不一致 4 件 → F1、サブエージェント B（セキュリティ）の指摘 4（子キーの基準）→ F2。B の他の指摘（1 / 2 / 3 / 5 / 6）は下の残留リスク。round 1 の詳細は `git show 0975f7e:.gsd-lite/VERIFICATION.md`。

## 残留リスク（差し戻さない）

1. **`network-only` の宣言単位の取得に件数上限が無い**（round 1 B-1。既存）: root が置かない宣言を大量に持てば取得・保持が膨らむ。対策候補は「1 パッケージの宣言は 8 件まで」をローダーの `#walk` と生成側に足すこと（Rust の `At most 8 component packages` と同じ数）。本マイルストーンの要件外
2. **トークンだけの差し替えは共有を無効化しない**（B-2。仕様）: 利用者の切り替えで子の本体を取り直すには `load(..., { refreshEngine: true })` か認証メタデータの変更が要る。`docs/components.md` に文書化済み
3. **`screen.id` 非文字列・`rpc` の値が `null` で `TypeError`**（B-3。既存）: 表示は `画面を読み込めませんでした。…` で UI は保たれるが、文言は日本語の契約文言ではない。`parsePackage` で `id` を文字列に限定し `rpc` の値を object に限定する検査を足せば閉じる
4. **復元の失敗理由に処理系の文言が混ざる**（round 1 の格子）: `current.json` が `null` のとき `通信に失敗し、利用できる保存版もありません（null is not an object (evaluating 'stored.url')）`。未捕捉ではなく UI も不変だが、`stored` の形の検査を `manifest()` の前に足せば日本語の文言になる。`NotFoundError` を `last` に握らないので、版ディレクトリの中の子ファイルだけが消えた場合は理由なしの基本形になる
5. **`current.json` が `null` だと `save` が毎回失敗**（B-6。既存）: `JSON.parse` は通るが `.url` で `TypeError`。`restore` と同じく `last` 相当で握るか `clear` を案内する
6. **決めた事項 2 の非対称**（PLAN の申し送り）: load できた 257 バイト超の接頭辞付き `instance` の子は完了を受け取れない。`docs/components.md` の制限表に itemId を範囲に収める注意を書いた
7. **決めた事項 1（descriptor を合計に含めない）**: REQUIREMENTS R4 の「木のファイルの `size` 合計」より狭いが、DECISIONS と契約文書は狭めた定義で一致している。descriptor には 1 MB / 8 件の上限が別にある
8. **配信バイトの UTF-8 / JSON 不正は `TypeError` / `SyntaxError`**（round 1 の格子 軸 1b。既存の root 経路と同じ）: `NETWORK` ではないので復元へ落ちず、`main.js` で表示する。UI は不変
9. **`#walk` が共有エントリの `screen` を直接書き換える**（決めた事項 7。設計）: 絶対 URL への代入なので冪等だが、将来 `declaration` に別のキーを足す変更は共有との相互作用を見ること
10. **`manifest()` の重複判定と 2 MB 文言の「最大の子」は sidecar 基準のまま**（F2 の範囲外。impl turn 13 の申し送り）: `fetch` では `manifest(value, sidecar)` が子キーの重複を sidecar 基準で判定し、`#childIndex` は画面 URL 基準で索引を組む。通常の相対キーでは同じ href になる。画面 URL 基準でだけ衝突する `""` + `parent.json` は round 2 の格子で `（宣言に無い子: …）` に収まることを確認した（上）。拒否するかどうかは合計バイト数で決まり基準に依らず、違いが出るのは 2 MB 超の文言に出る「最大の子」の表示だけ。`manifest()` に画面 URL を渡す（配信ファイルの `url` だけ sidecar で解決する）形にすれば基準が 1 つになる
