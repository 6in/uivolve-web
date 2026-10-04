# OPFSファイル転送

状態: 実装済み契約。`operations` / `host_call`でHTTPと名前付きOPFS領域を結び、ファイル本体をWASM・JSON stateへ渡さず転送する。通常のJSON通信は[HTTPアダプター](http-adapter.md)、小さなファイルの読み書きは[files契約](files-cache-rpc.md)を使う。

## ホストの起動設定

`UiRuntime` / `createRuntime` / `createApplication`のJavaScript起動設定へ`connections`と`transferLimit`を渡す。HTTPアダプターは自動登録される。

```js
import { createRuntime } from "./runtime/index.js";
const ui = await createRuntime({
  element: document.getElementById("app"),
  baseUrl: new URL("./", import.meta.url),
  connections: { api: { adapter: "http", baseUrl: "http://127.0.0.1:4177/api/" } },
  transferLimit: 104857600,
  onError: (error) => console.error(error.message),
});
await ui.load("transfer.yaml");
```

`transferLimit`はbytes単位の正の安全整数、既定104857600（100 MiB）。ホストだけが変更でき、画面DSL・操作optionsには指定できない。OPFSはHTTPSまたはlocalhostと対応ブラウザが必要。接続baseUrlは末尾`/`のHTTP(S)ディレクトリURLで、query/fragmentを付けない。

## YAML / Rhaiの実行例

以下を`transfer.yaml`と`transfer.rhai`へ保存する。テストサーバーの小さなCSVを受信し、本文PUT、同名項目・同じファイル2件を含むmultipart POSTを順に行う。保存先は領域ルートなのでmkdirは不要。下位ディレクトリへ保存する場合は`file_mkdir`の完了後に開始する。

```yaml
version: 1
id: documented-transfer
title: ファイル転送
script: transfer.rhai
state: { notice: "", received: 0, phase: idle }
files:
  work: { backend: opfs, access: readwrite, handler: fileDone }
operations:
  download:
    connection: api
    action: http.download
    handler: downloaded
    options: { path: csv, overwrite: true, progressHandler: received }
  upload:
    connection: api
    action: http.upload
    handler: uploaded
    options: { path: upload, method: PUT }
  multipart:
    connection: api
    action: http.multipart
    handler: completed
    options: { path: multipart, method: POST }
ui:
  xtype: container
  layout: vbox
  items:
    - { xtype: button, itemId: start, text: 開始, handler: start }
    - { xtype: button, itemId: cancel, text: 中止, handler: cancel }
    - { xtype: label, bind: notice }
```

```rhai
fn init(s) { s }
fn start(s, e) {
    s.phase = "download";
    s.notice = "受信中…";
    host_call("download", #{file: #{volume: "work", path: "source.csv"}});
    s
}
fn downloaded(s, r) {
    if !r.ok { s.phase = "failed"; s.notice = r.error.code; return s; }
    s.phase = "upload";
    s.notice = "送信中…";
    host_call("upload", #{file: #{volume: "work", path: "source.csv"}});
    s
}
fn uploaded(s, r) {
    if !r.ok { s.phase = "failed"; s.notice = r.error.code; return s; }
    s.phase = "multipart";
    host_call("multipart", #{parts: [
        #{name: "tag", value: "original"},
        #{name: "file", file: #{volume: "work", path: "source.csv"}},
        #{name: "tag", value: "copy"},
        #{name: "file", file: #{volume: "work", path: "source.csv"}, filename: "複製.csv", contentType: "text/csv"}
    ]});
    s
}
fn completed(s, r) {
    if r.ok { s.phase = "done"; s.notice = "完了"; }
    else { s.phase = "failed"; s.notice = r.error.code + ": " + r.error.message; }
    s
}
fn received(s, p) { s.received = p.transferred; s }
fn cancel(s, e) {
    host_cancel("download"); host_cancel("upload"); host_cancel("multipart");
    s
}
fn fileDone(s, r) { s }
```

## 操作・引数・成功結果

| action           | method           | args                                  | 領域の権限     |
| ---------------- | ---------------- | ------------------------------------- | -------------- |
| `http.download`  | GET（既定）だけ  | `{file:{volume,path}, path?, query?}` | readwrite      |
| `http.upload`    | POST（既定）/PUT | `{file:{volume,path}, path?, query?}` | read/readwrite |
| `http.multipart` | POST（既定）/PUT | `{parts:[…], path?, query?}`          | read/readwrite |

各操作は`connection / action / handler / options`で宣言する。optionsは`method / path / response / headers / responseHeaders / timeout`、downloadだけに`overwrite / progressHandler`を追加できる。`timeout`は秒単位で1〜300、既定120秒。一般HostEffectsの既定15秒（ホスト設定はms単位）は維持する。downloadの`overwrite`はbool、既定false。`progressHandler`は存在するRhai handler名。

multipartの項目は`{name,value:"文字列"}`または`{name,file:{volume,path},filename?,contentType?}`。順序と同名項目を保持し、valueはstringのみ、file/valueの併用を拒否する。最大32項目、ファイル8件。filenameの既定はパス末尾、Content-Typeの既定はapplication/octet-stream。multipartのトップレベルContent-Typeは大小文字を問わず手動指定不可。boundaryはブラウザが生成する。

URL用path/queryと許可ヘッダーは[HTTPの規則](http-adapter.md)を共有する。操作のmethod/pathはoptionsへ置く。argsでURL・method・headersを上書きできない。未知属性、未宣言領域、不正な型・パス・権限を転送開始前に拒否する。ファイルパスは[filesの相対パス規則](files-cache-rpc.md)に従い、親ディレクトリは自動作成しない。

