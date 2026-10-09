# OPFSファイル・配信キャッシュ・Unary RPC

2026-10-03実装。DOM・Canvasから同じWASMエンジンのRhai APIを使う。ブラウザの非同期I/Oはホストが実行し、完了handlerへ結果を返す。[検討・実装計画](opfs-cache-rpc-investigation.md)の基本機能を対象とする。

## OPFSをファイルシステムとして使う

既存の`storage`はJSONレコードの保存用として維持する。`files`は名前付きファイル領域を宣言し、テキスト・バイナリ・ディレクトリを扱う。OPFSはorigin内の専用領域で、OSの任意ファイルを開く機能ではない。HTTPSまたはlocalhostと、対応ブラウザが必要。未対応、容量不足、サイトデータ削除は通常の失敗として扱う。

```yaml
files:
  workspace:
    backend: opfs
    access: readwrite
    handler: fileDone
```

`access`は`read`または`readwrite`。宣言は最大8件。領域名と画面idは1〜80文字の英数字・`_`・`-`。保存先は`uivolve-web/fs/<pageId>/<volume>/`。子Instanceでは`pageId`が保存領域scopeになり、規則は[部品化の契約](components.md)にある。既存のJSON保存先とエンジンの配信キャッシュは別領域。名前を変えると別の保存先になる。同じoriginのJavaScriptに対するセキュリティ境界ではない。

| Rhai関数                                | 成功時の`response.data`                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `file_read_text(volume, path)`          | UTF-8文字列                                                                                           |
| `file_write_text(volume, path, text)`   | unit                                                                                                  |
| `file_read_bytes(volume, path)`         | 不変の`FileBytes`                                                                                     |
| `file_write_bytes(volume, path, bytes)` | unit。`FileBytes`またはRhai標準Blobを渡す                                                             |
| `file_mkdir(volume, path)`              | unit。親ディレクトリも作成                                                                            |
| `file_list(volume, path)`               | `[{ name, kind }]`。kindはfile/directory、名前順                                                      |
| `file_stat(volume, path)`               | `{ exists, kind, size, lastModified }`。未存在は`{ exists: false }`、ディレクトリにサイズ・日時はない |
| `file_remove(volume, path)`             | unit。ファイルまたは空ディレクトリを削除                                                              |

各関数は依頼を発行するだけで、内容を同期で返さない。完了は宣言した`handler(state, response) → state`で受け取る。`response`は`ok / data / error / volume / path / operation`を持つ。effectは`kind: "file"`で、子Instanceが出したものには`instance`が付き、ホストは`file_result`へ同じ`instance`を添えて返す（省略はroot宛。[部品化の契約](components.md)を参照）。

```rhai
fn prepareDrafts(state, event) {
    file_mkdir("workspace", "drafts");
    state
}
fn saveDraft(state, event) {
    file_write_text("workspace", "drafts/page.yaml", state.source);
    state.notice = "保存しています…";
    state
}
fn fileDone(state, response) {
    if response.ok {
        state.notice = response.operation + ": " + response.path;
        if response.operation == "read_text" { state.source = response.data; }
    } else {
        state.notice = "失敗: " + response.error;
    }
    state
}
```

書き込み前に`mkdir`の完了を待つ。ファイル書き込みはユーザー指定パスの親を自動作成しない。書き込み成功はwriterの`close()`後に通知する。確定後の書き込みを画面切替で取り消せるとは限らない。

パスは領域内の相対パス。絶対パス、空の区間、`.`・`..`、バックスラッシュ、NULを拒否する。最大1,024 UTF-8 bytes、16区間、各区間255 bytes。日本語名を使える。URLデコードとUnicode正規化を行わない。空文字列は`list/stat`のルート指定だけに使える。再帰削除と一覧の継続取得は未対応。

