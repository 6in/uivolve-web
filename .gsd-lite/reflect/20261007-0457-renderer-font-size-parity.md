# 振り返り — renderer-font-size-parity（2026-10-07 04:57）

- 種別: ループ（verify 合格後）、fix_round=0、verify_round=2（差し戻し 2 回・round 3 で合格）
- 対象範囲: 4a3a0a3..0dc4d32（41 コミット。discuss c007346 〜 verify の state 更新 0dc4d32。うち人間の介入 2 件 ffa2d5a / d14dfeb、マージ 1 件 75d76ce）/ ターン 1〜21
- 範囲の説明: `main` へローカルマージ済みで `main...HEAD` は空。turns.jsonl の turn 1 `head_before`（c007346）の 1 つ前を起点にした。本 reflect（turn 22）は未集計
- 前回の振り返り: 20261005-1200-development-retrospective-blog.md（その前 20261005-0843-opfs-file-transfer.md）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン                | キャッシュ読み | コスト（USD） | エンジン / モデル                                               |
| -------- | -------- | ------ | ---------- | -------- | --------------------------- | -------------- | ------------- | --------------------------------------------------------------- |
| research | 1        | 1      | 4.9        | 0        | 記録なし（total 138,021）   | 記録なし       | 記録なし      | codex / 記録なし                                                |
| plan     | 1        | 1      | 4.7        | 0        | 記録なし（total 116,903）   | 記録なし       | 記録なし      | codex / 記録なし                                                |
| impl     | 16       | 18     | 431.1      | 2        | 1,323,715（Claude 17 試行） | 388,677,132    | 281.99        | turn 3 のみ codex / 記録なし、turn 4〜20 claude / claude-opus-5 |
| verify   | 3        | 3      | 45.1       | 0        | 48,674                      | 8,013,648      | 55.38         | claude / claude-fable-5-1                                       |

- 合計 22 試行・29,147 秒（8.1 時間）。Claude 分のコスト合計 337.37 USD。Codex 3 ターンは `total_tokens` 307,711 のみでコスト記録なし
- 壁時計: turn 1 開始 10-06 13:44 JST → turn 3 終了 13:56 → **turn 4 開始 20:59（約 7 時間は BLOCKED で人間待ち）** → turn 21 終了 10-07 04:54
- 権限拒否（permission_denials）: なし（Claude 18 試行すべて `[]`。Codex 3 行は項目なし）
- 無進捗試行: 2（turn 12 の attempt 1・2。下表）
- 計画タスク数 / impl ターン数: 9 / 16（T1 が 2 ターン（turn 3 BLOCKED + turn 4）、T2〜T9 が各 1 ターン、差し戻し F1〜F6 が 6 ターン）
- verify 差し戻し: 2 回（round 1 = 指摘 5 件 F1〜F5、round 2 = 指摘 1 件 F6 文書のみ、round 3 合格）
- BLOCKED: 1 回（turn 3 / T1。Codex の workspace-write sandbox で Chromium が起動できず。人間が engine を Claude へ切替えて解消 d14dfeb）
- 5 時間枠の使用率: 0.04 → 0.40（turn 12 で枠が切替）→ 0.46。7 日枠 0.04 → 0.15

ターン別（impl / verify、Claude 分）:

| turn | 内容                  | 分   | USD   | 内部ステップ数 |
| ---- | --------------------- | ---- | ----- | -------------- |
| 4    | T1 実ブラウザ入口     | 25.6 | 12.52 | 144            |
| 5    | T2 CSS 単一源         | 20.2 | 12.24 | 141            |
| 6    | T3 Canvas 接続        | 29.5 | 18.64 | 162            |
| 7    | T4 編集               | 31.7 | 17.20 | 152            |
| 8    | T5 surfaces           | 26.2 | 19.23 | 158            |
| 9    | T6 font/DPR           | 30.7 | 16.55 | 128            |
| 10   | T7 coverage           | 37.4 | 27.58 | 222            |
| 11   | T8 matrix             | 55.3 | 28.55 | 183            |
| 12   | T9（3 試行）          | 44.6 | 26.83 | 2 / 69 / 126   |
| 13   | verify round 1        | 18.7 | 29.21 | 18             |
| 14   | F1 検査の役割単位化   | 29.1 | 18.39 | 144            |
| 15   | F2 検査の穴           | 26.1 | 22.91 | 180            |
| 16   | F3 描画失敗の隔離     | 19.1 | 12.17 | 104            |
| 17   | F4 reset 詳細度       | 17.1 | 10.64 | 106            |
| 18   | F5 文書（事実誤り）   | 22.2 | 26.49 | 218            |
| 19   | verify round 2        | 16.8 | 18.10 | 32             |
| 20   | F6 文書（古い実測値） | 14.7 | 12.06 | 20             |
| 21   | verify round 3        | 9.6  | 8.07  | 28             |

