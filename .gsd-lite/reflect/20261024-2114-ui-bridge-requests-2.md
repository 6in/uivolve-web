# 振り返り — ui-bridge-requests-2（2026-10-24 21:14）

- 種別: ループ（verify 合格後。verify round 2 で合格、MR !6 作成済み。マージは人）
- 対象範囲: main...HEAD `7f51c0c`（コミット 28 件。discuss 1 / research 1 / plan 1 / impl 14 / verify 3 / loop 8）/ ターン 1〜12
- 前回の振り返り: 20261019-1220-http-error-body.md（その前 20261010-0251-component-webmcp.md）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル        |
| -------- | -------- | ------ | ---------- | -------- | ------------ | -------------- | ------------- | ------------------------ |
| research | 1        | 1      | 5.0        | 0        | 23,372       | 2,892,512      | 1.90          | claude / claude-opus-5-5 |
| plan     | 1        | 1      | 16.0       | 0        | 44,116       | 7,765,664      | 3.76          | claude / claude-opus-5-5 |
| impl     | 8        | 8      | 38.9       | 0        | 146,281      | 22,817,896     | 15.96         | claude / claude-opus-5-5 |
| verify   | 2        | 2      | 30.4       | 0        | 39,142       | 8,093,367      | 5.70          | claude / claude-opus-5-5 |

- 注記: `usage`（出力トークン・キャッシュ読み）は親セッションのみ、`cost_usd` はサブエージェント込み（推測）。ターン間の比較は `cost_usd` で行う
- 合計 12 ターン・12 試行・5,411 秒（90.2 分）・27.32 USD。全試行 `rc=0` / `progressed=true`、`attempt > 1` は 0。全行に `segments` あり（1〜4）
- 壁時計: ループ開始 19:42:54（loop.log）→ turn 12 のループ追記コミット `7f51c0c` 21:13:23（90.5 分）。試行合計とほぼ同じで、利用枠の sleep は 0（`rate_limit.five_hour` の最大は turn 12 の 0.35。loop.log にトークン輪番の表示は無い）。BLOCKED 0、人間の介入コミット 0
- 前回（http-error-body）との比較: 19 試行 / 222.1 分 / 156.08 USD → 12 試行 / 90.2 分 / 27.32 USD（時間 −59 %、コスト −82 %）。計画タスク 11 → 6、差分（`.gsd-lite` を除く）56 ファイル +3,119 / −179 → 21 ファイル +1,514 / −27。前回は research / plan / verify が claude-fable-5-1、impl が claude-opus-5 で、今回は全フェーズ claude-opus-5-5（モデル差と規模差が混ざっているので、コスト減の内訳は切り分けられない）
- impl のターン別所要（分）/ コスト（USD）: T1 3.9 / 1.39、T2 6.7 / 2.57、T3 6.0 / 2.65、T4 4.0 / 1.80、T5 4.3 / 2.71、T6 7.6 / 1.67、F1 3.1 / 1.42、F2 3.3 / 1.75
- 最終判定スクリプト（`verify-instance-refactor.mjs`）の実行は 6 回・合計 1,643.6 秒（27.4 分 = 試行合計の 30 %）: turn 2 ×3（123.7 / 65.4 / 464.5 秒。前 2 回は `bun run check` で失敗）、turn 8 352.6、turn 9 340.0、turn 12 297.4（各 `scratch/turn-NNN-final*.txt` の「合計」行）
- 権限拒否（permission_denials）: **28 件 / 8 ターン**（前回 27 件 / 11 ターン）。内訳: `git` ×17（`git -C <絶対パス> …` ×11 = turn 5 ×5・turn 7 ×6、`git stash push` / `pop` ×2 = turn 10、波括弧・バックティックを含む `git grep -F` ×2 = turn 2・turn 10、`git check-ignore` ×1 = turn 2、`git ls-remote` ×1 = turn 12）、`bat` ×6（turn 5 ×2・turn 6 ×2・turn 12 ×2）、`ls` ×3（作業ディレクトリ外の `~/.cache/ms-playwright`・`/usr/bin/chromium-browser` を含む = turn 1 / 2 / 6）、`glab mr list` ×1（turn 12）、改行と `;` で連結した `cd …` ×1（turn 9）。`gsd-lite-loop.sh --where` 由来は 0（前回 7）

