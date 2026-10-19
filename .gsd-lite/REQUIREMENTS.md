# REQUIREMENTS — ui-bridge からの要望: 失敗応答の本文・冪等キー・4xx の outcome（http-error-body）

状態: discuss 中（2026-10-19）。依頼書は `docs/requests/ui-bridge.md`（commit `f5cf097` 基準、本書の起点は main `9c1ddf0`）。

## 背景（事実。discuss で調査済み）

### 失敗の経路（依頼書 R1 / R3）

- `http.request`: 2xx 以外は `response.body?.cancel()` して `hostError("HTTP_<status>", "HTTP <status>: リクエストに失敗しました", "unknown")`（`src/adapters/http.js:357-364`）。メソッド・ステータスによる違いは無い。成功時は `readLimitedBytes(limit: 900_000)` → fatal UTF-8 → text / `JSON.parse`（`:376-378`）。Content-Type は見ない。成功本文の解析失敗は `INVALID_RESPONSE`（GET/HEAD は `failed`、更新は `committed`）。完了 JSON 全体 1 MB 超は `LIMIT`。
- `http.upload` / `http.multipart`: 2xx 以外は cancel して `HTTP_<status>` / `unknown`（`http.js:283-290`）。成功時の読み方は request と同じ。
- `http.download`（`src/adapters/http-download.js`）: 2xx 以外は `HTTP_<status>` / **`failed`**（`:54-59`）。reader は取得済みで finally で `reader.cancel()`（`:21-28, :119-121`）。
- `failure()`（`src/host-effects.js:7-20`）の形は `{ok:false, data:null, error:{code(80字), message(512字), retryable:false 固定, outcome}}`。
- Rust `validate_result`（`engine/src/host.rs:186-223`）: 結果全体 1 MB 以下、error の code/message/outcome は空でない 2048 バイト以下、outcome は 4 値、retryable は bool、data は null。**error の余分なキーは拒否しない**。
- Rhai には `rhai::serde::to_dynamic(response)` が `handler(state, response)` で届く（`engine/src/lib.rs:1465-1479`）。`response.error.code/.message/.retryable/.outcome`。
- outcome は `not-started` / `failed` / `committed` / `unknown`。409 / 408 / 429 の個別扱いは無い。
- 旧来の `requests` / `http_get` 経路（`engine/src/http.rs`、`src/http-effects.js`）は error が文字列で、本マイルストーンの対象外。

### 宣言

- `operations.<name>: {connection, action, handler, options}`。Rust の `host::Operation` は `deny_unknown_fields`、options の中身は 100 KB 以下と `progressHandler` だけを検査（`engine/src/host.rs:6-14, 70-100`）。
- JS `http.validate`（`src/adapters/http.js:122-200`）が connection（`adapter, baseUrl, allowedHeaders`）と options（基本 `method, path, response, headers, responseHeaders`、転送は `timeout`、download は `overwrite, progressHandler`）の未知キーを `checkKeys` で拒否（「HTTP設定・引数に未知の属性があります」）。
- 接続は `createRuntime({connections})` と `app.json` の `connections`（`src/application.js:37-53`）。

### Worker モック

- `adapter:"worker-mock"` + `definition`。アダプターは definition を外して `http.validate` に委ね、内部の httpAdapter の `resources.fetch` を差し替えて `new Response(JSON.stringify(body), {status, headers})` を返す（`src/adapters/worker-mock.js:12-53`）。**失敗時も http.js と同じ経路を通る**ので、http.js を直せばモックにも効く。対応 action は `http.request` だけ。
- 固定応答 `response:{status, body}`（`src/mock-api-model.js:77-88`）。headers は常に `content-type: application/json`。CRUD の 404/405/409/413/400 は `{message}` を返す。
- 文書 `docs/worker-mock-api.md:69`「失敗本文は公開しない」。

### 冪等キー（依頼書 R2）

- Rhai に乱数・UUID 関数は無い。WASM の実行時依存に getrandom は無い（Cargo.lock の getrandom はビルド時の proc-macro 経路だけ）。`scripts/build.mjs:32-34` が **WASM の import を禁止**している。
- 前例: ホストの時計を ABI 要求の `clock` に添え、Rust の `ExtensionContext` が実行単位で保持して `datetime_now()` が読む（`src/engine.js:4-26`、`engine/src/abi.rs:49-53, 94-143`、`engine/src/extensions/mod.rs:10-47`、`extensions/date.rs:225-245`）。
- ネイティブ関数の登録窓口は `engine/src/extensions/mod.rs:49-59`。
- `docs/files-cache-rpc.md:180`「自動のidempotency keyは付けない」は RPC 節の記述。`docs/host-adapters-design.md:188` の将来案は「サーバーが保証する idempotency key 等を宣言した場合だけ自動再送を許可」。

