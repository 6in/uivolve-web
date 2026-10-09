# PLAN — component-loader（段階 5: 子を含む画面の配信キャッシュ）

- 作成: 2026-10-09 / gsd-lite-plan（turn 2）
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md / `.gsd-lite/reflect/20261009-0342-component-effects.md` と `20261008-0114-component-composition.md` の「次回への提案」
- 行番号は HEAD = `bae3026`（main `aa79bd1` + discuss + research の 2 コミット）のもの。impl は各ターンの冒頭で `git grep -n` で引き直す

## 検証コマンド

impl の各ターンがテストに使うコマンド（リポジトリのルートで実行）:

```bash
bun run build:wasm                                   # Rust・デモのマニフェストを触ったターンの最初に 1 回（約 40 秒。public/engine.wasm と public/screens/*.manifest.json を再生成）
bunx vp test run tests/components-loader.test.js     # 対象ファイルだけ回す（他: tests/files-cache-rpc.test.js / tests/components-effects.test.js / tests/publish-packages.test.js / tests/abi.test.js / tests/runtime.test.js）
bunx vp test run                                     # Vitest 全体（約 60 秒）
bun run test:rust                                    # cargo test（engine/）
bun run check                                        # vp check（整形 + lint）+ cargo fmt --check。exit code はここで見る
bun run docs:check                                   # Markdown のローカルリンク切れ（scripts/check-docs.mjs）
```

- 環境の初期化（テストの前に毎回）: なし。`bun run build:wasm` は `bun run test` が先頭で回す（`package.json` の `test`）。Vitest の多くが `public/engine.wasm` と `public/screens/*.manifest.json` を読むので、Rust・`scripts/publish-packages.mjs`・`public/screens/` を触ったターンは Vitest の前に `bun run build:wasm` を回す
- 最終判定（クリーンな状態から全検査。verify と T8 が使う）: `bun scripts/verify-instance-refactor.mjs`（`BASE_CHECKS` 6 本 `verify-instance-refactor.mjs:19-26` = `build:wasm` → `vp test run` → `test:rust` → `check` → `docs:check` → `build` → base `main` の WASM が無ければ自動ビルド `:82-94` → base 照合 差分 0 → 候補のみ probe exit 0 → 変異 7 本（`build-engine-variant.mjs:9` の `MUTATIONS`）が各 exit 1。スクリプト本体は無改修。本マイルストーンの Rust 変更は `engine/src/abi.rs` の `take_instance` だけで、`MUTATIONS` の `from` は全部 `lib.rs`（`build-engine-variant.mjs:13-61`）なので変異は触らない。base 照合は 256 バイト以下の `instance` に差分を作らない（応答が変わるのは 257 バイト以上の拒否だけで、照合の列にそんな値は無い））
- このリポジトリの注意: `bunx vp check <Markdown 1 本>` は整形 pass でも lint 対象 0 件で非 0 終了する。Markdown の整形は `bunx vp fmt <path>` の出力で判定し、exit code は `bun run check` で見る。`.gsd-lite/*.md` は整形対象（`vite.config.js:20-29` の `ignorePatterns` に `.gsd-lite/state.json` と `.claude/**` だけ）なので、PLAN / PROGRESS を書いたら `bunx vp fmt .gsd-lite/PLAN.md .gsd-lite/PROGRESS.md` を掛ける
- Vitest の一時ディレクトリは `tests/distribution.test.js:16` と同じ `mkdtemp(join(tmpdir(), "uivolve-…"))`（Vitest の子プロセスは Bash の allowlist の外で動くので既存テストと同じ形でよい）。impl 自身の一時ファイルは `.gsd-lite/logs/component-loader/scratch/turn-NNN-*.{mjs,txt}`

## 追従先チェックリスト

「X を足したら直す場所」。impl は該当する変更をしたら全行を確かめ、T8 は**行番号つきで全行**を再実行して PROGRESS に「行 1 … 行 N」の表で書く（行数が合わなければ T8 は未完了）。verify は照合を再実行する。

| 行  | 変更の種類                                        | 直す場所                                                                                                                                                                                                                                                                                                                                                                                                               | 確かめ方                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 旧契約の言い回し（配信キャッシュの拒否）          | `docs/components.md:173`（据え置きの拒否「配信キャッシュ」段落 → 削除し「据え置きの拒否」を 3 つに）、`:246`（段階 5 以降の課題から配信キャッシュを外す）、`skills/uivolve-web-app-dev/references/components-layout.md:30`（「`components`を持つ画面は`network-first`で配信できない」→ 木のマニフェストで配信できる）、`docs/ai-development.md:26`（「配信キャッシュ … 段階5以降の将来設計」から配信キャッシュを外す） | `git grep -n -E 'componentsを持つ画面                                                                                                                                                                                                                                                                           | network-firstで配信できない                                                                                                                                                                  | 1パッケージ1本                                                                      | マニフェストが1パッケージ                                                                                                                        | 段階5で決める | 配信キャッシュ.*段階5以降' -- docs README.md skills src tests scripts index.html .claude` が 0 件 |
| 2   | 旧契約の言い回し（段階の状態行）                  | `docs/components.md:3`（「実装済み契約（段階4）」→ 段階5）、`docs/components-plan.md:3`（「段階4 … まで完了」→ 段階5）、`:87`（「入力2MB上限の扱いは段階5で決める」→ 据え置き + マニフェスト段階の早期拒否）、`:100`（段階5 を「本マイルストーンで完了」に）                                                                                                                                                           | `git grep -n -F '実装済み契約（段階4）' -- docs/components.md` が 0 件、`git grep -n -F '状態: 段階4' -- docs/components-plan.md` が 0 件、`git grep -n -F '段階5で決める' -- docs/components-plan.md` が 0 件、`git grep -n -F '段階5（ローダー）。本マイルストーンで完了' -- docs/components-plan.md` が 1 件 |
| 3   | マニフェストの形・revision の式・生成物の命名     | `docs/files-cache-rpc.md:102`（生成物に `component-<i>-source` 等を足す）、`:104`（`version: 2 / … / components`、revision の式、子の上限）、`:106`（キャッシュの配置に `components/<i>/`）、`:86-90`（手順に木の取得・検証・保存）                                                                                                                                                                                    | `git grep -n -F 'version: 1 / revision' -- docs` が 0 件、`git grep -n -F 'version: 2' -- docs/files-cache-rpc.md` が 1 件以上、`git grep -n -F 'component-<i>-source' -- docs/files-cache-rpc.md` が 1 件以上                                                                                                  |
| 4   | JS の日本語文言を足す（ローダー・生成スクリプト） | `docs/components.md:177-196`「エラー文言」の日本語の列挙に `マニフェストのコンポーネント情報が不正です`・`配信ファイルの合計が2 MBを超えています（合計 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）`・`配信ファイルのサイズ・ハッシュが一致しません（{URL}）`、`docs/files-cache-rpc.md` の配信キャッシュ節に同じ 3 文言                                                                                   | `git grep -c -F 'マニフェストのコンポーネント情報が不正です' -- docs/components.md docs/files-cache-rpc.md` が両方 1 以上、`git grep -c -F '配信ファイルの合計が2 MBを超えています' -- docs/components.md docs/files-cache-rpc.md` が両方 1 以上                                                                |
| 5   | 2 MB の段構え                                     | `docs/components.md:226-231`（「2MBはJS側とRust側の2段構え」→ マニフェスト段階（生バイトの粗い前段）・同梱後（JS）・入力長（Rust）の 3 段。「マニフェスト段階は生バイト、load は JSON 化後」を書く）、`:209`（制限表の「ABIの1リクエスト」行に「配信はマニフェストの `source.size + script.size` 合計で前段拒否」）                                                                                                    | `git grep -n -F '2段構え' -- docs/components.md` が 0 件、`git grep -n -F '3段構え' -- docs/components.md` が 1 件以上                                                                                                                                                                                          |
| 6   | Rust の英語文言を足す（`instance` 256 バイト）    | `docs/components.md:181-188`「英語（Rust）」の列挙に `Component instance path exceeds 256 bytes`、`:131`（「形から外れた値は…」の文に 256 バイト超を足す）、`:202-210` 制限表に行「完了opの`instance` \| 256バイト（超えると値を文言に載せずに拒否）」、`docs/architecture.md:84`（完了の 7 操作が受ける `instance` は 256 バイト以内）                                                                                | `git grep -c -F 'Component instance path exceeds 256 bytes' -- docs/components.md` が 2 以上（文言列挙 + 制限表 or :131）、`git grep -c -F '256' -- docs/architecture.md` が 1 以上                                                                                                                             |
| 7   | メモリ共有（R5）の契約                            | `docs/components.md`「据え置きの拒否」の後ろか「制限」の前に「子パッケージのメモリ共有」節を新設（同じ `UiRuntime` 内・子だけ・3 契機・`network-first` は sha256 一致時のみ・トークンだけの差し替えは検知しない・`network-only` はセッション内で子の更新を見ないので「再読込」で取り直す）、`docs/files-cache-rpc.md` の配信キャッシュ節から参照                                                                       | `git grep -n -F 'メモリ共有' -- docs/components.md docs/files-cache-rpc.md` が両方 1 件以上、`git grep -n -F '再読込' -- docs/components.md` が 1 件以上                                                                                                                                                        |
| 8   | テストファイルを足す・役割を変える                | `docs/testing.md:41`（`components-loader.test.js` の行に「木のマニフェストの検証・保存・復元・メモリ共有」）、`:43`（`components-effects.test.js` に「配送先未登録の拒否」）、表に `tests/publish-packages.test.js` の行を足す、`docs/files-cache-rpc.md:185`（`files-cache-rpc.test.js` の説明に木の保存・復元は `components-loader.test.js` と書く）                                                                 | `git grep -n -F 'tests/publish-packages.test.js' -- docs/testing.md` が 1 件、`git grep -n -E '配送先' -- docs/testing.md` が 1 件以上                                                                                                                                                                          |
| 9   | OPFS の調査文書（計画・検討の履歴）               | `docs/opfs-cache-rpc-investigation.md:10`（「同じ版の定義とスクリプトをまとめて保持する」→ 子パッケージも同じ版に含める）、`:20`、`:88`、`:93`（「マニフェストと全ファイル」に木を含める 1 句）。履歴文書なので「段階 5 で子を含む木に拡張した」の 1 行を「アプリケーションキャッシュ案」節の末尾に足す形でよい                                                                                                        | `git grep -n -F '段階5' -- docs/opfs-cache-rpc-investigation.md` が 1 件以上                                                                                                                                                                                                                                    |
| 10  | README・スキル・ホスト設計の 1 行                 | `README.md:116`（`application-loader.js` / `publish-packages.mjs` の説明に「子を含む木」）、`skills/uivolve-web-engine-dev/references/components.md:12`（ローダーの木の取得・共有・配信キャッシュは `src/application-loader.js` が担う 1 句）、`docs/host-adapters-design.md`（plan 時点で `git grep -n -E 'network-first                                                                                              | キャッシュ                                                                                                                                                                                                                                                                                                      | マニフェスト' -- docs/host-adapters-design.md`が 0 件。impl が再実行して 0 件なら**無改修と判定して PROGRESS に書く**。REQUIREMENTS の`:178`は空行で`:179` が「バイナリABIと検証」の見出し） | `git grep -n -E '木                                                                 | 子を含む' -- README.md`の`:116` が 1 件、`git grep -n -F 'application-loader' -- skills/uivolve-web-engine-dev/references/components.md` が 1 件 |
| 11  | 無改修と判定する文書（理由を PROGRESS に書く）    | `docs/runtime-distribution.md:40`（「配信キャッシュを有効にする場合はマニフェストの生成も必要」。木でも真）、`:105`、`skills/uivolve-web-app-dev/references/io-extensions.md:15`、`skills/uivolve-web-engine-dev/references/host.md:21`（network-first の一般論）、`docs/components.md:194`（配送先未登録の説明。テストを足すだけ）、`docs/testing.md:90`（最終判定の手順。`verify-instance-refactor.mjs` は無改修）   | T7 と T8 が「無改修」と PROGRESS に明記する（行 11 の 6 か所を列挙）                                                                                                                                                                                                                                            |
| 12  | ソースをテキストとして読むテスト・スクリプト      | `scripts/build-engine-variant.mjs:9-61`（`MUTATIONS` の `from` は全部 `engine/src/lib.rs` の文字列。`lib.rs` は本マイルストーンで触らない）、`tests/browser/font-parity.mjs:1072`（`lib.rs` の `XTYPES`。触らない）。`abi.rs` を読むテスト・スクリプトは無い（`git grep -n -E 'readFile(Sync)?\(.*(src/                                                                                                                | engine/src/                                                                                                                                                                                                                                                                                                     | scripts/)' -- tests scripts` が上の 1 件だけ）                                                                                                                                               | `git diff main --stat -- engine/src/lib.rs` が 0 行、最終判定の変異 7 本が各 exit 1 |
| 13  | 件数を書いている文書                              | `docs/components.md:253`「probe は 6 列・54 ステップ」（probe は無改修なので変わらない）、`docs/components.md:167`「子に許していないのは次の4つだけ」→ 配信キャッシュを外して **3つ**                                                                                                                                                                                                                                  | `git grep -n -F '次の4つだけ' -- docs/components.md` が 0 件、`git grep -n -F '次の3つだけ' -- docs/components.md` が 1 件                                                                                                                                                                                      |
| 14  | AI への生成指示文書（常に追従先）                 | `docs/ai-development.md:26`（行 1 と同じ行。「子の`window`・WebMCPの合成は段階6以降の将来設計」に書き換え、配信キャッシュは実装済みとして「子を含む画面も `network-first` で配信・復元できる」を 1 句）                                                                                                                                                                                                                | `git grep -n -F '配信キャッシュ' -- docs/ai-development.md` の行が「段階5以降」を含まない                                                                                                                                                                                                                       |

