# PLAN — component-webmcp（段階 6: WebMCP の合成）

- 作成: 2026-10-10 / gsd-lite-plan（turn 2）
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md（HEAD `fa22d26` = main `52ec888` + discuss / research の 2 コミット）
- 前提の実測: `bun scripts/verify-instance-refactor.mjs` を base HEAD（main `52ec888`）に対して turn 2 で 1 回実行し exit 0（照合 370 歩・差分 0、probe 54 歩・問題 0、変異 7 本すべて検出。ログ `.gsd-lite/logs/component-webmcp/scratch/turn-002-verify-base.log`）。ハーネスの陳腐化は無く、T1 に直す行は不要

## 検証コマンド

impl の各ターンがテストに使うコマンド（リポジトリルートで実行）:

```bash
# 整形（bun run check の前に、編集した src / tests / scripts / docs / .gsd-lite のファイルへ掛ける。整形後に対象テストをもう 1 度回す）
bunx vp fmt <編集したファイル…>
cargo fmt --manifest-path engine/Cargo.toml
# Rust
cargo test --manifest-path engine/Cargo.toml
# WASM を作り直してから JS（Rust を触ったターンは必ず build:wasm を先に。tests/*.test.js は public/engine.wasm を読む）
bun run build:wasm
bunx vp test run                       # 全部
bunx vp test run tests/<file>.test.js  # 1 本
# lint / fmt 判定（exit code はこれで見る。Markdown だけを vp check に渡すと lint 対象 0 件で非 0 になる）
bun run check
bun run docs:check
# 合成の probe と照合（Rust を触ったターン）
bun scripts/probe-composition.mjs --candidate public/engine.wasm
bun scripts/compare-engine-behavior.mjs --base target/engine-compare/base-52ec888.wasm --candidate public/engine.wasm
```

- 環境の初期化（テストの前に毎回）: なし（`bun run build:wasm` が `public/engine.wasm` と同梱デモのマニフェスト `public/screens/*.manifest.json` / `packages/` を再生成する。どちらも gitignore 済み）
- `bun run check` の前に `bunx vp fmt <編集したファイル>` を掛け、整形後に対象テストをもう 1 度回す。`Edit` は整形の後に読み直してから行う（前回 reflect Minus 1）
- 最終判定（クリーンな状態から全検査。verify と T8 が使う）: `bun scripts/verify-instance-refactor.mjs`（既定 `--base-commit main`。約 5 分。`build:wasm` → `vp test run` → `test:rust` → `check` → `docs:check` → `build` → base 照合（差分 0）→ probe → 変異全本が exit 1）。T6 で変異を 1 本足すので最終判定の表示は「変異 8 本」になる
- `target/engine-compare/base-52ec888.wasm` は turn 2 の最終判定で作成済み。無ければ `bun scripts/build-engine-variant.mjs --commit 52ec888 --out target/engine-compare/base-52ec888.wasm`

## 追従先チェックリスト

各行に連番。T8（最終判定型）は全行を再実行し、PROGRESS に「行 1 … 行 N」の表で書く（行数が合わなければ未完了）。
「確かめ方」の `git grep` は plan のターンで 1 度実行し、現状のヒット数を「現状」に書いた。

