# PROGRESS — ui-bridge-requests-2

## turn 1 — research — R4〜R6 の置換箇所・Web Crypto の制約・publicOrigins の類例と落とし穴を整理

- やったこと: src の crypto・認証まわりと ui-bridge の `ui/config.js` を読み、Web Crypto の IDL・MDN・SHA-256 フォールバックの定石・MSAL の類例を調べて RESEARCH.md にまとめた。`setAuthentication` の不正入力の現状も Node で確かめた
- 想定外: `setAuthentication(null)` が今の時点で未捕捉の `TypeError` になる（`(1)` / `("jwt")` / `([])` は黙って none になる）。Playwright の Chromium も `/usr/bin/chromium-browser` も未導入。`worker-orders` 画面には部品が無く、そのままでは実ブラウザで SHA-256 の経路を通らない。HTTP アダプターと転送は拒否の文言を汎用の文言に置き換えるので、R5 の文言が見えない
- やり直し: 0 回
- 次への注意: Chromium の取得は「先頭の変数代入」が使えないので、`PLAYWRIGHT_BROWSERS_PATH` はスクリプトの中で設定する（RESEARCH 落とし穴 5）。実ブラウザ検証は `127.0.0.1` ではなく `10.14.134.62` を使い、`isSecureContext === false` を assert する。部品付きの Worker モック画面を用意する。既存テストは src の `sha256` で期待値を作っているので、node:crypto と突き合わせる。publicOrigins への 401 で refresh に入らないようにする（落とし穴 11）
- 承認待ち（ループ計測・turn 1）: 1 件 — Bash: ls

## turn 2 — plan — 6 タスク（T1 設定の入力格子 / T2 取得の 3 分岐と R5 文言・経路格子 / T3 uuidV4 と純 JS SHA-256 / T4 実ブラウザ / T5 文書と依頼書 / T6 最終判定）

- やったこと: `src/resource-client.js`・`src/application-loader.js`・`src/runtime.js`・認証と配布の文書・既存テストを読み、追従先 14 行（「現在」欄は turn 2 の実測）と決めた事項 15 件の PLAN.md を作った。base HEAD で `bun scripts/verify-instance-refactor.mjs --base-commit main` を回し、3 回目で exit 0（「OK すべての手順が期待どおり（照合は差分 0、probe は期待どおり、変異 8 本は検出された）」、464.5 秒、ログ `scratch/turn-002-final-base-3.txt`）
- 想定外: 最終判定の 1 回目は research ターンで整形されていなかった `.gsd-lite/RESEARCH.md`、2 回目は整形後に手で直した `.gsd-lite/PLAN.md` で `bun run check` が落ちた（製品コードの問題ではない。ハーネスの陳腐化も無し）。`git check-ignore` と波括弧を含む `git grep -F` は承認待ちになった（確かめ方は `rg` に差し替えた）。追従先 3 の `getAuthentication()` は当初 8 行と書いたが実測 11 行（`resource-client.js` の定義・return 3 行）で直した
- やり直し: 2 回（最終判定スクリプトの再実行。どちらも `.gsd-lite/*.md` の未整形）
- 次への注意: `.gsd-lite/*.md` を編集したら最終判定・`bun run check` の前に必ず `bunx vp fmt` を掛ける（Edit の後にも）。T1 は `getAuthentication()` の形が変わるので `tests/resource-client.test.js` と `tests/resource-refresh.test.js` の期待値を同じターンで直す。T4 の Chromium は未導入の可能性が高い — `--install` で `.cache/ms-playwright/` に取得を試みてから判断する。`127.0.0.1` ではなくこのマシンの IP（`10.14.134.62`）を使う
- 承認待ち（ループ計測・turn 2）: 3 件 — Bash: git ×2, Bash: ls

## turn 3 — impl — T1 setAuthentication の入力格子と publicOrigins の設定検査

- やったこと: サブエージェントなし。`src/resource-client.js` の `setAuthentication` を決めた事項 1〜5 のとおりに書き換えた（第 1 引数の検査 → 分割代入を try で包む → mode → allowedOrigins → publicOrigins（新規関数 `publicOriginList`）→ token / getToken / refresh。policy の差し替えは全検査の後）。`getAuthentication()` が常に `publicOrigins` を返す。新規 `tests/resource-public-origins.test.js` に第 1 引数 8 セル + `()`、origin の値 14 種 × {publicOrigins, allowedOrigins} × {none, jwt} = 56 セル、refresh / expiresIn / getToken / 未知 mode / 検査順の 9 行、getAuthentication の形・コピー・正規化・初期状態を置いた。対象 3 ファイル 110 件 pass、Vitest 全体 38 ファイル 909 件 pass（`scratch/turn-003-vitest-all.txt`）、`bun run check` exit 0
- 既存テストの期待値の変更: `tests/resource-client.test.js:146` と `tests/resource-refresh.test.js:361` の `getAuthentication()` の期待値を `{ mode: "none", allowedOrigins: [] }` → `{ mode: "none", allowedOrigins: [], publicOrigins: [] }`（決めた事項 4。none でも publicOrigins を常に返す）
- 追従先チェックリスト行 2: `rg -n -F 'allowedOrigins: [] });' tests src` → 0 件（OK）
- 想定外: なし
- やり直し: 0 回
- 次への注意: T2 で `#fetchResource` に 3 分岐を入れる。policy の `publicOrigins` は none でも `[]` が入っているので `policy.publicOrigins.includes` はモードによらず呼べる。`allowedOrigins` の検査は publicOrigins の検査より先（`{ allowedOrigins: [], publicOrigins: "x" }` は allowedOrigins のエラーになる。テスト「allowedOrigins before publicOrigins」）

