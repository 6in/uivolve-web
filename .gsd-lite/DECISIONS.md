# 画面パッケージの部品化に向けた Instance 分離 — 決定と根拠

## 方式の選択（discuss 前の検討で確定）

- 要望の原点は「ExtJS のカスタムコンポーネントのように、既存の画面 + スクリプトを 1 部品として任意のページへ組み込む」。複数画面の並列表示（ワークスペース）ではない。
- **B 案: エンジン内合成**（Rust に Instance を導入し、1 つの Scene・1 トランザクションで親子を扱う）を採用。
- 却下 A 案: ホスト合成（子ごとに別 WASM、親の矩形に子 `UiRuntime` を重ねる）。子の高さが親レイアウトに反映されない、親 window / モーダルと子ポップアップの z 順が破綻、Canvas で子が DOM 浮きになる、WebMCP が子を別画面と見る。B へ発展できない使い捨て。
- 却下 B-lite: ロード時に子パッケージを親へ平坦化（id / bind を接頭辞付きに書き換え、スクリプトを結合）。`bind` が state 最上位キーなので子 Rhai が読むキー名が変わり、結局 handler に部分 state を渡して書き戻す必要がある = B と同じ。Rhai 関数名の書き換えも脆い。
- 却下 ワークスペース案（複数 `UiRuntime` + 共有ストア + 通知）: 共有データの読みが非同期往復になる、pane 間通知のピンポン、busy 中の dispatch 例外、同一パッケージ多重起動で OPFS 非待機ロック衝突、幅下限 240px、WebMCP の 1 ページ 1 登録、の罠を確認。親 state を正とする B 案ならこれらが消える。

## 進め方（discuss 前の検討で確定）

- 段階 1（設計文書の固定）と段階 2（挙動不変リファクタ）だけを本マイルストーンとし、段階 3 以降は段階 2 の結果を見てから確定扱いにする。「気軽に始めるとハマる」への答えとして、lib.rs の構造が component に耐えるかを純リファクタで先に確かめる。
- 文書名は `components-plan.md`。`docs/README.md` の「計画書・検討書は使用APIの根拠にしない」慣習に合わせ、契約文書 `components.md` は合成実装時に別途起こす。

## 設計決定（文書に載せる表。段階 3 以降の前提）

| 論点                            | 決定                                                                                                   | 根拠 / 却下案                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 親↔子の可視性                   | 子は自分の state と `state.config` のみ。親は子 state を見ない。やり取りは `config` と `emit` のみ     | 子パッケージを無改修で部品化できる。親 state を正とすることで共有データが同期で読める                            |
| 子→親（`emit`）の連鎖           | 同一トランザクション。1 イベントで 1 回 commit、連鎖深さ上限 4。親 listener が失敗したら子も確定しない | 既存の「失敗したら何も変わらない」不変条件を維持。却下: 別トランザクション（子だけ確定した中途半端な状態が残る） |
| 子の `navigate`                 | 許可。ページ全体を置換。URL は子パッケージ基準で解決                                                   | ExtJS でも部品がページ遷移を起こすのは普通。却下: 禁止（既存画面の流用範囲が狭まる）                             |
| 子の `alert / confirm / prompt` | ページ全体モーダル。キューは root 1 本、完了 handler を子 Instance へルーティング                      | 既存の「ダイアログは modal 層の部品」と整合。却下: 子内モーダル（親 window との z 順が破綻）                     |
| 子の storage / files scope      | `親画面id/itemId`。種別で共有したい場合は宣言で選択                                                    | 同じ部品を 2 つ置いたときの OPFS 非待機ロック衝突を避ける。却下: 子 package id 固定（多重起動で衝突）            |
| 非同期効果の完了先              | effect と `*_result` op に `instance` を追加（段階 4）                                                 | ホストが完了を正しい Instance へ返すため                                                                         |
| 制限                            | node 200 / script 100KB / state 上限は Instance ごと。Instance 数 8、ネスト深さ 3                      | 既存画面を無改修で部品にできる。却下: 全体で共有（1 部品が上限を食い潰す）                                       |
| ロード                          | 子パッケージを同梱して 1 回の `load`。入力 2MB 上限の扱いは段階 5 で決める                             | 候補が失敗したら前画面を保つ既存契約を保てる                                                                     |

## リファクタの構造（第 1 ラウンドで確定）