| #   | 変更の種類                                                 | 直す場所                                                                                                                                                                                                                                                                                                 | 確かめ方                                                                                                                                                                                                                                                                                             | 現状（turn 2）                                                                                       |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | 子パッケージの `webmcp` 拒否を撤去                         | `engine/src/composition.rs:233-240`（`reject_effect_declarations` 削除）/ `engine/src/instance.rs:65-67`（`if component { … }` 削除）/ `engine/src/composition_tests.rs:681-719` / `scripts/probe-composition.mjs:273-274,312-319` / `docs/components.md:108,166-170,197,275`                            | `git grep -n -F 'reserved for a later stage' -- src engine docs scripts tests` が 0 件、`git grep -n -F 'reject_effect_declarations' -- engine scripts tests` が 0 件、`git grep -n -F 'child-webmcp-refused' -- docs scripts tests` が 0 件                                                         | 7 件（components.md 170/172/197、composition.rs 239/246、composition_tests.rs 672/717）/ 3 件 / 3 件 |
| 2   | `window` の拒否文言から括弧を落とす（挙動は不変）          | `engine/src/composition.rs:246` / `engine/src/composition_tests.rs:672` / `docs/components.md:172`                                                                                                                                                                                                       | `git grep -n -F 'window is not available in components' -- engine docs` が 3 件（rs / tests / md）で、いずれの行にも `reserved` が無い                                                                                                                                                               | 3 件（すべて `(reserved for a later stage)` 付き）                                                   |
| 3   | `Scene` に `components[]` を足す                           | `engine/src/lib.rs:353-366`（`Scene`）/ `src/ui-tools.js:134-147`（`ui_get_screen` の戻り）/ `docs/webmcp.md`「次の拡張点」/ `docs/platform-features.md:112-131`「WebMCP の記述」/ `docs/components.md`（「子の `webmcp`」節を新設）                                                                     | `git grep -n -F 'components: snapshot.scene.components' -- src` が 1 件、`git grep -n -E 'components\[\]' -- docs/webmcp.md docs/platform-features.md docs/components.md` がそれぞれ ≥ 1 件、`git grep -n -F 'skip_serializing_if = "Vec::is_empty"' -- engine/src/lib.rs` が `components` 行に 1 件 | 0 件 / 0 件 / 0 件                                                                                   |
| 4   | probe の列を置き換え、ステップ数と列 ID が変わる           | `scripts/probe-composition.mjs` / `docs/components.md:281`（「6列・54ステップ」「列IDは …」）/ `docs/testing.md:91`（「3つの列を1つのWASMへ流し」「子の`webmcp`はload時に拒否される」）                                                                                                                  | `git grep -n -E '54 ?ステップ                                                                                                                                                                                                                                                                        | 3つの列                                                                                              | child-webmcp-refused                                                                                                                                                                                      | はload時に拒否される' -- docs`が 0 件。新しい数字は`target/engine-compare/composition.json`の`steps`/`sequences` と一致（T6 の実測を書く） | 54ステップ 1 件（components.md:281）/ 3つの列 1 件（testing.md:91）/ 拒否される 1 件（testing.md:91） |
| 5   | 変異を 1 本足す（M8 `components-omitted`）                 | `scripts/build-engine-variant.mjs:9-65`（`MUTATIONS`）/ `docs/testing.md:91`（「変異7本」）/ `scripts/verify-instance-refactor.mjs:5`（ヘッダコメント「変異 7 本」）                                                                                                                                     | `git grep -n -E '変異 ?7 ?本' -- docs scripts` が 0 件、`git grep -n -E '変異 ?8 ?本' -- docs/testing.md scripts/verify-instance-refactor.mjs` が 2 件                                                                                                                                               | 2 件（testing.md:91、verify-instance-refactor.mjs:5）                                                |
| 6   | 子ノードの `webmcp` が `widgets[].metadata.webmcp` に出る  | `engine/src/lib.rs:1303-1312`（後処理）/ `docs/components.md:275`（「検証されるが登録されない」）/ `docs/webmcp.md:65` / `docs/platform-features.md:131`                                                                                                                                                 | `git grep -n -F '検証されるが登録されない' -- docs` が 0 件。`docs/webmcp.md` に「`widgets[].key` を末尾の `/` で割った左側が `components[].instance`」の突き合わせ規則が 1 か所                                                                                                                     | 1 件                                                                                                 |
| 7   | 段階計画と AI 生成指示                                     | `docs/components-plan.md:101`（段階 6 の行）/ `docs/ai-development.md:26`（「段階6以降の将来設計」「子に`webmcp`宣言 … を書くコードを生成しない」）/ `docs/components.md:272-275`「段階6以降の課題」                                                                                                     | `git grep -n -E '段階 ?6以降                                                                                                                                                                                                                                                                         | WebMCPの合成は段階                                                                                   | 子に`webmcp`宣言と' -- docs README.md .claude` が 0 件。`docs/components-plan.md`の段階 6 行が「本マイルストーンで完了」を含む。「段階6以降の課題」の見出しは「段階7以降の課題」（子の`window` 等が残る） | ai-development.md:26 1 件、components.md:272 1 件、components-plan.md:101 1 件                                                             |
| 8   | R0 のローダー文言 3 つ（`id` / `rpc` の値 / ポインタの型） | `src/application-loader.js` / `docs/files-cache-rpc.md:93,109` / `docs/components.md:200-211`「エラー文言」日本語                                                                                                                                                                                        | `git grep -n -F 'キャッシュの管理情報が不正です' -- src docs` が src 1 件 + docs 2 件、`git grep -n -F '画面idは文字列で指定してください' -- src docs` が src 1 件 + docs ≥ 1 件、`git grep -n -F 'の定義が不正です（object で指定してください）' -- src docs` が src 1 件 + docs ≥ 1 件             | 0 件                                                                                                 |
| 9   | R0b の宣言件数上限（8 件）                                 | `src/application-loader.js:250-283`（`#walk` の `visit` 冒頭）/ `scripts/publish-packages.mjs:40-58`（`visit` 冒頭）/ `docs/files-cache-rpc.md:105,109` / `docs/components.md`「制限」表（行を足す）・`:246`（「Instance数と同梱パッケージ数は別物」に宣言数を加える）・`:257`（日本語 3 文言 → 4 文言） | `git grep -n -F 'コンポーネントの宣言が8件を超えています' -- src scripts docs` が src 1 + scripts 1 + docs ≥ 2 件。`git grep -n -F '日本語3文言' -- docs` が 0 件                                                                                                                                    | 0 件 / `日本語3文言` 1 件（components.md:257）                                                       |
| 10  | R0c の `manifest()` の基準を画面 URL に統一                | `src/application-loader.js:40-118,384-389`（`manifest(value, base)` → `manifest(value, screenUrl)`、`fetch:386` の第 2 引数）/ `docs/files-cache-rpc.md:105`（既に「`base`はrootの画面URL」と断言している）/ `docs/components.md:205,208`                                                                | `git grep -n -E 'manifest\((previous\.metadata                                                                                                                                                                                                                                                       | stored\.metadata                                                                                     | $)' -- src/application-loader.js` の呼び出し 4 か所がすべて画面 URL（`candidate.url`/`url`）を渡す。`git grep -n -F 'sidecar' -- src/application-loader.js`の`manifest(` 呼び出し行が 0 件                | `manifest(…, sidecar)` 1 件（:386-389）                                                                                                    |
| 11  | デモの子パッケージに `webmcp` を足す                       | `public/screens/parts/note-pad.json` / `parts/approval.json` / `parts/order-list.json` / `tests/parts-lab.test.js` / `tests/components-demo.test.js`                                                                                                                                                     | `git grep -n -c '"webmcp"' -- public/screens/parts/` が 3 ファイルとも ≥ 1。`bun run build:wasm` 後に `public/screens/parts-lab.json.manifest.json` / `order-dashboard.json.manifest.json` が再生成される（gitignore 済みなのでコミットには出ない）                                                  | 0 / 0 / 0                                                                                            |
| 12  | 文書の断言 → 実装シンボルの対応（T7 で表にする）           | `docs/webmcp.md`（`components[]` の順序・`hidden` の定義・突き合わせ規則）/ `docs/components.md`（上限超過の文言の出し手）                                                                                                                                                                               | 断言ごとに `git grep` で実装シンボル（`BTreeMap`、`hidden_component`、`rsplit_once('/')`、`Metadata::validate`、`Component {path}: `）を引き、同じ語で書かれている（T7 の完了基準の対応表）                                                                                                          | —                                                                                                    |
| 13  | ソースをテキストとして読むテスト・スクリプト               | `scripts/build-engine-variant.mjs`（`MUTATIONS[*].from` は `lib.rs` の文字列置換）                                                                                                                                                                                                                       | `lib.rs` を編集した各ターンで、全 `from` 文字列が `engine/src/lib.rs` に**ちょうど 1 回**現れることを scratch スクリプト（前回の `.gsd-lite/logs/component-loader/scratch/turn-011-mutation-from.mjs` 相当を `scratch/turn-<N>-mutation-from.mjs` に作る）で確認                                     | 7 本とも 1 回（turn 2 の最終判定で全変異がビルドできた）                                             |
| 14  | `docs/testing.md` の自動テスト表                           | `docs/testing.md:20-45` の表（新しいテストファイルを作ったとき）                                                                                                                                                                                                                                         | 本計画は新規テストファイルを作らない（既存ファイルへ追記）。T8 で `git status --porcelain tests/` に `??` が無いことを確認                                                                                                                                                                           | —                                                                                                    |

旧契約の言い回しの `git grep`（turn 2 実施）: `据え置き` は `docs/components.md:108,166,225` と `docs/components-plan.md:87` に 4 件。`:108` / `:166` は撤去対象（行 1）。`:225`（ABI の 2 MB は据え置き）と `components-plan.md:87` は本件と無関係なので**除外**（条件: `git grep -n -F '据え置き' -- docs/components.md` が `:225` 相当の 1 件だけになる）。`rootのもの` は `docs/components.md:170,172` の 2 件（`:170` は撤去、`:172` は `window` の行で残す）。

## Tasks

- [x] T1: R0 — ローダーの `TypeError` 3 点を日本語文言に（`id` 非文字列 / `rpc` の値が object でない / OPFS ポインタが object でない）
  - 完了基準:
    - `src/application-loader.js` に `shape(screen)`（名前は impl が決めてよい。export しない）を置き、`parsed()`（`:127-138`）と `#download()`（`:230-244`）の `parsePackage` 直後に呼ぶ。`typeof screen.id !== "string"` → `画面idは文字列で指定してください`。`screen.rpc` が `null` でない object（**配列も含む**。turn 3 訂正）のとき各値が `value !== null && typeof value === "object" && !Array.isArray(value)` でなければ `RPC {名前} の定義が不正です（object で指定してください）`（配列なら `{名前}` は添字）。`package-format.js` には入れない（P12: `mock-api-client.js:4` が画面でない定義を通す）
    - `save`（`:484-494`）: `JSON.parse` の結果が object でない（`null` / 配列 / プリミティブ）とき `NotFoundError` と同じ扱いで読み飛ばす。`keep` の計算（`:497-505`）も同じ型検査（P14）
    - `restore`（`:536-583`）: `stored` が object でないとき `new Error("キャッシュの管理情報が不正です")` を投げて `last` に入れる（§7-5）。`{}` / `{"url":5}` は従来どおり `キャッシュのURLが一致しません`
    - 回帰テスト（`tests/components-loader.test.js` の `fixture` / `memoryOpfs` / `pointerOf` を使う。新規ファイルは作らない）。各ケースで `TypeError` が出ないこと（`rejects.toThrow(TypeError)` が偽 / 文言一致）:
      - network-only: `id: 5` / `id: null` / `id: {}` の 3 件が `画面idは文字列で指定してください`。`id: 5` + storage を持つ子（`component-tree.js:38` の `part.includes` に到達していた形）も同文言で、子の取得前に拒否（`f.reads` にその子の URL が無い）
      - network-only: `rpc: { x: null }` と `rpc: { x: 5 }` がどちらも `RPC x の定義が不正です（object で指定してください）`（新文言に固定）、`rpc: [null]` が `RPC 0 の定義が不正です（object で指定してください）`（turn 3 訂正。配列のままだと `TypeError` が残り R0 に反する）、`rpc: null` / `rpc: []` は通る（現状不変）
      - network-first（`treeManifest`）の `parsed()` 経路で `id: 5` の子が同じ文言で拒否される
      - `current.json` = `null` と `previous.json` = `null` の両方で `save` が成功し、`versions/` に新 revision だけ残り `current.json` が正しいポインタになる（P14）
      - `current.json` = `null` → `restore` が `通信に失敗し、利用できる保存版もありません（キャッシュの管理情報が不正です）`。`current.json` = `[]` / `5` / `"x"` も同文言（「object でない」の代表 + 列挙外 1 件）。`{}` は `（キャッシュのURLが一致しません）`（P15）
      - `current.json` = `null` だが `previous.json` が正しいとき `restore` は previous から復元する
    - 文書: `docs/files-cache-rpc.md:93`（復元の文言の段落）に `キャッシュの管理情報が不正です` を、`docs/files-cache-rpc.md`「YAML/JSONとRhaiの配信キャッシュ」の取得段落に `id` / `rpc` の 2 文言を足す。`docs/components.md:200-211` の日本語一覧に 3 文言を足す（root と子が同じゲートを通る旨）
    - `bunx vp test run tests/components-loader.test.js tests/worker-mock.test.js tests/files-cache-rpc.test.js` green、`bun run check` green
    - 担う落とし穴: P12 / P13 / P14 / P15
  - 対象: `src/application-loader.js`, `tests/components-loader.test.js`, `docs/files-cache-rpc.md`, `docs/components.md`
  - 依存: なし
  - 並列サブ作業:
    - A: ローダー本体（`shape` / `save` / `restore`）と回帰テスト（対象: `src/application-loader.js`, `tests/components-loader.test.js`）
    - B: 文書 2 ファイルへの文言追記（対象: `docs/files-cache-rpc.md`, `docs/components.md`。文言 3 つは上の完了基準の文字列を正とし、A と同時に確定）

