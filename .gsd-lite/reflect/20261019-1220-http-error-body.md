# 振り返り — http-error-body（2026-10-19 12:20）

- 種別: ループ（verify 合格後。verify round 2 で合格、MR !2 作成済み。マージは人 / CI）
- 対象範囲: main `9c1ddf0`...HEAD `e616723`（コミット 45 件。discuss 2 + skills 1 / research 1 / plan 1 / impl 26 / verify 3 / loop 11）/ ターン 1〜17
- 前回の振り返り: 20261009-1151-component-loader.md（その前 20261009-0342-component-effects.md）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ          | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル         |
| -------- | -------- | ------ | ---------- | ----------------- | ------------ | -------------- | ------------- | ------------------------- |
| research | 1        | 1      | 22.3       | 0                 | 97,885       | 7,372,419      | 20.68         | claude / claude-fable-5-1 |
| plan     | 1        | 1      | 19.4       | 0                 | 85,906       | 5,322,162      | 12.13         | claude / claude-fable-5-1 |
| impl     | 13       | 15     | 156.9      | 0（利用枠拒否 2） | 221,486      | 67,942,266     | 101.29        | claude / claude-opus-5    |
| verify   | 2        | 2      | 23.6       | 0                 | 83,741       | 6,964,629      | 21.98         | claude / claude-fable-5-1 |

- 注記: `usage`（出力トークン・キャッシュ読み）は親セッションのみ、`cost_usd` はサブエージェント込み（推測）。ターン間の比較は `cost_usd` で行う
- 合計 17 ターン・19 試行・13,328 秒（222.1 分）・156.08 USD。進んだ 17 試行はすべて `rc=0` / `progressed=true`。利用枠拒否の 2 試行（turn 13 / 16。`rate_limit.status: rejected`、所要 6 秒 / 5 秒、コスト 0）は turns.jsonl 上は `attempt: 1` のまま記録されており、`attempt > 1` で数える「リトライ」欄には現れない（Interesting 2）
- 壁時計: ループ開始 08:05:05 JST → turn 17 終了 12:17:13 JST（252.1 分）。試行合計との差 30.0 分 = 利用枠拒否後の `sleeping 900s` × 2（loop.log）。人間の介入 0（コミットはすべて `gsd-lite(...)` 形式、BLOCKED 0）
- 前回（component-loader）との比較: 14 試行 / 142.4 分 / 99.34 USD → 19 試行 / 222.1 分 / 156.08 USD（時間 +56 %、コスト +57 %）。計画タスク 8 → 11（+38 %）、差分 39 ファイル +4,166 / −1,194 → 56 ファイル +3,119 / −179（`.gsd-lite` / `.claude` を除く）
- impl のターン別所要（分）/ コスト（USD）: T1 12.0 / 6.87、T2 16.5 / 10.45、T3 17.0 / 14.16、T4 6.7 / 4.43、T5 12.7 / 10.18、T6 10.9 / 6.80、T7 15.6 / 10.03、T8 16.3 / 11.61、T9 11.7 / 9.50、T10 16.4 / 4.41、T11 11.8 / 5.47、F1 4.1 / 3.39、F2 5.0 / 4.01。最長・最高コストは T3（サブエージェント 3 本）
- 権限拒否（permission_denials）: **27 件 / 11 ターン**（前回は 0）。内訳: Bash: `gsd-lite-loop.sh` 系 ×7（turn 2 / 6 / 8 / 12 / 13 / 15 / 16。ヘッドは `bash` / `gsd-lite-loop.sh` / `.`）、作業ディレクトリ外の読み取り ×9（`~/.cargo/registry` への `rg` ×4・`ls` ×1・`Read` ×1 = turn 1 / 2 / 8、`~/.cache/ms-playwright` と `/` への `ls` / `fd` ×2 / `which` = turn 12 / 14）、`git -C` ×2（turn 1 / 14）、バックティックを含む `git grep -F` ×2（turn 4 / 13）、複合コマンド ×3（turn 9 の `bun run check > f; echo`、turn 12 の `ps | rg`、turn 1 の `command -v … && …`）、`sed -i` ×1（turn 8）、`bash <scratch の .sh>` ×1（turn 13）、`command` ×1
- 利用枠（`rate_limit`）: 4 トークンを固定順（FRE → ART → TIG → KNG）で回している。FRE_TOKEN は turn 9 で `five_hour` 0.99（allowed_warning）、turn 13 / 16 で 1.02（rejected）。ART_TOKEN は `seven_day` 0.98〜0.99 で全ターン allowed_warning。TIG / KNG は 0.5 以下