通常のRhai files APIのテキストは100,000 UTF-8 bytes、バイナリは1,000,000 bytes、一覧は256件が上限。同じ領域に1件、全体で8件まで進行できる。同じイベントで同じ領域へ複数依頼すると、状態と依頼を確定する前に拒否する。Web Locksがある環境では別タブとも領域単位で排他制御する。未対応環境の排他は同じホスト実行環境内だけ。通常filesの期限は15秒。期限切れでもネイティブ操作が続く場合は、その操作が終了するまでロックを保つ。

GET受信・POST/PUT本文・multipart送信は[OPFSファイル転送](opfs-file-transfer.md)の専用actionを使う。本体はWASMを経由せず、ホスト容量は既定100 MiB、転送期限は既定120秒。同じ領域の通常filesと転送はロックを共有し、処理・cleanup完了まで競合をBUSYにする。通常filesの上限は維持する。

### バイナリをRhaiから扱う

`FileBytes`は大きな数値配列をJSONへ変換せずに渡す不変の値。1値1 MB、同時に生存する値の合計8 MB。共有コピーは同じ内容を参照する。`.len()`と整数indexによる読み取りを使える。

```rhai
let bytes = file_bytes(20000, 255); // 20,000 bytesを255で埋める
file_write_bytes("workspace", "drafts/data.bin", bytes);

// 完了handlerでread_bytesの結果を別ファイルへ保存できる。
// 元の読み取りは既に完了しているため同じ領域へ次の依頼を出せる。
if response.operation == "read_bytes" {
    let bytes = response.data;
    state.notice = "" + bytes.len() + " bytes / " + bytes[0];
    file_write_bytes("workspace", "drafts/copy.bin", bytes);
}
```

`file_bytes(text)`は文字列のUTF-8、`file_bytes(blob)`は標準Blobから生成する。標準Blobは既存のRhai配列サイズ上限10,000要素が残る。小さな可変データは`blob(size, fill)`を編集して書き込める。`FileBytes`はJSONのstateに入れず、handlerのローカル値として扱う。Rust拡張には公開型`wasm_ui_engine::FileBytes`の`new/as_slice`を使える。

実行例：[file-lab.yaml](../public/screens/file-lab.yaml)、[Rhai](../public/screens/file-lab.rhai)。デモの「フォルダー作成」→「テキスト保存」→「テキスト読込」で確認する。再読み込み後も同じ画面idから読める。

## YAML/JSONとRhaiの配信キャッシュ

ローダーの既定値は`network-only`。ツールバーの「通信優先＋保存版」を選ぶと`network-first`になり、公開配信のソース一式をOPFSへ保存する。この選択はブラウザ再読み込みでは保持しない。JWT設定中は有効化できない。

1. `<画面URLのpathname>.manifest.json`を取得する。URLのqueryは保持する。
2. 指定された画面・Rhai・RPC Descriptorを取得し、サイズ・SHA-256・revision・DSLを検証する。
3. `components`の宣言から辿った子を、マニフェストの`components`と突き合わせる。マニフェストに無い子も宣言に無い子も、どちらも拒否する。子のファイルもサイズ・SHA-256を検証し、DSLのパース・descriptorの一致・script URLというrootと同じゲートを通す。
4. WASMでコンパイル・init・UI/state検証に成功してから、rootと子のソース一式を保存する。
5. rootと子の全ファイルの書き込み完了後に現在版のポインターを公開する。直前版も保持する。
6. 通信障害だけに限って保存版を復元する。rootと子の全ファイルを読み直してハッシュ等を再検証し、現在のエンジンで再コンパイルする。メモリに共有している子は復元では使わない。

HTTP 401/403/404/500、パース・ハッシュ・コンパイル・init失敗で過去版へ戻さない。fetch上でCORS失敗とネットワーク障害を区別できない場合は、画面へ復元理由を表示する。どの保存版も使えなかったときは`通信に失敗し、利用できる保存版もありません（{最後に試した版の失敗文言}）`で、ポインタが1つも無いときは括弧なしの`通信に失敗し、利用できる保存版もありません`。キャンセルは復元の理由にしない。

配信側のマニフェストと不変ファイルは以下で生成する。

