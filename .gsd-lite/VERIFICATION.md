# VERIFICATION — ui-bridge-requests-2

## round 2（turn 12）— 合格

対象: `git diff main...HEAD`。round 2 なので新しいクラスの探索はせず、round 1 の格子の再確認と F1（`d1110fc`）・F2（`b3454b5`）の差分の回帰だけを行った。
サブエージェントは使っていない（回帰確認だけで、差分は `src/resource-client.js` の 1 関数と文書 2 ファイル）。

### 実行した検証

| 検証                                                                   | 結果                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun scripts/verify-instance-refactor.mjs --base-commit main`（clean） | exit 0。Vitest 40 ファイル 1008 件 pass（round 1 の 986 件 + F1 の 22 件）、照合差分 0、probe 期待どおり、変異 8 本検出（`scratch/turn-012-final.txt`）                                                                                                                                                                                                                                              |
| `bun run test:insecure:browser`                                        | exit 0。Chromium 153、`http://10.14.134.62:…/` で `isSecureContext:false`・randomUUID / subtle 無し、Worker モック画面と部品付き画面を表示、screenToken 2 つが v4 で異なる、エラー 0（`scratch/turn-012-insecure-browser.txt`）                                                                                                                                                                      |
| round 1 の格子の再確認（`scratch/turn-009-probe.mjs` を再実行）        | `leak=true` 0 行。round 1 で NG だった `public proxy throws` / `allowed proxy throws` は「認証設定を読み取れませんでした」・直前の設定を保持、疎配列は「HTTP / HTTPSのURLを指定してください」。他の行は round 1 と同じ（`scratch/turn-012-probe-r1.txt`）                                                                                                                                            |
| F1 の回帰（`scratch/turn-012-f1-regress.mjs`）                         | options・`allowedOrigins`（none でも）・`refresh` の revoke 済み Proxy、`refresh.url` の getter が `TypeError`（トークン入り）・文字列・`null`・revoke 済み Proxy を投げる → すべて `Error` の固定文言・漏れなし・直前の設定を保持。関数の `refresh` は「リフレッシュ設定を指定してください」、正常な `refresh`（json / oauth + clientId）は受理。toString が投げるトークン・origin 要素は従来の文言 |
| F2 の回帰（チェックリスト行 7・8・12）                                 | 行 7: `JWTなし:` 2 行（123・126）、`publicOrigins` 13 件。行 8: 108 行に `publicOrigins`。行 12: `references/host.md` 1 件。旧い言い回し（「許可されたHTTP要求ごと」「テーマ・WASMの取得」「HTTPアダプター・転送は汎用」）は docs / skills / README に 0 件                                                                                                                                          |

### F タスクの判定

| F   | 判定 | 根拠                                                                                                                                                                                                                                                                                                           |
| --- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | OK   | `copyAuthentication` がホストの値（第 1 引数・分割代入・2 つの origin 配列の `Array.from`・`refresh` の 4 フィールド）を 1 つの try の中で写し、catch は投げられた値を読まない。検査（`httpUrl` / `publicOriginList` / `TokenSession` / `bearerToken`）は写しにだけ掛かり、いずれも自前の `Error` しか投げない |
| F2  | OK   | 届く先（宣言 GET・RPC・`resources.fetch / text / bytes`・`app.json`）、publicOrigins の 401 の経路別の形、設定エラーの列挙、既定値の区別、`getToken` の呼ばれる先、HTTP の publicOrigins の注意が実装（impl の反例表 turn 11）と一致                                                                           |

### 受け入れ基準

R4 単体・R4 実ブラウザ・R5・R6 は round 1 と同じく OK（テストは最終判定内で pass、実ブラウザは上表）。堅牢性は F1 で OK。

### 残留リスク（差し戻さない）

round 1 の 5 件のまま（下記）。F1 で増えたものはない。

### MR

- https://gitlab.nasa.future.co.jp/fre/components/uivolve-web/-/merge_requests/6（`gsd-lite/ui-bridge-requests-2` → `main`、`glab mr create`。マージは人が行う）

## round 1（turn 9）— 差し戻し（指摘 2 件 → F1・F2）

対象: `git diff main...HEAD`（src / tests / docs / scripts / skills / README.md / package.json / .gitignore）。
並列レビュー: 契約文書 ↔ 実装の一対一（追従先チェックリスト全 14 行 + 決めた事項 1〜15 + 文言の列挙）と、
セキュリティチェックを読み取り専用のサブエージェント 2 本に分け、親が統合した。堅牢性の格子は親がプローブした
（`scratch/turn-009-probe.mjs`）。

### 実行した検証

