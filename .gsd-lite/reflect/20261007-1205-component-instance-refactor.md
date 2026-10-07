# 振り返り — component-instance-refactor（2026-10-07 12:05）

- 種別: ループ（verify 合格後）、fix_round=0、verify_round=1（差し戻し 0 回・初回合格）
- 対象範囲: 35120e0（main）...22ce97f（13 コミット。discuss c1bbdbc 〜 verify の state 更新 22ce97f。人間の介入コミット 0 件）/ ターン 1〜7
- 範囲の説明: in-repo 形・リモート運用。ブランチは `main` へ未マージで PR <https://github.com/6in/uivolve-web/pull/1> が OPEN（本 reflect 時点で CI `build` は IN_PROGRESS、`mergedAt` null）。本 reflect（turn 8）は未集計
- 前回の振り返り: 20261007-0457-renderer-font-size-parity.md（その前 20261005-1200-development-retrospective-blog.md）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル         |
| -------- | -------- | ------ | ---------- | -------- | ------------ | -------------- | ------------- | ------------------------- |
| research | 1        | 1      | 13.2       | 0        | 50,387       | 3,727,274      | 7.27          | claude / claude-fable-5-1 |
| plan     | 1        | 1      | 10.7       | 0        | 47,459       | 2,064,994      | 6.03          | claude / claude-fable-5-1 |
| impl     | 4        | 4      | 56.4       | 0        | 83,256       | 22,208,484     | 28.27         | claude / claude-opus-5    |
| verify   | 1        | 1      | 11.8       | 0        | 13,089       | 2,211,273      | 11.41         | claude / claude-fable-5-1 |

- 合計 7 試行・5,526 秒（92.1 分）・52.98 USD。全試行 `attempt=1` / `rc=0` / `progressed=true`
- 壁時計: turn 1 開始 10:31 JST → turn 7 終了 12:03 JST。試行間の空きは最大 2 秒（BLOCKED・人間待ち 0）
- 権限拒否（permission_denials）: なし（7 試行すべて `[]`）
- 無進捗試行: 0
- 5 時間枠の使用率: 0.07 → 0.22。7 日枠 0.17 → 0.20

ターン別（impl / verify）:

| turn | 内容                             | 分   | USD   | 内部ステップ数 | サブエージェント     |
| ---- | -------------------------------- | ---- | ----- | -------------- | -------------------- |
| 3    | T1 照合 script + 変種ビルド      | 23.0 | 11.16 | 29             | 2 本（A / B）        |
| 4    | T2 Runtime → Instance リファクタ | 13.8 | 7.31  | 101            | なし                 |
| 5    | T3 設計文書 + 追従 4 か所        | 13.8 | 6.53  | 40             | 2 本（A / B）        |
| 6    | T4 最終判定 runner + 全検査      | 5.9  | 3.28  | 54             | なし                 |
| 7    | verify round 1（合格）           | 11.8 | 11.41 | 24             | 2 本（読み取り専用） |

