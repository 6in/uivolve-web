# 振り返り — component-webmcp（2026-10-10 02:51）

- 種別: ループ（verify 合格後。verify round 2 で合格、PR #5 作成済み。マージは人間 / CI）
- 対象範囲: main `52ec888`...HEAD `53872c4`（コミット 24 件。discuss 1 / research 1 / plan 1 / impl 18 / verify 3）/ ターン 1〜13
- 前回の振り返り: 20261009-1151-component-loader.md（その前 20261009-0342-component-effects.md）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル         |
| -------- | -------- | ------ | ---------- | -------- | ------------ | -------------- | ------------- | ------------------------- |
| research | 1        | 1      | 13.5       | 0        | 59,017       | 4,118,517      | 8.84          | claude / claude-fable-5-1 |
| plan     | 1        | 1      | 10.5       | 0        | 47,798       | 2,639,017      | 6.69          | claude / claude-fable-5-1 |
| impl     | 9        | 9      | 98.8       | 0        | 191,700      | 54,660,530     | 64.33         | claude / claude-opus-5    |
| verify   | 2        | 2      | 15.0       | 0        | 68,115       | 6,970,371      | 13.72         | claude / claude-fable-5-1 |

- 合計 13 試行・8,273 秒（137.9 分）・93.59 USD。全試行 `attempt=1` / `rc=0` / `progressed=true`
- 壁時計: turn 1 開始 00:30 JST → turn 13 終了 02:48 JST（137.8 分）。試行の合計との差は 0 分（BLOCKED・人間待ち 0）
- 前回（component-loader）との比較: 14 試行 / 142.4 分 / 99.34 USD → 13 試行 / 137.9 分 / 93.59 USD（時間 −3 %、コスト −6 %）。製品側の差分は前回 39 ファイル / +4,166 / −1,194 に対し今回 25 ファイル / +1,134 / −92 で、差分量は約 1/4（Interesting 4）
- impl のターン別所要（分）: T1 13.2 / T2 13.8 / T3 10.0 / T4 9.0 / T5 11.6 / T6 5.9 / T7 10.9 / T8 9.0 / F1 15.4。最長は F1（製品コード 5 行 + 文書 3 文。Minus 2）、最短は T6（probe 列と変異 M8。サブエージェントなし）
- サブエージェントを使ったターン（turn 3 / 4 / 7 / 9 / 12）のコスト平均 8.47 USD、使わなかった impl ターン（turn 5 / 6 / 8 / 10）の平均 5.49 USD（Interesting 1）
- 権限拒否（permission_denials）: なし（13 試行すべて `[]`）
- 無進捗試行: 0
- 利用枠（`rate_limit.five_hour`）: turn 1 の 0.08 → turn 13 の 0.39（1 マイルストーンで 5 時間枠の 31 % を消費。前回 27 %。`seven_day` は 0.48 → 0.51）
- `usage` の注記: turns.jsonl のキーは `usage` / `cost_usd` / `token_var` / `duration_api_ms` で、前回提案の `usage_total` は無い。前回と同じく `usage.output_tokens` はサブエージェントを使ったターンで小さく `cost_usd` は大きいので、`usage` は親セッションのみ・`cost_usd` はサブエージェント込みと**推測**して、ターン間の比較は `cost_usd` で行う

- 計画タスク数 / impl ターン数: 8 / 9（T1〜T8 は 1 タスク = 1 ターンぴったり。残り 1 ターンは verify round 1 の差し戻し F1）
- verify 差し戻し: verify_round 1 回（指摘 1 件 F1 = コード 1 行 + テスト 2 本 + 契約文書の 3 断言）/ BLOCKED: 0 回（`git log --all -- .gsd-lite/BLOCKED.md` に対象範囲のコミットなし）
- 前回の提案の反映: **11 件中 10 件が守られた**。提案 1〜8 と 11 は discuss のコミット `e613283` でスキル 3 ファイル（impl +7 / plan +16 / verify +5 行）に入り、提案 10（残留リスクを research の入力に）は REQUIREMENTS R0 / R0b / R0c と T1 / T2 に写った（PLAN「メモ」の反映表 7 行）。**提案 9（turns.jsonl の `usage_total`、または reflect スキルの注記）は反映されていない**（上の注記のとおりキーに無く、reflect スキルにも注記は無い。Minus 7）

