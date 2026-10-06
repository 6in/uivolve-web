# DOM / Canvas フォントサイズ統一 — 決定と根拠

## 基準・範囲

- ユーザーの「推奨設定で確定し、ループを開始」という指示により、DOM 基準・全共通部品・表示の堅牢性確認を確定した。
- DOM の部品別サイズを基準にする。Canvas 基準や両方の新サイズへの変更は、基準側の見た目まで変更するため採用しない。
- 全共通部品と Canvas の編集用 DOM 要素を対象にする。特定画面だけの修正では別画面に同じ差が残るため。
- 日本語・英数字・長文・拡大表示と通常操作を受け入れ基準に含める。文字サイズだけの一致による欠けや編集時のサイズ変化を防ぐ。
- CSS の数値一致だけで合格とせず、実ブラウザと画像で確認する。ラスタライズ方式の違いによる画素完全一致は要求しない。

## 調査した事実

- 開始時は main、前回 development-retrospective-blog は done、未コミット変更なし。前回成果物は `.gsd-lite/archive/development-retrospective-blog/` に退避済み。
- DOM は `src/runtime.css`、Canvas は `src/canvas-renderer.js` 等でサイズを個別に設定している。基本値13pxやボタン12pxのように既に一致する指定もあり、原因が全体倍率だとは断定しない。
- Canvas 入力は DOM オーバーレイを利用する。描画時と編集時の CSS 継承も調査対象。
- 比較デモは `src/styles.css`、ランタイムは `src/runtime.css` を読み込む。両環境で実効スタイルを確認する。
- 既存の開発環境・検証方針は README / docs/testing.md に従う。

## 過去の振り返りの採否

- PATH 上の `gsd-lite-loop.sh` を入口に使う。架空の `.gsd-lite/gsd-lite-loop.sh` を作らない。
- ブラウザ経路とフォントを最初に確認し、整形・build の後に撮影する。確認用スクリプトは実行前に構文と実データを確認する。
- PROGRESS は turn 順に記録し、再検証とツール指定の修正を区別する。
- ループの計測やスキル自体の改修は今回の範囲外。

## 実行設定

- 全フェーズ Codex、モデル・推論強度は CLI 既定、subagents=auto、reflect=true。phase_engines は空とする。
- state の Claude 用 model 値は保存しているが、Codex の実行モデルとして扱わない。
- research は既存コード（local_projects、検索先 `.`）と公式ドキュメント（official_docs）を対象にする。類似 OSS の比較調査は含めない。
- Codex sandbox は workspace-write。対話セッションの sandbox 内では --check のプローブが失敗したが、sandbox 外の --check は成功した。danger-full-access は使用しない。
- 既存の6フェーズ用 Codex スキルを維持し、独自変更を上書きしない。PATH 上の gsd-lite-loop.sh を使用する。
- マイルストーンブランチは gsd-lite/renderer-font-size-parity、base は main。要件・設定・前回成果物の退避を一括コミット後にデタッチ起動し、このセッションではログをポーリングしない。

## Claudeへのエンジン切替と再開設定

- ユーザーが2026-10-06に、Codexの無人ループを続けられないためClaudeへ移行すると決定した。`engine` を `claude` に変更し、phase・turn・成果物・フェーズ別モデルの設定は保持する。Codex用の `.agents/skills/` は残し、Claude用の6スキルを `.claude/skills/` に追加した。
- 停止原因はCodexのworkspace-write sandboxによるsocket/capability制約。Claudeの無人ターンはこのsandboxを使わない。Claudeの対話セッションから `/usr/bin/chromium-browser` をPlaywrightの `executablePath` に指定し、headlessで起動して画面を撮影できた。
- BLOCKED（turn 3、T1）の質問への回答: 実ブラウザの実行ファイルは `/usr/bin/chromium-browser` を使う。Codexのsandbox外ではChromium `152.0.7977.64` の起動と、日本語を含む `<p>` の実効font-size `13px` を実測済み。`/opt/vivaldi/vivaldi-bin` はnewPageまで安定しないため採用しない。PLANの `--browser-path` と `--browser-endpoint` の契約は変更しない。
- 上の実測は起動経路の確認だけである。実WASM・修正前baseline・日本語字体の証跡はT1で取得し、以前の値や画像を流用しない。
- `.claude/settings.json` のallowlistに `bun`、`bunx`、`node` を追加した。PLANの検証コマンド（`bun scripts/…`、`node --check`）が無人ターンで承認待ちにならないようにするため。
