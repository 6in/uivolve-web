# REQUIREMENTS — 段階 5: 子を含む画面の配信キャッシュ（component-loader）

状態: discuss 完了（2026-10-09）。research から無人ループで進める。前提は PR #3（component-effects、段階 4）がマージ済みの main。

## 背景（事実。discuss で調査済み）

- 子パッケージの再帰取得・絶対 URL への書き換え・同一 URL の 1 回取得・循環 / 深さ 3 / Instance 8 の検査・同梱後 2 MB の検査は段階 3 / 4 で実装済み（`src/application-loader.js` の `#components`、`src/engine.js` の `load`、`src/component-tree.js`）。
- 未実装は **components を持つ画面の配信キャッシュ（`network-first`）**。`src/application-loader.js` の `withoutComponents` が `fetch`（network-first 経路）と `restore` の両方で `componentsを持つ画面は配信キャッシュ（network-first）に対応していません` を投げる。マニフェスト（`version: 1 / revision / source / script / descriptors`）と `scripts/publish-packages.mjs` に子の概念が無い。
- 画面をまたぐ（ページ遷移をまたぐ）子パッケージのメモリ共有は無い。唯一の再利用はエディターの「変更を適用」が直前の load の子を使い回す `UiRuntime.components`。
- 2 MB は `2_000_000` バイト（10 進）。JS `src/engine.js:60` / `:114-125`（同梱後の合計と最大の子）、Rust `engine/src/abi.rs:181`（`Request exceeds 2 MB`）。
- `valid_instance_path`（`engine/src/composition.rs:209`）は長さを見ない。itemId に長さ上限は無い（80 文字は画面 id の上限）。

## 用語集

| 用語             | 意味                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| 木（tree）       | root パッケージと、その `components` から再帰的に到達する全子孫パッケージ                                      |
| 木のマニフェスト | root の `<画面URL>.manifest.json`。root のファイルに加えて全子孫のファイルを列挙する（本マイルストーンで拡張） |
| 版（revision）   | マニフェストの `revision`。木のすべてのファイルのハッシュから決まる                                            |
| 同梱             | 子孫を 1 回の `load` リクエストの `components` に入れること（既存）                                            |
| 保存版           | OPFS の `uivolve-web/cache/<SHA-256(root URL)>/versions/<revision>/` に置いた木一式                            |
| 復元             | 通信障害時に保存版から木を組み立てること                                                                       |
| メモリ共有       | 同じ `UiRuntime` 内で別ページが同じ子 URL を使うとき再取得しないこと（本マイルストーンで追加）                 |

## スコープ内（WHAT）

### R1. 木のマニフェスト（version 2）

- 子を含む画面のマニフェストは **root の 1 ファイル**に全子孫を列挙する。`version: 2` とし、既存の `revision / source / script / descriptors` に `components: { <子の絶対URL>: { source, script, descriptors } }` を足す。子の無い画面でも version 2 では `components: {}` を持つ。
- 子のキーは **root の画面 URL 基準の相対パス**（生成側はローカル相対パスをそのまま書ける。孫も root 基準に正規化する）。ローダーはキーを root の画面 URL で絶対化し、宣言を書き換えた href と突き合わせる。絶対化した結果が宣言の木と一致しない（余る・足りない）マニフェストは `マニフェストのコンポーネント情報が不正です`。各子の `source` / `script` / `descriptors` の形と上限（1 MB / 100 KB / 各 1 MB・8 件）は root と同じ。子の `descriptors` のキーはその子の DSL に書いた descriptor URL。
- version 2 の `revision` = `SHA-256(JSON.stringify([source.sha256, script.sha256, ソート済み[descriptorキー, sha256], ソート済み[子のキー, 子のsource.sha256, 子のscript.sha256, ソート済み[descriptorキー, sha256]]]))`。子が 1 バイトでも変わると root の `revision` が変わる。
- ローダーは **version 1（`components` 無し）と version 2 の両方**を受け入れる。version 1 の `revision` の式は変えない（既存の保存版 `current.json` / `previous.json` はそのまま復元できる）。version 1 に `components` があれば `配信マニフェストが不正です`。
- 生成スクリプトは**常に version 2** を出す（子の無い画面も再生成で `revision` が変わる。採用済みのトレードオフ）。
- 子孫の `url` は root のマニフェスト URL 基準。子孫のファイルも `packages/<revision>/` 配下に置く（例: `packages/<revision>/component-<i>-source` 等。命名は plan が決め、生成スクリプトとローダーで一致させる）。

