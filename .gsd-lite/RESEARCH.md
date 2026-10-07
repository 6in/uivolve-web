# RESEARCH — component-instance-refactor

- 作成: 2026-10-07 / gsd-lite-research（turn 1）
- 入力: REQUIREMENTS.md / DECISIONS.md / state.json の `research.targets` = `local_projects`（検索先 `.`）, `official_docs`（Rhai の Engine / AST / call_fn / Module）
- 証跡: `.gsd-lite/logs/component-instance-refactor/scratch/turn-001-*.{mjs,json}`（gitignore 済み。台帳には生の値を写さず、ファイル名を指す）
- 判断: discuss の決定を覆す発見はなし。段階 3 以降の前提に影響する発見は「要件への影響（提案）」に記す

## 1. 現状の構造（local_projects: `engine/src`）

### 1.1 Runtime のフィールドと利用箇所

| フィールド                                                     | 型                             | 読む / 書く場所（`engine/src/lib.rs`）                                                                                                 | 移動先（DECISIONS） |
| -------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `package`                                                      | `Package`                      | `dispatch`（エラー文字列 `package.script`）、`progress_host` / `complete_*`（`operations` / `requests` / `storage` / `files` / `rpc` の handler 名）、`commit_state`（`ui` テンプレート・`state_schema`）、`layout`（`webmcp` / `state_schema`） | Instance            |
| `ui`                                                           | `Node`（確定ツリー）           | `dispatch`（`find_path` / `collect_windows`）、`commit_state`（`initialize_added` の before）、`layout`                                | Instance            |
| `functions`                                                    | `HashSet<String>`              | `commit_state`（`validate_handlers`）                                                                                                  | Instance            |
| `engine` / `ast`                                               | `rhai::Engine` / `rhai::AST`   | `dispatch` / `progress_host` / `complete_*`（`call_fn`）、`commit_state`（`dialogs.prepare(&self.ast)`）                              | Instance            |
| `extension_context`                                            | `extensions::ExtensionContext` | `with_clock`（`enter`）                                                                                                                | Instance            |
| `state`                                                        | `Dynamic`                      | `complete_*`（`self.state.clone()` を handler に渡す）、`commit_state`、`state_json`                                                   | Instance            |
| `http` / `host` / `storage` / `files` / `rpc`                  | `*::Requests`                  | `dispatch` 先頭と `complete_*` 先頭の `clear()` 7 連、`commit_state` の `prepare` → `commit`、`take_effects`                           | Instance            |
| `dialogs`                                                      | `dialogs::Requests`            | `dispatch`（`active` / `event` → `complete_dialog`）、`commit_state`（`prepare(&self.ast)`）、`layout`（`layout` / `snapshot`）、`take_effects` | Runtime（root 共通） |
| `pages`                                                        | `pages::Requests`              | `clear` 7 連、`commit_state`（`prepare` → navigate と他効果の併用禁止 → `commit`）、`take_effects`                                      | Runtime（root 共通） |
| `revision`                                                     | `u32`（`pub`）                 | `dispatch`（`Draft` で `+= 1`）、`commit_state`（`+= 1`）、`abi::result`（応答の `revision`）                                           | Runtime（root 共通） |

- `lib.rs` の自由関数（`initialize_ui` / `validate*` / `find_path` / `collect_windows` / `measure` / `arrange*` / `content_height` …）は `&Node` / `&Value` だけを取り、Runtime のフィールドに触らない（`git grep` で確認）。Instance 化で動かすのは `impl Runtime` のメソッド本体だけで済む。
- `Runtime` の他モジュールからの参照は `abi.rs`（スロット・`result`）と `extensions/mod.rs` のテスト 3 本（`load_with_extensions` / `load_with_clock` / `state_json`）のみ。
- 公開 API を使う Rust テスト: `lib.rs` 4 本 + `extensions/mod.rs` 2 本（`#[test]` 計数: lib 4 / extensions mod 2 / date 2 / decimal 2 / regex 3 / text 1 / host 1）。

### 1.2 WASM インスタンス全体の thread_local（Instance にも Runtime にも属さない）