成功は`{ok:true,data:{status,headers,body,files},error:null}`。filesは`[{volume,path,size}]`、sizeはbytes。download/uploadは1件、multipartはファイルpart順で重複も別件。downloadのbodyはnull（Rhaiではunit `()`）。upload/multipartのresponseはjson（既定）/text/empty、204/205/emptyはbody:null。headersはoptions.responseHeadersで指定したものだけで、CORS非公開の場合null。

## 容量・保存の確定・排他

downloadは応答chunkをreaderから読み、上限確認後にwriter.writeをawaitする。全量blob/arrayBuffer/text取得を使わない。復号後の実受信bytesを`transferLimit`で制限し、Content-Lengthの有無・誤りだけに依存しない。超過chunkを保存しない。uploadはFile本文、multipartはFormDataを使い、JSで本体を全量読み込まない。multipartのファイル容量合計には同じファイルの重複partも加算する。ブラウザ内部のバッファリングは保証対象外。

downloadはwriter.close成功が確定点。close開始前の通信・保存失敗や中止では旧内容を保持し、新規の未確定entryを後始末する。close開始後の巻き戻しは保証しない。成功close後のファイルは取消やcleanupで削除しない。reader.cancel / writer.abort / entry削除の失敗も通知する。

通常files操作と転送は同じ画面id・領域のロックを共有する。複数領域は重複除去して固定順で非待機取得し、競合はBUSY。Web Locks環境では別タブでも排他し、未対応環境では同じホスト実行環境内で排他する。期限切れ・中止でも実処理とcleanupがsettleするまでロックを保持し、転送の完了通知もその終了を待つ。

制御args全体100,000 UTF-8 bytes、操作宣言64件、1 handlerの呼び出し8件・同時pending8件は維持する。upload/multipartの応答本文900,000 bytes、完了JSON全体1,000,000 bytesも維持する。通常filesのテキスト100,000 bytes・バイナリ1,000,000 bytes、FileBytes/バッファABIやRhai/Workerの既存上限を引き上げない。大容量本体は転送専用経路で扱う。

## 中止・進捗・失敗・認証

`host_cancel(name)`は同名操作の進行中依頼をすべて中止し、未知名・完了済み名はno-op。他の名前は継続する。host_callの戻り値を中止idとして使わない。画面置換・disposeも中止を試み、古い世代の完了と進捗を破棄する。サーバー側の更新取消を保証しない。

downloadの進捗handlerは`handler(state,{operation,transferred,total}) → state`。transferredは受信・保存したbytesで単調増加、最大毎秒10回（100ms以上間隔）。totalは信頼できるContent-Lengthだけで、不明・圧縮・CORS非公開などではnull（Rhaiではunit）。進捗は完了pendingを消費せず、終了後は通知しない。handler失敗はonErrorへ報告して転送を継続する。uploadに送信byte進捗は提供しないため、送信中と完了をstateで表示する。

失敗は`{ok:false,data:null,error:{code,message,retryable:false,outcome}}`。代表codeはINVALID_ARGUMENT、ALREADY_EXISTS、BUSY、LIMIT、STORAGE、NETWORK、CLEANUP、TIMEOUT、CANCELLED、HTTP_404など、応答解析失敗はINVALID_RESPONSE。outcomeはnot-started（開始前拒否）、failed（受信・保存の未確定失敗）、unknown（送信後の結果不明）、committed（確定後・2xx送信成功後の解析失敗）。timeout/cancelだけで未更新と判断せず、outcomeを確認する。非2xx本文は返さない。

JWT、CORS、許可originは共有ResourceClientの[認証設定](authentication.md)を使う。トークンを画面stateへ渡さない。送信前provider・期限前refreshは使えるが、転送3方式は`retryAuthentication=false`で401/403・切断後を含め自動再送しない。multipartのAuthorization等にはサーバーのOPTIONS許可が必要。応答ヘッダーを読むには必要なExpose-Headersも設定する。

## サンプルと検証

```bash
bun run demo:transfer
bun run dev
```

[DOM入口](../examples/opfs-file-transfer/index.html)は`http://127.0.0.1:4173/examples/opfs-file-transfer/`、Canvasは同URLへ`?renderer=canvas`を付ける。[画面](../examples/opfs-file-transfer/home.yaml)と[Rhai](../examples/opfs-file-transfer/home.rhai)はCSV受信→小さなCSV加工→別名保存→複数file multipartを示す。100 MiB生成ボタンは[ホストコード](../examples/opfs-file-transfer/large-file.js)で直接chunkを書き込み、通常Rhai上限を拡張しない。[サーバー](../scripts/transfer-server.mjs)は4177でGET、POST/PUT本文、multipart、遅延・容量・非2xx・認証・不正応答fixtureを提供する。

```bash
bun run verify:transfer
```

この最終判定はWASM生成、全JS/Rustテスト、check、docs:check、build、localhost実ブラウザ試験を逐次実行する。実行済みサーバー・成果物を前提とせず、ブラウザ未実行も非0になる。[実ブラウザrunner](../scripts/test-transfer-browser.mjs)はDOM/Canvas、100 MiBのsize/hash、CORS/JWT、取消・容量・上書き、2タブWeb Locks競合と解放を確認し終了時に後始末する。文書のコード例は[実WASMテスト](../tests/documented-transfer.test.js)、境界・異常系は[転送テスト](../tests/opfs-file-transfer.test.js)で実行する。
