# 作業依頼: ui-bridge からの要望（失敗応答の本文・冪等キー）

起票: 2026-10-18（ohya と concierge-component のセッションで作成）/ 状態: 未着手
依頼元: `~/workspaces/dev/fre-components/ui-bridge-component/`（`HANDOFF.md` §2.7・§2.11）
対象の版: 本書は commit `f5cf097` の実装と文書に基づく

進め方: このリポジトリの gsd-lite で、新しいマイルストーンとして `/gsd-lite-discuss` から始める。
本書は「何に困っていて、何があれば解決するか」を書く。**名前・宣言の形・上限は uivolve-web 側で決めてよい**。
既存の契約（トークンを画面へ渡さない、自動再送を前提にしない、未知の属性を拒否する、など）を崩してまで合わせる必要はない。

## 背景

ui-bridge は、uivolve-web の画面と PostgreSQL の業務部品（iam・file-io・notify など）の間に立つ API サーバの
「言語に依存しない指針 + Python / Kotlin / Go のサンプル実装」。サンプル画面は uivolve-web（YAML + Rhai）で作る。

- ui-bridge は失敗を、正しい HTTP ステータスと RFC 9457 の problem+json で返す（業務エラーを 200 で包まない）。
- 画面は、まず Worker モックで作り、接続を `http` に切り替えて実 API につなぐ。

## R1. 2xx 以外の応答の本文を、画面の完了 handler へ渡せるようにする（必須）

**いま**: 2xx 以外の応答では本文を読まずに捨て、画面に届くのは `{code: "HTTP_422", message, retryable, outcome}` だけ。

- `src/adapters/http.js:357`（`http.request`）と `:283`（`http.upload` / `http.multipart`）で `response.body.cancel()` している
- 失敗の形は `src/host-effects.js:7` の `failure()` が作る。Rust 側は `engine/src/host.rs:203-219` で
  `code` / `message` / `outcome` / `retryable` と「`data` が null であること」を検査する
- Worker モックも「2xx 以外は失敗本文を公開しない」（`docs/worker-mock-api.md`）

**困ること**: 入力の検証エラー（項目ごとの理由）、状態遷移の違反（「承認済みなので取り消せません」）、冪等キーの不一致などを、
画面がステータスのコードからしか判断できない。項目の横にエラーを出すことも、サーバの文言を出すこともできない。

**欲しいもの**:

- 操作ごとの **opt-in** で、2xx 以外の応答の本文（JSON）を失敗の結果に載せる。
  例: `options: { errorBody: json }` → `response.error.body`（と `response.error.status`）。名前と置き場所は任意。
- 対象は `http.request`、`http.upload`、`http.multipart`。`http.download` は、本文を OPFS に保存しない形で載せられるなら対象にする。
- **Worker モックの固定応答**（`response: { status: 422, body: {...} }`）でも同じように載せる。
  モックと実 API を切り替えても画面が同じに動くため。
- 上限を設ける（例: 64 KB。成功時の 900 KB とは別の、小さい値でよい）。超えたら本文なしの従来の失敗に戻す。
- 受け付ける Content-Type は `application/problem+json` と `application/json`（解析に失敗したら本文なしにする）。
- opt-in しない操作の振る舞いは今と同じにする（互換）。

**ui-bridge が返す本文**（参考。ui-bridge 側の案）:

```json
{
  "type": "about:blank",
  "title": "入力に誤りがあります",
  "status": 422,
  "detail": "2 件の項目に誤りがあります",
  "code": "UB012",
  "request_id": "01J…",
  "errors": [
    { "field": "email", "code": "format", "message": "メールアドレスの形式ではありません" }
  ]
}
```

## R2. Rhai で冪等キーを作れるようにする（要望）

**いま**: Rhai に乱数・UUID の関数が無い（日付の関数は `datetime_now()` がある）。ホストの JS には `crypto.randomUUID()` がある。
画面は宣言時に決めた固定のヘッダしか付けられないので、ui-bridge は冪等キーを JSON 本文の `idempotencyKey` で受ける。

**困ること**: 書き込みの結果がわからない（`outcome: unknown`）ときに、画面が**同じキーで**もう一度送れば、ui-bridge は二重に処理しない。
ところが、そのキーを Rhai で作る手段が無い。

**欲しいもの**（どちらか。他の形でもよい）:

- Rhai のネイティブ関数（例: `uuid_v4()`）。画面はキーを state に持ち、再送では同じ値を使う。
- 操作の宣言で、ホストがキーを作って本文の決まった項目に入れる形。ただし `docs/files-cache-rpc.md` の
  「自動の idempotency key は付けない」という既存の決定と、`docs/host-adapters-design.md:188` の将来案
  （サーバが冪等キーを保証すると宣言した場合だけ再送を許す）との整理が要る。

## R3. 4xx の `outcome`（検討してほしい）

**いま**: 2xx 以外はどのメソッドでも `outcome: "unknown"`。

**ui-bridge の保証**: 4xx（408・429 を除く）は「処理していない」ことを ui-bridge が保証する。

- 例えば 422 は検証で弾いた、409 は状態が合わなかった、という意味で、DB には何も書いていない。
- そのため画面は `failed` として扱い、入力を直して送り直してよい。

一般のサーバではこれを保証できないので、既定は今のままでよい。接続か操作の宣言で「4xx は failed とみなす」を選べるようにするかを、uivolve-web 側で判断してほしい。

## 範囲外（求めないこと）

- POST などの自動再送
- 401 のときにトークンを更新する流れの変更
- エラーの本文を WebMCP の画面スナップショットへ出すこと（出すなら uivolve-web 側の判断で）

## 終わりの条件（案）

- 契約の文書を直す（`docs/http-adapter.md`・`docs/opfs-file-transfer.md`・`docs/worker-mock-api.md`）。
  スキル `uivolve-web-app-dev` の `references/http.md` も直す。
- テストを入れる。DOM / Canvas の両方、Worker モック、上限超え、解析の失敗、opt-in しない操作の互換を確かめる。
- runtime と skills の新しい版を Release する。ui-bridge は、その版を `ui/` に固定版として取り込む。
- 完了したら、本書の「状態」を更新し、版を書く。ui-bridge の `HANDOFF.md` §2.11 は ui-bridge 側で直す。