## Tasks

<!--
粒度: 各タスクは 1 ターン（新規コンテキスト 1 回）で実装 + テスト + コミットまで完結する大きさ。8 タスク。
依存順に並べる（impl は常に先頭の未完了タスクを取る）。
-->

- [x] T1: 前回の残留リスク 1・3（`instance` 256 バイト上限 / `配送先が未登録です` の契約テスト）
  - 完了基準:
    - (A) Rust: `engine/src/abi.rs:36-42` の `take_instance` を `pub(crate) fn` にし、`Some(Value::String(path)) if path.len() > 256 => Err("Component instance path exceeds 256 bytes".into())` の腕を `valid_instance_path` の腕より**前**に置く（P13: `String::len` = UTF-8 バイト数）。既存の `Invalid component instance` / `Unknown component instance: {instance}`（`lib.rs:1001`）の文言は変えない。`engine/src/composition_tests.rs` に 1 本（`crate::abi::take_instance(&json!({"instance": …}))` で: `"a".repeat(256)` → `Ok`、`"a".repeat(257)` → `Err` で文言が `Component instance path exceeds 256 bytes` に等しく **`err.contains(&path)` が false**、`format!("{}:{}", "a".repeat(200), "b".repeat(57))`（257 バイト・`:` 入り）→ 長さの文言（`valid_instance_path` より先に効く）、`"あ".repeat(86)`（258 バイト・86 文字）→ 長さの文言、`"a".repeat(255) + "/x"`（257）→ 長さの文言、`None` → `Ok("")`）。`tests/abi.test.js:194-203` の表に行 `["a".repeat(257), "Component instance path exceeds 256 bytes"]` を足し、既存の `layout` 文字列一致（state 不変）がその行でも成立する。`bun run test:rust` と `bunx vp test run tests/abi.test.js` が green
    - (B) JS: `tests/components-effects.test.js` に `describe("配送先が未登録の Instance")` を足し、`HttpEffects`（`src/http-effects.js:31-38`）/ `StorageEffects`（`src/storage-effects.js:35-42`）/ `PageEffects`（`src/page-effects.js:28-31`）の 3 経路それぞれで: `host.resetInstances(new Map([["", base]]))` の後に `run([{ id: 1, instance: "ghost", … }])` → `onError` が 1 回・引数の `message` が `コンポーネント ghost の配送先が未登録です`、`complete`（page は `load`）が 0 回、`resources.text` / `client.execute` が 0 回。root 由来（`instance` 無し）を空の `Map` に流す行（`resetInstances(new Map())` → `コンポーネント  の配送先が未登録です`。空白 2 つ）も 3 経路に置く。雛形は `tests/http-grid.test.js:163-181` / `tests/platform-features.test.js:311-337` / `tests/page-navigation.test.js:182-190`。`bunx vp test run tests/components-effects.test.js` が green
    - (C) 文書（列挙の drift を本タスクで塞ぐ。T7 は再確認だけ）: `docs/components.md` の英語文言列挙（`:181-188`）に `Component instance path exceeds 256 bytes`、`:131` の文に「256 バイトを超えるパスは値を載せずに `Component instance path exceeds 256 bytes`」、制限表（`:202-210`）に行「完了opの`instance` | 256バイト」を足す（追従先 行 6 の前半）。`bunx vp fmt docs/components.md` 済み
    - 到達性: `take_instance` は `abi.rs:99,121,132` ほか 7 op の入口で、JSON のデコード直後に呼ばれる。手前に効く防壁は `Request exceeds 2 MB`（`abi.rs:181`。2 MB 未満の 257 バイトには掛からない）だけ
  - 対象: `engine/src/abi.rs`, `engine/src/composition_tests.rs`, `tests/abi.test.js`, `tests/components-effects.test.js`, `docs/components.md`
  - 依存: なし
  - 並列サブ作業:
    - A: Rust の 256 バイトの腕とテスト + `tests/abi.test.js` の 1 行（対象: `engine/src/abi.rs`, `engine/src/composition_tests.rs`, `tests/abi.test.js`）
    - B: 配送先未登録の 3 経路テスト（対象: `tests/components-effects.test.js`）
    - 親: (C) の文書 3 行、`bun run build:wasm` → `bun run test:rust` → `bunx vp test run tests/abi.test.js tests/components-effects.test.js` → `bun run check` → コミット（サブエージェントには `bun run build:wasm` / `cargo` / 全体 Vitest を禁止し、親が統合後にまとめて回す）

