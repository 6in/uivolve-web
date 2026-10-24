# RESEARCH — ui-bridge からの要望 その 2（R4〜R6）

調査対象: `local_projects`（`.` と `../ui-bridge-component`）・`official_docs`・`similar_oss`。
discuss の決定を覆す発見は無い（BLOCKED なし）。

## 1. 参考実装（ローカル）

| 場所                                                                          | 内容                                                                                                                                            | 使い方                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/random.js:4`                                                             | `crypto.getRandomValues(new Uint8Array(1024))`                                                                                                  | R4 の screenToken の乱数の素材                                                                  |
| `engine/src/extensions/random.rs:12-13`                                       | `bytes[6] = (bytes[6] & 0x0f) \| 0x40`（UUID v4 の版ビット）と `bytes[8] = (bytes[8] & 0x3f) \| 0x80`（variant）                                | JS 側の UUID v4 の組み立てを同じ形にする                                                        |
| `src/runtime.js:392`                                                          | `this.screenToken = crypto.randomUUID();`                                                                                                       | R4 の置換箇所（他に `randomUUID` の利用は src に無い）                                          |
| `src/application-loader.js:8-12`                                              | `sha256` は `crypto.subtle.digest`。利用は `manifestRevision`・`verify`・`#directory`（network-first のみ）・`#fromNetwork`（**network-only**） | R4 の置換箇所                                                                                   |
| `src/resource-client.js:16-58, 131-132`                                       | `setAuthentication` の検査と拒否の例外                                                                                                          | R5・R6 の置換箇所                                                                               |
| `src/http-policy.js`                                                          | `httpUrl` / `secureOrigin` / `bearerToken`                                                                                                      | publicOrigins の origin 検査に `httpUrl` を流用（`secureOrigin` は publicOrigins には掛けない） |
| `scripts/test-transfer-browser.mjs`                                           | Playwright Chromium + `vp dev` + Bun.serve の起動・後片付けの雛形。`TRANSFER_BROWSER_PATH` で実行ファイルを差し替え可                           | R4 の実ブラウザ検証の雛形                                                                       |
| `scripts/serve-minimal.mjs` の `createStaticHandler`                          | 静的配信のハンドラー（`hostname` は 127.0.0.1 固定。ハンドラーだけ import して IP で listen できる）                                            | R4 の実ブラウザ検証で配信に使える                                                               |
| `public/screens/worker-orders.yaml` / `.rhai` / `public/mock/orders-api.yaml` | Worker モックの完全な画面例（`docs/worker-mock-api.md:97`）                                                                                     | R4 の実ブラウザ検証で開く画面                                                                   |
| `tests/components-loader.test.js:3,81,907,1643`                               | 既存テストは `sha256` を src から import して期待値を作っている                                                                                 | 置換後は自己参照になるので、別の正（node:crypto）と突き合わせる                                 |
| `tests/distribution.test.js:3`                                                | `import { createHash } from "node:crypto"`                                                                                                      | SHA-256 の正の値の作り方の前例                                                                  |
| `../ui-bridge-component/ui/config.js:30-34`                                   | ui-bridge は回避として `allowedOrigins` にページの origin も入れている（モック時は `[]`）                                                       | R5 の文書の例、R6 の利用者側の移行先（ページ origin を publicOrigins へ）                       |

## 2. 公式仕様の事実（plan の技術前提）

- Web Crypto の IDL（https://w3c.github.io/webcrypto/ の `interface Crypto`）:
  `[SecureContext] subtle` / `getRandomValues`（**SecureContext なし**）/ `[SecureContext] randomUUID()`。
  → `getRandomValues` は HTTP でも使える。`crypto.subtle` は HTTP では `undefined`（例外ではなく属性が無い）。
- MDN「Features restricted to secure contexts」: Storage API（`navigator.storage`）・Web Locks・Web Crypto は安全なコンテキスト専用。
  Dedicated / module Worker は対象外（Worker モックは HTTP でも動く）。
