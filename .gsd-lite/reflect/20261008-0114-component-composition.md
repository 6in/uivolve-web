# 振り返り — component-composition（2026-10-08 01:14）

- 種別: ループ（verify 合格後）、fix_round=0、verify_round=2（round 1 差し戻し 2 件 → F1 / F2 → round 2 合格）
- 対象範囲: ef582d5（main）...2e679a9（33 コミット。discuss d4230a0 〜 verify の state 更新 2e679a9。人間の介入コミット 0 件）/ ターン 1〜18
- 範囲の説明: in-repo 形・リモート運用。`main` へ未マージで PR <https://github.com/6in/uivolve-web/pull/2> が OPEN（本 reflect 時点で CI `build` は IN_PROGRESS、`mergedAt` null）。本 reflect（turn 19）は未集計
- 前回の振り返り: 20261007-1205-component-instance-refactor.md（その前 20261007-0457-renderer-font-size-parity.md）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル         |
| -------- | -------- | ------ | ---------- | -------- | ------------ | -------------- | ------------- | ------------------------- |
| research | 1        | 1      | 16.0       | 0        | 68,975       | 5,036,810      | 10.30         | claude / claude-fable-5-1 |
| plan     | 1        | 1      | 16.5       | 0        | 73,423       | 4,325,034      | 10.34         | claude / claude-fable-5-1 |
| impl     | 14       | 14     | 143.3      | 0        | 368,579      | 83,945,119     | 84.88         | claude / claude-opus-5    |
| verify   | 2        | 2      | 24.2       | 0        | 89,884       | 9,048,928      | 21.15         | claude / claude-fable-5-1 |

- 合計 18 試行・11,993 秒（199.9 分）・126.66 USD。全試行 `attempt=1` / `rc=0` / `progressed=true`
- 壁時計: turn 1 開始 10-07 21:52 JST → turn 18 終了 10-08 01:13 JST（201 分）。試行の合計 199.9 分との差は約 1 分（BLOCKED・人間待ち 0）
- 権限拒否（permission_denials）: なし（18 試行すべて `[]`）
- 無進捗試行: 0
- 5 時間枠の使用率: 0.09 → 0.37（turn 14）→ 枠の切替で 0.04（turn 15）→ 0.10。7 日枠 0.22 → 0.28

ターン別（impl / verify）:

| turn | 内容                                 | 分   | USD   | 内部ステップ数 | 出力トークン | サブエージェント                 |
| ---- | ------------------------------------ | ---- | ----- | -------------- | ------------ | -------------------------------- |
| 3    | T1 照合列の拡張                      | 5.5  | 3.61  | 51             | 21,531       | なし                             |
| 4    | T2 宣言とノード属性の検証            | 15.8 | 8.83  | 103            | 54,122       | なし                             |
| 5    | T3 子 Instance の実行環境            | 15.3 | 8.92  | 99             | 55,516       | なし                             |
| 6    | T4 Instance 木と同梱ロード           | 7.6  | 4.77  | 61             | 32,684       | なし                             |
| 7    | T5 レイアウトの合成                  | 8.1  | 5.52  | 67             | 35,877       | なし                             |
| 8    | T6 dispatch のルーティング           | 12.2 | 5.88  | 70             | 39,665       | なし                             |
| 9    | T7 emit / listeners / config         | 11.4 | 6.38  | 72             | 37,609       | なし                             |
| 10   | T8 JS ローダー・エンジン・ランタイム | 13.4 | 7.75  | 26             | 10,272       | 2 本（A / B）                    |
| 11   | T9 デモ画面と Vitest                 | 8.8  | 7.04  | 29             | 8,912        | 2 本（A / B）                    |
| 12   | T10 候補のみ証跡と最終判定スクリプト | 9.6  | 5.74  | 20             | 6,510        | PROGRESS に記録なし（下記 推測） |
| 13   | T11 契約文書と追従                   | 13.8 | 8.81  | 33             | 10,782       | 2 本（A / B）                    |
| 14   | T12 最終判定と R10 の対応表          | 7.0  | 3.73  | 51             | 17,016       | なし                             |
| 15   | verify round 1（差し戻し 2 件）      | 15.6 | 15.56 | 86             | 61,308       | 2 本（読み取り専用）             |
| 16   | F1 子 emit キューの残留              | 7.5  | 3.89  | 69             | 21,287       | なし                             |
| 17   | F2 宣言の形の検査と軽微な追従        | 7.4  | 4.00  | 67             | 16,796       | なし                             |
| 18   | verify round 2（合格・push・PR #2）  | 8.6  | 5.59  | 67             | 28,576       | なし                             |