- 計画タスク数 / impl ターン数: 6 / 8（T1〜T6 が 1 タスク = 1 ターン、残り 2 ターンは verify round 1 の F1 / F2）
- verify 差し戻し: verify_round 1 回（指摘 2 件 → F1 `setAuthentication` の入れ子の値の例外漏れ・疎配列 / F2 認証文書の言い切り）。round 2（turn 12）で合格 / BLOCKED: 0 回（`git log --all -- .gsd-lite/BLOCKED.md` に対象範囲内のヒットなし）。`fix_round` 0
- 前回の提案の反映（13 件。PLAN「メモ」`:207-209` に反映表あり）: **大半が守られた**
  - 守られた: 1（契約より要件・穴は F タスク → PLAN メモ `:188`。今回は「残留リスクとして申し送り」で持ち越した穴は 0）、2（実ブラウザは取得を試みてから → T4 が `--install` で取得し初回で通った）、3（`--where` はベア名 → AGENTS.md に入り拒否 0）、7（「確かめ方」に実行コマンドを貼り「現在」に行数 → 追従先 14 行。plan 由来の訂正は turn 2 の 8→11 行と turn 10 の `map`→iterator の 2 件で、前回 9 件）、8（依頼文の識別子の綴り・統合前の `vp check` → turn 5 / 7 で識別子起因のやり直し 0）、9（往復プローブ → T2 の実 WASM `UiRuntime` 往復）、10（F タスクに round 2 が使うプローブを名指し → PLAN F1 `:149` が `turn-009-probe.mjs` を指定し round 2 がそれで判定）、11（旧実装で何で落ちるか → F1 のテスト各行にコメント）、12（`> file 2>&1`・`sed -i` 禁止 → `sed -i` 0 件）
  - 守られなかった: 5（検索語にバックティックを含めない）— turn 10 の `git grep -n -F 'map\` の get trap'`が承認待ち。turn 2 の波括弧入り`git grep -F` も同型
  - 範囲外 / 不採用: 4（cargo レジストリ。今回 Rust を触らず該当なし）、6（トークン輪番。今回のループは輪番を使っていない）、13（前回の残留リスクを入れる → DECISIONS「前回の残留リスク: 入れない」で人が却下）

## Plus（うまくいったこと）

- 全 12 試行が 1 回で進み、リトライ・BLOCKED・人間の介入・利用枠の sleep が 0。verify は 1 回の差し戻しで合格し MR !6 を作って終わった（根拠: turns.jsonl、loop.log、VERIFICATION round 2、コミット `e5e0b5b` / `5e32536`）
- 前回比で時間 −59 %・コスト −82 %。impl 1 ターンの平均は 4.9 分 / 2.00 USD（前回 12.1 分 / 7.79 USD）（根拠: turns.jsonl、前回振り返りの計測）
- 実ブラウザが初回のタスクで通った。PLAN 検証コマンド節 `:24` に「`--install` で作業ディレクトリ内に取得、『実行不能』は取得を試みて失敗したときだけ」と書いてあり、T4 が `.cache/ms-playwright/` に Chrome for Testing 153 を取得して `isSecureContext:false` を assert、`127.0.0.1` を拒む反例まで取った。前回は 2 ターン「実行不能」のまま verify に回っていた（根拠: PROGRESS turn 6、`scratch/turn-006-insecure-browser*.txt`、前回振り返り Minus 2）
- 計画外の穴を「申し送り」にせずその場で直した。T5 で PLAN 決めた事項 14 の「転送は `HTTP転送に失敗しました` のまま」が実物（`src/adapters/http.js:393`・`http-download.js:51` は `HTTP通信・認証に失敗しました`）と違うのを `rg` で確かめ、文書を実物に合わせた（根拠: PROGRESS turn 7「想定外」）。前回の Minus 1（穴の 8 ターン持ち越し）は再発していない
- 既存テストの期待値変更は T1 の 2 行だけで、PLAN 決めた事項 4 で予告済みのもの。他の全ターンが「なし」（根拠: PROGRESS turn 3〜11 の「既存テストの期待値の変更」欄）
- 断言 → 実装シンボル → 反例の表を impl（T5 11 行・T6 6 行・F2 8 行）が scratch のスクリプトで実行して埋めた。round 2 は `turn-009-probe.mjs` の再実行と `turn-012-f1-regress.mjs` 14 ケースで回帰だけを見て、新規探索をせず済んだ（根拠: PROGRESS turn 7 / 8 / 11、VERIFICATION round 2）
- F1 / F2 は impl で最短クラス（3.1 分 / 1.42 USD、3.3 分 / 1.75 USD）。PLAN の F1 に背景・期待結果表・round 2 のプローブ名があり、そのままテストに写せた（根拠: PLAN `:133-165`、turns.jsonl turn 10 / 11）
- `gsd-lite-loop.sh --where` の承認待ちが 7 件 → 0 件（AGENTS.md「PATH 上のコマンドとして呼ぶ」が効いた）（根拠: turns.jsonl の `permission_denial_heads`、前回振り返り Minus 3）