- [x] T2: R0b + R0c — 宣言件数上限（8 件）と `manifest()` の画面 URL 基準への統一
  - 完了基準:
    - R0b: `src/application-loader.js` `#walk` の `visit` 冒頭（`for` の前）で `Object.keys(parent.components ?? {}).length > 8` なら `コンポーネントの宣言が8件を超えています: {URL}`（`{URL}` = 宣言を持つパッケージの href = `base.href`）。取得・列挙の前（P16）。`scripts/publish-packages.mjs` の `visit` 冒頭に同じ検査（`{URL}` は絶対ファイルパス `declaringFile`）。`src/runtime.js:45-67` の `resolveComponents` は対象外（REQUIREMENTS R0b）
    - R0b テスト: `tests/components-loader.test.js` で 9 件宣言（ui には置かない。配置 8 Instance の既存テスト `:205-225` と別物）が network-only で拒否され、root 以外の `f.reads` が 0。8 件は通る。network-first（`treeManifest` 経路）でも 9 件が同文言。`tests/publish-packages.test.js` に 9 件拒否（`untouched(output)`）と 8 件通過
    - R0c: `manifest(value, screenUrl)` に署名を変え、配信ファイルの `url` の形検査（`check` 内の `httpUrl(entry.url, base)`）だけ内部で組んだ sidecar（`new URL(screenUrl)` に `pathname += ".manifest.json"`）を基準にする。子キーの重複判定（`:92`）と 2 MB 文言の「最大の子」（`:108-113`）は `httpUrl(key, screenUrl).href`。`fetch:386-389` の呼び出しを `manifest(…, url)` に変える。`save:489,502` / `restore:540` は既に画面 URL
    - R0c テスト（`tests/components-loader.test.js`、`treeManifest` で revision 込み）: (a) 既存の相対キー（`a.json` 等）の受け入れ / 拒否 / 文言のテストが期待値不変で通る（既存テストを変えない）。(b) 子キー `""` と `parent.json` の 2 つを持つマニフェスト（`version: 2`、どちらも同じ画面 URL に解決）が `マニフェストのコンポーネント情報が不正です`（括弧なし）で拒否される。(c) 基準依存キー（`?x`）を最大の子にした 2 MB 超のマニフェストで、文言の「最大の子」が画面 URL 基準の href（`href("parent.json?x")`）になる（P19）。(d) sidecar 基準でのみ解決できていた `url`（`packages/<rev>/source` の相対）が引き続き sidecar 基準で読める（既存の network-first テスト `:573` が不変。P18）
    - 文書: `docs/files-cache-rpc.md:105` の「`base`はrootの画面URL」の断言が `manifest()` の実装と一致（R0c 後に真になる）。`:109` に宣言件数の文言を足す。`docs/components.md`「制限」表に `| 宣言（1パッケージあたり） | 8 |` の行、`:246` に「宣言数（1 パッケージ 8）は Instance 数・同梱数とも別物」（P17）、`:257` を「日本語4文言」に
    - `bunx vp test run tests/components-loader.test.js tests/publish-packages.test.js` green、`bun run check` green
    - 担う落とし穴: P16 / P17 / P18 / P19
  - 対象: `src/application-loader.js`, `scripts/publish-packages.mjs`, `tests/components-loader.test.js`, `tests/publish-packages.test.js`, `docs/files-cache-rpc.md`, `docs/components.md`
  - 依存: T1
  - 並列サブ作業:
    - A: ローダー（R0b の `#walk` + R0c の `manifest()`）とそのテスト（対象: `src/application-loader.js`, `tests/components-loader.test.js`）
    - B: 生成スクリプトの件数上限とそのテスト（対象: `scripts/publish-packages.mjs`, `tests/publish-packages.test.js`）
    - C: 文書（対象: `docs/files-cache-rpc.md`, `docs/components.md`）

- [x] T3: R1 + R2 前半 — 子 widget の `metadata.webmcp`、子パッケージ `webmcp` の受け入れ、`window` の文言（Rust）
  - 完了基準:
    - `engine/src/lib.rs:1303-1312` の後処理を、`widget.target.rsplit_once('/')` で `(instance パス, itemId)` に割り、`self.instance(path)?.ui`（`None` = root の `self.root.ui`）に `find_path` を掛ける形にする（決めた事項 2）。root の挙動（target に `/` が無い）は不変
    - `engine/src/composition.rs:233-240` の `reject_effect_declarations` を削除し、`instance.rs:65-67` の `if component { … }` ブロックを消す。直後の `package.webmcp.validate()?` が子にも効く
    - `composition.rs:246` の文言を `window is not available in components` に変える（判定は不変）。`composition_tests.rs:672` と `docs/components.md:172` を同じ文字列に
    - Rust テスト（`engine/src/composition_tests.rs`。`part()` / `component()` / `compose()` / `widget_at()` / `keys()` の雛形で）:
      - 深さ 1: 子ノード（itemId あり）の `webmcp` が `widget_at(&scene, "b/<itemId>").config["webmcp"]` に `{description, tags}` で出る。root ノードの `webmcp` も従来どおり出る（回帰）
      - 深さ 3（`composed()` 系: `a` → `a/c`）: `a/c/<leaf の itemId>` に出る（P2。`split_once` だと壊れる形）
      - 同じ子を 2 か所（`b` と `d` に同じ `leaf.json`）: 両 widget の `config["webmcp"]` が等しく、key だけ違う（P4）
      - `a_child_may_declare_host_effects_but_not_the_tool_surface` を「`webmcp` を含む 7 種とも子で通る」に書き換え（関数名も `…_and_the_tool_surface` 等に変える）。上限超過（description 2,001 バイト）の子は `compose_error` が `starts_with("Component part: ")` かつ `ends_with("webmcp: description/label/tags exceed limits or have duplicate tags")`（P8。決めた事項 4）
      - `a_child_cannot_own_a_window_at_any_depth` が新文言で green
    - `cargo test` green、`cargo fmt -- --check` green。`bun run build:wasm` → `bunx vp test run` green（JS 側は無改修で通るはず。`tests/components-effects.test.js` 等に旧文言の期待が無いことを `git grep -n -F 'not available in components' -- tests` で確認: 現状 0 件）
    - 照合: `bun scripts/compare-engine-behavior.mjs --base target/engine-compare/base-52ec888.wasm --candidate public/engine.wasm` が差分 0（`Scene` の形はこのタスクでは変わらない）。`bun scripts/probe-composition.mjs --candidate public/engine.wasm` は `child-webmcp-refused` 列が**落ちる**（load が通るようになるため）。このタスクでは probe 列を `isOk` の最小形（load が通る 1 ステップ）に書き換えて exit 0 にし、列の本置き換えは T6 で行う。チェックリスト行 13（`MUTATIONS[*].from` が `lib.rs` に各 1 回）
    - 担う落とし穴: P2 / P3（既存挙動のまま。文書は T7） / P4 / P8 / P11
  - 対象: `engine/src/lib.rs`, `engine/src/composition.rs`, `engine/src/instance.rs`, `engine/src/composition_tests.rs`, `scripts/probe-composition.mjs`（最小の暫定変更）, `docs/components.md:172`
  - 依存: なし（T1 / T2 と独立。impl は PLAN の順に取る）
  - 並列サブ作業: なし（`lib.rs` / `composition.rs` / テストが互いに依存）