- 計画タスク数 / impl ターン数: 12 / 14（T1〜T12 が各 1 ターン + 差し戻し F1 / F2 の 2 ターン。追加・分割タスクなし。T8 / T9 / T11 で並列サブ作業 2 本）
- verify 差し戻し: 1 回（round 1 = 指摘 2 件。F1 は本物のバグ、F2 は軽微 5 点のまとめ。round 2 合格・残留リスク 9 件）/ BLOCKED: 0 回（`BLOCKED.md` の履歴は前マイルストーン以前のみ）
- 差し戻し以降（turn 16〜18）の合計: 23.5 分・13.48 USD（全体の 12% / 11%）
- 製品差分（`.gsd-lite/` 除く 30 ファイル +4,617 / −298）: Rust 製品 `composition.rs` +437・`lib.rs` +839 行の変更・`instance.rs` 71・`abi.rs` 13・`dynamic_ui.rs` 29、JS 製品 162、テスト 2,496（`composition_tests.rs` 1,773 / `components-loader.test.js` 449 / `components-demo.test.js` 236 / `abi.test.js` 38）、スクリプト 440、文書 297、デモ 126。管理文書 `.gsd-lite/` は 13 ファイル +1,578 / −562。PR #2 は 43 ファイル +6,195 / −860
- 前回の提案の反映（11 件）:
  - 守られた（6 件）: 照合列を PLAN 固定前に base へ流す（turn 2 で `turn-002-sequences-probe.mjs` を base に流し決めた事項 8 に写した。T1 は初回で差分 0、決めた事項 8 の訂正 0 件。前回は 5 点訂正）。research / plan の成果物を `bunx vp fmt`（turn 1「次への注意」、turn 3 の `check` 赤なし）。サブエージェント依頼文の禁止事項（PLAN「サブエージェントへの依頼文」、turn 10 / 11 / 13 で巻き戻し 0）。`git show HEAD:<path>`（PLAN「impl への注意」、turn 15 で使用）。`git diff -w --stat` の併記（T11 完了基準、turn 13 で `docs/README.md` 67 → 5 行）。段階 3 の research は残留リスク 1・2 を入力に（DECISIONS Round 2「照合列の拡張」、T1）
  - 済（1 件）: PR に `.gsd-lite/` を含めるかを discuss で聞く（DECISIONS 終了シーケンス「含める」）
  - 部分的（1 件）: verify のサブエージェントを観点別に分ける。PLAN「verify への申し送り」に観点 5 つは並んだが、round 1 の依頼は「コードレビュー」「セキュリティ」の 2 本のまま（PROGRESS turn 15）。コストは 15.56 USD で前回（11.41）より高い。ただし 2 本が独立に同じバグ（F1）を出した
  - 守られなかった（3 件）: PROGRESS の前ターン編集禁止と `git show` の 2 件は **PLAN メモには入ったがスキルには入っていない**（`git grep` で `.claude/skills/gsd-lite-impl/SKILL.md` に「前ターンのエントリ」「接尾辞」「git show HEAD」が 0 件。impl スキルの最終更新は d14dfeb = 10-06）。turn 13 で前ターン編集が再発（下記 Minus）。lean-ctx の project root（ループ運用側）は未修正で turn 15 / 18 と本 turn で回避が続く（下記 Minus）
  - 対象外（1 件）: turns.jsonl のサブエージェント分 usage（ループ側。本マイルストーンでも turn 10 / 11 / 13 の出力トークンが 8.9k〜10.8k でコストと釣り合わない）
  - 入口 `gsd-lite-loop.sh --where`: 18 ターンすべてで入口誤りの記録なし

## Plus（うまくいったこと）

