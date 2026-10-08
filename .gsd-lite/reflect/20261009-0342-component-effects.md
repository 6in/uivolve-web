# 振り返り — component-effects（2026-10-09 03:42）

- 種別: ループ（verify 合格後）、fix_round=0、verify_round=1（round 1 差し戻し 2 件（文書のみ）→ F1 → round 2 合格）
- 対象範囲: 49c8183（main）...9e0891c（30 コミット。discuss 98dc7ee 〜 verify の state 更新 9e0891c。人間の介入コミット 0 件）/ ターン 1〜16
- 範囲の説明: in-repo 形・リモート運用。`main` へ未マージで PR <https://github.com/6in/uivolve-web/pull/3> が OPEN（本 reflect 時点で CI `build` は IN_PROGRESS、`mergedAt` null）。本 reflect（turn 17）は未集計
- 前回の振り返り: 20261008-0114-component-composition.md（その前 20261007-1205-component-instance-refactor.md）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル         |
| -------- | -------- | ------ | ---------- | -------- | ------------ | -------------- | ------------- | ------------------------- |
| research | 1        | 1      | 13.5       | 0        | 57,182       | 3,646,221      | 12.42         | claude / claude-fable-5-1 |
| plan     | 1        | 1      | 15.6       | 0        | 74,221       | 2,978,684      | 10.60         | claude / claude-fable-5-1 |
| impl     | 12       | 12     | 185.1      | 0        | 421,348      | 99,340,852     | 106.15        | claude / claude-opus-5    |
| verify   | 2        | 2      | 14.9       | 0        | 32,446       | 5,007,130      | 18.22         | claude / claude-fable-5-1 |

- 合計 16 試行・13,743 秒（229.1 分）・147.39 USD。全試行 `attempt=1` / `rc=0` / `progressed=true`
- 壁時計: turn 1 開始 10-08 23:51 JST → turn 16 終了 10-09 03:41 JST（229.4 分）。試行の合計 229.1 分との差は約 0.3 分（BLOCKED・人間待ち 0）
- 権限拒否（permission_denials）: なし（16 試行すべて `[]`）
- 無進捗試行: 0
- 5 時間枠の使用率: 0.15 → 0.59（turn 16）。16 試行すべて同じ枠（`resets_at` が全行で同値）で throttle なし。7 日枠 0.33 → 0.39
- `commits` の合計 29 + discuss の 1 = `git log main...HEAD` の 30 件と一致（記録の矛盾なし）

ターン別（impl / verify）:

| turn | 内容                                       | 分   | USD   | 内部ステップ数 | 出力トークン | サブエージェント      |
| ---- | ------------------------------------------ | ---- | ----- | -------------- | ------------ | --------------------- |
| 3    | T1 http の `kind` と照合の正規化           | 13.2 | 6.92  | 101            | 37,670       | なし                  |
| 4    | T2 子の効果解禁・origin タグ・descriptors  | 21.9 | 14.89 | 145            | 75,053       | なし                  |
| 5    | T3 effect の `instance` と完了ルーティング | 20.8 | 10.41 | 110            | 71,631       | なし                  |
| 6    | T4 ルーティングの格子と堅牢性              | 16.3 | 7.00  | 70             | 62,161       | なし                  |
| 7    | T5 storage / files の子 scope              | 12.1 | 7.75  | 23             | 9,534        | 2 本（A / B）         |
| 8    | T6 layout スナップショットのキャッシュ     | 8.1  | 5.07  | 80             | 24,636       | なし                  |
| 9    | T7 JS 側のルーティング                     | 21.2 | 15.49 | 25             | 17,136       | 4 本（A / B / C / D） |
| 10   | T8 デモ parts-lab と Vitest                | 13.0 | 9.40  | 29             | 12,895       | 2 本（A / B）         |
| 11   | T9 probe の列と変異 M6 / M7                | 15.6 | 8.61  | 95             | 47,826       | なし                  |
| 12   | T10 契約文書の追従（10 ファイル）          | 26.1 | 13.20 | 64             | 18,363       | 2 本（A / B）         |
| 13   | T11 最終判定と総点検                       | 12.4 | 5.27  | 68             | 31,828       | なし                  |
| 14   | verify round 1（差し戻し 2 件・文書のみ）  | 10.9 | 14.60 | 19             | 14,388       | 2 本（読み取り専用）  |
| 15   | F1 契約文書の文言列挙の補完                | 4.2  | 2.14  | 47             | 12,615       | なし                  |
| 16   | verify round 2（合格・push・PR #3）        | 4.0  | 3.61  | 75             | 18,058       | なし                  |