### その他

- WebMCP の `snapshot()` は screen/revision/state/scene/busy/dialog だけで、host の結果は出ない（`src/runtime.js:466-482`）。
- Release: タグ `runtime-v<semver>` / `skills-v<semver>`（現在 0.1.0）、公開先は GitHub `6in/uivolve-web`。origin は GitLab で gh は未導入。
- 既存テスト: `tests/host-adapters.test.js:181-225`、`tests/opfs-file-transfer.test.js:1058-1075`（非 2xx の cancel）、`tests/worker-mock.test.js`、`tests/documented-http.test.js`、実ブラウザ DOM/Canvas は `tests/browser/opfs-file-transfer.mjs`（`bun run test:transfer:browser`、fixture `scripts/transfer-server.mjs`）。

### 前回の残留リスク（`.gsd-lite/archive/component-loader/VERIFICATION.md:70-81`）

- 1: `network-only` の宣言単位の取得に件数上限が無い。
- 3: `screen.id` が非文字列、`rpc` の値が `null` で TypeError（日本語の契約文言にならない）。
- 5: 保存版の `current.json` が `null` だと `save` が毎回 TypeError。
- 10: `manifest()` の重複判定と 2 MB 文言の「最大の子」が sidecar 基準のまま（表示だけの差）。

## 用語集

| 用語 | 意味 |
| ---- | ---- |

## スコープ内（WHAT）

### R1. 2xx 以外の応答の本文を完了 handler へ渡す（依頼書 R1・必須）

- **opt-in は操作の `options`** に書く（名前・値の正確な綴りは plan が決める。依頼書の例は `errorBody: json`。値は将来の拡張に備えて文字列の列挙にする）。`http.js` の options 許可キーに足し、未知の値は既存の `checkKeys` 系と同じく宣言時に拒否する。
- 対象 action: `http.request` / `http.upload` / `http.multipart` / `http.download`。Worker モック（`http.request`）も同じ経路で効く。
- 結果の形: 失敗の `error` に
  - **`status`**（数値の HTTP ステータス）: HTTP 応答を受け取って 2xx 以外で失敗したときは **opt-in に関係なく常に**足す（追加キーなので既存画面は壊れない）。通信例外・開始前の拒否など応答が無い失敗には付けない。
  - **`body`**: opt-in した操作で、本文を受け付けられたときだけ足す（JSON を解析した値）。受け付けられないとき（上限超え・Content-Type 不一致・解析失敗）は `body` を付けない従来の失敗にする（理由は下記の `bodyError`）。`code` / `message` / `outcome` / `retryable` の決め方は R1 では変えない（outcome は R3 だけが変える）。
- 上限: 失敗本文は **64,000 バイト**（10 進。成功時の 900,000 とは別）。超えたら読み込みを止めて本文なし。
- download: 2xx 以外のときは OPFS に書かず、上限までメモリで読んで `error.body` に載せる。
- opt-in しない操作は `error.status` が増えることを除いて今と同じ（本文は cancel する）。
- 受け付ける条件（すべて満たすときだけ `error.body` を付ける）:
  - Content-Type が `application/problem+json`、`application/json`、または `+json` 接尾辞（例 `application/vnd.foo+json`）。パラメータ（`charset` 等）は無視し、大文字小文字を区別しない。
  - 本文が 64,000 バイト以下で、fatal UTF-8 として decode でき、`JSON.parse` でき、値が **object**（配列・文字列・数値・`null` は不可）。
- 載せられなかった理由を **`error.bodyError`** で知らせる（opt-in した操作で HTTP 応答があり、本文を載せなかったときだけ付ける）。値は列挙の文字列で、少なくとも「上限超え」「Content-Type 不一致」「解析失敗（UTF-8 / JSON / object でない）」「本文が空」を区別する（綴りは plan が決める）。`body` と `bodyError` は同時に付かない。

### R2. Rhai で冪等キーを作る（依頼書 R2）