- [x] T2: マニフェスト version 2 の検証と revision（`manifest()` の両受け・`components` の形・キーの絶対化・2 MB 早期拒否）
  - 完了基準:
    - `src/application-loader.js:13-25` `manifestRevision(value)` が `value.version === 2` のとき R1 の式 `SHA-256(JSON.stringify([source.sha256, script.sha256, ソート済み[descriptorキー, sha256], ソート済み[子キー, 子.source.sha256, 子.script.sha256, ソート済み[descriptorキー, sha256]]]))` を返し、version 1（および `version` 無し）は既存の 3 要素の式のまま。比較子は既存の `<` / `>`（`:20`）を子キーにも使う（P1）
    - `manifest(value, base)`（`:26-54`）: `version` が 1 でも 2 でもない → `配信マニフェストが不正です`。version 1 で `Object.hasOwn(value, "components")` → `配信マニフェストが不正です`（P16: 空 `{}` でも不正）。version 2 で `components` が own property でない・`null`・配列・object 以外 → `配信マニフェストが不正です`。各子（`Object.entries` で読み、`Object.create(null)` に写す。P17）: 値が object でない / `source` `script` `descriptors` が root と同じ `check`（1 MB / 100 KB / 各 1 MB・8 件）を通らない / `httpUrl(key, base)` が投げる / 絶対化した href が別のキーと重複（P3 の `a.json` と `./a.json`）/ 子が 8 件超 → `マニフェストのコンポーネント情報が不正です`。この段階では子ファイルの `url` の形だけ見る（`httpUrl(entry.url, base)`。取得はしない）
    - 2 MB 早期拒否（R4。決めた事項 2）: `manifest()` の中で、revision 検査の**前**に `total = Σ (source.size + script.size)`（root + 全子。descriptor は含めない）を取り、`total > 2_000_000` なら `配信ファイルの合計が2 MBを超えています（合計 {total} バイト。最大の子: {href} {bytes} バイト）`（`href` は絶対化した子キー、`bytes` はその子の `source.size + script.size`。最大が同値なら絶対化した href の `<` 順で先のもの）。`total === 2_000_000` は通る
    - 検証の順序: version → root の `check` → descriptors → `components` の形 → 合計サイズ → revision 一致（`配信revisionとファイルのハッシュが一致しません`）
    - `fetch` の network-first 経路（`:171-197`）は本タスクでは **`manifest()` を通した後に `withoutComponents` を呼ぶ既存の形のまま**（木の取得は T3、`withoutComponents` の撤去も T3）。version 2 で `components: {}` の子なし画面は `withoutComponents`（宣言の有無しか見ない `:63`）を素通りするので、T2 の時点で network-first と `save` / `restore` を往復できる。`tests/files-cache-rpc.test.js:225-253` の `cacheFixture` は version 1 のままで green
    - テスト（`tests/components-loader.test.js` に `describe("ApplicationLoader の木のマニフェスト")` を新設。fixture は `:48-67` の `fixture()` + `reads` を流用し、マニフェストを `responses` に載せる補助関数 `treeManifest(list)` を作る（子キー → `{source, script, descriptors}` を実バイトから組み、`revision` は `manifestRevision` で付ける）。ファイルは `packages/<rev>/component-<i>-source` 等の命名（決めた事項 4））:
      - (a) version 2 + `components: {}` の子なし画面が network-first で取得でき、`save` → `restore` が往復する（`memoryOpfs` + `locks: null`。`tests/helpers/opfs.js`）
      - (b) version 1 + `components: {}` → `配信マニフェストが不正です`（受け入れ 2(g)）。version 3 → 同文言。version 2 で `components` 無し → 同文言
      - (c) 子の `script.size` が 100_001 / 子の `descriptors` が 9 件 / `source.sha256` が 63 桁 / `components: []` / 子キー `a.json` と `./a.json` の重複 / 子キー `javascript:alert(1)` / 子 9 件 → `マニフェストのコンポーネント情報が不正です`（`components: []` は `配信マニフェストが不正です`）。いずれも `resources.bytes` が 0 回（`reads` にマニフェスト URL 以外が無い）
      - (d) 合計 2,000,001（例: root `source.size` 1,000,000 + `script.size` 1 + 子 A `source.size` 999,000 + 子 B `source.size` 1,000、子の `script.size` は 0 → 2,000,001。`size` は 0 以上の整数なら `check` を通る `:34-36`）→ `配信ファイルの合計が2 MBを超えています（合計 2000001 バイト。最大の子: {子 A の href} 999000 バイト）` で `reads` にマニフェスト URL 以外が無い（受け入れ 2(e)。§1.5 の読み方）。合計ちょうど 2,000,000 は manifest を通り、次の `resources.bytes` が 404 なので `HTTP 404` で落ちる（境界値。P10）
      - (e) `manifestRevision`: 同じ木を子キーの挿入順を逆にして組んでも revision が同じ。descriptor を持つ子（`rpc-demo.pb`。`:294-327` の fixture）でも同じ。子の `source.sha256` を 1 文字変えると revision が変わる
      - (f) P17: `JSON.parse('{"components":{"__proto__":{"source":5}}}')` の形（own property として入る `__proto__` キーで値が形不正）が `TypeError` 等の例外にならず `マニフェストのコンポーネント情報が不正です`。値の形が正しい `__proto__` キーは `httpUrl("__proto__", base)` を通るので T2 では拒否されない（宣言との一致検査が T3。**T3 (b) で `（宣言に無い子: …）` を固定する**）
    - `bunx vp test run tests/components-loader.test.js tests/files-cache-rpc.test.js` が green（既存の `refuses a screen with components on the delivery cache path` `:190-214` は T3 で置き換えるので本タスクでは残す）
  - 対象: `src/application-loader.js`, `tests/components-loader.test.js`
  - 依存: なし（T1 と独立。順序は T1 → T2）
  - 並列サブ作業: なし（同じ 2 ファイル）

