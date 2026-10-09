# 決定記録 — component-effects

## 前提

- 前回 component-composition は PR #2 でマージ済み。main（49c8183）= origin/main。前回成果物は `archive/component-composition/` へ退避。
- 前回 reflect の提案 10 件を読み、スキル修正 7 件と「段階 4 以降の research の入力（残留リスク 1・3・9）」「`components.md:117` への 1 件追加」を本 discuss で扱う。

## Round 1

### マイルストーンの対象

- 採用: 段階 4（効果の instance ルーティング）。slug `component-effects`。
- 却下: 段階 5 ローダー（段階 4 を飛ばすと子が同期のみのまま）/ 段階 6 WebMCP（先にやる動機が薄い）。

### スキルの事前編集

- 採用: reflect の「スキルを直す」提案のうち主要なものを discuss 中に編集してループ前にコミットする（scratch/ を消さない + `rm -rf` 禁止 / 前ターンのエントリ編集禁止 + `git show HEAD:<path>` / 直交表 / `gh pr create --head` / サブエージェント本数の記載 / Rhai 予約語）。
- 理由: 前回 PLAN メモだけでは turn 13 で再発した。却下: PLAN メモへの転記だけ。

### 堅牢性の受け入れ基準

- 採用: 入れる（R-robust）。非同期の完了経路が増える今回は特に重要。

### 運用

- 採用: 前回と同じ（push + PR、`.gsd-lite/` も PR に含める）。却下: `.gsd-lite/` を別コミットに分ける / ローカルのみ。

## Round 2

### 解禁する効果の種類

- 採用: 7 種すべて（http / storage / files / rpc / host / dialog / navigate）。対応する宣言 `requests` / `storage` / `files` / `rpc` / `operations` / `pages` も子で許可する。`webmcp` は段階 6 のまま拒否。
- 理由: 段階 4 で「子は同期のみ」の制限を一括で外し、段階 5（ローダー）以降は効果の種類を気にしなくてよい状態にする。
- 補足: dialog のキューは root 1 本のまま（モーダル層は root）、完了ハンドラだけ子へ届ける。navigate は画面全体の遷移（B 案では子だけの遷移は存在しない）。

### storage / files の子 scope

- 採用: `<root の id>__<instance パス（`/`を`__` に置換）>`（例 `orders__a__b`）。root は従来どおり `<id>`。storage / files を宣言する子を置くとき、パス上の itemId が `[A-Za-z0-9_-]` に合わないか合成後 80 バイトを超えれば load エラー（Rust と JS の 2 段）。
- 却下: 種別共有の宣言（`scope: "package"`）を今回入れる（契約とテストが増える。計画の「宣言で選択」は後の段階へ）/ 区切り `-` 1 文字（`a-b`+`c` と `a`+`b-c` が衝突）。

### http effect の `kind`

- 採用: 常に `kind: "http"` を付ける。`compare-engine-behavior.mjs` に「http effect の `kind` だけ無視」する正規化を入れて base との差分 0 を保つ（それ以外のキーは正規化しない）。JS は既に `kind === "http"` を受ける。契約文書（`docs/files-cache-rpc.md` / `http-adapter.md` 等の effect の形）を更新。
- 却下: 子だけ付ける（非対称）/ 付けない。

### `instance` の形と id の採番

- 採用: effect は子のときだけ `"instance": "<接頭辞付き itemId>"` を持ち root は省略。完了 op（`*_result` / `host_progress`）も子は `instance` 必須、省略 = root。id は Instance ごとの連番のまま。未知の `instance`、他 Instance の id、root に子の id を返す等はエラーで state 不変（R-robust）。
- 却下: root も `""` で常に出す（既存応答が変わる）/ id を画面全体で一意にする（既存構造と既存画面の id 列が変わる）。

## Round 3

### 子の完了ハンドラの意味論

- 採用: 完了 = 子への dispatch と同じ経路。子の完了ハンドラは emit でき、親の listeners → 親の commit → config の伝播まで 1 commit・revision +1。失敗すれば root と子すべて不変。却下: 子 state だけ更新（emit 不可）。

### 相対 URL の基準

- 採用: 子の `requests` / `rpc` / `pages` / `operations` の URL は、その Instance の宣言 URL（子パッケージ URL）基準で JS が解決する。JS は `effect.instance` から Instance → 宣言 URL を引く。却下: root パッケージ URL 基準（子を別ディレクトリに置くと壊れる）。

### dialog / navigate の細部