### R2. 生成スクリプト（`scripts/publish-packages.mjs`）

- root の `components` を再帰的にたどり、JS ローダーと同じ規則（宣言単位・循環・深さ 3・8 パッケージ）で検査し、子孫のファイルをマニフェストに載せる。
- 子の `url` はローカル相対パスのみ（既存の「配信用ビルダーにはローカルの相対パスを指定してください」と同じ制約）。
- 子の `url` は**宣言した画面のファイル基準**で解決し、子の `script` / descriptor はその子のファイル基準で読む（JS ローダーの相対 URL の規則と同じ）。マニフェストの子キーは root 基準の相対パス（R1）。plan が「生成側のキー」と「ローダーが絶対化した href」の一致を完了基準に書く。
- 木のファイルの合計が 2 MB の上限（R4）を超えるなら生成を止め、最大の子を文言に出す。
- `bun run build:wasm` と引数なしの `publish:packages` は `SCREEN_CATALOG` の全画面（`order-dashboard` / `parts-lab` を含む）のマニフェストを生成する。

### R3. ローダー（`src/application-loader.js`）

- `network-first`: 木のマニフェストを取得し、root と全子孫のファイルを取得・サイズ / SHA-256 / revision を検証し、WASM のコンパイル・init・UI / state 検証に成功してから木一式を保存する。`withoutComponents` の拒否は無くす。
- 保存は root の `versions/<revision>/` 配下に木一式を置き（子は `components/<i>/{source,script,descriptor-N}`、`<i>` はマニフェストの子キーをソートした順の添字）、全ファイルの書き込み完了後に `current.json` を公開する。直前版の保持と古い版の削除は既存どおり。「保存版を削除」は root のディレクトリごと消すので子も消える。
- マニフェスト検証の新しい失敗文言: 子の項目が不正 → `マニフェストのコンポーネント情報が不正です`。合計が上限超 → `配信ファイルの合計が2 MBを超えています（合計 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）`（R4）。子のファイルのサイズ / ハッシュ不一致は既存の `配信ファイルのサイズ・ハッシュが一致しません` に子の URL を添える。これらは `docs/files-cache-rpc.md` の文言と `docs/components.md` の「エラー文言」節に列挙する。
- 復元は **木全体を 1 版として**行う。root と子孫のどれか 1 つでも検証に失敗したらその版は使わず、直前版を試す。新しい root と古い子の混在は作らない。
- 復元した木も `network-only` と同じ検査（循環・深さ・Instance 数・scope・2 MB）を通してから `compile` へ渡す。
- 取得・検証・保存のエラー文言は既存の日本語文言の体系に合わせる（どの子で失敗したか URL を出す）。
- `network-only` の挙動は変えない。

### R4. 2 MB 上限（据え置き + 早期拒否）

- 上限値は `2_000_000` バイトのまま。Rust 側 `Request exceeds 2 MB` も据え置き。
- マニフェスト検証の段階で、木のファイルの `size` 合計が上限を超えるなら**ファイルを取得する前に**拒否し、最大の子の URL とバイト数を文言に出す。
- `publish-packages.mjs` も生成時に同じ上限で止める（R2）。
- 既存の load 時の 2 段構え（JS の同梱後バイト数 / Rust の入力長）はそのまま残す。

