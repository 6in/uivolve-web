# DECISIONS — ui-bridge からの要望 その 2（R4〜R6）

### R4: screenToken を crypto.getRandomValues から UUID v4 で作る（採用）

- 採用理由: HTTP の検証サーバ・LAN 内デモで Worker モックの画面を見せたい（ui-bridge の希望）。screenToken は秘密の値ではない。
- 却下: 安全なコンテキストを必須にし、createRuntime で分かりやすい例外にする — HTTP での利用がすべて止まったままになる。

### R5: 例外の文言に origin と許可リストを出す（採用）

- 採用理由: 拒否されたのが画面ファイルの取得か API かが一目で分かる。パスやクエリに機密が入っていても漏れない。
- 却下: URL（クエリ除去）を出す — パスに ID 等が含まれる場合に画面やログに残る。
- 却下: 文言は origin、Error の項目に完全な URL — 項目の契約が 1 つ増え、URL が漏れる経路も増える。

### R6: setAuthentication に publicOrigins を足す（採用）

- 採用理由: ResourceClient は 1 つのまま、明示した origin だけ JWT なしで取得できる。既定は fail-closed のまま。
- 却下: 画面・Rhai・テーマ取得用の別 ResourceClient を createRuntime に渡す — ホストが 2 つの client と認証状態を管理する必要がある。
- 却下: 採らない — 静的配信サーバにも JWT を送る構成が残る。

### Release: MR マージ後に人が行う（採用）

- ループは実装・文書・テストと、依頼書の「状態」を「実装済み（Release 待ち）」にするところまで。
- 採用理由: Release は外部公開で取り消しにくい。前回（ui-bridge R1〜R3）と同じ運用。
- 却下: ループが verify 後に Release まで行う。

### AGENTS.md 候補

- 直近 2 件の振り返りに `（AGENTS.md 候補）` の付いた提案は無かった。

### R4 の範囲: 通常読込の経路は全部直す（採用）

- 部品を含む画面の network-only 読込で使う `crypto.subtle.digest`（SHA-256）も安全なコンテキスト専用だと discuss 中に判明した。
- 採用: randomUUID に加え SHA-256 も安全でないコンテキストで動く形にする。配信キャッシュ（network-first）は OPFS 自体が
  安全なコンテキスト専用なので対象外とし、文書に書く。
- 却下: randomUUID だけ直す — 部品を含む画面が HTTP で失敗したまま残る。

### R4 の検証: 単体テスト + 実ブラウザ（採用）

- 採用: vitest で API を消した環境 + Playwright Chromium でマシンの IP の HTTP（isSecureContext=false）で Worker モックの画面を開く。
- 却下: 単体テストのみ — 実ブラウザでの安全でないコンテキストの挙動差を見ない。

### R6 の詳細

- 重複（allowedOrigins と publicOrigins の両方にある origin）: **allowedOrigins を優先**（ユーザー選択。推奨は設定エラーだった）。
  JWT を付けて送る。却下: 設定エラー / publicOrigins 優先。
- HTTP の origin: publicOrigins には書ける（採用）。JWT を送らないので HTTPS 必須の理由が無い。却下: HTTPS のみ。
- `mode: "none"` との組合せ: 設定エラー（採用）。却下: 無視する — 設定ミスに気づきにくい。
- fetch 設定: JWT モードと同じ `cache: no-store` / `redirect: error` / `credentials: omit`（採用）。
  却下: 認証なしと同じ（no-cache / follow）— リダイレクトで別 origin に飛ばされうる。

### 堅牢性の受け入れ基準: 入れる（採用）

- 認証周りの変更なので、入力の格子を plan の初回タスクに含め、verify は該当指摘で差し戻す。

### 前回の残留リスク: 入れない（採用）

- 今回は ui-bridge の R4〜R6 に絞る。http-error-body の残留リスクは別マイルストーン。

### 検証の密度: 全行再実行は 2 回に限る（採用）

- 前々回（component-webmcp）の振り返りの提案に基づく。最終判定タスクと verify round 1 だけ全行、他は触った行だけ。
- 却下: 前回と同じ密度（各タスクで全行）— 今回は変更が小さく時間とコストに見合わない。

### R5: publicOrigins も文言に並べる（採用）

- どちらに入れればよいかが一目で分かる。却下: 許可リストだけ。

### slug: ui-bridge-requests-2 / research: local_projects・official_docs・similar_oss（全選択）

### 実行パターン

- すべて Claude（`engine: claude`、`phase_engines: {}`）。モデルは全フェーズ `claude-opus-5-5`（ユーザー指定）。
- subagents: `auto`。reflect: `true`。limits: `8G` / `200%`（CPU 上限は delegate.conf 未設定のため効かず、メモリだけ効く）。
- 起動時の環境変数: 前回の DECISIONS に環境変数付きの起動コマンドは無かった。
- BLOCKED の通知: なし（`gsd-lite-loop.sh --status` を半日に 1 回の目安で確認する）。