- 計画タスク数 / impl ターン数: 11 / 13（T1〜T11 は 1 タスク = 1 ターンぴったり。残り 2 ターンは verify round 1 の差し戻し F1 / F2）
- verify 差し戻し: verify_round 1 回（指摘 6 件 → F1 download の `CLEANUP` 塗り替え / F2 孤立サロゲートの失敗本文 + 文書の軽微な差 4 件）/ BLOCKED: 0 回（`git log --all -- .gsd-lite/BLOCKED.md` の対象範囲内ヒット 0）
- 前回の提案の反映: **守られた**（11 件すべて PLAN「メモ」の反映表に写り、ループ中のスキル変更は 0）。実効は以下のとおり: 1（`fmt` → `check`）は整形起因のやり直しが 4 → **0**。2（基準 1 つ）は決めた事項 18 で F なし。3（述語の照合）は T5 が対応表 6 行を書いたが verify round 1 がその外の文書差 3 件を拾った（部分）。4（格子の段）は T11 の 48 行が全部想定の段で止まったが、格子に無い入力クラス（F2）は拾えず（部分）。5（再現コマンド）は turn 5 の穴に最初から再現スクリプトが付き T11 が再現したが、**再現した結果を要件と照らす規則が無く F1 になった**（Minus 1）。6（最終判定を plan で）は exit 0 でハーネス陳腐化なし。7（`0 件` の事前実行）は実行されたが正規表現が空振り（Minus 5）。8（`usage` の注記）は reflect スキルに入った。9（A / B 同じ指摘 → PLAN 訂正）は 3 回機能（turn 4 / 10 / 11）。10（残留リスクを T1 に）は T1 が 12.0 分で完了。11（round 2 は回帰だけ）は 866 秒 → 550 秒

## Plus（うまくいったこと）