- 差し戻し以降（turn 13〜21）の合計: 173 分・158.04 USD（全体の 36% / 47%）。うち**文書だけ**の F5・F6・verify round 2・3 で 63 分・64.72 USD
- 前回の提案の反映:
  - PATH 入口 `gsd-lite-loop.sh --where`: **Codex ターン（1〜3）では守られず**、3 ターンとも「誤った相対 loop パス → PATH 入口」の修正を記録。Claude ターン（4〜21）では入口誤りの記録なし（PROGRESS 各 turn）
  - 並列前のブラウザ経路の確認: discuss が sandbox 内 `--check` の失敗と sandbox 外の成功を記録しながら Codex workspace-write で開始し、turn 3 で BLOCKED（DECISIONS 実行設定、BLOCKED.md）。確認はしたが結果を開始判断に使えていない
  - scratch 実行前の構文確認: 守られた（PLAN 検証コマンド `node --check`、PROGRESS turn 1）
  - PROGRESS のやり直し分類と turn 順: **守られた**（turn 1〜21 が昇順・一意、「やり直し」を検証再実行／ツール指定修正／整形で分けて記録）
  - ループ計測の明示: Claude ターンは usage / cost / num_turns / rate_limit が記録され、Codex 行は `total_tokens` だけ。未取得値は本振り返りでも「記録なし」とした

## Plus（うまくいったこと）

- RESEARCH の落とし穴 11 件を PLAN の表で担当タスクへ対応付け、実際にその箇所で差が出た（「CSS 宣言だけで一致判定」→ T2 で親コンテキストごとに継承元が違う差を実測、「DPR 二重拡大」→ T6 で bitmap/transform 往復を実測）（根拠: PLAN メモ「落とし穴の対応」、PROGRESS turn 5・9）
- 各 impl ターンが「歯の確認」（修正を一時的に戻して suite が非 0 になることの確認）を行い、F1 以降は変異表＋バイト列復元のスクリプトに定型化した（根拠: PROGRESS turn 5「224 件の不一致」、turn 8「巻き戻し 4 か所」、turn 14〜17 `scratch/turn-0NN-mutate.mjs`）
- verify round 1 が堅牢性の格子・変異 8 行・読み取り専用サブエージェント 2 本で一括して指摘し、round 2・3 は「格子の再確認と回帰だけ」に範囲を固定した。verify のコストは 29.21 → 18.10 → 8.07 USD と毎回ほぼ半減（根拠: PLAN「verify round 1 / 2 の記録」、turns.jsonl turn 13・19・21）
- 製品側の変更は `src/` 7 ファイル・約 470 行に収まり、T7・T8・T9・F1・F2・F5・F6 の 7 ターンは `src/` を 1 行も変えずに検査と文書だけを足した。最終 gate 14 手順の件数は turn 19・20・21 で完全に一致（根拠: `git diff --stat 4a3a0a3..HEAD`、PROGRESS 各 turn の「`src/` は 1 行も変えていない」、VERIFICATION）
- 無人 18 試行で権限拒否 0 件。前回提案の allowlist 追加（bun / bunx / node、d14dfeb）が効いた（根拠: turns.jsonl `permission_denials`、DECISIONS「Claude へのエンジン切替」）
- turn 3 の BLOCKED は質問・推奨・代案・再開後の手順を持ち、人間が DECISIONS に回答を書いて 1 コミットで再開できた（根拠: BLOCKED.md、d14dfeb）
- PLAN 訂正を「turn N / 実測」の形でタスク直下に積み、verify がそれを根拠に照合できた。訂正は約 30 件（根拠: PLAN T2〜F6 の訂正行）

