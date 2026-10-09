# VERIFICATION — component-loader（段階 5: 子を含む画面の配信キャッシュ）

- 実施: 2026-10-09 / gsd-lite-verify（turn 11、verify round 1）
- 対象: `git diff main...HEAD`（main `aa79bd1` → HEAD `844162e`。38 ファイル / +3,907 / −1,122）
- 実行エンジン: Claude Code（Claude Fable 5.1）。サブエージェント 2 本（読み取り専用。A: 契約文書 ↔ 実装の一対一、B: セキュリティ）
- 判定: **指摘あり → impl へ差し戻し**（F1: 契約文書 4 か所、F2: 子キーの絶対化の基準を 3 入口で揃える。verify round 1 → 2）。コードの受け入れ基準 1〜9 はすべて満たしており、最終判定・格子・セキュリティに差し戻し級の欠陥は無い

## 観点

1. 受け入れ基準 1〜9（REQUIREMENTS `:99-107`）と PLAN の完了基準の突き合わせ
2. コードレビュー（`src/application-loader.js` / `scripts/publish-packages.mjs` / `engine/src/abi.rs` / `src/runtime.js` / `scripts/compare-engine-behavior.mjs`）
3. セキュリティ（入力検証・プロトタイプ汚染・OPFS パス・オリジン・共有の迂回・資源）
4. 堅牢性（R8）の格子を round 1 で一括プローブ
5. 文書の主張（追従先チェックリスト 14 行の再実行、文言列挙と実装の一対一、件数・識別子）
6. 既存テストの期待値の変更の妥当性
7. PLAN の最終判定コマンドをクリーンな状態から再実行

## 確認したこと

### 最終判定（クリーンな状態から）

`git status --short` が空の HEAD で `bun scripts/verify-instance-refactor.mjs` → exit 0（`.gsd-lite/logs/component-loader/scratch/turn-011-verify.log`。87.5 秒）。

| 手順                                                   | 結果                                  |
| ------------------------------------------------------ | ------------------------------------- |
| `bun run build:wasm` / `bunx vp test run`              | 0 / 0（Vitest 35 files / 715 passed） |
| `bun run test:rust` / `bun run check`                  | 0 / 0（cargo 91 passed）              |
| `bun run docs:check` / `bun run build`                 | 0 / 0                                 |
| base `aa79bd1` との照合 / probe composition            | 差分 0 / problems 0（54 ステップ）    |
| 変異 7 本（`build-engine-variant.mjs` の `MUTATIONS`） | 各 exit 1（検出）                     |

### 追従先チェックリスト・T8 固有条件の再実行

- `bun .gsd-lite/logs/component-loader/scratch/turn-009-checks.mjs` → 行数 14 / NG 0
- `bun .gsd-lite/logs/component-loader/scratch/turn-010-t8-checks.mjs` → 11 条件 / NG 0（`lib.rs` 0 行差分、`withoutComponents` 0 件、`componentsを持つ画面` 0 件、デモ 3 画面の sidecar が version 2 で子を列挙、生成物は gitignore 済み）

### 受け入れ基準 1〜9

| #   | 判定 | 根拠                                                                                                                                                                                                                                      |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | OK   | 上の最終判定（`check` exit 0、Vitest 715、cargo 91）                                                                                                                                                                                      |
| 2   | OK   | `tests/components-loader.test.js` に「キャッシュ経路の拒否」は無く（`withoutComponents` 0 件）、(a) `:758` (b) `:790` (c) `:853` (d) `:866` (e) `:458`（sidecar 以外の読み 0） (f) `files-cache-rpc.test.js` 無改修 (g) `:394` (h) `:875` |
| 3   | OK   | `tests/publish-packages.test.js` 11 本（version 2 生成 `:124`、ローダーの `manifest()` を通り save → restore `:146`、循環 `:172` / 深さ 4 `:189` / 9 Instance `:217` / 2 MB 超 `:242`、カタログ全画面 `:339` `:349`）                     |
| 4   | OK   | 共有 7 本 `:1025-1154` + runtime レベル `:1386` / `parts-lab.test.js:298`（遷移で再取得しない・refresh・mode 変更・認証変更・sha256 不一致で再取得）                                                                                      |
| 5   | OK   | `tests/components-effects.test.js:550-602`（http / storage / page の 3 経路。`onError` 1 回・`complete` 0 回）                                                                                                                            |
| 6   | OK   | `composition_tests.rs` `a_completion_naming_an_instance_longer_than_256_bytes_is_refused_on_length`（256 通過 / 257 拒否 / 文言に値を含まない / UTF-8 バイト）+ `tests/abi.test.js:200`                                                   |
| 7   | OK   | T8 固有条件の再実行（上）                                                                                                                                                                                                                 |
| 8   | OK   | 2(c)(d) + `:933`（quota / abort で `current.json` 不変）+ `:1467`（`save-error` で `runtime.screen.id` 維持）+ 下の格子                                                                                                                   |
| 9   | OK   | 14 行の再実行（上）。`docs/components.md` は「段階6以降の課題」、`components-plan.md` の段階 5 は完了                                                                                                                                     |