- 計画タスク数 / impl ターン数: 11 / 12（T1〜T11 が各 1 ターン + 差し戻し F1 の 1 ターン。追加・分割タスクなし。T5 / T7 / T8 / T10 で並列サブ作業）
- verify 差し戻し: 1 回（round 1 = 指摘 2 件。どちらも `docs/components.md` の文言で、コード・テスト・最終判定・堅牢性格子・セキュリティは差し戻し事由 0 件。round 2 合格・残留リスク 6 件）/ BLOCKED: 0 回（`git log main...HEAD -- .gsd-lite/BLOCKED.md` が 0 件）
- 差し戻し以降（turn 15〜16）の合計: 8.2 分・5.75 USD（全体の 3.6% / 3.9%。前回は 23.5 分・13.48 USD = 12% / 11%）
- PROGRESS の「やり直し」合計 7 回（turn 4 が 2、turn 5 / 6 / 11 / 13 / 14 が各 1）に対し turns.jsonl のリトライは 0。すべてターン内で吸収された
- PLAN 訂正: 通算 13 件（PROGRESS turn 16。T1 2 / T2 4 / T3 3 / T4 4 / T7 1 / T9 4 / T10 2 / T11 3 / F1 1 の記載。重複を含む）。要件・決定の変更は 0 件
- 製品差分（`.gsd-lite/` と `.claude/` を除く 50 ファイル +4,349 / −706）: Rust 製品 7 ファイル +672 / −355（`lib.rs` +435 / −200）、JS 製品 9 ファイル +220 / −85、テスト +2,763 / −161（`composition_tests.rs` +1,606 / Vitest 新規 2 本 840 行 + 追記）、スクリプト +396 / −44（`probe-composition.mjs` +351）、文書 11 ファイル +139 / −54、デモ 6 ファイル +142。PR #3 は 68 ファイル +6,351 / −1,518
- 前回の提案の反映（10 件。DECISIONS 終了シーケンス「スキル編集」で discuss が 7 件をスキルに反映）:
  - 守られた（8 件）: scratch/ を消さない + `rm -rf` 禁止（5 スキルに入り、`scratch/` に turn-001 〜 turn-015 の 45 ファイルが残っている）。既存の入口 × 新しい状態の直交表（PLAN T4 の直交表。verify round 1 でコードの指摘 0 件）。スキルの改修を discuss で実施（98dc7ee で 5 スキル編集。PROGRESS の前ターン編集は 16 ターンで再発 0）。`gh pr create --head --body-file`（verify SKILL.md:100。turn 16 で abort なし）。Rhai 予約語の 1 行（research SKILL.md:61 / RESEARCH §3 / PLAN「impl への注意」。予約語起因のやり直し 0）。追従先に「ソースを読むテスト・スクリプト」（PLAN 追従先チェックリスト末尾の行）。PROGRESS にサブエージェントの本数と担当（impl SKILL.md:103。16 ターン全部が「サブエージェント N 本」か「なし」で始まる）。段階 4 の research は残留リスク 1・3・9 を入力に（REQUIREMENTS「research への入力」、RESEARCH §1.7 / §1.8、PLAN T10 完了基準）
  - 部分的（1 件）: verify のサブエージェントを観点別に分ける（前々回からの持ち越し）。PLAN「verify への申し送り」に観点 6 つが並んだが、round 1 の依頼はまた「コードレビュー」「セキュリティ」の 2 本（PROGRESS turn 14）。コストは 14.60 USD で前回（15.56）と同水準。A の MAJOR-1 は親が `git grep` で独立に見つけた同じ指摘で、A 固有の成果は MINOR-1（`host_progress` の例外）の 1 件
  - 却下（1 件）: F 系の完了基準に「文言の列挙節にも足す」（DECISIONS 終了シーケンス「今回は見送り」）。本編の T5 / T7 / T10 完了基準には同じ趣旨が入った（PLAN メモ #8「本編で先回り」）が、round 1 指摘 1 は結局その列挙の抜けだった（下記 Minus 1）
  - 対象外（1 件）: lean-ctx フックの project root（下記 Minus 4）
  - 入口 `gsd-lite-loop.sh --where`: 16 ターンすべてで入口誤りの記録なし