| 場所                        | 内容                                                           | 意味                                                                                                  |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `abi.rs:5`                  | `RUNTIME: RefCell<Option<Runtime>>`、`RESPONSE`                | 単一スロット。`load` 成功時のみ置換                                                                     |
| `dialogs.rs:11`             | `SEQUENCE`（ダイアログ id）                                    | **`load` をまたいで増え続ける**。http / storage / files / rpc の `sequence` は `Requests` 内で `load` ごとに 0 から |
| `buffers.rs:4`              | バイナリバッファ                                               | `load` の descriptors と `file_result` / `rpc_result` の `buffer`                                      |
| `files.rs:11`               | `BYTE_USAGE`                                                   | FileBytes の総量                                                                                       |
| `theme.rs:6`                | 現在テーマ                                                     | `Scene.theme`                                                                                          |

→ 挙動不変の照合では「id の採番」もそのまま一致する必要がある。`SEQUENCE` を Runtime / Instance のフィールドに「ついでに」移すと、同じ WASM インスタンスで 2 回目の `load` 以降のダイアログ id が変わる。本マイルストーンでは触らない。

### 1.3 `dispatch` / `commit_state` が Instance 境界をまたぐ箇所（段階 2 の設計上の注意）

- `commit_state` は Instance 側（state / ui / functions / 5 キュー / package）と Runtime 側（dialogs / pages / revision）の両方を 1 関数で更新する。Rust の借用規則では `self.root.commit_state(&mut self.dialogs, &mut self.pages)` のように root 共通物を引数で渡すか、`Runtime::commit_state` に残して `self.root.*` を直接触るかの二択。**後者（Runtime に残す）が差分最小で挙動不変に安全**。前者は段階 3 で child Instance が同じ関数を使えるので将来は有利だが、本マイルストーンの受け入れ基準 6（`dispatch` / `load_with_clock` に 2 段以上の木を前提とする分岐を入れない）とは独立なので plan が選ぶ。
- `dialogs.prepare(&self.ast)`（`dialogs.rs:222`）は **root 共通物が Instance の AST を参照する**唯一の箇所（handler 名の存在確認）。段階 3 では「どの Instance の AST で検証するか」が要る。段階 2 では `&self.root.ast` を渡すだけ。
- `dialogs.register(&mut engine)` / `pages.register(&mut engine)` は `load_with_clock` で Instance の Engine に登録する。`Requests` のキューは `Rc<RefCell<Vec<_>>>` なので、段階 3 で root の dialogs / pages を子 Engine にも `register` すれば同じキューを共有できる（構造変更なしで済む見込み）。
- `with_clock` は `self.extension_context.enter(clock)` を 1 つだけ入れる。`ExtensionContext` は `Rc<Cell<Option<Clock>>>` で Engine ごと（`extensions/mod.rs:17-47`）。段階 3 では Instance 全部の context に `enter` が必要（または context を Runtime で 1 つ作って全 Engine に渡す）。段階 2 では root の 1 つで従来どおり。
- `dispatch` 冒頭の `clear()` 7 連（pages + 5 キュー + dialogs）が `progress_host` / `complete_*` にも同じ形で 6 回繰り返されている。Instance に `clear_all()` を切り出すと重複が減るが、**順序は現状と同じにする**（順序は観測不能なので挙動差は出ないが、差分最小のため）。
- `abi::result` は `runtime.state_json()` / `runtime.revision` / `runtime.take_effects()` だけを使う。`revision` は `pub` フィールド参照なので Runtime に残せば `abi.rs` は無改修で済む可能性がある（REQUIREMENTS は「Instance 参照の差し替えのみ」を許容）。

### 1.4 `dynamic_ui.rs` から盗める形

- `resolve(template, state) -> Node` と `initialize_added(before, after, state)` は「テンプレート → 確定ツリー」を Runtime の外に置いた前例。Instance でも `package.ui`（テンプレート）と `ui`（確定）を同じ対で持つ。
- `expand` の `depth > 20 || count > 200` が node 上限の実体。Instance ごとの上限（DECISIONS）はこの関数を Instance 単位で呼ぶだけで満たせる。

## 2. 既存画面の一覧（画面 × 部品 × handler × 非同期機能）

