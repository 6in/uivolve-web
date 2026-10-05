# 振り返り — development-retrospective-blog（2026-10-05 12:00）

- 種別: ループ（verify 合格後）、fix_round=0
- 対象範囲: f473db8a73a46994e37a67669cae0639622f0853..431e1d0d170655104aa30de6d2941a985cd88f16（15コミット）/ ターン1〜8
- 範囲の説明: mainへローカルマージ済み。main...マイルストーンブランチでは統合後の管理・マージコミットしか見えないため、turns.jsonlのresearch開始head_beforeから現在headまでを集計した。discussの要件確定は起点に含まず、本reflectも未集計。
- 前回の振り返り: 20261005-0843-opfs-file-transfer.md（既存1件）

## 計測（turns.jsonl から）

| フェーズ | ターン数 | 試行数 | 所要（分） | リトライ | 出力トークン | キャッシュ読み | コスト（USD） | エンジン / モデル |
| -------- | -------- | ------ | ---------- | -------- | ------------ | -------------- | ------------- | ----------------- |
| research | 1        | 1      | 5.52       | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |
| plan     | 1        | 1      | 5.35       | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |
| impl     | 5        | 5      | 28.87      | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |
| verify   | 1        | 1      | 2.45       | 0        | 記録なし     | 記録なし       | 記録なし      | codex / 記録なし  |

- 合計8試行、2,531秒（42.18分）。試行内の所要であり、待機や本reflectは含まない。
- Codex total_tokens: research=89,603、plan=77,288、impl=436,657、verify=67,359、合計670,907。入力/出力・キャッシュ内訳は記録なし。
- 権限拒否（permission_denials）: 全8行で項目の記録なし。PROGRESS turn6にはプロジェクト外skill読取拒否と通常読取への切替がある。無人allowlist由来かは確定できないため、deny/allow追加はこの記録から決めない。
- 無進捗試行: 0（全行rc=0、progressed=true、attempt=1）。ターン内の修正回数とは別の指標。
- 計画タスク数 / implターン数: 5 / 5。追加・分割タスクなし。T3は担当3件の並列作業を親が統合（PLAN T3、PROGRESS turn5）。
- verify差し戻し: verify_round=0、指摘0件、初回合格。今回のBLOCKEDは0回。BLOCKED履歴の3停止は前回OPFSのもので、f473db8でarchiveへ退避されている。localhost/書式は環境変更、Rhai加工と認証fixtureは対話後の修正・再検証で解消した（b88009e→a6eab51、4c48111、f869419→8b3d7b0、RESEARCH履歴）。今回の停止数へ混ぜない。
- 実行設定: engine=codex、phase_engines空、codexモデル/effort未指定、subagents=auto。stateのClaude用model値は実行モデルの証拠ではない（DECISIONS、turns.jsonl）。
- 前回の提案の反映: PATH入口は採用宣言のみで、turn1〜8すべてに誤った相対パスの修正あり。起動前プローブは一部採用（T1 check/T4実起動）。整形→build→撮影とcleanup別記は反映。fixture分割は今回対象外、Content-Type表は記事の説明へ反映。未取得値の明示とPROGRESS見出しの一意性は反映したが、見出し順は3→2→1→4〜8。ループの追加計測は対象外として未実施（PLAN直近reflectの採否、PROGRESS、VERIFICATION）。

## Plus（うまくいったこと）

