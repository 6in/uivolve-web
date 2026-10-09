# OPFSファイルAPI・アプリキャッシュ・バイナリRPCの検討

2026-10-03。実装と公式資料を照合した検討・実装計画。同日に基本機能を実装した。以下の案と着手前の比較は設計経緯として残す。現在のAPI・上限・実行例は[ファイル・キャッシュ・RPCの契約](files-cache-rpc.md)、既存のJSON保存は[ブラウザ機能の契約](platform-features.md)を参照する。

## 判断

| 対象                                     | 判断                      | 推奨する進め方                                                                                                         |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| OPFSのファイル操作                       | 追加可能                  | テキストの読み書きとディレクトリ操作を先に追加し、JSON保存と共存させる                                                 |
| YAML・Rhaiのキャッシュ                   | 追加可能                  | ページ起動前に働く共通ローダーへ実装し、同じ版の定義とスクリプト（のちに子パッケージも同じ版に含む）をまとめて保持する |
| ネイティブgRPCへのブラウザからの直接接続 | 現構成では採用しない      | WASMでもブラウザの通信APIの制約を受ける。gRPC-Webを使用する                                                            |
| Protobufによるバイナリ通信               | Unaryを実装・実機確認済み | 既存gRPCサーバーにはgRPC-Web、新規サーバーにはConnectも比較する。最初はUnary RPC                                       |