### 堅牢性の格子（round 1。`scratch/turn-011-lattice.mjs`。83 ケース / NG 0）

- **軸 1: マニフェストの形 × network-first**（59 ケース）: 非オブジェクト 6 種、子の値 6 種、子の `descriptors` 6 種、root の `descriptors` 4 種、子キー 11 種（`""` / `?q` / `#f` / `//evil` / 別オリジン / `javascript:` / `data:` / `file:` / root 自身 / sidecar 自身 / 認証情報付き）、`size` 9 種（`-0` / `-1` / `1e308` / `NaN` / 文字列 / 小数 / 上限超 / `null` / `undefined`）、`__proto__` / `constructor` / `prototype` キー 5 種、子 9 件 / descriptor 9 件、version / revision / `components` の型 8 種、合計 2,000,001、宣言との不一致 2 種。すべて文言どおりの `Error`（`TypeError` / `RangeError` の漏れなし）。`javascript:` 等は `httpUrl` が弾いて `マニフェストのコンポーネント情報が不正です`、別オリジン・root 自身・sidecar 自身はキーとして形は通るが revision 不一致で止まる
- **軸 1b: 配信バイト**: 子の source が不正 UTF-8 → `TypeError`、JSON 不正 → `SyntaxError`。どちらも `NETWORK` ではないので `fetch` から投げられ、`main.js:215` の `画面を読み込めませんでした。…` で表示される（root と同じ既存の経路。表示中の UI は `compile` 前なので不変）
- **軸 2: 保存版の状態 × 復元**（16 ケース）: `current.json` が不正 JSON / `null` / `[]` / 別 URL / `metadata: null` / version 1 + `components`、子のスロット無し / 子の source 無し / 子の script 差し替え / 不正 UTF-8 / `versions` 無し / root の source がディレクトリ / 子のスロットがファイル / 余る子を載せたポインタ → いずれも `通信に失敗し、利用できる保存版もありません（…）`。現在版の子だけ壊して直前版が無傷 → 直前版で復元し `current.json` は第 2 版のまま
- **軸 3: 保存の失敗 × `current.json`**（4 ケース）: 子の script の `close` で `QuotaExceededError`、子の source 書き込み中の abort、子スロットの `mkdir` 失敗、abort 済み signal → すべて reject し `current.json` は第 1 版のまま
- **軸 4**: abort 済み signal で `fetch` → `AbortError`（握りつぶさない）

### コードレビュー（親）