## Plus（うまくいったこと）

- 13 ターンすべてが 1 試行で進み、リトライ・無進捗・BLOCKED・権限拒否がゼロ。壁時計と試行合計の差も 0 分（根拠: turns.jsonl 全行 `attempt=1` / `progressed=true` / `denials=[]`、`started_at` 15:30:48Z と最終コミット 02:48:33 JST）
- 計画 8 タスクが 8 ターンで完了し、各 impl ターンが「実装コミット + 申し送りコミット」の 2 件で揃っている（根拠: git log `833a622`/`f3f1e1a` 〜 `790d32b` の 15 コミット + F1 の `eaaef82`/`49ef038`。T8 はコード変更 0 行なので 1 コミット）
- **整形起因のやり直しが 0 回**（前回 4 ターンで各 1 回）。前回提案 1（`check` の前に `bunx vp fmt`、整形後に再テスト）が impl スキルと PLAN「検証コマンド」に入り、turn 7 / 8 / 9 は「整形 → check → docs:check が 1 周で green」（根拠: PROGRESS turn 7 / 8 / 9「やり直し」欄、`.claude/skills/gsd-lite-impl/SKILL.md` の差分）
- **自分で足したテストの識別力を変異で裏取りする作法が定着した**。turn 4（R0c の 2 テストを基準を戻して赤を確認）、turn 5（`rsplit_once` → `split_once`、`instance(path)` → `root` の 2 通り）、turn 6（`hidden` 常 false / 祖先 OR 外し / state の取り違え / 順序反転の 4 通り）、turn 12（guard を `&& false` で無効化）。turn 12 では依頼文どおりの画面構成では修正前後とも green になる「空振り」をこの手順で捕まえ、テストを作り直した（根拠: PROGRESS turn 4 想定外 (1)、turn 5 想定外 (1)、turn 6 想定外 (1)、turn 12 想定外 (1)。いずれも backup から復元して `diff` 一致を確認）
- plan のターンで最終判定スクリプトを base に対して回し（exit 0、約 5 分）、チェックリストの `0 件` 条件を一度実行して現状値を書いた。その結果 RESEARCH の「6 件」が実物では 7 件、`docs/testing.md:91` の「3つの列」と `verify-instance-refactor.mjs:5` の「変異 7 本」という RESEARCH に無い追従先 2 行を plan の時点で足せた（根拠: PLAN 冒頭「前提の実測」、PROGRESS turn 2 やったこと・想定外 (1)(2)。前回提案 6 / 7 の実効）
- サブエージェントの「契約外の提案」が規律どおり処理された。turn 3 は 1 件を PLAN 訂正に採用（`rpc: [null]` の `TypeError` を実測してから）、turn 4 は 7 件を不採用で残留リスク候補へ、turn 7 は 6 件すべて不採用、turn 9 は 6 件中 1 件（リンクラベルの表記統一）だけ採用。採否の理由はすべて PROGRESS にあり、不採用分は VERIFICATION「残留リスク」4〜6 に写った（根拠: PROGRESS turn 3 / 4 / 7 / 9 の「想定外」、VERIFICATION 残留リスク）
- 既存テストの期待値変更が T1〜T8 を通じて 0 件（T3 の `window` 文言の括弧落としのみ。挙動不変）。F1 の 1 件も `find` → `filter` へ**強める**変更で期待値は不変（根拠: PROGRESS 各ターンの「既存テストの期待値変更」、VERIFICATION「既存テストの期待値の変更」）
- verify round 2 が 4.9 分・サブエージェントなしで済んだ（round 1 は 10.1 分）。「round 1 の格子の再確認 + F1 の回帰だけ」が verify スキルに入り、申し送りに頼らずに守られた（根拠: turns.jsonl turn 11 / 13、PROGRESS turn 13、前回提案 11）
- T6 の probe ステップ数が plan の見込み 57 歩と実測で一致し、変異 M8 も 1 回目から exit 1。T6 は impl 最短の 5.9 分 / 4.43 USD（根拠: PROGRESS turn 8「やったこと」、turns.jsonl turn 8）
- verify round 1 のセキュリティ観点（サブエージェント B）が NG 0 で、prototype pollution / URL の起点 / shell なしの `cargo` 呼び出し / `components[]` の出力フィールドまで根拠つきで判定した（根拠: PROGRESS turn 11「セキュリティ」、VERIFICATION「セキュリティ」）