- 計画タスク数 / impl ターン数: 4 / 4（追加・分割タスクなし。T1 / T3 で並列サブ作業 2 本、T2 / T4 は前景のみ）
- verify 差し戻し: 0 回（指摘 0 件、残留リスク 4 件を理由つきで記録）/ BLOCKED: 0 回（`BLOCKED.md` の履歴は前マイルストーンの退避 c1bbdbc のみ）
- 製品差分: `engine/src/instance.rs` +224、`engine/src/lib.rs` +149 / −312。検査スクリプト 3 本 +1,116（compare 759 / build-variant 143 / runner 214）。文書 +215（`components-plan.md` 147 + 追従）。`tests/` `src/` `abi.rs` の差分 0
- 前回の提案の反映（11 件）:
  - 守られた（7 件）: 変異表を検査タスクの完了基準に入れる（PLAN T1-4 / T2-5 / T4-1、M1〜M3 が 3 ターンで exit 1）。並列サブ作業を最終タスクに置かず gate は前景（T4 サブエージェントなし、`claude -p` の 600 秒打ち切りは 0 回）。台帳規約「生の値は証跡 JSON を指す」（T3-6 / T4-3、VERIFICATION が `components-plan.md` に実測値なしを確認）。runner が手順別所要と合計を出す（`verify-instance-refactor.mjs`、turn 6 = 36.1 秒 / turn 7 = 37.2 秒で記録が一致）。research に画面 × 部品 × 非同期の一覧（RESEARCH §2、22 画面）。恒常注意と固有注意の分離（PROGRESS 冒頭 3 行）。検査ファイルを役割で分ける（3 本）。push の要否を discuss で聞く（DECISIONS「リモート運用」、`origin` 追加、PR #1）
  - 該当なし（2 件）: 実ブラウザ起動プローブ（本件はブラウザ不要と DECISIONS に明記）。verify の「要確認」付与（指摘 0 件で転記が発生しなかった）
  - 守られなかった（1 件）: lean-ctx フックの project root 修正。REQUIREMENTS「スコープ外: ループやスキルの改修」で対象外にし、恒常注意で回避した。turn 1 / 2 / 7 と本 turn で `cat` 拒否が再発（下記 Minus）
  - 入口 `gsd-lite-loop.sh --where`: 7 ターンすべてで入口誤りの記録なし（前回は Codex 3 ターンで誤り、Claude 18 ターンで 0 件。今回は全ターン Claude）

## Plus（うまくいったこと）

- research が照合の仕組みそのものを実測で先に確かめた（base を worktree でビルド → 230 応答で差分 0、同一 WASM 2 インスタンスで差分 0、変異で差分 137、同一ソースの sha256 が 3 回とも違う）。その雛形 `scratch/turn-001-compare.mjs` が T1 の設計の土台になり、「WASM のバイト比較は使えない」が plan の前提に入った（根拠: RESEARCH §3、PLAN「盗める点」採用行、PROGRESS turn 1）
- RESEARCH の落とし穴 P1〜P14 を PLAN の表で担当タスクへ対応付け、T1〜T4 の完了基準に書かれた検証が実際にその箇所で効いた（P14: 変異コピーに `public/themes` を含める → T1 で compile error なし。P7: 変異 M1〜M3 が T1 / T2 / T4 の 3 回とも exit 1。P9: `okResponses` / `errorResponses` を集計し、T2 / T3 / T4 / verify で 4 値 346 / 325 / 21 / 41 が完全一致）（根拠: PLAN「落とし穴の対応」、PROGRESS turn 3〜7）
- T2 の挙動不変リファクタが 1 ターン・1 回のやり直し（E0609 6 件）で完了し、照合 `diffs = 0`、エラー文字列集合の差 0（199 / 61）、数値リテラル多重集合一致、`abi.rs` 無改修、`pub fn` 行差分 0 まで同じターンで確かめた（根拠: PROGRESS turn 4「完了基準の根拠」①〜⑧、コミット 1169590）
- PLAN 訂正が「訂正（turn N / 実測）」の形で 4 か所に積まれ、verify がそれを根拠に照合して合格した。要件・決定は 1 字も変えていない（根拠: PLAN T1 直下・決めた事項 8・9・追従先チェックリスト、VERIFICATION「文書の主張・期待値の変更」）
- 前回の提案 7 件が plan の「直近 2 件の振り返りの採否」表で採否と理由つきで処理され、対象外も理由が書かれた（根拠: PLAN メモ、DECISIONS「過去の振り返りの採否」）
- 無人 7 試行で権限拒否 0・リトライ 0・BLOCKED 0・無進捗 0。前回（22 試行・8.1 時間・337 USD・差し戻し 2 ラウンド）に対し 7 試行・1.5 時間・53 USD・差し戻し 0（根拠: turns.jsonl、前回振り返りの計測表）
- 各ターンの「次への注意」が次のターンで実際に使われた: turn 3 の「M1 の `from` が動く」→ turn 4 で的中し訂正 1 行で済んだ。turn 4 の「`git checkout` 系を使わない / `bunx vp fmt <path>`」→ turn 5 のサブエージェント依頼に入り巻き戻し再発なし。turn 5 の「script と文書を先にコミットしてから gate」→ turn 6 でそのとおり実施（根拠: PROGRESS turn 3〜6）
- 最終判定の所要が turn 6（36.1 秒）と turn 7（37.2 秒）でほぼ一致し、前回の「所要の食い違い 8 件」が解消した（根拠: PROGRESS turn 6「手順別所要」、turn 7「やったこと」）