### R5. ページ遷移をまたぐ子のメモリ共有

- 同じ `UiRuntime` 内で、別のページ（root）が同じ絶対 URL の子を使うとき、再取得せずに共有する。対象は**子パッケージだけ**（root / ページ自体は共有しない）。
- `network-only` と `network-first` の両方で共有する。
- 無効化の契機は 3 つ: (1) `refreshEngine: true` の `load`（ツールバーの「再読込」`src/main.js:369`）、(2) `cacheMode` の変更（`src/main.js:201` / `UiRuntime.cacheMode` の代入）、(3) 認証設定の変更（`resources.getAuthentication()` の結果が変わったとき）。いずれも共有を全消しする。ページ遷移（`src/page-effects.js:32` / `src/application.js:103` の `load`）では消さない。
- `network-first` では、マニフェストに載った子の `source` / `script` / `descriptors` の sha256 が共有中の子と**すべて一致したときだけ**使い、違えば取得して置き換える。`network-only` にはマニフェストが無いので一致確認せずに使う（セッション内では子の更新を見ない。採用済みのトレードオフ）。
- 共有中の子も保存（R3）に必要なバイト列を持つ（共有を経由した木も OPFS へ完全に保存できる）。
- 復元（R3）で得た子は共有へ入れてよい。復元の木は OPFS のバイト列を正とする。
- `UiRuntime.components`（エディターの「変更を適用」が直前の load の子を使う既存の挙動）は変えない。

### R6. 前回の残留リスクの解消

- 残留リスク 3: `配送先が未登録です` の経路（`http-effects.js` / `storage-effects.js` / `page-effects.js`）が `onError` に落とし `complete` を呼ばない契約を固定する自動テストを 1 本以上。plan は**最初のテストタスク**に含める。
- 残留リスク 1: `Unknown component instance: {instance}` に最大 2 MB 弱の文字列がそのまま載る。`instance` の長さ上限を **256 バイト**とし、超過は値を文言に載せずに `Component instance path exceeds 256 bytes` で拒否する（`engine/src/abi.rs` の `take_instance` で `valid_instance_path` より先に長さを見る）。`docs/components.md` の制限表と「エラー文言」節に 1 行足す。既存の `Invalid component instance` / `Unknown component instance` の文言は変えない。Rust のテストを 1 本足す（256 バイトは通り 257 バイトは拒否、state 不変）。

### R7. デモ

- `order-dashboard` と `parts-lab` のマニフェストがビルドで生成され、ツールバーの「通信優先＋保存版」で保存・復元が実際に動く。

### R8. 堅牢性（受け入れ基準）

- どのマニフェスト・保存版・通信の状態（壊れたマニフェスト、子だけ欠けた版、途中で中断した保存、容量不足、循環する子）でも、未捕捉例外を出さず、既存の保存版と表示中の UI を失わない。
- 保存失敗は画面に表示し、表示中の UI は維持する（既存の規則の木への拡張）。

### R9. 文書の追従

更新対象（調査で特定済み。plan が追従先チェックリストに連番で載せる）:

- `docs/components.md`: 状態行（段階 4 → 5）、`:21`、`:173`（キャッシュの拒否）、`:175`、`:209`、`:226-231`（2 MB の段構え）、`:243-249`（段階 5 以降の課題）、エラー文言の列挙節、制限表
- `docs/components-plan.md`: 状態行、`:87`、`:100`（段階 5 を完了に）
- `docs/files-cache-rpc.md:82-100`（配信キャッシュ節。木のマニフェストの形・生成・上限）
- `docs/opfs-cache-rpc-investigation.md:10,20,88,93`
- `docs/architecture.md:84`、`docs/ai-development.md:26`、`docs/testing.md:41,90`、`docs/host-adapters-design.md:178`
- `skills/uivolve-web-app-dev/references/components-layout.md:30`、`skills/uivolve-web-engine-dev/references/components.md:12`
- `README.md:116`