## Minus（問題・無駄・やり直し）

- **Codex の sandbox で実ブラウザが起動できず turn 3 で BLOCKED、人間待ちで約 7 時間停止**（13:56 → 20:59 JST）。discuss の時点で「sandbox 内の `--check` プローブは失敗、sandbox 外は成功」を記録しながら Codex workspace-write で開始している（根拠: DECISIONS「実行設定」、BLOCKED.md、turns.jsonl turn 3 → 4 の時刻）— 原因の見立て: 推測: プローブの失敗を「開始しない条件」ではなく「記録する事実」として扱った。ブラウザ必須のマイルストーンでは sandbox 内プローブの成功を開始条件にすべきだった
- **turn 12（T9）が 3 試行**。attempt 1 は並列サブ作業 A/B を待つ間に「Background tasks still running after 600s; terminating」で打ち切られ（内部ステップ 2・20 分・10.31 USD）、attempt 2 は gate をバックグラウンドで回したまま 6.6 分で無進捗（5.38 USD）。attempt 3 が dirty な木を引き取って完了。無駄は 27 分・15.69 USD（根拠: turns.jsonl turn 12、`turn-012-attempt1.log` / `attempt2.log`、PROGRESS turn 12「想定外 (1)」）— 原因の見立て: `claude -p` のバックグラウンド待ち上限 600 秒を、サブエージェント 2 本の並列と最終 gate が同時に超えた。マイルストーンで唯一「並列サブ作業あり」にした T9 が唯一失敗したターン
- **verify round 1 が main からの退行 2 件（F3 描画例外で effects 停止、F4 reset 詳細度でホストのタグ規則が貫通）を見つけた**。両方とも T2 / T3 の製品変更の副作用で、6 suite はサイズしか測らないため impl 側の歯の確認では検出できなかった。さらに F1（検査が DOM と Canvas を役割単位で突き合わせておらず、役割入替の変異でも roles / matrix が通る）も検査自体の穴（根拠: PLAN F1・F3・F4 背景、PROGRESS turn 13・16・17）— 原因の見立て: PLAN の完了基準が「suite で実測して green」までで、「変異で非 0 になること」と「main と比べて失ったもの」を要求していなかった。verify が持ち込んだ変異表と格子を impl の完了基準へ前倒しできる
- **文書だけの差し戻しが 2 ラウンド**（F5: 事実誤り 9・古い記述 6・言い過ぎ 13、F6: F2〜F4 で動いた実測値 4 件ほか）。台帳 `docs/renderer-font-parity.md` は 1,657 行で、sha256 や件数などの生の実測値を写しているため後続タスクのたびに古くなった。F6 でようやく「証跡 JSON を指す」方針へ変更。費用は 63 分・64.72 USD（根拠: PLAN F5・F6、PROGRESS turn 18〜21、turns.jsonl）— 原因の見立て: 台帳の書き方の規約が T1 時点で無く、各ターンが「そのターンの実測値」を追記する形になった
- **最終 gate の所要時間の記録が最後まで食い違った**: turn 11「matrix 単体で約 4 分」、turn 12「約 20 分・600 秒上限を超える」、turn 13「約 70 秒」、turn 15「69 秒」、turn 16「71 秒」、turn 18「約 5 分」、turn 20「約 6 分」、turn 21「約 5 分」。turn 14 と 19 は「計測していない」（根拠: PROGRESS 各 turn の「次への注意」）— 原因の見立て: 推測: 70 秒は vitest 開始から完了までの部分計測、5〜6 分は matrix を含む全体。runner が合計所要を出力しないので各ターンが別の測り方をした
- **lean-ctx のフックが `.gsd-lite/` 配下への `grep` / `sed` / `cat` / `tail` を「project root 外」で拒否**し、turn 13 以降の毎ターンが回避策を発見し直して「次への注意」へ書き続けた（turn 13・15・16・17・18・19・20。本 reflect でも `cat .gsd-lite/state.json` が拒否され、root が `/home/parallels/workspaces/gsd-lite` と表示された）（根拠: PROGRESS turn 13「想定外 (3)」、turn 15「想定外 (3)」、turn 20「次への注意」、本 turn の実行記録）— 原因の見立て: フックの project root が別プロジェクトを指している設定不良。permission_denials には出ないので turns.jsonl からは見えない
- PLAN が想定した「既存アプリ画面で条件が揃う」が 5 回外れ、T3・T4・T5・T7・T9 で補助 fixture（JSON + rhai、HTML）を新設した。毎回「どのアプリ画面にも揃って出ない」が PLAN 訂正の理由になっている（根拠: PLAN T3・T4・T5・T7・T9 の訂正、`tests/browser/font-parity-*.json`）— 原因の見立て: research が既存画面に出る部品・状態の一覧を作っておらず、plan が条件の有無を確かめずに画面名を書いた