- Rhai のネイティブ関数 **`uuid_v4()`**（RFC 9562 の version 4 / variant 10xx、小文字ハイフン区切り 36 文字）と **`random_int(min, max)`** を足す。
- 乱数はホストが供給する: 時計（`clock`）と同じ前例で、ホストが実行ごとに `crypto.getRandomValues` の乱数を ABI 要求に添え、Rust の `ExtensionContext` が実行単位で保持して関数が消費する。WASM に import を足さない（`scripts/build.mjs` の検査を維持）。
- 乱数の供給元は `clockProvider` と同様に差し替え可能にし、テストで値を固定できるようにする。
- 上限: ホストは各実行の要求に **1,024 バイト**の乱数を添える（UUID 64 個分）。1 回の実行で使い切ったら Rhai の例外（日本語の契約文言）。乱数が添えられていない実行（供給元なし）でも、時計と同様に例外にする。`random_int` は偏りの無い方法（棄却法など）で `min..=max` を返し、`min > max` は例外。
- 画面はキーを state に持ち、再送では同じ値を使う（ホストは自動でキーを付けない・自動再送しない。既存の決定を維持）。
- 文書 `docs/native-extensions.md` か専用の関数文書（`docs/date-functions.md` と並ぶ形）に契約を書く。

### R3. 4xx の outcome を接続の宣言で選べるようにする（依頼書 R3）

- **接続（connection）** に「4xx（408・429 を除く）を `outcome: "failed"` とみなす」選択を足す（キー名は plan が決める）。既定は今のまま（`unknown`）。
- `http` と `worker-mock` の接続の両方で使える（worker-mock は `http.validate` に委ねる）。
- 画面 DSL ではなくホスト側の接続設定（`createRuntime({connections})` / `app.json` の `connections`）に書く。

### R4. 前回（component-loader）の残留リスク 1 / 3 / 5 / 10 の解消

- 5: 保存版の `current.json` が `null`・形の不正なときは「保存版なし」と同じに扱い、新しい版で上書き保存する（自己回復）。plan は最初のテストタスクに置く。
- 3: `screen.id` の非文字列・`rpc` の値 `null` を `parsePackage` 等で型検査し、日本語の契約文言で拒否する（TypeError を出さない）。plan は最初のテストタスクに置く。
- 1: `network-only` の宣言単位の取得を **1 パッケージ 8 件**までに制限し、超えたら日本語の契約文言で拒否する。
- 10: `manifest()` の重複判定と 2 MB 文言の「最大の子」を画面 URL 基準に統一する。

### R5. 堅牢性（受け入れ基準）

- 失敗応答の本文がどんな形・大きさ・Content-Type・文字コードでも、ホストもエンジンも例外を出さず、本文なしの従来の失敗か本文付きの失敗のどちらかを完了 handler へ 1 回だけ返す。画面の state と入力を失わない。
- 乱数関数も同様: 乱数の不足・供給なし・不正な引数は Rhai の例外（日本語の契約文言）になり、ホストの例外や WASM の trap にならない。
- 接続の新しい設定・options の新しいキーの不正な値は宣言時に日本語の契約文言で拒否する。
- plan は最初のタスクにこの検査（境界値の格子）を含め、verify は該当の指摘を差し戻し対象にする。

### R6. デモ

- 既存の「受注管理・Worker API」画面（`docs/worker-mock-api.md`）に、登録の入力検証で 422 + problem+json（`errors[]` に項目ごとの理由）を返す固定応答またはルートと、opt-in した操作で項目の横にサーバの文言を出す例を足す。
- 同じ画面で `uuid_v4()` の冪等キーを state に持ち、結果が `unknown` のとき同じキーで送り直す例を足す（Worker モック側で同じキーの二重処理をしないことまでは求めない。画面の書き方の例として示す）。
- 画面数（24）とサンプル一覧のカテゴリは変えない。

### R7. 文書・スキルの追従

- `docs/http-adapter.md`（失敗の形・opt-in・`status` / `body` / `bodyError`・上限表・R3 の接続設定）、`docs/opfs-file-transfer.md`（upload / multipart / download の失敗）、`docs/worker-mock-api.md`（「失敗本文は公開しない」の撤回と固定応答の例）。
- 乱数関数の契約（R2）。`docs/native-extensions.md` の関数一覧、AI 向けの参照入口 `docs/ai-development.md`。
- スキル `skills/uivolve-web-app-dev/references/http.md`（と乱数関数を載せる参照）。
- `docs/host-adapters-design.md:186-188` の当初案・将来案の記述が新しい契約と矛盾しないようにする。
- 依頼書 `docs/requests/ui-bridge.md` の「状態」を「実装済み（Release 待ち）」にし、対応の要約（決めた名前・上限・R3 の接続設定）を書く。版の追記は人が Release 後に行う。