## turn 4 — impl — T2 取得時の 3 分岐（JWT / JWTなし / 拒否）と R5 の文言、全取得経路の格子

- やったこと: サブエージェントなし。`src/resource-client.js` の `#fetchResource` を決めた事項 7・8 のとおり `bearer = authenticated && allowedOrigins.includes(url.origin)`、`authenticated && !bearer && !publicOrigins.includes(url.origin)` なら新規関数 `rejectedOrigin`（決めた事項 6 の固定文言）で送信前に拒否、トークン取得と 401 の更新は `bearer` のときだけにした。`tests/resource-public-origins.test.js` に追記: R5 文言の完全一致 2 行（publicOrigins 空／あり。`/secret`・`token=abc`・`#frag`・トークンが無く getToken・fetch 0 回）、publicOrigins の fetch 設定（omit / no-store / error / cors、Authorization なし、getToken 0 回）、public の 401 で refresh POST 0 回・続く API 取得に Bearer、両方 → Bearer・宣言なし → 拒否、境界値 4 行（決めた事項 7）、取得中の `setAuthentication` で中止、入口 7 種（text / bytes / binaryRequest / WasmEngine.create / httpAdapter GET・POST / transferRequest）× origin 4 種 = 28 セル（refresh 設定ありで期限内マージンに入れ、Bearer セルは refresh 1 回・public セルは 0 回、console の出力と message にトークンなし、拒否セルは送信 0 回・`TypeError` でない・転送は `not-started`）、ApplicationLoader（network-first は拒否のまま／publicOrigins だけ変えると共有の子を取り直す）、実 WASM の UiRuntime で往復プローブ（画面・Rhai・子の 4 取得に Authorization なし、API 1 回に Bearer、handler 1 回完了）と、`navigate` で宣言外 origin に遷移したとき `onError` に `https://x.example.com（許可: https://api.example.com、JWTなし: https://ui.example.com）` が出ること
- 検証: `bunx vp test run tests/resource-public-origins.test.js tests/resource-client.test.js tests/resource-refresh.test.js tests/host-adapters.test.js tests/opfs-file-transfer.test.js tests/components-loader.test.js` → 6 ファイル 332 件 pass（`scratch/turn-004-t2-targets.txt`）。Vitest 全体 38 ファイル 951 件 pass（`scratch/turn-004-vitest-all.txt`）。`bun run check` exit 0
- 既存テストの期待値の変更: なし（既存の拒否テストは部分一致で、新しい文言の先頭が旧文言と同じため）
- 追従先チェックリスト行 1: `git grep -n -F 'として許可されていません")' -- src` → 0 件（OK）
- 追従先チェックリスト行 3: `git grep -n -F 'getAuthentication()' -- src` → 11 行（`application-loader.js` 7 = `JSON.stringify` 1・`mode !== "none"` 6、`main.js` 1 = mode 比較、`resource-client.js` 3 = `return` 2・定義 1）。現在欄と同数で、形の変更で壊れる利用なし（OK）。T2 のテスト「drops the shared children when only publicOrigins changes」「refuses network-first even when every resource is public」が pass
- 想定外: なし
- やり直し: 0 回
- 次への注意: T3 は独立（`src/sha256.js`・`uuidV4`）。`tests/resource-public-origins.test.js` は先頭で `dom-renderer` / `canvas-renderer` を `vi.mock` している（実 WASM の UiRuntime 用。ファイル全体に効く）。T5 の文書で R5 の文言例を書くときは、`rejectedOrigin` の実際の出力 `このURLはJWTの送信先として許可されていません: https://x.example.com（許可: https://api.example.com、JWTなし: https://ui.example.com）` をそのまま写す

## turn 5 — impl — T3 uuidV4 と純 JS SHA-256、crypto の無い環境で部品付き画面を読む

