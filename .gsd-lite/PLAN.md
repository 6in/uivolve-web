# PLAN — ui-bridge-requests-2

- 作成: 2026-10-24 / gsd-lite-plan（turn 2）
- 入力: REQUIREMENTS.md / DECISIONS.md / RESEARCH.md
- 対象: このリポジトリ（`gsd-lite-loop.sh --where` = `mode=repo` / `target=.`）。Rust（`engine/`）は触らない

## 検証コマンド

impl の各ターンがテストに使うコマンド（リポジトリのルート `.` で実行。1 回の Bash に 1 コマンド）:

```bash
bunx vp test run tests/resource-client.test.js       # 対象ファイルだけ回す（他: tests/resource-refresh.test.js / tests/resource-public-origins.test.js / tests/sha256.test.js / tests/insecure-context.test.js / tests/components-loader.test.js / tests/runtime.test.js / tests/webmcp.test.js / tests/host-adapters.test.js / tests/opfs-file-transfer.test.js）
bunx vp test run                                     # Vitest 全体
bunx vp fmt <このターンで編集した src / tests / docs / scripts / skills / README.md / .gsd-lite のファイル>   # bun run check の前に必ず掛ける
bun run check                                        # vp check（整形 + lint）+ cargo fmt --check。exit code はここで見る
bun run docs:check                                   # Markdown のローカルリンク切れ（scripts/check-docs.mjs）
bun run test:insecure:browser                        # T4 以降。Playwright Chromium + 配布版の静的配信（このマシンの IP の HTTP）
```

- 環境の初期化（テストの前に毎回）: なし。`public/engine.wasm` は既存のものを使う（Rust を触らないので `build:wasm` は不要。最終判定スクリプトが再生成する）
- 整形の手順: **`bun run check` の前に `bunx vp fmt <編集したファイル>` を掛け、整形後に対象テストをもう 1 度回す**。`Edit` は整形後に読み直してから行う
- このリポジトリの注意: `bunx vp check` に Markdown だけを渡すと整形 pass でも lint 対象 0 件で非 0 終了する（整形 stage の出力で判定し、exit code は `bun run check` で見る）。`.gsd-lite/*.md` は整形対象なので PLAN / PROGRESS を書いたら `bunx vp fmt .gsd-lite/PLAN.md .gsd-lite/PROGRESS.md`
- 最終判定（クリーンな状態から全検査。verify と T6 が使う）: `bun scripts/verify-instance-refactor.mjs --base-commit main`（`build:wasm` → `vp test run` → `test:rust` → `check` → `docs:check` → `build` → base 照合 → probe → 変異。本マイルストーンは Rust を触らないので base 照合・変異の結果は base と同じになるはず）。加えて `bun run test:insecure:browser` を 1 回（最終判定スクリプトは実ブラウザを含まないため）。plan のターン（turn 2）に base HEAD で 1 回実行した結果は「メモ」に記す
- 実ブラウザ（T4 以降）: `bun run test:insecure:browser`。Chromium が無ければ `bun scripts/test-insecure-browser.mjs --install` で作業ディレクトリ内（`.cache/ms-playwright/`、gitignore に足す）に取得する（`PLAYWRIGHT_BROWSERS_PATH` はスクリプトの中で `process.env` に設定して `bunx playwright install chromium` を `spawn` する。先頭の変数代入は使わない）。「実行不能」と書くのは取得を試みて失敗したときだけ。共有ライブラリ不足で `sudo` が要るなら BLOCKED
- 一時ファイルは `.gsd-lite/logs/ui-bridge-requests-2/scratch/turn-NNN-*.{mjs,txt}`（`/tmp` は書けない。`rm -rf` 禁止）。長いコマンドのログは `> file 2>&1` で取り `| tail` を使わない。`sed -i` は使わず `Edit` で直す

## 追従先チェックリスト

全行の再実行は **T6（最終判定）と verify round 1 の 2 回だけ**（REQUIREMENTS「検証の進め方」）。他のタスクは触った行だけ再実行する。
「現在」は turn 2（base HEAD）で実行した出力の行数。