- [x] T4: R2 後半 — `Scene.components[]`（instance / id / title / webmcp / hidden）を WASM で作る（Rust）
  - 完了基準:
    - `engine/src/lib.rs` に `#[derive(Serialize)] pub struct Component { pub instance: String, pub id: String, pub title: String, #[serde(skip_serializing_if = "metadata::Metadata::is_empty")] pub webmcp: metadata::Metadata, pub hidden: bool }` と、`Scene` に `#[serde(skip_serializing_if = "Vec::is_empty")] pub components: Vec<Component>` を足す（決めた事項 1）。`layout()` の `Scene { … }` 生成で `components: self.component_summaries()?,` と書く（この 1 行が T6 の変異 M8 の置換点。文字列を変えない）
    - `fn component_summaries(&self) -> Result<Vec<Component>, String>`: `self.components`（`BTreeMap`。親は子より先に来る）を順に回し、`path.rsplit_once('/')` で `(parent_path, item_id)`（`None` → `("", path)`）。`hidden = hidden[parent_path] || hidden_component(component_node(parent, item_id).ok_or(unknown_item(path))?, &parent_state)`。`parent_state` は root なら `self.root.state_json()?`、子なら `self.instance(parent_path)?.state_json()?`（決めた事項 3。`layout_scope()` の後ろで呼ぶ。P7）。`id` / `title` / `webmcp` は `instance.package` のクローン
    - Rust テスト（`composition_tests.rs`。`serde_json::to_value(&scene)` で見る）:
      - 子の無い画面: JSON に `components` キーが**無い**（P1）
      - `composed()` + `bundled()`: `components` が `[a, a/c, b]` の順で、`id` / `title` が各パッケージのもの、`webmcp` は宣言した子だけに出る、`hidden` が全部 `false`
      - 既存の入口 × `components[]` の直交表（各行 1 アサーション以上）:
        | 入口                                                     | 確かめること                                                                                                                                |
        | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
        | `load_with_components` 直後の `layout`                   | 上の順序・内容                                                                                                                              |
        | 親の `visibleBind` が false（`listing` + `visibleBind`） | `hidden: true` で widgets に `a/` が無い。`set_state(&mut runtime.root, "ready", json!(true))` 後は `hidden: false` で widgets が出る（6b） |
        | 深さ 3 で中間（`a`）を隠す                               | `a` と `a/c` の両方が `hidden: true`、表示に戻すと両方 `false`（P5）                                                                        |
        | 親 state に `ready`、子 state にも同名キー（false）      | 親の `ready` だけで切り替わる（P6）                                                                                                         |
        | `dispatch`（子の handler が自分の state を変える）       | `components[]` の `id` / `title` / `webmcp` / 順序が不変（package 由来）                                                                    |
        | 同じ子を 2 か所（`open` / `shipped`）                    | 2 件、`id` が同じ、`instance` が違う、`webmcp` が deep-equal（P4）                                                                          |
        | `layout` の幅エラー（`width` 範囲外）                    | 既存 `a_rejected_layout_leaves_no_scope_behind_for_the_next_one` が green（P7）                                                             |
      - `scene.webmcp` は root のまま（子に `webmcp` を宣言しても `Scene.webmcp` が変わらない。受け入れ 3）
    - `cargo test` green。`bun run build:wasm` 後、`compare-engine-behavior.mjs` が差分 0（子の無い画面の `layout` 応答が不変 = P1 の実証）、`probe-composition.mjs` exit 0（T3 の暫定列のまま）。チェックリスト行 13
    - 担う落とし穴: P1 / P5 / P6 / P7 / P4
  - 対象: `engine/src/lib.rs`, `engine/src/composition_tests.rs`
  - 依存: T3
  - 並列サブ作業: なし

- [x] T5: JS 側 — `ui_get_screen.components` とデモ子パッケージの `webmcp`（R2 / R2b / R3 / R4）
  - 完了基準:
    - `src/ui-tools.js:134-147` の `ui_get_screen` 戻りに `components: snapshot.scene.components ?? []` を足す（`preview()` を通さない。P21。`widgets` の `offset` / `limit` に影響されない）。`describe()` / `snapshot()`（`src/runtime.js:466-482`）は無改修
    - デモ（R2b。決めた事項 7 の文言）: `public/screens/parts/note-pad.json`（パッケージ直下 `webmcp` + `text` / `save` に部品の `webmcp`）、`parts/approval.json`（直下 + `ask`）、`parts/order-list.json`（直下 + `orders`）。上限内（label ≤ 160 バイト / description ≤ 2,000 バイト / tags ≤ 8・各 ≤ 80 バイト・重複なし。P20: 生成スクリプトは検証しないので `load` で確かめる）
    - JS テスト（既存ファイルへ追記。新規ファイルを作らない）:
      - `tests/components-demo.test.js`（raw ABI、order-dashboard）: `layout` 応答の `components` が `[{instance:"open", id:"order-list", …}, {instance:"shipped", …}]` の順で、両方の `webmcp` が deep-equal、`hidden` false。`open/orders` と `shipped/orders` の widget `config.webmcp` が等しい。`data.webmcp` が root のまま（order-dashboard は `webmcp` 未宣言なので無い）
      - `tests/parts-lab.test.js`（`UiRuntime`）: `runtime.snapshot().scene.components` が `[approval, note, products]`（バイト順）、`products`（http-grid）は `webmcp` キー無し、`note` / `approval` にデモの文言。`createUiTools(runtime)` 相当の host で `ui_get_screen` を呼び `components` と `widgets[]` の `note/text` の `metadata.webmcp` が出る。`stateKeys` が root の `["notice"]` だけで子の `text` / `result` が無い（R3 回帰）
      - `tests/webmcp.test.js`: 子の無い `grid` で `components` が `[]`。`ui_load_screen` 後も `[]`（P22）。`offset` / `limit` を変えても `components` が同じ（R4）。`ui_get_screen` を `{offset: -1}` / `{limit: 0}` / `{limit: 1000}` / `{extra: 1}` で呼んでも `{ok:false, error:{code, message}}` で例外が漏れない（既存の `integer` / `INVALID_INPUT` 経路の回帰）
      - 非表示の子（6b）を JS から: `tests/components-loader.test.js:1199-` の `WasmEngine / UiRuntime の components` 群か `tests/parts-lab.test.js` で、`visibleBind` を持つ親 fixture を `engine.load(…, { components })`（`src/engine.js:77-109`）で読み、`layout(500).components[0].hidden === true`、親 state を動かす dispatch の後 `false` かつ `widgets` に接頭辞付き key が出る（P23: `render()` / `layout()` を明示的に呼んでから読む）
    - `bun run build:wasm` → `bunx vp test run` green（全部）、`bun run check` green。マニフェストの再生成は `build:wasm` が行う（gitignore 済み）
    - 担う落とし穴: P20 / P21 / P22 / P23
  - 対象: `src/ui-tools.js`, `public/screens/parts/note-pad.json`, `public/screens/parts/approval.json`, `public/screens/parts/order-list.json`, `tests/webmcp.test.js`, `tests/components-demo.test.js`, `tests/parts-lab.test.js`, `tests/components-loader.test.js`
  - 依存: T4
  - 並列サブ作業:
    - A: `ui-tools.js` と `tests/webmcp.test.js` / `tests/components-loader.test.js` の非表示ケース（対象: `src/ui-tools.js`, `tests/webmcp.test.js`, `tests/components-loader.test.js`）
    - B: デモ 3 ファイルの `webmcp` と `tests/components-demo.test.js` / `tests/parts-lab.test.js`（対象: `public/screens/parts/*.json`, `tests/components-demo.test.js`, `tests/parts-lab.test.js`。文言は決めた事項 7 を正とする）
    - 親: `bun run build:wasm` と全体 Vitest はサブエージェントに禁止し、親がまとめて回す（前回 reflect の運用）