## Interesting（気づき・意外だったこと）

- 1 マイルストーンの途中でエンジンが変わった（research / plan / turn 3 = Codex、impl = Claude Opus、verify / reflect = Claude Fable）。入口誤りは Codex の 3 ターン全部で起き Claude の 18 ターンでは 0 件。前回提案の「スキル冒頭に具体例を書く」は Claude 用スキル（ffa2d5a）に入っている（根拠: PROGRESS turn 1〜3 の「ツール指定修正」、`.claude/skills/*/SKILL.md`）。推測: 申し送りより「スキルの最初の実行例」の方が効く、という前回の見立てがこの差で裏付けられた
- サイズ検査は T4・T5 とも「1 回目の実行で全て green、落ちたのは観測側だけ」だった。impl ターンの時間の大半は製品修正ではなく観測器（対応付け・記録器・fixture）の作り込みに使われている（根拠: PROGRESS turn 7「想定外 (1)」、turn 8「想定外 (1)」）
- 検査コードは `tests/browser/font-parity.mjs` 1 本で 6,566 行、harness 936 行、観測 589 行。製品差分約 470 行の 17 倍（根拠: `git diff --stat`）。1 ファイルに 6 suite が同居しており、F1〜F4 の変更はこのファイルへ集中している
- verify round 2 がサブエージェントの報告のうち自分で再確認していない項目に「要確認」と付け、impl の F6 がそれを証跡 JSON で確かめてから直した。round 1 の F5「目視したのは 4 枚」は impl が再現できず（実際は 7 枚）、round 3 では PLAN F6 (A)1 の前提「コメント修正でも sha256 が変わる」自体が誤りと判明した（根拠: PLAN F6、PROGRESS turn 18「想定外 (1)」、VERIFICATION「字句の残留」）。verify の指摘にも誤りが混ざり、「要確認」の明示がそれを安全に処理した
- 文書だけの F5（22 分・26.49 USD・218 ステップ）は製品修正の F3（19 分・12.17 USD）より高い。証跡 JSON と台帳を 1 件ずつ突き合わせる作業はエージェントのステップ数を食う（根拠: turns.jsonl turn 16・18）
- 「次への注意」が turn を追うごとに定型文（サンドボックス外、loop 入口、baseline を上書きしない、grep 拒否、長いエラーの読み方）を 10 行前後まで抱え、毎ターン写している（根拠: PROGRESS turn 9〜20）。恒常の注意と「次のタスク固有の注意」が混ざって読みにくい
- turn 18 は「`jq` は無い」と記録したが、本 turn では `jq` が turns.jsonl の集計に使えた（根拠: PROGRESS turn 18「次への注意」、本 turn の実行記録）。推測: 無人ターンの実行環境（サンドボックス）と対話側で PATH が違う
- T6 の lifecycle 倍率ケースは turn 9・11 で「たまたま通っていた」既存の不安定さで、T9 が別件の調査中に原因（新しい CDP セッションの attach で倍率上書きが外れる）を特定した（根拠: PROGRESS turn 12「想定外 (2)」）。green の連続が安定性の証拠にならない例
- verify は `main` が `github/main` を追跡していても `origin` が無いためローカルマージを選び push していない。前 2 回の振り返りと同じ記録で、3 マイルストーン続けて GitHub 側は未反映（根拠: VERIFICATION「マージ結果」、前回・前々回の reflect）