## Plus（うまくいったこと）

- **無人 16 試行で権限拒否 0・リトライ 0・BLOCKED 0・無進捗 0・人間の介入コミット 0**。壁時計 229 分のうち試行外の空きは約 0.3 分。11 タスク + 修正 1 タスク + verify 2 ラウンドを 3.8 時間・147.39 USD で完走した（根拠: turns.jsonl 全行、`git log main...HEAD`）
- **verify round 1 でコードの指摘が 0 件**。読み取り専用サブエージェント 2 本 + 親の ABI 堅牢性格子 315 ステップ（トラップ 0）+ 最終判定 exit 0 で、差し戻しは文書の文言 2 件だけに収まった。前回の提案 #2（既存の入口 × 新しい状態の直交表）を T4 `completion_grid`（7 チャネル × 6 列、各セルで全 Instance の state・revision・pending の不変を確認）として plan が採用した結果と読める（根拠: VERIFICATION round 1「コードレビュー」「ABI の堅牢性格子」、PLAN T4 直交表、PROGRESS turn 6）
- **差し戻しの修正サイクルが 8.2 分・5.75 USD（3.6% / 3.9%）**で、前回（23.5 分・13.48 USD = 12% / 11%）の 1/3 以下。verify round 2 が「F1 の差分の回帰 + round 1 の格子の再実行」だけに範囲を固定し、サブエージェントなしで 4.0 分・3.61 USD で合格した（根拠: turns.jsonl turn 15・16、PROGRESS turn 14「次への注意」、turn 16）
- **base `49c8183` との照合が Rust を触った全ターン（T1〜T6・T8）で「370 歩・差分 0」、既存テストの期待値変更は 3 見出しに列挙した分（`kind` 起因 1 件 / arity 起因 3 ファイル 6 箇所 / 撤去起因 5 本）だけ**。`git diff main -- engine/src` の「削除された文字列リテラル」を T2 / T3 で全部列挙して残存を実測し、`MUTATIONS` の `from` が各 1 回であることを T3 / T6 / T9 で scratch スクリプトで確かめた（根拠: PROGRESS turn 3〜8・10「検証」、`scratch/turn-004-mutation-anchors.mjs` / `turn-005-…` / `turn-011-mutation-from.mjs`）
- **前回の提案 10 件のうち 8 件が守られ、7 件はスキル本体に入った**（discuss 98dc7ee）。3 マイルストーン連続だった PROGRESS の前ターン編集は 0 回、scratch 全消去は 0 回、`gh pr create` の abort は 0 回、Rhai 予約語のやり直しは 0 回（根拠: 上の「前回の提案の反映」、`git grep` で 5 スキルに該当句、`ls scratch/`、PROGRESS turn 16「想定外: なし」）
- **並列サブ作業 4 ターン（T5 2 本 / T7 4 本 / T8 2 本 / T10 2 本）で巻き戻し 0・競合 0**。turn 7 で「共有テーブルは親が起動前に確定させ、両者に『内容を変えるな』と渡す」「サブエージェントに `bun run build:wasm` / `cargo` / 全体 Vitest を禁止し親がまとめて回す」を定め、turn 9 / 10 / 12 がそれを引き継いだ。サブエージェントの『契約外の提案』11 件（T8 7 件 / T10 4 件）は親が 1 件だけ採用し残りを落として、PROGRESS に件数と内容を残した（根拠: PROGRESS turn 7「想定外 (1)(3)」、turn 9・10・12「やったこと」「想定外 (4)」）
- **PLAN 訂正 13 件がすべて「実測を正とした訂正」で根拠つきに PLAN と PROGRESS の両方に記録され、verify が「要件・決定に反しない」と判定した**。特に T1 の「応答のキー順はアルファベット順（`preserve_order` 無し）」は T2 / T3 の 3 か所へ同ターンで波及させた（根拠: PROGRESS turn 3「想定外 (1)」、PLAN T1 / 決めた事項 1、VERIFICATION「文書の主張」）
- **「次への注意」の連鎖が機能した**: turn 5「T4 の fixture は `routing(listener)` をそのまま使える」→ turn 6 で新 fixture を作らず流用。turn 7「T10 の文言追従が 1 件増えた」→ turn 9 で 2 件に積み上げ → turn 12 で 2 件とも反映。turn 10「`note-pad` の `init` が `storage_read` を積む」→ turn 11 で片付けステップを追加。turn 12「T11 は ignorePatterns を先に直す」→ turn 13 で実施。turn 14「round 2 は回帰だけ」→ turn 16 で遵守（根拠: PROGRESS 各 turn）
- **F1 が 4.2 分・2.14 USD で最も安い impl ターン**。差分は文書 1 ファイル 2 行で、追従先チェックリストの再実測を 11 条件すべて書き出して終えた（根拠: turns.jsonl turn 15、PROGRESS turn 15「追従先チェックリストの再実測」）

