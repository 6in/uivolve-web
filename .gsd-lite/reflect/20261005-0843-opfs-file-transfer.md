# 振り返り — opfs-file-transfer（2026-10-05 08:43）

- 種別: ループ（verify 合格後）、fix_round=0
- 対象範囲: 3bddfdf85a6b94e8dbbaecab7367af700259e4cb..5ee31355c598e4b63b6b61656721681e42ae0ae0（38コミット）/ ターン1〜20
- 範囲の説明: base=mainへローカルマージ済みのため、main...HEADは空。turns.jsonlのresearch開始head_beforeを起点として、マージ・管理コミットを含む実際の履歴を集計した。
- 前回の振り返り: なし（reflectディレクトリに既存ファイルなし）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル |
| -------- | -------- | ------ | ---------- | -------- | ------------ | -------------- | ------------- | ----------------- |
| research | 1        | 1      | 5.55       | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |
| plan     | 1        | 1      | 5.10       | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |
| impl     | 16       | 16     | 78.77      | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |
| verify   | 2        | 2      | 5.53       | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |

- 合計20試行、5,697秒（94.95分）。これは試行内の所要であり、対話介入・停止中の待機時間を含まない。本reflectは進行中で未集計。
- Codex total_tokens: research=106,754、plan=82,811、impl=1,149,346、verify=122,725、合計1,461,636。入力/出力への分解は記録なし。
- 権限拒否（permission_denials）: 全行で項目の記録なし。「拒否なし」とは判定できない。PROGRESS turn1/2にはctx_compose等の承認ポリシー拒否、turn3にはlocalhost EPERMの記録がある。
- 無進捗試行: 0（全行progressed=true）。BLOCKED状態のコミットも進捗に含まれる。
- 計画タスク数 / implターン数: 初回12 / 16。T1・T10・T11の停止/再開で各1ターン追加、verify差し戻しF1で1ターン追加。最終PLANは13項目完了。
- verify差し戻し: verify_round=1、指摘1件（Content-Type既定）。BLOCKED=3回（turn3: localhostと書式、turn13: Rhai CSV加工、turn15: ブラウザ認証fixture）。すべて再開後に完了。
- 前回の提案の反映: 対象なし。PLANにも前回ファイルなしと記録されている。
- 実行設定: engine=codex、phase_engines空、Codexモデル/effort未指定、subagents=auto。stateのClaude用model値を実行モデルとして扱わない（DECISIONS実行設定）。並列サブ作業はPROGRESS turn12/17/18等に記録がある。

## Plus（うまくいったこと）

- RESEARCHの排他・cleanup・世代・全量読込禁止をPLANの採否表とT3/T6/T8/T9/T11へ対応付け、実WASMと実ブラウザまで検証した（根拠: RESEARCH統合提案、PLAN落とし穴表、PROGRESS turn12/16、VERIFICATION）。
- 最終判定はJS614件、Rust15件、文書445リンク、buildとChromium152のDOM/Canvas・100 MiB GET/File/FormData・2タブ排他まで成功。mockだけの合格を避ける要件が記録上守られた（根拠: VERIFICATION turn20、PROGRESS turn20）。
- BLOCKED時は未検証差分と未完了チェックを保持し、対話修正後に別ターンで再検証・完了コミットした。停止後の手順が明確だった（根拠: b88009e→b8848f9、4c48111→8223e97、f869419→24b1f13、各PROGRESS再開欄）。
- 全試験成功でもverifyの要件照合がContent-Type違反を再現し、F1追加→受信側回帰→合格に繋げた（根拠: cc25ac4、178a9ea、67c1d8f、VERIFICATION F1）。

## Minus（問題・無駄・やり直し）

