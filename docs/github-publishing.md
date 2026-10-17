# GitHub Actions・Pages・スキル配布・ランタイム配布

公開デモ: [uivolve-web](https://6in.github.io/uivolve-web/)。[Hello World](https://6in.github.io/uivolve-web/pages/hello-world/)や[ダイアログ](https://6in.github.io/uivolve-web/pages/dialogs/)を直接開ける。

## デモの公開

`.github/workflows/pages.yml`はmainへのpushと手動実行でテスト・ビルドし、GitHub Pagesへdistだけを公開する。pull requestでは同じ確認とビルドを行い、公開しない。PagesのSourceはGitHub Actionsを選ぶ。

Node 24、Bun 1.3.12、Rust 1.95.0とwasm32-unknown-unknownを用意し、固定した依存関係で実WASMのテストを行う。Pagesが返すbase_pathでViteをビルドするので、`/uivolve-web/`配下から画面・Rhai・テーマ・WASMを取得する。

GitHub PagesにはSPAの任意rewriteを設定しない。`scripts/prepare-pages.mjs`が画面カタログの各`pages/<id>/index.html`へビルド済みの入口をコピーする。直接アクセス・再読み込みでもHTTP 200で画面を開ける。未知の画面や存在しないアセットは通常の404となる。

ローカルで同じ成果物を作る例:

```sh
bun run build -- --base=/uivolve-web/
bun run pages:prepare
```

Pagesは静的配信。HTTP JSON例は同梱データへアクセスし、IndexedDB/OPFSは閲覧者のブラウザへ保存する。JWT検証・refresh token発行・Unary RPCサーバーはPages上では動かない。RPCデモの通信には別サーバーが必要で、標準のローカルRPCサーバーを公開環境のサービスとして扱わない。

## Claude Code向けリリース

`.claude-plugin/plugin.json`を共通メタデータとし、`scripts/release-skills.mjs`が移植可能な2スキルをまとめたClaudeプラグインを作る。ZIPにはSKILL.md、機能別資料、必要な契約・サンプル・文書から参照する登録例、第三者通知を入れる。エンジンのビルド成果物、開発依存関係、デモの実行用ホスト一式は含まない。

```sh
bun run skills:release -- 0.1.0
```

`.skill-release/`へプラグインフォルダー、`uivolve-web-plugin-0.1.0.zip`、`marketplace.json`、`SHA256SUMS`、リリース情報を生成する。カタログは`skills-v0.1.0`の固定したRelease URLと、そのZIPのSHA-256を使う。ローカルの生成コマンドは外部へ公開しない。

`.github/workflows/release-skills.yml`をActionsから手動実行し、versionへ未公開の版番号を指定する。あるいは`skills-v0.1.0`形式のタグをpushする。テスト後にGitHub ReleaseへZIP・カタログ・ハッシュを公開し、Pagesの再生成を要求する。既存リリースを上書きせず、変更には新しい版番号を使う。`-beta.1`等はprereleaseとして公開し、通常のPagesカタログには採用しない。

Pagesは公開済みの最新の安定版skills Releaseからカタログを取り込み、デモと独立した版のZIPを参照する。最初のReleaseがない場合は空のカタログを置き、デモだけ先に公開できる。

## ランタイムとWASMエンジンのリリース

`.github/workflows/release-runtime.yml`は`runtime-v0.1.0`形式のタグのpush、またはActionsの手動実行（versionに未公開の版番号）で動く。Pagesと同じNode 24・Bun 1.3.12・Rust 1.95.0でテストを通し、`scripts/release-runtime.mjs`が次の3つとSHA-256を作ってGitHub Releaseへ公開する。

| 資産                                       | 内容                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `uivolve-web-runtime-<version>.tar.gz`     | [共通ランタイム](runtime-distribution.md)（`index.js` / `index.css` / `engine.wasm` / 第三者通知 / Workerアセット） |
| `uivolve-web-minimal-app-<version>.tar.gz` | Hello World入りの静的アプリ一式（`app-dist/`相当）                                                                  |
| `uivolve-web-engine-<version>.wasm`        | WASMエンジン単体                                                                                                    |

```sh
bun run runtime:release -- 0.1.0
gh release download runtime-v0.1.0 --repo 6in/uivolve-web --pattern 'uivolve-web-runtime-*.tar.gz' --pattern SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

ローカルの生成先は`.runtime-release/`でGit管理しない。tarは名前順・所有者なしで固め、Actionsではコミット時刻を`SOURCE_DATE_EPOCH`に使う。WASMのバイト列はRustのバージョンに依存するので、Release本文にビルド元コミットとツールチェーンを記録する。既存リリースは上書きせず、変更には新しい版番号を使う。`-beta.1`等はprereleaseとして公開する。スキルの`skills-v*`とは独立した版番号で、Pagesのカタログには影響しない。

## インストール

Claude Codeで次のURLを登録する。GitHubリポジトリのowner/repo形式で登録するとクローンが発生するため、必要な配布物だけを取得する場合はJSONのHTTPS URLを使う。

```text
/plugin marketplace add https://6in.github.io/uivolve-web/marketplace.json
/plugin install uivolve-web@uivolve-web-skills
/uivolve-web:uivolve-web-app-dev
/uivolve-web:uivolve-web-engine-dev
```

これはJSONカタログとarchive ZIPを取得する方式。archive対応にはClaude Code v2.1.224以降が必要。CodexではZIP内のskillsから必要なフォルダーをスキルディレクトリへコピーでき、従来の`bun run skills:bundle`も利用できる。

## 検証と更新

`tests/distribution.test.js`でZIPの展開、必要なスキル、カタログのURL・ハッシュ、余分なビルド成果物の除外、Pagesの画面入口、ランタイムReleaseの資産とSHA-256を検証する。`tests/skills.test.js`で配布後の文書リンクと最小サンプルの実WASM動作を確認する。Claude Codeでの実インストールは別途確認する。

運用仕様は[GitHub Pagesの公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[ViteのPages設定](https://vite.dev/guide/static-deploy.html#github-pages)、[Claudeのarchive形式](https://code.claude.com/docs/en/plugins/marketplace-reference#archive-plugin-source)を参照する。