- 通常読込（network-only）の経路で安全なコンテキスト専用の API は `randomUUID` と `subtle.digest` の 2 つだけ（`rg` で
  `crypto|subtle|randomUUID|navigator.|locks|storage` を src 全体で確認）。WebMCP は `document/navigator.modelContext` が無ければ
  登録しないだけ（`src/ui-tools.js:294-298`）。OPFS の storage/files は `src/storage-client.js:129-130` で
  「HTTPSまたはlocalhostが必要です」の例外を既に出す。
- Chromium は `--unsafely-treat-insecure-origin-as-secure` で HTTP を安全扱いにできる。**実ブラウザ検証ではこのフラグを付けない**。

## 3. 盗める設計・使えるライブラリ

### R4 SHA-256 の手段（推奨: 依存を足さない純 JS 実装 + subtle があればそちら）

| 案                                                                                                                                                                                      | 長所                                                                     | 短所                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| A. `src/sha256.js` に FIPS 180-4 の純 JS 実装（約 50 行）を置き、`sha256()` は `globalThis.crypto?.subtle` があれば従来どおり、無ければ純 JS（**推奨**）                                | 依存・THIRD_PARTY_NOTICES の変更なし。安全なコンテキストの挙動は今と同一 | 経路が 2 つになる → 両方を同じ正と突き合わせるテストが要る                                                           |
| B. 常に純 JS                                                                                                                                                                            | 経路が 1 つ                                                              | network-first（1 MB × 複数）の既存挙動も変わる。速度は 2 MB 上限なら数十 ms 程度で実害は小さい                       |
| C. `@noble/hashes`（`@noble/hashes/sha2.js` の `sha256`。Cure53 監査済み・依存なし・ESM）                                                                                               | 監査済み                                                                 | runtime の依存が `yaml` だけの状態から増える。runtime-dist への同梱と THIRD_PARTY_NOTICES の更新が要る               |
| D. network-only ではハッシュを計算しない（`#fromNetwork` の `hashes` は、`#share` がモード変更で消えるので network-only では比較に使われない。`src/application-loader.js:346,387-388`） | 計算そのものを省ける                                                     | 「SHA-256 の結果が一致」の受け入れ基準と噛み合わず、将来 network-only の hashes を比べる変更で黙って壊れる。採らない |

- 同型の OSS: `js-sha256`（同期 API、Web Crypto と同じ 16 進を返す）、`@noble/hashes`。いずれも「subtle があれば優先、無ければ純 JS」が定石。
- `sha256` の外部契約（`export async function sha256(bytes): Promise<string /* 64 桁小文字 16 進 */>`）は変えない。呼び出し元は
  すべて `Uint8Array`（`encoder.encode` / `resources.bytes` / `directory.read`）。

### R4 screenToken

- `crypto.getRandomValues(new Uint8Array(16))` → `b[6]=(b[6]&0x0f)|0x40`、`b[8]=(b[8]&0x3f)|0x80` → `8-4-4-4-12` の小文字 16 進。
  `randomProvider`（テスト用の固定乱数）は**使わない**（screenToken が読込ごとに異なる必要があるため。固定乱数を注入したテストで
  同じ token が 2 回出ると WebMCP の照合が「今の画面」を誤認する）。

### R6 publicOrigins（類例）

- MSAL Angular の `protectedResourceMap`: 値を `null` にした URL はトークンを付けない（明示の非保護宣言）。
  「宣言した所だけ付けない・他は既定どおり」という今回の形と同じ。重複時の優先順位は MSAL の文書に明記なし → 今回の
  「allowedOrigins 優先」は DECISIONS どおりで、文書に明記する価値がある。
- 実装の形（推奨）: `policy` に `publicOrigins: [...new Set(origins)]` を足し、`#fetchResource` の判定を
  `allowedOrigins.includes → JWT` / `publicOrigins.includes → 匿名（token なし）` / それ以外 → R5 の例外、の 3 分岐にする。
  `#request` の `authenticated` は「policy.mode」ではなく「この要求が JWT モード下か」で決める（publicOrigins でも
  `no-store` / `omit` / `error` を使うため、モード判定のままでよい。token の有無とは独立）。