## Minus（問題・無駄・やり直し）

- **F1 の契約文書 3 断言は T7 の「断言 → 実装シンボル」対応表（8 行）とチェックリスト行 12 を通過していた**。対応表はシンボル名の一致（`rsplit_once('/')`、`hidden_component`）で OK を出し、断言の反例（itemId の無い root ノード / `/` を含む grid 行 id / `window` の中の子）を 1 つも流していない。verify round 1 のサブエージェント A が反例を実測して初めて 3 件とも偽と分かった（根拠: PROGRESS turn 9 の対応表、turn 11 想定外 (1)、turn 13 次への注意 (ii)）— コスト: F1 15.4 分 + 8.97 USD、verify round 2 4.9 分 + 4.91 USD。原因の見立て: 前回提案 3 は「シンボルを `git grep` で引いて同じ語で書かれているか」までを条件にしたので、語の一致で止まるのは設計どおり。断言の真偽は反例でしか確かめられないが、その要求が T7 型タスクに無い
- **F1 ターンが impl 最長（15.4 分 / 8.97 USD）になった**。製品コードは `lib.rs` の guard 5 行、テスト 1 本 + `find` → `filter`、文書 3 文で、前回の F1 / F2 は 4.7 / 6.3 分だった（根拠: turns.jsonl turn 12、PROGRESS turn 12）。内訳は PROGRESS から (a) サブエージェント 2 本の起動と統合、(b) 回帰テストの空振りの作り直し（やり直し 1 回）、(c) `{ continue; }` 1 行形が rustfmt で展開されて `check` が落ちた再整形、(d) Rust を触ったので `build:wasm` → 全体 Vitest → 照合 → probe の全周。推測: 製品側 10 行未満の F 系修正にサブエージェント 2 本を立てるのは統合コストが実装コストを上回る。(c) は前回提案 1 の整形ルールが `cargo fmt` を含んでいなかった形
- **堅牢性格子の scratch スクリプトを turn 10 で 3 回立て直し、turn 11 でも同じ罠に 1 回落ちた**。(a) 存在しない `public/screens/grid.json`（実物は `grid-lab.json` / `hello-world.json`）、(b) `WasmEngine` のコンストラクタと `clock` のキー名の思い込み、(c) `createUiTools` を facade でなく 1 引数で呼んで catalog が空、(d) datepicker が下位 key に展開され宛先に使えない。turn 10 が「key を先にダンプ / API はテストの helper から写す」と申し送ったが、turn 11 は (a) を繰り返し、さらに `packages/<rev>/script` の `readdir` で ENOTDIR を踏んだ（根拠: PROGRESS turn 10 想定外 (1)(2) やり直し 3 回、turn 11 想定外 (2)(3) やり直し 1 回）— 製品コードの不備は 0 で、すべて計測器側。原因の見立て: 実 WASM + ツール facade を立ち上げる scratch の雛形がリポジトリに無く、毎ターン・毎マイルストーン手で書き直している（前回も `turn-011-lattice.mjs` を新規に書いた）
- **`verify-instance-refactor.mjs` の最終手順が証跡 `composition.json` を変異の結果（`problems: 2`）で上書きし、turn 10 / 11 / 13 の 3 ターン連続で手で real candidate の probe を回し直した**（根拠: PROGRESS turn 10 想定外 (3)、turn 11 やったこと、turn 13 やったこと・次への注意 (v)）— 原因の見立て: 受け入れ 5 の判定をこのファイルの `problems: 0` に置いた plan の申し送りと、スクリプトの最終手順の順序が食い違う。スクリプト側を直せば消える小さな改修だが、本マイルストーンのタスクに無く誰も着手しなかった
- **PLAN の行番号が T1 / T2 の追記でずれ、turn 4 / 8 / 9 / 10 の 4 ターンで「行番号のずれだけ。条件は同じ」の確認作業が繰り返された**（`docs/components.md:281` → `:286` → `:304`、`:172` → `:191`、`:246` → `:249` 等。根拠: PROGRESS turn 4 想定外 (4)、turn 8 想定外 (1)、turn 9 次への注意 (ii)、turn 10 想定外 (4)）— やり直しは生んでいないが、チェックリストが文字列条件で救われただけで、完了基準の本文は行番号で場所を指している。原因の見立て: plan が場所を行番号で書く習慣（RESEARCH の引用行をそのまま写す）
- **「未確認の推測」（`save()` で `metadata` が不正なとき保存全体が失敗する）が turn 3 → 10 の 8 ターン、同じ段落（約 300 字）のまま転記された**。impl スキルの新規則「最終判定型タスクは未確認の項目を実装の前に再現する」があるのに T8（turn 10）は「本マイルストーンでは手を付けていない」と書いて再現せず、verify（turn 11）が `turn-011-save-metadata.mjs` で実測して残留リスク 1 に確定した（根拠: PROGRESS turn 3〜10 の各「次への注意」、turn 11 やったこと、VERIFICATION 残留リスク 1）— 印が外れなかった点は前回提案 5 のとおりで害は無い。原因の見立て: 規則が「要件外（R0 の範囲外）の推測」を再現の対象に含むかどうかが読み取れない。PROGRESS.md も 90 KB / 約 27,000 トークンに達し（前回 reflect は 1 回で読めたが今回は 4 分割）、同文の転記 8 回がその一部
- **前回提案 9（`usage_total` または reflect スキルの注記）だけが反映されなかった**（根拠: turns.jsonl のキー一覧に `usage_total` 無し、reflect スキル本文に注記無し、PLAN 反映表「plan の範囲外。反映しない」）— 原因の見立て: 提案の宛先がループスクリプト / reflect スキルで、discuss がスキルに反映するのは plan / impl / verify の 3 本に偏っている。宛先が「ループ側」の提案には担当する場所が無い
- 小: turn 1 の実測スクリプトが OPFS 初期化の `mkdir("")` で 1 回落ちた（根拠: PROGRESS turn 1「やり直し」）。turn 10 (b) と同じ「実物の API を見ずに書いた」形