```bash
bun run publish:packages public/screens/file-lab.yaml
# 別の出力ディレクトリへ生成する場合
bun run publish:packages path/to/page.yaml path/to/output
```

生成物は`<filename>.manifest.json`と`packages/<revision>/{source,script,descriptor-N}`。子パッケージは同じディレクトリへ`component-<i>-source` / `component-<i>-script` / `component-<i>-descriptor-<n>`として出す。`i`は子キーをソートした添字、`n`はその子のdescriptorキーをソートした添字。ローダーはマニフェストの`url`を見るだけなので、この命名はマニフェストと配信物の間でだけ一致させる。元の画面とRhai、相対参照のアセットと一緒に配信する。別の出力先を指定した場合、元のファイルのコピーは呼び出し側の責務。RPCのDescriptorは先に生成する。通常の`bun run build:wasm`でも同梱デモのDescriptorとマニフェストを生成する。

マニフェストは`{ version: 2, revision, source, script, descriptors, components }`。各ファイルは`{ url, sha256, size }`。`descriptors`のキーはDSLに書いたdescriptor URLで、rootと子で同じ規則。`components`は`{ "<子キー>": { source, script, descriptors } }`で、子キーはrootの画面ファイルからの相対パス（posix形）。ローダーは子キーを`httpUrl(key, base)`で絶対化し、絶対化後に重複する子キー（`a.json`と`./a.json`）は拒否する。子の無い画面も`components: {}`を必ず持つ。子は最大8件、子ごとのdescriptorも8件。サイズ上限はrootと同じで、画面1 MB、Rhai100 KB、Descriptor各1 MB・8件。revisionは`SHA-256(JSON.stringify([source.sha256, script.sha256, ソート済みの[descriptorキー, sha256]の配列, ソート済みの[子キー, 子のsource.sha256, 子のscript.sha256, 子のソート済み[descriptorキー, sha256]]の配列]))`。ソートはキーのUTF-16 code unit順で、`components`の宣言順はrevisionに漏れない。`version: 1`も引き続き受ける。version 1は`components`キーを持ってはならず、revisionは末尾の子の配列が無い3要素のまま。生成スクリプトを基準にする。ハッシュは整合性確認で、配信者の署名ではない。

キャッシュは`uivolve-web/cache/<SHA-256(元の画面URL)>/versions/<revision>/`に置く。rootが`source` / `script` / `descriptor-<n>`、子が`components/<i>/{source,script,descriptor-<n>}`。`<i>`・`<n>`は配信物と同じソート順の添字。保存も復元もマニフェストのキーで回すので、同じパッケージを2か所に宣言しても1スロットしか使わない。元のURLを相対リソース解決の基準とし、エディターにも元のYAML/Rhaiを表示する。現在版が壊れていれば直前版を検証する。正常な保存後にそれ以前の版を削除する。更新中断・容量不足の場合、既存の保存版と表示中のUIを維持する。保存失敗は画面に表示する。破損した管理情報は「保存版を削除」で消してから再取得できる。

木の検証に失敗したときの文言は`マニフェストのコンポーネント情報が不正です`。子エントリの形・子の件数・子のファイル情報・絶対化後の重複が外れたときに出る。`components`自体が無い・`null`・配列・object以外のときは`配信マニフェストが不正です`。どちら側に無いかが分かる場合は括弧付きの派生になり、宣言から辿った子がマニフェストに無ければ`マニフェストのコンポーネント情報が不正です（マニフェストに無い子: {URL}）`、マニフェストにあるのに宣言から辿れなければ`マニフェストのコンポーネント情報が不正です（宣言に無い子: {URL}）`。合計の超過は`配信ファイルの合計が2 MBを超えています（合計 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）`で、ローダーと生成スクリプトが同じ文言を使う（生成側は`{URL}`の位置が子キー）。ファイルの不一致はrootが`配信ファイルのサイズ・ハッシュが一致しません`、子はどのパッケージのファイルが壊れていたかを足した`配信ファイルのサイズ・ハッシュが一致しません（{URL}）`。