## 受け入れ基準（verify が見る）

1. opt-in した `http.request` / `http.upload` / `http.multipart` / `http.download` で、422 + `application/problem+json` の object 本文が handler の `response.error.body` に届き、`response.error.status` が 422。`code` / `message` / `outcome` は従来どおり（R3 を有効にした接続では outcome が `failed`）。
2. Worker モックの固定応答 `response: { status: 422, body: {...} }` で、1 と同じ値が届く（モックと実 HTTP で同じ画面が同じに動く）。
3. 上限超え（64,001 バイト）・Content-Type 不一致・UTF-8 不正・JSON 不正・object でない・空本文のそれぞれで `body` が無く、`bodyError` が区別された値になる。64,000 バイトちょうどは受け付ける。
4. opt-in しない操作は、`error.status` の追加を除いて既存の結果と同じ（既存テストが無変更で通る。本文は cancel される）。
5. `uuid_v4()` が RFC 9562 v4 の形式を返し、固定した乱数供給で決定的な値になる。1 実行で 65 個目は例外。乱数供給なしでも例外。`random_int` は範囲内・偏り無し（棄却法）・`min > max` で例外。WASM の import は 0 のまま。
6. R3 の設定をした接続で、400 / 401 / 403 / 404 / 409 / 422 は `failed`、408 / 429 / 5xx は `unknown`。設定しない接続は全部 `unknown`（download は従来どおり `failed`）。
7. 残留リスク 1 / 3 / 5 / 10 がそれぞれテストで閉じている（3 と 5 は最初のテストタスク）。
8. DOM / Canvas: 実 WASM の Vitest で両 surface に 1 の画面を載せて同じ結果になる。`bun run test:transfer:browser` に 422 + problem+json のケースが 1 本あり、dom / canvas の両方で通る。
9. R5 の堅牢性の格子がすべて通る。
10. `bun run check` / `bun run test` / `bun run docs:check` / `bun run build` が green。R7 の文書がすべて新しい契約に追従している。

## スコープ外

- POST などの自動再送（依頼書の範囲外）
- 401 のときのトークン更新の流れの変更（依頼書の範囲外）
- エラーの本文を WebMCP の画面スナップショットへ出すこと（出さない。handler が state に書いた内容だけが見える）
- 旧来の `requests` / `http_get` 経路（error が文字列）への本文の追加
- `rpc_call`（Unary RPC）の失敗本文
- text など JSON 以外の失敗本文（opt-in の値を文字列の列挙にして将来に残す）
- ホストが冪等キーを自動で付ける宣言、UUID v7、汎用の乱数（UUID v4 と `random_int` 以外）
- Worker モック側の冪等キーによる二重処理の防止
- GitHub Release の作成とタグ付け、依頼書への版の追記（MR マージ後に人が行う）

## 用語集

| 用語              | 意味                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| 失敗本文          | 2xx 以外の HTTP 応答の本文                                                          |
| opt-in            | 操作の `options` で失敗本文を受け取ると宣言すること                                 |
| `error.status`    | 2xx 以外の HTTP 応答で失敗したときの数値ステータス（常に付く）                      |
| `error.body`      | 受け付けた失敗本文（JSON object）                                                   |
| `error.bodyError` | opt-in したのに失敗本文を載せなかった理由                                           |
| 乱数供給          | ホストが実行ごとに ABI 要求へ添える 1,024 バイトの乱数（時計 `clock` と同じ仕組み） |
| 冪等キー          | 画面が `uuid_v4()` で作り state に持つ、再送で同じ値を使うキー                      |

## 検証の道具（既存）

- `bun run test`（実 WASM の Vitest + Rust のテスト）、`bun run check`、`bun run docs:check`、`bun run build`。
- `bun run test:transfer:browser`（Playwright、dom / canvas ループ、fixture `scripts/transfer-server.mjs`）。
- `tests/host-adapters.test.js`、`tests/opfs-file-transfer.test.js`、`tests/worker-mock.test.js`、`tests/documented-http.test.js`。
