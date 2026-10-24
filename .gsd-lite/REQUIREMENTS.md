# REQUIREMENTS — ui-bridge からの要望 その 2（R4〜R6）

出典: GitLab issue #1 / 依頼書 `docs/requests/ui-bridge-2.md`（原本。背景・再現はそちらを参照）。

## 要求

### R4. 安全でないコンテキスト（HTTP の IP・ホスト名）でも画面を読み込める

- `screenToken`（`src/runtime.js` の画面読込で生成）を `crypto.randomUUID()` ではなく
  `crypto.getRandomValues` から UUID v4 形式で作る（`src/random.js` と同じ素材）。
- 部品（コンポーネント）を含む画面の通常読込（`network-only`）で使う SHA-256（いま `crypto.subtle.digest`、
  `src/application-loader.js` の `sha256`）も、安全でないコンテキストで動く手段に置き換える（手段は research / plan で決める。
  結果のハッシュ値は今と同じ 16 進 SHA-256）。
- 安全でないコンテキストでも、WebMCP と配信キャッシュ（`network-first`。OPFS 自体が安全なコンテキスト専用）以外の
  機能は今までどおり動く。
- `docs/runtime-distribution.md` に「HTTP（安全でないコンテキスト）でも画面は読み込める。WebMCP と配信キャッシュは
  安全なコンテキストが必要」を書く。

受け入れ基準:

- 単体テスト（vitest）: `crypto.randomUUID` と `crypto.subtle` が無い環境で、部品を含む画面を `network-only` で読み込める。
  screenToken は UUID v4 形式で、読込ごとに異なる。SHA-256 の結果が置き換え前と一致する。
- 実ブラウザ: Playwright の Chromium で、このマシンの IP の HTTP（`isSecureContext === false`）で開いた
  Worker モックの画面が読み込める（ブラウザが無ければ作業ディレクトリ内に取得してよい）。

### R5. JWT の送信先で拒否したとき、拒否した origin と許可リストを例外に出す

- 文言の例: `このURLはJWTの送信先として許可されていません: https://ui.example.com（許可: https://api.example.com）`
- 出すのは **origin と許可リスト（allowedOrigins）だけ**。パス・クエリ・トークンは出さない。
  publicOrigins が宣言されていればそれも並べる（例: `…: https://x.example.com（許可: https://api.example.com、JWTなし: https://ui.example.com）`）。
- `docs/authentication.md` に「JWT モードでは画面・Rhai・テーマの取得も許可リストで検査されるので、
  `setAuthentication` を直接呼ぶホストはページ（画面の配信元）の origin も入れる（または R6 の publicOrigins に入れる）」ことを、
  API を別 origin に置く例と一緒に書く。

受け入れ基準: 拒否時の例外に origin と許可リストが出て、パス・クエリ・トークンが出ないことをテストで確かめる。

### R6. JWT を付けずに取得してよい origin を宣言できる（publicOrigins）

- `setAuthentication({ mode: "jwt", ..., publicOrigins: [...] })` で宣言した origin への取得は、
  Authorization を付けず `credentials: "omit"` で行う。
- 宣言が無ければ今の fail-closed（許可リストに無い origin へは送らずに止める）のまま。
- publicOrigins への取得ではトークンを取得しない（`getToken` もリフレッシュも呼ばない）。
  cache / redirect は JWT モードと同じ（`no-store` / `error`）。
- publicOrigins は HTTP（localhost 以外）の origin も書ける（JWT を送らないため）。パス付きは allowedOrigins と同じく設定エラー。
- allowedOrigins と publicOrigins の両方にある origin は **allowedOrigins を優先**（JWT を付けて送る）。
- `mode: "none"` で publicOrigins を渡したら設定エラー。
- `getAuthentication()` は `publicOrigins` も返す（トークンは返さない）。
- `docs/authentication.md` に publicOrigins の宣言・用途（公開の静的配信に JWT を送らない）を書く。

受け入れ基準: publicOrigins への取得に Authorization が付かず `credentials: "omit"` であること、宣言の無い origin は
今どおり拒否されること、重複時に JWT が付くこと、`mode: "none"` との組合せが設定エラーになることをテストで確かめる。

### 堅牢性（全体の受け入れ基準）

- `setAuthentication` にどんな値（不正な型・空・重複・パス付き・HTTP）を渡しても、どの取得経路（画面・Rhai・テーマ・
  部品・HTTP アダプター・転送）でも、トークンを例外・ログに出さず、許可リスト外へ JWT を送らず、未捕捉の `TypeError` で落ちない。
  plan は初回タスクに入力の格子として含める。

### 検証の進め方

- 追従先チェックリストの全行再実行は、最終判定タスクと verify round 1 の 2 回に限る。それ以外のタスク・F タスクでは触った行だけ。

### 文書・依頼書

- 依頼書 `docs/requests/ui-bridge-2.md` の「状態」を「実装済み（Release 待ち）」にし、R6 を採った形（publicOrigins）を書く。

## スコープ外

- JWT を HTTP（localhost 以外）で送れるようにすること（依頼書の範囲外どおり）。
- 許可リストに無い origin へ、明示の宣言なしに黙って JWT なしで送るように既定を変えること。
- 前回マイルストーン（http-error-body）の残留リスク。
- runtime のタグ付け・GitHub Release の公開・依頼書への版の追記（MR マージ後に人が行う）。

## 用語集

- **安全なコンテキスト（secure context）**: HTTPS か `localhost` / `127.0.0.1` / `[::1]` で開いたページ。`window.isSecureContext`。
- **許可リスト（allowedOrigins）**: JWT モードで Bearer を付けて送ってよい origin の一覧。
- **publicOrigins**: JWT モードで、JWT を付けずに取得してよいと明示した origin の一覧（R6）。
- **screenToken**: 画面読込ごとに作る値。WebMCP の画面ツールが「今の画面か」を照合する。秘密の値ではない。
