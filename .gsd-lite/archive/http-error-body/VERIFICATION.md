# VERIFICATION — http-error-body

## round 2（turn 17 / 2026-10-19）— 判定: 合格（指摘 0 件）→ push + MR 作成（ローカルマージはしない）

対象: `git diff main...HEAD`（`.gsd-lite/` と `.claude/` を除く 62 ファイル）。round 1 からの差分は F1 / F2 の 7 ファイル（`src/adapters/http-download.js` +5/−2、`src/adapters/http.js` +13/−4、`tests/http-error-body.test.js` +77、`tests/opfs-file-transfer.test.js` +40、`docs/http-adapter.md` / `docs/opfs-file-transfer.md` / `docs/testing.md` の文言）。対象リポジトリに `CLAUDE.md` / `AGENTS.md` は無い。方針どおり round 1 の格子の再確認と F1 / F2 の回帰だけを行い、新しいクラスの探索はしていない。

### 観点と確認したこと

| 観点                                      | 方法                                                                                                                                                                                                                            | 結果                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最終判定（クリーンな状態から）            | `bun scripts/verify-instance-refactor.mjs --base-commit main`（証跡 `.gsd-lite/logs/http-error-body/scratch/turn-017-verify.log`）                                                                                              | **exit 0**。Vitest 37 files / **820 passed**（round 1 の 810 + F1 の 3 + F2 の 7）、Rust 101 passed、check（303 整形 / 114 lint）/ docs:check（61 ファイル / 529 リンク）/ build pass、照合 steps 370 / diffs 0 / skipped 2、probe problems 0、変異 7 本すべて検出。合計 246.4 秒                                                                   |
| 実ブラウザ（受け入れ 8 後半）             | `bun .gsd-lite/logs/http-error-body/scratch/turn-014-browser-run.mjs`（round 1 で取得した Chrome Headless Shell 153 を再利用。証跡 `turn-017-browser.log`）                                                                     | **dom / canvas とも `422 failure body` を含めて passed**、exit 0                                                                                                                                                                                                                                                                                    |
| F1 の回帰（download の `CLEANUP` 塗替え） | round 1 の再現 `bun .gsd-lite/logs/http-error-body/scratch/turn-005-c-download-network.mjs` を再実行。`src/adapters/http-download.js:127-164` の `finally` を読み、PLAN F1 の期待結果表 6 行をテストと突き合わせ                | 再現が `code: HTTP_422 / outcome: failed / status: 422 / bodyError: network` に変わった（round 1 は `CLEANUP / status 無し`）。表の上 3 行は `tests/opfs-file-transfer.test.js:1295-1333` の実物 `ReadableStream` の `it.each` 3 本、下 3 行は既存 3 本が無変更で green。`status` を持たない失敗の扱いは不変                                        |
| F2 の回帰（孤立サロゲートのエスケープ）   | アダプター経路のプローブ `bun .gsd-lite/logs/http-error-body/scratch/turn-016-surrogate-adapter-probe.mjs` を再実行。`src/adapters/http.js:129-141` `invalidShape` を読み、PLAN F2 の期待結果表 6 行と照合                      | 6 行すべて一致（4 行が `bodyError: invalid` で `body` 無し、正しいペア `😀` と NUL は受理）。実 WASM の両 surface で handler に **1 回だけ**届く（`tests/http-error-body.test.js:629-677`。`completeHost` 1 回・`onError` 0 回）。キー側も `Object.entries` で見ている                                                                              |
| round 1 の格子の再確認                    | T11 の格子 48 行（`turn-013-lattice.txt`）は Vitest の `tests/http-error-body.test.js` / `tests/opfs-file-transfer.test.js` の既存行として最終判定の中で全部 green。往復 16 ケース `turn-014-body-roundtrip-probe.mjs` を再実行 | 格子 48 行 + F2 の 6 行 = 54 行が想定の段で止まる。往復プローブは 13 OK / 3 FAIL のまま — この 3 行は `body` を `engine.completeHost` へ**直接**入れて HTTP アダプターを通さない形で、engine（serde_json）側の拒否を見ている。F2 はアダプターがそんな `body` を作らない側を直したので、判定には上の実 WASM テストを使う（turn 16 の申し送りどおり） |
| 契約文書 ↔ 実装（F1 / F2 が触った行）     | 追従先チェックリストの行 1・2・3・4・13・18 の `git grep` を再実行、`git grep -n -F '深さ64超'` で `invalid` の意味を列挙する箇所が `docs/http-adapter.md:135` だけであることを確認                                             | 行 1 = 0 件、行 2〜4 = `docs/http-adapter.md` 6 行 / `docs/opfs-file-transfer.md` 2 行 / `docs/worker-mock-api.md` 3 行に識別子あり、行 13 = `:38` `:41` に 1 件ずつ・「正規化はこの1か所だけ」0 件、行 18 = `900,000` / `1,000,000` / `100,000` / `変異7本` 不変。round 1 の指摘 3〜6 の文言はすべて反映済み                                       |
| 既存テストの期待値                        | `git diff 51b4bc8..HEAD -- tests` の削除行                                                                                                                                                                                      | **0 行**（追加のみ）                                                                                                                                                                                                                                                                                                                                |
| セキュリティ（F1 / F2 の差分）            | 新しい正規表現 `/\p{Surrogate}/u`（`g` 無しで `lastIndex` を持たない。64,000 バイト上限の文字列に線形）、新しい依存なし、`finally` の変更は `status` を持つ失敗に限定                                                           | 問題なし。round 1 の 10 観点の結論は変わらない                                                                                                                                                                                                                                                                                                      |