- [x] T6: probe 列の置き換え（`child-webmcp-published`）、変異 M8、証跡の再生成、数字の追従
  - 完了基準:
    - `scripts/probe-composition.mjs`: `child-webmcp-refused` を `child-webmcp-published` に置き換える。親 fixture `WEBMCP_PARENT`（`EFFECT_PARENT` を元に `state: {shown: false}`、`items: [{xtype:"effectPart", itemId:"part", visibleBind:"shown"}, {xtype:"button", itemId:"show", text:"表示", handler:"show"}]`、script `fn init(s) { s } fn show(s, e) { s.shown = true; s }`）、子 `CHILD_WITH_WEBMCP`（パッケージ直下 `webmcp: {description: "部品"}` + `fire` ノードに `webmcp: {description: "呼ぶ"}`）。ステップ: `load`（`isOk`）→ `layout:800`（`data.components` が `[{hidden:true, id:"effect-part", instance:"part", title:"効果関数を呼ぶ部品", webmcp:{description:"部品"}}]` と deep-equal、`part/` で始まる key が無い、`data.webmcp` が `undefined`）→ `event:show`（`isOk`、revision 1）→ `layout:800:shown`（`components[0].hidden === false`、`part/fire` の `config.webmcp` が `{description:"呼ぶ"}`）。コメント `:273`「still refused at load」を書き換える
    - `scripts/build-engine-variant.mjs` の `MUTATIONS` に M8 `{ name: "components-omitted", probe: "composition", file: "engine/src/lib.rs", from: "components: self.component_summaries()?,", to: "components: Vec::new(),", diff: "child-webmcp-published の layout:800 の data.components" }` を足す。`bun scripts/build-engine-variant.mjs --mutation components-omitted --out target/engine-compare/mutant-components-omitted.wasm` → `probe-composition.mjs --candidate <それ>` が exit 1
    - `bun scripts/probe-composition.mjs --candidate public/engine.wasm` exit 0。`target/engine-compare/composition.json` の `steps` / `sequences` を実測し（見込み 57 / 6）、`docs/components.md:281` と `docs/testing.md:91`（「3つの列」→ 実測の列数、「子の`webmcp`はload時に拒否される」→「子の`webmcp`が`components[]`と`widgets[].metadata.webmcp`に公開され、非表示の子は`hidden: true`で出る」、「変異7本」→「変異8本」）に書く。`scripts/verify-instance-refactor.mjs:5` のコメント「変異 7 本」→「8 本」
    - チェックリスト行 4 / 5 / 13 の `git grep` が条件どおり
    - `bun run check` green（probe / build-engine-variant / docs を `bunx vp fmt` してから）
    - 担う落とし穴: P9 / P10 / §7-6
  - 対象: `scripts/probe-composition.mjs`, `scripts/build-engine-variant.mjs`, `scripts/verify-instance-refactor.mjs`（コメント 1 行）, `docs/components.md:281`, `docs/testing.md:91`
  - 依存: T5
  - 並列サブ作業: なし（数字は probe の実測に依存）

- [x] T7: 契約文書の追従（受け入れ 7 + `docs/testing.md` + `docs/files-cache-rpc.md`）
  - 完了基準:
    - `docs/components.md`: `:108`「残る`webmcp`だけが据え置き」→ 7 種とも子で宣言できる（`webmcp` は `components[]` に instance 別で公開）。`:166`「据え置きの拒否」節を「子に許していないもの」に改め、`webmcp` の項を削除して `window`（新文言）と「変更を適用」の 2 つに。`:197` の英語一覧を `Component {path}: webmcp: description/label/tags exceed limits or have duplicate tags` に差し替え。`:272`「段階6以降の課題」→「段階7以降の課題」で `webmcp` の項を削除。新節「子の `webmcp`」（R1 / R2 の契約: 部品の `webmcp` は接頭辞付き key の widget に出る、パッケージの `webmcp` は `ui_get_screen.components[]`、`screen.webmcp` は root のみ、上限は root と同じで文言は `Component {path}: ` 前置、itemId の無いノードの `webmcp` は出ない（P3 の既存挙動を仕様として明記））
    - `docs/webmcp.md`: `ui_get_screen` の説明（`:14` の表と `:21`）に `components` を足す。「次の拡張点」`:65` の段落に `components[]` の形 `{instance, id, title, webmcp, hidden}`、順序（`instance` 文字列のバイト順 = `BTreeMap` の順。ASCII なら辞書順。§7-7）、`hidden` の定義（親の `visibleBind` による非表示だけ。折りたたみ・非アクティブタブ・モーダル背後は `widgets[]` の有無と `blocked` で判断。§7-2）、突き合わせ規則（`widgets[].key` を末尾の `/` で割った左側が `components[].instance`。`/` を含まない key は root。`a/b/c` は instance `a/b`。§7-9）、`id` / `title` はパッケージのもので WebMCP 草案の `ModelContextTool.title` とは別（§7-8）、説明情報であり許可 action・入力 schema・認可を変えない（R2）。`:5` の草案確認日を `2026-10-09` に更新（RESEARCH §2）
    - `docs/platform-features.md:131`: `widgets[].metadata.webmcp` は子 Instance の部品にも出る（key は接頭辞付き）、子パッケージの `webmcp` は `components[]` の 1 文
    - `docs/components-plan.md:101`: 「段階6（WebMCP）。本マイルストーンで完了。子ノードの`webmcp`を接頭辞付きkeyのwidgetに載せ、子パッケージの`webmcp`を`ui_get_screen.components[]`にinstance別で公開した。ツールは画面1登録のまま」
    - `docs/ai-development.md:26`: 「子の`window`は段階7以降の将来設計で、子に`window`を書くコードを生成しない。子の`webmcp`（パッケージ直下・部品）は生成してよく、`ui_get_screen.components[]`と`widgets[].metadata.webmcp`に出る」
    - `docs/testing.md:91`: T6 で直した数字と句が残っていること（再確認）
    - チェックリスト行 1 / 2 / 3 / 6 / 7 / 8 / 9 / 12 の `git grep` が条件どおり。`bun run docs:check` green
    - **断言 → 実装シンボルの対応表**を PROGRESS に 1 つ書く（最低 5 行）: 「`components[]` の順序はバイト順」→ `BTreeMap<String, instance::Instance>`（`lib.rs:379`）/ 「`hidden` は親の `visibleBind`」→ `hidden_component`（`lib.rs:1854`）/ 「key を末尾の `/` で割る」→ `rsplit_once('/')`（T3 / T4 の実装行）/ 「上限は root と同じ」→ `Metadata::validate`（`metadata.rs:18`）/ 「文言の前置」→ `Component {path}: `（`lib.rs` `Composing::load` の `map_err`）/ 「`components` が無ければ `[]`」→ `snapshot.scene.components ?? []`（`ui-tools.js`）
  - 対象: `docs/components.md`, `docs/webmcp.md`, `docs/platform-features.md`, `docs/components-plan.md`, `docs/ai-development.md`, `docs/testing.md`
  - 依存: T6
  - 並列サブ作業:
    - A: `docs/components.md` + `docs/components-plan.md` + `docs/ai-development.md`（対象: その 3 ファイル）
    - B: `docs/webmcp.md` + `docs/platform-features.md`（対象: その 2 ファイル）
    - 親: 対応表と `git grep` の再実行