- やったこと: サブエージェント 2 本（A: 新規 `src/sha256.js` の `sha256Hex` と `src/application-loader.js` の `sha256` を呼び出しごとの `globalThis.crypto?.subtle` で分岐 + `tests/sha256.test.js`／B: `src/random.js` の `uuidV4` と `src/runtime.js` の screenToken 置換 + `tests/insecure-context.test.js`）。親は統合後に `uuidV4` のコメントの Rust 関数名を実物（`uuid_string`）に直し、`src/sha256.js` の先頭コメントから `crypto.subtle` の語を外した（追従先行 5 に余計なヒットが出るため）。`tests/sha256.test.js` は長さ 10 種 × {`sha256Hex` / subtle あり / subtle 無し} を `createHash` と比較 + 既知値 2 種。`tests/insecure-context.test.js` は stub 直後の `randomUUID`・`subtle` 不在の assert、部品付き画面を network-only で 2 回 load（onError は null だけ・token は UUID v4 で異なる）、固定 `randomProvider` でも token が異なる、子の `hashes.source` が `node:crypto` と一致、の 3 本
- 検証: `bunx vp test run tests/sha256.test.js tests/insecure-context.test.js tests/components-loader.test.js tests/runtime.test.js tests/webmcp.test.js` → 5 ファイル 132 件 pass（`scratch/turn-005-t3-targets-2.txt`）。Vitest 全体 40 ファイル 986 件 pass（`scratch/turn-005-vitest-all.txt`）。`bun run check` exit 0（コメント修正の後にも再実行）
- 既存テストの期待値の変更: なし
- 追従先チェックリスト行 4: `git grep -n -F 'randomUUID' -- src` → 0 件（OK）
- 追従先チェックリスト行 5: `git grep -n -F 'crypto' -- src` → 4 行（`application-loader.js:9` コメント・`:12` `sha256` 内の subtle 分岐、`random.js:4`・`:11` getRandomValues）。条件どおり random.js と sha256 内だけ（OK。「現在」の 3 から uuidV4 の getRandomValues 1 行増）
- 追従先チェックリスト行 6: `git grep -n -F 'createHash' -- tests/sha256.test.js` → 2 件（OK）。`tests/components-loader.test.js` は変更なし
- 想定外: なし
- やり直し: 0 回
- 次への注意: 新規ファイルはコミット前だと `git grep` に出ない（未追跡）。チェックリストの `git grep` はコミット後か `--untracked` で見る。`tests/sha256.test.js` の 512 MiB 以上（ビット長の上位語が非 0）は実行していない（コードで 2 語書きを確認しただけ）。T4 の実ブラウザでは `isSecureContext === false` の下で `uuidV4`・`sha256Hex` の経路を通ることになる
- 承認待ち（ループ計測・turn 5）: 7 件 — Bash: bat ×2, Bash: git ×5

## turn 6 — impl — T4 安全でないコンテキストの実ブラウザ検証（test:insecure:browser）

- やったこと: サブエージェントなし。新規 `scripts/test-insecure-browser.mjs`（`buildRuntime` → `runtime-dist/`、`createStaticHandler` 3 つで `/runtime/*`・`/screens/*`+`/mock/*`（`public/`）・それ以外（`tests/browser/insecure-context/`）を `0.0.0.0` で配信し、最初の非内部 IPv4 の `http://<IP>:<port>/` を Chromium で開く。`--host`・`--browser-path`・`--install`。`PLAYWRIGHT_BROWSERS_PATH` は `process.env` に設定してから `playwright` を動的 import）、新規 `tests/browser/insecure-context/index.html`・`boot.js`（`createRuntime` + `workerMockAdapter`、`insecureContext.load(path)` が `screenToken` を返す）、`package.json` に `test:insecure:browser`、`.gitignore` に `.cache/`
- 検証: `bun scripts/test-insecure-browser.mjs --install` で `.cache/ms-playwright/` に Chrome for Testing 153.0.8010.12 を取得。`bun run test:insecure:browser` exit 0（`scratch/turn-006-insecure-browser.txt`）:
  - `Browser: 153.0.8010.12` / `URL: http://10.14.134.62:33073/`
  - `Context: {"isSecureContext":false,"randomUUID":"undefined","subtle":"undefined"}`
  - `Worker mock screen: listed 山田商店` / `Component screen: child order-list shows SO-001`
  - `screenToken: 15524799-05bf-43ed-b91a-cdbed716a9a9 / 89b030fa-8e3b-4683-8107-062bebc339d1`（UUID v4・異なる）
  - `Errors: console 0 / pageerror 0 / onError 0`
  - 反例: `bun scripts/test-insecure-browser.mjs --host 127.0.0.1` → exit 1・`error: 127.0.0.1 is a secure context; pass a non-loopback IP`（`scratch/turn-006-insecure-browser-loopback.txt`）
  - `bun run check` exit 0。src は触っていないので Vitest 全体は回していない
- 既存テストの期待値の変更: なし
- 追従先チェックリスト行 14: `git grep -n -F 'test:insecure:browser' -- package.json docs/runtime-distribution.md` → 1 件（`package.json:29`）。docs 側は T5 の担当（行 9 と同じ段落に書く）なので T5 の後に 2 件になる。`rg -n -x -F '.cache/' .gitignore` → 1 件（`17:.cache/`）
- 想定外: 初回は console error 1 件（`Failed to load resource: ... 404`）。Playwright の `response` イベントに出ないので favicon と判断し、`index.html` に `<link rel="icon" href="data:," />` を足して 0 件になった。`/usr/bin/chromium-browser` は無く、`--install` での取得は成功した
- やり直し: 1 回（favicon の 404 で console error が 1 件出た → 空アイコンを指定）
- 次への注意: T5 の `docs/runtime-distribution.md` に `bun run test:insecure:browser` を書く（行 14 が 2 件になる）。初回は `bun scripts/test-insecure-browser.mjs --install` が要ることも書く。Chromium は `.cache/ms-playwright/`（gitignore 済み）にあるので次の実行では取得不要
- 承認待ち（ループ計測・turn 6）: 3 件 — Bash: bat ×2, Bash: ls

## turn 7 — impl — T5 文書と依頼書（R4・R5・R6 の契約文書）