## Minus（問題・無駄・やり直し）

- **PLAN 決めた事項 8（追加シーケンス）が実物と 5 点食い違い、T1 でサブエージェント A への追加依頼と実測の全取り直しが発生**（`host_result.data` が `null` だと handler が throw、`file-result` の `busy()` 共有、Rhai 予約語 `go`、不正 script の検証順、`theme` の前に `load`）。さらに verify が残留リスクとして「`rpc-result` 列が handler 経路に届かない」「`handlerNodes` が `menu` / `bbar` / `tbar` / `buttons` を走査しない」を見つけた（根拠: PROGRESS turn 3「想定外 (4)」「やり直し (b)」、PLAN 決めた事項 8 訂正 5 件、VERIFICATION 残留リスク 1・2）— 原因の見立て: plan が 15 本のシーケンスを code reading だけで書き、base WASM に 1 度も流していない。research の雛形 `turn-001-compare.mjs` と base WASM は手元にあったので、plan の段階で「各シーケンスが Rhai handler まで届く（応答が `ok` で effects が出る）」を確かめる手段はあった
- **T1 の `bun run check` が、research / plan が整形せずにコミットした `.gsd-lite/{DECISIONS,PLAN,RESEARCH}.md` で赤くなり、impl が管理文書 3 本を `bunx vp fmt` で整形した**（e151285 に `.gsd-lite/` の差分 285 行が混ざる）（根拠: PROGRESS turn 3「想定外 (1)」、`git show --stat e151285`）— 原因の見立て: oxfmt の対象に `.gsd-lite/*.md` が含まれるのに、research / plan スキルの手順に「コミット前に `bunx vp fmt <path>`」が無い。impl が最初に `check` を回すターンで必ず露見する構造
- **サブエージェント A が自分の作業後に `git checkout -- .gsd-lite/` を打ち、親の整形を巻き戻した**（やり直し 1 回）（根拠: PROGRESS turn 3「想定外 (2)」）— 原因の見立て: 依頼文に禁止事項（`git checkout` / `git restore` / `git stash`）が無かった。turn 4 の申し送りで明文化され、turn 5 では再発していない
- **turn 5 と turn 6 が連続して前ターンの PROGRESS 見出し「次への注意」を「次への注意（turn N → …）」に書き換え、固定項目名を壊して戻した**（各 1 回のやり直し）（根拠: PROGRESS turn 5「やり直し」、turn 6「やり直し」）— 原因の見立て: 推測: 前ターンのエントリを読んだついでに「どの turn の注意か」を補足したくなる。impl スキルに「前ターンのエントリは編集しない。固定項目名に接尾辞を付けない」が無い。前回提案の「恒常注意と固有注意の分離」で PROGRESS 冒頭を編集する習慣が生まれたことの副作用とも読める
- **lean-ctx フックの `.gsd-lite/` 配下 `cat` 拒否が turn 1 / 2 / 7 と本 turn で再発**（本 turn では `cat turns.jsonl` が「root: /home/parallels/workspaces/gsd-lite」で拒否。`jq` と Read は通った）。前回の提案「project root を修正する」は REQUIREMENTS でスコープ外となり、4 マイルストーン連続で各ターンが回避している（根拠: PROGRESS turn 1「想定外 (3)」、turn 2「想定外 (1)」、turn 7「想定外 (1)」、本 turn の実行記録、前回・前々回の振り返り）— 原因の見立て: フックの設定不良はマイルストーンの要件ではなく環境側の修正で、どのマイルストーンの discuss も「スコープ外」にする。マイルストーンの外（ループ運用側）で直すしかない
- **verify の汎用コードレビュー サブエージェントが約 8 分かかり、verify ターンのコスト 11.41 USD は impl 4 ターン中 3 ターンより高い**（内部ステップ 24 で、出力トークン 13,089 のうち親分しか記録されていない）（根拠: PROGRESS turn 7「想定外 (3)」、turns.jsonl turn 7）— 原因の見立て: 推測: 観点を絞らないレビュー依頼は対象ファイル全部を読む。セキュリティ側（2.5 分）は観点が固定されていた
- Read ツールが「サブエージェントが読了済み」のファイルを親に返さず、`git show HEAD:<path>` で代替した（根拠: PROGRESS turn 7「想定外 (2)」）— 原因の見立て: 推測: 読了状態が親子で共有されるツール側の仕様。回避策は分かっているがスキルに書かれていない