- 採用: dialog も他の完了と同じく、子のダイアログは `dialog_result` に `instance` 必須（id は root 採番で一意だがルールを 1 つにする）。navigate は画面全体の遷移で、effect に `instance` を付け URL は子基準。却下: dialog だけ `instance` 任意。

### デモ

- 採用: storage / http / dialog を使う子 3 種をデモに足す（order-dashboard の拡張または新デモ 1 画面は plan が決める）。http の子は既存 `http-grid` を無改修で置く（「既存画面を無改修で部品に」の実証）。probe-composition と Vitest（両レンダラー）で確認。
- 経緯: 最初の回答が「3 種を足す」と「増やさない」の両方だったため確認し、「3 種を足す」で確定。

## Round 4

### 追加スコープ

- 採用: (1) `components.md:117` の JS 文言列挙に `コンポーネント {名前} の宣言が不正です（url を文字列で指定してください）` を追加（前回残留リスク 9）。(2) layout の子スナップショット（`layout_scope()` の `ui.clone()` + `state_json()`）を revision をキーにキャッシュ（前回残留リスク 1）。(3) `file_bytes` が子で使えることを契約文書に 1 文 + テスト 1 本（前回残留リスク 3）。

### 上限

- 採用: Instance ごと（pending 8 / handler あたり 8 / RPC 定義 8 など、キュー構造のまま）。契約文書に「画面全体では Instance 数 × 上限」と書く。却下: 画面全体の共有上限の追加。

## 終了シーケンス

- 確定内容サマリー（REQUIREMENTS.md / DECISIONS.md）にユーザーが合意。
- research の対象: local_projects（検索先 `.`。effect / 完了 / scope / HostEffects の実装と段階 3 の決定、前回残留リスク 1・3・9）、official_docs（Rhai の Engine 単位の関数登録と `call_fn`、OPFS のディレクトリ名制約とロック、serde の任意フィールド `skip_serializing_if`）、similar_oss（宣言的 UI エンジンでの子コンポーネントの非同期効果ルーティング（Elm の `Cmd.map` 等）と ID の名前空間）。
- 実行パターン: 現在の設定を維持。全フェーズ Claude（engine=claude、phase_engines={}）。model は research / plan / verify / reflect = claude-fable-5-1、impl = claude-opus-5。subagents=auto、reflect=true。`gsd-lite-loop.sh --check` は discuss 中に通過（trust 受理済み、allowlist 有効）。
- スキル編集: `.claude/skills/gsd-lite-{impl,plan,research,verify,reflect}/SKILL.md` に reflect 提案を反映（scratch/ を消さない + `rm -rf` 禁止、native Read の unchanged → `git show HEAD:<path>`、PROGRESS の前ターン編集禁止と接尾辞禁止、サブエージェント本数の記載、追従先の `rg -l` と直交表、`gh pr create --head --body-file`、Rhai 予約語の 1 行）。discuss スキルは未変更。
- 却下した reflect 提案（今回は見送り）: verify の F 系完了基準テンプレート（契約文書の文言列挙節への追記）。lean-ctx フックの project root はマイルストーン外。
- リモート運用: 前回と同じ。verify 合格後に `gsd-lite/component-effects` を origin へ push して PR を作る。`.gsd-lite/` も PR に含める。
- ブランチ: base は `main`（`49c8183`、origin/main と一致、PR #2 マージ済み）。
- 起動: discuss のセッションから `setsid` でデタッチ起動し手を離す。

## discuss 側で確定した細目（ユーザーの明示判断なし。最終サマリーで提示）

- `instance` の値は接頭辞付き itemId（`Runtime.components` のキー）そのもの。root は省略。
- dialog のキューは root 1 本のまま（`Runtime.dialogs`）。完了ハンドラの実行先だけ Instance へ振る。
- navigate は画面全体の遷移。子の `pages` 宣言を許し、URL は子パッケージ基準で JS が解決。
- 子の `window` と `webmcp` の拒否、`network-first` の拒否、エディタの「変更を適用」の制約は段階 3 のまま。
- scope の規則は契約文書に 1 か所で書き、Rust と JS の規則が一致するテストを置く。
- 新デモの子 3 種は base WASM が load できないので照合列から除外し、probe / Rust 単体 / Vitest で検証する。

## Round 5（plan。turn 2。REQUIREMENTS が「plan が決める」とした細目と RESEARCH §7 の提案の採否）