- [x] T8: 最終判定と総点検（R4 の堅牢性格子を含む）
  - 完了基準:
    - `bun scripts/verify-instance-refactor.mjs` が exit 0（照合 差分 0、probe exit 0、変異 8 本すべて exit 1）。所要の表を PROGRESS に写す
    - 堅牢性格子（R4。scratch スクリプト `scratch/turn-<N>-robustness.mjs` で実 WASM + `createUiTools` を回し、結果表を PROGRESS に）: 画面状態 5 種（子なし / 子あり / 非表示の子 / 2 か所に置いた子 / `ui_load_screen` で入れ替えた直後）× ツール呼び出し（`ui_get_screen` の `offset` / `limit` 境界 4 通り + `ui_get_state` の root キー / 子のキー名（`NOT_FOUND` 系の `{ok:false}`）+ `ui_dispatch` の接頭辞付き key / 非表示の子の key（`NOT_VISIBLE`）/ 存在しない instance の key）で、どのセルも未捕捉例外が無く、`revision` と root `state` が失敗セルで不変
    - 追従先チェックリスト 1〜14 を行番号つきで再実行し、PROGRESS に「行 1 … 行 14」の表（条件・結果）を書く。全行 OK
    - `git status --porcelain` が空（成果物以外の変更を残さない）。`git grep -n -F 'reserved for a later stage' -- src engine docs scripts tests` 0 件を再確認
  - 対象: `.gsd-lite/PROGRESS.md`, `.gsd-lite/logs/component-webmcp/scratch/`
  - 依存: T7
  - 並列サブ作業: なし

- [ ] F1: verify round 1 の指摘 — root ノードの `webmcp` の漏れを止め、契約文書の 3 断言を実装に合わせる（文書の指摘は 1 つにまとめる）
  - 指摘の根拠（verify turn 11 の実測。scratch `turn-011-rootnode-webmcp.mjs` / `turn-011-gridkey2.mjs` / `turn-011-window-child.mjs`）:
    1. `docs/components.md:181` / `docs/webmcp.md:73`「`itemId`を持たないノードの`webmcp`は**どこにも出ない**」が偽。root の UI ノード（itemId なし）に `webmcp` を書くと、target が空の widget 全部（root の `root.0` も子の `a/root.0` も。label 等）の `config.webmcp` に載る（`lib.rs:1353-1357`: 空 target → `find_path(root.ui, "")` が root ノード自身に一致する）。base `52ec888` でも同じ（既存挙動）だが、本マイルストーンが契約として明記した文が実態と違う
    2. `docs/components.md:179` / `docs/webmcp.md:71`「`widgets[].key`を末尾の`/`で割った左側が`components[].instance`」が advanced grid（`pageSize` 等。`grid.rs:5`）の行 key で壊れる: 行 id が文字列 `"x/y"` のとき key は `a/g:row:"x/y"`（`grid.rs:523` `id_key(row)` = JSON 表記）で、末尾の `/` で割ると `a/g:row:"x`。実装は `target`（`a/g`）を割っている（`lib.rs:1353`）
    3. `docs/components.md:175` / `docs/webmcp.md:69`「`hidden`は親の`visibleBind`による非表示だけ」は、実装（`hidden_component`）が**配置ノード（component ノード）自身の `visibleBind`** だけを見ることを言い切れていない。root の `window`（これも `visibleBind` を持つ）の中に置いた子は、window が閉じていても `hidden: false` で widgets に出ない（実測: `components=[{hidden:false,…}] keys=["o"]`）
    4. `docs/components.md:180`「その**全widget**に載る（実測: header / row:0 / row:1 の 3 つとも）」に対し、`tests/components-demo.test.js:153-163` は `find` で 1 つしか確かめていない
  - 期待結果（完了基準・テストはこの表だけを参照する。exit / 件数をほかに書かない）:
    | 条件                                                                                                                        | 結果                                                                                                                                    |
    | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
    | root の UI ノード（itemId なし）が `webmcp` を宣言し、root と子（`a`）に itemId の無い `label` と itemId 付きの `textfield` | `root.0` / `a/root.0` の `config` に `webmcp` キーが無い。itemId を持つノードの `webmcp` は従来どおり出る                               |
    | itemId の無い子孫ノード（root / 子のどちらでも）が `webmcp` を宣言                                                          | どの widget にも出ない（従来どおり）                                                                                                    |
    | `bun scripts/compare-engine-behavior.mjs --base target/engine-compare/base-52ec888.wasm --candidate public/engine.wasm`     | 差分 0（同梱デモの root UI ノードは `webmcp` を宣言していない。turn 11 の grep で確認）                                                 |
    | `bun scripts/probe-composition.mjs --candidate public/engine.wasm`                                                          | exit 0・57 歩・問題 0                                                                                                                   |
    | order-dashboard の `layout` で key が `open/orders` / `shipped/orders` で始まる widget                                      | それぞれ 3 件以上（header + row 2 件）あり、**全部**が `config.webmcp` を持ち、互いに deep-equal。`open` 側と `shipped` 側も deep-equal |
    | `scratch/turn-<N>-mutation-from.mjs`                                                                                        | 変異 8 本すべて `from` が `engine/src/lib.rs` にちょうど 1 回（チェックリスト行 13）                                                    |
  - 完了基準:
    - A（engine + テスト）: `engine/src/lib.rs` の metadata 後処理（`for widget in &mut widgets` の冒頭、`:1352`）で `widget.target.is_empty()` なら `continue`（空 target は itemId の無いノードの widget。`find_path(…, "")` を呼ばない）。`MUTATIONS[*].from` の 8 文字列は触らない。Rust テスト 1 本を `composition_tests.rs` に追加（表の 1〜2 行目。`widget_at` / `keys` の雛形）。`tests/components-demo.test.js:153-163` の `find` を `filter` に変える（表の 5 行目）。`cargo test` → `bun run build:wasm` → `bunx vp test run` → `bun run check` → 照合 → probe の順に回し、表の 3・4・6 行目を満たす
    - **照合が差分 0 でない場合の規則**（推測で進めない）: 差分の step を PROGRESS に列挙し、A の `continue` を戻してコードは base と同じ挙動のままにする。その場合 B の (1) は「root の UI ノード（itemId なし）の `webmcp` は target を持たない widget（label 等。子のものも含む）の `metadata.webmcp` に載る。それ以外の itemId の無いノードの `webmcp` は出ない」と実態を書く
    - B（文書。1 つにまとめる）: (1) `docs/components.md:181` / `docs/webmcp.md:73` は A 後に真になるので趣旨は変えず、「root の UI ノード自身も同じ（target を持たない widget に載らない）」を 1 文足す。(2) 突き合わせ規則（`docs/components.md:179` / `docs/webmcp.md:71`）を「`widgets[].key` の**最初の `:` より前**（`:` が無ければ全体）を末尾の `/` で割った左側が `components[].instance`。itemId は `:` と `/` を含めないので一意。advanced grid の行 key `a/g:row:"x/y"` のように `:` より後ろには `/` が入り得る」に改める。(3) `hidden` の定義（`docs/components.md:175` / `docs/webmcp.md:69`）を「配置ノード（component ノード）自身の `visibleBind`」と言い切り、「root の `window` の中に置いた子は window が閉じていても `hidden: false`（widgets に出ず、`blocked` と同じ側で読む）」を 1 文足す。(4) `docs/components.md:180` の「実測」は A のテストが 3 件を確かめるので残す。`bun run docs:check` green
    - 追従先チェックリスト行 6 の「確かめ方」の文言（「`widgets[].key` を末尾の `/` で割った左側」）を (2) の新しい語（「最初の `:` より前」）に書き換え、`docs/webmcp.md` に 1 か所であることを `git grep` で確認する（行 6 の条件は webmcp.md 側。`components.md:179` の並記はそのままでよい）
    - 既存テストの期待値変更があれば PROGRESS に列挙する（想定: 0 件）
  - 対象: `engine/src/lib.rs`, `engine/src/composition_tests.rs`, `tests/components-demo.test.js`, `docs/components.md`, `docs/webmcp.md`, `.gsd-lite/PLAN.md`（行 6 の文言）
  - 依存: T8
  - 並列サブ作業: A（engine + 2 テスト。対象: `engine/src/lib.rs`, `engine/src/composition_tests.rs`, `tests/components-demo.test.js`）/ B（文書。対象: `docs/components.md`, `docs/webmcp.md`。文言は上の (1)〜(3) を正とする）。`bun run build:wasm` / `cargo` / 全体 Vitest / 照合 / probe は親

