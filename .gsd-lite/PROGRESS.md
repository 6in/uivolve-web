# 開発振り返りブログ 進捗

## turn 3 — impl — T1 記事限定検査と根拠台帳の準備

- やったこと: draft/diagrams/completeの本文・字数・AI比率・例リンク・PNGデコード・配置/入口検査と、依存準備から撮影までの最終判定スクリプト、8内容/コード/画像/数値の根拠台帳を追加。scratch自己検証23項目、frozen install、check（217整形/92lint）、docs:check（445リンク/56文書）、git diff --check成功。実装コミットはf8b537b。既存テスト期待値の変更なし。
- 想定外: scratch自己検証の関数閉じ括弧が1件抜け、初回は構文エラー。実記事draftのENOENT/終了1はT2前なので想定どおり。最終判定順・終了コード伝播はspawn代替で検証し、実UT/build/撮影は未実施。
- やり直し: 1 回（scratchの構文抜けを修正）。最終確認前にfixture削除を入れ、再実行可能にした。
- 次への注意: 次はT2のみ。本文は固定順のH2・インラインリンクを使い、4PNG参照はdraftから各1件必要。PNGは非インターレース8bit灰色/RGB/灰色alpha/RGBAを使用。コード/主張の意味と画像の目視は機械検査とは別に台帳へ記録。scratchは実行前の構文確認とfixture初期化を行う。実記事draft/UT/抜粋実行はT2、撮影スクリプトはT4、最終判定はT5。phase=impl、next_command=/gsd-lite-implを保持。

## turn 2 — plan — 記事・図・実撮影・最終照合を5タスクへ統合

- やったこと: 要件/決定/research、現行コード・例・検査コマンド、直近reflectを照合しPLAN.mdを作成。記事専用のUnicode計数/リンク/PNG検査、実例確認、日本語図3枚、DOM/Canvasの実撮影、最終判定1本と主張台帳を固定。全受け入れ基準とresearchの落とし穴をタスクへ対応付け、docs:checkは445リンク/56文書で成功。
- 想定外: 最初に存在しない.gsd-lite配下のloopを指定した。DECISIONS/前回reflect/PROGRESSにPATH上の入口を使う申し送りがあることを確認した。
- やり直し: 1 回（作業場所解決をPATH上のgsd-lite-loop.sh --whereへ修正）。計画の立て直しは0回。
- 次への注意: PATH上のgsd-lite-loop.sh --whereのみ使う。次はT1。検査/撮影スクリプトはクリーンなcheckoutから最終判定可能にするため追跡し、図の制作ソースはscratchへ保存。記事限定のstage検査を使い、整形→本番build→撮影の順を守る。コード/UT/撮影はplanでは未実施。

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