- やったこと: サブエージェント 2 本（A: `docs/authentication.md`（ホストAPI 節に API を別 origin に置く例・ページの origin を許可リストに入れる注意、`getAuthentication()` に `publicOrigins`、「送信先と失敗時の動作」に publicOrigins の規則 5 項目と R5 の文言例）と `docs/requests/ui-bridge-2.md`（状態を「実装済み（Release 待ち）」、末尾に「対応（uivolve-web 側）」節）／B: `docs/runtime-distribution.md`（安全でないコンテキストの段落と `test:insecure:browser`・`--install`）・`README.md`・`docs/ai-development.md`・`skills/uivolve-web-engine-dev/references/host.md`）。親は統合後、A が懸念として挙げた転送の文言を実物で確かめて直した（下の「想定外」）
- 検証: `bunx vp fmt`（6 ファイル）→ `bun run docs:check` exit 0（531 リンク / 62 ファイル）、`bun run check` exit 0。src・tests は触っていないので Vitest は回していない
- 既存テストの期待値の変更: なし
- 文書の断言と反例（`scratch/turn-007-doc-counterexamples.mjs` を `bun` で実行）:

  | 断言                                                                  | 反例の入力                                                               | 結果                                                                                                                                          |
  | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | 両方にあれば allowedOrigins 優先（JWT を付ける）                      | `https://api.example.com` を両方に宣言して `text`                        | `Authorization=Bearer SECRET-TOKEN`                                                                                                           |
  | publicOrigins は JWT・トークン取得・401 更新なし、omit/no-store/error | publicOrigins の URL が 401 を返す                                       | `Authorization=null getToken=0 fetch=1 credentials=omit cache=no-store redirect=error`、`HTTP 401: 認証が必要、またはJWTが無効・期限切れです` |
  | パス付きは設定エラー                                                  | `publicOrigins: ["https://a.example/p"]`                                 | `JWTなしで取得するオリジンにはパスを含まないオリジンを指定してください`                                                                       |
  | 配列でなければ設定エラー                                              | `publicOrigins: "https://a.example"`                                     | `JWTなしで取得するオリジンは配列で指定してください`                                                                                           |
  | `mode: "none"` との組合せは設定エラー（空配列も）                     | `{ mode: "none", publicOrigins: [] }`                                    | `publicOriginsはJWTモードでだけ指定できます`                                                                                                  |
  | publicOrigins は HTTP 可 / allowedOrigins は HTTPS 必須               | `http://10.0.0.1:8080` をそれぞれに                                      | 前者は受理（`getAuthentication` に出る）、後者は `JWTの送信先にはHTTPSを指定してください（ローカル開発を除く）`                               |
  | none の `getAuthentication()` は `publicOrigins: []`                  | `setAuthentication(undefined)`                                           | `{"mode":"none","allowedOrigins":[],"publicOrigins":[]}`                                                                                      |
  | 拒否文言は origin と許可リストだけ                                    | `https://x.example.com/secret/path?token=abc#frag`（publicOrigins あり） | 文書の例と完全一致、fetch 0・getToken 0                                                                                                       |
  | publicOrigins が空なら `、JWTなし: …` が無い                          | 同じ URL（publicOrigins なし）                                           | `…: https://x.example.com（許可: https://api.example.com）`                                                                                   |
  | subtle が無くても SHA-256 は同じ値                                    | `crypto` を `getRandomValues` だけに差し替えて `sha256("abc")`           | `createHash` と一致（`ba7816bf…`）                                                                                                            |
  | randomUUID が無くても UUID v4                                         | 同じ差し替えで `uuidV4()`                                                | `24f2424f-1c7d-4464-95ff-47465f48d889`                                                                                                        |

  「配信キャッシュは使えない」は T2 のテスト「refuses network-first even when every resource is public」が担う（今回は再実行していない）

- 追従先チェックリスト（コミット後に親が再実行）:
  - 行 7: `mode / allowedOrigins`（docs）0 件 / `publicOrigins`（authentication.md）10 / `JWTなし:` 2 行（122・125）/ `https://api.example.com` 2 行（47・122）→ OK
  - 行 8: `送信前に拒否する` は 108 行の 1 行で同じ行に `publicOrigins` → OK
  - 行 9: `docs/runtime-distribution.md:107` の 1 段落に `安全なコンテキスト`・`WebMCP`・`配信キャッシュ`・`OPFS`・`test:insecure:browser` → OK
  - 行 10: `README.md:78` 1 件 → OK
  - 行 11: `publicOrigins` 1 件（29）・`安全なコンテキスト` 1 件（30）→ OK
  - 行 12: `skills/.../host.md:20` 1 件 → OK
  - 行 13: `状態: 未着手` 0 件、`実装済み（Release 待ち）` 1 件（3）、`publicOrigins` 2 件（76・105）→ OK
  - 行 14: `test:insecure:browser` 2 件（`package.json:29`・`docs/runtime-distribution.md:107`）→ OK
- 想定外: PLAN T5・決めた事項 14 は「転送は `"HTTP転送に失敗しました"` のまま」と書くが、Rhai に届く OPFS 転送の文言は `src/adapters/http.js:393` と `src/adapters/http-download.js:51` が `"HTTP通信・認証に失敗しました"` に置き換えている（`rg -n "HTTP転送に失敗しました|HTTP通信・認証に失敗しました" src` → `resource-client.js:116` の 1 件だけが前者）。文書は「HTTPアダプターとOPFS転送がRhaiへ返すのは『HTTP通信・認証に失敗しました』（`transferRequest` を直接呼ぶホストには『HTTP転送に失敗しました』）」と実物に合わせた。挙動は変えていない（決めた事項 14 の「文言を変えない」には反しない）
- やり直し: 0 回
- 次への注意: T6 は最終判定。全 14 行の再実行と断言 → 実装シンボルの 6 項目の表、`bun scripts/verify-instance-refactor.mjs --base-commit main` と `bun run test:insecure:browser`。`.gsd-lite/*.md` を書いたら最終判定の前に `bunx vp fmt .gsd-lite/PLAN.md .gsd-lite/PROGRESS.md` を掛ける。反例スクリプトは `scratch/turn-007-doc-counterexamples.mjs`（T6 で断言表の反例に流用できる）
- 承認待ち（ループ計測・turn 7）: 6 件 — Bash: git ×6