| #   | 変更の種類                                         | 直す場所                                                                                                                                | 確かめ方（完了条件）                                                                                                                                                                                                                                                                                            | 現在                                                                    |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | R5 拒否文言                                        | `src/resource-client.js` の `#fetchResource`                                                                                            | `git grep -n -F 'として許可されていません")' -- src` が 0 件（文言の後ろに origin が続く形になる）                                                                                                                                                                                                              | 1（`src/resource-client.js:132`）                                       |
| 2   | `getAuthentication()` の形（publicOrigins を足す） | `tests/resource-client.test.js`・`tests/resource-refresh.test.js` の `toEqual({ mode: "none", ... })`                                   | `rg -n -F 'allowedOrigins: [] });' tests src` が 0 件                                                                                                                                                                                                                                                           | 2（`resource-client.test.js:146`・`resource-refresh.test.js:361`）      |
| 3   | `getAuthentication()` の利用箇所                   | `src/application-loader.js` の `#shareKey`（`JSON.stringify(getAuthentication())`）・`mode !== "none"` の判定 6 か所・`src/main.js:112` | `git grep -n -F 'getAuthentication()' -- src` の各行が `mode` の比較か `JSON.stringify` か `src/resource-client.js` 内の定義・`return`（3 行）だけ（形の変更で壊れない）。T2 のテスト「publicOrigins を変えると共有の子が捨てられる」「publicOrigins があっても network-first は拒否」が通る                    | 11 行（`application-loader.js` 7・`main.js` 1・`resource-client.js` 3） |
| 4   | R4 screenToken                                     | `src/runtime.js` の `load` 内 `this.screenToken = ...`                                                                                  | `git grep -n -F 'randomUUID' -- src` が 0 件                                                                                                                                                                                                                                                                    | 1（`src/runtime.js:392`）                                               |
| 5   | R4 SHA-256                                         | `src/application-loader.js` の `sha256`、新規 `src/sha256.js`                                                                           | `git grep -n -F 'crypto' -- src` のヒットが `src/random.js`（getRandomValues）と `src/application-loader.js` の `sha256` 内（subtle の分岐）だけ                                                                                                                                                                | 3                                                                       |
| 6   | 既存テストの自己参照                               | `tests/components-loader.test.js`（src の `sha256` で期待値を作る）                                                                     | `git grep -n -F 'createHash' -- tests/sha256.test.js` が 1 件以上（node:crypto と突き合わせるテストが別にある）。components-loader 側は変えない                                                                                                                                                                 | 0（ファイル無し）                                                       |
| 7   | 認証文書（R5・R6）                                 | `docs/authentication.md` の「ホストAPI」節・`getAuthentication()` の段落（`mode / allowedOrigins` の行）・「送信先と失敗時の動作」節    | `git grep -n -F 'mode / allowedOrigins' -- docs` が 0 件。`git grep -c -F 'publicOrigins' -- docs/authentication.md` が 4 以上。`git grep -n -F 'JWTなし:' -- docs/authentication.md` が 1 件以上。`git grep -n -F 'https://api.example.com' -- docs/authentication.md` が 1 件以上（API を別 origin に置く例） | 1 / 0 / 0 / 0                                                           |
| 8   | 旧契約の言い回し                                   | `docs/authentication.md` 「送信先と失敗時の動作」の「許可されていないオリジンへの取得を送信前に拒否する」                               | `git grep -n -F '送信前に拒否する' -- docs/authentication.md` のヒット行に `publicOrigins` が含まれる                                                                                                                                                                                                           | 1 行（publicOrigins なし）                                              |
| 9   | 配布文書（R4）                                     | `docs/runtime-distribution.md` の「既存HTMLに組み込む」節末（認証の段落の近く）                                                         | `git grep -n -F '安全なコンテキスト' -- docs/runtime-distribution.md` が 1 件以上で、同じ段落に `WebMCP`・`配信キャッシュ`・`OPFS` と `test:insecure:browser` が出る                                                                                                                                            | 0                                                                       |
| 10  | README の機能一覧                                  | `README.md` の「HTTP取得の認証なし／JWT（Bearer）切替」の行                                                                             | `git grep -n -F 'publicOrigins' -- README.md` が 1 件以上                                                                                                                                                                                                                                                       | 0                                                                       |
| 11  | AI への生成指示文書                                | `docs/ai-development.md` の「実装済みの境界」節                                                                                         | `git grep -n -F 'publicOrigins' -- docs/ai-development.md` と `git grep -n -F '安全なコンテキスト' -- docs/ai-development.md` がそれぞれ 1 件以上                                                                                                                                                               | 0 / 0                                                                   |
| 12  | エンジン開発スキルのホスト契約                     | `skills/uivolve-web-engine-dev/references/host.md` の JWT の行（「JWTはResourceClient/TokenSessionが保持し」）                          | `git grep -n -F 'publicOrigins' -- skills` が 1 件以上                                                                                                                                                                                                                                                          | 0                                                                       |
| 13  | 依頼書の状態                                       | `docs/requests/ui-bridge-2.md` の 3 行目と末尾                                                                                          | `git grep -n -F '状態: 未着手' -- docs/requests/ui-bridge-2.md` が 0 件。`git grep -n -F '実装済み（Release 待ち）' -- docs/requests/ui-bridge-2.md` と `git grep -n -F 'publicOrigins' -- docs/requests/ui-bridge-2.md` がヒット（publicOrigins は既存 1 件 + 採った形の節で 2 件以上）                        | 1 / 0 / 1                                                               |
| 14  | 実ブラウザ検証の入口                               | `package.json` の `scripts`、`.gitignore`（`.cache/`）                                                                                  | `git grep -n -F 'test:insecure:browser' -- package.json docs/runtime-distribution.md` が 2 件以上。`rg -n -x -F '.cache/' .gitignore` が 1 件（`git check-ignore` は allowlist 外で承認待ちになるので使わない）                                                                                                 | 0 / 0                                                                   |

- 断言 → 実装シンボルの対応（T6 の完了基準。文書が断言する行を実装のシンボルで `git grep` し、同じ語で書かれているかを見る。断言ごとに反例を 1 つ scratch で実行して結果を表の列に書く）:
  - 「allowedOrigins と publicOrigins の両方にある origin は JWT を付ける」→ `#fetchResource` の `allowedOrigins.includes` が `publicOrigins.includes` より先
  - 「publicOrigins への取得ではトークンを取得しない・401 でも更新しない」→ `#fetchResource` の `bearer` 変数（決めた事項 8）
  - 「拒否の文言は origin と許可リストだけ」→ `rejectedOrigin`（決めた事項 6）
  - 「publicOrigins があっても配信キャッシュは使えない」→ `src/application-loader.js` の `"配信キャッシュは認証なしの場合に利用できます"`
  - 「安全でないコンテキストでも SHA-256 は同じ値」→ `sha256` の `crypto?.subtle` 分岐と `sha256Hex`
  - 「screenToken は getRandomValues から」→ `uuidV4`

## Tasks