- 進んだ 17 試行すべてが `rc=0` / `progressed=true` で、BLOCKED・人間の介入・無進捗のターンが 0。verify は 1 回の差し戻しで round 2 合格、MR !2 を作成して終了した（根拠: turns.jsonl、loop.log、VERIFICATION round 2、コミット `a2918cf` / `e616723`）
- 計画 11 タスクが 11 ターンで 1:1 に完了し、impl の 13 ターン全部が「実装コミット + 申し送りコミット」の 2 件で揃っている（根拠: git log `f630166`〜`9c1328b` の 26 コミットが T1〜T11・F1・F2 で対になる）
- 既存テストの期待値変更が **全ターンで 0 件**。各 impl ターンが `git diff tests/ | grep -c '^-[^-]'` 相当で自己確認し、verify が `git diff main...HEAD -- tests` の削除行 2 行（`console.log` 文言と import）で裏取りした（根拠: PROGRESS turn 3〜16 の「既存テストの期待値の変更」欄、VERIFICATION round 1「既存テストの期待値」）。受け入れ 4（opt-out は `status` の追加だけ）の最も強い証拠になった
- 契約先行のサブエージェント運用が 7 ターン（T1 / T2 / T3 / T5 / T7 / T8 / T9）で巻き戻し 0。親が起動前に `scratch/turn-NNN-contract.md` を確定して渡し、統合後に完了基準の `git grep` を親が全部再実行する形が定着した（根拠: PROGRESS turn 3 / 4 / 5 / 7 / 9 / 10 / 11 の「やったこと」）
- A / B の交差確認が PLAN の誤りを 3 回独立に拾った: 深さ 65 の `[[[…]]]` は段 f で落ちる（turn 4）、同梱画面との itemId / 関数名の衝突（turn 10）、5 リンク制限の理由（turn 11）。いずれも PLAN 訂正として扱われ再訂正 0（根拠: PROGRESS turn 4「想定外」(2)、turn 10「想定外」(1)、turn 11「想定外」(3)）
- 整形起因のやり直しが 0（前回 4 ターン）。全ターンが `bunx vp fmt <編集ファイル>` → 対象テスト → `bun run check` の順を守った（根拠: PROGRESS 各ターンの「検証」欄、PLAN 検証コマンド節の太字 1 行）
- verify round 1 の「受け付けた値の往復」プローブ（JS → serde_json → Rhai → state の 16 ケース）が、格子では原理的に見えない新しい入力クラス（JSON エスケープの孤立サロゲート）を拾った。格子は HTTP アダプター 1 層の判定しか見ていなかった（根拠: VERIFICATION round 1「R5 の格子」行と指摘 2、PROGRESS turn 14「想定外」(1)）
- verify が「実行不能」とされた実ブラウザを自力で閉じた。Playwright の取得先を `scratch/ms-playwright/` に向けて Chrome Headless Shell 153 を 1 分未満で取得し、dom / canvas とも passed（根拠: PROGRESS turn 14「やったこと」「想定外」(2)、VERIFICATION round 1 / 2 の実ブラウザ行）
- F1 / F2 が最短の impl ターン（4.1 分 / 3.39 USD、5.0 分 / 4.01 USD）。PLAN の F タスクに「期待結果表」（条件 × code / outcome / status / bodyError / OPFS の 6 行、本文 × 結果の 6 行）があり、impl はそれをテストと文書に写すだけで済んだ（根拠: PLAN F1 / F2 の完了基準、turns.jsonl turn 15 / 16）
- T11 が追従先チェックリストの 18 行を行番号つきで全行再実行し、行 17 の「無改修」8 か所を理由つきで列挙した（前々回の提案）。verify round 1 のサブエージェント A は同じ 18 行で OK を出し、差分は軽微 3 件に収まった（根拠: PROGRESS turn 13 の表、VERIFICATION round 1「契約文書 ↔ 実装の一対一」）

## Minus（問題・無駄・やり直し）

