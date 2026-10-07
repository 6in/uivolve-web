# 検証・レビュー基準

テストは部品の状態・イベント・座標の結果を確認する。定数の写しや実装と同じ条件式だけを検査するテストを増やさない。

## コマンド

```sh
bun run fmt
bun run test
bun run build
bun run check
bun run docs:check
```

`test`は実際のWASMをビルドしてVitestを実行し、その後Rustのテストを実行する。テストのWasmEngineは、ビルド済みモジュールからテストごとに独立したインスタンスを作る。`build`はWASMのimportが空であることも確認し、本番配信物を生成する。`check`はOxfmt/Oxlintとrustfmt。`docs:check`はリポジトリ内Markdownのインライン相対リンク先ファイルの存在を確認する。見出しアンカー、外部URL、文書内容の正しさは別途確認する。

文言・文書だけの変更は、内容・リンク・必要なビルドを確認する。新たな懸念がなければ全ブラウザテストを繰り返さない。エンジン・操作・フォーカスに触れる変更は、その振る舞いを確認できる範囲までテストする。

AI向けスキルは[スキル案内](skills.md)に従う。`tests/skills.test.js`は配布用フォルダーをリポジトリ外へ移して相対リンクを検査し、同梱YAML/Rhaiの実WASM動作と型違反時の保持、再生成時の出力範囲を確認する。

`tests/distribution.test.js`はClaudeプラグインZIPの展開とカタログのハッシュ、Pagesの全画面の入口、初回リリース前の空カタログを確認する。公開後にはサブディレクトリの実URLで直接表示・再読み込み・HTTP取得を確認する。

## 自動テストの役割