- [x] T1: `setAuthentication` の入力格子と publicOrigins の設定検査（R6 の設定側 + 堅牢性）
  - 完了基準:
    - 新規 `tests/resource-public-origins.test.js` に**入力の格子**を置く: 第 1 引数 {`undefined` / `null` / `1` / `"jwt"` / `[]` / `() => {}` / `Object.create(null)`（mode 無し → none）/ getter が `TypeError` を投げるオブジェクト} と、`publicOrigins` / `allowedOrigins` の値 {`undefined` / `null` / `"https://a.example"`（文字列）/ `[]` / 重複 `["https://a.example","https://a.example"]` / パス付き `["https://a.example/p"]` / query 付き / fragment 付き / userinfo 付き / HTTP `["http://10.0.0.1:8080"]` / `[Symbol()]` / `[{ toString() { throw new TypeError("x") } }]` / `[null]` / `[1]`} × mode {`none` / `jwt`}。各セルで「例外なら `TypeError` でない（`expect(e).not.toBeInstanceOf(TypeError)` かつ `e.constructor === Error`）」「message に設定したトークン文字列とリフレッシュトークン文字列が無い」「設定エラー時に直前の `getAuthentication()` が変わらない（JWT 設定の後に不正値で呼ぶ）」を assert する（RESEARCH 落とし穴 13・14）。`refresh` の不正値 {`null` / `1` / `[]` / `{ url: 1 }`}・`expiresIn: "x"`・`getToken: 1` も同じ 3 条件で 1 行ずつ
    - 決めた事項 1〜4 の挙動: `setAuthentication(undefined)` と `()` は none。plain object 以外は設定エラー「認証設定はオブジェクトで指定してください」。`publicOrigins` は JWT モードでだけ指定でき、`mode: "none"` で `undefined` 以外（`[]` を含む）を渡すと「publicOriginsはJWTモードでだけ指定できます」。配列でなければ「JWTなしで取得するオリジンは配列で指定してください」。パス・query・fragment 付きは「JWTなしで取得するオリジンにはパスを含まないオリジンを指定してください」。HTTP の origin（`http://10.0.0.1:8080`）は publicOrigins に書けて、allowedOrigins では従来どおり HTTPS のエラー（落とし穴 12）。重複は 1 つにまとめる
    - `getAuthentication()` が常に `publicOrigins` を返す（none は `[]`）。返す配列はコピー（書き換えても policy が変わらない）。トークンを含まない（`JSON.stringify` に token が無い）
    - 追従先 2: `tests/resource-client.test.js:146` と `tests/resource-refresh.test.js:361` の期待値を `{ mode: "none", allowedOrigins: [], publicOrigins: [] }` に直す
    - `bunx vp test run tests/resource-public-origins.test.js tests/resource-client.test.js tests/resource-refresh.test.js` が通る。チェックリスト行 2 を実行
  - 対象: `src/resource-client.js`（`setAuthentication` / `getAuthentication`）, `tests/resource-public-origins.test.js`（新規）, `tests/resource-client.test.js`, `tests/resource-refresh.test.js`
  - 依存: なし
  - 並列サブ作業: なし（同じ `setAuthentication` を実装とテストが参照し、文言は決めた事項で固定済み。親が順に書く）

- [x] T2: 取得時の 3 分岐（JWT / JWT なし / 拒否）と R5 の文言、全取得経路の格子
  - 完了基準:
    - `#fetchResource` を決めた事項 7・8 の 3 分岐にする。R5 の文言は決めた事項 6 の固定文言で比較する: `https://x.example.com/secret/path?token=abc#frag` を拒否させ、message が `このURLはJWTの送信先として許可されていません: https://x.example.com（許可: https://api.example.com）`（publicOrigins 空）／`…（許可: https://api.example.com、JWTなし: https://ui.example.com）`（publicOrigins あり）と完全一致し、`/secret`・`token=abc`・`#frag`・設定したトークン文字列を含まない。`getToken` のモックが 0 回・fetch が 0 回（落とし穴 9）
    - publicOrigins への取得: Authorization ヘッダーが無く、`credentials: "omit"`・`cache: "no-store"`・`redirect: "error"`・`mode: "cors"`。`getToken` 0 回。`refresh` 設定ありで 401 を返すフィクスチャでも refresh の POST が 0 回・`session` は無効化されず・`"HTTP 401: …"` のエラー。続けて許可 origin への取得には JWT が付く（落とし穴 11）
    - 重複 origin（両方に宣言）への取得に `Authorization: Bearer <token>` が付く。宣言の無い origin は今どおり拒否（落とし穴 12）
    - **既存の入口 × 新しい状態の直交表**（入口ごとに 1 行ずつテストにする）: 入口 {`text`（画面・Rhai・テーマ）/ `bytes`（部品マニフェストの子ファイル）/ `binaryRequest` / `fetch`（WASM・`WasmEngine.create(url, { resources })`）/ `httpAdapter({ resources })` の GET と POST（HTTP アダプター）/ `transferRequest`（転送）} × origin の種類 {allowed / public / 両方 / 宣言なし}。各セルで「宣言なし → 送信 0 回で拒否（HTTP アダプター・転送では汎用文言 `"HTTP通信・認証に失敗しました"` / `"HTTP転送に失敗しました"` のまま。RESEARCH 落とし穴 10）」「public → Authorization なし」「allowed・両方 → Bearer」「どのセルでも message とログにトークンが出ず、`TypeError` で落ちない」を見る。refresh 設定ありの public セルで `transferRequest` の事前更新（`session.access`）が呼ばれないこと
    - 画面取得の拒否で `UiRuntime` の `onError` に `https://x.example.com（許可:` が出るテストを 1 本（落とし穴 10。実 WASM。`tests/components-loader.test.js` の `host()` 相当の組み立てを流用）
    - `ApplicationLoader`: publicOrigins を設定しても `fetch(url, { mode: "network-first" })` は `"配信キャッシュは認証なしの場合に利用できます"`（落とし穴 15）。publicOrigins だけ変えて `setAuthentication` し直すと共有の子が捨てられる（`#shareKey.auth` が変わる。子の取得回数で見る）
    - **往復プローブ**: publicOrigins に置いた画面（部品付き）を JWT モードの `UiRuntime` で実 WASM に読み込み、画面・Rhai・子パッケージの取得すべてに Authorization が無く、同じ runtime の HTTP アダプターの API 呼び出し（allowedOrigins）には Bearer が付き、handler が 1 回完了することを 1 本で見る
    - `bunx vp test run tests/resource-public-origins.test.js tests/resource-client.test.js tests/resource-refresh.test.js tests/host-adapters.test.js tests/opfs-file-transfer.test.js tests/components-loader.test.js` が通る。チェックリスト行 1・3 を実行
  - 対象: `src/resource-client.js`（`#fetchResource`・新規関数 `rejectedOrigin`）, `tests/resource-public-origins.test.js`
  - 依存: T1
  - 並列サブ作業: なし（製品側は `#fetchResource` の数十行。テストは T1 と同じファイル）

