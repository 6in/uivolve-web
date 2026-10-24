# 作業依頼: ui-bridge からの要望 その 2（安全でないコンテキスト・JWT の送信先）

起票: 2026-10-24（ohya と ui-bridge-component のセッションで作成）/ 状態: 実装済み（Release 待ち）
依頼元: `~/workspaces/dev/fre-components/ui-bridge-component/`（M3 の UAT。`.gsd-lite/VERIFICATION.md` の「UAT」節、発見 3・5）
対象の版: runtime `runtime-v0.1.1`（commit `ad660ac`）で発生。main（`2dd305f`）の `src/` でも同じ実装であることを確かめた

進め方: このリポジトリの gsd-lite で、新しいマイルストーンとして `/gsd-lite-discuss` から始める。
本書は「何に困っていて、何があれば解決するか」を書く。**名前・宣言の形・文言は uivolve-web 側で決めてよい**。
前回の依頼（[ui-bridge.md](ui-bridge.md) の R1〜R3）とは独立。番号は続きの R4〜R6 にする。

## 背景

ui-bridge の M3 で、`ui/` のサンプル（ホストのログイン + bootstrap の画面 1 本）を runtime-v0.1.1 で作り、
ブラウザで Worker モックと実 API（ui-bridge の Python 実装）の両方を通す UAT を行った。
ui はサーバ（`http://10.14.134.62:6080`）、API は別 origin（`:6081`）で配信し、ブラウザは別マシンの Chrome 152 で開いた。

## R4. 安全でないコンテキストでも画面を読み込めるようにする（必須）

**いま**: 画面の読み込みのたびに `crypto.randomUUID()` を呼ぶ（`src/runtime.js:392` の `this.screenToken = crypto.randomUUID();`）。
`crypto.randomUUID` はブラウザが安全なコンテキスト（HTTPS か `localhost` / `127.0.0.1`）でしか提供しないので、
`http://10.14.134.62:6080` のような HTTP の IP・ホスト名で開くと、ログイン直後の画面の読み込みで次の例外になり、画面が出ない。

```text
crypto.randomUUID is not a function
```

- Worker モックだけで動かす場合（サーバ API なし・JWT なし）でも起きる。社内の検証サーバ・LAN 内のデモ機を HTTP で開く使い方がすべて止まる。
- `screenToken` は WebMCP の画面ツール（`src/ui-tools.js`）が「今の画面か」を照合する値で、秘密の値ではないと読んだ。
- 同じリポジトリの `src/random.js:4`（R2 の `uuid_v4()` の乱数）は、安全でないコンテキストでも使える `crypto.getRandomValues` を使っている。
- 文書（`docs/runtime-distribution.md`・`docs/operations.md` など）に「安全なコンテキストが必須」という記載は見つからなかった
  （`docs/operations.md:64` は WebMCP について secure context に触れているだけ）。

**欲しいもの**（どちらか。他の形でもよい）:

- `screenToken` を `crypto.getRandomValues` から作る（UUID v4 の形が要るなら `src/random.js` と同じ作り方で組み立てる）。
  安全でないコンテキストでも、WebMCP 以外の機能は今までどおり動く。
- 安全なコンテキストを必須にするなら、それを `docs/runtime-distribution.md` に書き、`createRuntime` の時点で
  「安全なコンテキスト（HTTPS か localhost）で開いてください」と分かる例外にする（`is not a function` で落ちない）。

ui-bridge の希望は前者（HTTP の検証サーバで Worker モックの画面を見せられるため）。

## R5. JWT の送信先で拒否したとき、どの URL・origin かを例外に出す（要望）

**いま**: JWT モードの `ResourceClient` は、許可リスト（`allowedOrigins`）に無い origin への取得を送信前に拒否する
（`src/resource-client.js:131-132`。仕様どおり）。ただし例外の文言は次だけで、**拒否した URL が出ない**。

```text
このURLはJWTの送信先として許可されていません
```

**困ったこと**: ui-bridge のホスト（`ui/config.js`）は `allowedOrigins` に API の origin だけを入れていた。
ログインして `setAuthentication` した後、同じ `ResourceClient` で画面の定義 `screens/bootstrap.yaml` をページの origin から読もうとして拒否された。
画面には上の文言だけが出て、拒否されたのが API ではなく画面ファイルの取得だと分かるまで、ソースを読む必要があった。

**欲しいもの**:

- 例外の文言（か `cause` などの項目）に、拒否した origin（できれば URL）と、許可リストを出す。
  例: `このURLはJWTの送信先として許可されていません: https://ui.example.com（許可: https://api.example.com）`。
  トークンは出さない。