- `manifest()`: version 1 / 2 の両受け、version 1 の `components` 禁止、子の形・上限・絶対化後の重複・8 件、合計 2 MB の早期拒否（descriptor を含めない。DECISIONS「plan が決めた細部」1）、revision 一致の順序が PLAN T2 どおり。子は null-prototype の表に写す
- `#walk`: 循環・深さ・1 回取得・`declaration.url` の書き換え・`instanceTable` / `scopeProblem` が供給元に依らず 1 か所。共有エントリの `screen` に対する書き換えは絶対 URL への冪等な代入
- `supplied()`: 索引に無い子の拒否 → 共有の再利用 → `open` + `verify`（子の href 付き文言）→ `parsed`。`open` は `try` の外なので `NETWORK` の `code` が保たれ `restore` へ落ちる
- `#remember` は `#walk` 完走後にだけ呼ばれる（`fetch` 2 経路 + `restore`）。`#share` の無効化は `refresh` / `mode` / `auth` の値比較
- `save`: root → 子（マニフェストのキーのソート順 = 復元のスロット）→ abort / 認証 → `previous.json` → `current.json` → 古い版の削除（配列に集めてから）。OPFS のパスは 64 桁 hex の revision と整数の添字だけで組む
- `restore`: 版ごとに root → 走査（`#fromStore`。共有は使わない）→ `#matchTree`。失敗の理由は `NotFoundError` 以外を保持。`clear` は無改修
- `scripts/publish-packages.mjs`: 子の読みは宣言ファイルの dirname 基準、子キーは root 基準の posix 相対パス、命名・添字・revision（`manifestRevision` を import）がローダーと一致。拒否時は `packages/` も sidecar も作らない。root 単独で 2 MB に届かない根拠（`parsePackage` の 1 MB + script 100 KB）はテスト `:266` で固定
- `engine/src/abi.rs`: 長さの腕が `valid_instance_path` の腕より前、`String::len` = UTF-8 バイト、値を文言に載せない
- `scripts/compare-engine-behavior.mjs`: `matches()` の 1 行は base が段階 4 以降でも HTTP effect の id を引けるようにする訂正で、照合の正規化（`kind` 除去）と差分 0 は不変
- 既存テストの期待値の変更: T3 の暫定 1 本（`stores the root alone …`）を T5 で削除した以外に無し。削除は PLAN T5 の完了基準どおりで、同じ入口は (a)(b) が引き継ぐ。`tests/files-cache-rpc.test.js` は無改修で green（受け入れ 2(f)）
- REQUIREMENTS R4「木のファイルの `size` 合計」は DECISIONS（plan が決めた細部 1）で「`source.size + script.size`（descriptor を含めない）」に狭められ、`docs/components.md` / `docs/files-cache-rpc.md` はその定義で書かれている。REQUIREMENTS 本文は discuss 時点の表現のままだが、契約文書と実装は一致している

### サブエージェント A（契約文書 ↔ 実装の一対一）

英語 8 文言・日本語 10 文言（括弧付きの派生を含む）を `git grep -n -F` で実装に引き、マニフェスト version 2 の形・revision の式・命名・OPFS 配置・上限・2 MB の合計・メモリ共有の 7 項目・復元の規則・256 バイトの適用範囲・件数と段階番号を照合。一致 — 上記すべて。不一致 4 件（→ F1）:

| #   | 文書                                                           | 実装                                         | 内容                                                                                                                                         |
| --- | -------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/components.md:181`                                       | `application-loader.js:189-198` `sameHashes` | 文書は「sha256 / size が…すべてで一致」。実装は sha256 だけを比べ `size` は見ない（REQUIREMENTS R5 も sha256 だけ）。文書が広い              |
| 2   | `docs/components.md:205` / `docs/files-cache-rpc.md:109`       | `application-loader.js:46-52,83`             | 「`components`の形が外れたとき」は `配信マニフェストが不正です`。`マニフェストのコンポーネント情報が不正です` は子エントリの形               |
| 3   | `docs/components.md:202,256`                                   | `publish-packages.mjs:44,51,52`              | `宣言が不正です` / `循環参照` / `入れ子が3段` は生成スクリプトも出す（`{URL}` の位置は絶対ファイルパス）。文書は 2 MB の文言だけ生成側を書く |
| 4   | `docs/components.md` エラー文言 / `docs/files-cache-rpc.md:93` | `application-loader.js:581-585`              | 新しい派生 `通信に失敗し、利用できる保存版もありません（{理由}）` が列挙に無い（基本形も文書に無い）                                         |

注記（差し戻さない）: `docs/components.md:182` の「トークンだけを差し替えた配信は検知しない」は `network-only` では「子の更新を一切検知しない」が実態で、文の直後に「再読込で取り直す」とあるので契約としては足りている。`docs/testing.md:91` の「3つの列」と `docs/components.md:280` の「6列」は main から変わっていない既存の表現差

### サブエージェント B（セキュリティ）

プロトタイプ汚染（すべて null-prototype の表か `Map`）、OPFS パス（64 桁 hex の revision と整数添字だけ）、オリジン（`httpUrl` + `ResourceClient` の `allowedOrigins`。version 1 の root と同じ露出で広がっていない）、共有の迂回（`#remember` は `#walk` + `#matchTree` 完走後だけ、network-first は `sameHashes` 必須、`restore` は `fetch` の fallback からしか呼ばれない）、資源（マニフェスト 1 MB・子 8 件・descriptor 8 件がファイル取得前に効く）、`take_instance`（長さの腕が先、固定文言）、生成側の書き込み先（固定の接頭辞 + 整数）、秘密情報（トークンの出力なし）— 問題なし。指摘:

