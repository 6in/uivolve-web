# BLOCKED — turn 13 / T10

## 状況と理由

T10のみを実装したが、検証失敗から2回立て直した後も実WASMでCSV加工サンプルが失敗。
gsd-lite-implの「このターン内で最大2回まで立て直し」の上限に到達したため終了する。
PLAN.mdのT10チェックは未完了のまま。実装差分はstashせず、コミットせず保持した。

失敗コマンド: `bunx vp test run tests/transfer-server.test.js tests/opfs-file-transfer.test.js`

結果: 78件中77件成功、1件失敗。
`examples/opfs-file-transfer/home.rhai` の `fileDone` で
`file_write_text("workspace", "processed.csv", r.data.replace("apple,2", "apple,4"))` が
`Function not found: file_write_text (..., ())` となる。
Rhaiのreplaceは文字列を変更しunitを返すため、戻り値を保存用文字列として使えない。

## 試みたこと

1. 初回試験: 6件中3件失敗。Bunがストリーム応答のContent-Lengthを外す、空ファイルのnameを落とす、OPFS helper名が不正。
   既知長はBlob応答、未知長/遅延はstreamへ分け、空ファイルのfilenameはMIMEヘッダーから補い、memoryOpfsへ修正。
2. 再試験: 6件中1件失敗。ResourceClientのfetchはURL/optionsを渡すためRequestを期待するfixtureへの直接指定が不適合。
   fetch wrapperでRequestへ変換。対象を整形して転送72件と合わせて再実行したが、上記Rhai型不一致が残った。

成功: `bun run build:wasm`、`bun run check`、サーバーのGET/POST/PUT本文/multipart/hash/順序/同名/Unicode/空ファイル/100 MiB/遅延/非2xx/認証/不正応答、ホストchunk生成試験、既存転送72件。
全JS/Rust/docs/buildの計画検査は未完走。既存テスト期待値の変更なし。

## 再開の判断・選択肢

質問: 次のターンでT10の未コミット差分を引き継ぎ、CSV加工handlerを修正して全計画検査を完走するか。

- 推奨: ローカル変数へr.dataを取り、変数のreplaceを実行した後、その文字列をfile_write_textへ渡す。実WASM試験と全計画検証が成功したらT10だけ完了としてコミットする。
- 代案: T10の今回差分を破棄し別の構成で再実装する（このターンでは破棄していない）。

未コミット対象: package.json、scripts/transfer-server.mjs、tests/transfer-server.test.js、examples/opfs-file-transfer/。
T11/T12には着手していない。既存CRUDサーバーは変更していない。