- **無人 18 試行で権限拒否 0・リトライ 0・BLOCKED 0・無進捗 0・人間の介入コミット 0**。壁時計 201 分のうち試行外の空きは約 1 分。12 タスク + 修正 2 タスク + verify 2 ラウンドを 3.3 時間・126.66 USD で完走した（根拠: turns.jsonl 全行、`git log main...HEAD`）
- **plan が照合列を base WASM に流してから固定した結果、T1 は初回で差分 0、決めた事項 8 の訂正は 0 件**。前回（5 点訂正・サブエージェント A の取り直し）の原因がそのまま解消した（根拠: PROGRESS turn 2「やったこと」、turn 3「やったこと」、PLAN 決めた事項 8）
- **base `ef582d5` との照合が T1〜T12・F1 の 13 ターンすべてで「370 歩 44 列 差分 0」**、既存テストの期待値変更 0 件、`git diff main -- engine/src` の「削除のみの文字列リテラル」0 件を Rust を触るたびに同じターンで確かめた（P2）。verify round 1 の 98 ケース格子・round 2 の再確認もトラップ 0（根拠: PROGRESS turn 3〜9・14・16「次への注意」、VERIFICATION 受け入れ基準 2、`turn-015-strings.mjs`）
- **PLAN 訂正 9 件（T1 走査キー 7 種 / T2 48 件・11 件 / T3 arity と +14,142 バイト / T4 state object 検査 / T5 接頭辞 1 段ずつ / T6 `unknown_item` / T7 `commit_state` → `commit_event` / T8 `clock` 引数 / T10 layout 1 歩 / F1 7 関数 8 か所）がすべて「実測を正とした訂正」で根拠つきに記録され、verify が「要件・決定に触れていない」と判定した**（根拠: PROGRESS 各 turn「想定外 (1)」、VERIFICATION「文書の主張・期待値の変更」、turn 16「想定外 (1)」）
- **verify round 1 が本物のバグ（F1: 失敗した子 handler の emit が完了経路に残る）を見つけ、読み取り専用サブエージェント 2 本が独立に同じ指摘を出し、親が ABI で再現してから差し戻した**。F1 は 1 ターン（7.5 分・3.89 USD）で直り、round 2 は「格子の再確認 + 回帰」に範囲を固定して 8.6 分・5.59 USD で合格した（根拠: PROGRESS turn 15・16・18、VERIFICATION round 1 指摘 1、turns.jsonl）
- **F1 / F2 の impl が「修正前に新テストが落ちること」を確かめてから直した**（turn 16: `lib.rs` を一時的に戻して `a_stale_announcement…` が落ちるのを確認。turn 17: ガードを外して 2 本 fail → 復元）。前回の font-parity で定型化した「歯の確認」が差し戻しタスクで継続している（根拠: PROGRESS turn 16「想定外 (3)」、turn 17「次への注意」）
- **「次への注意」の連鎖が機能した**: turn 4「`"Component packages were not bundled"` は `Instance::load` の後ろ」→ turn 6 で位置を保って置換。turn 7 (a)〜(d) → turn 8 の `route` / `hidden_component` 再利用。turn 9 (b)「T8 はサブエージェント 2 本で並行できる」→ turn 10 で実施。turn 15「round 2 は回帰だけ」→ turn 18 で遵守（根拠: PROGRESS turn 4・6・7・8・9・10・15・18）
- **並列サブ作業（T8 / T9 / T11）3 ターンで `git checkout` 系の巻き戻し 0、親が `describe` を分けてマージ**。前回の提案 3 件（禁止事項・`git show`・結果はファイルに書く）が PLAN「サブエージェントへの依頼文」で効いた（根拠: PROGRESS turn 10・11・13、PLAN メモ）
- **最終判定スクリプトの所要が turn 12（63.1 秒）/ 14（58.5 秒）/ 15（58.1 秒）/ 18（60.7 秒）で一致**し、T12 は 7 分・3.73 USD で終わった。runner が揃っていると「最終判定」タスクは安い（根拠: PROGRESS turn 12・14・15・18、turns.jsonl turn 14）

## Minus（問題・無駄・やり直し）