- [x] T3: R4 の単体側 — `uuidV4` と純 JS SHA-256、crypto の無い環境で部品付き画面を読む
  - 完了基準:
    - 新規 `src/sha256.js` に `export function sha256Hex(bytes)`（FIPS 180-4、同期、`Uint8Array` → 64 桁小文字 16 進）。`src/application-loader.js` の `export async function sha256(bytes)` は外部契約を変えず、呼び出しごとに `globalThis.crypto?.subtle` を見て、あれば従来の `digest`、無ければ `sha256Hex`（決めた事項 9）
    - 新規 `tests/sha256.test.js`: 長さ 0, 1, 55, 56, 63, 64, 65, 119, 120, 1_000_000 のランダムバイト列で `sha256Hex` と、subtle あり／無し（`vi.stubGlobal("crypto", { getRandomValues: (a) => webcrypto.getRandomValues(a) })`）両経路の `sha256` が `node:crypto` の `createHash("sha256")` と一致。既知値 `""` → `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`、`"abc"` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`（落とし穴 1・2）。`afterEach(() => vi.unstubAllGlobals())`
    - `src/random.js` に `export function uuidV4()`（決めた事項 10）。`src/runtime.js` の `this.screenToken = crypto.randomUUID();` を `uuidV4()` に置き換える（追従先 4）
    - 新規 `tests/insecure-context.test.js`: `vi.stubGlobal("crypto", { getRandomValues })` の直後に `globalThis.crypto.randomUUID === undefined && globalThis.crypto.subtle === undefined` を assert し（落とし穴 3）、実 WASM の `UiRuntime` で**部品を含む画面**（`tests/components-loader.test.js` の `parent(CARD_URL)` / `card()` と同じ形のフィクスチャ）を `cacheMode: "network-only"` で 2 回 `load` する。2 回とも成功し `onError` が `null` だけ、`runtime.screenToken` が `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` に一致し 2 回で異なる。`randomProvider` に固定値（`() => new Uint8Array(1024)`）を渡した runtime でも 2 回で異なる（落とし穴 4）。子のハッシュ（`ApplicationLoader` が返す `components[href].hashes.source`）が `node:crypto` の値と一致する
    - `bunx vp test run tests/sha256.test.js tests/insecure-context.test.js tests/components-loader.test.js tests/runtime.test.js tests/webmcp.test.js` が通る。チェックリスト行 4・5・6 を実行
  - 対象: `src/sha256.js`（新規）, `src/application-loader.js`（`sha256`）, `src/random.js`, `src/runtime.js`, `tests/sha256.test.js`（新規）, `tests/insecure-context.test.js`（新規）
  - 依存: なし（T1・T2 と独立。順序は T2 の後）
  - 並列サブ作業:
    - A: `sha256Hex` と `sha256` の分岐 + `tests/sha256.test.js`（対象: `src/sha256.js`, `src/application-loader.js`, `tests/sha256.test.js`）
    - B: `uuidV4` と runtime の置換 + `tests/insecure-context.test.js`（対象: `src/random.js`, `src/runtime.js`, `tests/insecure-context.test.js`。B のテストは A の着地後に親が通す）

- [x] T4: R4 の実ブラウザ検証 — このマシンの IP の HTTP で Worker モック画面と部品付き画面を開く
  - 完了基準:
    - 新規 `scripts/test-insecure-browser.mjs` と `package.json` の `"test:insecure:browser": "bun scripts/test-insecure-browser.mjs"`（追従先 14）。スクリプトは決めた事項 11〜13 のとおり: `buildRuntime` で配布版を作り、`createStaticHandler` を組み合わせた配信を `0.0.0.0` で listen し、`os.networkInterfaces()` の最初の非内部 IPv4（`--host <ip>` で上書き可。`127.*` と `localhost` は拒否して非 0 終了）の URL を Chromium（`--unsafely-treat-insecure-origin-as-secure` を付けない）で開く
    - `--install` で `.cache/ms-playwright/` に Chromium を取得する（スクリプト内で `process.env.PLAYWRIGHT_BROWSERS_PATH` を設定して `bunx playwright install chromium` を `spawn`）。起動時も同じ場所を優先する。`.gitignore` に `.cache/` を足す。出力の最初に `browser.version()` を出す（落とし穴 5）
    - ページで `isSecureContext === false`・`typeof crypto.randomUUID === "undefined"`・`crypto.subtle === undefined` を assert してから（落とし穴 6）、`tests/browser/insecure-context/boot.js` が `createRuntime` + `workerMockAdapter` で `screens/worker-orders.yaml` を読み、Worker モックの一覧の行が DOM に出ることを待つ。続けて部品を含む `screens/order-dashboard.json` を読み、子（`parts/order-list.json`）の表示が DOM に出ることを待つ（落とし穴 8）。2 回の `screenToken` が UUID v4 形式で異なる
    - コンソールの error・`pageerror`・`onError` が 0 件。失敗時はコンソール全文をスクリプト出力に残す（落とし穴 7）。サーバとブラウザは `finally` で必ず止める。前提が欠けて検証できないときは exit 0 にしない
    - `bun run test:insecure:browser > .gsd-lite/logs/ui-bridge-requests-2/scratch/turn-NNN-insecure-browser.txt 2>&1` が exit 0。出力（ブラウザ版・URL・assert の結果）を PROGRESS に写す。チェックリスト行 14 を実行
  - 対象: `scripts/test-insecure-browser.mjs`（新規）, `tests/browser/insecure-context/index.html`・`boot.js`（新規）, `package.json`, `.gitignore`
  - 依存: T3
  - 並列サブ作業: なし（スクリプトとページが互いの URL・DOM の印に依存する）

- [x] T5: 文書と依頼書（R4・R5・R6 の契約文書）
  - 完了基準:
    - `docs/authentication.md`: 「ホストAPI」節に API を別 origin に置く例（`allowedOrigins: ["https://api.example.com"]`・`publicOrigins: ["https://ui.example.com"]`）と「JWT モードでは画面・Rhai・テーマの取得も許可リストで検査されるので、`setAuthentication` を直接呼ぶホストはページ（画面の配信元）の origin を `allowedOrigins` か `publicOrigins` に入れる」。`getAuthentication()` の段落に `publicOrigins`。「送信先と失敗時の動作」節に publicOrigins の規則（JWT・トークン取得・更新なし、`credentials: "omit"`・`no-store`・リダイレクト拒否、HTTP 可、パス付きは設定エラー、両方にあれば allowedOrigins 優先、`mode: "none"` との組合せは設定エラー、配信キャッシュは使えない）と R5 の文言の例（`JWTなし:` を含む）。R5 の文言が届くのは画面・Rhai・テーマ・WASM の取得で、HTTP アダプター・転送は汎用文言のまま、と書く。追従先 7・8
    - `docs/runtime-distribution.md`: 「HTTP（安全でないコンテキスト）でも画面は読み込める。WebMCP・配信キャッシュ（network-first）・OPFS を使う storage / files / OPFS 転送は安全なコンテキスト（HTTPS か localhost）が必要」と、確認方法 `bun run test:insecure:browser`。追従先 9
    - `README.md`（追従先 10）・`docs/ai-development.md`（追従先 11。「ホスト起動コードで画面の配信元 origin を allowedOrigins か publicOrigins に入れる」「HTTP の IP で開いても画面は動くが WebMCP・配信キャッシュ・OPFS は使えない」）・`skills/uivolve-web-engine-dev/references/host.md`（追従先 12）
    - `docs/requests/ui-bridge-2.md`: 「状態」を「実装済み（Release 待ち）」にし、末尾に「対応（uivolve-web 側）」節を足して R4〜R6 の採った形（R6 は `publicOrigins`、重複は allowedOrigins 優先、HTTP 可、`mode: "none"` との組合せは設定エラー）と、Release・版の追記は MR マージ後に人が行うことを書く。追従先 13
    - 文書の断言ごとに反例を 1 つ scratch で実行（例: 「両方にあれば JWT」→ 両方に入れた origin で Authorization を観測。「パス付きは設定エラー」→ `https://a.example/p` で例外）し、PROGRESS に断言・反例・結果の表で書く
    - `bun run docs:check` と `bun run check` が exit 0。チェックリスト行 7〜13 を実行
  - 対象: `docs/authentication.md`, `docs/runtime-distribution.md`, `README.md`, `docs/ai-development.md`, `skills/uivolve-web-engine-dev/references/host.md`, `docs/requests/ui-bridge-2.md`
  - 依存: T2, T4
  - 並列サブ作業:
    - A: `docs/authentication.md` と `docs/requests/ui-bridge-2.md`（R5・R6・状態）
    - B: `docs/runtime-distribution.md`・`README.md`・`docs/ai-development.md`・`skills/uivolve-web-engine-dev/references/host.md`（R4 と一覧系）