- [ ] T3: 走査の供給元抽象化と network-first の木の取得（`withoutComponents` の撤去）
  - 完了基準:
    - `#components(screen, url, signal)`（`:121-158`）を `#walk(screen, url, signal, provide)` に置き換える。`provide(href, name)` は `(href: URL) → Promise<{screen, script: string, descriptors, sourceBytes, scriptBytes, hashes: {source, script, descriptors: {key: sha256}}}>` の形で、循環（`stack`）・深さ（`depth + 1 > 3`）・1 回取得（`packages[href]`）・宣言の `url` 書き換え（`declaration.url = child.href`）・`instanceTable` / `scopeProblem` の検査は `#walk` の 1 か所に残す（§5-A）。供給元に関係なく宣言へ降りる（P4）
    - 供給元 2 つ（T5 で 3 つ目）: `#fromNetwork(signal)` = 既存 `#download` + `hashes` の計算（`sha256` を取得時に 1 回）、`#fromManifest(metadata, sidecar, base, signal)` = `httpUrl(key, base).href → entry` の索引を `manifest()` の結果から組み、`provide(href)` は索引に無ければ `マニフェストのコンポーネント情報が不正です（マニフェストに無い子: {href}）`、あれば `resources.bytes(httpUrl(entry.url, sidecar))` + `verify` を source / script / descriptors（ソート済みキー順）に掛け、`hashes` はマニフェストの sha256 をそのまま持つ。子ファイルの `verify` 失敗は `配信ファイルのサイズ・ハッシュが一致しません（{href}）`（`href` = 子パッケージの絶対 URL。root のファイルは既存文言のまま）
    - 走査後の一致検査 `#matchTree(index, packages)`（§5-B）: 索引にあって `packages` に無い href → `マニフェストのコンポーネント情報が不正です（宣言に無い子: {href}）`（複数なら `<` 順で先頭 1 件）
    - `#candidate`（`:79-101`）の「parse → rpc の descriptor 集合とファイルの一致 → `script` 文字列必須」を純関数 `parsed(url, source, script, descriptors)` に切り出し、root（`#candidate`）と `#fromManifest`（子）の両方が使う（子でも `RPCのDescriptorと配信ファイルが一致しません` / `script URLがありません` が出る）
    - `fetch` の network-first（`:171-197`）: manifest → root の source / script / descriptors → `#candidate` → `#walk(candidate.screen, url, signal, #fromManifest(...))` → `#matchTree` → `signal?.throwIfAborted()` → 認証再確認 → `candidate.components = packages`（`{screen, script, descriptors, sourceBytes, scriptBytes, hashes}` のまま。`engine.js:93-103` / `runtime.js:56-64` は 3 キーしか読まないので壊れない）→ return。network-only は `#walk(..., #fromNetwork(signal))`。**`withoutComponents`（`:60-67`）と `fetch:195` の呼び出しを削除**。`restore:300` の呼び出しは T5 で消すので、本タスクでは `restore` の中で `candidate.components = Object.create(null)` を直接置いて **`components` を持つ保存版を `マニフェストのコンポーネント情報が不正です` で拒否**（T5 までの暫定。T5 の完了基準で置き換える）
    - 子の取得で `e.code === "NETWORK"` の失敗は root と同じく `restore` へ落ちる（`catch` は既存 `:198-206` のまま）。ハッシュ不一致・一致検査の失敗は落ちない（既存 `rejects corrupted … packages` と同じ意味）
    - テスト（`tests/components-loader.test.js`）: `:190-214` の `refuses a screen with components on the delivery cache path` を**削除**し、`describe("ApplicationLoader の木のマニフェスト")` に足す:
      - (a) parent（子 a・孫 leaf、`parts/b.json`）の version 2 マニフェストで network-first → `candidate.components` のキーが network-only と同じ 3 つ、`candidate.screen.components` の URL 書き換え・`candidate.components[a].screen.components.leaf.url` が network-only と `toEqual`、`instanceTable` の表が同じ、各子ファイルの `reads` が 1
      - (b) マニフェストに無い子（宣言にあるのにキーが無い）→ `マニフェストのコンポーネント情報が不正です（マニフェストに無い子: {href}）`。宣言に無い子（余るキー）→ `（宣言に無い子: {href}）`。`__proto__` キー（T2 (f) の期待値をここで書き換える）→ `（宣言に無い子: {href}）`。いずれも余る子のファイルは取得しない（`reads` に無い）
      - (c) 子の script のバイトを差し替え（サイズ同じ・ハッシュ違い）→ `配信ファイルのサイズ・ハッシュが一致しません（{子の href}）`。root の script 差し替え → 既存文言（URL 無し）
      - (d) 子の取得が `TypeError("offline")`（`code: "NETWORK"`。`resource-client.js` が付ける）→ `restore` へ落ち、保存版が無ければ `通信に失敗し、利用できる保存版もありません`
      - (e) 共有から来た子でも走査が宣言へ降りる（P4）はメモリ共有が T4 なので T4 で書く。本タスクでは network-first の木に対する循環（子が root を宣言）→ `循環参照`、深さ 4 → `入れ子が3段を超えています`、scope 違反の子 → `保存領域 … が不正です` の 3 本（network-only の既存テスト `:126-159,:280-291` と同じ fixture にマニフェストを付ける）
      - (f) 既存の入口 × 新しい状態の直交表: `fetch(network-only)` / `fetch(network-first)` / `save` / `restore` / `clear` の 5 入口のうち、本タスク後に木を流せるのは `fetch` の 2 つ。`save(candidate)` に木の候補を渡すと子を書かない（T5 までの暫定。`save` の既存テストが green のまま）。`restore` は `components` ありの保存版を拒否する（上記）。`clear` は無改修
    - `bunx vp test run tests/components-loader.test.js tests/files-cache-rpc.test.js tests/parts-lab.test.js tests/components-demo.test.js tests/components-effects.test.js` が green（network-only の既存テストは期待値不変）
  - 対象: `src/application-loader.js`, `tests/components-loader.test.js`
  - 依存: T2
  - 並列サブ作業: なし（走査の書き換えとテストは同じ構造に依存する）

- [ ] T4: ページ遷移をまたぐ子のメモリ共有（R5）と無効化の 3 契機
  - 完了基準:
    - `ApplicationLoader` に `#share = new Map()`（href → T3 の provide の戻りの形）と `#shareKey = { mode: undefined, auth: undefined }` を持つ（`UiRuntime` ごとに 1 つ `runtime.js:83`）。`fetch(value, { mode, signal, refresh = false })` の冒頭で `auth = JSON.stringify(this.resources.getAuthentication())`（P12）を取り、`refresh || mode !== this.#shareKey.mode || auth !== this.#shareKey.auth` なら `#share.clear()`、その後 `#shareKey = { mode, auth }`（P11: 値比較）。`UiRuntime.load`（`runtime.js:419-422`）が `refresh: refreshEngine` を渡す
    - 供給元の共有参照: `#fromNetwork` は `#share.get(href)` があれば取得せずに返す（network-only は一致確認なし）。`#fromManifest` は `#share.get(href)` の `hashes` が索引のエントリと**すべて一致**（`source` / `script` の sha256、`descriptors` のキー集合と各 sha256）したときだけ返し、違えば取得して置き換える。root は共有しない（`#share` に入れるのは `#walk` が集めた `packages` だけ）
    - 共有への追加は `#walk` が `instanceTable` / `scopeProblem` まで終えた**後**に `for (const [href, entry] of Object.entries(packages)) this.#share.set(href, entry)`（P6: 途中の abort・検証失敗では入れない）。`fetch` の `catch` → `restore` 経路でも T5 の復元後に同じ関数で入れられるよう `#remember(packages)` に切り出す
    - 共有エントリの `screen` は clone せず凍結もしない（決めた事項 7。走査の `declaration.url` 書き換えは絶対 URL に対して冪等、`runtime.js:45-70` の `resolveComponents` は `prepareScreen` で clone する）
    - `UiRuntime.components`（`runtime.js:385`。編集適用の再利用）は触らない
    - テスト（`tests/components-loader.test.js` に `describe("子パッケージのメモリ共有")`。`fixture()` の `reads` で回数を数える）:
      - (a) 同じ loader で parent A（子 a・孫 leaf）→ parent B（子 a）を network-only で順に取得 → `reads.get(a.json)` と `a.rhai` と `leaf.json` が 1、B の `candidate.components[a]` と A のものが**同じオブジェクト**（`toBe`）、A の取得後と B の取得後で共有エントリの `screen` が `toEqual`（P5）
      - (b) `fetch(B, { refresh: true })` → 2 回目の取得。同じ `mode` で `refresh` 無しの 3 回目 → 増えない（P11）
      - (c) `resources.setAuthentication({ mode: "none", allowedOrigins: [同じ] })` を再設定して取得 → 増えない。`allowedOrigins` を変える → 増える。`{ mode: "jwt", token: "x", allowedOrigins: [...] }` にして network-only で取得 → 増える（P12。network-only は認証ありでも取得できる）
      - (d) network-first: A の木のマニフェストで取得（子ファイル `component-0-source` 等の `reads` が 1）→ もう 1 度 network-first → 子ファイルの `reads` は 1 のまま（共有を使った）→ 子の script を変えたマニフェスト（sha256 違い）→ 子ファイルを再取得（`reads` が 2）し `candidate.components[a].script` が新しい値。descriptor の sha256 だけ違う場合も再取得
      - (e) `network-only` で取得 → `network-first` で取得（`mode` 変更）→ 子ファイルをマニフェスト経由で取得する（共有が消えている）。逆順も同じ
      - (f) 共有から来た子でも走査が降りる（P4。深さのみ。循環は共有経由では構成できない: 共有に入った子の部分木は検証済みで、別 root からの循環は「その子が root を宣言する」ことになり最初の load で落ちる）: A（depth 2 で `mid` を共有。`mid` → `leaf`）→ B（`wrap` → `mid` → `leaf` = depth 4）→ `コンポーネントの入れ子が3段を超えています: {leaf の href}`、`mid` のファイルは再取得していない
      - (g) 取得途中の失敗は共有に入らない（P6）: A の `leaf.rhai` を 404 にして A が失敗 → `leaf` を使う B の取得で `leaf.json` が再び読まれる（`reads` 2）。`a.json` も共有に入っていない（`a.json` の `reads` 2）
      - (h) `UiRuntime.load(url, { refreshEngine: true })` が `applicationLoader.fetch` に `refresh: true` を渡す（`vi.spyOn(runtime.applicationLoader, "fetch")`。`tests/components-loader.test.js` の 2 つ目の `describe` の `host()` を使う。雛形は `tests/runtime.test.js:49-59`）。`refreshEngine` 無しの `load` は `refresh: false`
      - (i) runtime レベル（`tests/parts-lab.test.js` の `host()` を流用して同ファイルに 1 本）: `runtime.load("screens/parts-lab.json")` → `runtime.load("screens/http-grid.json")` → `runtime.load("screens/parts-lab.json")` で、`fetch` モックの呼び出し URL のうち `parts/note-pad.json` と `parts/approval.json` が 1 回ずつ、`http-grid.json` は 2 回（root としての 1 回 + 子としての 1 回。root は共有しない。`:245-260` の形）
    - `bunx vp test run tests/components-loader.test.js tests/parts-lab.test.js tests/runtime.test.js` が green
  - 対象: `src/application-loader.js`, `src/runtime.js`, `tests/components-loader.test.js`, `tests/parts-lab.test.js`
  - 依存: T3
  - 並列サブ作業: なし（共有の形が供給元と結びつく）