- **既知の穴が 8 ターン申し送られ、verify の差し戻し F1 になった**。turn 5（T3）が download の失敗本文読み取り失敗で `HTTP_422` / `status` / `bodyError` が `CLEANUP` に塗り替わることを再現スクリプト付きで見つけ、「T3 の契約 §2.2『finally を変えない』に従い据え置き、verify に申し送る」とした。turn 7（T5）は実装を直さず**文書に但し書き**を書き、turn 8〜13 は毎ターン「未解決のまま。T11 と verify が残留リスクとして扱う」を転記、turn 13（T11）は再現し直したうえで「残留リスクとして verify へ渡す」。verify round 1 が REQUIREMENTS R1「2xx 以外は opt-in に関係なく常に `status`」と R5「どちらかを 1 回だけ返す」に反すると判定して F1（根拠: PROGRESS turn 5「想定外」(2)、turn 7「想定外」(3)、turn 13「未確認の申し送りの再現」、VERIFICATION round 1 指摘 1、REQUIREMENTS `:62` / `:96`）— 原因の見立て: サブエージェント向けの**分担契約**（「finally を変えない」）が**要件**より優先され、impl スキルに「見つけた穴を受け入れ基準と照らし、違反なら F タスクを足す」規則が無い。前回提案 5（再現コマンドを添える）は守られたが、再現した後に何をするかが決まっていなかった。コスト: F1 の 4.1 分 + verify round 2 の一部 + 8 ターン分の転記
- **実ブラウザが T10 / T11 の 2 ターンで「実行不能」のまま verify に回った**。PLAN 行 27 が「Chromium が無ければ実行不能と書く」とだけ指示し、取得の可否を決めていなかった。T10 は `~/.cache/ms-playwright` と `/` を `ls` / `fd` / `ps` で探して承認待ち 4 件を出し、`| tail -40` でログを取って 600 秒を取りこぼした。verify は `PLAYWRIGHT_BROWSERS_PATH` を scratch に向けて 1 分未満で取得し通した（根拠: PROGRESS turn 12「実行不能」「想定外」(2)、turn 13「本ターンも実行不能」、turn 14「想定外」(2)、turns.jsonl turn 12 の `permission_denial_inputs`）— 原因の見立て: plan が「取得は人の判断」と暗に仮定し、無人ターンで許す取得先（作業ディレクトリ内）を書かなかった。T10 の「外部 CDN から取得しない」判断自体は妥当
- **承認待ちが 27 件 / 11 ターン（前回 0）**。最多は `gsd-lite-loop.sh --where` の呼び方 ×7: allowlist は `Bash(gsd-lite-loop.sh --where:*)`（PATH 上のベア名）だが、7 ターンが `bash .gsd-lite/gsd-lite-loop.sh --where`、`.claude/skills/gsd-lite-impl/../../../.gsd-lite/gsd-lite-loop.sh --where 2>/dev/null || ls .gsd-lite`、`./.gsd-lite/gsd-lite-loop.sh --where || gsd-lite-loop.sh --where` のように**存在しないパスを推測し `||` で代替を付けた**形で呼んだ。次に `~/.cargo/registry` の `rg` / `ls` / `Read` ×6（research / plan / T6 が Rhai のソースを読もうとした。作業ディレクトリ外）、バックティックを含む `git grep -F '…\`[[[…]]]\`…'`×2（PLAN 訂正の旧文字列にバックティックが入ると`git grep` でも止まる。turn 4 / 13）、`git -C` ×2、`sed -i` ×1、`bash <scratch>.sh`×1（根拠: turns.jsonl の`permission_denial_inputs`、`.claude/settings.json`の`permissions.allow`）— 原因の見立て: (a) スキル本文が「`gsd-lite-loop.sh --where` を実行」とだけ書き、「PATH 上のベア名で、パス・`bash`・`||`を付けない」と書いていない。(b) cargo レジストリは allowlist ではなく作業ディレクトリ境界で止まるので`rg:*` があっても通らない。(c) 旧文字列の検索語にバックティックを含めない規則が無い
- **利用枠の拒否で 30 分の壁時計を失った**。turn 13 / 16 で FRE_TOKEN が `five_hour` 1.02 で rejected になり、ループが 900 秒 sleep してから次のトークンで再実行した。FRE_TOKEN は turn 9 の時点で 0.99（allowed_warning）と記録されていたのに、固定順の輪番が turn 13 / 16 でも同じトークンを選んだ（根拠: loop.log「usage limit hit (wait 1/8) — sleeping 900s」×2、turns.jsonl turn 9 / 13 / 16 の `rate_limit`）— 原因の見立て: 輪番が直前の `rate_limit` の読みを見ていない。拒否は 6 秒で返るので、sleep せず即座に次のトークンへ回せば 30 分は 0 にできた
- **plan が「実行済み」とした `0 件` 条件の正規表現が空振りしていた**。行 1 の `'失敗本文は(返|公開し)ない'` は `docs/http-adapter.md` の「失敗本文は返さない」に当たらず（`返さ` が要る）、plan の「現在 3 件」は実際には 2 件しか拾えていなかった。T5（turn 7）が直した。同種の plan 由来の訂正は turn 3（`TypeError を含まない` が V8 で空振り）、turn 4（深さ 65 の配列 / `Response("{}")` の content-type）、turn 9（行 10 の `randomProvider` の 3 ファイル条件）、turn 10（`getOrder` の opt-in / 送り直し条件 / 行番号）、turn 13（行 14 のパイプ `| wc -l` が allowlist 外）で計 9 件。再訂正は 0（根拠: PROGRESS turn 7「想定外」(1)、各ターンの「PLAN 訂正」欄）— 原因の見立て: 行 1 は「plan で一度実行」の規則を守ったが、**実行したコマンドと PLAN に書いた条件が同じ文字列ではなかった**（手で書き写した）
- **サブエージェント B の成果物が完了基準の識別子を含まず、親のやり直しになった**（turn 11）。依頼文は「UUID v4 と整数乱数（ホスト供給）を足す」と日本語で書き、行 7 の `git grep -F 'uuid_v4'` が見る綴りを指定しなかった（根拠: PROGRESS turn 11「想定外」(1)「やり直し」）。同じ型で turn 9 は `vp` の lint 警告（`unicorn/no-new-array` ×7）が統合時に初めて出た。サブエージェントは `bun run check` を禁止されているので親が必ず拾うことになる（根拠: PROGRESS turn 9「想定外」(2)「やり直し」）
- やり直し合計 6 回（turn 5 ×1 `HostEffects.dispose()` のアダプター共有、turn 8 ×2 シグネチャ追従漏れ + `dispatch` の itemId 取り違え、turn 9 ×1 lint、turn 11 ×1 識別子、turn 14 ×1 Rhai 予約語 `go`）。turn 14 の `go` は PLAN「impl への注意 1」が列挙していた語で、verify の自前プローブに注意が及んでいなかった（根拠: PROGRESS 各ターン「やり直し」欄、PLAN メモ「impl への注意 1」）
- 小: turn 7 で文書に書いた但し書き（`docs/opfs-file-transfer.md:131`「CLEANUP として status・bodyError なしで返ることがある」）は F1 で丸ごと置き換えられ、T5 の作業の一部が無駄になった（根拠: PLAN F1 の文書項、PROGRESS turn 15）
- 小: turn 17 の PROGRESS は「`git ls-remote` と `glab mr list` が承認待ちになった」と書くが、turns.jsonl の turn 17 は `permission_denials: []`。自己申告と記録が食い違う（記録を正とすれば、承認待ちを見越して呼ばなかった可能性。根拠: PROGRESS turn 17「想定外」(1)、turns.jsonl turn 17）