- `docs/authentication.md` に、「JWT モードでは画面・Rhai・テーマの取得も許可リストで検査されるので、`setAuthentication` を
  直接呼ぶホストは**ページ（画面の配信元）の origin も入れる**」ことを、API を別 origin に置く例と一緒に書く。
  今の §「デモで切り替える」の「既定の入力値はこのページのオリジン」はデモ UI の説明で、
  `setAuthentication({ allowedOrigins })` を呼ぶホストからは読み取りにくかった。

## R6. 画面の取得に JWT を付けない選択肢（検討してほしい）

**いま**: JWT モードでは、`ResourceClient` を通る取得（画面の定義・Rhai・テーマと、HTTP アダプターの API 呼び出し）は
すべて許可リストに入っている必要があり、入っていればすべてに Bearer が付く。
そのため ui-bridge は、**画面を配る静的配信サーバ（nginx）にも JWT を送る**構成になった（R5 の回避としてページの origin を許可リストに入れたため）。

**困ること**（強くはない）: 画面ファイルが公開の静的ファイルで認証が要らない構成では、JWT を受け取る必要の無いサーバへ送ることになる。
静的配信のアクセスログやプロキシに Authorization が残る運用もありうる。

**欲しいもの**（採るかどうかも含めて uivolve-web 側で判断してよい）:

- 「JWT を付けずに取得してよい origin」を宣言できる形（例: `setAuthentication({ ..., publicOrigins: [...] })`）。
  そこへの取得は Authorization を付けず、`credentials: "omit"` のまま行う。
- あるいは、画面・Rhai・テーマの取得と API 呼び出しで別の `ResourceClient` を渡せる形。
- 今の fail-closed（許可リストに無ければ送らずに止める）を既定のまま変えたくない、という判断ならそれでよい。その場合は R5 の文書化で足りる。

## 範囲外（求めないこと）

- JWT を HTTP（localhost 以外）で送れるようにすること。`docs/authentication.md:98` の「JWT は HTTPS で送る。
  ローカル開発の `localhost / 127.0.0.1 / [::1]` の HTTP だけ例外」は妥当な仕様で、ui-bridge は他のマシンから実 API で開く手順に HTTPS を書く。
- 許可リストに無い origin へ、黙って JWT なしで送るように既定を変えること（R6 は明示の宣言がある場合だけ）。

## 終わりの条件（案）

- R4: HTTP の IP で開いた Worker モックの画面が読み込める（か、安全なコンテキストを要求する分かりやすい例外になる）ことをテストで確かめる。
  文書（`docs/runtime-distribution.md`）を直す。
- R5: 例外に origin が出ることをテストで確かめる（トークンが出ないことも）。`docs/authentication.md` を直す。
- R6: 採る場合は宣言の形・テスト・文書。採らない場合は理由を本書に書く。
- runtime の新しい版を Release する。ui-bridge はその版を `vendor/uivolve-web-runtime/` に取り込み、
  `ui/config.js` の許可リストの扱いを見直す。完了したら本書の「状態」を更新し、版を書く。

## 対応（uivolve-web 側）

- R4（採用: 前者）: HTTP（安全でないコンテキスト）で開いても画面を読み込める。`screenToken` は `crypto.getRandomValues` から作る UUID v4。
  部品を含む画面で使う子のハッシュ（SHA-256）は、`crypto.subtle` が無ければ純 JS の SHA-256 で計算する。
  WebMCP・配信キャッシュ（network-first）・OPFS は安全なコンテキストが必要なまま。実ブラウザでの確認は `bun run test:insecure:browser`
  （マシンの IP の HTTP で Worker モックの画面と部品を含む画面を開く）。
- R5（採用）: 拒否の文言に拒否した origin と許可リストを出す。パス・query・トークンは出さない。
  例: `このURLはJWTの送信先として許可されていません: https://x.example.com（許可: https://api.example.com、JWTなし: https://ui.example.com）`。
  `docs/authentication.md` の「ホストAPI」節に、API を別 origin に置く例と、ページの origin を許可リストに入れることを書いた。
- R6（採用: `setAuthentication` の宣言）: `publicOrigins` に JWT を付けずに取得する origin を書ける。
  `allowedOrigins` と両方にある origin は `allowedOrigins` が優先（JWT を付ける）。HTTP の origin も書ける。
  `mode: "none"` との組合せは設定エラー。既定は fail-closed のまま（どちらにも無い origin は送信前に拒否）。
- Release・版の追記は MR マージ後に人が行う。
