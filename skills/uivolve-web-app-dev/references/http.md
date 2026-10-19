# HTTPを選び、ホストへ接続する

現行契約は[HTTPアダプター](../../../docs/http-adapter.md)。この契約には、コピー可能な起動JavaScript・画面YAML・Rhaiの一式と、path/query/bodyの引数、応答型、失敗時の扱いがある。

- 固定URLのJSON GETだけなら[既存チュートリアル](../../../docs/tutorial-http-grid.md)のrequests/http_getを使う。
- POST/PUT/PATCH/DELETE/HEAD、パス変数、query、JSON本文ならoperations/host_callを使う。method/path/responseはoptions内、実行時の値はargs.path/query/bodyへ置く。
- HTTPアダプターはUiRuntime/createRuntime/createApplicationで自動登録される。接続名とbaseUrlを用意し、重複登録しない。HostEffects単独では明示登録が必要。画面へfetchやJWTを持ち込まない。
- サーバーなしのCRUDは[WorkerモックAPI](../../../docs/worker-mock-api.md)を使う。workerMockAdapterを起動JavaScriptへ登録し、独立したモックDSLにseedとroutesを宣言する。画面のoperations/host_callへ応答設定を混ぜない。query・遅延・永続化は未対応。
- http_getのdataはJSON本体、host_callのdata.bodyはHTTP本文。errorも従来は文字列、新APIはcode/message/outcome等のオブジェクト。handlerを機械的に流用しない。`error.status`は応答を受け取った失敗にopt-inと関係なく常に付き、`errorBody: "json"`をoperationsのoptionsに書いた操作だけ`error.body`（JSONオブジェクト）または`error.bodyError`（`empty` / `content-type` / `too-large` / `invalid` / `network`の5値）が付く。`body`と`bodyError`は同時に付かない。
- 不正な動的引数や通信失敗は完了handlerで扱う。Rhaiのtry/catchだけに依存しない。loadingは両分岐で解除し、更新結果がcommitted/unknownなら自動再送しない。`outcome`が`unknown`のときは`uuid_v4()`で作った冪等キーをstateに持ち、同じキーで送り直す（ホストは冪等キーを自動で付けないし自動再送もしない）。接続に`clientErrorOutcome: "failed"`を書くと4xx（408・429を除く）の`outcome`が`failed`になる。
- [アダプター設計書](../../../docs/host-adapters-design.md)のWebSocket・デバイス・DB例は将来案。現在のHTTP契約と混ぜてコード生成しない。
- OPFSへGET保存するならhttp.download、OPFSのFile本文をPOST/PUT送信するならhttp.upload、文字列と複数ファイルを送信するならhttp.multipart。[転送契約](../../../docs/opfs-file-transfer.md)のYAML/Rhaiと起動設定を使う。本体をJSON/stateへ入れず、一般JSON/Rhai/Worker上限は維持する。
- 転送は401後も自動再送しない。host_cancel(name)は同名の進行中操作すべてへの中止要求で、外部更新の巻き戻しではない。downloadのみprogressHandlerで受信進捗を扱い、アップロードは送信中・完了・失敗を表示する。アップロードbyte進捗を作らない。