- `getAuthentication()` に `publicOrigins` を足すと、`ApplicationLoader.fetch` の `#shareKey.auth`（`JSON.stringify(getAuthentication())`、
  `src/application-loader.js:386`）にも自動で入り、publicOrigins を変えると共有の子パッケージが捨てられる（望ましい）。

## 4. 落とし穴と回避策（各項目に「踏んでいないと分かる検証」）

1. **純 JS SHA-256 のパディング境界**: 長さ 55/56/63/64/65 バイトと 0 バイトで誤りやすい。ビット長は 32 ビットを超えうる
   （今は 1 MB 上限で届かないが上位語を 0 固定にしない）。
   検証: 長さ 0,1,55,56,63,64,65,119,120,1_000_000 のランダムバイト列で `node:crypto` の `createHash("sha256")` と一致。
   既知値 `""`→`e3b0c442…b855`、`"abc"`→`ba7816bf…15ad` も固定で持つ。
2. **既存テストの自己参照**: `tests/components-loader.test.js` は src の `sha256` で期待値を作るため、実装が壊れても通る。
   検証: 上の node:crypto 突き合わせを subtle あり / 無しの両経路で行う（無しは `vi.stubGlobal("crypto", { getRandomValues })`）。
3. **vitest で crypto を消す方法**: Node の `globalThis.crypto` は configurable な getter（確認済み）なので `vi.stubGlobal` で差し替えられる。
   `delete` や代入だけでは他テストに漏れる。検証: `afterEach(vi.unstubAllGlobals)` を置き、差し替え後に
   `globalThis.crypto.randomUUID === undefined && globalThis.crypto.subtle === undefined` を assert してから読み込む。
   WASM エンジンの読込（`WasmEngine.create`）やモジュール評価時に crypto を掴むコードが無いことも、この環境で部品付き画面を
   最後まで読めることで確かめる。
4. **screenToken の形と一意性**: 検証: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` に一致し、
   同じ画面を 2 回読み込むと値が異なる。`randomProvider` を固定にしたテストでも異なること。
5. **実ブラウザ: Chromium が未導入**（`chromium.executablePath()` = `~/.cache/ms-playwright/chromium-1243/...` は存在しない。
   `/usr/bin/chromium-browser` も無い）。取得先は作業ディレクトリ内（要件）だが、`PLAYWRIGHT_BROWSERS_PATH=... bunx playwright install chromium`
   は無人ターンで禁じられた「先頭の変数代入」になる。回避: Node/Bun のスクリプト内で `process.env.PLAYWRIGHT_BROWSERS_PATH` を
   設定してから `playwright` の CLI を `spawn` する、またはインストール済みブラウザのパスを `executablePath` に渡すスクリプトを
   `.gsd-lite/logs/<slug>/scratch/` か `scripts/` に置く。共有ライブラリ不足（libnss3 等）で起動しない可能性があり、その場合
   `sudo` が要るなら BLOCKED に上げる（推測で迂回しない）。
   検証: スクリプトが `browser.version()` を出力すること。
6. **実ブラウザ: 本当に安全でないコンテキストか**: `127.0.0.1` / `localhost` は安全扱いになるので使えない。このマシンの IP は
   `10.14.134.62`（`hostname -I` の先頭。ui-bridge の UAT と同じ）。サーバは `0.0.0.0` か `10.14.134.62` で listen する。
   `--unsafely-treat-insecure-origin-as-secure` を付けない。
   検証: ページで `isSecureContext === false` と `typeof crypto.randomUUID === "undefined"` と `crypto.subtle === undefined` を
   assert してから、画面の DOM（Worker モックの一覧の行など）が出ることと `onError` / コンソールエラーが無いことを見る。
7. **実ブラウザ: 配信サーバの選択**: `vp dev`（Vite）の開発クライアントや HMR が HTTP の LAN IP で別の安全なコンテキスト専用 API を
   踏むと、runtime ではなく開発サーバ側の理由で失敗し得る（Vite/SvelteKit で LAN IP の `randomUUID` 報告あり、wontfix）。
   回避: `build:runtime` の成果物を `createStaticHandler` で配る（ui-bridge と同じ「配布版を静的配信」の形）か、`vp dev` を使うなら
   失敗時に原因がどちらか切り分けられるようコンソールを全部記録する。検証: 失敗時のコンソールログがスクリプト出力に残る。
8. **部品を含む画面での確認**: `public/screens/worker-orders.yaml` には部品（`components:`）が**無い**（`rg` で確認）ので、
   そのまま開いても SHA-256 の経路（`#fromNetwork`）を実ブラウザで通らない。
   検証: 実ブラウザで開く画面に components を 1 つ以上含める（検証用に部品付きの Worker モック画面を用意する）。
   単体テストでは `tests/components-loader.test.js` の部品付き network-only の既存フィクスチャを crypto 無し環境で再利用する。