証跡: `scratch/turn-001-inventory.json`（`bun scratch/turn-001-inventory.mjs` の出力。Node で現行 `public/engine.wasm` に `load` → `layout` 240 / 800 / 4096 → 先頭 handler の `event` を流した結果を含む）。

| 画面（`src/screen-catalog.js` 順） | 形式 | handler を持つ部品（itemId: xtype）                                                                          | 非同期 / 宣言                                              | 備考                                                   |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| hello-world                        | json | helloButton: button                                                                                           | なし                                                       |                                                        |
| dynamic-tabs                       | json | addTab: button                                                                                                | なし                                                       | `itemsBind`（workspace）あり。唯一の動的ツリー          |
| page-navigation                    | yaml | openDetails / tryMissingPage: button                                                                          | `navigate`、pages 2                                        | 先頭 event で `navigate` effect                        |
| page-navigation-detail             | yaml | showMemo / returnHome: button                                                                                 | `navigate`、pages 1                                        |                                                        |
| uivolve-forms                      | json | volume: sliderfield、saveForm: button                                                                         | なし                                                       | slider は `{value: 数値}` が要る（空 payload はエラー） |
| dialogs                            | yaml | showAlert / showConfirm / showPrompt: button                                                                  | `alert` / `confirm` / `prompt`、stateSchema                | `dialog` effect → `:dialog:<id>:ok` で完了まで追える    |
| uivolve-gallery                    | json | showDialog / showToast / clearLog: button、saveSplit: splitbutton、calendar: datepicker、pager: pagingtoolbar、promptDialog: messagebox | なし                                                       | 58 node / 深さ 5 / widget 84。messagebox は window 扱い |
| components                         | json | profile: panel、openEditor / cancelEditor / review / back / commit: button、editor: window                     | なし                                                       | window 2 つ（modal 層・backdrop の照合に使う）          |
| layout-lab                         | json | wizard: panel（card）、previousCard / nextCard / workspaceReset: button                                        | なし                                                       | 幅 240 と 800 で高さが変わる唯一級の画面（872 / 502）   |
| grid-lab                           | json | clearFilter / clearSelection（xtype なし=menu item）、inventory: gridpanel、categories: tree                   | なし                                                       | widget 69。grid の `event` は action 必須               |
| http-grid                          | json | loadProducts: button                                                                                          | `http_get`、requests 1                                     | effect は `{id, request, url}`（`kind` 無し）           |
| rpc-lab                            | yaml | connect / grpc: button                                                                                        | `rpc_call`、rpc 2                                          | `load` に descriptor（`public/screens/rpc-demo.pb`）必須 |
| money-lab / text-lab / date-lab    | yaml | calculate / process / refreshClock: button                                                                    | なし（date-lab は clock を使う）                           | `clock` を固定しないと date-lab の応答が時刻依存        |
| native-extensions                  | json | runRegex / runSum: button                                                                                     | なし                                                       |                                                        |
| storage-lab                        | yaml | saveProfile / restoreProfile / removeProfile: button                                                          | `storage_read/write/remove`、storage 2、stateSchema、webmcp | `storage` effect                                       |
| file-lab                           | yaml | mkdir / save / read / list / stat / remove / binarySave / binaryRead: button                                   | `file_*` 8 種、files 1                                     | `file` effect。`file_result` の buffer 経路も照合候補   |
| orders                             | json | search: textfield、orders: grid、save / reset: button                                                         | なし                                                       | `lib.rs` テストが使う定義                              |
| worker-orders                      | yaml | ordersGrid: gridpanel、getOrder / createOrder / updateOrder / deleteOrder / refreshOrders / resetOrders: button | `host_call`、operations 6                                  | **`load` 時点で `host` effect が出る唯一の画面**        |
| kanban                             | yaml | taskBoard: kanban、reviewRequired: checkbox、resetBoard: button                                                | なし、stateSchema、webmcp                                  | kanban は `{action:"move",…}`、checkbox は boolean      |
| tasks                              | json | search: textfield、tasks: grid、add / toggle: button                                                          | なし                                                       |                                                        |

