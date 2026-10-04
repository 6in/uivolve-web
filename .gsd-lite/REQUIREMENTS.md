# OPFSファイル転送 要件

状態: 要件確定（2026-10-04）。実装方式の調査はresearchで行う。
元資料: docs/opfs-file-transfer-plan.md

## 確定したスコープ

- GETでサーバーからOPFSへダウンロードする。
- OPFSファイルをPUT/POSTのリクエスト本文としてアップロードする。
- OPFSファイルと文字列項目をmultipartでアップロードする。初回から対応する。
- DOM/Canvasのサンプルとテスト用サーバー、自動テスト、実装契約の文書を用意する。
- 既存のoperations / host_call、ホスト接続・認証設定、files領域宣言を再利用する。
- ファイル本体はWASMやJSON stateを経由させない。

## 必須の受け入れ基準

- 不正入力、容量超過、通信・保存失敗、中止、画面切替を扱う。
- 失敗・中止時は既存ファイルを保持し、途中データを適切に処理する。
- 操作終了に合わせてロックを解放し、処理継続中は安全に排他を維持する。

## スコープ外

- 本番バックエンド製品、DBの選定・実装。

## 用語

- OPFS領域: 既存files宣言の名前付きファイル領域。
- 本文アップロード: OPFSファイルをHTTPリクエスト本文として送信する方式。
- multipartアップロード: ファイルと文字列項目をmultipart/form-dataで送信する方式。

## ラウンド2: multipart・容量・進捗

- multipartはPOST/PUT、複数ファイル、同名項目の複数値に対応。項目配列の順序を保持し、文字列値はstringのみ。
- ファイル容量は既定100 MiB、ホスト設定で変更可能。multipartはファイル合計を制限する。
- ダウンロードはストリームでOPFSへ保存する。アップロードはFile/FormDataを使用し、JSで全量を読み込まない。ブラウザ内部のバッファリングは保証対象外。
- 明示的中止とダウンロード受信バイト進捗に対応する。アップロードは処理中/完了を表示し、送信バイト進捗は対象外。
- 既存fetchと認証経路を再利用する。

## ラウンド3: 保存・期限・結果

- ダウンロードは既定で上書き拒否。操作宣言で上書きを許可できる。親ディレクトリは事前mkdirが必要。
- writer.close()による確定前の失敗・中止では旧ファイルを保持する。確定後の取消は保証しない。
- 転送の既定期限は120秒、操作別に変更可能。
- 通常files操作と関係領域単位の排他を共有する。複数領域は固定順で取得し、競合は待たずBUSY。
- アップロード応答は既存HTTP同様json/text/empty。status・許可ヘッダー・本文を返す。
- 自動再送なし。送信後の結果不明はunknown、成功応答後の解析失敗はcommitted。

## ラウンド4: API契約

- 接続adapterはhttpを継続使用。actionはhttp.download / http.upload / http.multipart。
- download/uploadのargs.fileは{volume,path}。
- multipartのargs.partsは順序付き配列。ファイル項目は{name,file:{volume,path},filename?,contentType?}、文字列項目は{name,value:"文字列"}。
- URL用args.path/queryは既存HTTPの規則を継承。未知の引数、型不正、未宣言領域は拒否。
- host_cancel(name)を追加。同名操作の進行中依頼をすべて中止する。既存host_callの戻り値は変更しない。
- options.progressHandlerでダウンロード進捗を通知。同一領域の重複転送はBUSY。
- parts最大32、ファイル最大8。args合計は既存100,000 UTF-8 bytes。
- 操作別期限は1〜300秒、既定120秒。
- 成功dataはstatus/headers/body/filesを持ち、filesは[{volume,path,size}]。ダウンロードのbodyはnull。
- 進捗はoperation/transferred/total（不明はnull）、最大毎秒10回。

## 最終合意: 既存契約・ライフサイクル・検証

- downloadはreadwrite領域、upload/multipartはread/readwrite領域。既存OPFSの領域名・相対パス検証を継承。
- JWT/CORS・接続URL内への限定・許可ヘッダー規則を継承。トークンを画面stateへ渡さない。転送は認証更新を含む自動再送をしない。
- 送信ファイル名の既定はパス末尾。Content-Typeの既定はapplication/octet-stream。multipart boundaryはブラウザ生成とし手動指定を拒否。
- 画面置換・disposeで中止を試み、古い世代の完了と進捗を破棄する。
- 進捗handler失敗はonErrorへ報告し、転送は継続する。進捗は完了結果を消費せず、完了後に通知しない。
- DOM/Canvasサンプルはダウンロード→小さなCSV加工・別名保存→複数ファイルmultipart送信を示す。
- 100 MiB級ファイルはホストで直接生成して転送を検証。Rhaiの既存テキスト/バイナリ読み書き上限は変えない。
- テスト用サーバーでGET、POST/PUT本文、POST/PUT multipartと内容一致・順序・同名項目を確認する。
- 既存ファイル保持、上書き拒否/許可、容量超過（Content-Lengthあり/なし）、タイムアウト/明示中止/画面切替、排他、非2xx、認証と応答解析失敗を検証する。
- ブラウザでDOM/Canvasの一連の操作を確認し、既存テストとビルドの退行を防ぐ。
- researchはsimilar_oss / official_docs / local_projectsを調査する。