## turn 8 — impl — T6 最終判定（追従先の全行・断言の対応表・最終判定スクリプト・実ブラウザ）

- やったこと: サブエージェントなし。`git status` clean の状態で `bun scripts/verify-instance-refactor.mjs --base-commit main` を実行し exit 0（「OK すべての手順が期待どおり（照合は差分 0、probe は期待どおり、変異 8 本は検出された）」、合計 352.6 秒、Vitest 40 ファイル 986 件 pass、`test:rust` 113 件 pass。ログ `scratch/turn-008-final.txt`）。実行後も `git status` は clean。続けて `bun run test:insecure:browser` exit 0（`scratch/turn-008-insecure-browser.txt`）: `Browser: 153.0.8010.12` / `URL: http://10.14.134.62:36129/` / `Context: {"isSecureContext":false,"randomUUID":"undefined","subtle":"undefined"}` / `Worker mock screen: listed 山田商店` / `Component screen: child order-list shows SO-001` / `screenToken: 55ec6ce0-fd35-4894-a96a-d5dcc2b47a31 / b58d30c9-e951-42d3-be70-479283d1e7a2` / `Errors: console 0 / pageerror 0 / onError 0`
- 追従先チェックリスト（全 14 行を再実行。PLAN の表と同じ 14 行）:

  | 行  | コマンド                                                                                                                   | 出力                                                                                                                          | 判定 |
  | --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---- |
  | 1   | `git grep -n -F 'として許可されていません")' -- src`                                                                       | 0 件                                                                                                                          | OK   |
  | 2   | `rg -n -F 'allowedOrigins: [] });' tests src`                                                                              | 0 件                                                                                                                          | OK   |
  | 3   | `git grep -n -F 'getAuthentication()' -- src`                                                                              | 11 行（`application-loader.js` 7 = stringify 1・mode 比較 6、`main.js:112` mode 比較、`resource-client.js` 定義 1・return 2） | OK   |
  | 4   | `git grep -n -F 'randomUUID' -- src`                                                                                       | 0 件                                                                                                                          | OK   |
  | 5   | `git grep -n -F 'crypto' -- src`                                                                                           | 4 行（`application-loader.js:9` コメント・`:12` subtle 分岐、`random.js:4`・`:11` getRandomValues）                           | OK   |
  | 6   | `git grep -n -F 'createHash' -- tests/sha256.test.js`                                                                      | 2 件                                                                                                                          | OK   |
  | 7   | `mode / allowedOrigins`（docs）/ `git grep -c publicOrigins`（authentication.md）/ `JWTなし:` / `https://api.example.com`  | 0 件 / 10 / 2 行（122・125）/ 2 行（47・122）                                                                                 | OK   |
  | 8   | `git grep -n -F '送信前に拒否する' -- docs/authentication.md`                                                              | 108 行の 1 行、同じ行に `publicOrigins`                                                                                       | OK   |
  | 9   | `git grep -n -F '安全なコンテキスト' -- docs/runtime-distribution.md`                                                      | 107 行の 1 段落に `WebMCP`・`配信キャッシュ`・`OPFS`・`test:insecure:browser`                                                 | OK   |
  | 10  | `git grep -n -F 'publicOrigins' -- README.md`                                                                              | 1 件（78）                                                                                                                    | OK   |
  | 11  | `publicOrigins` / `安全なコンテキスト`（`docs/ai-development.md`）                                                         | 1 件（29）/ 1 件（30）                                                                                                        | OK   |
  | 12  | `git grep -n -F 'publicOrigins' -- skills`                                                                                 | 1 件（`references/host.md:20`）                                                                                               | OK   |
  | 13  | `状態: 未着手` / `実装済み（Release 待ち）` / `publicOrigins`（`docs/requests/ui-bridge-2.md`）                            | 0 件 / 1 件（3）/ 2 件（76・105）                                                                                             | OK   |
  | 14  | `git grep -n -F 'test:insecure:browser' -- package.json docs/runtime-distribution.md` / `rg -n -x -F '.cache/' .gitignore` | 2 件（`package.json:29`・`runtime-distribution.md:107`）/ 1 件（17）                                                          | OK   |