- **turn 11（T9）のサブエージェントが `rm -rf .gsd-lite/logs/component-composition/scratch` を実行し、turn 1〜10 のプローブと証跡スクリプトを全部消した**（`turn-001-walk-probe.rs` / `turn-002-sequences-probe.mjs` / `turn-003-childkeys-probe.mjs` / `turn-003-revisions.mjs` / `turn-008-strings.mjs` / `turn-009-strings.mjs` と commit-msg 類）。PLAN 冒頭「入力」と PROGRESS turn 1〜9 が参照する根拠ファイルが本 reflect 時点で存在しない。PROGRESS turn 11 の「想定外」には書かれていない（根拠: `turn-011-attempt1.jsonl` の `Bash` 呼び出し `rm -rf …/scratch && ls …; git status --short`（description「Remove scratch directory」）、同ログのサブエージェント依頼文 79 行目「検証用スクリプトは scratch/ に置き、**終わったら消す**」、`ls scratch/` が turn-011 以降のみ）— 原因の見立て: 依頼文の「終わったら消す」が「自分のファイル」ではなく「ディレクトリ」に解釈された。スキルの「`mktemp -d` で作ったディレクトリはそのターン内で消す」（impl / plan / research / verify SKILL.md）が scratch にも及ぶ書き方になっている。`logs/` は gitignore なので消す必要自体がない。推測: verify turn 15 が `turn-015-strings.mjs` を新たに書いたのは、turn 8 / 9 の同等スクリプトが無かったため
- **F1（本物のバグ）は PLAN の完了基準の穴**: T6 / T7 は dispatch 経路しか完了基準に書かず、`progress_host` / `complete_*` 7 関数を合成画面で流すテストが無かった。REQUIREMENTS R10「どの応答状態でも」の 1 文が「dispatch × 完了経路」の格子に展開されていない（`git grep` で REQUIREMENTS / RESEARCH に `complete_` は受け入れ基準 6 の公開シグネチャ行のみ）。費用は turn 16〜18 の 23.5 分・13.48 USD（根拠: PROGRESS turn 18「次への注意 (a)」、VERIFICATION round 1 指摘 1「完了経路を合成画面で流すテストが無く、指摘 1 を素通りした」、turns.jsonl）— 原因の見立て: plan は R10 の 18 ケース（入力の異常）を網羅したが、「既存の入口（`dispatch` 以外の 7 本）× 新しい状態（子のキュー）」という直交表を作っていない。`Runtime` の `pub fn` 一覧（受け入れ基準 6 に列挙済み）を「新構造でも通る経路」として完了基準に 1 行ずつ写せば防げた
- **PROGRESS の前ターンのエントリ編集が turn 13 で再発**（「次への注意」を「次への注意（turn 12）」に書き換えて戻した。やり直し 1 回）。前回の提案 #4 は PLAN「impl への注意」には入ったが impl スキルには入っておらず、3 マイルストーン連続（font-parity turn 5・6、instance-refactor turn 5・6、本件 turn 13）（根拠: PROGRESS turn 13「やり直し」、`git grep` で `.claude/skills/gsd-lite-impl/SKILL.md` に該当句 0 件、同ファイルの最終更新 d14dfeb）— 原因の見立て: 提案が「スキルに入れる」なのに plan が PLAN メモへ写す形で処理し、スキル自体は誰も編集していない。reflect の提案のうち「スキルの改修」は discuss / plan では常にスコープ外になり、マイルストーンの外で実施する人がいない
- **lean-ctx 由来の回避が 5 マイルストーン連続**: turn 1「lean-ctx MCP 未接続」、turn 15「native `Read` が `composition.rs` に『unchanged since your last Read』を返し本文を出さない → `git show`」、turn 18「native `grep` が `.gsd-lite/PLAN.md` を『path escapes project root（root: `.../gsd-lite`）』で拒否 → `git grep`」、本 turn「`ctx_*` が ToolSearch で見つからず通常ツールで実施」（根拠: PROGRESS turn 1「想定外 (2)」、turn 15「想定外 (2)」、turn 18「想定外 (2)」、本 turn の実行記録）— 原因の見立て: 前回・前々回と同じ（フックの project root が別プロジェクトを指す）。恒常注意で回避できているが、verify のように「初読のファイルが読めない」のは回避策を知らないと止まる
- **PLAN の追従先チェックリストに `tests/browser/font-parity.mjs:1073`（`lib.rs` の xtype 許可リストを正規表現で読むテスト）が無く、T2 の `const XTYPES` 切り出しで `font-parity-runner.test.js` が落ちてから追加した**（根拠: PROGRESS turn 4「想定外 (1)」、PLAN 追従先チェックリスト「`validate` の xtype 固定リストの書き方を変える」行）— 原因の見立て: チェックリストは文書と scripts の `rg` で作られ、「ソースをテキストとして読むテスト」を探していない。`bunx vp test run` で即座に露見したので実害は小さい
- **ツール操作のやり直し 4 件**: turn 1 Rhai 予約語 `go`、turn 5 Rhai 予約語 `call`（PLAN「impl への注意」は `go` / `goto` だけ）、turn 4 `Instance` が `Debug` 未実装で `unwrap_err` がコンパイルエラー、turn 16 `Edit` の `replace_all` が新 helper の本体まで置換して自己再帰（根拠: PROGRESS turn 1・4・5・16「やり直し」）— 原因の見立て: 予約語は research が一覧を持っていれば 2 回目は防げた。`replace_all` は「新しく足した行にも当たるか」を見る習慣の問題
- **`gh pr create` が push 直後に「--head を付けよ」で abort**（やり直し 1 回）。verify スキルの例示コマンド（`SKILL.md:100`）に `--head` が無い（根拠: PROGRESS turn 18「想定外 (1)」、`git grep 'gh pr create' .claude/skills/gsd-lite-verify/SKILL.md`）— 原因の見立て: 推測: push 直後は `gh` がリモートブランチの存在を即時に解決できない。`--head <branch>` を常に付ければ消える