## Interesting（気づき・意外だったこと）

- **サブエージェントを使ったターンの `cost_usd` は使わないターンの約 1.5 倍で、出力トークンは逆に少ない**（turn 3: 18,141 tok / 9.54 USD、turn 7: 9,201 tok / 7.35 USD、turn 12: 11,645 tok / 8.97 USD。対して turn 6: 31,022 tok / 6.44 USD、turn 8: 22,023 tok / 4.43 USD。根拠: turns.jsonl `usage` と `cost_usd`）。前回 Interesting 1 の再現で、`usage` は親だけ・`cost_usd` はサブエージェント込みという推測を強める。同時に、サブエージェント 2〜3 本を使った T1 / T2 / T5 / T7 / F1 の所要（13.2 / 13.8 / 11.6 / 10.9 / 15.4 分）は使わなかった T3 / T4 / T6 / T8（10.0 / 9.0 / 5.9 / 9.0 分）より長い。推測: 本マイルストーンの規模（タスクあたり製品側 100〜400 行）では並列化の時間短縮が起動・統合・全周検査のコストに食われている
- **F1 の 3 断言のうち「突き合わせ規則」は plan の「決めた事項」2 が源**。決めた事項 2 は分割規則を `widget.target.rsplit_once('/')` と 1 つに決め（前回提案 2 の「基準は 1 つ」を守っている）、「同じ規則を `docs/webmcp.md` の突き合わせ規則に使う」と書いたが、実装が割るのは `target`（`a/g`）で、文書が割らせるのは `key`（`a/g:row:"x/y"`）。変数が違うので規則が移植できない（根拠: PLAN 決めた事項 2、PLAN F1 指摘 2、PROGRESS turn 11 (2)）。「基準を 1 つ」にしても、基準を**何に**掛けるかが違えば別物になる
- **root ノードの `webmcp` 漏れは base にもある既存挙動で、本マイルストーンが契約文を書いたことで「バグ」になった**。修正は base と挙動が変わるのに照合は差分 0（同梱デモの root ノードが `webmcp` を宣言していないため）で、F1 は「差分が出たらコードを戻して文書を実態に合わせる」という逆向きの規則も用意していた（根拠: PLAN F1「照合が差分 0 でない場合の規則」、PROGRESS turn 12 の表 1 行目、VERIFICATION F1 の回帰）。契約を書く行為そのものが既存挙動のテストになっている
- **製品側の差分が前回の約 1/4（+1,134 / −92 対 +4,166 / −1,194）なのに、所要とコストは前回とほぼ同じ（137.9 分 / 93.59 USD 対 142.4 分 / 99.34 USD）**（根拠: `git diff --stat main...HEAD -- src engine docs scripts tests public`、前回 reflect の計測）。推測: 時間の大半が検証（自テストの変異 7 通り、格子 50 + 88 + 18 セル、チェックリスト 14 行 × 4 回の再実行、最終判定 4 回 × 約 100 秒、変異ビルド 8 本 × 10 秒 × 4 回）に使われ、実装行数に比例していない。コストの下限は「1 ターン = 全周検査 1 回」の構造で決まっている
- **T1 が「最短ターン」の型を再現しなかった**（前回 T1 5.9 分 → 今回 13.2 分、`num_turns` 20 → 46）。前回提案 10 は残留リスクのテストを T1 に置く形を「ウォームアップとしても最適」としたが、今回は `rpc: [null]` の実測と PLAN 訂正、サブエージェント 2 本、回帰テスト 7 件 + 文書 2 ファイルで前回の 2 倍かかった（根拠: turns.jsonl turn 3、PROGRESS turn 3）。T1 が短かったのは前回の内容が小さかったからで、「最初のタスク」という位置の効果ではない
- **T8 の格子は 50 セルで NG 0、verify round 1 の格子は 88 + 1 + 18 セルで NG 0、それでも差し戻しが出た**。コード側の不備は格子では 1 つも出ず、差し戻し 4 点は全部「文書の断言と実装の食い違い」（根拠: PROGRESS turn 11 想定外 (1)）。堅牢性（R4）は満たしていて、残ったのは契約の記述の精度。前回の F1 も同じ種類（契約文書 4 か所）で、2 マイルストーン続いている
- **turn 10 の申し送り「key を先にダンプ、API は helper から写す」は翌 turn 11 で守られなかった**（`grid.json` の罠を再度踏んだ。根拠: PROGRESS turn 11 想定外 (2)「turn 10 と同じ罠」）。verify は impl の PROGRESS を読むが、「次への注意」の作法項目は次のフェーズには効きにくい。スクリプトの形で残っていれば（`turn-010-keys.mjs` はあった）使われたはずで、申し送りの文章よりファイルの方が伝わる
- **壁時計と試行合計の差が 0 分**。前回 0.2 分、前々回 0.3 分。ループのオーバーヘッドは引き続き無視できる（根拠: turns.jsonl `started_at` / `duration_s`、git log の時刻）