この2 MBの合計はrootと全子の`source.size + script.size`の生バイトの和で、**descriptorは含めない**。descriptorは`load`のリクエストではなくbuffer ABIを通り、1 MB・8件・16 MBの上限を別に持つ。マニフェスト段階は生バイトの粗い前段で、`load`時（JSON化後）のバイト数が正。「最大の子」も同じ`source.size + script.size`の和で選び、同点はキー順。

セッション内で子パッケージをメモリに共有する条件と無効化の契機は、[画面合成（コンポーネント）](components.md)の「子パッケージのメモリ共有」節にある。

削除ボタンは現在の画面URLのキャッシュだけを削除し、ページのファイルとJSON保存を消さない。複数画面URLの合計容量制御やLRUは未実装。サイトデータ削除やブラウザの容量管理で失われ得る。

キャッシュ対象は画面・Rhai・Descriptorのソース。JS/CSS/WASM本体、テーマ、画像等は含めない。Service Workerによる完全なオフライン起動、JWT配信の保存、cache-first、署名検証、Worker同期ファイルI/Oは今回はスキップした。

## ProtobufでUnary RPCを呼ぶ

ネットワーク上の内容はProtobufバイナリ。WASM内の`prost-reflect`がダウンロードしたFileDescriptorSetを使って動的にencode/decodeする。ページごとのスキーマの追加でエンジン再ビルドは不要。通信とプロトコルのフレーム処理はホストのfetchで行う。

```yaml
rpc:
  echo:
    url: https://api.example.test/uivolve.demo.EchoService/Echo
    descriptor: rpc-demo.pb
    service: uivolve.demo.EchoService
    method: Echo
    protocol: connect
    handler: echoDone
    idempotent: true
```

`protocol`は`connect`またはバイナリ`grpc-web`。`idempotent`の既定値はfalse。最大8宣言・8進行中依頼、同じ名前に1件。URLとDescriptor URLは元の画面URLに対する相対指定を許可する。effectは`kind: "rpc"`で、子Instanceが出したものには`instance`が付き（相対URLはその子のパッケージURL基準で解決する）、ホストは`rpc_result`へ同じ`instance`を添えて返す（省略はroot宛。[部品化の契約](components.md)を参照）。Descriptorのservice/methodを読み込み時に確認し、Streamingのメソッドは拒否する。

```rhai
fn send(state, event) {
    rpc_call("echo", #{
        name: state.name,
        sequenceId: "9007199254740993",
        payload: "AH+A/w=="
    });
    state
}
fn echoDone(state, response) {
    if response.ok {
        state.message = response.data.name;
        state.details = response.data.sequenceId + " / " + response.data.payload;
    } else {
        state.message = response.error;
    }
    state
}
```