## Interesting（気づき・意外だったこと）

- **サブエージェントを使ったターンはコストが約 2.2 倍、親の出力トークンは半分以下**。サブエージェントあり 7 ターン（T1 / T2 / T3 / T5 / T7 / T8 / T9）は平均 10.40 USD / 親出力 10,695 トークン、なし 6 ターン（T4 / T6 / T10 / T11 / F1 / F2）は平均 4.75 USD / 24,437 トークン（根拠: turns.jsonl の `cost_usd` と `usage.output_tokens`）。前回 reflect の Interesting 1 と同じ傾向で、`usage` がサブエージェント分を含まない推測を補強する。T6（Rust 6 ファイル・新規テスト 9 本・1 本で実装）が 6.80 USD で済んだのは、サブエージェント 3 本の T3（14.16 USD）より安い
- **turns.jsonl は利用枠拒否の試行を `attempt: 1` のまま記録する**。loop.log は「retry stays 0」と明記しており仕様どおりだが、reflect の集計式（`attempt > 1` をリトライと数える）ではこの 2 試行が見えず、「試行数 15 / ターン数 13」の差だけが痕跡になる（根拠: turns.jsonl turn 13 / 16 の重複行、loop.log）
- **4 トークンの輪番は負荷を均していない**。FRE_TOKEN だけが `five_hour` を 0.65 → 0.86 → 0.99 → 1.02 と使い切り、TIG / KNG は 0.5 以下のまま。輪番の順序が固定で、research（20.68 USD）と T3（14.16 USD）の重いターンがたまたま FRE に当たった（根拠: loop.log の `(token: …)` と `5h=` 列）
- **テスト担当 B は常に green を見る**。A（実装）が先に着地するため、B の新規テストは最初から通り「実装が無ければ落ちる」ことを実行で示せない。turn 3 / 4 は B に「旧実装なら落ちる根拠」を全ケースで報告させて代替した（根拠: PROGRESS turn 3「想定外」(1)、turn 4「想定外」(4)）。運用で成立しているがスキルには無い
- **verify round 1 の往復プローブは F2 修正後も 3 行 FAIL のまま**で、turn 16 が先回りして「これは未修正ではない」と申し送り、round 2 が別のプローブで判定した。プローブが `body` を `engine.completeHost` に直接入れてアダプターを迂回するためで、修正の対象（アダプター側）と判定の道具（エンジン側）が食い違っていた（根拠: PROGRESS turn 16「想定外」(1)、VERIFICATION round 2「round 1 の格子の再確認」行）。混乱は避けられたが、F タスクの完了基準に「round 2 が判定に使うプローブ」が名指しされていれば申し送りは不要だった
- **research が単一ターンとして最高コスト（20.68 USD、`num_turns` 155、承認待ち 7 件）**。Web 調査のサブエージェント 2 本 + Bun / Node のプローブ + Rhai 1.26.1 のソース確認（レジストリが読めず `cargo metadata` → WebFetch で GitHub の同じ版を読む遠回り）が重なった（根拠: turns.jsonl turn 1、PROGRESS turn 1「想定外」(2)）。RESEARCH の成果（落とし穴 20 件・提案 12 件）は PLAN に 32 か所で参照され、`with_volatility(true)` の指摘は T6 で「PLAN メモ 8 の調査は不要だった」と実証された
- **`bunx vp fmt` が表の列幅を再整列し、`docs/README.md` に 34 行 insert / 34 行 delete の見かけの差分を作った**（実質 2 行）。T11 が `git diff -w` で切り分けて MR 本文に書いたが、レビュアーが見る差分には残る（根拠: PROGRESS turn 13「`git diff main --stat` の確認」(c)）
- **plan の「決めた事項 6」（Content-Type 二重送出は厳格に不一致）は契約の 3 条件だけでは成立しなかった**。`application/problem+json, application/problem+json` が「`+json` で終わる」に合致して受理されるため、T2 が `,` を含むものを弾く 1 行を足した（根拠: PROGRESS turn 4「想定外」(1)）。決定の**意図**と判定の**条件**を別々に書くと、条件が意図を取りこぼす例
- 壁時計 252 分のうち試行外の 30 分が全部利用枠の sleep で、ループ自体のオーバーヘッドは前回同様ほぼ 0（根拠: loop.log の開始時刻とコミット `e616723` の時刻、turns.jsonl の `duration_s` 合計）