## Minus（問題・無駄・やり直し）

- **round 1 差し戻しの指摘 1 は、PLAN T10 の完了基準に文言ごと書いてあった項目の実装漏れ + T11 の再確認漏れ**。PLAN T10 完了基準は「日本語（`:117` の列挙に追加）: `コンポーネント {名前} の宣言が不正です（url を文字列で指定してください）`」と明記し、追従先チェックリスト「JS の日本語文言を足す」行は `git grep -n -F '宣言が不正です' -- docs/components.md` が 1 件という機械的条件まで持っていた。しかし T10（turn 12）のサブ作業 A はこの 1 文言を落とし、親の「追従先チェックリストの再確認」は 3 条件だけを回し、T11（turn 13）の「最終確認」は 11 行の表のうち 9 条件を再実測してこの行を飛ばした。差し戻し全体（turn 14 の一部 + turn 15 + turn 16）で 8.2 分・5.75 USD + verify round 1 の分（根拠: PLAN T10 完了基準・追従先チェックリスト 10 行目、PROGRESS turn 12「追従先チェックリストの再確認」、turn 13「追従先チェックリストの最終確認（9 条件すべて成立）」、VERIFICATION round 1 指摘 1、PROGRESS turn 16「次への注意」）— 原因の見立て: 「全行再実行」が完了基準に書かれていても、行の数を数えて突き合わせる手順が無いと抜けが見えない。T11 は「9 条件すべて成立」と書いて合格扱いにしたが、表は 11 行だった。前回却下した提案 #8（文言の列挙節への追記）と同じクラスの抜けが、F 系ではなく本編の T10 で起きた
- **`bun run check` が turn 3 から turn 13 まで赤のままで、最終判定スクリプトが T11 まで一度も回せなかった**。原因は discuss 98dc7ee で入った `.claude/skills/gsd-lite-{impl,plan,research}/SKILL.md` 3 件の整形違反 + ループが毎ターン書き直す `state.json` の配列展開。T1 で発見し、PLAN は「本マイルストーンでは green にならない。T11 で直す」と先送りした結果、T9 は `verify-instance-refactor.mjs` を回せず変異 4 本を手で確かめ（PLAN 訂正 3）、照合側の変異 M1〜M3 の exit 1 は T11 が初回になった。T11 では PLAN が推奨した `.gsd-lite/**` の除外が受け入れ 9（`.gsd-lite/*.md` の `vp fmt` 済み確認）と両立せず、`vite.config.js` を書き直して最終判定を 2 回実行した（やり直し 1 回）（根拠: PROGRESS turn 3「想定外 (2)」「次への注意」、turn 11「PLAN 訂正 (3)」、turn 13「やり直し」「想定外 (1)」、PLAN「検証コマンド」）— 原因の見立て: 前回提案 #3（discuss でスキルを編集）を実施したとき、discuss がスキルファイルを整形せずコミットした。前々回の提案 #2「research / plan の成果物を `bunx vp fmt`」はスキルに入ったが、discuss のスキル編集ステップには同じ手順が無い。`state.json` の方はループ側の出力形式とフォーマッタの衝突で、マイルストーンの中では毎ターン再発する
- **PLAN 訂正が同じ PLAN 内の後続タスクへ伝播せず、後のターンが古い条件を再発見した例が 2 件**。(a) T2（turn 4）が `rejectSequences` を `effectSequences` に置き換え済みなのに、T9 の完了基準は「`rejectSequences` を削除」のままで、turn 11 が「既に無い」と訂正した。(b) T3（turn 5）で `^-.*pub fn` の条件を「2 行だけ」に直し追従先チェックリスト 4 行目も同ターンで直したが、T11 完了基準の「0 行」は残り、turn 13 が再訂正した（根拠: PROGRESS turn 11「PLAN 訂正 (1)」「想定外 (1)」、turn 13「PLAN 訂正 (2)」「想定外 (2)」、PLAN T9 / T11 の訂正注記）— 原因の見立て: PLAN 訂正を書くとき、同じ条件文字列が PLAN の他の行にも無いかを検索していない。T2 の場合は PLAN 作成時点で T2 と T9 の記述が互いに矛盾していた（plan の内部整合の問題）
- **lean-ctx 由来の回避が 6 マイルストーン連続で、PROGRESS に「MCP 未接続」が 13 回書かれた**。本 turn も `ctx_*` が ToolSearch で見つからず通常ツールで実施（根拠: `git grep -c MCP -- .gsd-lite/PROGRESS.md` = 13、PROGRESS turn 1〜16、本 turn の実行記録）— 原因の見立て: 前回・前々回と同じ（フックの project root が別プロジェクトを指す）。reflect スキルには「未接続であることは PROGRESS に書かなくてよい」が入ったが、impl / plan / research / verify スキルには入っておらず、毎ターン同じ 1 文が並ぶ。振り返りの材料にならない行が PROGRESS の各エントリを長くしている
- **PLAN が名指ししたエラー文言・経路のうち到達不能だったものが 3 件**。(a) T4 (d)「`State exceeds 1 MB` 系」は Rhai の `set_max_string_size(100_000)` が先に効いて到達しない（turn 6 やり直し 1 回）。(b) T7 の `HostEffects` の path ごとの `同時ホスト操作は8件までです` はエンジンの `At most 8 pending host calls` に先を越され WASM 経由では到達しない（host 自作 effect 用の防壁として実装）。(c) `completeDialog` の第 3 引数には本番の呼び出し元が無い（ABI 対称性のためだけに実装）（根拠: PROGRESS turn 6「想定外 (1)」、turn 9「想定外 (3)(4)」）— 原因の見立て: plan が文言を `git grep` で引いた行番号だけで書き、その文言より手前にある防壁（Rhai の上限、エンジン側の上限）を見ていない。(b)(c) は実装して文書化する判断を impl が行ったが、要件には無い防壁と引数が製品に残った
- **文書だけのタスク T10 が 26.1 分・13.20 USD で本マイルストーン最長のターン**。サブエージェント 2 本に渡した断言 18 本 / 9 本を親が `engine/src` / `src` に突き合わせ直し、A が返した断言の誤り 1 件（`Invalid components` → `Invalid descriptors`）と PLAN の対象漏れ 1 件（`docs/ai-development.md:26` が実装と真逆の生成指示）を親が自前の `git grep` で見つけた（根拠: turns.jsonl turn 12、PROGRESS turn 12「断言の照合」「想定外 (1)(2)」）— 原因の見立て: 追従先チェックリストの `git grep` 条件は `kind` 省略と「19個|宣言7種|…」の 2 本で、「同期のみ」「段階4以降」という言い回しを拾えなかった。文書追従の対象を決めるとき、旧契約の言い回しを `docs/` 全体で引く手順が無い
- **verify round 1 の自作プローブが 1 回目に 280 problems で落ちた**（全部スクリプト側のバグ。「他 Instance を名乗る」列に id の持ち主自身を含めていた）（根拠: PROGRESS turn 14「想定外 (1)」）— 原因の見立て: 格子の列を組むときに「所有者を除く」を書き忘れた。やり直し 1 回で済み、エンジン側の問題ではない