- [x] T6: 最終判定（追従先の全行・断言の対応表・最終判定スクリプト・実ブラウザ）
  - 完了基準:
    - クリーンな状態（`git status` が clean）で `bun scripts/verify-instance-refactor.mjs --base-commit main > .gsd-lite/logs/ui-bridge-requests-2/scratch/turn-NNN-final.txt 2>&1` が exit 0 と `bun run test:insecure:browser` が exit 0
    - 追従先チェックリストの**全 14 行**を行番号つきで再実行し、PROGRESS に「行 1 … 行 14」の表（コマンド・出力の行数・判定）で書く。行数が合わなければ未完了
    - 「断言 → 実装シンボル」の対応表（チェックリスト下の 6 項目）を PROGRESS に書き、各断言の反例 1 つの実行結果を列に入れる
    - REQUIREMENTS の受け入れ基準（R4 単体・R4 実ブラウザ・R5・R6・堅牢性）を 1 行ずつ、担うテスト名と結果で対応づける
    - 要件外で見つけた穴は再現だけ行い「残留リスク候補（実測済み）」として PROGRESS に書く
  - 対象: なし（検証のみ。直しが要れば該当ファイル）
  - 依存: T1〜T5
  - 並列サブ作業: なし

- [x] F1: `setAuthentication` が読むホストの値すべてについて、ホストが投げた例外を外に出さない（verify round 1。要件「堅牢性」違反）
  - 背景: T1 で try に入れたのは options 直下の分割代入だけ。その前の `Array.isArray(options)`、`allowedOrigins` / `publicOrigins` の `Array.isArray`・`length`・`map`（添字の getter）、`TokenSession` の constructor が読む `refresh.url / token / format / clientId` は包まれていない。revoke 済み Proxy では `TypeError` がそのまま出て、getter が投げた例外は message ごと（トークンを含みうる）呼び出し元に届く（実測: `scratch/turn-009-probe.mjs` の `public proxy throws` / `allowed proxy throws` → `TypeError: leak SECRET.TOKEN.abc leak=true`）。疎配列 `[, "https://p.example"]` は空き要素が `undefined` として policy に入る（`getAuthentication()` が `publicOrigins: [null, …]` 相当を返す。allowedOrigins も同じ）
  - 期待結果（この表だけを正とする。全行で「`e.constructor === Error`」「message に設定したトークン・リフレッシュトークン・ホストが投げた message が無い」「直前の `getAuthentication()` が変わらない」も満たす）:

    | 条件（mode は jwt。`token` は有効な文字列）                                                                                       | 結果                                              |
    | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
    | 第 1 引数が revoke 済み Proxy                                                                                                     | 設定エラー「認証設定を読み取れませんでした」      |
    | `allowedOrigins` / `publicOrigins` が revoke 済み Proxy、または `length`・添字・`Symbol.iterator` の get trap が投げる Proxy 配列 | 設定エラー「認証設定を読み取れませんでした」      |
    | `refresh` が revoke 済み Proxy、または `url` / `token` / `format` / `clientId` の getter が投げる                                 | 設定エラー「認証設定を読み取れませんでした」      |
    | 投げられる値が Error でない（文字列・`null`・revoke 済み Proxy そのもの）                                                         | 設定エラー「認証設定を読み取れませんでした」      |
    | `allowedOrigins` / `publicOrigins` に空き要素（`[, "https://a.example"]`・`[,]`）                                                 | 設定エラー「HTTP / HTTPSのURLを指定してください」 |
    | 上記以外（T1 の入力格子の全セル・既存テスト）                                                                                     | 今と同じ文言（既存テストの期待値は変えない）      |

  - 完了基準:
    - 実装の形は impl が決めてよい（例: 検査全体を 1 つの try で包み、自前の設定エラーだけをそのまま通し、それ以外は固定文言に置き換える。catch の中で投げられた値のプロパティを読むと Proxy の trap が再び走るので、自前のエラーの見分けは「投げた値のプロパティを読まない」方法にする）。疎配列は `Array.from` 等で空き要素も 1 要素として検査する
    - `tests/resource-public-origins.test.js` の入力格子に上の表の各行を 1 行ずつ足し、3 条件を assert する（各行に「旧実装なら何で落ちるか」を 1 行添える）
    - `bunx vp test run tests/resource-public-origins.test.js tests/resource-client.test.js tests/resource-refresh.test.js` が通る。`scratch/turn-009-probe.mjs` を再実行して `leak=true` が 0 行
  - 対象: `src/resource-client.js`（`setAuthentication`・`publicOriginList`）, `tests/resource-public-origins.test.js`（必要なら `src/token-session.js` は触らず呼び出し側で包む）
  - 依存: なし
  - 並列サブ作業: なし