| #   | 深刻度 | 内容                                                                                                                                                                                                                                                                                                 | 扱い                                                                                      |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | medium | `network-only` は宣言単位で子を取得し、Instance 8 の上限は配置にしか掛からないので、root が ui に置かない宣言を大量に持つと件数に上限なく取得し `#share` に保持する（main の `#components` も宣言単位で取得していた既存の挙動。`docs/components.md:260` に明記済み。本マイルストーンは保持を足した） | 残留リスク（要件外・既存）                                                                |
| 2   | low    | 共有の無効化は `getAuthentication()` のメタデータ比較なので、同じ origin・同じ mode でトークンだけ替えても共有が残る                                                                                                                                                                                 | 仕様どおり（DECISIONS「plan が決めた細部」8、`docs/components.md:182`）。残留リスクに記録 |
| 3   | low    | `screen.id` が文字列でない root + `storage` / `files` を宣言する子で `scopeProblem` が `TypeError`、`rpc: {a: null}` で `.descriptor` の `TypeError`（どちらも main の root 経路に既存。子でも同じ）。`main.js:215` が捕捉して表示し UI は不変                                                       | 残留リスク（既存）                                                                        |
| 4   | low    | 子キーの絶対化の基準が `fetch`（sidecar）と `save` / `restore`（画面 URL）で違い、`""` / `?x` / `#f` のキーは `fetch` が通して `save` が `マニフェストに無い子` で落ちる（ポインタは更新されず、孤立した版は次の正常な保存で削除される）                                                             | → **F2**                                                                                  |
| 5   | info   | `revision` / `sha256` の正規表現は配列を文字列化して通すが、下流は厳密比較なので拒否に収まる                                                                                                                                                                                                         | 残留リスク（表記上の明示だけの話）                                                        |
| 6   | info   | `current.json` に `null` を書かれると `save` が `TypeError` を投げ続け「保存版を削除」まで保存できない（既存。`restore` 側は `last` に握る）                                                                                                                                                         | 残留リスク（既存。同一オリジンの OPFS 書き込みが要る）                                    |

## 残留リスク（差し戻さない）

1. **`network-only` の宣言単位の取得に件数上限が無い**（B-1。既存）: root が置かない宣言を大量に持てば取得・保持が膨らむ。対策候補は「1 パッケージの宣言は 8 件まで」をローダーの `#walk` と生成側に足すこと（Rust の `At most 8 component packages` と同じ数）。本マイルストーンの要件外
2. **トークンだけの差し替えは共有を無効化しない**（B-2。仕様）: 利用者の切り替えで子の本体を取り直すには `load(..., { refreshEngine: true })` か認証メタデータの変更が要る。文書化済み
3. **`screen.id` 非文字列・`rpc` の値が `null` で `TypeError`**（B-3。既存）: 表示は `画面を読み込めませんでした。…` で UI は保たれるが、文言は日本語の契約文言ではない。`parsePackage` で `id` を文字列に限定し `rpc` の値を object に限定する検査を足せば閉じる
4. **復元の失敗理由に処理系の文言が混ざる**（親の格子）: `current.json` が `null` のとき `通信に失敗し、利用できる保存版もありません（null is not an object (evaluating 'stored.url')）`。未捕捉ではなく UI も不変だが、`stored` の形の検査を `manifest()` の前に足せば日本語の文言になる。`NotFoundError` を `last` に握らないので、版ディレクトリの中の子ファイルだけが消えた場合は理由なしの基本形になる
5. **`current.json` が `null` だと `save` が毎回失敗**（B-6。既存）: `JSON.parse` は通るが `.url` で `TypeError`。`restore` と同じく `last` 相当で握るか `clear` を案内する
6. **決めた事項 2 の非対称**（PLAN の申し送り）: load できた 257 バイト超の接頭辞付き `instance` の子は完了を受け取れない。`docs/components.md:228` に itemId を範囲に収める注意を書いた
7. **決めた事項 1（descriptor を合計に含めない）**: REQUIREMENTS R4 の「木のファイルの `size` 合計」より狭いが、DECISIONS と契約文書は狭めた定義で一致している。descriptor には 1 MB / 8 件の上限が別にある
8. **配信バイトの UTF-8 / JSON 不正は `TypeError` / `SyntaxError`**（親の格子 軸 1b。既存の root 経路と同じ）: `NETWORK` ではないので復元へ落ちず、`main.js:215` で表示する。UI は不変
9. **`#walk` が共有エントリの `screen` を直接書き換える**（決めた事項 7。設計）: 絶対 URL への代入なので冪等だが、将来 `declaration` に別のキーを足す変更は共有との相互作用を見ること