## Interesting（気づき・意外だったこと）

- **テストコード +2,763 行に対し製品コード（Rust + JS）は +892 行で 3.1 倍**。前回 1.6 倍、前々回 3 倍、その前 17 倍。`composition_tests.rs` 1 本で +1,606 行（格子・ルーティング・scope・キャッシュの 4 節、Rust テスト 61 → 90 本）。probe スクリプトも +351 行で、検証資産がコードの 4 倍近い（根拠: `git diff --numstat main...HEAD`）
- **WASM サイズは T1 4,586 → T2 4,589 → T3 4,596 → T5 4,597 → T6 4,587 KiB で、差し引き +1 KiB**。子でも効果 7 モジュールを登録する分（+3）と完了ルーティング（+7）を、段階 3 の stub 19 個と `AST::walk` の撤去と T6 の `Rc::new` の単態化の寄せ（−10）がほぼ相殺した。PLAN は T6 を「増減なし」と見込んでいた（根拠: PROGRESS turn 3〜8「検証」、turn 8「想定外 (1)」）
- **`State exceeds 1 MB` は Rhai の handler からは到達不能**。Rhai の `set_max_string_size(100_000)` / 配列 10,000 / map 32,000 が先に効くため、`check_state` の 1 MB は第 2 の防壁。実測の文言は `Length of string too large`（根拠: PROGRESS turn 6「想定外 (1)」）
- **サブエージェントを使ったターンは出力トークンが少なくコストが高い**: T7（4 本）は 25 ステップ・17k トークンで 15.49 USD、T10（2 本）は 64 ステップ・18k で 13.20 USD、T5（2 本）は 23 ステップ・9.5k で 7.75 USD。前景のみの T6 は 80 ステップ・25k で 5.07 USD。前回・前々回の「`usage` は親だけ、`cost_usd` はサブエージェント込み」の見立てと整合する（根拠: turns.jsonl）
- **T2 と T3 が impl の所要・コストの上位**（21.9 分・14.89 USD / 20.8 分・10.41 USD）で、どちらも `lib.rs` のシグネチャ変更と借用の波及（T2 の `&dyn Fn` の寿命省略、二重前置の `Blame` 導入）。impl 12 ターンの cache_read 99.3M トークンは全体の 89.5%（根拠: turns.jsonl turn 4・5、PROGRESS turn 4「想定外 (1)(2)」「やり直し」）
- **前回却下した提案 #8（契約文書の文言列挙節への追記）と同じクラスの抜けが round 1 の指摘 1 になった**。却下の理由は「F 系のテンプレートの話」で、本編には T5 / T7 / T10 で先回りしてあったが、本編の方で漏れた。列挙節の drift は 2 マイルストーン連続（前回は F2 が残留リスク 9 を作り、今回はそれを直す指示を T10 が落とした）（根拠: DECISIONS 終了シーケンス、PLAN メモ #8、VERIFICATION round 1 指摘 1）
- **discuss でのスキル編集（前回提案 #3 の実施）が、そのまま `bun run check` の赤の原因になった**。提案を守った副作用が次の Minus を生んだ形で、提案の実施手順に整形が無かった（根拠: PROGRESS turn 3「想定外 (2)」が 98dc7ee を名指し）
- **`bunx vp check <単一の Markdown>` は整形 pass でも lint 対象 0 件で非 0 終了する**。turn 12 と turn 15 の 2 回別々に発見され、F1 の PLAN 訂正で初めて記録された。T10 の「検証」では整形 stage だけで判定していたが、PLAN には書かれていなかった（根拠: PROGRESS turn 12「想定外 (3)」、turn 15「想定外」）
- **`docs/ai-development.md:26` が「子に通信・保存・ダイアログを書くコードを生成しない」と実装の逆を AI に指示していた**。追従先チェックリストの `git grep` 条件 2 本のどちらにも掛からず、親が自前で `段階4以降|効果関数を持たず` を引いて見つけた。AI への生成指示文書は契約文書より見落とされやすい（根拠: PROGRESS turn 12「想定外 (1)」）
- **T7 の「既存テストは無改修で通る」は 3 ファイル 6 箇所で不成立**（完了コールバックの arity 2 → 3）。impl は arity を増やさない書き方を取れたが「契約を曲げる」として期待値側を直した。verify はこれを「契約そのままの値」と判定（根拠: PROGRESS turn 9「PLAN 訂正」「想定外 (1)」、VERIFICATION 受け入れ基準 1）
- **5 時間枠が 16 試行すべて同じ枠（0.15 → 0.59）に収まり、throttle なし**。前回は 18 試行で枠の切替が 1 回（根拠: turns.jsonl `rate_limit`）
- 本 reflect 時点で PR #3 の CI（GitHub Pages の `build`）は IN_PROGRESS（18:41Z 開始）。前回・前々回と同じく CI の結果は記録に残らない（根拠: `gh pr view 3 --json statusCheckRollup`）