| 検証                                                                                                                    | 結果                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun scripts/verify-instance-refactor.mjs --base-commit main`（clean）                                                  | exit 0。Vitest 40 ファイル 986 件 pass、照合差分 0、probe 期待どおり、変異 8 本検出（`scratch/turn-009-final.txt`）                                                                    |
| `bun run test:insecure:browser`                                                                                         | exit 0。`isSecureContext:false`・randomUUID / subtle 無しで Worker モック画面と部品付き画面を表示、screenToken 2 つが v4 で異なる、エラー 0（`scratch/turn-009-insecure-browser.txt`） |
| 追従先チェックリスト全 14 行（2 回目の全行再実行）                                                                      | 14 行すべて OK（件数は turn 8 の表と同じ。行 7 の `JWTなし:` は 2 行（122・125））                                                                                                     |
| 決めた事項 1〜15                                                                                                        | すべて実装どおり                                                                                                                                                                       |
| JWT が許可リスト外へ出る経路（リダイレクト・401 再試行・事前更新・転送・HTTP アダプター・ResourceClient 外の `fetch(`） | なし                                                                                                                                                                                   |

### 受け入れ基準

| 基準                                                                                 | 判定   | 根拠                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R4 単体（randomUUID・subtle 無しで部品付き画面、token v4・毎回異なる、SHA-256 一致） | OK     | `tests/insecure-context.test.js`・`tests/sha256.test.js`。プローブで uuidV4 10000 件一意・`sha256` の subtle 無し経路が `createHash` と一致 |
| R4 実ブラウザ                                                                        | OK     | 上表                                                                                                                                        |
| R5 拒否文言（origin と許可リストだけ）                                               | OK     | プローブ `https://evil.example.com/p?token=<T>` → origin と一覧だけ、送信 0、漏れなし                                                       |
| R6 publicOrigins（Authorization なし・omit・重複は JWT・none は設定エラー）          | OK     | テスト + プローブ（`http://10.0.0.1:8080` は omit・Authorization なし、`:80` は拒否）                                                       |
| 堅牢性「どんな値でもトークンを例外に出さず、TypeError で落ちない」                   | **NG** | 指摘 1                                                                                                                                      |

### 指摘

1. **（要件違反 → F1）`setAuthentication` の入れ子の値から、ホストが投げた例外・`TypeError` がそのまま出る。**
   options 直下の分割代入は try に入っているが、`Array.isArray(options)`、`allowedOrigins` / `publicOrigins` の
   配列の読み取り、`TokenSession` が読む `refresh` の各フィールドは包まれていない。revoke 済み Proxy で `TypeError`、
   get trap が投げる配列ではホストの message（トークンを含みうる）が素通りする
   （`public proxy throws -> TypeError: leak SECRET.TOKEN.abc leak=true keptPrevious=true`。`allowedOrigins` も同じ。
   `refresh` の getter はセキュリティレビューがコードで確認、main 以前からの経路）。あわせて疎配列
   `[, "https://p.example"]` が受理され、policy に `undefined` が入る（`publicOrigins: [null, …]`）。JWT の誤送信はない。
   - なぜ T1 で拾えなかったか: T1 の格子は「値の型」で組み、ホストのオブジェクトが**読み取りの途中で投げる**クラス
     （getter / Proxy trap / revoke）を options 直下にしか置かなかった。F1 はこのクラスを入れ子の値すべてに広げる
2. **（文書 → F2）認証文書が実装と食い違う／狭く言い切る。**
   - R5 の文言が届く先を「画面・Rhai・テーマ・WASM」とし汎用文言は HTTP アダプターと転送だけとするが、Rhai の宣言 GET
     （`src/http-effects.js:65`）・RPC・ホストの直接呼び出し・`app.json` にも全文が届く（`docs/authentication.md:125`、
     `skills/uivolve-web-engine-dev/references/host.md:20`）
   - publicOrigins の 401 を一律「`HTTP 401: …`のエラー」と書くが、HTTP アダプター・RPC では形が違う
   - publicOrigins の設定エラーの列挙に `httpUrl` 由来の 2 文言が無い。「既定はbaseUrlのオリジン」が publicOrigins にも
     読める。「`getToken`は許可されたHTTP要求ごとに呼び」が publicOrigins と紛らわしい
   - HTTP の publicOrigins から取った画面・Rhai は経路上で改ざんされうり、その画面も allowedOrigins へ JWT 付きで
     要求できる（トークンは漏れないが権限は使われる）ことの注意が無い

### 残留リスク（差し戻さない）

- `sha256Hex` は `Uint8Array` 前提で、ArrayBuffer / DataView を渡すと誤った値を返す。呼び出し元はすべて Uint8Array（`application-loader.js` の 5 か所）なので現状到達しない
- `sha256Hex` の 512 MiB 以上（ビット長の上位語が非 0）は未実行（取得は 1〜2 MB 上限で到達しない。コードは 2 語書き）。純 JS 経路は同期で、MB 級の入力ではメインスレッドを止める
- `mode: "none"` の `allowedOrigins` は不正値でも黙って受理される（決めた事項 3。turn 8 で実測）
- 「WebMCP は安全なコンテキストが必要」は実装（`src/ui-tools.js`）が `isSecureContext` を見ず、ブラウザが API を出さないことに依る
- `scripts/test-insecure-browser.mjs` は実行中 `0.0.0.0` で listen し、ビルド済み runtime・`public/screens`・`public/mock`・検証ページを LAN に公開する（検証用・秘密なし。パストラバーサルは `serve-minimal.mjs` の realpath 検査で防がれている）
