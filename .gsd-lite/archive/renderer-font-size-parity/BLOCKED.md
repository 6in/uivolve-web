# BLOCKED — T1 実ブラウザ検証の入口と修正前台帳

> **解消済み（turn 4 / 2026-10-06）**: 停止原因は実行ファイルの不在ではなく実行サンドボックスだった。
> Claudeのサンドボックス外実行で `/usr/bin/chromium-browser`（Chromium 152.0.7977.64、headless）が
> 起動し、実WASM・日本語描画・比較デモ/独立runtime双方の実測と画像を取得してT1を完了した。
> 以降ブラウザを使うコマンドはサンドボックス外で実行する。記録は `docs/renderer-font-parity.md` と
> PROGRESS の turn 4。以下は停止時点の記録。

- turn: 3（impl）
- 状況: 作業ツリーは開始時にclean。先頭の未完了タスクT1の必須条件である実Chromiumの起動・接続を確立できず、実WASM・日本語字体・computed font-size・Canvas観測・比較画像は未取得。T1のチェックボックスは未完了のまま。製品コードと検証runnerは変更していない。
- 停止根拠: PLAN.mdの「無人環境で両方利用不能ならT1を未完了のままBLOCKEDをコミットする」とT1完了基準の「実ブラウザ利用不能時はBLOCKED、T1を完了にしない」。

## 確認・試行と結果

1. `gsd-lite-loop.sh --where` はmode=repo、milestone_dir=.gsd-lite、target=.、slug=renderer-font-size-parityを返した。最初の誤った相対パスは存在せず、PATH入口へ修正した。
2. Playwrightのbundled Chromium実行ファイル `/home/parallels/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome` は存在しない。`chromium.launch({ headless: true, timeout: 10000 })` はheadless shell実行ファイル不存在で非0終了した。
3. `/usr/bin/chromium-browser` と `/snap/bin/chromium` は既存のsnap経路。turn 1でcapability制約による起動失敗を記録済みのため再試行しなかった。`/opt/google/chrome`、`/usr/lib/chromium`、`/usr/bin/google-chrome-stable`、`/usr/bin/chromium` も存在しない。
4. 別のローカル実行ファイル `/opt/vivaldi/vivaldi-bin` を発見し、Playwrightの `executablePath` として1回試行した。プロセスは `crashpad/util/linux/socket.cc:45 setsockopt: Operation not permitted (1)` を出しSIGTRAPで終了。Playwrightのcleanup完了を確認した。実ページには到達していない。
5. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`、`RETROSPECTIVE_BROWSER_PATH`、`BROWSER_ENDPOINT`、`PLAYWRIGHT_BROWSER_ENDPOINT`、`CDP_ENDPOINT` の設定有無を確認し、すべて未設定。`ss -ltnp` に明示的なブラウザ/CDP listenerは見つからず、接続先は確定できない。既存サーバー・他者プロセスには接続・終了操作を行っていない。

## 再開に必要な情報・選択肢

### 対話側での再開経路の検証

- サンドボックス外で `/usr/bin/chromium-browser` を Playwright から起動し、Chromium `152.0.7977.64`、日本語を含む `<p>` の実効 font-size `13px` を実測できた。使用可能な実行ファイルは確定したが、実WASM・画面のbaseline・日本語フォントの証跡はT1で取得する。
- `/opt/vivaldi/vivaldi-bin` はサンドボックス外で DevTools listener を起動できたものの、Playwright の newPage まで安定して完了しなかったため採用しない。
- 対話のサンドボックス内からlocalhost CDPへの接続は `connect EPERM 127.0.0.1:9337`。外部ブラウザを用意するだけでは接続の権限制約を解消しない。
- ユーザーへ全Codexの `danger-full-access` 再開、または実装・検証のClaude切替を提示。選択待ち。承認前にstateを再開状態へ変更しない。
- 2026-10-06: ユーザーがClaudeへの移行を選択。`engine` を `claude` に変更し、T1からimplを再開する。回答と根拠はDECISIONS.mdの「Claudeへのエンジン切替と再開設定」に記録。

- 質問: この無人環境から利用できるChromiumの実行ファイル、またはPlaywright/CDPの外部ブラウザ接続先をどれにするか。
- 推奨: sandbox外で起動したChromiumの到達可能な接続先を用意し、T1の `--browser-endpoint` 経路を実装・検証する。外部ブラウザ本体は終了せず、所有したcontextだけを閉じる契約を守る。
- 代案: Chromiumの実行ファイルを用意し、この環境のsocket/capability制約を解消した上で `--browser-path` 経路を実装・検証する。bundled browserの導入だけでは今回のsocket制約が解消するとは判断できない。
- 再開後: T1だけを続け、実測JSONと比較デモ・独立UiRuntimeの画像、日本語字体の証拠、runnerのプロセス試験を取得してから完了を判定する。CSS解析値や以前の画像を今回の実測証跡へ流用しない。