## 次回への提案（実行可能な形で）

- [ ] impl スキルの「最終判定」型タスク（T11 相当）の完了基準に「追従先チェックリストを**行番号つきで全行**再実行し、PROGRESS に『行 1 … 行 N』の表で結果を書く。表の行数が PLAN の表と一致しなければそのタスクは未完了」を固定する。plan は追従先チェックリストの各行に連番を振る（Minus 1: 11 行中 9 条件で「すべて成立」と書いて抜けた）
- [ ] impl スキルの並列サブ作業の手順に「サブエージェントの成果物をマージした直後、そのタスクの完了基準に出てくる `git grep` / `rg` 条件を**親が全部**再実行してから PROGRESS を書く」を 1 行入れる（Minus 1: turn 12 の再確認が 3 条件だけだった）
- [ ] discuss スキルの「スキル編集」ステップに「編集した `.claude/skills/**/SKILL.md` を `bunx vp fmt <path>` で整形し、`bun run check` 相当が green であることを確かめてからコミットする」を入れる。あわせて gsd-lite のループ側で、`state.json` をフォーマッタの ignore に入れる設定（本リポジトリでは `vite.config.js` の `fmt.ignorePatterns` に `.gsd-lite/state.json`。turn 13 で対応済み）をマイルストーン開始前の `--check` で確かめる（Minus 2: `bun run check` が 11 ターン赤のまま）
- [ ] impl スキルの「PLAN 訂正」の手順に「訂正した条件・名前の**旧文字列**を `git grep -n -F '<旧文字列>' -- .gsd-lite/PLAN.md` で引き、後続タスクの完了基準・追従先チェックリストに残る同じ条件を同じターンで直す」を入れる。plan スキルには「あるタスクが置き換える・削除するシンボル名を、後続タスクの完了基準で『削除する』と書かない（置き換え後の名前で書く）」を入れる（Minus 3: `rejectSequences` と `0 行` の再訂正）
- [ ] plan スキルの完了基準の書き方に「エラー文言を名指しするときは、その文言より手前で効く防壁（スクリプトエンジンの上限、エンジン側の同種の上限）が無いことを `git grep` で確かめ、あれば『到達する文言』の方を書く。要件に無い防壁・引数（到達不能な上限、呼び出し元の無い引数）は実装せず、plan の段階で落とすか DECISIONS に理由を書く」を入れる（Minus 5: `State exceeds 1 MB` / `HostEffects` の path ごとの上限 / `completeDialog` 第 3 引数）
- [ ] plan スキルの追従先チェックリストの作り方に「旧契約の**言い回し**（『同期のみ』『〜は持たず』『段階 N 以降』『従来の〜』等、旧仕様を肯定的に述べる句）を `docs/ README.md .claude/` 全体で `git grep` し、ヒットした文書を追従先に足す。AI への生成指示文書（`docs/ai-development.md` 相当）は常に追従先に含める」を入れる（Minus 6: `ai-development.md` の逆指示、T10 が最長ターン）
- [ ] impl / plan / research / verify スキルの PROGRESS 申し送り形式に、reflect スキルと同じ「lean-ctx 等の MCP が未接続であることは『想定外』『次への注意』に書かない」を入れる。lean-ctx フックの project root はマイルストーンの外で直す（6 マイルストーン連続。Minus 4）
- [ ] verify スキルのサブエージェント依頼を、汎用「コードレビュー」から「契約文書 ↔ 実装の一対一（追従先チェックリストの全行 + 文言列挙節 + 各 op の例外）」の 1 本に差し替える（セキュリティの 1 本は現状維持）。3 マイルストーンで汎用レビューが親と独立に見つけた指摘は F1（前回）と MINOR-1（今回）だけで、今回の MAJOR-1 は親の `git grep` と重複した（部分的 1 件、3 回目の持ち越し）
- [ ] impl スキルの並列サブ作業の手順に turn 7 の運用を固定する: 「複数のサブ作業が同じファイル（テーブル・fixture・文言）に依存するときは、親が起動前にそのファイルを確定させて『内容を変えるな』と渡す。サブエージェントには `bun run build:wasm` / `cargo` / 全体の Vitest（共有の生成物を触るコマンド）を禁止し、親が統合後にまとめて回す」（Plus: T5 / T7 / T8 / T10 で巻き戻し 0。スキル未反映）
- [ ] plan スキルの「検証コマンド」節に「`bunx vp check` に Markdown だけを渡すと整形 pass でも lint 対象 0 件で非 0 終了する（整形 stage の出力で判定し、exit code は `bun run check` で見る）」をこのリポジトリの注意として書く（Interesting: turn 12 / 15 で 2 回発見）
- [ ] 段階 5 以降の research は VERIFICATION 残留リスク 1（`Unknown component instance` に長い文字列がそのまま載る。`instance` の長さ上限）・3（`配送先が未登録です` の経路に自動テストが無い）・5（配送先が無いとき WASM の pending が残る）を入力にし、plan は 3 の 1 本（`onError` に落として `complete` を呼ばない契約の固定）を最初のテストタスクに含める（VERIFICATION 残留リスク）