## 次回への提案（実行可能な形で）

- [ ] plan スキルの T7 型（契約文書）タスクの完了基準に「対応表の各断言に**反例を 1 つ**流す」を足す: 「文書が『〜は出ない』『〜だけ』『〜で割る』と断言する行ごとに、その断言が偽になり得る入力（境界の名前・区切り文字を含む値・同じ属性を持つ別ノード）を 1 つ scratch で実行し、結果を対応表の列に書く。シンボル名の一致だけでは OK にしない」。verify スキルの「契約文書 ↔ 実装の一対一」のサブエージェント依頼文にも「断言ごとに反例を 1 つ実測する」を入れる（Minus 1 / Interesting 2・6: 2 マイルストーン連続で F1 が契約文書の断言）
- [ ] plan スキルの「決めた事項」の規則に「規則を複数の場所（実装 / 文書 / テスト）へ写すときは、規則を**掛ける変数**（`target` か `key` か、URL か pathname か）を規則と一緒に書き、変数が違う場所には写さない」を 1 行足す（Interesting 2: `rsplit_once('/')` を `target` から `key` へ写して偽になった）
- [ ] impl スキルの F 系（verify 差し戻し）タスクの手順に「製品側の変更が 10 行未満かつ対象ファイルが 3 つ以下なら並列サブ作業を立てず親が直接実装する」を入れる。plan スキル側は F タスクに「並列サブ作業: なし」を既定にし、サブエージェントを使う場合は理由を書かせる（Minus 2 / Interesting 1: F1 15.4 分 / 8.97 USD。前回 F1 / F2 は 4.7 / 6.3 分）
- [ ] impl スキルの整形ルールを「`bunx vp fmt <編集ファイル>` **と** `cargo fmt --manifest-path engine/Cargo.toml`（Rust を触ったターン）」に広げる（Minus 2 (c): `{ continue; }` が rustfmt で展開されて `check` が落ちた）
- [ ] 実 WASM + `createUiTools` facade を立ち上げる scratch 用の雛形を `scripts/` か `tests/helpers/` にコミットする（`newEngine()` 相当のブートストラップ、`public/screens/` の一覧、widget key のダンプ関数の 3 つ）。次のマイルストーンの T1 か、plan の「環境の初期化」に 1 行で置く。impl / verify スキルには「格子・probe の scratch はこの雛形を `import` して書き、engine の API を手で書かない」を入れる（Minus 3: turn 10 で 3 回 + turn 11 で 1 回、前回も同型のスクリプトを新規に書いた）
- [ ] `scripts/verify-instance-refactor.mjs` の最終手順の後に real candidate の probe をもう 1 度回す（または変異の probe の出力先を `composition-mutant-<name>.json` に分ける）改修を、次のマイルストーンの T1（ハーネス整備）に 1 行で入れる（Minus 4: 3 ターン連続で手で戻した）
- [ ] plan スキルの完了基準・チェックリストの「直す場所」は行番号ではなく**アンカー**（関数名・`git grep` の文字列・見出し）で書き、行番号を書く場合は「turn 2 時点」と注記して impl は PLAN 訂正しない旨を明記する（Minus 5: 4 ターンで行番号ずれの確認作業）
- [ ] impl スキルの申し送りの規則に「持ち越す項目は 2 回目以降は『turn N の (iii) を参照。今ターンも未着手』の 1 行にし、本文を転記しない」を足し、「最終判定型タスクは未確認の項目を実装の前に再現する」に「要件外でも再現だけはして、結果を『残留リスク候補（実測済み）』として verify へ渡す」を補う（Minus 6: 8 ターン × 約 300 字の転記、T8 が再現しなかった）
- [ ] 前回提案 9 の宛先を決める: reflect スキルの「計測」節の注記として「`usage` は親セッションのみ、`cost_usd` はサブエージェント込み（推測）。ターン間比較は `cost_usd`」を書く（本振り返りの計測節と同文）。`usage_total` のループ側実装は gsd-lite-loop.sh の改修として別途 1 件起票し、discuss の反映対象に「ループ / reflect スキル」を含める（Minus 7: 11 件中 1 件だけ反映されず、宛先がスキル 3 本の外だった）
- [ ] 次のマイルストーンの research は VERIFICATION 残留リスク 1（`save()` の `metadata` 不正時に毎回失敗し `versions/` が溜まる）・4（`components` が文字列のとき `Object.keys` が文字数を数える）・5（`publish-packages.mjs` が `shape()` を通らず `rpc: null` で `TypeError`）・7（`toast` 内の子の `hidden` は未実測）を入力にし、1 と 5 を最初のテストタスクに置く。ただし「T1 が最短になる」とは見込まず、サブエージェントの有無は製品側の行数で決める（Interesting 5: T1 の短さは内容の小ささだった）
- [ ] discuss で聞くこと: 本マイルストーンの時間の大半は検証（変異 7 通り・格子 156 セル・チェックリスト 14 行 × 4 回・最終判定 4 回）に使われた（Interesting 4）。次回は (a) 同じ密度を保つ、(b) チェックリストの全行再実行を T8 と verify round 1 の 2 回に限る（T7 / F1 では触った行だけ）、のどちらにするかを決めて PLAN に書く