## Interesting（気づき・意外だったこと）

- **テストコード 2,496 行に対し製品コード（Rust + JS）は約 1,550 行で 1.6 倍**。前回（検査スクリプト 1,116 行 vs 製品 +373 / −312）・前々回（17 倍）と同じ傾向だが比率は下がり続けている。`composition_tests.rs` 1 本で 1,773 行・61 本（根拠: `git diff --stat main...HEAD`）
- **出力トークンが少ないターンほどコストが高い**: サブエージェントを使った turn 10 / 11 / 13 は 8.9k〜10.8k トークンで 7.0〜8.8 USD、前景のみの turn 6 / 7 は 32k〜36k トークンで 4.8〜5.5 USD。前回の「`usage` は親だけ、`cost_usd` はサブエージェント込み」の見立てと整合する。**turn 12（T10）は 20 ステップ・6,510 トークン・5.74 USD で同じ形だが、PROGRESS turn 12 にサブエージェントの記載が無い**（根拠: turns.jsonl、PROGRESS turn 12）。推測: turn 12 もサブエージェントを使ったが申し送りに書かれなかった
- **lib.rs を抱えたターンの cache_read が突出**: impl 14 ターンで 83.9M トークン（全体の 82%）。T2 / T3（`lib.rs` のシグネチャ変更と stub 表）は各 15 分・8.8〜8.9 USD で impl 中最高。T4〜T7 は同じ `lib.rs` を触って 4.8〜6.4 USD（根拠: turns.jsonl turn 4〜9）。推測: T2 で `validate` のシグネチャが全ファイルに波及したことが文脈量を押し上げた
- **WASM サイズは +87 KiB（4,499 → 4,586 KiB、+1.9%）**。T3 の PLAN 見積「10 KB 未満」は +14,142 バイトに外れたが、内訳（feature 2,499 / `AST::walk` 3,957 / 本体 7,686）を同ターンで分解して記録し、T5 +19 / T6 +11 / T7 +27 KiB と各ターンが増分を書いた（根拠: PROGRESS turn 5「想定外 (3)」、turn 6〜9「次への注意」）
- **verify round 2 の残留リスク 9 は F2 自身が作った**（F2 が足した JS 文言が `components.md:117` の列挙に無い）。差し戻し修正が契約文書との差を 1 件増やし、それを verify が「差し戻さない」と判定して次のマイルストーンへ送った（根拠: VERIFICATION 残留リスク 9、PROGRESS turn 18「次への注意 (d)」）
- **DECISIONS からの逸脱は 2 件とも plan が理由つきで決めた事項に書いた**: R2 の `HashMap` → `BTreeMap`（決めた事項 3「apply 順・エラー順を決定的に」）、拒否する宣言 6 種 → 7 種（`operations`。決めた事項 7）。verify はどちらも契約文書と一致を確認（根拠: PLAN 決めた事項 3・7、VERIFICATION 受け入れ基準 5）
- **PR #2 の 43 ファイル中 13 が `.gsd-lite/`（追加行の 26%）**。前回（25 中 15）と同じ構造だが、今回は discuss で「含める」と決めてある（根拠: `gh pr view 2`、`git diff --stat main...HEAD -- .gsd-lite`、DECISIONS 終了シーケンス）
- **5 時間枠が turn 14 → 15 の間で切り替わり（0.37 → 0.04）、18 試行で throttle なし**。前回（7 試行で 0.07 → 0.22）の約 2.5 倍の試行数でも 1 枠に収まる規模だった（根拠: turns.jsonl `rate_limit`）
- **verify round 1 の最初の再現プローブは順序違いで再現しなかった**（「子 handler 失敗 → root event → `http_result`」では root の `dispatch` が子キューも空にするため）。順序を「root event で http 要求 → 子 handler 失敗 → `http_result`」に直して再現した。バグの再現には「どの入口が何を空にするか」の知識が要った（根拠: PROGRESS turn 15「想定外 (1)」）
- 本 reflect 時点で PR #2 の CI（GitHub Pages の `build`）は IN_PROGRESS（16:13Z 開始）。前回と同じく CI の結果は記録に残らない（根拠: `gh pr view 2 --json statusCheckRollup`）