- **root 共通物は Runtime に残す**: `revision`、`dialogs`、`pages` は Runtime、`package / ui / functions / engine / extension_context / ast / state / http / host / storage / files / rpc` は Instance へ。段階 3 の「ダイアログは root 1 本」「1 イベント 1 commit（revision は 1 つ）」と整合する。却下: すべて Instance へ（段階 3 で root へ戻す再設計が要る）。
- `components` の HashMap は本マイルストーンでは追加しない。Instance 木は root のみ。

## 範囲・受け入れ（第 1 ラウンドで確定）

- 文書 + リファクタを 1 マイルストーンにする。文書の決定表・フィールド一覧とコード構造の一致を verify で照合できる。却下: 文書のみ（根拠はできるが構造が検証されない）、リファクタのみ（決定の根拠が残らず段階 3 で再議論）。
- 堅牢性の受け入れ基準を入れる: main のビルドとリファクタ後の WASM を 2 つ起こし、同一リクエスト列の応答 JSON を突き合わせる。既存テスト green だけでは Scene の座標や effects の順序の差を拾えないため。
- リモート運用: `gsd-lite/<slug>` を github へ push して PR を作る。main が github/main より 42 コミット先行していたが、ユーザーが discuss 中に `git push github main` を実行し、`main` = `github/main` = `35120e0` を確認した。verify はブランチ push と PR 作成だけを行う。リモート名は `github`（`origin` は無い）。

## 第 2 ラウンドで確定

- 設計決定の表は 8 論点すべて推奨値で確定。段階 3 以降で変える場合はそのマイルストーンの discuss で再決定する。
- research の対象は local_projects（検索先 `.`）と official_docs（Rhai の Engine / AST / call_fn / Module）。similar_oss は純リファクタへの寄与が小さいため含めない。

## 実行設定（最終ラウンドで確定）

- slug は `component-instance-refactor`。ブランチ `gsd-lite/component-instance-refactor`、base は `main`。
- 全フェーズ Claude（engine=claude、phase_engines は空）。model は research / plan / verify / reflect = claude-fable-5-1、impl = claude-opus-5。subagents=auto、reflect=true。
- verify スキルは `git remote get-url origin` でリモート運用を判定するため、既存の `github` リモートと同じ URL で `origin` を追加した（`git remote add origin https://github.com/6in/uivolve-web.git`）。スキル本体は変更しない。`gh` は `/usr/bin/gh`、github.com に認証済み。
- `.claude/skills/` の 6 スキルはテンプレートと内容同一（差分は整形のみ）。上書きしない。
- 要件・決定・前回成果物の退避・state を一括コミット後にデタッチ起動し、このセッションではログをポーリングしない。

## 調査した事実

- 開始時は main、前回 renderer-font-size-parity は done、未コミット変更なし。前回成果物は `.gsd-lite/archive/renderer-font-size-parity/` に退避済み。
- リモートは `github`（`origin` は無い）。前回振り返りの「リモート名が何であれ追跡先があればリモート運用」の提案に従い、push の要否を discuss で確認した。
- `tests/abi.test.js:84` は同じ Module から 2 つ目の WASM インスタンスを起こしている。挙動照合スクリプトはこの形を流用できる。
- `tests/` の結合テストは `createRuntime`（`tests/browser/`）以外はすべて Runtime 1 つ前提。本マイルストーンは JS を変えないので影響しない。

## 過去の振り返りの採否

- 採用: `gsd-lite-loop.sh --where` を入口に使う。`.gsd-lite/` 配下の読み取りは lean-ctx フックが root 外として拒否することがあるため、Read ツールと `git grep` を使う。
- 採用: 台帳（照合結果）は gate のログ・証跡 JSON の生の値を写さず、ファイル名とキーを指す。台帳が持つのは判定・限界・対象外の理由だけ。
- 採用: 検査を足すタスクは変異表（最低 1 件: 意図的に応答を変えて照合が非 0 になること）を完了基準に含める。
- 採用: 並列サブ作業を最終タスクに置かない。gate は前景で回す。
- 採用: push の要否を discuss で聞く（本マイルストーンで初めて PR 運用）。
- 対象外: 実ブラウザは本マイルストーンでは不要（JS 無変更、WASM の応答照合は Node）。Chromium 起動プローブは行わない。