## Minus（問題・無駄・やり直し）

- **verify round 1 で格子の外の入力クラスが見つかり F1 になった（2 マイルストーン連続）**。T1 の格子は「値の型」（`null` / 文字列 / 重複 / パス付き / HTTP / `Symbol` …）で組み、「読み取りの途中で投げる値」（getter / Proxy trap / revoke 済み Proxy）は options 直下の 1 セルにしか置かなかった。入れ子の `allowedOrigins` / `publicOrigins` の配列と `refresh` の各フィールドでは、ホストの例外（トークンを含みうる message）と `TypeError` がそのまま出た。疎配列も受理されていた（根拠: VERIFICATION round 1 指摘 1「なぜ T1 で拾えなかったか」、PROGRESS turn 9「想定外」、PLAN T1 `:61`）— 原因の見立て: REQUIREMENTS「堅牢性」`:55` が値の例を「不正な型・空・重複・パス付き・HTTP」と型の側だけで列挙し、plan がそれをそのまま格子の軸にした。軸が「値の種類」の 1 つで、「どこで読むか（直下 / 配列の length・添字・iterator / 入れ子オブジェクトの各フィールド）」の軸が無かった。前回の F2（孤立サロゲート）も「格子に無い入力クラス」で、型の違う同じ失敗
- **F2 の根は research の狭い言い切りが plan → 文書へ流れたこと**。RESEARCH 落とし穴 10（`:109-110`）と §5（`:143`）が「R5 の文言が届くのは画面・Rhai・テーマ・WASM、HTTP アダプター・転送は汎用文言」と書き、PLAN 決めた事項 14 と T5 の文書がそれを継いだ。T5 は転送の文言の誤りだけ直し、届く先の列挙（Rhai の宣言 GET・RPC・ホストの直接呼び出し・`app.json`）は直さなかった。T6 の断言表 6 行にも「届く先」の断言が無く、verify が `src/http-effects.js:65` などから拾った（根拠: RESEARCH `:109`、PLAN `:181`・`:49-55`、PROGRESS turn 7「想定外」、VERIFICATION round 1 指摘 2）— 原因の見立て: 断言表は plan が決めた 6 項目だけで、文書に書いた「〜だけ」「〜まで」型の列挙の断言（届く先・設定エラーの列挙・既定値）が表に入らなかった
- **turn 12 で待ちループが止まらず約 8 分を失った**。最終判定はバックグラウンドで 297.4 秒で終わっていたが、終了待ちに書いた `until ! pgrep -f verify-instance-refactor.mjs …` が自分自身のコマンド行に一致し続け、上限時間で止められた。作業の完了（result 801.9 秒）からターン終了（1,307 秒）まで約 500 秒（根拠: `turn-012-attempt1.log` 末尾「上限の時間に達して止められました」「`pgrep -f` がこのループ自身のコマンド行に一致」、`turn-012-attempt1.jsonl` の result `duration_ms` 801,872 と 4,478、`turn-012-final.txt` 合計 297.4）— 原因の見立て: バックグラウンド実行の完了通知を待たず、自前のポーリングで待った。turn 12 の PROGRESS は待ちの前に書かれており、この事実は PROGRESS に無い
- **承認待ち 28 件**。最多は `git -C <絶対パス>` ×11 で、すべてサブエージェントを 2 本使った turn 5 と turn 7 に集中（サブエージェントを使わなかった 6 ターンでは 0）。in-repo 形（`target=.`）なので `-C` は不要で、allowlist の `Bash(git diff:*)` 等は `git -C …` に当たらない（根拠: turns.jsonl turn 5 / 7 の `permission_denial_inputs`、PROGRESS turn 5 / 7「やったこと」のサブエージェント 2 本、`.claude/settings.json`）— 推測: サブエージェントは「作業場所の解決」を読まずに、絶対パスで `git -C` を付けた。次に `bat` ×6（3 ターン）。グローバル指示が `cat` より `bat` を勧める一方、プロジェクトの allowlist に `bat` が無い。turn 12 の PROGRESS は「ファイル閲覧は Read を使う」と申し送ったが、それ以前の turn 5 / 6 にも同じ拒否があり、申し送りでは防げていない
- **旧実装で新テストが落ちることを `git stash` で確かめられなかった**（turn 10。`git stash push` / `pop` が承認外）。F1 は turn 9 のプローブ出力を根拠に代えた（根拠: PROGRESS turn 10「想定外」、turns.jsonl turn 10）— 前回提案 11（テスト担当は旧実装で何で落ちるかを添える）を実行で裏付ける手段が allowlist 内に無い
- **plan の最終判定が 2 回やり直しになった（189 秒）**。1 回目は research ターンが整形せずにコミットした `.gsd-lite/RESEARCH.md`、2 回目は整形後に手で直した `.gsd-lite/PLAN.md` で `bun run check` が落ちた（根拠: PROGRESS turn 2「想定外」「やり直し: 2 回」、`scratch/turn-002-final-base.txt` 123.7 秒・`-2.txt` 65.4 秒）— 原因の見立て: 「`.gsd-lite/*.md` を書いたら `bunx vp fmt`」が plan 以降の PLAN メモにしか無く、research ターンには届いていない。前々回にも整形起因のやり直しがあった
- 小: turn 9（verify）が改行と `;` で連結した `cd …\ngit grep …; echo ====; sed -n … | grep` を 1 回の Bash で実行しようとして承認待ちになった（「1 回の Bash に 1 コマンド」の作法違反）（根拠: turns.jsonl turn 9 の `permission_denial_inputs`）
- 小: 前回提案 5（検索語にバックティックを含めない）が守られず、turn 10 の PLAN 訂正の確認で承認待ち 1 件（根拠: turns.jsonl turn 10）