## 次回への提案（実行可能な形で）

- [ ] impl / plan / research / verify スキルの「無人ターンのシェルの作法」を「`mktemp -d` で作ったディレクトリはそのターン内で消す。**`.gsd-lite/logs/<slug>/scratch/` は消さない**（gitignore 済み。PLAN / PROGRESS / reflect が根拠として参照する）」に直し、impl スキルのサブエージェント依頼文テンプレートから「終わったら消す」を外す。あわせて依頼文に「`rm -rf` を使わない」を禁止事項として足す（Minus: turn 11 の scratch 全消去）
- [ ] plan の完了基準テンプレートに「新しい状態（キュー・キャッシュ・スコープ）を Runtime に足すタスクは、受け入れ基準の公開シグネチャ一覧（`dispatch` / `complete_*` / `progress_host` …）を 1 行ずつ『新構造で流すテスト』として完了基準に写す」を入れる。R10 型の入力異常の列挙だけでなく「既存の入口 × 新しい状態」の直交表を plan が作る（Minus: F1）
- [ ] **reflect の提案のうち「スキルを直す」ものは、次の discuss の冒頭で人間が『このマイルストーンの前にスキルを編集するか』を判断し、編集するなら discuss のターンで `.claude/skills/*/SKILL.md` を直してからループを開始する**。PLAN メモへの転記だけでは再発する（前回 #3 / #4 / #7 がスキル未反映で turn 13 再発）。具体的に今回入れる 3 行: 「前ターンのエントリは編集しない・固定項目名に接尾辞を付けない」「サブエージェント起動後は `git show HEAD:<path>` で読む」「native `Read` が『unchanged』を返したら `git show HEAD:<path>`」（Minus: PROGRESS 編集の再発、lean-ctx 回避）
- [ ] verify スキルの `gh pr create` の例示を `gh pr create --base <branch.base> --head <branch.name> --title … --body-file <file>` に変える（Minus: turn 18 の abort）
- [ ] research の成果物に「Rhai の予約語一覧（`go` / `goto` / `call` / `exit` / `match` / `case` / `public` / `private` / `new` / `use` / `with` / `module` / `package` / `super` / `spawn` / `thread` / `task` / `async` / `await` / `yield` / `default` / `void` / `null` / `nil` / `shared` / `var` / `static` / `is` / `as` ほか。正は rhai のソース）」を 1 行で置き、plan の「impl への注意」はその行を指す（Minus: `go` と `call` で 2 回のやり直し）
- [ ] plan の追従先チェックリストを作るとき、`rg -l '<変更するシンボル名>' tests/ scripts/` も流して「ソースをテキストとして読むテスト・スクリプト」を拾う（Minus: `font-parity.mjs:1073` の抜け）
- [ ] impl スキルの PROGRESS 申し送りに「サブエージェントを使ったら『やったこと』の先頭に本数と担当を書く（使わなければ『サブエージェントなし』）」を固定する。turns.jsonl からサブエージェントの有無が読めないので PROGRESS が唯一の記録になる（Interesting: turn 12 の記載なし）
- [ ] verify スキルの差し戻し（F 系）タスクの完了基準テンプレートに「契約文書に文言を足す・変えるときは、同じ文書の『文言の列挙』節にも足す」を 1 行入れる（Interesting: F2 が残留リスク 9 を生んだ）
- [ ] lean-ctx フックの project root をマイルストーンの外で直す（前回・前々回と同じ提案。5 マイルストーン連続）。直るまで verify スキルに「初読のファイルで native `Read` が本文を返さないときは `git show HEAD:<path>`」を入れる（Minus: lean-ctx 回避）
- [ ] 段階 4 以降の research は VERIFICATION 残留リスク 1（layout ごとの子スナップショットのコスト）・3（`file_bytes` の stub 不在）・9（JS 文言の未列挙）を入力にし、plan は `components.md:117` への 1 件追加を最初の文書タスクに含める（VERIFICATION 残留リスク）