## Interesting（気づき・意外だったこと）

- **検査の道具（T1、23.0 分・11.16 USD）が製品のリファクタ本体（T2、13.8 分・7.31 USD）より高い**。行数も検査スクリプト 1,116 行に対し `instance.rs` + `lib.rs` の差分は +373 / −312。前回の「検査コード 17 倍」ほどではないが、同じ傾向（根拠: turns.jsonl turn 3・4、`git diff --numstat`）
- **サブエージェントを使ったターンは内部ステップ数が少ないのにコストが高い**: T1 は 29 ステップで 11.16 USD、verify は 24 ステップで 11.41 USD。前景のみの T2 は 101 ステップで 7.31 USD。`usage` の出力トークン（T1 12,023 / verify 13,089）はコストと釣り合わない（根拠: turns.jsonl）。推測: `usage` は親スレッドだけを数え、`cost_usd` はサブエージェント分を含む。サブエージェントの実コストは turns.jsonl から直接は読めない
- T2 のキャッシュ読みが 1 ターンで 10,270,307 トークン（全 7 ターン合計の 34%）。`lib.rs` 約 1,700 行を 101 ステップにわたって文脈に抱えたまま機械置換したため（根拠: turns.jsonl turn 4）
- `docs/README.md` に 1 行、`docs/architecture.md` に 2 行 + 2 文を足しただけで、PR の差分は 65 行 / 67 行になった。`-w` では 3 / 9 行。oxfmt の表の桁揃えが列幅の変化で全行を書き換える（根拠: `git diff --numstat` と `git diff -w --stat`、コミット 0b80b06）。PR レビューの差分の 95% が整形
- PR #1 は 25 ファイル・+3,578 / −1,568 だが、製品と文書は 10 ファイル・+1,706 / −377。残りは `.gsd-lite/` の管理文書と前マイルストーンの `archive/` 退避（根拠: `gh pr view`、`git diff --stat`）。in-repo 形のリモート運用では管理文書が PR に載る
- PROGRESS の「やり直し」合計 6 回（turn 1〜6 で 1 / 1 / 2 / 1 / 1 / 1）に対し turns.jsonl のリトライは 0。すべてターン内で吸収された。前回と同じく「やり直し」は試行数と別の指標（根拠: PROGRESS 各 turn、turns.jsonl）
- RESEARCH §2 の一覧は「空 payload で失敗する部品種」と「使われない機能（`host_progress` / buffer 付き完了）」を特定し、plan は決めた事項 7 の payload 表と決めた事項 8 のインライン fixture で最初から対応した。前回の「補助 fixture の後出し 5 回」は 0 回になった。一方で同じ決めた事項 8 の中身が 5 点外れた。「何を流すか」は research で決まったが「流したら何が返るか」までは確かめていない（根拠: RESEARCH §2、PLAN 決めた事項 7・8、PROGRESS turn 3）
- verify は要件に無い堅牢性・網羅性（残留リスク 1〜3）を差し戻しにせず、「要件を追加しない」と明記して残留リスクに置いた。前回は verify round 1 が 5 件を差し戻している。今回は impl の完了基準が変異表・集合一致・4 値一致まで持っていたので、verify に新しい観点が残らなかった（根拠: VERIFICATION「残留リスク」、PROGRESS turn 7「判定の根拠」）
- 本 reflect 時点で PR の CI（GitHub Pages の `build` ワークフロー）は IN_PROGRESS。CI の結果は記録に無い（根拠: `gh pr view 1 --json statusCheckRollup`）

