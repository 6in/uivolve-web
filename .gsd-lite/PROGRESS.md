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

## turn 4 — impl — T2 根拠付き日本語原稿と掲載例の実行確認

- やったこと: 必須8節の日本語原稿と4画像の相対参照/alt/説明を追加し、実装・契約・履歴の根拠台帳を更新。本文7926字、AI1979字（24.968%）でdraft成功。依存確認/WASM生成、対象UT16件、掲載JSON/Rhai/YAMLと2つのJSフェンス直接実行、OPFS20試行5697秒再集計、check（218整形/92lint/cargo fmt）、docs:check（445リンク/56文書）、diff check成功。実装コミット0a08ab8。既存テスト期待値の変更なし。
- 想定外: 最初に存在しない./gsd-lite-loop.shを指定した。ctx_searchのqueriesに非対応fileキーを渡した。scratch再集計でduration_sを確認する前にelapsed_secと書きNaNになった。掲載例の実行自体は初回から成功。
- やり直し: 3 回（PATH入口へ修正、検索をrgへ修正、ログの実キーduration_sへ修正）。原稿/掲載例の立て直しは0回。
- 次への注意: 次はT3のみ。PATH上のgsd-lite-loop.sh --whereを使う。ログ集計はduration_s。本文は上限まで74字なのでT3以降の説明追加時は再計数し推敲する。画像は未生成、撮影未実施、docs入口はT5。ブラウザ描画前にplaywright-skillを読み、日本語3図を800px幅で実PNG目視する。T3は並列サブ作業3件あり、担当を分離して統合後に親が台帳を更新する。phase=impl、next_command=/gsd-lite-implを保持。

## turn 5 — impl — T3 日本語技術図3枚の制作

- やったこと: 担当を分離した3並列作業でarchitecture/event-flow/host-effects PNGを制作し、親が800px幅の実画像と本文/実装を照合。制作ソース/再作成方法/寸法/フォントを台帳へ記録。diagrams（7926字/AI24.968%）、依存確認、WASM生成、対象UT16件、check、docs:check、diff check成功。実装コミットa991f9e。既存テスト期待値の変更なし。
- 想定外: 最初に存在しない.gsd-lite/gsd-lite-loop.shを指定しPATH入口へ修正。3担当のbundled Chromiumが未インストールで、既存の可視Chromiumへ切替。親のhost-effects縮小画像パスを誤り、実在の-preview.pngへ修正。
- やり直し: 親2回（loop入口、縮小画像パス）。担当の起動修正各1回、配置修正architecture1回/event-flow2回/host-effects1回。検証失敗に対する立て直し0回。
- 次への注意: 次はT4のみ、実Hello World撮影と記事専用撮影スクリプト。PATH上のgsd-lite-loop.sh --whereを使う。Playwrightのbundled Chromiumがないため既存/snap/bin/chromium（/usr/bin/chromium-browserも入口）を使った。制作ソースはscratch、技術PNGは追跡済み。本文上限まで74字。整形→build→preview→撮影の順、実Canvas画素を開いて読む。phase=impl/next_command=/gsd-lite-implを保持。

## turn 6 — impl — T4 実Hello WorldのDOM/Canvas操作と撮影

- やったこと: playwright-skillを読み、管理文書整形→本番build→自己管理preview→可視ChromiumでDOM/Canvas各起点の実入力/押下・入力のみ不変・空白Worldを11チェック。両側Hello 太郎の実比較領域PNG（1225×296）を保存し、Canvasの実画素と日本語/切れ/重なりを目視確認。ブラウザ/OS/URL/viewport/操作/PNG検査/サーバー終了を台帳へ記録。frozen install、WASM生成、対象UT16件、diagrams、docs:check、check成功。実装コミット33a54d3。既存テスト期待値の変更なし。
- 想定外: 存在しない./gsd-lite-loop.shを指定しPATH入口へ修正。lean-ctxのプロジェクト外skill読み込みは拒否され通常読取へ切替、ctx_searchの非対応pathキーを修正。初回撮影で実Rhaiにない末尾!を検証側で期待しtimeout。CSS領域の小数座標がPNGの画素寸法へ丸められるため台帳はdecodePngの実寸を採用。
- やり直し: 1回（撮影の末尾!を実Rhaiと同じHello 太郎/World/花子へ修正、再撮影成功）。成功時はpreview/ブラウザ終了、cleanupErrorsなし。
- 次への注意: 次はT5のみ、docs入口と最終照合/verify-retrospective。PATH上のgsd-lite-loop.sh --whereを使う。撮影スクリプトは既存/usr/bin/chromium-browserを可視起動しpreviewを自己管理、4174が使用済みなら失敗。文書整形→build→撮影順を守る。Rhai挨拶に末尾!はない。PNG寸法はCSS領域から推測せずdecodePngで確認。本文7926字/AI24.968%、入口未追加のためcompleteはT5。phase=impl、next_command=/gsd-lite-implを保持。

## turn 7 — impl — T5 文書入口・最終要件照合

- やったこと: docs入口1件を追加し、必須8内容/ABI/WebMCP/モック/UT/転送/履歴/未取得境界を本文・図・根拠台帳で最終照合。整形後にverify-retrospective全8工程成功（対象UT16件、check、446リンク、build、complete、実ブラウザ11操作）。本文7926字/AI24.968%、4PNG目視と再撮影/cleanup成功を台帳へ記録。実装コミット3c4f149。既存テスト期待値の変更なし。
- 想定外: 最初に存在しない.gsd-lite/gsd-lite-loop.shを指定した。PATH上の入口へ修正して作業場所を解決。再撮影でCPU計測値の表示が変わりPNGを更新した。
- やり直し: 1 回（loop入口をPATH上へ修正）。実装/最終検証の立て直し0回。
- 次への注意: 全5タスク完了、phase=verify/next_command=/gsd-lite-verifyへ遷移。PATH上のgsd-lite-loop.sh --whereを使う。独立判定はbun scripts/verify-retrospective.mjs、既存可視Chromium/DISPLAY/空いている4174が必要。根拠台帳のT5と最終ログ/撮影証跡を参照。実IME/支援技術/実Worker/CORS/GPU性能/モデル費用は今回未取得。

## turn 8 — verify — 合格・mainへローカルマージ成功

- やったこと: 全diffのコード/セキュリティ/要件照合、最終判定8工程、掲載断片と23境界項目の再実行、4画像の目視確認。originなしに従いmainへno-ffマージした。
- 想定外: 初回のループ位置指定 .gsd-lite/gsd-lite-loop.sh は存在せず、PATHのgsd-lite-loop.shで位置を解決した。
- やり直し: 1 回（--whereの実行パスを修正）。検証の再試行は0回。
- 次への注意: phase=reflect、次は/gsd-lite-reflect。ループスクリプトはPATHのgsd-lite-loop.sh。最終ログverification-1791169067100.log、撮影capture-1791169073459.json。push/公開なし。
