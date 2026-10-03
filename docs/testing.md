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

## 自動テストの役割

| ファイル                                      | 主な対象                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tests/abi.test.js`                           | 公開関数とimport、UTF-8応答、壊れた入力、Runtime/テーマの独立性と巻き戻し               |
| `tests/engine.test.js` / Rustのlib.rs内テスト | 画面load、Rhai、イベント、上限、パネル/window、テーマ                                   |
| `tests/fields.test.js`                        | 入力型、選択肢、既定値、readOnly/disabled、値検証                                       |
| `tests/grid-navigation.test.js`               | 安定ID、ソート・検索・ページ、編集下書き、タブ・ツリー・メニュー                        |
| `tests/gallery.test.js`                       | 追加部品、図表・文書・メディア契約、ダイアログなど                                      |
| `tests/layouts.test.js`                       | Grid span、幅に応じた配置、Border/Fit、Card状態・可視性・WebMCP                         |
| `tests/widget-contract.test.js`               | 物理/意味的操作、readOnly・modalガード、カタログとパッケージの整合                      |
| `tests/webmcp.test.js`                        | ツール経由の実WASM操作、stale/token、可視性、登録・中断処理                             |
| `tests/resource-client.test.js`               | HTTP/CORS設定、JWT切替・送信先、トークン更新、中断・失敗・認証付きWASM起動              |
| `tests/http-grid.test.js`                     | RhaiのHTTP依頼と完了、JSON検証、一覧保持、重複・失敗の巻き戻し、中止・タイムアウト      |
| `tests/native-extensions.test.js`             | 実WASMでのRust関数呼び出し、Unicode・キャプチャ・置換、集計、容量と型エラー時の巻き戻し |

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

| 画面ID            | 主な操作                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| orders / tasks    | 検索・選択・編集・追加、HTTP再取得、定義適用失敗、状態同期                          |
| hello-world       | 名前入力、押下まで結果保持、日本語の挨拶、空欄のWorld、HTTP再取得による初期化       |
| http-grid         | DOM/CanvasからGET、取得中の無効化、Grid表示、失敗と再試行、画面切替時の遅延応答破棄 |
| native-extensions | 正規表現の実行・日本語・結果保持・不正パターン、整数集計、両方式とWebMCPからの操作  |
| components        | 折りたたみ、重なるwindow、背後への遮断、Tab/Escapeと閉じた後のフォーカス            |
| uivolve-forms     | 各入力型、選択、スライダー、入力要素の保持                                          |
| grid-lab          | ソート・検索・ページ・複数選択、Enter/Escape編集、Rhai拒否、タブ・ツリー・メニュー  |
| uivolve-gallery   | 6タブの基本動作、ダイアログ、文書・図表、メディアの保持と終了                       |
| layout-lab        | Grid列数/span/行高、Card入力保持、Border/Fit、両方式からの操作                      |

入力やフォーカスに触れた場合は、変換開始→変換中の入力→テーマ/再描画→変換終了という流れを確認する。合成したCompositionEventはイベント処理の確認であり、実IMEの変換候補位置・OS固有動作の保証にはならない。実IMEとモバイルキーボードは対象OS/端末で手動確認する。

WebMCPはJS単体テストに加え、対応ブラウザの登録・発見・実行を確認する。未対応環境でもUIが動くことを見る。中断については[WebMCP契約](webmcp.md)のChromium 152の制限を区別する。

HTTP取得・認証に触れた場合は、別オリジンの実HTTPサーバーでAuthorizationのOPTIONS→GET、401/403、未許可のscript URL、リダイレクトの拒否、JWT無効化・再読み込み後の破棄を確認する。画面・スクリプトの失敗で以前のstate/revision、テーマの失敗で以前の配色が残ることを見る。CORSはmock fetchだけでは検証できないので、ブラウザでも確認する。

現在、恒久的なPlaywright実行スクリプトやCI用ブラウザ環境はリポジトリへ同梱していない。ローカルのブラウザ確認では、一時スクリプトで上記の操作を実行できる。ブラウザテストを常設する場合は、ランタイム・サーバー起動・OSとブラウザの対象範囲を先に固定する。

## レビューに残す情報

変わる動作、以前のパッケージへの影響、実行したコマンドとブラウザ操作、未確認・未対応範囲を記す。性能値を示す場合は、WASM計測・DOM更新・Canvas命令発行など測った対象を明記する。再描画のCPU時間をGPU完了やFPSと混同しない。