- [ ] T5: 木の保存と復元（`save` / `restore` の木への拡張、堅牢性）
  - 完了基準:
    - `save(candidate)`（`:208-264`）: root の source / script / descriptor を書いた後、`keys = Object.keys(candidate.metadata.components ?? {}).sort()` の添字 `i` ごとに `href = httpUrl(keys[i], candidate.url).href`、`entry = candidate.components[href]`（無ければ `マニフェストのコンポーネント情報が不正です（マニフェストに無い子: {href}）`）、`directory.mkdir(`${path}/components/${i}`)` → `write(`${path}/components/${i}/source`, entry.sourceBytes)` → `script` → `descriptor-${n}`（`n` は `Object.keys(metadata.components[keys[i]].descriptors ?? {}).sort()` の添字。`entry.descriptors[key]` のバイト列）。保存は**マニフェストのキー**で回す（P15: 2 か所に置いた子も 1 回）。その後は既存どおり abort / 認証 / `previous.json` / `current.json` / 古い版の削除。古い版の削除は `versions.entries()` を**配列に集めてから** `removeEntry`（P9）し、`NotFoundError` は無視
    - `restore`（`:265-306`）: ポインタごとに `manifest()` → root のファイル `verify` → `#candidate(..., "cache", metadata)` → `#walk(candidate.screen, url, signal, #fromStore(directory, metadata, url, signal))` → `#matchTree` → `candidate.components = packages` → `#remember(packages)`（T4）→ return。`#fromStore` は `keys.sort()` の逆引き（`href → i`）で `components/${i}/{source,script,descriptor-n}` を `directory.read` + `verify`（失敗は `配信ファイルのサイズ・ハッシュが一致しません（{href}）`）。root と子孫のどれか 1 つでも失敗したらその版を使わず次のポインタ（R3）。`catch` は `catch (e) { signal?.throwIfAborted(); last = e; }` の形で最後の理由を保持し（P7）、両方失敗したら `通信に失敗し、利用できる保存版もありません（{last.message}）`（`last` があるとき。ポインタが無い `NotFoundError` だけなら既存の文言のまま）。**T3 の暫定（`components` ありの保存版の拒否）を削除**
    - `clear` は無改修（子は root 配下。R3）
    - `restore` の走査は `withFileLock` の callback の中で動くが他のロックは取らない（§1.1: `save` / `restore` / `clear` を別のロックの callback から呼ばない）
    - テスト（`tests/components-loader.test.js` の `describe("ApplicationLoader の木のマニフェスト")` に足す。`memoryOpfs` + `locks: null`。版ディレクトリの中身は `OpfsDirectory(["uivolve-web", "cache", await sha256(encoder.encode(url.href))])` で読む（`tests/files-cache-rpc.test.js:301-306` の形）:
      - (a) 受け入れ 2(a): version 2 の木（子 a・孫 leaf・`parts/b.json`、うち 1 つは descriptor 付き）で取得 → `save` → `versions/<rev>/components/0..2/{source,script[,descriptor-0]}` が存在し、`current.json` の `metadata` が version 2 で `components` を持つ。`write` の呼び出し回数（`fs.controls.beforeClose` の回数）= root 2 + 子 3 × 2 + descriptor 1 + `current.json` 1 = 10
      - (b) 受け入れ 2(b): マニフェスト取得を `TypeError("offline")` にして network-first → `status: "cache"`、`candidate.components` のキー・各子の `screen.components` の書き換え後 URL・`instanceTable` の表・`scopeProblem` の判定が network-only の取得結果と `toEqual`、`candidate.fallbackReason` が `offline`。復元した木が `runtime.compile(candidate.screen, candidate.script, url, { components: candidate.components })`（`tests/components-loader.test.js` の 2 つ目の `describe` の `host()`）で実 WASM に load できる
      - (c) 受け入れ 2(c): 2 版を保存（T2 の `treeManifest` で子の script を変えた第 2 版）→ 現在版の `components/0/script` を `"bad"` に上書き → `restore` の `metadata.revision` が第 1 版。`current.json` は第 2 版のまま（壊した版は消さない。既存 `:290-311` と同じ）
      - (d) 受け入れ 2(d): 第 1 版の子も壊す → `通信に失敗し、利用できる保存版もありません（配信ファイルのサイズ・ハッシュが一致しません（{href}））`（正規表現 `/保存版もありません/` でも通る）
      - (e) 受け入れ 2(h): `left: part.json` / `right: ./part.json` の木（`:105-124` の fixture）を保存 → `versions/<rev>/components/` の子ディレクトリが 1 つ、`beforeClose` の回数 = root 2 + 子 2 + 1
      - (f) 子キーのソート往復（P8）: 子キー `A.json` / `_a.json` / `a-1.json` / `a.json` の 4 子を持つ木を `save` → `restore` で各子の `script` が元と一致（`Object.keys(...).sort()` は UTF-16 code unit 順 = `A.json` < `_a.json` < `a-1.json` < `a.json`）
      - (g) 受け入れ 8（R8。堅牢性）: 第 1 版を保存 → 第 2 版の保存で `fs.controls.beforeClose` が子の `script`（N 回目の `close`）で `QuotaExceededError` を投げる → `save` が reject し、`restore` が第 1 版、`current.json` が第 1 版のまま（`:312-324` の形）。`signal` を途中で abort（`beforeClose` の中で `controller.abort()`）→ `AbortError` で抜け、`current.json` が第 1 版のまま。`UiRuntime.load`（`runtime.js:447-454`）が `save` の失敗を `onCache({ status: "save-error" })` に落として表示中の UI（`runtime.screen.id`）を保つ 1 本
      - (h) `save` の古い版の削除が反復の後に起きる（P9）: `memoryOpfs` の `versions` の `removeEntry` を `vi.spyOn` し、3 版保存後に `entries()` の完了より後に全呼び出し（`mock.invocationCallOrder`）。既存 `keeps only the current and previous complete cache generations`（`tests/files-cache-rpc.test.js:325-337`）が green のまま
      - (i) 受け入れ 2(f): version 1 のマニフェスト / 保存版（`tests/files-cache-rpc.test.js` の既存 7 本）が無改修で green
      - (j) 直交表（既存の入口 × 木）: `fetch(network-only)` 木 / `fetch(network-first)` 木 / `save` 木 / `restore` 木 / `clear` 木（保存後に `clear` → `restore` が `保存版もありません`）の 5 入口を 1 本ずつ（(a)〜(e) と `clear` の 1 本で網羅していることを PROGRESS に表で書く）
    - `bunx vp test run tests/components-loader.test.js tests/files-cache-rpc.test.js` が green
  - 対象: `src/application-loader.js`, `tests/components-loader.test.js`
  - 依存: T4
  - 並列サブ作業: なし