9. **R5: 例外に出すのは origin だけ**: `url.origin` は userinfo・パス・クエリ・fragment を含まない（`httpUrl` が userinfo を拒否済み）。
   トークンは判定より後で取得するので文言に入りようがないが、`getToken` を呼ぶ前に例外にすること。
   検証: `https://x.example.com/secret/path?token=abc#frag` を拒否させ、message に `https://x.example.com` と許可リストが含まれ、
   `/secret`・`token=abc`・`#frag`・設定したトークン文字列が含まれないこと。`getToken` のモックが 0 回呼ばれること。
   publicOrigins が空なら「JWTなし:」の節を出さない／あれば並べる、の両方を固定文言で比較する。
10. **R5 の文言が届かない経路**: HTTP アダプター（`src/adapters/http.js:470-472`、`"HTTP通信・認証に失敗しました"`）と
    転送（`transferRequest`、`"HTTP転送に失敗しました"`）は元の message を捨てる。R5 の改善が見えるのは画面・Rhai・テーマ・
    WASM の取得（今回の困りごとの経路）だけ。要件の範囲内だが文書で誤解させないこと。
    検証: 画面取得の拒否で runtime の `onError` に origin が出るテストを 1 本置く。
11. **R6: publicOrigins への取得でトークンに触れない**: `getToken` も `session.access` / `renew` も呼ばない。401 が返っても
    リフレッシュしない（`retryAuthentication` の分岐が `policy.session` だけを見ているので、匿名要求でも 401 → renew に入る）。
    検証: publicOrigins の URL が 401 を返すフィクスチャで、`getToken` 0 回・refresh の fetch 0 回・401 のエラーになること。
    Authorization ヘッダーが無く `credentials: "omit"`・`cache: "no-store"`・`redirect: "error"` であること。
12. **R6: 重複・HTTP・パス付き・mode none**: 検証: 両方にある origin は Authorization 付き。`http://10.0.0.1:8080` は publicOrigins に
    書けて allowedOrigins では従来どおりエラー。`https://x.example.com/path` は設定エラー。`{ mode: "none", publicOrigins: [...] }` は
    設定エラー（`publicOrigins: []` や `undefined` を mode none で渡したときの扱いを plan で決める。推奨: `undefined` だけ許す）。
13. **堅牢性の格子で今すでに落ちる入力**: `setAuthentication(null)` は現状 `TypeError: Cannot read properties of null` で落ちる
    （分割代入の既定値 `= {}` は `undefined` にしか効かない）。`setAuthentication(1)` / `("jwt")` / `([])` は黙って `mode: "none"` になる。
    `allowedOrigins: "https://a.example"`（配列でない）は既にエラー。`publicOrigins` も文字列を 1 文字ずつ回さないこと
    （`Array.isArray` で弾く）。`[Symbol()]`・`toString` が投げる要素は `httpUrl` の try で `Error` になる（確認済み）。
    検証: 入力の格子（null / 数値 / 文字列 / 配列 / 空配列 / 重複 / パス付き / HTTP / Symbol / toString が投げる値）×（mode none / jwt）で
    例外の型が `TypeError` でないこと、message に設定したトークン文字列が無いこと、設定エラー時に直前の policy が維持されること
    （例外が policy の差し替え前に出ること）を確かめる。