## Interesting（気づき・意外だったこと）

- **最終判定スクリプトが試行時間の 30 %（27.4 分 / 90.2 分）**。plan の base 確認・T6・verify ×2 の 4 か所で計 6 回実行し、1 回 300〜465 秒。今回は Rust を触っておらず、照合・変異の段（`build:wasm` → `test:rust` → base 照合 → 変異 8 本）は毎回「base と同じ」を確認しただけになった（根拠: 各 `scratch/turn-NNN-final*.txt`、PLAN `:23`「本マイルストーンは Rust を触らないので base 照合・変異の結果は base と同じになるはず」）
- **サブエージェントを使ったターンは約 1.5 倍のコスト**。T3 / T5（各 2 本）は平均 2.68 USD、使わなかった 6 ターンは平均 1.77 USD。前回の 2.2 倍より差が小さい。承認待ちはサブエージェントのターンに 13 / 28 件が集中した（根拠: turns.jsonl turn 5 / 7 と他の impl ターン）
- **記録の食い違い**: turn 12 の PROGRESS は「最終判定は 10 分を超えたので終了待ちを 2 回かけた」と書くが、`turn-012-final.txt` の合計は 297.4 秒（5 分弱）。turn 12 の最終出力は、待ちが長引いた理由を `pgrep -f` の自己一致としている。時間がかかったのは最終判定そのものではなく待ち方だった（根拠: PROGRESS turn 12「想定外」、`turn-012-final.txt:856`、`turn-012-attempt1.log`）
- **plan の断言表に無かった断言だけが verify で崩れた**。T6 の断言 6 行は全部反例つきで OK だったが、F2 の 4 点（届く先・401 の形・設定エラーの列挙・HTTP の publicOrigins の注意）はどれも表の外だった（根拠: PLAN `:49-55`、PROGRESS turn 8 断言表、VERIFICATION round 1 指摘 2）。表を埋める手順は効いており、取りこぼしは表に載せる断言の選び方にある
- **verify round 1 は 8.6 分 / 3.51 USD、round 2 は作業部分だけなら約 13.4 分**（result 801.9 秒）。round 2 が round 1 より長いのは、最終判定と実ブラウザを両方回したうえに MR 作成と push を含むため。待ちの 8 分を除いても round 2 は「回帰だけ」の割に重い（根拠: turns.jsonl turn 9 / 12、`turn-012-attempt1.jsonl`）
- plan 1 ターンが 16.0 分で全体の 18 %。うち最終判定 3 回で 653.6 秒（10.9 分）を使い、PLAN を書く本体は 5 分程度だった（根拠: turns.jsonl turn 2、`scratch/turn-002-final-base*.txt`）

