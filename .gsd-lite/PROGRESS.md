# 進捗

## turn 1 — research — 役割別サイズとCSS継承の競合を調査

- やったこと: local_projects（`.`）と公式資料を調査し、全共通Widgetの初期対応表、再利用設計、落とし穴ごとの検証条件を RESEARCH.md に作成。要件を保持し plan へ引き継ぐ。`bun run docs:check` 成功（既存文書のローカルリンク446件）、プローブ構文確認成功、diff whitespace確認成功。実装・build・状態回帰テスト・画像確認は未実施。
- 想定外: 高詳細度の runtime `font: inherit` が部品別宣言と Canvas editor に競合。bundled Chromium は未導入、既存スクリプトと同じシステム Chromium も snap capability 制約で起動不可。lean-ctx compose は承認不可のため読取・検索で継続した。
- やり直し: プローブ再実行1回（bundled browser未導入後にシステム経路へ切替、こちらも失敗）。ツール指定修正3回（誤った相対loopパス→PATH入口、存在しないrendererファイル名→実在するsurfaces.js、ブラウザ実行パスの変更）。調査成果物の書き直し0回。
- 次への注意: loop入口は必ず `gsd-lite-loop.sh --where`。plan はブラウザ起動経路の確認を先に置き、今回のCSS解析値を実測済みと扱わない。host font-size 16/20px、Grid表示/編集、SVG倍率、遅延fontとIME/テーマ/resize競合を完了条件へ写す。システムChromiumもこのsandboxでは起動できないため同じ起動試行を無条件に繰り返さない。

## turn 2 — plan — 実測入口から独立配布まで9タスクを確定

- やったこと: REQUIREMENTS / DECISIONS / RESEARCH、実ソースと直近2件の振り返りを読み、PLAN.template形式で9タスクを作成。DOM宣言値を保つ低詳細度reset、CSSを基準にしたCanvasサイズ解決、Grid編集12px、SVG内側倍率、font/DPR通知とdisposeの方針を確定し、全受け入れ基準・落とし穴を機械検査と目視へ対応付けた。docs:check成功（446リンク）、変更3ファイルの整形検査、diff whitespace、9タスク・turn一意性/昇順・impl状態の機械照合に成功。
- 想定外: なし。researchで記録されたブラウザ起動制約をT1の停止条件として引き継いだ。計画作成で実ブラウザ実測・画像確認・製品実装は行っていない。
- やり直し: 計画の書き直し0回、検証再実行0回。ツール指定修正1回（存在しない相対loopパスを試して失敗し、PATH上の `gsd-lite-loop.sh --where` へ修正）。
- 次への注意: loop入口は `gsd-lite-loop.sh --where` を直接使う。T1で実ブラウザ経路・日本語字体・実WASM観測を確立し、不能ならT1未完了のBLOCKEDをコミットする。新suite名とCSS property名は計画上の新設名であり既存実装ではない。整形→build→撮影を守り、実IME・実ズームと代用検査を区別する。