## 受け入れ基準（verify が見る）

1. `bun run check` と `bun run test`（Vitest + Rust）が green。
2. `tests/components-loader.test.js` の「キャッシュ経路の拒否」（`l.190`）が「木を保存・復元できる」に置き換わり、少なくとも次を固定する: (a) version 2 の木のマニフェストで取得→検証→保存→`current.json` 公開、(b) 通信障害時に木全体を保存版から復元し子の URL 書き換え・scope 表が `network-only` と同じ、(c) 子 1 つの破損（サイズ / ハッシュ不一致）で現在版を使わず直前版へ、(d) 直前版も壊れていれば `通信に失敗し、利用できる保存版もありません`、(e) 合計が 2 MB 超のマニフェストはファイル取得前に拒否（取得回数 0 を検証）、(f) version 1 のマニフェスト / 保存版が子無し画面で今までどおり動く、(g) version 1 + `components` は拒否、(h) 同じ子を 2 か所に置いた木は 1 回だけ保存される。
3. `tests/files-cache-rpc.test.js` / `scripts/publish-packages.mjs` のテスト: 子を含む画面から version 2 のマニフェストが生成され、ローダーの `manifest()` を通る。子の循環 / 深さ 4 / 9 パッケージ / 2 MB 超で生成が止まる。
4. メモリ共有: 別ページへの遷移で同じ子を再取得しない（`resources.text` の呼び出し回数で検証）。`refreshEngine` / `cacheMode` 変更 / 認証変更で再取得する。`network-first` でマニフェストの sha256 が違えば再取得する。
5. 残留リスク 3 のテスト（`配送先が未登録です` → `onError`、`complete` 不呼び出し）が http / storage / page の 3 経路にある。
6. 残留リスク 1 の Rust テスト（257 バイトの `instance` を拒否し文言に値を含まない）。
7. `bun run build:wasm` 後に `public/screens/order-dashboard.json.manifest.json` と `parts-lab.json.manifest.json` が version 2 で存在し、子を列挙している（生成物は Git 管理しない既存方針のまま。`.gitignore` を確認）。
8. R8 の堅牢性: 上記 (c)(d) と、保存の途中中断（`signal` abort）・OPFS の書き込み失敗を模した経路で未捕捉例外が無く、表示中の UI と既存の `current.json` が残る。
9. R9 の文書追従が全行済み（plan の追従先チェックリストの行番号つき再実行）。`docs/components.md` の「段階 5 以降の課題」から配信キャッシュを外し、`components-plan.md` の段階 5 を完了に更新。

## スコープ外

- 子の `window`（モーダル層の親子共有）。
- WebMCP の合成（段階 6）。
- 子ごとに別マニフェストを参照する形（却下。DECISIONS）。
- cache-first、Service Worker、JWT 配信の保存、署名検証、複数画面 URL の合計容量制御 / LRU（既存のスコープ外のまま）。
- ETag / If-None-Match による条件付き取得。
- 並列取得（子の fetch は現状どおり順次でよい。速度は受け入れ基準に入れない）。
- 2 MB 上限値の変更、Rust 側 ABI の上限変更。
- 前回の残留リスク 2・4・5・6。
- ループやスキルの改修（本 discuss で行った 5 スキルの編集を除く）、lean-ctx フックの project root。

## 検証の道具（既存）

- `tests/components-loader.test.js`（ローダーの子取得・循環・深さ・2 MB・キャッシュ経路の拒否 `l.190`）、`tests/files-cache-rpc.test.js`（マニフェスト・保存・復元）、`tests/components-demo.test.js`、`tests/components-effects.test.js`、`tests/parts-lab.test.js`
- `engine/src/composition_tests.rs`、`scripts/probe-composition.mjs`
- `bun run check`（整形 + lint + cargo fmt）、`bun run test`、`bun run build:wasm`