## 次回への提案（実行可能な形で）

- [ ] impl スキルの「想定外」の規則に「実装中に見つけた既知の穴（再現コマンド付き）は、その場で REQUIREMENTS の受け入れ基準と照らす。違反なら『残留リスクとして verify に申し送る』ではなく PLAN に F タスク（期待結果表つき）を足して先頭の未完了に置く。サブエージェント向けの分担契約（『finally を変えない』等）は要件に優先しない。verify に送ってよいのは要件外のものだけ」を入れる。plan スキルの契約テンプレートにも「この契約は分担のためのもので、要件違反を見つけたら契約より要件を優先し報告する」の 1 行を固定する（Minus 1: F1 が 8 ターン持ち越された）
- [ ] plan スキルの「検証コマンド」節に、実ブラウザ系の取得規則を書く: 「Playwright のブラウザが無ければ `PLAYWRIGHT_BROWSERS_PATH=.gsd-lite/logs/<slug>/scratch/ms-playwright bunx playwright install chromium` を無人ターンで実行してよい（作業ディレクトリ内・約 115 MB・1 分未満）。『実行不能』と書くのは取得を試みて失敗したときだけ」。research の環境確認に「`bunx playwright install --dry-run` 相当でブラウザの有無を 1 行」を足す（Minus 2: T10 / T11 の 2 ターンが未検証のまま）
- [ ] 全スキル共通の「作業場所の解決」の文言を「`gsd-lite-loop.sh --where` は **PATH 上のベア名でそのまま** 1 回実行する。パスを付けない、`bash` を前置しない、`||` や `2>/dev/null` を付けない（allowlist は `Bash(gsd-lite-loop.sh --where:*)` だけ）」に直す（Minus 3: 7 ターンで承認待ち。turn 2 は止まったまま in-repo 形と推測して進んだ）
- [ ] `.claude/settings.json` の `permissions` に `additionalDirectories: ["~/.cargo/registry/src"]`（読み取り専用の参照先）を足し、research / impl スキルの注意「cargo レジストリは作業ディレクトリ外で止まる」を「`~/.cargo/registry/src/*/rhai-*/src/...` は `cat` / `rg` で直接読める」に差し替える。足さない場合は research スキルに「クレートのソースは `cargo metadata` で版を取り WebFetch で GitHub の同じタグを読む」を正規手順として書く（Minus 3: 3 ターンで 6 件）
- [ ] impl スキルの「PLAN 訂正」の手順に「旧文字列の検索語にバックティック・`$`・`|` を含めない（`git grep -n -F` でも承認待ちになる）。バックティックを含む旧文字列は、その前後の部分だけを `-F` で引く」を足す（Minus 3: turn 4 / 13）
- [ ] gsd-lite-loop.sh のトークン輪番を「直前に記録した `rate_limit.five_hour` が 0.95 以上、または `resets_at` が未来の rejected を持つトークンは飛ばす」に変え、rejected で返った試行は sleep せずに即座に次のトークンで再実行する。あわせて turns.jsonl の rejected 行に `rejected: true` を足し、reflect スキルの集計式に `rejected` の列を加える（Minus 4: 30 分の sleep。Interesting 2 / 3: 記録上リトライが見えない・負荷が偏る）
- [ ] plan スキルの追従先チェックリストの規則「`0 件` の条件は plan で一度実行」を「**実行したコマンドをそのまま**『確かめ方』欄に貼り、出力の行数を『現在』欄に写す（手で書き写さない）。パイプ（`| wc -l`）や作業ディレクトリ外のパスを含む確かめ方は書かない」に強める（Minus 5: 行 1 の正規表現と行 14 のパイプ）
- [ ] impl スキルの並列サブ作業の依頼文テンプレートに 2 行足す: 「完了基準の `git grep -F '<識別子>'` が見る識別子は本文にその綴りで必ず出す（日本語の言い換えで済ませない）」「統合前に親が `bunx vp check <A / B が触ったファイル>` を掛け、lint 警告を親が直す」（Minus 6: turn 9 / 11 のやり直し）
- [ ] plan スキルの R5 型（堅牢性の格子）タスクの完了基準に「格子とは別に、受け付けた値がホスト → エンジン → スクリプト → state を**往復**して handler に 1 回届くことを実 WASM で見るテストを、境界値（深さ上限・サイズ上限・文字コードの端）ごとに 1 本」を要求する。verify スキルの round 1 観点にも「往復プローブ」を固定する（Plus: 往復プローブが F2 を拾った。格子 1 層では原理的に見えない）
- [ ] plan スキルの F タスクの書き方に「round 2 が判定に使うプローブ / テストを名指しし、round 1 のプローブが修正後も FAIL のまま残る理由があれば F タスクに書く」を足す（Interesting 5: turn 16 / 17 の申し送りが要った）
- [ ] impl スキルの並列サブ作業の手順に「テスト担当は各ケースに『旧実装（`main`）なら何で落ちるか』を 1 行添えて報告する（A が先に着地すると B は green しか見られない）」を固定する（Interesting 4: turn 3 / 4 の運用。スキル未反映）
- [ ] 全スキル共通「無人ターンのシェルの作法」に 2 行足す: 「長いコマンドのログは `> file 2>&1` で取り `| tail` を使わない（`tail` がバッファして取りこぼす）」「`sed -i` は使わず `Edit` で直す。allowlist を迂回するために scratch の `.sh` に包んで `bash` で実行しない」（Minus 2: turn 12 の 600 秒、Minus 3: turn 8 / 13）
- [ ] 次のマイルストーンの research は VERIFICATION 残留リスク 1（成功本文 900 KB の深さ 128 超と孤立サロゲートのエスケープが `onError` だけになる）・2（download で 200 の読み取り失敗が `CLEANUP` になる）・3（イベント payload 等ホスト → WASM の他の文字列も同じ serde_json の制約）を入力にし、plan は 1 と 2 を T1 相当の最初のテストタスクに置く（今回の T1 が 12.0 分で片付いた形を踏襲。VERIFICATION round 2 残留リスク）