### 受け入れ基準の達成状況（REQUIREMENTS 1〜10）

| #   | 基準                                                                | 根拠                                                                                                                                                                |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | opt-in の 4 action で 422 + problem+json が `error.body` / `status` | `tests/host-adapters.test.js`（request）、`tests/opfs-file-transfer.test.js`（upload / multipart / download の opt-in）、`tests/http-error-body.test.js` の転送格子 |
| 2   | Worker モックの固定 422 で同じ値                                    | `tests/worker-mock.test.js`（固定ルート `validateOrder`、同梱画面の `validated`）                                                                                   |
| 3   | `bodyError` 5 値の区別と 64,000 ちょうどの受理                      | `tests/http-error-body.test.js` の request 格子（段 a〜g）と転送格子                                                                                                |
| 4   | opt-out は `status` の追加だけ                                      | 既存テストの assert 変更 0 件（`git diff main...HEAD -- tests` の削除行は `console.log` 文言と import の 2 行）                                                     |
| 5   | `uuid_v4()` / `random_int` / 枯渇 / 供給なし / import 0             | `engine/src/extensions/random.rs` の単体 7 本 + `mod.rs` 2 本、`tests/random-functions.test.js`、`tests/abi.test.js`、`bun run build:wasm` の import 検査           |
| 6   | `clientErrorOutcome: "failed"` の 4xx 判定                          | `tests/host-adapters.test.js` の `it.each`（400 / 401 / 403 / 404 / 409 / 422 → failed、408 / 429 / 5xx / 399 → unknown）、download は常に failed                   |
| 7   | 残留リスク 1 / 3 / 5 / 10                                           | `tests/components-loader.test.js` / `tests/publish-packages.test.js`（T1）                                                                                          |
| 8   | DOM / Canvas の Vitest + 実ブラウザ                                 | `tests/http-error-body.test.js` の両 surface 2 本、実ブラウザ `turn-017-browser.log`（dom / canvas passed）                                                         |
| 9   | R5 の格子                                                           | 格子 54 行 + 乱数の境界 14 件（`turn-013-lattice.txt`）、F1 / F2 で穴 2 件を閉じた                                                                                  |
| 10  | check / test / docs:check / build が green、R7 の文書追従           | 最終判定 exit 0、追従先 18 行（T11 の表 + 本ラウンドの再実行）                                                                                                      |

### 残留リスク（差し戻さない。MR 本文に書く）

- 成功本文（900 KB）には深さ 128 超（PLAN メモ 4）と孤立サロゲートのエスケープ（round 1 指摘 2 と同じ serde_json の拒否）の両方の穴が `main` から残る。要件外（REQUIREMENTS は失敗本文だけ）
- download で 200 の読み取りが失敗したとき（`NETWORK`）は `reader.cancel` の reject で `CLEANUP` になる。`main` からの既存挙動で、F1 は `status` を持つ失敗だけを守る（PLAN F1 の規則どおり）
- ホストから WASM へ渡る他の文字列（イベント payload 等）にも同じ serde_json の制約（孤立サロゲートのエスケープ）がある。既存・要件外
- `randomProvider` が疎配列（穴あり）を返すと JS 側の `every` が穴を飛ばして通り、Rust の serde が `null` を拒否して `ok: false`（trap ではない）。到達はホストの provider だけ
- `examples/opfs-file-transfer/home.rhai:63` は `r.error.body.title` を存在確認なしで読む。Rhai は `fail_on_invalid_map_property` 未設定なので欠落は `()` になり例外にはならない（デモの表示だけの話）

### MR

- `git push -u origin gsd-lite/http-error-body` 成功（新規ブランチ）→ `glab mr create --target-branch main` で **MR !2** を作成: https://gitlab.nasa.future.co.jp/fre/components/uivolve-web/-/merge_requests/2（本文は `scratch/turn-017-mr-body.md`。マージは人 / CI。ローカルマージはしない）

---