- 22 画面すべてが Node（ホスト無し）で `load` と `layout` 3 幅に成功する。空 payload で失敗する部品種は slider / numberfield（数値）、checkbox（boolean）、panel（`action: toggle`）、window / messagebox（`action: close`）、gridpanel（`Unknown Grid action`）、kanban（`action: move`）。**エラー応答も照合対象**（エラーメッセージ文字列の一致）にするので、空 payload のままでも照合として成立するが、代表 event として handler を実際に走らせたいなら部品種ごとの payload を用意する。
- 使われない機能: `host_progress`（画面には無い。`tests/abi.test.js:162` と `lib.rs` テストにある定義で補う）、`storage` の `restore` 系完了、`rpc_result` / `file_result` の `buffer` 付き完了。これらは **テストが使う定義**（`tests/*.test.js` のインライン `screen`）か、照合スクリプト内の小さな定義で補う必要がある（前回振り返り「補助 fixture の後出し 5 回」への対応: 最初から計画に入れる）。
- `tests/browser/font-parity-*.json|rhai` は追加の fixture 4 組（edit / states / surface / text）。照合の対象に含めてよい。

## 3. 挙動不変の照合（受け入れ基準 2）に関する実測

証跡: `scratch/turn-001-compare.mjs`（2 つの WASM に同じリクエスト列を流し、応答 JSON の**文字列一致**を数える）と、その出力。

| 実測                                                                                                                         | 結果                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| base（`main` = `35120e0`）を `git worktree add --detach` → `cargo build --target wasm32-unknown-unknown --release --locked --target-dir <scratch>` | 成功。`node_modules` 不要（`scripts/build.mjs` を使わず cargo 直叩き）。所要 30 秒（deps 含む）                   |
| base ビルド vs 現行 `public/engine.wasm`（22 画面 × load + layout 3 幅 + 全 handler の event + event 後 layout = 230 応答）  | 差分 0 / 230（ok 223・エラー 7。エラーも文字列一致）                                                             |
| 同一 WASM の 2 インスタンス                                                                                                   | 差分 0 / 230（採番・順序は決定的）                                                                               |
| 同一ソースを別 `--target-dir` で 3 回ビルドした WASM の sha256                                                               | **3 つとも異なる**（サイズも 1 byte 違う）。パス文字列は埋め込まれていない                                      |
| 変異（`engine/` を `scratch/turn-001-mutant/` に写し、`layout` の root `arrange` の x オフセット 16.0 → 17.0 に変更してビルド）vs 現行 | **差分 137 / 230**（layout 応答 22 × 3 + event 後 layout 71 = 137 がすべて差分。`load` / `event` の 93 応答は一致）。照合に歯があることを確認 |

含意:

- **WASM のバイト比較は使えない**（同一ソースでも一致しない）。照合は必ず応答 JSON で行う。
- 応答 JSON の文字列一致で足りる（`serde_json` は `preserve_order` 無効 = キー順はソート、`rhai::Map` も BTreeMap、`Package` の `HashMap` は応答に出ない）。canonicalize は不要だが、差分表示のために JSON を parse して経路を出すとよい。
- `clock` を固定しないと date-lab と、`clock` を読む `init` の応答が時刻で変わる。照合スクリプトは `clock: {nowMs, tzOffsetMinutes}` を全リクエストに同じ値で付ける（`src/engine.js` の `clockOperations` が付ける経路と同じ形）。
- `rpc-lab` は `load` 前に `buffer_store` で descriptor を入れる必要がある（`scripts/build.mjs` が `public/screens/rpc-demo.pb` を生成済み）。
- `public/engine.wasm` は gitignore 対象で、`bun run build:wasm` のたびに上書きされる。照合の「リファクタ後」側は `engine/target/wasm32-unknown-unknown/release/wasm_ui_engine.wasm` か `public/engine.wasm` のどちらでもよいが、**base 側は必ず別ファイル名で保存**する（本ターンは `.gsd-lite/logs/component-instance-refactor/base-main-35120e0.wasm` に置いた。gitignore 済み・再現は上の手順で 30 秒）。
- `git worktree` の作業ディレクトリは gitignore 下（`.gsd-lite/logs/<slug>/scratch/`）でも作れる。終わったら `git worktree remove --force <path>` で登録を消す（残すと `git worktree list` に見え続け、`.git/worktrees/` にメタデータが残る）。
- `engine/src/theme.rs:41,59` が `include_str!("../../public/themes/{light,dark}.json")`、`lib.rs:1662,1664`（テスト）が `public/screens/orders.{json,rhai}` を埋め込む。**`engine/` だけを写した変異コピーはビルドできない**（本ターンで 1 回失敗）。変異は worktree か、`public/themes`（テストを回すなら `public/screens` も）を一緒に写した場所で行う。
- 差分表示は応答の先頭 N 文字ではなく、JSON を parse して**最初に異なる経路**（例 `data.widgets[3].x`）を出す。本ターンの雛形は先頭 200 文字しか出さず、変異の差分箇所が表示から読めなかった。