- [ ] T6: 生成スクリプトの version 2（子の再帰・検査・命名・2 MB）とデモのマニフェスト
  - 完了基準:
    - `scripts/publish-packages.mjs` の `publishPackage(sourcePath, output = dirname(sourcePath))`（`:9-56`）が: (1) `readPackage(filePath)` で画面・`script`・descriptor を**そのファイルの dirname 基準**で読む（既存 `readRelative` の規則 `:12-16`。`^(?:[a-z]+:|\/)` を拒否する文言は既存のまま）、(2) `components` を宣言単位で DFS（`declaration.url` が文字列でない → `コンポーネント {名前} の宣言が不正です（url を文字列で指定してください）`、ローカル相対パス以外 → 既存の `配信用ビルダーにはローカルの相対パスを指定してください`、`childPath = fileURLToPath(new URL(declaration.url, pathToFileURL(declaringFile)))`、`stack` に `childPath` があれば `コンポーネント {名前} の循環参照: {childPath}`、`depth + 1 > 3` なら `コンポーネントの入れ子が3段を超えています: {childPath}`、同じ `childPath` は 1 回だけ読む）、(3) `structuredClone` した画面の `declaration.url` を `childPath` に書き換えて `instanceTable(rootClone, sourcePath, packages)`（`src/component-tree.js:5`）を通す（9 Instance で `コンポーネントの数が8を超えています（rootを含む）: {childPath}`）、(4) 合計 `Σ (source.length + script.length)` が `2_000_000` 超なら `配信ファイルの合計が2 MBを超えています（合計 {total} バイト。最大の子: {key} {bytes} バイト）`（`key` は下のマニフェストの子キー）、(5) マニフェストを**先に組む**: 子キー = `relative(dirname(sourcePath), childPath).split(sep).join("/")`（posix）、各子 `{source, script, descriptors}` の `url` = `packages/<rev>/component-<i>-source` / `component-<i>-script` / `component-<i>-descriptor-<n>`（`i` = 子キーを `.sort()` した添字、`n` = その子の descriptor キーを `.sort()` した添字。root は既存の `source` / `script` / `descriptor-<n>`）、`sha256` は `createHash`、`revision` は **`../src/application-loader.js` の `manifestRevision` を import** して付ける（P1: 式を 1 か所に）、(6) `packages/<rev>/` を作って全ファイルを書き、`<basename>.manifest.json` を書く（書き出しは revision 確定後。§5-E）。`version: 2` を常に出し、子の無い画面は `components: {}`
    - `scripts/build.mjs:11-12` と引数なしの `bun run publish:packages` は無改修で `SCREEN_CATALOG` 全画面を生成する（`order-dashboard` / `parts-lab` を含む）
    - テスト（新規 `tests/publish-packages.test.js`。一時ディレクトリは `mkdtemp(join(tmpdir(), "uivolve-publish-"))` で `afterAll` に `rm(..., { recursive: true })`）:
      - (a) 受け入れ 3 / 7 / P2: fixture を一時ディレクトリに書く: `screens/root.json`（子 `parts/mid.json`、descriptor 付き子 `rpc.json` が `../rpc-demo.pb` を参照）、`parts/mid.json`（孫 `./leaf.json` と `../shared/x.json`）→ `publishPackage(root, out)` の `metadata.version` が 2、`Object.keys(metadata.components).sort()` が `["../shared/x.json", "parts/leaf.json", "parts/mid.json", "rpc.json"]`、各 `url` のファイルが `out/packages/<rev>/` に存在し `sha256` / `size` が一致。生成物を `responses` に載せた `ApplicationLoader` の network-first が通り、`candidate.components` のキー = 子キーを `httpUrl(key, rootUrl)` で絶対化した集合（**生成側のキーとローダーが絶対化した href の一致**）。`save` → `restore` が往復する
      - (b) 受け入れ 3: 循環（`mid` → `root.json`）→ `循環参照`、深さ 4 → `入れ子が3段を超えています`、8 子を全部置いた root（9 Instance）→ `コンポーネントの数が8を超えています（rootを含む）`、`source` 1,000,000 バイト × 2 + 1 の木 → `配信ファイルの合計が2 MBを超えています（合計 …。最大の子: …）`。いずれも `out/` に `packages/` も `.manifest.json` も作られない
      - (c) P1: 子キーの宣言順を逆にした root（`components` の挿入順だけ違う）で同じ `revision`。生成した `metadata` に `manifestRevision` を掛け直しても同じ値
      - (d) 受け入れ 7 / §7-7: `bun run build:wasm` の生成物（`bun run test` が先に回す）`public/screens/order-dashboard.json.manifest.json` が version 2 で `components` のキーが `["parts/order-list.json"]`、`parts-lab.json.manifest.json` が `["http-grid.json", "parts/approval.json", "parts/note-pad.json"]`、`http-grid.json.manifest.json` が `components: {}`。3 つとも `ApplicationLoader` の `manifest()`（`fetch(network-first)` 経由。ファイルは `readFile` で `responses` に載せる）を通る。`.gitignore` の `public/screens/*.manifest.json` と `public/screens/packages/` が残っている（`git check-ignore` で確認して PROGRESS に書く）
      - (e) 子の `url` が `https://…` / `/abs.json` → `配信用ビルダーにはローカルの相対パスを指定してください`
    - `bun run build:wasm` → `bunx vp test run tests/publish-packages.test.js tests/components-loader.test.js tests/files-cache-rpc.test.js tests/distribution.test.js` が green
  - 対象: `scripts/publish-packages.mjs`, `tests/publish-packages.test.js`（新規）
  - 依存: T5（`save` / `restore` の往復を (a) で使う）
  - 並列サブ作業:
    - A: `scripts/publish-packages.mjs` の書き換え（対象: `scripts/publish-packages.mjs`）
    - B: `tests/publish-packages.test.js` の (a)〜(e)（対象: `tests/publish-packages.test.js`。マニフェストの形・命名・文言は本 PLAN の「決めた事項」3〜5 を正とし、変えない）
    - 親: `bun run build:wasm` → Vitest → `bun run check` → コミット

- [ ] T7: 契約文書の追従（R9。追従先チェックリスト 行 1〜14）
  - 完了基準:
    - 追従先チェックリストの行 1〜14 をすべて実施し、各行の「確かめ方」の `git grep` を**行番号つきで全行**再実行して PROGRESS に「行 1 … 行 14」の表で書く（無改修と判定した行 10・11 は理由を書く）
    - `docs/components.md`: 状態行（段階5）、「据え置きの拒否」から配信キャッシュを外して「3つ」、新節「子パッケージのメモリ共有」、「エラー文言」に JS 3 文言（T1 の英語 1 文言は再確認）、制限表の 2 MB 行と `instance` 行、「2MBの段構え」の 3 段化、「段階5以降の課題」から配信キャッシュを外す。`docs/files-cache-rpc.md:82-110`: 手順（木の取得・検証・保存・復元）、生成物の命名、マニフェスト version 2 の形と revision の式、子キーの基準、子の上限、`components/<i>/` の配置、3 文言、メモリ共有への参照、`:185`。`docs/components-plan.md:3,87,100`。`docs/ai-development.md:26`。`docs/architecture.md:84`。`docs/testing.md:41,43` + `publish-packages.test.js` の行。`docs/opfs-cache-rpc-investigation.md`。`README.md:116`。`skills/uivolve-web-app-dev/references/components-layout.md:30`、`skills/uivolve-web-engine-dev/references/components.md:12`
    - 文書の断言（文言・ファイル名・件数・式）は `src/application-loader.js` / `scripts/publish-packages.mjs` / `engine/src/abi.rs` を `git grep -n -F` で引いて書く（記憶から書かない）。並列サブ作業の成果物をマージした直後に、親が本タスクの完了基準に出てくる `git grep` 条件を**全部**再実行してから PROGRESS を書く
    - `bunx vp fmt <編集した Markdown>` を掛け、`bun run check` と `bun run docs:check` が green
  - 対象: `docs/components.md`, `docs/files-cache-rpc.md`, `docs/components-plan.md`, `docs/ai-development.md`, `docs/architecture.md`, `docs/testing.md`, `docs/opfs-cache-rpc-investigation.md`, `README.md`, `skills/uivolve-web-app-dev/references/components-layout.md`, `skills/uivolve-web-engine-dev/references/components.md`
  - 依存: T6
  - 並列サブ作業:
    - A: `docs/components.md` と `docs/components-plan.md`（行 1・2・4・5・6・7・13）
    - B: `docs/files-cache-rpc.md`、`docs/opfs-cache-rpc-investigation.md`、`docs/testing.md`、`docs/architecture.md`（行 3・4・7・8・9）
    - 親: `docs/ai-development.md`、`README.md`、スキル 2 ファイル（行 10・14）、行 11 の無改修判定、全行の `git grep` 再実行、`vp fmt`、`check`、`docs:check`、コミット

- [ ] T8: 最終判定と受け入れ基準の総点検
  - 完了基準:
    - `bun scripts/verify-instance-refactor.mjs` が OK（所要の表を PROGRESS に写す。`BASE_CHECKS` 6 本 → base 照合 差分 0 → probe → 変異 7 本が各 exit 1）
    - 追従先チェックリストの行 1〜14 を**行番号つきで全行**再実行し、PROGRESS に「行 1 … 行 14」の表で書く（表の行数が 14 でなければ未完了）
    - REQUIREMENTS の受け入れ基準 1〜9 を 1 行ずつ「どのテスト / どのコマンドで満たしたか」の表にして PROGRESS に書く（受け入れ 2 は (a)〜(h) の 8 行、受け入れ 4 は 4 契機の 4 行に展開）。RESEARCH §6 の落とし穴 P1〜P17 を「どのタスクのどのテストで検証したか」の表にする（P18 は恒常注意なので除く）
    - `git diff main --stat -- engine/src/lib.rs` が 0 行、`git grep -n -F 'withoutComponents' -- src tests docs` が 0 件、`git grep -n -F 'componentsを持つ画面' -- src tests docs skills README.md` が 0 件
    - `bun run build:wasm` 後の `public/screens/{order-dashboard,parts-lab,http-grid}.json.manifest.json` が version 2（T6 (d) のテストが green であることで確認）、`git status --short` に生成物が出ない
    - `bunx vp fmt .gsd-lite/PLAN.md .gsd-lite/PROGRESS.md .gsd-lite/DECISIONS.md` 済みで `bun run check` が green
  - 対象: `.gsd-lite/PROGRESS.md`（コードの変更は想定しない。見つけた不備は本タスクで直し、PLAN 訂正として記録する）
  - 依存: T7
  - 並列サブ作業: なし

## 決めた事項

要件・決定の範囲で plan が確定した細部。impl はこれを再議論しない。

