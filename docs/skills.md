# AI向け開発スキル

uivolve-webの開発スキルは2つ。既存機能でアプリを作る作業と、エンジンの機能を増やす作業を分ける。

| スキル                                                              | 用途                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [uivolve-web-app-dev](../skills/uivolve-web-app-dev/SKILL.md)       | JSON/YAML＋Rhai、stateSchema、部品の利用、テーマ、HTTP・保存・RPC、WebMCP説明 |
| [uivolve-web-engine-dev](../skills/uivolve-web-engine-dev/SKILL.md) | Rust/WASM、DSL・部品・配置・ネイティブ関数・ABI、DOM/Canvas、ブラウザホスト   |

入口のSKILL.mdには共通契約と資料の選択だけを置き、機能ごとの注意点はreferencesへ分ける。属性・APIの詳細はdocsの契約文書を参照し、同じ仕様の手動コピーを増やさない。アプリ側には、型情報を含む[Hello World YAML](../skills/uivolve-web-app-dev/assets/hello-world/hello-world.yaml)と[Rhai](../skills/uivolve-web-app-dev/assets/hello-world/hello-world.rhai)を同梱する。

## リポジトリ内で使う

対象のSKILL.mdを指定して作業を依頼できる。Codexへインストール済みなら、例えば次のように呼ぶ。

```text
$uivolve-web-app-dev で、JSONを取得してGridへ表示する画面を作って。
$uivolve-web-engine-dev で、新しい入力部品をDOM/Canvasの両方に追加して。
```

スキルフォルダーをリポジトリに置いただけでは、全環境への自動インストールは行わない。旧wasm-ui-authoringとuivolve-web-componentsは、それぞれapp-devとengine-devへ移行した。古いコピーをインストール済みの環境では、新版に置き換える。

## 外部アプリへ持ち出す

ソースのスキルはリポジトリ内docsへの相対リンクを使うため、フォルダーだけをコピーすると資料が不足する。次のコマンドで独立した配布用フォルダーを生成する。

```sh
bun run skills:bundle
```

出力は`.skill-bundles/uivolve-web-app-dev/`と`.skill-bundles/uivolve-web-engine-dev/`。各フォルダーに必要なリンク先の文書・例を同梱し、リンクを内部参照へ書き換える。外部ネットワークへの取得は行わない。生成物はGit対象外で、このコマンドは同名の生成フォルダーを置き換える。

Claude Code向けには`bun run skills:release -- 0.1.0`で2スキルをまとめたプラグインZIPとarchive形式のカタログを生成する。ActionsによるRelease、Pages上のカタログ、インストール方法は[GitHub配布手順](github-publishing.md)を参照。

必要なフォルダーを、利用するAI環境のスキルディレクトリへコピーする。Codexでは通常`~/.codex/skills/`、CODEX_HOMEを設定している場合はその配下のskills。グローバル環境へのコピーや既存スキルの削除は、この配布コマンドでは行わない。

外部アプリでHello Worldの2ファイルを使うときはHTTP配信し、そのアプリのローダーへ画面定義URLを渡す。スキルは実行用エンジンやホストを含まないため、それらは別途用意する。デモの`/pages/<id>`や画面カタログを外部アプリにそのまま要求しない。

## 保守と確認

- 対応エンジンの版を確認する。同梱文書は生成時点のスナップショットで、異なるエンジン版に合わせてAPIを想像しない。エンジン開発では対象チェックアウトの契約と実装を優先する。
- 仕様変更時は契約・例と機能別資料の案内を更新し、配布用フォルダーを再生成する。
- `bun run docs:check`でソースのリンク、`bunx vp test run tests/skills.test.js`で独立した配布先のリンクと最小YAML/Rhaiの実WASM動作を確認する。SKILL.mdのfrontmatterとagents/openai.yamlも検証する。
- ブラウザホストの手順はengine-devのreferences/host.mdに置く。ホスト開発の利用が増えたら独立スキルを検討する。WebMCPによる操作専用スキルも将来候補とし、現段階では増やさない。