## 次回への提案（実行可能な形で）

- [ ] plan のテンプレートに「照合・検査のリクエスト列（決めた事項 8 相当）を書くタスクは、plan が base 側（research の雛形 + base WASM）に 1 度流して各列が意図した経路に届くこと（`ok` と effects の有無）を確かめてから PLAN に固定する」を入れる。plan が実行できない場合は T1 の完了基準に「各シーケンスが handler 経路に届いたことを `okResponses` の内訳（label 単位）で示す」を入れる（Minus: 決めた事項 8 の 5 点訂正、残留リスク 1・2）
- [ ] research / plan スキルの「ターン終了の共通手順」に「コミット前に成果物を `bunx vp fmt <path>`（または対象リポジトリの formatter）で整形し、`bun run check` 相当が赤くないことを確かめる」を入れる。T1 の impl が管理文書を整形する状態をなくす（Minus: turn 3 の `check` 赤）
- [ ] impl / verify スキルの「並列サブ作業」の依頼文テンプレートに禁止事項を固定する: 「`git checkout` / `git restore` / `git stash` / `git reset` を使わない」「整形は対象ファイルだけ `bunx vp fmt <path>`」「結果はファイルに書いて終わる」。turn 4 の申し送りで効いた文言をスキルへ移す（Minus: サブエージェント A の巻き戻し）
- [ ] impl スキルの PROGRESS 手順に「前ターンのエントリは編集しない。固定項目名（やったこと / 想定外 / やり直し / 次への注意）に接尾辞や補足を付けない」を 1 行入れる（Minus: turn 5・6 の同じやり直し）
- [ ] lean-ctx フックの project root を**マイルストーンの外で**直す（この repo を root にする、または `LEAN_CTX_EXTRA_ROOTS` に `.gsd-lite/logs` と `.gsd-lite` を足す）。discuss では毎回スコープ外になるので、ループ運用側（gsd-lite の設定）の作業として起票する。直るまで reflect スキルの計測手順は `jq` と Read だけを使う（`cat turns.jsonl` を書かない）（Minus: 4 マイルストーン連続の再発、本 turn でも拒否）
- [ ] verify スキルのサブエージェント依頼を観点別に分ける（例: 「移動したコードの本文一致」「順序・借用の変化」「スクリプトの exit code と引数検証」）。汎用の「コードレビュー」1 本を避け、1 本あたりの対象ファイルを絞る（Minus: 8 分・11.41 USD の verify）
- [ ] impl / verify スキルに「サブエージェント起動後に親が同じファイルを読むときは `git show HEAD:<path>`（未追跡なら `bun -e` で読む）」を 1 行入れる（Minus: Read ツールの読了済み判定）
- [ ] ループの turns.jsonl にサブエージェント分の usage を分けて記録する（または `cost_usd` と `usage` の対象範囲を loop の README に明記する）。少なくとも reflect がコストの内訳を推測で埋めない形にする（Interesting: 29 ステップで 11 USD）
- [ ] 文書追従で Markdown 表に行を足すタスクは、PLAN の完了基準に「表の桁揃えで差分が膨らむ場合は `git diff -w --stat` の値を PROGRESS に併記する」を入れ、verify / PR レビューが実質差分を読めるようにする。または oxfmt の Markdown 表の桁揃えを無効にできるか research で確かめる（Interesting: 1 行追加で 65 行差分）
- [ ] in-repo 形でリモート運用（PR）をするマイルストーンでは、discuss で「PR に `.gsd-lite/` を含めるか」を聞く。含めないなら gsd-control 形（制御リポジトリ）を選ぶか、`archive/` 退避を別コミット・別 PR にする（Interesting: PR の 25 ファイル中 15 が管理文書）
- [ ] 段階 3（合成の実装）の research は、本マイルストーンの残留リスク 1・2 を最初の入力にする: `rpc_result` の成功経路（デコード可能な Protobuf 応答）を照合列に足す、`handlerNodes` の走査を `menu` / `bbar` / `tbar` / `buttons` に広げる（VERIFICATION 残留リスク 1・2）
