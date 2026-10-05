# 開発振り返りブログ 進捗

## turn 1 — research — 記事の実装根拠・履歴・検証方法を調査

- やったこと: このrepoの共通WASM/Hello World/effects/WebMCP/Workerモックの文書・実装・UTとOPFS履歴を調査し、RESEARCH.mdへ根拠パス・再利用例・図の責務・落とし穴と検証方法を記録。OPFSログを再集計し20試行/5,697秒を確認。重大発見なし、planへ遷移する。成果物3ファイルの整形検査、git diff --check、docs:check（445リンク/56文書）が成功。
- 想定外: docs:checkはblog内部を走査せず、READMEの画面数とtestingの恒久ブラウザscript説明に古い記述が残る。最初に存在しない.gsd-lite配下のloopを指定した。root commitの親を範囲起点に指定した履歴コマンドは失敗した。
- やり直し: 2 回（loopをPATH上のgsd-lite-loop.shへ修正、root commitに親がないためa8fdffeまでの全履歴へ修正）。成果物の立て直しは0回。
- 次への注意: PATH上のgsd-lite-loop.sh --whereを使う。記事内リンク/4画像/直下5成果物/Unicode字数を個別検査し、現行実装との主張照合表をplanで固定。20試行はreflect・対話停止の待機を除く。管理文書整形後に実Hello World撮影を行い、playwright-skillを読む。研究のみのためUT・撮影は未実施。

## discuss — 仕様確定・開始準備

- やったこと: 選択式対話で主題/読者/分量/文体/図とコード/配置/追加内容/実行設定/監視方式を確定。前回OPFS成果をarchive/opfs-file-transferへ退避し、reflectとログは保持。REQUIREMENTS/DECISIONS/stateを新規マイルストーンへ更新。
- 想定外: なし。
- やり直し: 対話の仕様調整を反映（6,000〜8,000字、ポップで丁寧・絵文字多め、記事フォルダ直下のPNG4枚、WebMCP/モック/UT追加）。実装の立て直しではない。
- 次への注意: PATH上のgsd-lite-loop.shを使用。調査対象はこのrepoのみ。旧成果の根拠はarchive/opfs-file-transferと既存reflect/logs。WebMCPの既定有効範囲とUT/ブラウザ試験の境界を正確に説明。字数の除外規則を固定し、図は画像ファイルを相対参照する。