「ネイティブなデータ」は、型を持つデータをProtobufのバイナリ形式で送る意味なら実現できる。Rust構造体のメモリをそのまま送る方式とは区別する。Protobufはフィールド番号と型を定義した通信形式で、サーバーとブラウザの実装言語を揃える必要はない。[Protobufのエンコーディング](https://protobuf.dev/programming-guides/encoding/)

## 着手前の実装との差

- `src/storage-client.js`は既にOPFSのファイルを操作するが、保存先を`uivolve-web/<pageId>/<key>.json`に固定し、内容をJSONとして扱う。1,000,000 UTF-8 bytesが上限。
- `engine/src/storage.rs`のRhai APIは`storage_read/write/remove`。依頼をeffectとして発行し、ホストの非同期処理後にhandlerへ結果を戻す。同期的にファイルを返す関数ではない。
- `src/main.js`のローダーは画面定義とRhaiをHTTPから取得してからWASMへ渡す。アプリソースの明示的なキャッシュはない。`components`が宣言する子パッケージも、現在は同じ版としてまとめて扱う対象になっている。
- `src/resource-client.js`はGETによる取得とJWT・CORS・リフレッシュを担当する。POST bodyやバイナリRPCは扱っていない。
- WASMの公開ABIはUTF-8 JSON。バイナリ専用の受け渡しはなく、Protobufコーデックも組み込んでいない。

DOMとCanvasは同じエンジンとホストを使うため、保存と通信を各レンダラーへ別々に実装する必要はない。

## OPFSの拡張案

OPFSにはディレクトリとファイルがあり、テキストに加えてバイナリも保存できる。OSの任意のファイルを開く機能ではなく、ブラウザのoriginごとの専用領域。容量制限があり、サイトデータの削除などで失われるため、キャッシュには適しているが唯一の保管先としての永続性は保証しない。[MDN: OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

### ページから使うAPI

既存の`storage`宣言を維持し、別の`files`宣言で名前付きの領域を指定する。以下は着手時のAPI案。同じ名前の基本APIを実装し、現在の契約は別文書に確定した。

```yaml
files:
  workspace:
    backend: opfs
    access: readwrite
    handler: fileDone
```

```rhai
// API案。実際の書き込みはホストで非同期実行する。
fn saveSource(state, event) {
    file_write_text("workspace", "drafts/page.yaml", state.source);
    state.notice = "保存しています…";
    state
}

fn fileDone(state, response) {
    if response.ok {
        state.notice = "保存しました。";
    } else {
        state.notice = response.error;
    }
    state
}
```

| API案                                  | 用途・初期方針                                           |
| -------------------------------------- | -------------------------------------------------------- |
| `file_read_text(volume, path)`         | UTF-8テキストを取得。JSONへ変換せず文字列で返す          |
| `file_write_text(volume, path, text)`  | ファイル全体を置き換える。親ディレクトリは事前に作成する |
| `file_mkdir(volume, path)`             | ディレクトリを作成。親を含む作成を許可する               |
| `file_list(volume, path)`              | 名前と種別を列挙。件数上限・継続方法を定義する           |
| `file_stat(volume, path)`              | 存在、種別、ファイルサイズ・更新日時を取得する           |
| `file_remove(volume, path)`            | ファイルまたは空ディレクトリを削除。再帰削除は初期対象外 |
| `file_read_bytes` / `file_write_bytes` | 後続段階。バッファを扱うABIとRhaiの表現を先に決める      |

ページ領域は`uivolve-web/fs/<pageId>/<volume>/`、ローダー用キャッシュは`uivolve-web/cache/`へ分ける案。ページのファイルAPIからキャッシュの内部ファイルを直接変更できないようにする。同じoriginのJavaScriptに対する隔離を意味するものではない。

パスは領域内の相対パスに限定する。絶対パス、空の区間、`.`・`..`、バックスラッシュ、NULを拒否する。URLとして解釈・デコードしない。パス長、区間数、ファイルサイズ、列挙件数、同時依頼数の上限を決める。日本語名は扱えるようにし、Unicodeの正規化方針も契約化する。

依頼時のstate・画面の検証、保存確定後の完了通知、画面切替時の古い応答の破棄は既存のeffect方式を引き継ぐ。未存在、容量不足、未対応、キャンセルなどを区別して返す。書き込みの成功は`close()`後に通知する。同じファイルの競合はホスト内で制御し、複数タブ間の制御は別途設計する。

主スレッドでは非同期のブラウザAPIを使えばよい。Workerへ移すことは初期対応の必須条件ではない。`createSyncAccessHandle()`による同期アクセスはOPFS上のDedicated Worker用なので、今の主スレッド上のWASMへそのまま同期ファイルAPIを渡せるわけではない。[MDN: 同期アクセスハンドル](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)

### バイナリの受け渡し

大きなファイルをJSONの数値配列やBase64として往復させると、サイズとコピーが増える。制御メッセージはJSONのまま、内容は別のバッファとして渡す方式を候補にする。

Rustのバッファとホストの`Uint8Array`を結ぶABI、所有者、解放、上限、WASMメモリ拡張時の扱いを決める。Rhai側はBlobなどの専用値を候補にし、stateへ巨大なバイナリを保存しない。ハンドルを使う場合は画面世代との紐付けと失効を設計する。ゼロコピーや高速化を保証せず、測定で判断する。

YAML・Rhaiをホストが直接OPFSへキャッシュするだけなら、このABI拡張を待つ必要はない。

## アプリケーションキャッシュ案

ページのRhaiが起動する前に定義とスクリプトが必要なので、キャッシュはローダーの機能にする。子パッケージを宣言する画面では、その子の定義・スクリプト・descriptorも同じ版の一部として同時に必要になる。ページ自身のファイル操作は、下書きやアプリデータの保存に使う。

初期設定は従来と同じ`network-only`。キャッシュを有効にした場合は`network-first`とし、通信障害時に検証済みの保存版へ戻す案。HTTP 401/403などの認証拒否、他のHTTPエラー、壊れた定義、コンパイル・init失敗を「オフライン」として扱って過去版へ戻さない。CORS失敗はfetch上で通信失敗と区別できない場合があるので、フォールバック理由を表示する。`cache-first`はバージョン管理を整えた後に検討する。

1. 配信側で、revisionと各ファイルのURL・SHA-256を持つマニフェストを作る。YAML/JSONとRhaiを同じ版として指定する。
2. ローダーでマニフェストと全ファイル（子パッケージのファイルも同じ版に含む）を取得し、サイズ・ハッシュ・DSL・Rhaiを検証する。版ごとに不変URLを使う。
3. 画面の読み込みに成功したソースを、版ごとのディレクトリへ保存する。最後に完全な版を指す管理情報を更新する。失敗した保存のために表示中の画面を戻さない。
4. 読み戻し時にも全ファイルとハッシュを確認し、現在のエンジンで再度コンパイル・検証する。Rhaiのコンパイル結果やWASM内のメモリはキャッシュしない。
5. 不完全な版は使用せず、直前の完全な版を保持する。容量不足、タブ間の競合、更新途中の中断、削除・期限切れの回復を設計する。

OPFSには複数ファイルをまとめるDBトランザクションがないため、「定義だけ新版、Rhaiは旧版」という組合せを避ける管理が必要。ハッシュは整合性確認用で、配信者の署名・信頼を証明するものではない。マニフェストを導入しない段階では、取得した2ファイルが同じ配信版である保証はできない。

保存キーには元のパッケージURLと版を使い、元のURL・形式・スクリプトURLも保持する。相対URLはOPFS内の保存先ではなく、元のHTTP URLを基準に解決する。エディターには元のYAML・Rhaiを表示する。

JWT付き取得は現在`no-store`であり、明示的なOPFS保存はその方針を変える。初期キャッシュは公開配信を対象にする。認証付きキャッシュは別途、利用者の区別・ログアウト時の削除・オフライン利用の許可を決めてから追加する。

YAMLとRhaiの保存だけでは、完全なオフライン起動にはならない。JS/CSS/WASM、テーマ、画像などは別のリソース。ブラウザ再起動後もネットワークなしで起動させる場合は、Service Workerなどでアプリ本体を配信する設計を追加する。

この案は当時root 1パッケージを前提にしていたが、段階5で子を含む木へ拡張した。マニフェストはversion 2になり、子の配信物と保存先・2 MBの合計・メモリ共有の規則は[ファイル・キャッシュ・RPCの契約](files-cache-rpc.md)の配信キャッシュ節にある。

## gRPCとProtobufの選択肢

WASMはブラウザのHTTP/2フレーム制御を追加しない。通信をブラウザのfetchへ委譲する現構成では、ネイティブgRPCをそのまま使う方式を採用しない。gRPC-Webはこの差を吸収する別の通信プロトコルで、ステータスなどをブラウザから読める形式にする。[gRPC-Webプロトコル](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md)

| 方式            | 型付きバイナリ     | サーバー側の条件                                    | この試作での位置付け                         |
| --------------- | ------------------ | --------------------------------------------------- | -------------------------------------------- |
| ネイティブgRPC  | Protobuf           | ブラウザからの直接接続を前提にできない              | Web版では見送り。将来のネイティブ版は別検討  |
| gRPC-Web        | Protobufを選択可能 | gRPC-Web対応サーバー、またはEnvoyなどの変換プロキシ | 既存gRPCサービスを使う第一候補               |
| Connect         | ProtobufまたはJSON | Connect対応エンドポイント                           | 新規サーバーの場合の比較候補                 |
| HTTP + Protobuf | Protobuf           | 独自のHTTP APIと型・エラーの合意                    | 最小のバイナリ通信検証。gRPC互換とは呼ばない |

ConnectのWebクライアントはConnectとgRPC-Webの両方を扱え、Connectでもバイナリ形式を選べる。対応するサーバーならgRPC-Web用の独立した変換プロキシを省ける。[Connect: プロトコル選択](https://connectrpc.com/docs/web/choosing-a-protocol/)

最初はUnary RPC、つまり1リクエストに1レスポンスで検証する。公式`grpc-web`クライアントはバイナリモードでUnary、テキストモードでServer Streamingをサポートし、Client/Bidirectional Streamingは未対応。このバイナリServer Streamingの制限を、全クライアント共通の制限とは扱わない。ストリーミングはライブラリとブラウザを選定してから別途検証する。[grpc-web README](https://github.com/grpc/grpc-web#streaming-support)

### エンジンをページごとに再ビルドしない案

`.proto`ごとに生成Rustコードをエンジンへ追加するだけでは、任意のページをダウンロードするモデルに合わない。共通のProtobufコーデックをエンジンへ入れ、ページが参照するDescriptor SetをHTTPで取得する案を優先して検証する。

配信時に`.proto`から`FileDescriptorSet`を生成し、サービス名・メソッド名・request/response型をページ側で指定する。ブラウザ内に`protoc`を持ち込む必要はない。Rustの`prost-reflect`にはDescriptor PoolとDynamic Messageがあり、候補になる。ただし、このプロジェクトのwasm32構成でのビルド、サイズ、動的型処理の性能は未検証。[prost-reflect公式API](https://docs.rs/prost-reflect/latest/prost_reflect/)

`stateSchema`はUIデータの検証用で、Protobufのフィールド番号、wire type、oneofなどを定義しない。別の通信スキーマとして扱い、レスポンスをstateへ反映する段階で共通state検証も行う。

Protobufの64bit整数は、JavaScript Numberへ変換すると精度を失う範囲がある。JSON ABIに載せる部分は十進文字列などで保持する。bytes、enum、optional/oneof、未知フィールドの扱いも明示する。通信がバイナリでもRhaiの変数が静的型になるわけではない。[Protobuf: JSONでの型表現](https://protobuf.dev/programming-guides/json/)

### 実装する場合の責務

- WASM：宣言とメソッドの検証、requestの型確認、Protobufのencode/decode、完了handlerとstate検証。
- ホスト：POST bodyの送信、レスポンスのバイナリ取得、CORS・JWT・中止・期限の適用。RPCフレームとエラー処理は採用するtransportへ置く。
- サーバー：選択したプロトコルへの対応、型定義、CORS設定。既存gRPCなら変換プロキシの配備も検討する。

HTTP 200だけで成功とせず、gRPC status/trailerまたはConnectのエラー形式を確認する。現在のGET用ResourceClientをそのままPOSTへ流用しない。JWTの付与先制限は共有し、リフレッシュ後の再送はメソッドの冪等性・重複実行防止の条件を定める。

まず既存transportを使うホスト実装で相互運用を確かめ、その後Rust側の動的コーデックを比較する。コーデックをRustへ置いてもネットワーク処理はホストに残る。通信サイズ、encode/decode時間、ABIのコピー時間、WASMサイズを測り、速度の利点を判断する。

## 実装順と確認条件

調査後、以下の4段階の基本実装を完了した。確認結果と見送った範囲は末尾に記載する。

| 段階                | 成果物                                                                 | 主な確認条件                                                                                                           |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. ファイルAPI      | 名前付き領域、テキスト読み書き、mkdir/list/stat/remove、サンプル・契約 | 日本語YAML/Rhaiの往復、JSON保存との共存、不正パス、容量不足、未対応、中断、画面切替、DOM/Canvas共通動作                |
| 2. アプリキャッシュ | 配信用マニフェスト、ローダー、更新/削除/復元、保存版の表示             | 同じ版の2ファイル、破損・更新中断・競合からの回復、通信障害時の復元、認証拒否時の非復元、相対URL、現エンジンでの再検証 |
| 3. バイナリ基盤     | バッファABI、Rhaiの表現、bytes読み書き、サイズ上限                     | バイナリの一致、解放・失効、メモリ拡張、上限、画面切替後の破棄                                                         |
| 4. Unary RPCの試作  | gRPC-Web/Connectの比較サンプル、動的DescriptorのWASMビルド検証         | 型付き送受信、2^53を超える整数、bytes、RPCエラー、CORS、期限、中止、JWT再送条件、サイズ・時間の比較                    |

優先するのは1と2。アプリキャッシュの実現にRPCやバイナリABIの完成を待つ必要はない。4で動的コーデックの負担が大きければ、固定スキーマによる相互運用だけを先に検証し、その制限を明記する。

当面見送るのは、ネイティブgRPC直接接続、ブラウザ内の`.proto`コンパイラー、同期ファイルAPIのためだけのWorker移行、任意OSファイルへのアクセス、Client/Bidirectional Streaming、アプリ全体のオフライン配信。OPFSのファイル操作とバイナリUnary通信自体を諦める必要はない。

## 実装結果と今回スキップした範囲

2026-10-03に名前付きファイルAPI、公開ソースのnetwork-firstキャッシュ、バッファABIとFileBytes、動的DescriptorによるUnary RPCを実装。サンプル`file-lab`と`rpc-lab`、配信マニフェスト生成、公式Connect Node adapterのデモサーバー、計測スクリプトを追加した。現在の使い方・上限は[契約](files-cache-rpc.md)を基準にする。

- Rhai標準Blobの10,000要素制限を緩和せず、大きいバイナリには不変のFileBytesを追加した。JSON stateへ保存しない。読み書きは1 MB、テキストは100 KBに制限した。
- キャッシュはYAML/JSON・Rhai・Descriptorの同じ版を保持し、ハッシュと版を検証する。現在版と直前版だけを保持し、保存成功後にそれ以前の版を削除する。マニフェスト・不変URL・ポインター公開順を用いる。
- ホストのtransportはUnaryに絞ったフレーム実装とし、公式サーバーとのConnect/gRPC-Web相互運用で確認した。独自のHTTP+ProtobufをgRPCとして扱わない。
- 実WASMの追加テスト25件で、パス・容量・close・中止・buffer寿命・キャッシュ整合・Descriptorの並び順・HTTP拒否・型・RPCエラー・Streaming拒否・画面切替・JWT再送条件を確認した。
- 全体の検証はVitest213件・Rust7件、`bun run build`、`bun run check`が成功。`bun run docs:check`で27文書のローカルリンク198件を確認し、画面作成スキルの形式検証も成功した。
- 実ブラウザで日本語保存と再読み込み後の復元、バイナリの一致、通信断時の保存版復元、HTTP403時の復元拒否、DOM/Canvasからの両RPC呼び出しを確認した。
- 小さなEchoのrequestはProtoJSON70 bytesに対しProtobuf23 bytes。フレーム込み送信はConnect23 bytes／gRPC-Web28 bytes。WASMは4,101,026 bytes。計測手順と時間の実例は契約に記載。JSON通信より速いという結論は出していない。

| スキップした項目                                  | 理由・次の条件                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| 完全なオフライン起動・テーマ/画像キャッシュ       | JS/CSS/WASMを含む配信とService Workerの契約が別途必要                            |
| JWT配信のキャッシュ                               | 利用者の分離・ログアウト・オフライン許可の設計が必要                             |
| cache-first・全体LRU                              | まず公開配信のnetwork-firstと2世代保持を確認。大量ページの運用時に容量方針を追加 |
| 巨大ファイル・Worker同期I/O・再帰削除・一覧の継続 | 今回は1 MBの非同期操作と256件の一覧で用途を検証                                  |
| ネイティブgRPCへの直接接続・ブラウザ内protoc      | ブラウザ通信制約を避けられず、配信時Descriptor生成でページ独立性を確保できる     |
| RPC Streaming・圧縮・grpc-web-text                | Unaryの型・通信・中止を先に固定。別のフレーム/流量制御が必要                     |
| Envoy経由の既存gRPC接続                           | 対象サーバーがなく、今回は公式Connect adapterの両プロトコルで検証                |
| サーバー側の重複実行防止                          | サーバー固有契約。idempotent指定だけではidempotency keyや処理取消を保証しない    |