- [x] F2: 認証文書の言い切りを実装に合わせる（verify round 1。文書だけの指摘をまとめる）
  - 完了基準（それぞれ実装の該当箇所を読んで確かめ、反例を 1 つ scratch で実行して PROGRESS に表で書く）:
    - `docs/authentication.md`「送信先と失敗時の動作」末尾の段落と `skills/uivolve-web-engine-dev/references/host.md` の JWT の行: R5 の文言が届く先を実装どおりに書く。Rhai の宣言 GET（`src/http-effects.js` の `error`）・RPC（`src/rpc-client.js` → `src/storage-effects.js`）・ホストが直接呼ぶ `resources.fetch / text / bytes`・`app.json` の取得にも全文が届き、汎用文言になるのは HTTP アダプター（`httpAdapter`）と転送だけ、と書く。届く先が Rhai の結果（state に入りうる）なので許可リストの origin が state に残りうることも 1 文
    - 同節の publicOrigins の 401 の行: 「`HTTP 401: …`のエラーになる」を経路ごとの形（画面・Rhai・テーマの取得は `HTTP 401: 認証が必要、またはJWTが無効・期限切れです`、HTTP アダプターは Rhai へ `HTTP_401`、RPC は `RPC HTTP 401`）に合わせるか、「経路ごとの通常の 401 の扱い（トークン更新・再試行なし）」と言い換える
    - publicOrigins の設定エラーの列挙に、ユーザー情報付き・URL でない値（`httpUrl` の「認証情報を含まないHTTP / HTTPSのURLを指定してください」「HTTP / HTTPSのURLを指定してください」）と F1 の「認証設定を読み取れませんでした」を足す。「既定はbaseUrlのオリジン」が allowedOrigins の既定であり publicOrigins の既定は空であることを区別する
    - 既存段落「`getToken`は許可されたHTTP要求ごとに呼び」を「`allowedOrigins`への要求ごと」に直す
    - 安全上の注意を 1 文: HTTP の publicOrigins から取得した画面・Rhai は経路上で改ざんされうり、改ざんされた画面も allowedOrigins へ JWT 付きで要求できる。本番で画面・Rhai を publicOrigins から配るなら HTTPS にする
    - `bunx vp fmt` → `bun run docs:check` と `bun run check` が exit 0。チェックリスト行 7・8・12 を再実行
  - 対象: `docs/authentication.md`, `skills/uivolve-web-engine-dev/references/host.md`
  - 依存: F1（設定エラーの文言を F1 に合わせる）
  - 並列サブ作業: なし

## 決めた事項