## 次回への提案（実行可能な形で）

- [ ] plan スキルの「堅牢性の格子」の作り方に、軸を 2 つ持たせる規則を足す: 「値の種類（型・空・重複・形式）」×「**読む場所**（引数そのもの / 直下のフィールド / 配列の `length`・添字・iterator / 入れ子オブジェクトの各フィールド）」。読む場所ごとに最低 1 セル「読み取りで投げる値」（getter が `TypeError` を投げる・投げる値が Error でない・Proxy の get trap・revoke 済み Proxy）と、配列なら疎配列を置く。discuss は堅牢性の受け入れ基準を書くとき例の列挙に「読み取り中に投げる値（getter・Proxy）」を入れる（Minus 1: 2 マイルストーン連続で round 1 が格子外のクラスを拾った）
- [ ] plan スキルの「断言 → 実装シンボル」表の選び方に「文書が『〜だけ』『〜まで』『〜のまま』と**列挙で言い切る**行（届く先・エラー文言の一覧・既定値・対象の経路）は全部表に入れ、列挙の各要素を `rg` で実装から数え直す」を足す。research の落とし穴に経路の列挙を書くときは、確かめた `rg` のコマンドと件数を添える（Minus 2: RESEARCH 落とし穴 10 の狭い列挙が F2 になった。Interesting 4）
- [ ] 長時間コマンドの待ち方を全スキル共通の「無人ターンのシェルの作法」に足す: 「最終判定など 2 分を超えるコマンドは Bash の `run_in_background` で起動し、完了通知を待つ。`pgrep -f` / `until` / `sleep` のループで待たない（`pgrep -f` は待ちループ自身に一致して終わらない）」（Minus 3: turn 12 の約 500 秒）（AGENTS.md 候補）
- [ ] `.claude/settings.json` の `permissions.allow` に読み取り専用の 4 つを足す: `Bash(bat:*)`、`Bash(git ls-remote:*)`、`Bash(glab mr list:*)`、`Bash(glab mr view:*)`。足さない場合は `bat` を `deny` に入れて Read に寄せる（Minus 4: `bat` ×6・`git ls-remote` / `glab mr list` ×2。グローバル指示が `bat` を勧めるので申し送りだけでは止まらない）
- [ ] in-repo 形（`--where` の `target=.`）では git に `-C` を付けず、リポジトリのルートで `git <サブコマンド>` と呼ぶ。impl スキルの並列サブ作業の依頼文テンプレートにも同じ 1 行を入れる（Minus 4: `git -C <絶対パス>` ×11 がサブエージェントを使った turn 5 / 7 に集中）（AGENTS.md 候補）
- [ ] 旧実装との比較は `git stash` を使わず、`git show main:<path> > .gsd-lite/logs/<slug>/scratch/turn-NNN-main-<file>` で旧版を書き出してプローブから import する（Minus 5: turn 10 で `git stash` が承認外）（AGENTS.md 候補）
- [ ] `.gsd-lite/*.md` を書いたターンは、フェーズを問わずコミット前に `bunx vp fmt <書いたファイル>` を掛ける（research も含む）（Minus 6: turn 2 の最終判定 2 回やり直し・189 秒）（AGENTS.md 候補）
- [ ] plan スキルの「最終判定」の回数を絞る: Rust（`engine/`）を触らないマイルストーンでは、plan の base 確認と verify round 2 は `bunx vp test run` + `bun run check` + `bun run docs:check` に代え、`verify-instance-refactor.mjs` は T6（最終判定タスク）と verify round 1 の 2 回に限る。DECISIONS に「Rust 無変更なら照合・変異は 2 回」と書いて discuss で採否を聞く（Interesting 1: 6 回で試行時間の 30 %）
- [ ] reflect / verify スキルの PROGRESS の書き方に「ターン末尾で待ちが発生した場合は、最終出力にだけ書かず PROGRESS の追記で残す（ループの追記コミットと一緒でよい）」を足す。今回は turn 12 の待ちの事実が PROGRESS に無く、ターンログを読まないと分からなかった（Interesting 3: 記録の食い違い）