## round 1（turn 14 / 2026-10-19）— 判定: 差し戻し（F1・F2 の 2 タスク、指摘 6 件）

対象: `git diff main...HEAD`（62 ファイル、+3,048 / −188。`.gsd-lite/` と `.claude/` を除く）。対象リポジトリに `CLAUDE.md` / `AGENTS.md` は無い。

### 観点と確認したこと

| 観点                                          | 方法                                                                                                                                             | 結果                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最終判定（クリーンな状態から）                | `bun scripts/verify-instance-refactor.mjs --base-commit main`（証跡 `.gsd-lite/logs/http-error-body/scratch/turn-014-verify.log`）               | **exit 0**。Vitest 37 files / 810 passed、Rust 101 passed、check / docs:check / build pass、照合 steps 370 / diffs 0 / skipped 2、変異 7 本すべて検出。合計 252.2 秒 |
| 実ブラウザ（受け入れ 8 後半）                 | Playwright の Chrome Headless Shell 153 を `.gsd-lite/logs/http-error-body/scratch/ms-playwright/` に取得し `bun run test:transfer:browser` 相当 | **dom / canvas とも `422 failure body` を含めて passed**、exit 0（証跡 `turn-014-browser.log`。T10 / T11 の「実行不能」は環境の問題で、成果物の問題ではなかった）    |
| 契約文書 ↔ 実装の一対一（サブエージェント A） | 追従先チェックリスト 18 行の `git grep` 全行再実行、決めた事項 1〜23 の文言・数値・判定順・op 集合を実装行と突き合わせ                           | 18 行すべて OK。文言 12 本・数値 7 種・`bodyError` 5 値・判定順 (a)〜(g)・9 op は一致。**軽微な差 3 件**（下の指摘 3〜5）                                            |
| セキュリティ（サブエージェント B）            | 入力検証 / プロトタイプ汚染（`bun -e` 実測）/ 認可 / 秘密情報 / 乱数 / ABI 境界 / 資源 / インジェクション / 依存 / ローダーの 10 観点            | 問題なし 10 観点。**注意 1 件（低）**: handler 例外時の `onError` の `externalResult` に失敗本文が載る（下の指摘 6）                                                 |
| R5 の格子（round 1 の一括プローブ）           | T11 の格子表 48 行を段 (a)〜(g) と照合。加えて受け付けた本文の**往復**（JS → serde_json → Rhai → state）を実 WASM で 16 ケース                   | 格子 48 行は想定の段と実際の `bodyError` が一致。往復は 13 ケース OK、**孤立サロゲートのエスケープ 3 ケースが handler に届かない**（下の指摘 2）                     |
| 既存テストの期待値                            | `git diff main...HEAD -- tests` の削除行                                                                                                         | 2 行だけ（`console.log` の文言と import の差し替え）。assert の変更 0 件。Rust `composition_tests.rs` はシグネチャ追従のみ                                           |
| 文書の主張                                    | 「常に」「すべて」の断言を実装と照合                                                                                                             | `docs/opfs-file-transfer.md:131` の但し書きが R1「常に `status`」と矛盾する実態を固定している（指摘 1）。`docs/http-adapter.md:135` の「204」は到達しない（指摘 3）  |

### 指摘（PLAN の F1 / F2 に転記済み。round 2 で解消を確認）

1. **download の失敗本文の読み取り失敗が `CLEANUP` に塗り替わる**（F1）: 実物の errored `ReadableStream` では `reader.cancel()` が reject し、`finally` が `HTTP_422` / `status` / `bodyError: "network"` を `CLEANUP` に差し替える。R1「常に `status`」と R5「従来の失敗か本文付きの失敗のどちらかを 1 回だけ」に反する。再現 `bun .gsd-lite/logs/http-error-body/scratch/turn-005-c-download-network.mjs`
2. **孤立サロゲートのエスケープ（`"\udc00"` 等）を含む失敗本文が handler に届かない**（F2）: fatal UTF-8 も `JSON.parse` も通るが、`JSON.stringify` が `\udc00` のまま出し、Rust の serde_json が要求全体を拒否して `onError` だけになる。再現 `bun .gsd-lite/logs/http-error-body/scratch/turn-014-body-roundtrip-probe.mjs`
3. `docs/http-adapter.md:135` の `empty` の説明「204/304/HEADを含む」は 2xx の 204 に到達しない（文書が広い）
4. `docs/http-adapter.md:135` に Content-Type のパラメータ無視・大文字小文字無視の記述が無い（REQUIREMENTS R1 の条件。実装とテストは満たしている）
5. `docs/testing.md:41` の `tests/random-functions.test.js` の説明「providerの引き継ぎ」は `tests/runtime.test.js:67-80` の内容
6. `onError` の `externalResult` に失敗本文が含まれることを文書に 1 句（セキュリティ・低。同梱ホストは `message` だけを使う）