1. `setAuthentication(options)` の第 1 引数: `undefined`（引数なし）は今どおり `{}` 扱い（none）。それ以外で plain object（`value !== null && typeof value === "object" && !Array.isArray(value)`）でないものは `"認証設定はオブジェクトで指定してください"`。フィールドの読み出し（分割代入）は try で包み、getter が投げたら `"認証設定を読み取れませんでした"`（元の例外の message は使わない）。いずれも `this.#policy` を差し替える前に投げる（根拠: `src/resource-client.js:16-23` の分割代入の既定値 `= {}`、RESEARCH 落とし穴 13）
2. `publicOrigins` の検査（JWT モード）: `undefined` → `[]`。`Array.isArray` でなければ `"JWTなしで取得するオリジンは配列で指定してください"`。各要素は `httpUrl(value)`（`src/http-policy.js:1`）を通し、`pathname !== "/" || search || hash` なら `"JWTなしで取得するオリジンにはパスを含まないオリジンを指定してください"`。`secureOrigin` は掛けない（HTTP 可）。空配列は可。`[...new Set(origins)]` で重複を除く。宣言順を保つ
3. `mode: "none"` で `publicOrigins !== undefined`（`[]` を含む）なら `"publicOriginsはJWTモードでだけ指定できます"`。`mode: "none"` の `allowedOrigins` は今どおり無視する（今回変えない）
4. policy の形: none `{ mode: "none", allowedOrigins: [], publicOrigins: [] }`、jwt は既存のキーに `publicOrigins` を足す。allowedOrigins と publicOrigins の両方にある origin は publicOrigins 側にも残す（宣言をそのまま返す。判定で allowedOrigins を先に見る）。`getAuthentication()` は `{ mode, allowedOrigins: [...], publicOrigins: [...], ...refresh }` を常に返す（キーの順もこの順）
5. 検査の順序: 第 1 引数 → mode → allowedOrigins → publicOrigins → token / getToken / refresh（既存の順の後ろに publicOrigins を入れるのではなく allowedOrigins の直後。トークンの検査より前に origin の設定エラーを出す）
6. R5 の文言は新規関数 `rejectedOrigin(origin, policy)`（`src/resource-client.js` 内、非 export）が作る: `` `このURLはJWTの送信先として許可されていません: ${origin}（許可: ${allowedOrigins.join("、")}${publicOrigins.length ? `、JWTなし: ${publicOrigins.join("、")}` : ""}）` ``。`origin` は `url.origin`（パス・query・fragment・userinfo を含まない）。区切りは全角読点「、」、括弧は全角
7. 判定の基準は `url.origin`（`httpUrl(value, this.#base)` の結果）1 つ。allowedOrigins・publicOrigins の比較も R5 の文言もこの値を使う。境界値のテスト行（T2）: 末尾スラッシュ無しの `https://ui.example.com`・既定ポート明示 `https://ui.example.com:443/x`（origin は `https://ui.example.com` に正規化されて一致）・大文字ホスト `https://UI.example.com/x`（一致）・別ポート `:444`（不一致）
8. `#fetchResource` の分岐: `authenticated = policy.mode === "jwt"`（今どおり。`#request` の `no-store` / `omit` / `error` もこの値で決まるので publicOrigins でも同じ fetch 設定になる）。`bearer = authenticated && policy.allowedOrigins.includes(url.origin)`。`authenticated && !bearer && !policy.publicOrigins.includes(url.origin)` なら `rejectedOrigin` で投げる（`getToken` / `session.access` の前）。トークン取得は `bearer` のときだけ。401 の更新・再試行の条件は `response.status === 401 && bearer && policy.session && retryAuthentication`
9. SHA-256: `src/sha256.js` の `sha256Hex(bytes)` が純 JS（同期）。`src/application-loader.js` の `sha256(bytes)` は `const subtle = globalThis.crypto?.subtle;` を**呼び出しごとに**読み、`subtle` があれば従来の `digest("SHA-256", bytes)` の 16 進、無ければ `sha256Hex(bytes)`。モジュール評価時に crypto を掴まない。正は `node:crypto` の `createHash("sha256")`（テストは両経路をこれと比べる）。メッセージ長のビット数は 2 語（上位 = `Math.floor(bitLength / 2 ** 32)`）で書き、上位語を 0 固定にしない（RESEARCH §3 案 A、落とし穴 1）
10. screenToken: `src/random.js` に `export function uuidV4()` — `const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;` を 16 進にして `8-4-4-4-12`（小文字）。`randomProvider` は使わない（根拠: `engine/src/extensions/random.rs:12-13`、RESEARCH §3 R4 screenToken）
11. 実ブラウザ検証のスクリプト名 `scripts/test-insecure-browser.mjs`、npm script 名 `test:insecure:browser`、ページは `tests/browser/insecure-context/index.html` と `boot.js`。配信の割り当て: `/runtime/*` → `buildRuntime` の出力（`scripts/build-runtime.mjs:8`。出力先は `.gsd-lite` 外の gitignore 済み `runtime-dist/` を使う）、`/screens/*`・`/mock/*` → `public/`、それ以外 → `tests/browser/insecure-context/`。各ディレクトリは `createStaticHandler`（`scripts/serve-minimal.mjs:5`）で配る
12. 開く画面: Worker モック `screens/worker-orders.yaml`（接続 `ordersMock`、`docs/worker-mock-api.md:19-25` の形）と部品付き `screens/order-dashboard.json`（`components: { orderList: { url: "parts/order-list.json" } }`、`public/screens/order-dashboard.json:6`）。`cacheMode` は既定（network-only）
13. Chromium の場所: `.cache/ms-playwright/`（リポジトリ直下、`.gitignore` に `.cache/`）。起動時は `--browser-path <exe>` > `.cache/ms-playwright` の Playwright 管理版 > `/usr/bin/chromium-browser` の順。listen は `0.0.0.0`、開く URL は `http://<IP>:<port>/`
14. HTTP アダプターと転送の拒否文言は今回変えない（`src/adapters/http.js` の `"HTTP通信・認証に失敗しました"`、`transferRequest` の `"HTTP転送に失敗しました"`）。文書にそう書く（RESEARCH §5 R5）
15. 配信キャッシュ（network-first）は publicOrigins があっても JWT モードなので使えないまま（`src/application-loader.js:402`）。コードは変えず文書に書く（落とし穴 15）

## メモ