- 採用（RESEARCH §7-1 / P1）: scope 規則 `<root の id>__<instance パスの / を __ に置換>` はそのまま、**scope を構成する要素（root の `id` と各 itemId）が `__` を含むとき、その子が storage / files を宣言していれば load エラー**。Rust 文言 `Component {path}: storage scope {scope} requires 1–80 ASCII letters, digits, - or _ without "__" in any part`、JS 文言 `コンポーネント {path} の保存領域 {scope} が不正です（英数字・-・_ で80バイト以内、各要素に __ を含めない）`。理由: itemId `a__b` とパス `a/b` が同じ scope になる曖昧さを 1 行の検査で潰す。却下: 区切りの変更（REQUIREMENTS R5 で確定済み）。
- 採用（RESEARCH §7-2）: 受け入れ基準 1 の免除範囲に「段階 3 の拒否機構の撤去に起因するテストの削除・書き換え」（`composition_tests.rs` の 3 本削除 + 1 本書き換え + 1 本の変種差し替え、`probe-composition.mjs` の 2 列削除）を足し、PROGRESS に `kind: "http"` 起因とは別の見出しで列挙する。
- 採用（RESEARCH §7-3）: http の子は既存 `public/screens/http-grid.json` を無改修で宣言し、Vitest では `ResourceClient.fetch` を差して `data/products.json` の内容を返す。「worker mock API」の語は使わない。host の子（4 種目）は足さない（`connections` の注入が要り、デモの範囲を超える）。
- 採用（RESEARCH §7-4）: `HostEffects` の同時操作上限 8（`同時ホスト操作は8件までです`）は Instance ごと。`#lastId` / `#active` も Instance ごとに分ける。
- 採用（RESEARCH §7-5）: `UiRuntime` に `dialog_result` を送る経路は増やさず、`WasmEngine.completeDialog(id, response, instance)` の第 3 引数追加と `docs/dialogs.md` の追記で R6 を満たす。
- 採用（RESEARCH §7-6 / P13）: 子のダイアログの `dialog_result` で `instance` 省略・他 Instance 指定は、新文言を増やさず既存 `Unknown or completed dialog request` を再利用する（pending は消費しない）。
- 採用（RESEARCH §7-7 / P9）: 完了 op の `instance` は「キー無し = root」「`^[^/:]+(/[^/:]+)*$` に合う文字列 = 子」だけを受理し、それ以外（`null` / `""` / 数値 / `"/a"` / `"a/"` / `"a//b"` / `"a:b"`）は `Invalid component instance`。木に無いパスは `Unknown component instance: {instance}`。
- 採用（RESEARCH §7-8）: 子自身の `id` の `safe_key` 検査（`instance.rs:147,168`）は残す。理由: root と子で `Instance::load` の検査順序を分岐させない。既存画面の `id` はすべて safe。
- 採用（RESEARCH §7-9）: rhai の `internals` feature を外す（唯一の利用者 `reject_effect_calls` が消える）。`Cargo.lock` は feature 変更の影響を受けないので `--locked` のまま通る。`docs/components.md` の「実装上の注意」節は削除。
- 採用（RESEARCH §7-10 / §1.5 (b)）: 公開シグネチャは **`pub enum Completion { Http { id, response }, Storage { id, response }, File { id, response, buffer }, Rpc { id, response, buffer }, Host { id, response }, HostProgress { id, data }, Dialog { id, response } }` と `pub fn complete(&mut self, instance: &str, completion: Completion) -> Result<(), String>` を 1 本足し、既存 7 本（`progress_host` / `complete_host` / `complete_http` / `complete_storage` / `complete_file` / `complete_rpc` / `complete_dialog`）は名前・引数不変のまま `complete("", ...)` の薄い wrapper にする**。`abi.rs` は `complete` だけを呼ぶ。Rust 単体テストも `complete` を直接呼んでよい（「ABI からだけ呼ぶ」は本番の呼び出し元の話）。
- 採用（RESEARCH §1.9 / P3）: 子の RPC descriptors は ABI の `components[url].descriptors`（`{name: bufferId}`。root の `descriptors` と同形）で同梱する。Rust は **`pub struct Bundle { pub package: Package, pub script: String, pub descriptors: HashMap<String, Vec<u8>> }` と `pub fn load_with_bundle(package, script, descriptors, clock, components: HashMap<String, Bundle>, register)` を足し、既存 `load_with_components` は descriptors 空の wrapper にする**（既存 6 本の `load*` の名前・引数は不変。新 pub fn は ABI とテストだけが呼ぶ）。JS はローダーが子の descriptors を保持し、`WasmEngine.load` が `storeBuffer` して渡す。
- 採用（RESEARCH §1.3 (T) / P4）: `dialogs` / `pages` の共有キューは root 1 本のまま、`register(engine, origin)` で Intent に `origin`（接頭辞付きパス。root は `""`）を持たせる。`Instance::load` の `effects: bool` 引数は `path: &str` に置き換え（`path.is_empty()` が root）、子でも 5 モジュール + `dialogs` + `pages` を本物で登録する。却下: Instance ごとのキュー（Q 案。段階 2 の「Runtime 側 4 フィールド」の意味が変わる）。
- 採用（RESEARCH §1.1 (b)）: effect への `instance` 付与は `Runtime::take_effects` が子の effect を取り出すときに `as_object_mut().insert("instance", path)` で行う（`http::Effect` / `storage::Effect` は `serde_json::to_value` 後）。`dialogs` / `pages` は `origin` が空でなければ `commit` / `prepare` で JSON を作る時点で付ける。effect の連結順は root の 7 連結（`http → storage → files → rpc → dialogs → pages → host`）を不変にし、子は root の後ろに `components` のキー順（パス順）で `http → storage → files → rpc → host` を連結する。
- 採用: 完了 7 本の先頭の `pages.clear()` / `clear_queues()` / `dialogs.clear()` は `Runtime::complete` の先頭で**一律にこの順で**行う（現状は関数ごとに `consume` との前後が違う）。理由: 3 つとも未確定の intent キューだけを空にし、応答に出る `ready` には触らないので順序は観測できない。照合 差分 0 で確かめる。
- 採用: 子の完了で起きた失敗は dispatch と同じく `Component {path}: ` を前置する（`Component a: Unknown or completed HTTP request`、`Component a: a.rhai / HTTP products / productsReceived: ...`）。`Unknown component instance` / `Invalid component instance` は Instance が決まる前のエラーなので前置しない。
- 採用（R8 / RESEARCH §1.7）: layout の子スナップショットは `Instance` に `snapshot: RefCell<Option<Rc<(Node, Value)>>>` を持たせ、`Instance::apply` で `None`、`layout_scope` で `None` なら作って入れる lazy 方式。世代カウンタは持たない（`apply` が唯一の書き込み点）。テスト helper `set_state` は `apply` 経由に直す（P12）。
- 採用（R9）: デモは **新画面 `parts-lab`（`public/screens/parts-lab.json` / `.rhai`、「部品ラボ」）** に子 3 種（`products` = `http-grid.json` 無改修 / `note` = `parts/note-pad.json`（storage）/ `approval` = `parts/approval.json`（dialog））を置く。却下: `order-dashboard` の拡張（既存の probe / Vitest の期待値と 240px の hbox を壊す）。画面数は 23 → 24。
- 採用（R9 / P7）: 基準 URL の Vitest は root と別ディレクトリ（`screens/parts/`）に置いた fixture の `requests` で確かめる（`http-grid.json` は root 基準でも同じ URL に解決してしまうため）。
- 採用: JS 側の Instance 表と scope の規則は新モジュール `src/component-tree.js`（`instanceTable` / `componentScope` / `scopeProblem`）に 1 か所で置き、`application-loader.js` の `countInstances` と `UiRuntime.compile` の両方がそれを使う（P8）。各 `*Effects` は `resetInstances(Map<path, 基準>)` を足し、既存の `reset(値)` は `resetInstances(new Map([["", 値]]))` の wrapper にする（既存テストは無改修）。
- 採用（R4）: `src/runtime.js` の `!effect.kind ||` は外す。理由: 段階 4 の WASM は常に `kind: "http"` を付け、古い WASM と新しい JS を組み合わせる配布契約は無い（`docs/runtime-distribution.md` は同じ版の WASM と JS を 1 組で配る）。
- 採用: 変異は既存 5 本に `instance-dropped`（`take_effects` が子の `instance` を付けない）と `completion-routed-to-root`（`Runtime::complete` が `instance` を無視して root で完了する）の 2 本を `probe: "composition"` で足し、7 本にする。`http::Effect.kind` を落とす変異は照合の正規化で見えないので入れず、Rust 単体と Vitest で固定する。
- 採用: 最終判定は既存 `scripts/verify-instance-refactor.mjs` をそのまま使う（`MUTATIONS` を読むだけなので変異を足せば手順が増える）。新規スクリプトは作らない。