## 4. 公式ドキュメント（Rhai 1.26.1、`default-features = false` + `std, serde, no_module, no_custom_syntax, no_time`）

| 事実                                                                                                                          | 出典                                                                                          | Instance 設計への含意                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Engine` は `!Send` / `!Sync`、`Clone` 未実装                                                                                  | docs.rs `rhai::Engine` Auto Trait Implementations                                             | `Instance` / `Runtime` は `Clone` できない（現状と同じ）。テストで Runtime を複製する発想は不可                                          |
| `AST` は `Clone`（関数は共有されるので安価）。`iter_functions` / `merge` / `combine` / `clone_functions_only` / `retain_functions` / `clear_statements` は `internals` 無しで使える | docs.rs `rhai::AST`、book「Manage AST's」                                                     | `functions: HashSet<String>` は `ast.iter_functions()` からいつでも再計算できる（フィールドを残すかは plan の判断。残す方が差分最小）    |
| `Engine::call_fn` は既定で **AST の最上位文を毎回評価してから**関数を呼ぶ。`call_fn_with_options` の `eval_ast(false)` / `rewind_scope` で変えられる | book「Calling Rhai Functions from Rust」                                                       | 現行コードは既定の `call_fn` を使う。Instance でも**同じ API を使う**（`call_fn_with_options` に変えると最上位文を持つスクリプトで挙動が変わる） |
| 引数は型が厳密一致しないと関数が見つからない。1 引数は `(arg,)`                                                                 | 同上                                                                                          | 現行 `(state,)` / `(next, event)` を維持                                                                                                |
| `set_max_operations` 等の上限は **Engine ごと**                                                                                 | docs.rs `rhai::Engine`（`unchecked` では無効）                                                 | Instance ごとに Engine を持てば「上限は Instance ごと」（DECISIONS）は自然に満たされる                                                   |
| パッケージ（標準関数群）は 1 回作って複数 Engine で共有できる。`Engine::new_raw` + 共有パッケージは多数の Engine を作るときに有効 | book「Packages」                                                                              | 段階 3（Instance 最大 8）でメモリが問題になったときの選択肢。**本マイルストーンでは `Engine::new()` のまま**（挙動不変）                  |
| `no_module` は外部モジュールの読み込みを無効化する                                                                             | book「Features」                                                                              | 子スクリプトを `Module`（`eval_ast_as_new`）や名前空間で隔離する案は取れない。Instance = 自分の Engine + AST で隔離する（DECISIONS と整合） |
| `Module::eval_ast_as_new` は AST 全体を各関数に抱き込ませる                                                                   | book「Create a Module from an AST」                                                           | 使わない（上と同じ理由）                                                                                                                 |

## 5. 落とし穴と回避策（plan が完了基準に写す）

| #   | 落とし穴                                                                                                                                                     | 回避策                                                                                                                                    | 踏んでいないと分かる検証                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | `dialogs::SEQUENCE`（thread_local）を Instance / Runtime へ移してしまい、2 回目の `load` 以降のダイアログ id がずれる                                           | thread_local は触らない                                                                                                                   | 照合に「同一インスタンスで `load` → dialog event → **再 `load`** → dialog event」を含め、2 回目の effect `id` が一致すること                                                                 |
| P2  | `revision` を Instance へ移し、`abi::result` の参照や `Draft` 時の `+= 1` が変わる                                                                             | `revision` は Runtime に残す（DECISIONS）                                                                                                 | 照合の `data.revision` 一致。`dialog` の prompt 入力（`:dialog:<id>:input`）で revision が +1 される経路を含める                                                                             |
| P3  | `clear()` 7 連や `prepare` → `commit` の順序を変え、`navigate` と他効果の併用エラーの判定順やエラー文字列が変わる                                            | 順序を現状どおり写す。エラー文字列は `git grep "Err(" engine/src/lib.rs` の一覧と diff 0                                                   | `git diff main -- engine/src/lib.rs engine/src/instance.rs` で `"..."` のエラー文字列を抽出し、集合が一致。照合に navigate + alert を同じ handler で呼ぶ定義（エラー応答）を含める          |
| P4  | 借用衝突の回避で `self.state.clone()` / `state_json()` の呼び出し回数や位置を変え、失敗時のロールバック（「失敗したら何も変わらない」）が崩れる                 | `commit_state` の「検証がすべて通ってから代入」の構造を維持する                                                                             | `lib.rs` の `event_failure_rolls_back_and_execution_is_bounded` / `host_progress_and_cancel_roll_back_without_consuming_completion` 無改修 green + 照合に失敗 handler（throw）後の `state` 一致 |
| P5  | WASM をバイト比較して「同一」と誤判定 / 「差分あり」と誤判定                                                                                                  | 応答 JSON だけを比較（§3）                                                                                                                 | 照合スクリプトが WASM のハッシュを判定に使っていないこと（コードレビュー項目）                                                                                                              |
| P6  | 照合の時刻依存（`clock` 未指定で `date-lab` 等が変わる）                                                                                                     | 全リクエストに固定 `clock`                                                                                                                 | 同一 WASM の 2 インスタンス照合が 0 差分（§3 で実測済みの形を維持）                                                                                                                         |
| P7  | 照合に「歯」が無い（何を変えても 0 差分）                                                                                                                    | 変異表: 応答を 1 か所変えたビルドで差分が非 0 になることを 1 件以上（REQUIREMENTS）                                                        | §3 末尾の変異の実測と同じ手順を `scripts/` の照合スクリプトで再現（`--mutant <wasm>` のような入口か、手順書）                                                                                |
| P8  | `bun run build:wasm` が `public/engine.wasm` を上書きし、base 側 WASM を失う                                                                                   | base は別名で保存（§3）                                                                                                                    | 照合スクリプトの引数が 2 つの明示パスで、既定で `public/engine.wasm` を base と見なさない                                                                                                   |
| P9  | `rpc-lab` が descriptor 無しで `load` に失敗し、照合が「両方エラーで一致」のまま通る                                                                           | descriptor を `buffer_store` してから `load`。照合結果に ok / error の件数を出し、期待件数（本ターン: 230 中エラー 7）と比べる               | 照合の集計行に `okResponses` / `errorResponses` を出し、plan が期待値を書く                                                                                                                 |
| P10 | `docs/components-plan.md` の Instance フィールド一覧が実装と食い違う（verify が照合）                                                                        | 文書のフィールド表は `instance.rs` の struct 定義から機械的に起こす（名前・型・順序）                                                        | `git grep -n "^    [a-z_]*:" engine/src/instance.rs` の行数と文書の表の行数が一致。verify が突き合わせ                                                                                      |
| P11 | `cargo fmt --check`（`bun run check`）で `abi.rs` の既存の非整形行（`abi.rs:33-36, 56-76` は 1 行が長い）が引っかかる                                           | `abi.rs` は現状 `cargo fmt --check` を通っている（`bun run check` が green の前提）。触る行を最小にし、`cargo fmt` を走らせたら差分が `abi.rs` に波及していないか見る | `git diff --stat main -- engine/src/abi.rs` が Instance 参照の差し替え行だけ                                                                                                              |
| P12 | `git worktree` の残骸（`.git/worktrees/`）やスクラッチの `target/`（約 280 MB / ビルド）が溜まる                                                              | ターン末に `git worktree remove --force`、target は消す。base WASM だけ残す                                                                 | `git worktree list` が 1 行                                                                                                                                                                 |
| P14 | 変異ビルドや base ビルドを `engine/` だけの写しで行い、`include_str!` の `public/themes` が無くて失敗する                                                 | worktree を使う（base）。変異は作業ツリーの `engine/src/lib.rs` を一時的に書き換えてビルドし、`git checkout -- engine/src/lib.rs` で戻す（バイト列復元を `git diff --stat` で確認）か、`public/themes` を一緒に写す | 変異手順の最後に `git status --porcelain engine/` が空                                                                                                                                      |
| P13 | lean-ctx フックが `.gsd-lite/` と `scripts/` `tests/` 配下への `cat` / `sed` / `grep` を「project root 外」で拒否する（本ターンでも `cat scripts/build.mjs` が拒否）   | 読みは Read ツール、検索は `git grep`（追跡ファイル）/ `bun -e`（未追跡）。`sha256sum` / `cp` / `cargo` / `bun` / `git worktree` は通る     | （恒常注意。PROGRESS の「次への注意」に 1 行）                                                                                                                                                |

並行性・暦の端・権限の観点: 本マイルストーンは単一スレッド WASM・同期 Rhai で並行性は無い。暦は `clock` 固定で切り離す。権限はなし。契約外のエラー漏れは P3（エラー文字列集合の一致）で押さえる。

## 6. 要件への影響（提案。REQUIREMENTS.md は書き換えない）

- 受け入れ基準 2 の照合に **再 `load`（同一インスタンスで 2 画面目）** と **ダイアログ完了（`:dialog:<id>:ok` / `dialog_result`）** を含めることを提案（P1 / P2）。
- 受け入れ基準 2 の「代表 `event`」は、空 payload で失敗する部品種（slider / checkbox / panel / window / grid / kanban）について部品種ごとの payload を 1 つ決めて handler を実際に走らせることを提案。エラー応答の一致だけでは Rhai 経路（`call_fn` → `commit_state`）を通らない。
- 段階 3 以降の設計決定「子の storage / files scope = `親画面id/itemId`」について: `storage::safe_key`（`storage.rs:49`）は `/` を許さず、`files.rs:312` も同じ関数で名前を検査する。段階 4 / 5 で scope を実装するときは区切り文字を `__` 等にするか `safe_key` を拡張する必要がある。**本マイルストーンの文書では決定表をそのまま載せ、備考に「区切り文字は段階 4 で `safe_key` と合わせて決める」と注記する**ことを提案。
- `http` の effect だけ `kind` を持たない（`{id, request, url}`。storage は `kind: "storage"`）。段階 4 の「effect に `instance` を追加」で揃える機会になるが、本マイルストーンでは触らない（挙動不変）。文書の段階 4 の項に注記として残す。

## 7. 参考（ローカル）

- 照合の雛形: `scratch/turn-001-compare.mjs`（WASM 2 つ・固定 clock・descriptor 投入・応答文字列一致・ok/error 集計）。`tests/abi.test.js:14-28` の `raw()` と `:82` の 2 インスタンス起動の形を流用。
- 画面の読み込み: `src/package-format.js` の `parsePackage(text, packageFormat(file))` と `src/screen-catalog.js` の `SCREEN_CATALOG` / `screenFile`（`tests/kanban.test.js:12` と同じ使い方）。
- 最終判定スクリプトの形: `scripts/verify-transfer.mjs`（手順配列を前景で順に回し、exit code を返す。所要の出力は無い → 前回振り返りの提案どおり、新スクリプトは手順ごとの所要と合計を最後に出す）。
- 文書の体裁: `docs/platform-features-plan.md` 冒頭の「状態: 計画・実装履歴。現行APIの判断は…この文書の過去の制限を現行仕様として使わない」が「検討記録」の定型。`docs/README.md` の表は「やりたいこと | 読む文書」の 2 列、`docs/architecture.md:25-55` の責務表は「場所 | 担当」の 2 列。`architecture.md:59-63` の「画面とイベントの確定」節は Runtime の説明なので、Instance 導入後に 1 文の追従が要る（R1 の「1 行追加」に加えて）。
- `bun run docs:check` は現行 green（57 ファイル・470 リンク）。