- 5タスクを5実装ターンで完了し、記事・3技術図・実撮影・入口を要件通り統合。本文7926字、AI1979字（24.968%）で初回verify合格した（根拠: PLAN T1〜T5、PROGRESS turn7/8、VERIFICATION、3c4f149）。
- RESEARCHの落とし穴をPLANの検査と主張台帳へ対応付けた。機械検査に加えて実例の実行と実PNGの目視を記録し、WebMCPの条件・モック/UTの境界・履歴の測定対象を照合した（根拠: RESEARCH、PLAN採否表、VERIFICATION）。
- 最終判定を8工程の1コマンドにまとめ、verifyが対象UT16件・446リンク・build・実ブラウザ11操作・掲載断片・23境界項目を独立再実行した。既存テスト期待値変更なし（根拠: VERIFICATION、438f7a2）。
- 前回の撮影中整形による再読込問題への提案を、整形→build→撮影とcleanup記録へ反映した（根拠: PLAN T4/T5、PROGRESS turn6/7、前回reflect Minus）。

## Minus（問題・無駄・やり直し）

- PATH入口をDECISIONSとPLANで固定してもturn1〜8で相対パス誤りが反復。本reflectでも最初に同じ誤りを1回修正した（根拠: PROGRESS各turn、DECISIONS実行方針、本turn実行記録）。推測: スキルの最初の実行例を具体的なPATH呼出しで示す方が、申し送りの反復より再発抑制に役立つ。
- scratchの構文抜け、ログキーelapsed_secの誤指定、撮影の挨拶に実Rhaiにない末尾!を期待したことで局所修正が発生した（根拠: PROGRESS turn3/4/6）。推測: 実行前の構文確認と実データ・実例の確認でこれらの初回失敗を減らせる。
- T3の3担当ともbundled Chromium未導入で起動方法を変更。利用可能なブラウザ経路の共有が並列制作前には揃っていなかった（根拠: PROGRESS turn5）。
- 正確な実行モデル・出力/キャッシュ・費用・permission_denialsが未記録で、フェーズの費用比較や拒否回数を評価できない（根拠: turns.jsonl、state.json、DECISIONS）。未取得値を0で補わない。

## Interesting（気づき・意外だったこと）

- 全試行attempt=1でもPROGRESSには局所的なやり直しと担当の起動/配置修正がある。turn6は複数のツール指定修正を列挙しながら「やり直し」は撮影修正1回を数えているため、欄の合計を全修正回数とは扱えない（根拠: turns.jsonl、PROGRESS turn5/6）。
- PROGRESSの見出しは一意だが時系列順ではない。記録の表示順と実行順は一致せず、turn番号とコミット日時で照合する必要がある（根拠: PROGRESS先頭turn3→2→1、git log f473db8..431e1d0）。
- 文書マイルストーンでも記事限定検査/撮影スクリプト3本を追跡し、図の制作ソースはgitignoreのscratchに置いた。最終検証の再実行と技術図の再制作は保存条件が異なる（根拠: PLAN検証方針、VERIFICATION残留リスク、git diff --stat）。
- originなしでmainへローカル統合した一方、mainはgithub/mainを追跡している。公開/pushなしという完了範囲が記録されている（根拠: VERIFICATION統合、PROGRESS turn8、git status）。

## 次回への提案（実行可能な形で）

- [ ] 6フェーズのスキル冒頭に、最初のシェル呼出しの具体例として `gsd-lite-loop.sh --where` を明記し、相対パスを作らないことを併記する（Minus: 全turnと本reflectで反復した入口誤り）。
- [ ] 並列図制作を始める前に親がブラウザ実行パスと日本語フォントを1回確認し、全担当の初期指示へ同じ値を渡す（Minus: T3の3担当の起動変更）。
- [ ] scratch実行前に構文確認を行い、ログ集計は最初のJSON行のキー、撮影期待文字列はpublicの実Rhaiを確認してから書く（Minus: turn3/4/6の局所修正）。
- [ ] PROGRESSの「やり直し」を検証再実行・ツール指定修正・担当修正に分けて記録し、turn見出しの一意性と昇順をコミット前に確認する（Interesting: 試行数と修正回数、見出し順の差）。
- [ ] ループ計測の変更を行う次回は、実行モデルとusage/費用/拒否情報について取得できた値か未取得かを明示する。stateの他エンジン設定から補完しない（Minus: 計測不足）。