Rhaiの引数と完了mapは[ProtoJSON](https://protobuf.dev/programming-guides/json/)表現に従う。64bit整数は十進文字列、bytesはBase64、enumは名前を使う。optional/oneof/default/未知フィールドの扱いは`prost-reflect`のProtoJSON規則に従う。ワイヤー通信にJSON/Base64を使うという意味ではない。入力型をencode前に、応答をdecode時に確認し、stateへ反映した結果は既存のstateSchema検証も通る。Rhai自体は動的型のまま。

`.proto`から全importを含むDescriptor Setを配信する。

```bash
protoc --include_imports --descriptor_set_out=rpc-demo.pb rpc-demo.proto
```

同梱デモは小さなスキーマをビルド時に生成する。[proto](../public/screens/rpc-demo.proto)、[画面](../public/screens/rpc-lab.yaml)、[Rhai](../public/screens/rpc-lab.rhai)を参照。別ターミナルで起動する。

```bash
bun run demo:rpc
```

公式Connect Node adapterによるデモサーバーが`127.0.0.1:4180`で起動し、両プロトコルを扱う。`UIVOLVE_RPC_PORT`でサーバーのポートを変更できるが、画面のURLも合わせて変更する。`/pages/rpc-lab`のボタンで送信する。名前`error`はエラー応答、`slow`は2秒待機する応答。

既存のネイティブgRPCサーバーにはgRPC-Web対応のサーバー／変換プロキシが必要。ブラウザからネイティブgRPCへ直接接続する機能ではない。今回は公式Connect adapterとの相互運用を確認し、Envoy経由の接続は未検証。

### 通信・失敗・認証

- fetchは共通ResourceClientを使う。CORSとJWTの許可originを継承する。JWT時はcredentials omit・redirect error・no-store、認証なしはcredentials same-origin・redirect follow・no-cacheを使う。
- 期限は15秒。画面切替で中止し、古い世代の完了をUIへ反映しない。サーバー側の処理取消や重複排除を保証しない。
- HTTPステータスとContent-Typeに加えて、Connectのエラー／gRPC status・trailerを確認する。HTTP 200でも非zero gRPC statusは失敗。
- POSTの401後のrefresh・再送は`idempotent: true`に限る。期限前の共有トークン更新は既存通り。宣言する側がサーバー処理の冪等性を保証する。自動のidempotency keyは付けない。
- サーバーのOPTIONSでPOST、Authorization、Content-Type、Connect-Protocol-Version、Connect-Timeout-Ms、X-Grpc-Web、grpc-timeoutを必要に応じ許可する。gRPC-Webのヘッダーstatusを読む場合はgrpc-status/grpc-messageもExposeする。デモサーバーに実例がある。
- request/responseのProtobufは各1 MB。フレーム込みのHTTP body取得は1,010,000 bytesまで。decode後のJSON/state・Rhai文字列等の既存上限も適用する。

RPCのこの契約はUnary専用。圧縮、grpc-web-text、Streaming、ネイティブgRPC直接接続は未対応。汎用HTTP POSTは別の[HTTPアダプター契約](http-adapter.md)で提供する。Connect/gRPC-WebホストはUnary専用の小さな実装で、公式サーバーで動作を検証する。

## バイナリABIと検証

制御は既存のJSON ABI、ファイル内容・Protobuf・DescriptorはバッファABIを使う。追加exportsは`buffer_store(ptr,len) / buffer_ptr(id) / buffer_len(id) / buffer_free(id)`。バッファは1件1 MB、合計16 MB・32件。storeの0は容量等の失敗。idを再利用せず、解放後の参照を拒否する。ホストはWASMメモリを読み取り後ただちにコピーする。メモリ拡張後は新しい`memory.buffer`を参照する。

依頼の送信バッファはWASMが所有し、完了・画面置換時に解放する。ホストの応答・Descriptorアップロードは取り込み後／失敗時に解放する。ゼロコピーを保証しない。HTTP・JSON保存・ファイル・RPCの依頼準備がすべて成功してからstateとeffectsを確定する。

`tests/files-cache-rpc.test.js`は実WASMと公式RPCサーバーを使い、ファイルの容量・パス・close・キャンセル、バッファ寿命、キャッシュの整合・HTTP拒否・世代保持、RPCの型・エラー・Streaming拒否・画面切替・JWT再送を検証する。木の保存・復元は`components-loader.test.js`が持つ。インアプリブラウザでもOPFS保存／再読込、通信断時復元、403時の復元拒否、DOM/Canvasの両RPCボタンを確認した。

`bun run measure:rpc`で小さなEchoを測定できる。今回のrequestはProtoJSON表現70 bytes、Protobuf23 bytes。HTTP bodyはConnect送信23／応答29 bytes、gRPC-Web送信28／応答55 bytes。WASMは4,101,026 bytes。localhost・50回の例でdispatch約0.11〜0.17 ms、ABI読み取りコピー約0.002〜0.003 ms、通信約1.2〜1.7 ms、完了decode/state検証約0.10〜0.12 ms。HTTPヘッダーを含まず、JSON通信との性能比較でもない。サイズ削減は確認できるが、実アプリの高速化は別途測定する。