- 断言 → 実装シンボル（反例は `scratch/turn-008-assertions.mjs` を `bun` で実行）:

  | #   | 断言                                             | 実装シンボル                                                                                            | 反例の入力と結果                                                                                                                            |
  | --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | 両方にある origin は JWT を付ける                | `resource-client.js:150` `bearer = … allowedOrigins.includes` が `:151` `publicOrigins.includes` より先 | `https://api.example.com` を両方に宣言して `text` → `Authorization=Bearer SECRET-TOKEN`                                                     |
  | 2   | publicOrigins ではトークン取得・401 更新なし     | `:154` `if (bearer)`・`:171` `status === 401 && bearer && …`                                            | refresh 設定ありで public の URL が 401 → `Authorization=null refreshPOST=0 fetch=1`、`HTTP 401: 認証が必要、またはJWTが無効・期限切れです` |
  | 3   | 拒否の文言は origin と許可リストだけ             | `:272` `rejectedOrigin`                                                                                 | `https://x.example.com/secret/path?token=abc#frag` → 文書の例と同じ文言、`fetch=0 getToken=0 leaks=false`                                   |
  | 4   | publicOrigins があっても配信キャッシュは使えない | `application-loader.js:408` `"配信キャッシュは認証なしの場合に利用できます"`                            | publicOrigins 付き JWT で `loader.fetch(…, { mode: "network-first" })` → 同文言で拒否                                                       |
  | 5   | 安全でないコンテキストでも SHA-256 は同じ値      | `application-loader.js:12-13` `globalThis.crypto?.subtle` の分岐と `sha256Hex`（`sha256.js:19`）        | `crypto` を getRandomValues だけにして 1000 バイトを `sha256` → `createHash` と一致（`945acdf5…`）                                          |
  | 6   | screenToken は getRandomValues から              | `random.js:10` `uuidV4`・`runtime.js:393`                                                               | 同じ差し替えで 2 回 → `6c410c02-10db-4a1b-b4b4-bf0b0a131919` / `2bfb5439-0f4c-4da3-b258-0223734950a3`（v4 形式・異なる）                    |

- 受け入れ基準 → テスト（すべて最終判定スクリプト内の Vitest 986 件 pass に含まれる）:

  | 受け入れ基準                                                                                 | 担うテスト                                                                                                                                                                                                                                                        | 結果   |
  | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
  | R4 単体: randomUUID・subtle 無しで部品付き画面を network-only で読める、token は v4 で異なる | `tests/insecure-context.test.js`「loads a screen with a component twice and gives each load its own token」「keeps the token apart from randomProvider…」                                                                                                         | pass   |
  | R4 単体: SHA-256 の結果が置き換え前と一致                                                    | `tests/sha256.test.js`（長さ 10 種 × sha256Hex / subtle あり / 無し・既知値）、`tests/insecure-context.test.js`「hashes the child's source without crypto.subtle…」                                                                                               | pass   |
  | R4 実ブラウザ: このマシンの IP の HTTP で Worker モック画面が読める                          | `bun run test:insecure:browser`（上記出力）                                                                                                                                                                                                                       | exit 0 |
  | R5: 拒否時に origin と許可リスト、パス・query・トークンなし                                  | `tests/resource-public-origins.test.js`「R5: the rejection names the origin and the lists only」、「reports the rejected origin through onError when a navigation leaves both lists」                                                                             | pass   |
  | R6: publicOrigins に Authorization なし・omit                                                | 「fetches a public origin without Authorization, with the JWT-mode settings, asking no token」「neither refreshes nor invalidates the session on a 401 from a public origin」「loads a public screen with a part anonymously and still sends the JWT to the API」 | pass   |
  | R6: 宣言なしは拒否・重複時は JWT                                                             | 「sends the JWT to an origin listed in both and rejects an undeclared one unsent」                                                                                                                                                                                | pass   |
  | R6: `mode: "none"` との組合せは設定エラー                                                    | `tests/resource-public-origins.test.js` の origin 値の格子（mode none × publicOrigins の行）                                                                                                                                                                      | pass   |
  | 堅牢性: どの値・どの経路でもトークンを出さず TypeError で落ちない                            | 「setAuthentication first argument」「other invalid JWT fields keep the previous policy」・origin 値の格子、「every fetch path × origin kind」28 セル                                                                                                             | pass   |

- 残留リスク候補（実測済み・要件外）: `mode: "none"` の `allowedOrigins` は不正値でも黙って受理される（決めた事項 3 で今回は変えない）。`bun scratch/turn-008-residual.mjs` → `none + allowedOrigins="garbage" -> accepted {"mode":"none","allowedOrigins":[],"publicOrigins":[]}`（`[1]`・`["http://10.0.0.1"]` も同じ）。例外・トークン漏れ・送信はなく、R6 の要件にも触れない。ほかに `sha256Hex` の 512 MiB 以上（ビット長の上位語が非 0）は未実行のまま（turn 5 の申し送りどおり。コードで 2 語書きを確認しただけ）
- 既存テストの期待値の変更: なし（このターンは src・tests を触っていない）
- 想定外: なし
- やり直し: 0 回（反例 2 は最初 refresh 未設定で更新経路を通らなかったので、refresh ありに差し替えて取り直した。スクリプトの書き直しで、検証の失敗ではない）
- 次への注意: 全タスク完了。verify round 1 では追従先の全行再実行（2 回目）を行う。`.gsd-lite/*.md` を書いたら `bunx vp fmt .gsd-lite/PLAN.md .gsd-lite/PROGRESS.md` を掛けてから `bun run check`。実ブラウザは `.cache/ms-playwright/` に Chromium があるので取得不要

## turn 9 — verify — 差し戻し（round 1 / 指摘 2 件 → F1 堅牢性・F2 文書）