1. **2 MB の前段の「合計」は全パッケージの `source.size + script.size` の和で、descriptor を含めない**（RESEARCH §7-1 の推奨を採用）。根拠: `load` のリクエストに入るのは package と script だけで descriptor は buffer ABI（`src/engine.js:81-90` の `storeBuffer`、`:104-111` の `request`）。含めると現状 load できる「root 1 MB + descriptor 8 × 1 MB」を前段が拒否する。descriptor には 1 MB / 8 件 / 16 MB の上限が既にある（`manifest():47-50`、`docs/files-cache-rpc.md:181`）。「最大の子」も同じ和で選ぶ。文書には「マニフェスト段階は生バイトの粗い前段、load 時（JSON 化後。`engine.js:115`）が正」と書く（追従先 行 5）
2. **`instance` の 256 バイト上限は完了 op（`take_instance`）だけに掛け、load 時の対称検査は入れない**（RESEARCH §7-2 の (b)）。根拠: REQUIREMENTS R6 の範囲が「`take_instance` で `valid_instance_path` より先に長さを見る」「Rust のテストを 1 本」「既存文言は変えない」で、load 時の検査は要件に無い防壁（新しい文言 2 つ・probe・文書が増える）。代わりに制限表に「完了opの`instance` は 256 バイト。超える接頭辞付きパスの子は完了を受け取れないので itemId はその範囲に収める」と書く（追従先 行 6）。verify が残留リスクとして記録してよい
3. **マニフェスト version 2 の形**: `{ version: 2, revision, source, script, descriptors, components: { "<root の画面 URL 基準の相対パス>": { source, script, descriptors } } }`。子の無い画面も `components: {}`。子キーはローダーが `httpUrl(key, base)`（`base` = `manifest()` に渡す URL。`fetch` では sidecar `:176`、`save` / `restore` では画面 URL `:238,:251,:276`。どちらも同じディレクトリなので相対解決は同じ）で絶対化する。子の `descriptors` のキーはその子の DSL に書いた descriptor URL（root と同じ規則 `:82-87`）
4. **配信側のファイル命名**: `packages/<revision>/source` / `script` / `descriptor-<n>`（root。既存 `publish-packages.mjs:43-49`）、`packages/<revision>/component-<i>-source` / `component-<i>-script` / `component-<i>-descriptor-<n>`（子。`i` = 子キーを `Object.keys(...).sort()` した添字、`n` = その子の descriptor キーをソートした添字）。ローダーはマニフェストの `url` を見るだけなので命名はマニフェストと配信物の間だけで一致させる
5. **OPFS の配置**: `versions/<revision>/components/<i>/{source,script,descriptor-<n>}`（`i` / `n` は 4 と同じソート。REQUIREMENTS R3）。`OpfsDirectory.write` は親ディレクトリを作らない（`src/opfs.js:130-135`）ので子ごとに `mkdir` する。`relativePath` の制約（1,024 バイト・16 区間・各 255 バイト `opfs.js:3-19`）に収まる
6. **version 2 の revision の式**は R1 のとおり `manifestRevision` に 1 か所で実装し、生成スクリプトは同じ関数を import する（P1。`scripts/publish-packages.mjs` は既に `../src/package-format.js` を import している `:6`。`src/application-loader.js` の import 先 `opfs.js` / `package-format.js` / `http-policy.js` / `component-tree.js` は純 JS で Node から読める。`crypto.subtle` は Node 20+ / Bun にある）。比較子は `<` / `>`（`application-loader.js:20`）
7. **共有エントリの `screen` は clone も凍結もしない**（P5）。根拠: 走査の `declaration.url = child.href`（`:131`）は絶対 URL に対して冪等、`runtime.js:45-70` は `prepareScreen` で `structuredClone` してから書く。テスト T4 (a) で `toEqual` と `toBe` を固定する
8. **無効化の判定**: `fetch(value, { mode, signal, refresh })` の冒頭で `refresh === true` / `mode` の前回値との不一致 / `JSON.stringify(resources.getAuthentication())` の前回値との不一致（`resource-client.js:61-67` は毎回新しいオブジェクトを返すので参照比較は使えない P12。`main.js:201` は毎回代入するので代入ではなく値比較 P11）。`UiRuntime.load` は `refresh: refreshEngine` を渡す（`runtime.js:403,419-422`）。トークンだけの差し替えは検知しない（契約文書に 1 行。追従先 行 7）
9. **新しい日本語文言（3 つ。追従先 行 4）**: `マニフェストのコンポーネント情報が不正です`（形の不正。走査後の不一致は `（宣言に無い子: {URL}）` / `（マニフェストに無い子: {URL}）` を添える）、`配信ファイルの合計が2 MBを超えています（合計 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）`（ローダーは絶対 URL、生成側は子キー）、`配信ファイルのサイズ・ハッシュが一致しません（{URL}）`（子のみ。`{URL}` は子パッケージの絶対 URL。root は既存文言のまま）。復元が全部失敗したときは `通信に失敗し、利用できる保存版もありません（{最後の失敗の文言}）`（ポインタが無いだけなら括弧なし）
10. **新しい英語文言（1 つ）**: `Component instance path exceeds 256 bytes`（`abi.rs` の `take_instance`。値は載せない）
11. **テストの置き場所**（RESEARCH §7-8）: 木の検証・取得・共有・保存・復元は `tests/components-loader.test.js`（受け入れ 2 の指定どおり `:190-214` を置き換える。`memoryOpfs` を import する）。生成スクリプトは新規 `tests/publish-packages.test.js`。残留リスク 3 は `tests/components-effects.test.js`。残留リスク 1 は `engine/src/composition_tests.rs` + `tests/abi.test.js:194-203`。`tests/files-cache-rpc.test.js` は無改修（version 1 の回帰）
12. **`manifest()` で子が 8 件を超えたら `マニフェストのコンポーネント情報が不正です`**。根拠: Rust `At most 8 component packages`（`abi.rs:68`）と同じ上限で、descriptors の 8 件検査（`manifest():47`）と同じ場所に置くとファイル取得前に止まる
13. **network-first の処理順**: manifest → root files → root parse → 子の走査（共有 → 取得 + verify）→ 一致検査 → abort → 認証再確認 → return。子の取得失敗で `e.code === "NETWORK"` なら root と同じ `restore` 経路（`:198-206` は無改修）
14. **復元の `fallbackReason`** は既存どおり通信エラーの `message`（`:204`）。どの子で失敗したかは復元が全部失敗したときの文言に添える（決めた事項 9）。`main.js:171-180` の表示は無改修
15. **生成スクリプトの循環 / 深さ / Instance 数の文言**は JS ローダーと同じ（`コンポーネント {名前} の循環参照: {path}`、`コンポーネントの入れ子が3段を超えています: {path}`、`コンポーネントの数が8を超えています（rootを含む）: {path}`。`{path}` は絶対ファイルパス）。「8 パッケージ」は `instanceTable` の Instance 数（root 含む 8）で数える。scope 検査は生成側では掛けない（ローダーと Rust が掛ける）
16. **`restore` の走査で `abort`** は `catch (e) { signal?.throwIfAborted(); last = e }` の形で `AbortError` を握りつぶさない（P7）

## メモ

### 前回・前々回の reflect の「次回への提案」の反映

| 提案（20261009-0342 component-effects）                                                    | 反映                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最終判定型タスクは追従先チェックリストを行番号つきで全行再実行（行数が合わなければ未完了） | T7 / T8 の完了基準と追従先チェックリストの連番（14 行）                                                                                             |
| サブエージェントの成果物マージ直後に親が `git grep` 条件を全部再実行                       | T1 / T6 / T7 の「親」の手順                                                                                                                         |
| discuss のスキル編集を整形してからコミット                                                 | 対象外（本マイルストーンの discuss は済み。`bun run check` は plan の turn 2 で HEAD `bae3026` に対して green を確認した）                          |
| PLAN 訂正の旧文字列を PLAN 全体で引く                                                      | impl スキルに入っている。PLAN 側は「置き換え後の名前で書く」: T3 で `withoutComponents` を消すので T5 以降は `withoutComponents` を名指ししていない |
| 文言より手前の防壁を確かめる                                                               | T1 到達性の行、決めた事項 2（load 時の対称検査を入れない）                                                                                          |
| 旧契約の言い回しを `git grep`                                                              | 追従先 行 1・2 の条件（`componentsを持つ画面` / `network-firstで配信できない` / `1パッケージ1本` / `段階5で決める` / `段階5以降`）                  |
| MCP 未接続を PROGRESS に書かない                                                           | 本 turn から遵守                                                                                                                                    |
| verify のサブエージェントを「契約文書 ↔ 実装の一対一」に                                   | 「verify への申し送り」に書く（下）                                                                                                                 |
| 並列サブ作業の運用（共有ファイルを先に確定・ビルド系を禁止）                               | T1 / T6 / T7 の「親」の手順                                                                                                                         |
| `bunx vp check` に Markdown だけを渡すと非 0                                               | 「検証コマンド」の注意                                                                                                                              |
| 段階 5 の research は残留リスク 1・3・5 を入力に、3 を最初のテストタスクへ                 | T1（残留リスク 1・3）。残留リスク 5 は REQUIREMENTS スコープ外                                                                                      |