14. **設定の途中で失敗したときの状態**: 現状は検査をすべて済ませてから `this.#policy` を差し替えるので、publicOrigins の検査も
    差し替え前に置く。検証: 正しい JWT 設定の後に不正な publicOrigins で呼び、`getAuthentication()` が前の値のままであること。
15. **配信キャッシュとの関係**: publicOrigins を設定しても mode は `jwt` なので network-first は従来どおり「認証なしの場合に利用できます」で
    拒否される（`src/application-loader.js:402`）。変える必要はない。文書で「publicOrigins があっても配信キャッシュは使えない」と明記するか
    plan で判断。

Rhai の予約語（識別子の衝突回避用。今回は Rhai を書く予定は無いが、検証用の画面を足す場合に参照）: `go` / `goto` / `call` / `exit` /
`match` / `case` / `public` / `private` / `new` / `use` / `with` / `module` / `package` / `super` / `spawn` / `thread` / `task` / `async` /
`await` / `yield` / `default` / `void` / `null` / `nil` / `shared` / `var` / `static` / `is` / `as` ほか（正は rhai クレートのソース）。

## 5. 要件への影響（提案。REQUIREMENTS.md 本文は変えない）

- **R4 文書**: 「安全なコンテキストが必要」の列挙に、WebMCP と配信キャッシュに加えて **OPFS を使う storage / files（と OPFS 転送）** も
  入れることを提案（`src/storage-client.js:129-130` が既に同旨の例外を出す。文書に無いと HTTP でそれらを試して驚く）。
- **R4 受け入れ基準**: 「SHA-256 の結果が置き換え前と一致」は、src の `sha256` 同士ではなく `node:crypto` の値と突き合わせ、
  パディング境界の長さを含めることを提案。実ブラウザで開く画面は部品を含むものにすることを提案（落とし穴 8）。
- **R5**: 文言が届くのは画面・Rhai・テーマ・WASM の取得。HTTP アダプター・転送は従来の汎用文言のまま（今回変えない）を
  plan に明記することを提案。
- **R6 受け入れ基準**: 「publicOrigins への 401 でリフレッシュしない」を足すことを提案（落とし穴 11。今の分岐のままだと踏む）。
- **堅牢性**: `setAuthentication(null)` の `TypeError` を格子の初回タスクで直す対象に含めること（落とし穴 13）。
  プリミティブ（数値・文字列・配列）を黙って `none` にする現状を設定エラーに変えるかは plan で決める（推奨: `undefined` と
  プレーンなオブジェクト以外は設定エラー。黙って認証なしに落ちるのは fail-closed の趣旨に反する）。

## 出典

- W3C Web Cryptography API（`interface Crypto` の IDL）: https://w3c.github.io/webcrypto/
- MDN Features restricted to secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts/features_restricted_to_secure_contexts
- MDN SubtleCrypto.digest(): https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest
- Authgear「SubtleCrypto: digest() undefined」（HTTP で subtle が無い事例）: https://docs.authgear.com/troubleshooting/how-to-fix-subtlecrypto-digest-undefined-error-in-authgear-sdk
- MojoAuth「SHA-256 in JavaScript in the Browser」（js-sha256 のフォールバック）: https://mojoauth.com/security-guides/sha-256-in-javascript-in-browser.md
- @noble/hashes（JSR）: https://jsr.io/@noble/hashes
- SvelteKit/Vite の LAN IP での randomUUID 報告: https://lightrun.com/answers/sveltejs-kit-cryptorandomuuid-fails-on-mobile-in-dev
- MSAL Angular interceptor（protectedResourceMap の null）: https://learn.microsoft.com/en-us/entra/msal/javascript/angular/msal-interceptor