- やったこと: 最終判定スクリプト exit 0（986 件 pass・照合差分 0・変異 8 本検出、`scratch/turn-009-final.txt`）と `test:insecure:browser` exit 0 を再確認。契約照合とセキュリティを読み取り専用サブエージェント 2 本に並行させ、堅牢性の格子は `scratch/turn-009-probe.mjs` で親がプローブ。追従先 14 行・決めた事項 15 項目は全 OK、JWT の誤送信経路なし。堅牢性の受け入れ基準に違反（入れ子の値の Proxy / getter が投げた例外・`TypeError` が素通り、疎配列が受理）→ F1。文書の届く先・401 の形・設定エラー列挙・HTTP の publicOrigins の注意 → F2。詳細は VERIFICATION.md
- 想定外: T1 の入力格子は options 直下の getter だけを「読み取り途中で投げる」クラスとして持ち、配列・`refresh` の中身では試していなかった（Proxy 配列でホストの message がそのまま出た）
- やり直し: 0 回
- 次への注意: F1 は catch の中で投げられた値のプロパティを読まない（Proxy の trap が再度走る）。既存テストの期待文言は変えない。F2 は F1 の文言に合わせる。F タスクでは追従先チェックリストは触った行（7・8・12）だけ再実行する
- 承認待ち（ループ計測・turn 9）: 1 件 — Bash: cd

## turn 10 — impl — F1 setAuthentication が読むホストの値の例外を外に出さない

- やったこと: サブエージェントなし。`src/resource-client.js` に `copyAuthentication` を足し、第 1 引数の判定・分割代入・`allowedOrigins` / `publicOrigins` の `Array.isArray` + `Array.from`（空き要素を `undefined` として残す）・`refresh` の `url / token / format / clientId` の写しを 1 つの try の中で済ませ、catch は投げられた値を読まずに「認証設定を読み取れませんでした」を投げる。検査（`publicOriginList`・`TokenSession`）は写しにだけ掛かる。`tests/resource-public-origins.test.js` に describe「host values that throw while being read (verify round 1, F1)」22 本（revoke 済み Proxy・length / 添字 / iterator の trap・refresh の 4 getter・Error でない throw 値 3 種・空き要素 4 本・map の trap は読まないので受理 1 本）。各行に旧実装での落ち方のコメント。`expectConfigError` が捕まえたエラーを返すようにした（期待値は変えていない）
- 結果: `bunx vp test run tests/resource-public-origins.test.js tests/resource-client.test.js tests/resource-refresh.test.js` 3 files / 174 passed（F1 追加後）。`bun .gsd-lite/logs/ui-bridge-requests-2/scratch/turn-009-probe.mjs` の `leak=true` は 0 行（`public proxy throws` / `allowed proxy throws` → `Error: 認証設定を読み取れませんでした leak=false keptPrevious=true`、`public sparse [ , ]` → `Error: HTTP / HTTPSのURLを指定してください`）
- PLAN 訂正: F1 の期待結果表「`length`・添字・`map` の get trap が投げる Proxy 配列」→「`length`・添字・`Symbol.iterator` の get trap」（根拠: 写しは `Array.from` で作るので `map` はもう読まない。`map` だけが投げる Proxy 配列は値どおり受理され、例外も漏れない。要件「堅牢性」は例外を外に出さないことで、受理は違反でない。テスト「no longer reads map, so a list whose map trap throws is accepted」で固定）
- 既存テストの期待値の変更: なし
- 想定外: 旧実装で新テストが落ちることを `git stash push -- src/resource-client.js` で確かめようとしたが承認外で実行されなかった（作業ツリーは無変更のまま）。旧実装での失敗は turn 9 のプローブ出力（`TypeError: leak SECRET.TOKEN.abc leak=true`）を根拠にする。疎配列リテラル `[, x]` は lint の `no-sparse-arrays` 警告になるので `Object.assign(Array(2), { 1: x })` / `Array(1)` で書いた
- やり直し: 1 回（`bun run check` で `no-sparse-arrays` 警告 2 件 → テストの疎配列の書き方を変えた）
- 次への注意: F2 の設定エラー列挙は「認証設定を読み取れませんでした」（F1 で入れ子の値にも広がった）と、空き要素が「HTTP / HTTPSのURLを指定してください」になることに合わせる。`mode: "none"` でも `allowedOrigins` / `refresh` の読み取りで投げれば同じ設定エラーになる（読むのは全フィールド。none で `allowedOrigins` を無視する挙動は値が読める場合だけ）。旧実装との比較に `git stash` は使えない
- 承認待ち（ループ計測・turn 10）: 3 件 — Bash: git ×3

## turn 11 — impl — F2 認証文書の言い切りを実装に合わせる