## 決めた事項

1. **`Scene.components` の直列化**は `#[serde(skip_serializing_if = "Vec::is_empty")]`。子の無い画面の `layout` 応答は 1 バイトも変わらず、base `52ec888` との照合（`scripts/compare-engine-behavior.mjs` の正規化は http の `kind` 1 か所のみ。`docs/testing.md:91`）が差分 0 のまま。JS は `ui_get_screen` で `snapshot.scene.components ?? []` と埋める（出所は WASM、JS は推測しない。RESEARCH §5-A 採用）
2. **子 widget の metadata 付与の分割規則**は `widget.target.rsplit_once('/')`（末尾 1 回）。itemId は `/` を含めない（`engine/src/lib.rs:1758-1760` の `itemId must not contain '/'`）ので一意。Grid セルの target は `products/productsGrid`（`:row:1` は key にだけ付く。RESEARCH §1.1）。同じ規則を `components[]` の親パス算出と `docs/webmcp.md` の突き合わせ規則に使う（基準は 1 つ）
3. **`components[].hidden`** は `hidden_component(node, parent_state)`（`lib.rs:1854-1856`）を親 Instance の state に掛け、祖先の `hidden` を OR する。`BTreeMap` の順序で親が先に処理済み（`"a"` < `"a/b"`）。`route()` の `blocked`（無効・折りたたみ・非アクティブタブ・モーダル背後）は含めない（REQUIREMENTS R2 の定義。RESEARCH §5-C / §7-2 の「広げる案」は却下: `hidden` は「layout に出ない理由が親の `visibleBind`」だけを意味し、それ以外は `widgets[]` の有無と `blocked` で読める）
4. **子の `webmcp` 上限超過の文言**は `Component {path}: webmcp: description/label/tags exceed limits or have duplicate tags`（`Composing::load` の `map_err` 前置 + `metadata.rs:26` の本文）。受け入れ 2 の「root と同じ文言」はこの形で満たす（RESEARCH §7-3）。Rust テストは `starts_with` + `ends_with` の 2 条件
5. **`window` の拒否文言**は `window is not available in components`（括弧を落とすだけ。`reject_windows` の判定・テスト対象・文書の位置は不変）。受け入れ 7 の「`reserved for a later stage` が残らない」を満たすため（RESEARCH §1.3 / §7-1。DECISIONS D11）
6. **`Component` 構造体**: フィールドは `instance` / `id` / `title` / `webmcp`（`skip_serializing_if = Metadata::is_empty`）/ `hidden`。JSON のキー順は `abi.rs:155` の `serde_json::to_value` によりアルファベット順（`hidden, id, instance, title, webmcp`）。生成関数名は `component_summaries`（T6 の変異 M8 がこの行を置換する）
7. **デモの `webmcp` 文言**（R2b。すべて上限内）:
   - `note-pad.json`: 直下 `{label: "メモ", description: "メモを入力してこのブラウザに保存する部品。", tags: ["memo", "storage"]}`、`text` に `{description: "保存するメモの本文。"}`、`save` に `{description: "メモをIndexedDBへ保存し、親へsavedを通知する。", tags: ["write"]}`
   - `approval.json`: 直下 `{label: "承認", description: "承認ダイアログで確認し、結果を親へ返す部品。", tags: ["approval", "dialog"]}`、`ask` に `{description: "承認を確認するダイアログを開く。", tags: ["dialog"]}`
   - `order-list.json`: 直下 `{label: "受注一覧", description: "親から受け取ったstatusとqueryで絞り込んだ受注を一覧する部品。", tags: ["orders", "list"]}`、`orders` に `{description: "行を選ぶと親へselectedを通知する。", tags: ["select"]}`。`metric` は itemId が無いので書かない（P3）
8. **R0 の置き場所**は `src/application-loader.js` の非公開関数で、`parsed()` と `#download()` の両方から呼ぶ（`package-format.js` には入れない。`src/mock-api-client.js:4` が画面でない定義を通す。RESEARCH §5-H / P12）。**turn 3 訂正**: 「`rpc` 自体が配列のときは現状どおり通す（P13 / §7-10）」を撤回し、配列も各値を同じ規則で見る（`rpc: [null]` に `TypeError` が残り REQUIREMENTS R0「`TypeError` を出さない」に反することを実測した。`.gsd-lite/logs/component-webmcp/scratch/turn-003-rpc-array.mjs`）。`rpc: []` は値を持たないので従来どおり通り、却下項目「`rpc: []` を拒否する」は却下のまま。文言は `画面idは文字列で指定してください` / `RPC {名前} の定義が不正です（object で指定してください）`
9. **R0 のポインタ**: `save` は object でないポインタを `NotFoundError` と同じく読み飛ばす（`keep` も同じ型検査）。`restore` は `キャッシュの管理情報が不正です` を `last` に入れる（`docs/files-cache-rpc.md:107` の「破損した管理情報は『保存版を削除』で消してから再取得できる」と対応。RESEARCH §7-5 / P15）
10. **R0b の文言**は `コンポーネントの宣言が8件を超えています: {URL}`（既存 3 文言 `docs/components.md:257` と同じ形。`{URL}` はローダーでは宣言を持つパッケージの href、生成スクリプトでは絶対ファイルパス）。検査位置は `visit` の冒頭（ループ前）で 3 経路（network-only `:372` / network-first `:416` / restore `:569`）に同時に効く。Rust（`composition.rs:22-41` `validate_declarations`）と `src/runtime.js` の `resolveComponents` には足さない（REQUIREMENTS R0b の範囲）
11. **`manifest()` の署名**は `manifest(value, screenUrl)`（第 2 引数を画面 URL に統一。sidecar は内部で `pathname += ".manifest.json"` で組み、配信ファイルの `url` の形検査にだけ使う）。呼び出し 4 か所（`fetch:407` / `save:516,529` / `restore:570`。turn 4 訂正: 「3 か所」は `save` の 2 行を 1 つに数えた誤り）がすべて画面 URL を渡す。基準に依存する境界値（`""` / `?x` / `#f` / `parent.json`）は T2 のテスト行に置く（RESEARCH §5-G）
12. **probe の列 ID**は `child-webmcp-published`。ステップ数は実測で書く（見込み 54 − 1 + 4 = 57）。変異 M8 `components-omitted` を足し、`docs/testing.md:91` / `verify-instance-refactor.mjs:5` の本数を 8 にする（RESEARCH §7-6 採用）
13. **文書の追従先**は受け入れ 7 の 5 文書 + `docs/testing.md:91` + `docs/files-cache-rpc.md`（チェックリスト行 4 / 8 / 9 / 10）。`docs/screen-format.md:5` の「`webmcp`は画面や部品の説明メタデータ」は現状のままで可（RESEARCH §5-J）
14. **新規テストファイルは作らない**（`docs/testing.md:20-45` の表への追従を避ける）。Rust は `composition_tests.rs`、JS は `components-loader` / `components-demo` / `parts-lab` / `webmcp` / `publish-packages` の各 `.test.js` に追記する
15. **`ui_get_screen.components` は `preview()` を通さない**（最大 7 件 × description 2,000 バイト。Rust で上限済み。P21）。`offset` / `limit` は `widgets` だけに掛かる

