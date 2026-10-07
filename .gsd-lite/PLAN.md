# PLAN — component-instance-refactor

- 作成: 2026-10-07 / gsd-lite-plan（turn 2）
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md / `.gsd-lite/reflect/` 直近 2 件
- `$MS` = `.gsd-lite`、`$TARGET` = `.`（mode=repo）。対象側の `CLAUDE.md` / `AGENTS.md` は無い（`ls` で確認）。規約は `CONTRIBUTING.md` と `docs/testing.md`（検証コマンド）に従う

## 検証コマンド

impl の各ターンがテストに使うコマンド（リポジトリルートで実行。`docs/testing.md:7-13` のコマンド列 + 本マイルストーンの照合）:

```bash
bun run build:wasm                      # public/engine.wasm と public/screens/rpc-demo.pb を生成（照合の前提）
bunx vp test run                        # Vitest（既存テストファイルは無改修・期待値変更 0）
bun run test:rust                       # cargo test（lib.rs 4 本 + extensions 系が無改修 green）
bun run check                           # oxlint/oxfmt + cargo fmt --check
bun run docs:check                      # Markdown リンク検査
bun scripts/compare-engine-behavior.mjs --base target/engine-compare/base-35120e0.wasm --candidate public/engine.wasm
                                        # T1 以降。応答 JSON の差分 0 で exit 0
```

- 環境の初期化（テストの前に毎回）: `bun run build:wasm`（`public/engine.wasm` を作業ツリーから再生成。`rpc-demo.pb` も生成される）。base WASM が無ければ `bun scripts/build-engine-variant.mjs --commit 35120e0 --out target/engine-compare/base-35120e0.wasm`（T1 以降。約 30 秒）。T1 より前は `.gsd-lite/logs/component-instance-refactor/base-main-35120e0.wasm`（research が保存済み）を `cp` して使ってよい
- 最終判定（クリーンな状態から全検査。verify と最終タスクが使う）: `bun scripts/verify-instance-refactor.mjs`（T4 で作る。build:wasm → vp test → test:rust → check → docs:check → build → base ビルド（無ければ）→ 照合 → 変異 M1〜M3 の非 0 確認、手順ごとの所要と合計を最後に出力、exit code を返す）。T4 完了までは上のコマンド列を順に手で回す
- base コミット: `main` = `35120e0`（`git log --oneline -1 main`）。DECISIONS「`main` = `github/main` = `35120e0`」と一致

## 追従先チェックリスト