## 次回への提案（実行可能な形で）

- [ ] discuss の開始条件に「マイルストーンが実ブラウザを必要とするなら、選んだエンジンの無人 sandbox 内で Chromium の起動プローブ（`node --check` ではなく実起動）が成功すること」を入れ、失敗なら engine / sandbox 設定を変えてからループを開始する（Minus: 7 時間の BLOCKED）
- [ ] impl スキルの「並列サブ作業」の注意に「`claude -p` のバックグラウンド待ち上限は 600 秒。サブエージェントの待ちと最終 gate を同じターンで重ねない。gate は前景で回し、サブエージェントは結果ファイルを書いて終わる形にする」を明記する。あわせて PLAN は並列サブ作業を最終タスクに置かない（Minus: turn 12 の 3 試行）
- [ ] plan の完了基準テンプレートに、検査を足すタスクごとに「変異表（最低: 役割入替 1 件・宣言削除 1 件）で該当 suite が非 0 になること」と、製品の CSS 詳細度・例外経路を変えるタスクに「`main` と同条件で比べて失う挙動が無いこと」を必須項目として入れる（Minus: verify round 1 の F1・F3・F4）
- [ ] 台帳（検証結果の文書）の規約を T1 の完了基準に置く: 「gate のログや証跡 JSON が持つ生の値（件数・ハッシュ・サイズ）は台帳へ写さず、ファイル名とキーを指す。台帳が持つのは判定・限界・対象外の理由だけ」。F6 で採った方針を最初から適用する（Minus: 文書だけの差し戻し 2 ラウンド・64.72 USD）
- [ ] 最終 runner（`verify-font-parity.mjs` 型）は手順ごとの所要と合計を最後に出力し、PROGRESS の「次への注意」はその値だけを写す（Minus: gate 所要の食い違い 8 件）
- [ ] lean-ctx フックの project root を修正する（この repo を root にする、または `LEAN_CTX_EXTRA_ROOTS` に `.gsd-lite` を足す）か、無人ターンではフックを外す。直るまでは impl / verify スキルに「`.gsd-lite/` 配下の読み取りは Read ツールと `git grep`」を 1 行で固定し、各ターンの申し送りから外す（Minus: turn 13 以降毎ターンの回避、本 turn でも再発）
- [ ] research の成果物に「既存アプリ画面 × 部品 × 状態」の一覧（どの画面に何が出るか）を含め、plan は受け入れ基準の条件を既存画面で出せない場合に補助 fixture を作るタスクを最初から計画へ書く（Minus: 補助 fixture の後出し 5 回）
- [ ] PROGRESS の「次への注意」を「恒常の注意（PLAN か PROGRESS 冒頭に 1 か所）」と「次のタスク固有の注意」に分け、恒常分は毎ターン写さない（Interesting: 定型文 10 行の反復）
- [ ] 1 本で 6 suite を持つ検査ファイルは suite ごとに分割する方針を plan のタスク設計（T1 相当）に入れる。F 系のタスクが同じ 6,566 行のファイルに集中したため（Interesting: 検査コード 17 倍）
- [ ] verify はサブエージェントの報告を転記するとき、自分で再確認していない項目に必ず「要確認」を付ける（round 2 で始めた運用をスキルに固定）。round 1 の「4 枚」のような写し間違いを impl が再現できず時間を使った（Interesting: verify の指摘の誤り）
- [ ] `origin` が無く別名のリモート（`github`）だけの repo では、verify の判定を「リモート名が何であれ追跡先があればリモート運用」に変えるか、discuss で push の要否を聞く（Interesting: 3 マイルストーン続けて GitHub 未反映）