## メモ

### 前回 reflect（20261009-1151-component-loader.md）の提案の反映

| 提案                                                                            | 反映                                                                                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `bun run check` の前に `bunx vp fmt`、整形後に対象テストをもう 1 度             | 採用。「検証コマンド」の 2 行目                                                                                               |
| 追従先の「確かめ方」に文書の述語（比較対象・出し手）→ 実装シンボルの照合を足す  | 採用。チェックリスト行 12 と T7 の対応表                                                                                      |
| 最終判定スクリプトを plan のターンで base HEAD に対して 1 回回す                | 採用。turn 2 で exit 0（冒頭の「前提の実測」）。T1 に直す行は不要                                                             |
| turns.jsonl の `usage_total` / reflect の注記                                   | plan の範囲外（ループ側・reflect スキルの話）。反映しない                                                                     |
| 残留リスク 1・3・5・10 を research の入力にし、3・5 を T1 に                    | 採用。REQUIREMENTS R0 / R0b / R0c、T1 = R0、T2 = R0b + R0c                                                                    |
| （前々回 20261009-0342）同じ値を 2 か所で導出する設計に「同じになる」と書かない | 採用。決めた事項 2（分割規則は `rsplit_once` 1 つ）と 11（`manifest()` の基準は画面 URL 1 つ）。境界値は T2 / T3 のテスト行に |
| （前々回）契約先行のサブエージェント運用、`build:wasm` / 全体 Vitest は親だけ   | 採用。T5 の「親:」行。T1 / T2 / T7 のサブ作業は文言・構造体を「決めた事項」で先に確定                                         |

### RESEARCH「盗める点」の採否

| 盗める点                                                                  | 採否 | 理由                                                                                                     |
| ------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `find_path` / `component_node` / `hidden_component` / `Runtime::instance` | 採用 | T3 / T4 の実装部品。新しい探索を書かない                                                                 |
| `metadata::Metadata`（`Clone` + `skip_serializing_if`）                   | 採用 | `Component.webmcp` にそのまま載せる                                                                      |
| `composition::prefix_widgets` 無改修                                      | 採用 | key / target の接頭辞は既にある                                                                          |
| probe の `loadStep` / `layoutStep` / `eventStep` / `equals`               | 採用 | T6 の新列                                                                                                |
| `tests/components-loader.test.js` の `fixture` / `treeManifest`           | 採用 | T1 / T2                                                                                                  |
| `tests/publish-packages.test.js` の `workspace` / `untouched`             | 採用 | T2-B                                                                                                     |
| 前回の `turn-014-lattice-f2.mjs`（基準依存キーの格子、revision 再計算）   | 採用 | T2 の (b) / (c) の雛形。scratch にコピーして使う（前のマイルストーンのファイルは読むだけ、書き換えない） |
| `tests/platform-features.test.js:195-232` の host モック                  | 採用 | T5 の `createUiTools` 経由テスト                                                                         |
| a11y ツリーの「親の非表示は子孫に伝播」                                   | 採用 | 決めた事項 3                                                                                             |
| Playwright の「スナップショットは操作のたびに取り直す」                   | 採用 | `docs/webmcp.md` の既存手順 4 を変えない                                                                 |
| `hidden` を `route()` の `blocked` と同じ基準に広げる（§5-C 代替）        | 却下 | REQUIREMENTS R2 の定義（`visibleBind` のみ）。意味が混ざる。文書で区別を書く                             |
| `components` を常に出して照合に正規化を足す（§5-A (b)）                   | 却下 | `docs/testing.md:91`「正規化はこの1か所だけ」を崩す                                                      |
| `Scene` の `components` を JS で `instanceTable` から推測する             | 却下 | R2「出所は WASM」                                                                                        |
| `rpc: []` を拒否する（§7-10）                                             | 却下 | 挙動不変の最小。`Object.values([])` は空                                                                 |

### impl への注意

- **タスク数 8**。T3 → T4 → T5 → T6 → T7 → T8 は直列（`lib.rs` → WASM → JS → probe → 文書 → 判定）。T1 / T2 はローダー側で独立だが、impl は PLAN の順（T1 → T2 → T3 …）に取る
- **Rust を触ったターン（T3 / T4）は必ず `bun run build:wasm` → `bunx vp test run` まで回す**。`tests/*.test.js` は `public/engine.wasm` を読むので、WASM が古いと JS テストが旧挙動で通ってしまう
- **T3 で probe が落ちる**のは想定内（`child-webmcp-refused` の load が通る）。T3 の中で列を最小形に書き換え、T6 で本置き換え。T3 / T4 のコミット時点で `probe-composition.mjs` が exit 0 であること
- **`lib.rs` を編集したら `MUTATIONS[*].from` の残存を確かめる**（チェックリスト行 13）。特に M1 `arrange(&self.root.ui, &state, 16.0,` と M4〜M7 の周辺（`node.listeners.get(&name)` / `config == resolve(&committed)?` / `object.insert("instance"…)`）を動かさない
- **`Scene` に `Debug` は無い**。Rust テストは `serde_json::to_value(&scene)` で JSON として見る
- **`BTreeMap` の順序は UTF-8 バイト順**。parts-lab の `components[]` は `approval` / `note` / `products`（`a` < `n` < `p`）。JS の期待値をこの順で書く
- **サブエージェントの運用**（前回どおり）: 親が起動前に文言・構造体・順序を「決めた事項」で確定して「内容を変えるな」と渡す。サブエージェントに `bun run build:wasm` / `cargo` / 全体 Vitest を禁止し、親がまとめて回す。契約外の提案は PROGRESS に件数と内容を残して親が採否を決める
- **Rhai 予約語**（デモに handler を足す場合。本計画は `.rhai` を変えない）: RESEARCH §6 末尾の一覧。T6 の probe の `show` は予約語ではない
- **`docs/components.md:172`（`window` 行）は T3 で文言だけ直す**。節の構成替え（「据え置きの拒否」→「子に許していないもの」）は T7。T3 の時点でチェックリスト行 2 を満たす
- 整形で行がずれるので、`bunx vp fmt` の後に `Edit` する前は必ず読み直す（前回 turn 2 の失敗）

### verify への申し送り

- 受け入れ 5 は `bun scripts/verify-instance-refactor.mjs` exit 0 と `target/engine-compare/composition.json` の `problems: 0`、文書の数字（行 4 / 5）との突き合わせで判定する
- 受け入れ 6b は Rust（T4 の直交表「親の `visibleBind`」行）/ JS（T5 の非表示ケース）/ probe（T6 の `layout:800` → `layout:800:shown`）の 3 経路
- 受け入れ 7 の `reserved for a later stage` は `window` 由来の 3 件も含めて 0 件（決めた事項 5）
- 観点別に分ける（前々回からの持ち越し）: (a) Rust の `components[]` / `hidden` の並行性・境界値（深さ 3、2 か所配置、再 load）、(b) ローダー R0 / R0b / R0c の基準依存キー格子、(c) 文書の断言 → 実装シンボル（T7 の表）、(d) 堅牢性格子（T8）