| 変更の種類                                   | 直す場所                                                                                                                                                                                                                                                                  | 確かめ方                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/src/instance.rs` を足す              | `lib.rs` の `mod` 一覧（`lib.rs:5-28`）、`docs/architecture.md:25-55` の責務表（`場所 \| 担当` 2 列）、`README.md:98-99`（ルート README の engine ファイル箇条書き）、`docs/architecture.md:59-61`（「Runtime は…保持する」「成功した Runtime だけをスロットへ」の 1 文追従） | `git grep -n "instance.rs" -- README.md docs/architecture.md engine/src/lib.rs` が 3 ファイルとも 1 行以上                                                              |
| 文書 `docs/components-plan.md` を足す        | `docs/README.md:11-42` の表（`やりたいこと \| 読む文書` 2 列。検討書は「計画」「検討」と明記して契約と区別）                                                                                                                                                              | `git grep -n "components-plan.md" -- docs/README.md` が 1 行。`bun run docs:check` green                                                                                 |
| `scripts/` に恒久スクリプトを足す            | `docs/testing.md:83` の恒久スクリプト段落（Playwright 3 本の件数は変えず、**別の文**で照合スクリプト 3 本（compare / build-engine-variant / verify-instance-refactor）の用途と入口を足す）                                                                                   | `git grep -n -E "compare-engine-behavior|verify-instance-refactor|build-engine-variant" -- docs/testing.md` が 3 名とも 1 行以上。`3本` の記述は Playwright 用のまま   |
| `Runtime` の公開 API 名を使う文書            | `docs/native-extensions.md:83-91`（`load_with_extensions` / `load_with_clock`）、`docs/date-functions.md:59`（`load_with_clock` / `with_clock`）、`docs/component-development.md:39`（`Runtime::load` / `Runtime::dispatch`）、`docs/dialogs.md:106`（`lib.rs` の記述）    | 公開シグネチャは維持するので**変更しない**。`git diff main --stat -- docs/native-extensions.md docs/date-functions.md docs/component-development.md docs/dialogs.md` が空 |
| エラー文字列（`lib.rs` の `Err(` 41 か所）   | 移す先の `instance.rs`。文字列は 1 字も変えない                                                                                                                                                                                                                            | main の `lib.rs` と HEAD の `lib.rs`+`instance.rs` から `"..."` リテラルを抽出した集合が一致（T2 の完了基準。`git grep -c "Err(" -- engine/src/lib.rs` は main で 41）    |

## Tasks

- [ ] T1: 挙動照合スクリプトと WASM 変種ビルドスクリプト（受け入れ基準 2 の道具。変異表つき）
  - 完了基準:
    1. `scripts/compare-engine-behavior.mjs` が `--base <wasm> --candidate <wasm>`（**両方必須**。既定値で `public/engine.wasm` を base と見なさない = P8）と `--evidence <json>`（既定 `target/engine-compare/compare.json`）を取り、「決めた事項 6〜8」のリクエスト列を 2 つの WASM に流し、応答 JSON の**文字列一致**を数える。差分は `DIFF <画面id> <label> <最初に異なる JSON 経路（例 data.widgets[3].x）>` と両者の値（各 120 文字まで）で表示する（RESEARCH §3「先頭 200 文字では読めない」への対応）。最後に 1 行 JSON `{steps, diffs, okResponses, errorResponses, sequences, durationMs}` を出し、`diffs = 0` なら exit 0、`> 0` なら exit 1、引数不備・WASM 不在は exit 2。判定に WASM のハッシュを使わない（P5）
    2. 全リクエスト（load / event / `*_result` / host_progress）に固定 `clock`（決めた事項 6）を付ける（P6）。`rpc` 定義を持つ画面は `buffer_store` で `public/screens/rpc-demo.pb` を入れてから `load`（P9）。集計行の `okResponses` / `errorResponses` を証跡 JSON に残す
    3. `scripts/build-engine-variant.mjs` が (a) `--commit <rev> --out <wasm>`: `git worktree add --detach <scratch>/worktree-<rev> <rev>` → `cargo build --release --target wasm32-unknown-unknown --locked --manifest-path <wt>/engine/Cargo.toml --target-dir <scratch>/cargo-target` → `.wasm` を `--out` へ `cp` → `git worktree remove --force` の順で base を作れる。(b) `--mutation <name> --out <wasm>`: 決めた事項 9 の変異表から 1 件を選び、`engine/`（`target/` を除く）と `public/themes/`（`theme.rs:41,59` の `include_str!` が要る = P14）を `<scratch>/mutant-<name>/` へ写し、`from` 文字列が**ちょうど 1 回**出現することを確かめてから置換してビルドする（0 回・2 回以上は exit 2 で止まる）。作業ツリーの `engine/` は触らない（`git status --porcelain engine/` が空のまま）。どちらも所要秒を出力する。`<scratch>` の既定は `target/engine-compare/`（`.gitignore:1` の `target/` で無視される）。cargo の target-dir は変種間で共有し 2 回目以降を速くする
    4. 実測（証跡は `target/engine-compare/*.json` と PROGRESS の集計行のみ。生の値を他の文書へ写さない）:
       - base（`--commit 35120e0`）vs 作業ツリーの `public/engine.wasm`: `diffs = 0`
       - 同一 WASM 同士: `diffs = 0`（決定性。P6）
       - 変異 M1 / M2 / M3（決めた事項 9）: それぞれ exit 1 かつ `diffs > 0`。M1 は `layout:*` label の差分、M2 は `dialog-prompt-input` label の `data.revision`、M3 は `event:unknown-target` label の `error` を含むこと（P2 / P3 / P7 の歯）
       - `steps ≥ 230`（RESEARCH §3 の基本列と同数以上）。実測の `steps` / `okResponses` / `errorResponses` を PLAN の本タスク直下に「訂正（turn N / 実測）」として 1 行追記する（T2・T4 が期待値として使う）
    5. 後始末: `git worktree list` が 1 行（P12）。`target/engine-compare/` は残してよい（base WASM の再利用のため）
    6. `node --check scripts/compare-engine-behavior.mjs` / `node --check scripts/build-engine-variant.mjs` を通し、`bun run check`（oxlint/oxfmt）green。既存テストは触らない
  - 対象: `scripts/compare-engine-behavior.mjs`（新規）、`scripts/build-engine-variant.mjs`（新規）
  - 依存: なし
  - 並列サブ作業:
    - A: `compare-engine-behavior.mjs`（リクエスト列の生成・部品種別 payload・インライン fixture・JSON 経路差分・集計・exit code）（対象: `scripts/compare-engine-behavior.mjs`）
    - B: `build-engine-variant.mjs`（worktree ビルド・変異コピービルド・target-dir 共有・後始末）（対象: `scripts/build-engine-variant.mjs`）
    - 親が両方を結合して 4 の実測を前景で回す（各ビルド約 30 秒、2 回目以降は約 10 秒）

- [ ] T2: `Runtime` → `Instance` の挙動不変リファクタ
  - 完了基準:
    1. `engine/src/instance.rs` 新設。「決めた事項 1〜5」の構造どおり（`Instance` の 12 フィールドを `lib.rs:363-374` の順で、`Instance::load` / `clear_queues` / `state_json` を持つ）。`lib.rs` の `Runtime` は `root: Instance` / `dialogs` / `pages` / `pub revision` の 4 フィールド
    2. `Runtime` の公開シグネチャ（`load` / `load_with_extensions` / `load_with_descriptors` / `load_with_clock` / `with_clock` / `dispatch` / `progress_host` / `complete_host` / `complete_http` / `complete_storage` / `complete_file` / `complete_rpc` / `complete_dialog` / `take_effects` / `state_json` / `layout`、`lib.rs:381-991`）は 1 字も変えない。`abi.rs` は**無改修**（`git diff main --stat -- engine/src/abi.rs` が空。`revision` が `pub` のまま Runtime に残るため差し替えも不要 = REQUIREMENTS「差し替えのみ」の 0 件）
    3. `bunx vp test run` / `bun run test:rust` が green で、`git diff main --stat -- tests/ engine/src/extensions/` が空（既存テスト無改修）。`lib.rs` 内テスト 4 本（`lib.rs:1667,1694,1723,1733`）は無改修のまま `mod tests` に残す（P4 の `event_failure_rolls_back_and_execution_is_bounded` / `host_progress_and_cancel_roll_back_without_consuming_completion` を含む）
    4. 照合: `bun run build:wasm` 後、`bun scripts/compare-engine-behavior.mjs --base target/engine-compare/base-35120e0.wasm --candidate public/engine.wasm` が `diffs = 0`、`steps` / `okResponses` / `errorResponses` が T1 の訂正行と一致（P1 / P2 / P3 / P4 / P6 の実証）
    5. 変異 M1〜M3 を**リファクタ後のソース**で再ビルドして exit 1（`from` 文字列が refactor で動いた場合は `build-engine-variant.mjs` の変異表の `from` だけを直し、PLAN 決めた事項 9 に訂正行を書く）
    6. エラー文字列の集合一致（P3）: `.gsd-lite/logs/component-instance-refactor/scratch/turn-NNN-strings.mjs` で `git show main:engine/src/lib.rs` と HEAD の `engine/src/lib.rs` + `engine/src/instance.rs` から `"..."` リテラル（`Err(` 行と `format!(` 行）を抽出し、集合の差が空であることを出力で確認（結果は PROGRESS に「差 0」とだけ書く）
    7. 受け入れ基準 6: `lib.rs` の `load_with_clock` / `dispatch` に Instance を選ぶ分岐・`HashMap<_, Instance>`・`components` が無い（`git grep -n -E "components|HashMap<String, Instance>|instances" -- engine/src/lib.rs engine/src/instance.rs` が 0 行）
    8. `bun run check` green（`cargo fmt` は `engine/src/instance.rs` と `lib.rs` に掛けてよいが、`abi.rs` に波及しないこと = P11）。制限値（`lib.rs:423` 100 KB、`:455-460` Engine 上限、`:470,488,509` 8 件、`abi.rs:33` 8 descriptors、`abi.rs:139` 2 MB、`dynamic_ui` の 200 / 20）の数値に差分が無いこと（`git diff main -- engine/src | grep -E "^[-+].*[0-9]"` を目視し、動いた行は移動のみであること）
  - 対象: `engine/src/instance.rs`（新規）、`engine/src/lib.rs`
  - 依存: T1
  - 並列サブ作業: なし（`instance.rs` と `lib.rs` は互いに依存し、借用の整合を 1 人で取る方が早い）

- [ ] T3: 設計文書 `docs/components-plan.md` と追従（R1）
  - 完了基準:
    1. `docs/components-plan.md` を新設。冒頭は `docs/platform-features-plan.md:3` と同じ定型（「状態: 計画・検討記録。現行 API の判断は[ドキュメント案内](README.md)から各契約を参照し、この文書を現行仕様の根拠にしない。合成が実装された段階で契約文書 `components.md` を別に起こす」）。節構成は「決めた事項 10」のとおり
    2. 「設計決定」表は DECISIONS.md「設計決定」の 8 論点をそのまま載せ、備考に (a) 子の storage / files scope の区切り文字は `storage::safe_key`（`storage.rs:49`、`/` 不可）と合わせて段階 4 で決める、(b) `http` effect だけ `kind` を持たない（`{id, request, url}`）ので段階 4 の `instance` 追加時に揃える、の 2 注記を入れる（RESEARCH §6）
    3. 「Instance のフィールド一覧」は `engine/src/instance.rs` の struct 定義から**名前・型・順序**を機械的に写した 12 行（`git grep -n -E "^    pub\(crate\) [a-z_]+:" -- engine/src/instance.rs` の行数と表の行数が一致 = P10）。続けて Runtime 側の 4 フィールド（root / dialogs / pages / revision）と「root 共通物を Runtime に残す理由」（DECISIONS「リファクタの構造」）を表にする
    4. 「段階計画」は段階 1・2（本マイルストーンで完了。何をしたか）、3（同期のみの合成）、4（効果の instance ルーティング）、5（ローダー再帰・キャッシュ・2 MB）、6（WebMCP・契約文書・デモ）。REQUIREMENTS R1 の各段階の内容を落とさない
    5. 追従: `docs/README.md` 表に 1 行、`docs/architecture.md` 責務表に `engine/src/instance.rs` 行（`lib.rs` 行の「Runtime」を「Runtime（root 共通物）」に、新行を「Instance（1 画面パッケージの package / 確定ツリー / Rhai Engine・AST / state / 依頼キュー）」に）、`docs/architecture.md:59-61` の 1 文追従、`README.md:98-99` に `engine/src/instance.rs` の 1 行（追従先チェックリスト 1〜2 行目）
    6. `bun run docs:check` green。`bun run check`（oxfmt が Markdown を整形対象にするなら整形済みであること）green。文書に生の実測値（steps 件数・sha256 など）を書かない（検討記録は判定と理由だけ。証跡は `target/engine-compare/` の JSON を指す）
  - 対象: `docs/components-plan.md`（新規）、`docs/README.md`、`docs/architecture.md`、`README.md`
  - 依存: T2（フィールド一覧を実物から写すため）
  - 並列サブ作業:
    - A: `docs/components-plan.md` 本文（対象: `docs/components-plan.md`）
    - B: 追従 4 か所（対象: `docs/README.md`、`docs/architecture.md`、`README.md`）
    - 親が `docs:check` / `check` を回してコミット

- [ ] T4: 最終判定スクリプトと全検査（gate は前景・並列なし）
  - 完了基準:
    1. `scripts/verify-instance-refactor.mjs` を新設。`scripts/verify-transfer.mjs:7-15` の手順配列の形を流用し、手順は順に `bun run build:wasm` → `bunx vp test run` → `bun run test:rust` → `bun run check` → `bun run docs:check` → `bun run build` → base WASM が無ければ `bun scripts/build-engine-variant.mjs --commit <base> --out target/engine-compare/base-<base>.wasm` → `bun scripts/compare-engine-behavior.mjs --base … --candidate public/engine.wasm`（exit 0 を要求）→ 変異 M1 / M2 / M3 を順にビルドして照合（**exit 1 を要求**。exit 0 なら歯なしとして失敗）。`--base-commit <rev>`（既定 `main`）、`--skip-mutations`（開発中の短縮用。最終判定では付けない）。各手順の所要秒と合計を最後に表形式で出力し、exit code を返す（振り返り「gate 所要の食い違い」への対応）
    2. `docs/testing.md:83` の段落の後に、照合スクリプト 3 本の用途・入口・所要の目安を 1 段落追加（追従先チェックリスト 3 行目。Playwright「3本」の記述は変えない）
    3. クリーンな作業ツリー（`git status --porcelain` が空）で `bun scripts/verify-instance-refactor.mjs` を前景で 1 回通し、exit 0。出力の集計行（steps / diffs / ok / error、M1〜M3 の diffs、手順別所要と合計）を PROGRESS の本ターンに写す（PROGRESS 以外には写さない）
    4. 受け入れ基準 1〜6 を順に確認して PROGRESS に「満たした根拠（コマンド名と結果）」を 1 行ずつ書く。基準 5（文書とコードの一致）は T3 の 3 の `git grep` 行数比較を再実行する
    5. `git worktree list` が 1 行、`git status --porcelain` が空（証跡は `target/` 配下のみ）
  - 対象: `scripts/verify-instance-refactor.mjs`（新規）、`docs/testing.md`
  - 依存: T3
  - 並列サブ作業: なし（最終タスク。振り返りの提案どおり gate は前景で回し、サブエージェントを起動しない）

## 決めた事項

1. **`Instance` の構造**（`engine/src/instance.rs`、新規。根拠: REQUIREMENTS R2、`lib.rs:362-378` の現行フィールド順）:
   ```rust
   pub(crate) struct Instance {
       pub(crate) package: Package,
       pub(crate) ui: Node,
       pub(crate) functions: HashSet<String>,
       pub(crate) engine: Engine,
       pub(crate) extension_context: extensions::ExtensionContext,
       pub(crate) ast: AST,
       pub(crate) state: Dynamic,
       pub(crate) http: http::Requests,
       pub(crate) host: host::Requests,
       pub(crate) storage: storage::Requests,
       pub(crate) files: files::Requests,
       pub(crate) rpc: rpc::Requests,
   }
   ```
   `lib.rs` の `Runtime` は `root: Instance` / `dialogs: dialogs::Requests` / `pages: pages::Requests` / `pub revision: u32` の 4 フィールド（この順。`revision` は `pub` のまま = `abi.rs:115` が無改修で通る）。`functions` は `ast.iter_functions()` から再計算できるが**フィールドとして残す**（差分最小。RESEARCH §4）。`lib.rs` の `mod` 一覧には `mod instance;` を `mod http;`（`lib.rs:20`）の次に入れる
2. **`Instance` のメソッド**（これ以外は Runtime に残す）:
   - `pub(crate) fn load(package: Package, script: &str, descriptors: HashMap<String, Vec<u8>>, clock: Option<extensions::Clock>, register: impl FnOnce(&mut Engine), dialogs: &mut dialogs::Requests, pages: &pages::Requests) -> Result<Self, String>`: `lib.rs:409-569` の本文を**そのままの順序**で移す（`extension_context.enter(clock)?` が最初、version → state → webmcp → pages::validate → schema → 100 KB → normalize → validate → resolve → … → `init` → … → prepare 7 連 → `buffers::capacity` → commit 6 連）。`dialogs.register(&mut engine)` / `pages.register(&mut engine)` の位置（`lib.rs:450-453`）と `dialogs.prepare(&ast)` / `pages.prepare(...)`（`lib.rs:557-560`）/ `dialogs.commit(...)`（`:569`）は引数で受けた root 共通物に対して同じ位置で呼ぶ。`Runtime::load_with_clock` は `let mut dialogs = dialogs::Requests::default(); let pages = pages::Requests::default(); let root = Instance::load(…, &mut dialogs, &pages)?; Ok(Self { root, dialogs, pages, revision: 0 })` だけになる（`Requests::default()` は `#[derive(Default)]`（`dialogs.rs:119`）で副作用なし。`pages.rs:13` も同様か impl が確認）
   - `pub(crate) fn clear_queues(&self)`: `http` → `host` → `storage` → `files` → `rpc` の順に `clear()`。7 本の `clear` はいずれも自分の `queue.borrow_mut().clear()` だけ（`http.rs:44` / `host.rs:105` / `storage.rs:87` / `files.rs:191` / `rpc.rs:106` / `pages.rs:50` / `dialogs.rs:219` を読んで確認済み）なので相対順序は観測不能。Runtime 側は各メソッドで `self.pages.clear(); self.root.clear_queues(); self.dialogs.clear();` の順に統一する（`dispatch` / `progress_host` / `complete_host` / `complete_rpc` / `complete_dialog` は現状と同順。`complete_http` / `complete_storage` は `pages.clear()` → `consume` → `clear_queues()` → `dialogs.clear()` と、`consume` の位置（`lib.rs:778,802`）を現状どおり `pages.clear()` の直後に保つ。`complete_file` のみ `pages.clear()` が 3 番目から 1 番目に動くが観測不能）
   - `pub(crate) fn state_json(&self) -> Result<Value, String>`: `lib.rs:987-989` の本文。`Runtime::state_json` は `self.root.state_json()` に委譲
3. **Runtime に残すメソッドの書き換え方**: `dispatch` / `progress_host` / `complete_*` / `take_effects` / `commit_state` / `layout` / `with_clock` は本文を保ち、Instance のフィールド参照を `self.root.<field>` に置き換えるだけ。`call_fn` は現行どおり `self.root.engine.call_fn(&mut Scope::new(), &self.root.ast, …)`（`call_fn_with_options` に変えない = RESEARCH §4）。`commit_state` は Runtime に残す（`prepare` 7 連の順序 `lib.rs:952-958` と「検証がすべて通ってから代入 `lib.rs:974-983`」を変えない = P4。RESEARCH §1.3 の推奨）。`take_effects` の連結順 `http → storage → files → rpc → dialogs → pages → host`（`lib.rs:912-927`）は**応答の effects 配列の順序そのもの**なので変えない。`dialogs.prepare(&self.root.ast)`（`lib.rs:957`）は root の AST を渡す
4. **自由関数の可視性**: `lib.rs` の `validate` / `initialize_ui` / `validate_ui_state` / `check_state` / `validate_handlers`（`lib.rs:1144-1293`）は private のまま `instance.rs` から `use super::{…}` で呼ぶ（子モジュールは親の private 項目を参照できる）。`pub` に変えない
5. **`abi.rs` は無改修**（REQUIREMENTS「差し替えのみ」の 0 件が成立するため。`git diff main --stat -- engine/src/abi.rs` 空が T2 の完了基準）
6. **照合の固定値**（根拠: `scratch/turn-001-compare.mjs:9`、`tests/abi.test.js:14-28`）: `clock = {nowMs: 1759800000000, tzOffsetMinutes: 540}` を load / event / `*_result` / host_progress の全リクエストに付ける。画面の読み込みは `src/screen-catalog.js` の `SCREEN_CATALOG` / `screenFile` と `src/package-format.js` の `parsePackage(text, packageFormat(file))`。1 シーケンス = 新しい WASM インスタンス（`WebAssembly.instantiate(module_, {})`）。動的な id（dialog / http / storage / file / rpc / host の effect `id`）は **base の応答から取り、同じリクエストを candidate にも流す**（candidate で id が違えば effect の差分として表示される）
7. **代表 payload（部品種別）**（根拠: `fields.rs:12-20,245-252`（入力 xtype と `event_value`）、`grid.rs:250-407`、`kanban.rs:106`、`navigation.rs:301-334`、`lib.rs:662-688`）。走査は `pkg.ui` の生ツリー（正規化前）で `handler` と `itemId` を持つノード:
   | xtype（別名含む）                                        | payload                                                   |
   | -------------------------------------------------------- | --------------------------------------------------------- |
   | button / splitbutton / xtype なし（menu item）/ その他   | `{}`                                                      |
   | textfield / textarea / textareafield / combobox / combo  | `{value: "x"}`（combobox は選択肢外でエラーなら、そのエラー応答を照合） |
   | numberfield / slider / sliderfield                       | `{value: 1}`                                              |
   | checkbox / checkboxfield                                 | `{value: true}`                                           |
   | panel（`collapsedBind` あり）                            | `{action: "toggle"}`（無ければ `{}` でエラー応答を照合）  |
   | window / messagebox                                      | `{action: "close"}`                                       |
   | grid / gridpanel                                         | `{action: "sort", column: <node.columns[0].dataIndex>}`（columns が無ければ `{}`） |
   | kanban / tree / treepanel / datepicker / pagingtoolbar   | `{}`（エラー応答の文字列一致を照合。id を要するため）     |
   各 event の後に `layout` 800 を 1 回流す（RESEARCH §3 と同形）
8. **追加シーケンス**（画面の基本列 22 本 + `tests/browser/font-parity-{edit,states,surface,text}.json|rhai` 4 本に加える。label は固定文字列で、T1 の 4 と変異 M2 / M3 の判定に使う）:
   - `reload`: `dialogs` 画面の基本列を流した**同じインスタンス**で再 `load` → `showAlert` event → `layout` 800（P1: `dialogs::SEQUENCE` の採番継続）
   - `dialog-confirm-ok`: `dialogs` → `showConfirm` → `:dialog:<id>:ok` → `layout` 800
   - `dialog-prompt-input`: `dialogs` → `showPrompt` → `:dialog:<id>:input` `{value:"x"}`（Draft、revision +1 = P2）→ `:dialog:<id>:ok`
   - `dialog-result-op`: `dialogs` → `showAlert` → `{op:"dialog_result", id, ok:true, data:null}`
   - `http-result`: `http-grid` → `loadProducts` → `http_result {id, ok:true, data:[{"id":1,"name":"x","price":1}]}` → `http_result {id:<同じ id>}`（消費済み id のエラー）→ `loadProducts` → `http_result {ok:false, error:"boom"}`
   - `storage-result`: `storage-lab` → `saveProfile` → `storage_result ok` → `restoreProfile` → `storage_result {ok:true, data:{…}}` → `removeProfile` → `storage_result ok`
   - `file-result`: `file-lab` → `save` → `file_result ok` → `binaryRead` → `file_result {ok:true, buffer:<buffer_store した 4 byte>}` → `binaryRead` → `file_result {ok:false, error:"x", buffer:<id>}`（`abi.rs:70` のエラー）→ `list` → `file_result {ok:true, data:[]}`
   - `rpc-result`: `rpc-lab` → `connect` → `rpc_result {ok:true, buffer:<4 byte>}`（デコード失敗ならそのエラーを照合）→ `connect` → `rpc_result {ok:false, error:"x"}`
   - `host-result`: `worker-orders` → `load` の effects の host id に `host_result {ok:true, data:null, error:null}` → `refreshOrders` → `host_result ok` → `host_progress {id, data:{operation, transferred:0, total:null}}`（progressHandler 無しのエラー文字列を照合）
   - `host-progress`（インライン fixture = `tests/abi.test.js:163-176` の定義と script）: `load` → `host_progress` 不正 3 種（`abi.test.js:178-182`）→ 正常 progress → `host_result` → 再 progress（消費済みエラー）
   - `navigate`: `page-navigation` → `openDetails`（`navigate` effect）。インライン fixture: handler が `navigate("detail")` と `alert("x")` を同時に呼ぶ → `"Navigation cannot be combined with other effects in the same handler"`（`lib.rs:967-969` = P3）
   - `rollback`: インライン fixture（`lib.rs:1734` と同じ `fail` handler: 代入後 `while true {}`）: `load` → `fail` event（operations 上限エラー）→ `layout` 800 → 正常 event（state が load 直後と同じ = P4）。もう 1 本 `throw "bad"` 版
   - `failed-load-keeps-previous`: `abi.test.js:29-43` の定義で `load` → `add` → 不正 script で `load`（エラー）→ `add`（前の Runtime が残り count が進む）
   - `theme`: `{op:"theme", theme:{version:1, mode:"dark"}}` → `layout` 800（`Scene.theme`）→ 不正 theme（エラー）→ `layout` 800
   - `abi-errors`: 未 load で `{"op":"event","target":"x"}` / `{"op":"layout","width":800}`（`No screen loaded`）、`{}`、`{"op":"nope"}`、load 後に `layout 100`（幅エラー）、`event:unknown-target`（`{"op":"event","target":"nope"}` → `Unknown itemId: nope`。M3 の判定に使う）
9. **変異表**（`build-engine-variant.mjs` の `MUTATIONS` 定数。`from` は**ちょうど 1 回**出現すること。refactor で動いたら `from` だけ直し、ここに訂正行を書く）:
   | 名前 | ファイル | from → to（意図） | 期待する差分 |
   | --- | --- | --- | --- |
   | M1 `layout-x-offset` | `engine/src/lib.rs` | `layout` の root `arrange(...)` 呼び出しの x `16.0` → `17.0`（RESEARCH §3 と同じ変異。`from` は `arrange(` 直後の数行を含めて一意にする） | `layout:*` の `data.widgets[*].x`。基本列で 137 以上 |
   | M2 `dialog-draft-revision` | `engine/src/lib.rs` | `dialogs::Event::Draft` 分岐の `self.revision += 1;` を削除（`from` は `Draft => {` を含めて一意にする） | `dialog-prompt-input` の `data.revision` |
   | M3 `unknown-item-message` | `engine/src/lib.rs` | `"Unknown itemId: {target}"` → `"Unknown item: {target}"` | `abi-errors` の `event:unknown-target` の `error` |
10. **`docs/components-plan.md` の節構成**: 1. 状態（定型文）/ 2. 目的と前提（ExtJS のカスタムコンポーネント相当、エンジン内合成 = DECISIONS B 案と却下案 3 つの要約）/ 3. 使い方（`components` 宣言 名前 → `url`、`xtype` に宣言名、`config`（固定値または親 state への `bind`）、`listeners`（子の `emit` 名 → 親 handler）、子 Rhai の `emit(name, payload)` と任意の `config(state, config)`、`state.config` 注入。YAML 例 1 つ）/ 4. Instance 木の構造（`Runtime { root, components: HashMap<itemId, Instance> }`、Scene 1 つ、target / key の `"<itemId>/<子itemId>"` 接頭辞）/ 5. 設計決定（8 論点の表 + 注記 2 件）/ 6. 段階計画（1・2 完了、3〜6）/ 7. 本マイルストーンで確定した構造（Instance 12 フィールド表、Runtime 4 フィールド表、Instance のメソッド 3 本、root 共通物を Runtime に残す理由）/ 8. 残課題（`safe_key` 区切り文字、`http` effect の `kind`、`SEQUENCE` などの thread_local の扱い = RESEARCH §1.2）
11. **スクリプトの置き場と名前**: `scripts/compare-engine-behavior.mjs` / `scripts/build-engine-variant.mjs` / `scripts/verify-instance-refactor.mjs`。`package.json` の scripts には**足さない**（`verify:transfer` は入っているが、本件は PR 用の一時的な照合で、定常運用の入口にしない。`docs/testing.md` に入口を書く）。スクラッチと証跡は `target/engine-compare/`（gitignore 済み）
12. **テストファイルを足さない**: 受け入れ基準 1 の「既存テストファイルの変更 0」に加え、新規の `tests/*.test.js` も作らない（照合は Node スクリプトと変異表で歯を確かめる。Vitest に載せると各実行で base ビルドが要る）

## 落とし穴の対応（RESEARCH §5 → 担当タスク）

| #   | 担当       | 完了基準での検証                                                                                   |
| --- | ---------- | -------------------------------------------------------------------------------------------------- |
| P1  | T1 / T2    | `reload` シーケンス（決めた事項 8）が diffs 0                                                       |
| P2  | T1 / T2    | `dialog-prompt-input` の `data.revision` 一致。M2 で非 0                                            |
| P3  | T2         | エラー文字列集合の一致（T2-6）、`navigate` + `alert` のエラー応答一致。M3 で非 0                     |
| P4  | T2         | `lib.rs` テスト 2 本無改修 green、`rollback` シーケンス diffs 0、`commit_state` を Runtime に残す    |
| P5  | T1         | 判定にハッシュを使わない（T1-1）                                                                    |
| P6  | T1         | 固定 clock、同一 WASM 同士 diffs 0（T1-4）                                                          |
| P7  | T1 / T2 / T4 | 変異 M1〜M3 が exit 1（T1-4、T2-5、T4-1）                                                         |
| P8  | T1         | `--base` / `--candidate` 両方必須（T1-1）                                                           |
| P9  | T1         | descriptor 投入、`okResponses` / `errorResponses` の記録と T2 での一致                               |
| P10 | T3         | struct 行数と表の行数一致（T3-3）                                                                   |
| P11 | T2         | `abi.rs` 無改修（T2-2、T2-8）                                                                       |
| P12 | T1 / T4    | `git worktree list` 1 行（T1-5、T4-5）                                                              |
| P13 | 恒常       | PROGRESS 冒頭の恒常注意に記載済み。各ターンの「次への注意」には写さない                              |
| P14 | T1         | 変異コピーに `public/themes/` を含める（T1-3）                                                      |

並行性: 単一スレッド WASM・同期 Rhai で並行性は無い（RESEARCH §5 末尾）。境界値: `layout 100`（幅エラー）、`file_result` の `ok:false` + buffer、消費済み id の再完了、`host_progress` 不正 3 種、runaway handler（operations 上限）を `abi-errors` / `file-result` / `http-result` / `host-progress` / `rollback` が担う（決めた事項 8）。異常系: エラー応答も文字列一致で照合する（RESEARCH §2）。

## メモ

- **ゴール逆算**: 受け入れ基準 1 = T2-3 / T2-8 / T3-6 / T4-3、2 = T1 / T2-4 / T4-1、3 = T2-2 / T2-3、4 = T2-2 / T2-3、5 = T3-3 / T4-4、6 = T2-7。RESEARCH §6 の提案 4 件は、再 load・dialog 完了・部品種別 payload を決めた事項 7〜8 に、`safe_key` と `http` の `kind` の注記を T3-2 に採用した（REQUIREMENTS.md は書き換えない）
- **タスク数 4**: REQUIREMENTS が「文書 1 本 + 純リファクタ + 照合」で小さく、各タスクが 1 ターンで実装 + テスト + コミットまで収まる。8 タスクへ増やさない（テンプレートの方針）
- **T2 の進め方**: 先に `instance.rs` に struct と `load` を切り出して `cargo test` を通し、次に `dispatch` 以降の `self.x` → `self.root.x` を機械的に置換する。借用エラーは `let root = &mut self.root;` の導入ではなく直接のフィールド参照で解く（`self.root.http.commit(names, &self.root.package.requests)` は disjoint fields で通る）。`self.state_json()?` を呼ぶ箇所（`dispatch:621`、`commit_state:940`、`layout:995`）は `self.root.state_json()?` に置き換え、呼び出し回数・位置を変えない（P4）
- **RESEARCH「盗める点」の採否**:
  | 盗める点 | 採否 | 理由 |
  | --- | --- | --- |
  | `tests/abi.test.js:14-28` の `raw()` と `:82` の 2 インスタンス起動 | 採用 | 照合スクリプトの WASM 呼び出しの形 |
  | `scratch/turn-001-compare.mjs`（固定 clock・descriptor 投入・ok/error 集計） | 採用（差分表示を JSON 経路に変更、シーケンス追加） | 実測済みで 230 応答 0 差分を再現できる |
  | `scripts/verify-transfer.mjs` の手順配列と exit code | 採用（所要の出力を追加） | 最終判定の形。振り返り提案「所要を出す」 |
  | `dynamic_ui.rs` の「テンプレート（`package.ui`）/ 確定ツリー（`ui`）」の対 | 採用 | Instance が同じ対を持つ。段階 3 で子も同じ関数を使える |
  | `clear()` 7 連の切り出し | 採用（`Instance::clear_queues` = 5 キューのみ） | 重複削減。順序は観測不能と確認済み |
  | `commit_state` を Instance 側へ移し root 共通物を引数で渡す | 却下 | `prepare` の順序と借用を変えないため Runtime に残す（RESEARCH §1.3 推奨）。段階 3 で再検討 |
  | `functions` を `ast.iter_functions()` から再計算 | 却下 | 差分最小。フィールド維持 |
  | Rhai `call_fn_with_options` / `Engine::new_raw` + 共有パッケージ | 却下 | 挙動不変（最上位文の評価・上限の扱いが変わり得る） |
  | `dialogs::SEQUENCE` などの thread_local の移動 | 却下 | P1。文書の残課題に記す |
  | WASM のバイト比較 | 却下 | 同一ソースでも sha256 が違う（RESEARCH §3） |
- **直近 2 件の振り返りの「次回への提案」の採否**:
  - 採用: 変異表を検査タスクの完了基準に入れる（T1 / T2 / T4 の M1〜M3）。並列サブ作業を最終タスクに置かず gate は前景（T4）。台帳規約（生の値は証跡 JSON を指す。T3-6、T4-3）。runner が手順別所要と合計を出す（T4-1）。恒常の注意と次のタスク固有の注意の分離（PROGRESS 冒頭に既存）。「既存画面で条件が揃わない」対策としてインライン fixture を最初から計画に入れる（決めた事項 8）。検査ファイルを役割で分ける（compare / build-variant / runner の 3 本）。`gsd-lite-loop.sh --where` を入口にする（本ターンで実施）
  - 対象外（理由）: 実ブラウザの起動プローブ（本マイルストーンはブラウザ不要）、Codex sandbox（全フェーズ Claude）、lean-ctx フックの root 修正（ループ・環境の改修はスコープ外。恒常注意で回避）、verify の「要確認」付与（verify 側の運用）、`origin` の扱い（discuss で解決済み、DECISIONS）
- **impl への注意**: `bun run build:wasm` は `public/engine.wasm` を上書きする。base は必ず `target/engine-compare/base-35120e0.wasm`（別名）に置く。`.gsd-lite/` `scripts/` `tests/` 配下の `cat` / `grep` はフックに拒否されるので Read ツールと `git grep` を使う（恒常注意）。変異ビルドは作業ツリーを触らない設計（コピー先で置換）なので `git status` が汚れたら設計違反