- localhost bind拒否と既存管理文書11件の書式不一致でT1が停止し、対話で環境変更・整形が必要だった（根拠: b88009e時点BLOCKED、2f79ddf、DECISIONS再開設定）。推測: 開始前に実行環境と管理文書を含むcheckを確認していれば、この停止を早めに発見できた。
- PATH上のgsd-lite-loop.shを使う申し送りがあっても、複数ターンで存在しない.gsd-lite配下を再度指定した。本reflectでも同じパス誤りを1回修正した（根拠: PROGRESS turn1/2/4/5/7/8/10〜20、本turnのツール実行）。入口の具体的な呼び出しがスキルに固定されていない。
- T10/T11のfixture・実行環境差異が2回の立て直し上限を消費し、Rhai replaceのunit戻り値と認証token不一致で停止した（根拠: 4c48111/f869419時点BLOCKED）。T11では実行中の整形がVite再読込を起こしcleanupが元の失敗を隠した。
- Content-Type欠落を既存試験が正解として期待し、T12の全試験成功でも契約違反が残った。F1は5回の立て直しを要した（根拠: VERIFICATION F1、PROGRESS turn18/19）。推測: 要件既定値と受信ヘッダーの対応を最初から試験表に含めると、実装依存の期待値を防げる。

## Interesting（気づき・意外だったこと）

- ループ上は全20試行rc=0/progressed=true/attempt=1だが、PROGRESSは3回のBLOCKEDとターン内修正を記録している。リトライ0は停止や手戻り0を意味しない（根拠: turns.jsonl turn3/13/15、対応するBLOCKED履歴）。
- PROGRESS turn13はturn12の追記不足を述べるが、現在のPROGRESS先頭にはturn12が存在する。現存文書の順序も時系列ではない。追記時期の理由はこの記録だけでは確定できない（根拠: PROGRESS先頭とturn13想定外）。
- Chromiumは拡張子からFile.typeを推定し、Bunのmultipart解析も型を補うため、空typeには拡張子なし、受信型には生MIMEヘッダーが必要になった（根拠: PROGRESS turn19）。標準APIの実測がfixtureの想定を修正した。
- stateにClaude用モデル名が残る一方、実行ログはcodex/model空。コストとモデル比較はこのログからできない（根拠: state.json、DECISIONS実行設定、turns.jsonl）。
- mainはgithub/mainを追跡しているがverifyはorigin未設定としてローカルマージを選択した。完了記録はローカルまでである。別ブラウザ・内部buffer・サーバー巻き戻しの保証は残留リスクとして明記済み（根拠: PROGRESS turn20、VERIFICATION残留リスク/マージ結果）。

## 次回への提案（実行可能な形で）

- [ ] 6フェーズの作業場所解決の例をPATH上の `gsd-lite-loop.sh --where` に統一し、存在しない相対パスを試さずに開始する（Minus: 反復したパス誤り）。
- [ ] discussの起動前確認にlocalhost起動・終了の最小プローブと管理文書を含むcheckを追加し、実行環境を確定してから無人ループを開始する。権限拒否を受けるctx_composeは読み取り代替を明記し、不要なら無人allowlistでdeny扱いを固定する（Minus: T1停止、PROGRESS turn1/2）。
- [ ] T10型のサーバーfixtureと実WASMサンプルを別タスクへ分け、サーバーの型/長さ/空file挙動、fetch wrapper、Rhai戻り値を各完了基準で確認する（Minus: T10立て直し上限）。
- [ ] ブラウザ試験は整形完了→起動の順を固定し、認証tokenをfixture間で共通化する。cleanup失敗は元の失敗と別に記録する（Minus: T11停止）。
- [ ] PLANのAPI既定値表にContent-Type省略/明示、空type、POST/PUT、multipart boundaryを列挙し、要件から受信ヘッダーの期待値を決める。型は生MIMEでも照合する（Minus: F1、Interesting: 型推定）。
- [ ] ループログにblocked終端・ターン内立て直し数を別項目で記録し、PROGRESS見出しの一意性とstate.turnに対応する記録をコミット前に確認する。モデル/usage/permission_denialsの未取得値も明示する（Interesting: 集計と記録の差異）。