- base HEAD（turn 2）での最終判定スクリプトの結果: PROGRESS の turn 2 に記す（ログ `.gsd-lite/logs/ui-bridge-requests-2/scratch/turn-002-final-base-3.txt`）。1・2 回目は `bun run check` が `.gsd-lite/RESEARCH.md` / `.gsd-lite/PLAN.md` の未整形で落ちた（製品コードではない）。**`.gsd-lite/*.md` を書いたら最終判定の前に必ず `bunx vp fmt` を掛ける**
- 15 タスク未満（6 タスク）。R5 と R6 は同じ `#fetchResource` を触るので T2 にまとめ、設定側（入力の格子）を T1 に分けた（T1 は格子のセル数が多く、T2 は経路の直交表が多いので 1 ターンに収めるため）
- **契約より要件を優先する**: 並列サブ作業の分担（「A は B のファイルを触らない」等）は分担のためのもの。要件違反を見つけたら分担より要件を優先し、親に報告する。実装中に見つけた穴（再現コマンド付き）は REQUIREMENTS と照らし、違反なら PLAN に F タスクを足して先頭の未完了に置く（verify に申し送らない）
- 並列サブ作業の依頼文には「完了基準の `git grep -F` が見る識別子（`publicOrigins` / `uuidV4` / `sha256Hex` / `rejectedOrigin` / `JWTなし:` 等）は本文にその綴りで出す」「テスト担当は各ケースに『旧実装（main）なら何で落ちるか』を 1 行添える」を入れ、統合前に親が `bunx vp fmt` と `bunx vp check <触ったファイル>` を掛ける
- RESEARCH「盗める点」の採否:
  | 項目                                                              | 採否         | 理由                                                                       |
  | ----------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
  | SHA-256 案 A（純 JS + subtle 優先）                               | 採用         | 依存・THIRD_PARTY_NOTICES の変更なし、安全なコンテキストの挙動は今と同一   |
  | 案 B（常に純 JS）                                                 | 却下         | network-first の既存挙動まで変える理由が無い                               |
  | 案 C（`@noble/hashes`）                                           | 却下         | runtime の依存が `yaml` だけの状態から増え、同梱・告知の更新が要る         |
  | 案 D（network-only でハッシュを省く）                             | 却下         | 受け入れ基準「SHA-256 の結果が一致」と噛み合わず将来黙って壊れる           |
  | `engine/src/extensions/random.rs` の版・variant ビット            | 採用         | JS 側 `uuidV4` を同じ形にする                                              |
  | `randomProvider` を screenToken に使う                            | 却下         | 固定乱数で token が重複し WebMCP の照合が誤認する                          |
  | MSAL の「宣言した所だけ付けない」                                 | 採用         | publicOrigins の形と同じ。重複時の優先は文書に明記                         |
  | `#fetchResource` の 3 分岐・`authenticated` はモード判定のまま    | 採用         | fetch 設定（no-store / omit / error）を publicOrigins にもそのまま効かせる |
  | 401 の更新を `bearer` のときだけにする                            | 採用         | 落とし穴 11（今の分岐のままだと匿名要求でも renew に入る）                 |
  | `scripts/test-transfer-browser.mjs` を雛形にする                  | 採用（一部） | 起動・後片付けの形は流用。`vp dev` は使わず配布版を静的配信（落とし穴 7）  |
  | `httpUrl` の流用・`secureOrigin` を publicOrigins に掛けない      | 採用         | HTTP 可の決定（DECISIONS R6 の詳細）                                       |
  | 原子的な設定差し替え（検査をすべて済ませてから `#policy` を代入） | 採用         | 既存の設計を維持。publicOrigins の検査も差し替え前（落とし穴 14）          |
- RESEARCH 落とし穴 → 検証するタスク: 1・2 → T3（`tests/sha256.test.js`）／3・4 → T3（`tests/insecure-context.test.js`）／5〜8 → T4／9・10・11・12 → T2（12 の設定側は T1）／13・14 → T1／15 → T2（テスト）と T5（文書）
- 並行性・境界値・異常系の担当: 入力の異常系の格子 → T1。経路 × origin の直交表・URL 正規化の境界値（決めた事項 7）・認証設定の途中変更（既存の `#check`。publicOrigins の取得中に `setAuthentication` で中止されることを T2 の格子に 1 行）→ T2。SHA-256 のパディング境界 → T3。実ブラウザの非安全コンテキスト → T4
- 振り返りの提案の反映（直近 2 件 `20261019-1220-http-error-body.md` / `20261010-0251-component-webmcp.md`）:
  - 反映: 実ブラウザの取得規則（取得を試みてから「実行不能」）→ 検証コマンド節・T4／チェックリストの「確かめ方」に実行したコマンドをそのまま貼り「現在」に行数を写す・パイプを使わない → 追従先チェックリスト／往復プローブを格子とは別に 1 本 → T2／契約より要件を優先 → メモ／並列サブ作業の依頼文 2 行 → メモ／`> file 2>&1`・`sed -i` を使わない → 検証コマンド節／断言ごとに反例を 1 つ → T5・T6／規則を掛ける変数（`url.origin`）を明記 → 決めた事項 7／アンカーで書く（行番号は turn 2 時点）→ チェックリストの「直す場所」は関数名・見出しで書き、行番号は「現在」欄だけ／全行再実行は 2 回に限る → チェックリスト冒頭（DECISIONS で採用済み）／F タスクは「並列サブ作業: なし」を既定 → 修正ラウンドで適用
  - 反映しない: ループ本体（トークン輪番・`--where` の文言・settings の additionalDirectories）とスキル本文の改修 → plan の範囲外。前回マイルストーンの残留リスクを T1 に置く提案 → DECISIONS「前回の残留リスク: 入れない」。実 WASM + `createUiTools` の雛形のコミット → 今回は WebMCP を触らないので見送り（T2・T3 は `tests/components-loader.test.js` の `host()` 相当をテスト内に書く）
- 行番号は turn 2 時点の値。impl は行番号のずれで PLAN を訂正しない（アンカーで探す）