| ファイル                                      | 主な対象                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tests/abi.test.js`                           | 公開関数とimport、UTF-8応答、壊れた入力、Runtime/テーマの独立性と巻き戻し               |
| `tests/engine.test.js` / Rustのlib.rs内テスト | 画面load、Rhai、イベント、上限、パネル/window、テーマ                                   |
| `tests/fields.test.js`                        | 入力型、選択肢、既定値、readOnly/disabled、値検証                                       |
| `tests/grid-navigation.test.js`               | 安定ID、ソート・検索・ページ、編集下書き、タブ・ツリー・メニュー                        |
| `tests/gallery.test.js`                       | 追加部品、図表・文書・メディア契約、ダイアログなど                                      |
| `tests/layouts.test.js`                       | Grid span、幅に応じた配置、Border/Fit、Card状態・可視性・WebMCP                         |
| `tests/kanban.test.js`                        | 列移動・順序・空列、Rhai拒否と状態保持、幅・無効・modal、WebMCP、ポインター中止         |
| `tests/widget-contract.test.js`               | 物理/意味的操作、readOnly・modalガード、カタログとパッケージの整合                      |
| `tests/webmcp.test.js`                        | ツール経由の実WASM操作、stale/token、可視性、登録・中断処理                             |
| `tests/resource-client.test.js`               | HTTP/CORS設定、JWT切替・送信先、トークン更新、中断・失敗・認証付きWASM起動              |
| `tests/http-grid.test.js`                     | RhaiのHTTP依頼と完了、JSON検証、一覧保持、重複・失敗の巻き戻し、中止・タイムアウト      |
| `tests/page-navigation.test.js`               | 別のYAML/Rhaiへの遷移・往復、失敗時の画面保持、state検証・上限・URL拒否・古い失敗の無視 |
| `tests/native-extensions.test.js`             | 実WASMでのRust関数呼び出し、Unicode・キャプチャ・置換、集計、容量と型エラー時の巻き戻し |
| `tests/platform-features.test.js`             | YAML/JSON互換、URL解決、型・bind・動的部品の検証、保存依頼・完了・中止とOPFS確定        |
| `tests/font-parity-runner.test.js`            | 最終判定gateの順序と失敗伝播、未知suiteの拒否、xtypeとkindの照合、状態一覧の担当suite   |

## 部品変更の確認

`tests/dynamic-ui.test.js`はitemsBind展開、動的部品のイベントと初期値、構造と状態の巻き戻し、上限、非表示/モーダル遮断、WebMCPを検証する。`dynamic-tabs`画面では両方式からのタブ追加、各タブの入力・確認、切替時の保持、8タブ上限をブラウザで確認する。

`tests/resource-refresh.test.js`は実際のResourceClientを通し、JSON/OAuth、401の再試行、期限前更新、同時要求・遅れた401、トークンのローテーション、キャンセル・認証解除、タイムアウト、失敗時の停止を検証する。ブラウザでも更新POSTのCORSと、更新失敗時の画面状態保持を確認する。

すべての部品に同じ数のテストは要求しない。変更する契約に応じて、次の観点を選ぶ。

- 未知xtype/属性、範囲外、型違い、重複ID/選択肢などがloadまたはeventで拒否される。
- 正常イベントが正しいstateを更新し、revisionが進む。hidden/disabled/モーダル背後では進まない。
- Rhaiが失敗したとき、組み込みの更新も確定しない。Gridでは入力下書きと元データを区別する。
- init後・handler後に部品固有の状態が有効。失敗した画面の置き換えは以前のRuntimeを保つ。
- narrow/desktop幅で座標が有限、寸法が非負、必要な内容が親やSceneをはみ出さない。入力配置とヒット判定が一致する。
- WebMCPに可視のkey、型付き値、許可actionだけが出る。古いtoken/revision、非表示・無効部品を操作できない。

## ブラウザ確認

`bun run build`後に`bun run preview`で確認する。DOMとCanvasのどちらから操作しても、同じ状態が両方へ反映されることを見る。幅は通常のデスクトップと390px前後の画面、エンジン単体では240pxの下限も確認する。

| 画面ID            | 主な操作                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------- |
| orders / tasks    | 検索・選択・編集・追加、HTTP再取得、定義適用失敗、状態同期                               |
| hello-world       | 名前入力、押下まで結果保持、日本語の挨拶、空欄のWorld、HTTP再取得による初期化            |
| http-grid         | DOM/CanvasからGET、取得中の無効化、Grid表示、失敗と再試行、画面切替時の遅延応答破棄      |
| storage-lab       | YAML読み込み、両方式の保存・復元・削除、再読み込み後の保持、型違反の状態保持、メタデータ |
| native-extensions | 正規表現の実行・日本語・結果保持・不正パターン、整数集計、両方式とWebMCPからの操作       |
| components        | 折りたたみ、重なるwindow、背後への遮断、Tab/Escapeと閉じた後のフォーカス                 |
| uivolve-forms     | 各入力型、選択、スライダー、入力要素の保持                                               |
| grid-lab          | ソート・検索・ページ・複数選択、Enter/Escape編集、Rhai拒否、タブ・ツリー・メニュー       |
| uivolve-gallery   | 6タブの基本動作、ダイアログ、文書・図表、メディアの保持と終了                            |
| layout-lab        | Grid列数/span/行高、Card入力保持、Border/Fit、両方式からの操作                           |

入力やフォーカスに触れた場合は、変換開始→変換中の入力→テーマ/再描画→変換終了という流れを確認する。合成したCompositionEventはイベント処理の確認であり、実IMEの変換候補位置・OS固有動作の保証にはならない。実IMEとモバイルキーボードは対象OS/端末で手動確認する。

WebMCPはJS単体テストに加え、対応ブラウザの登録・発見・実行を確認する。未対応環境でもUIが動くことを見る。中断については[WebMCP契約](webmcp.md)のChromium 152の制限を区別する。

HTTP取得・認証に触れた場合は、別オリジンの実HTTPサーバーでAuthorizationのOPTIONS→GET、401/403、未許可のscript URL、リダイレクトの拒否、JWT無効化・再読み込み後の破棄を確認する。画面・スクリプトの失敗で以前のstate/revision、テーマの失敗で以前の配色が残ることを見る。CORSはmock fetchだけでは検証できないので、ブラウザでも確認する。

DOM版とCanvas版で同じ役割の文字が同じ実効サイズで出ているかは、[レンダラー間のフォントサイズ台帳](renderer-font-parity.md)に実測値・検査方法・限界をまとめている。CSSの宣言値を読み比べるのではなく、`getComputedStyle`の計算値と実際の`fillText`/`measureText`を実ブラウザで採って突き合わせる。

恒久的なPlaywright実行スクリプトは3本ある。うち検査の系統は2つで、もう1本は記録用の撮影スクリプト（`scripts/capture-retrospective.mjs`。比較デモのHello Worldをブログ記事の画像として撮る。`package.json`のscriptsには入れていない）。OPFS転送は`bun run test:transfer:browser`（`scripts/test-transfer-browser.mjs`）と最終判定の`bun run verify:transfer`。レンダラー間のフォントサイズは`bun scripts/test-font-parity-browser.mjs --suite <名前>`（`--list`で登録済みsuiteと実装状態、`--browser-path`/`--browser-endpoint`でブラウザ経路、`--viewport`で幅、`--evidence`で証跡の出力先を選ぶ）と最終判定の`bun scripts/verify-font-parity.mjs`。対象範囲は先に固定してあり、どちらもLinuxのシステムChromium（headless）を使い、`bunx vp dev`を127.0.0.1のOS自動割当ポートで自分で起動して終了させる。既存のサーバーへは接続しない。新しい依存は追加しておらず、既存の`playwright` devDependencyだけを使う。CI用ブラウザ環境は引き続きリポジトリへ同梱していないので、これらは手元で実行する。

エンジン内部のリファクタが応答を変えていないかは、ブラウザを使わない照合スクリプト3本で見る。`bun scripts/compare-engine-behavior.mjs --base <wasm> --candidate <wasm>`は固定clockで全画面のload・イベント・完了・layoutを2つのWASMへ流し、応答JSONの文字列一致を数える（差分0でexit 0、差分ありでexit 1。証跡は`--evidence`の既定`target/engine-compare/compare.json`。約1秒）。比較対象のWASMは`bun scripts/build-engine-variant.mjs --commit <rev> --out <wasm>`が別コミットから、`--mutation <名前> --out <wasm>`が意図的に壊した変種から作る（どちらも作業ツリーの`engine/`は触らない。初回約30秒、cargoのtarget-dirを共有する2回目以降は約10秒）。最終判定は`bun scripts/verify-instance-refactor.mjs`で、既存の全検査（`build:wasm`→`vp test run`→`test:rust`→`check`→`docs:check`→`build`）のあとにbaseとの照合が差分0であること、さらに変異3本の照合がいずれも差分を見つけること（exit 1。exit 0なら照合に歯が無いとして失敗）を確認し、手順ごとの所要と合計を表で出す。`--base-commit <rev>`で比較元を選び、`--skip-mutations`は開発中の短縮用で最終判定では付けない。これらは一時的な照合用で`package.json`のscriptsには入れていない。

## レビューに残す情報

変わる動作、以前のパッケージへの影響、実行したコマンドとブラウザ操作、未確認・未対応範囲を記す。性能値を示す場合は、WASM計測・DOM更新・Canvas命令発行など測った対象を明記する。再描画のCPU時間をGPU完了やFPSと混同しない。

文書中のHTTP例は[documented-http.test.js](../tests/documented-http.test.js)がYAMLとRhaiを直接抽出して実WASMへ通す。複数パス変数、日本語・予約文字のエンコード、JSON本文、成功・不正値の完了handlerを確認する。単なるリンク検査とは別に、例が実行できることを検査する。