- やったこと: サブエージェントなし。`docs/authentication.md`（`getToken` の段落・「送信先と失敗時の動作」の既定値・publicOrigins の 401・設定エラー列挙・HTTP の publicOrigins の注意・R5 の文言が届く先）と `skills/uivolve-web-engine-dev/references/host.md` の JWT の行を実装に合わせた。実装は `src/http-effects.js:48,65`（`resources.text` の message を `error` へ）・`src/rpc-client.js:77,95`（`binaryRequest`・`RPC HTTP ${status}`）・`src/storage-effects.js:66`（RPC の message を結果へ）・`src/adapters/http.js:472,481`（汎用文言・`HTTP_${status}`）・`src/application.js:88`（`app.json` は `resources.text`）・`src/http-policy.js:6,9`（URL の設定エラー）を読んで確かめた。コミット `b3454b5`
- 反例（`bun .gsd-lite/logs/ui-bridge-requests-2/scratch/turn-011-f2-probe.mjs`）:

  | #   | 文書の言い切り                                                                      | 反例の入力                                                                                    | 結果                                                                                                                                                                       |
  | --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | R5 の全文は Rhai の宣言 GET の `error` に届く                                       | `HttpEffects` で `https://x.example.com/secret?token=abc`                                     | `rhaiGET error===R5:true fetch=0`                                                                                                                                          |
  | 2   | R5 の全文は Unary RPC に届く                                                        | `RpcClient.execute` で `https://x.example.com/rpc/M`                                          | `rpc error===R5 fetch=0`                                                                                                                                                   |
  | 3   | R5 の全文はホストが直接呼ぶ `resources.fetch / bytes` に届く                        | 宣言なし origin へ `fetch`・`bytes`                                                           | `fetch===R5:true bytes===R5:true`                                                                                                                                          |
  | 4   | publicOrigins の 401 は経路ごとの通常のエラー（更新・再試行なし）                   | refresh 設定ありで public の URL が 401（`text`・RPC idempotent・実 WASM の HTTP アダプター） | `text error:HTTP 401: 認証が必要、またはJWTが無効・期限切れです / rpc error:RPC HTTP 401: unknown:  / adapter code=HTTP_401 / refreshPOST=0 Authorization付き=0 fetch=3`   |
  | 5   | publicOrigins の設定エラーにユーザー情報付き・URL でない値・読み取り不能・空き要素  | `["https://user:pw@ui.example.com"]` / `["not a url"]` / revoke 済み Proxy / `Array(1)`       | `認証情報を含まないHTTP / HTTPSのURLを指定してください` / `HTTP / HTTPSのURLを指定してください` / `認証設定を読み取れませんでした` / `HTTP / HTTPSのURLを指定してください` |
  | 5b  | `allowedOrigins` の既定は baseUrl のオリジン、`publicOrigins` の既定は空            | `{ mode: "jwt", getToken }`                                                                   | `{"mode":"jwt","allowedOrigins":["https://ui.example.com"],"publicOrigins":[]}`                                                                                            |
  | 6   | `getToken` は `allowedOrigins` への要求ごと                                         | public へ 1 回・allowed へ 1 回 `text`                                                        | `getToken public=0 allowed=1`                                                                                                                                              |
  | 7   | HTTP の publicOrigins の画面も allowedOrigins へ JWT 付きで要求できる（注意の根拠） | publicOrigins `["http://10.0.0.1:8080"]` から取得の後に API へ                                | `http://10.0.0.1:8080/screens/a.json Authorization=null / https://api.example.com/orders Authorization=Bearer SECRET-TOKEN`                                                |

- 追従先チェックリスト（触った行だけ）: 行 7 — `mode / allowedOrigins` 0 件 / `publicOrigins` 13 / `JWTなし:` 2 行（123・126）/ `https://api.example.com` 2 行（47・123）→ OK。行 8 — 108 行の 1 行、同じ行に `publicOrigins` → OK。行 12 — `references/host.md:20` の 1 件 → OK
- 検証: `bunx vp fmt`（3 files）→ `bun run docs:check`（531 targets / 62 files）・`bun run check`（327 files formatted・lint 0）とも exit 0。src・tests は触っていないので Vitest は回していない
- 既存テストの期待値の変更: なし
- 想定外: なし
- やり直し: 0 回
- 次への注意: 全タスク完了。verify round 2 へ。RPC の 401 の message は本文が JSON なら `RPC HTTP 401: <code>: <message>` になる（プローブでは `{}` 本文で `unknown: `）。文書は `RPC HTTP 401` の接頭辞で書いた

## turn 12 — verify — 合格（round 2 / 指摘 0 件 / MR !6 作成）

- やったこと: round 2 なので新規探索はせず、round 1 の格子の再確認（`turn-009-probe.mjs` 再実行で `leak=true` 0 行）と F1・F2 差分の回帰（`scratch/turn-012-f1-regress.mjs` 14 ケース全 OK、チェックリスト行 7・8・12 OK）。最終判定スクリプト exit 0（Vitest 1008 件 pass・照合差分 0・変異 8 本検出）、`test:insecure:browser` exit 0。push して `glab mr create` で MR を作成: https://gitlab.nasa.future.co.jp/fre/components/uivolve-web/-/merge_requests/6
- 想定外: `bat -r` と `glab mr list`・`git ls-remote` が承認外で実行されなかった（Read と `fix_round: 0` で代替。MR は新規作成で問題なし）。最終判定は 10 分を超えたので終了待ちを 2 回かけた
- やり直し: 0 回
- 次への注意: reflect へ。MR のマージ・Release・依頼書への版の追記は人が行う。ファイル閲覧は `bat` ではなく Read を使う（`bat -r` は allowlist 外）
- 承認待ち（ループ計測・turn 12）: 4 件 — Bash: bat ×2, Bash: git, Bash: glab

## turn 13 — reflect — ui-bridge-requests-2

- やったこと: 振り返りを .gsd-lite/reflect/20261024-2114-ui-bridge-requests-2.md に作成（提案 9 件、うち AGENTS.md 候補 4 件）
- 想定外: turn 12 は作業完了（801.9 秒）の後、`pgrep -f` の待ちループが自己一致で終わらず約 500 秒を使っていた（`turn-012-attempt1.log` にだけ記録があり PROGRESS には無い）
- やり直し: 0 回
- 次への注意: 堅牢性の格子は「値の種類 × 読む場所」の 2 軸にして読み取りで投げる値を各場所に置く、文書の列挙型の言い切りは全部断言表に入れる、長時間コマンドは `run_in_background` の完了通知で待つ
