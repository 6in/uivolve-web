# HTTPを選び、ホストへ接続する

現行契約は[HTTPアダプター](../../../docs/http-adapter.md)。この契約には、コピー可能な起動JavaScript・画面YAML・Rhaiの一式と、path/query/bodyの引数、応答型、失敗時の扱いがある。

- 固定URLのJSON GETだけなら[既存チュートリアル](../../../docs/tutorial-http-grid.md)のrequests/http_getを使う。
- POST/PUT/PATCH/DELETE/HEAD、パス変数、query、JSON本文ならoperations/host_callを使う。method/path/responseはoptions内、実行時の値はargs.path/query/bodyへ置く。
- HTTPアダプターはUiRuntime/createRuntime/createApplicationで自動登録される。接続名とbaseUrlを用意し、重複登録しない。HostEffects単独では明示登録が必要。画面へfetchやJWTを持ち込まない。
- サーバーなしのCRUDは[WorkerモックAPI](../../../docs/worker-mock-api.md)を使う。workerMockAdapterを起動JavaScriptへ登録し、独立したモックDSLにseedとroutesを宣言する。画面のoperations/host_callへ応答設定を混ぜない。query・遅延・永続化は未対応。
- http_getのdataはJSON本体、host_callのdata.bodyはHTTP本文。errorも従来は文字列、新APIはcode/message/outcome等のオブジェクト。handlerを機械的に流用しない。
- 不正な動的引数や通信失敗は完了handlerで扱う。Rhaiのtry/catchだけに依存しない。loadingは両分岐で解除し、更新結果がcommitted/unknownなら自動再送しない。
- [アダプター設計書](../../../docs/host-adapters-design.md)のWebSocket・デバイス・DB例は将来案。現在のHTTP契約と混ぜてコード生成しない。