| 提案（20261008-0114 component-composition） | 反映                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| scratch を消さない・`rm -rf` 禁止           | スキルに入っている。impl への注意に再掲                                      |
| 既存の入口 × 新しい状態の直交表             | T3 (f) / T5 (j)（`fetch` × 2 / `save` / `restore` / `clear` の 5 入口 × 木） |
| スキル改修は discuss で                     | 済み（DECISIONS 前提）                                                       |
| `gh pr create --head`                       | verify スキル                                                                |
| Rhai 予約語                                 | RESEARCH §3。本マイルストーンで新しい Rhai は `fn init(s) { s }` 程度        |
| `rg -l` でソースを読むテストを拾う          | 追従先 行 12                                                                 |
| サブエージェントの本数を PROGRESS に        | impl スキル                                                                  |
| F 系で文言列挙節にも足す                    | T1 (C) で本編から先回り（残留リスク 1 の文言を同じタスクで列挙節へ）         |

### RESEARCH §4「盗める点」の採否

| #   | 規則                                                    | 採否 | 理由                                                                                        |
| --- | ------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| S1  | `{url, digest, size}` 三つ組・size を先に検証           | 採用 | 既存 `verify`（`:55-59`）をそのまま子に使う（T3 / T5）                                      |
| S2  | root 相対パスをキーにしたフラットなマップ・重複はエラー | 採用 | R1 の形。絶対化後の重複は `manifest()` で拒否（T2 (c)、P3）                                 |
| S3  | 同一依存は 1 回                                         | 採用 | 既存の `packages[href]`（`:136`）と保存のマニフェストキー回し（T5 (e)、P15）                |
| S4  | 名前でソートした一覧のハッシュ                          | 採用 | R1 の式。生成側と同じ関数を使う（決めた事項 6、T6 (c)）                                     |
| S5  | `schemaVersion` 整数固定・後方互換を文書化              | 採用 | version 1 / 2 両受け（T2）、文書（追従先 行 3）                                             |
| S6  | 1 つでも失敗したら更新全体を失敗・blob 先 manifest 後   | 採用 | `save` の順序（T5）、`restore` の all-or-nothing（T5 (c)(d)）                               |
| S7  | 起動時に実ファイルを digest で再検証                    | 採用 | `restore` の `verify`（既存）を子に広げる（T5）                                             |
| S8  | 更新検知は manifest のバイト差分だけ                    | 採用 | `cache: "no-cache"`（既存）、共有の sha256 一致（T4 (d)）                                   |
| S9  | module map は完成したものだけ・失敗は入れない・寿命     | 採用 | `#share` は検証後にだけ入れる（T4、P6）                                                     |
| S10 | AppCache の「常にキャッシュ優先」の不満                 | 採用 | `network-only` の共有は「再読込」で取り直せることを文書に（追従先 行 7）。UI 文言は変えない |
| —   | OPFS のフェイク `memfs/lib/fsa`                         | 却下 | `tests/helpers/opfs.js` で足りる（§2-6、§4.2）                                              |
| —   | `fetch` の `integrity`（SRI）                           | 却下 | `ResourceClient` が `fetch` を包み、テストが fetcher を差し替える（§4.2）                   |
| —   | 一時ディレクトリに書いて rename                         | 却下 | `FileSystemHandle.move()` はディレクトリ不可（§2-7）。版ディレクトリ + ポインタ方式を維持   |
| —   | 復元専用の走査を別に書く                                | 却下 | 検査の重複と差分の温床（§5-A）。供給元で抽象化した 1 本の走査（T3）                         |

### 落とし穴（RESEARCH §6）の担当

P1 → T2 (e) / T6 (c)、P2 → T6 (a)、P3 → T2 (c)、P4 → T4 (f)（深さのみ。循環は構成不能。理由は T4 (f) に記載）、P5 → T4 (a)、P6 → T4 (g)、P7 → T5 (d)(g)、P8 → T5 (f)、P9 → T5 (h)、P10 → T2 (d)、P11 → T4 (b)、P12 → T4 (c)、P13 → T1 (A)、P14 → T1 (A)、P15 → T5 (e)、P16 → T2 (b)、P17 → T2 (f) / T3 (b)、P18 → 恒常注意（下）

### 並行性・境界値・異常系の担当

- 並行: 別タブの同時 `save`（`ifAvailable` → `BUSY`。既存。T5 で無改修を確認）、load 中の abort（T4 (g)、T5 (g)）
- 境界値: 合計 2,000,000 / 2,000,001（T2 (d)）、`instance` 256 / 257 バイト・258 バイトの 3 バイト文字（T1）、子 8 件 / 9 件（T2 (c)）、Instance 8 / 9（T6 (b)）、深さ 3 / 4（T3 (e)、T4 (f)、T6 (b)）、descriptor 8 / 9 件（T2 (c)）、`OpfsDirectory.limit` 1,000,000 ちょうど（source 1 MB は通る。既存）
- 異常系: 壊れたマニフェスト（T2）、子だけ欠けた版（T5 (c)）、途中で中断した保存（T5 (g)）、容量不足（T5 (g)）、循環する子（T3 (e)、T6 (b)）、`__proto__` キー（T2 (f)、T3 (b)）

### タスク数

8 タスク。T3〜T5 は `src/application-loader.js` の同じ構造（走査・供給元・共有）を順に積むので分割を保つ。T1 は「前回の残留リスク」2 件を 1 ターンにまとめた（Rust 1 腕 + テスト 3 本）。T6 は生成とテストを並列サブ作業で 1 ターンに収める

### impl への注意

- **1 Bash 1 コマンド**。読みは `Read`、検索は `git grep -n -E '<pattern>' -- <paths>`、native `Read` が「unchanged」を返したら `git show HEAD:<path>`（P18）。scratch は `.gsd-lite/logs/component-loader/scratch/turn-NNN-*` に置き、**消さない**。`rm -rf` を使わない
- `bun run check` は plan の turn 2 で HEAD（`bae3026`）に対して green（赤だったのは整形前の PLAN.md だけ）。各ターンの最後に `bun run check` を回し、赤のままコミットしない（前回は 11 ターン赤のままだった）
- Rhai の予約語（RESEARCH §3）: テストの fixture の handler 名に `go` / `call` / `exit` / `match` / `new` / `use` / `with` / `package` 等を使わない。本マイルストーンの新しい Rhai は `fn init(s) { s }` 程度
- `tests/components-loader.test.js` の既存 fixture（`:48-67`）は `reads` Map で URL ごとの回数を数える。T2〜T5 の補助関数 `treeManifest(list)` はここに足し、`memoryOpfs` を `./helpers/opfs.js` から import する。`ApplicationLoader` は `{ resources, storage: fs.storage, locks: null }` で作る（Node 22 に `navigator.locks` は無い）
- `manifest()` は `save` が `previous.json` の検証にも使う（`:238,:251`）ので、version 2 を**木の一致検査なしで**通せる形に保つ（§5-B）
- 走査の `declaration.url` 書き換えは root の `screen` を直接書く（既存）。共有エントリの `screen` は clone しない（決めた事項 7）。`runtime.js` の `resolveComponents` が clone する
- `save` の子の `mkdir` は `directory.mkdir(`${path}/components/${i}`)`（多段を作れる `opfs.js:154-156`）。`write` は親を作らない
- `Object.keys(...).sort()`（引数なし。UTF-16 code unit 順）で子キー・descriptor キーを並べる。`opfs.js:165` の `list` は `localeCompare` なので使わない（P8）
- サブエージェントへの依頼文（T1 / T6 / T7）: 対象ファイルと禁止事項（他ファイルを触らない・`git checkout` / `git stash` / `rm -rf` をしない・`bun run build:wasm` / `cargo` / 全体 Vitest を回さない・scratch を消さない）、結果はファイルに書いて返す、共有する表（T6 のマニフェストの形と文言、T7 の文言）は親が起動前に確定し「内容を変えるな」と渡す
- PROGRESS は固定項目（やったこと / 想定外 / やり直し / 次への注意）で、前ターンのエントリを編集しない。サブエージェントを使ったら「やったこと」の先頭に本数と担当
- PLAN 訂正は実測を正とし、旧文字列を `git grep -n -F '<旧文字列>' -- .gsd-lite/PLAN.md` で引いて後続タスクの同じ条件を同じターンで直す

### verify への申し送り

- 受け入れ基準 1〜9 と T8 の表を突き合わせる。サブエージェントは「契約文書 ↔ 実装の一対一（追従先チェックリスト 14 行 + `docs/components.md` の文言列挙節 + `docs/files-cache-rpc.md` のマニフェストの形と式）」の 1 本と「セキュリティ（`__proto__` キー、`javascript:` の子キー、認証中の共有、2 MB の前段を迂回する組み方）」の 1 本に分ける（汎用コードレビューは前回・前々回で親の `git grep` と重複した）
- 堅牢性（R8）は T5 (g) の 3 経路（quota / abort / `save-error` の表示）と、verify 自身の格子（壊れたマニフェスト 7 種 × 保存版の状態 3 種）で見る
- 決めた事項 2（load 時の 256 バイト検査を入れない）は要件どおりだが「load できたものが完了できない」非対称が残る。残留リスクとして記録してよい
- 決めた事項 1（descriptor を合計に含めない）は R4 の「木のファイルの `size` 合計」を狭めている。REQUIREMENTS と文書の整合を見る
