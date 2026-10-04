# BLOCKED — turn 15 / T11

## 状況と理由

先頭未完了T11のみ実装。`bun run test:transfer:browser`が2回の立て直し後も認証fixtureの成功ケースでHTTP_401となった。gsd-lite-implの「このターン内で最大2回まで立て直し」の上限に達したため停止する。PLANのT11は未完了。実装差分はstashせず未コミットで保持した。

## 試みたこと

1. 初回の実行中に整形を行い、Vite再読込が起きた。cleanup時のwindow.transfer消失が元の失敗を隠した。任意cleanupとサンプル起動エラーの明示へ修正して再実行。
2. 再実行でYAMLの代わりにHTML取得。curlでVite変換後boot.jsを確認し、new URL("./", import.meta.url)の末尾/消失を確認。サンプルbaseUrlをlocation.href基準へ修正し、整形を完了してから再実行。
3. DOM/Canvasと100 MiB試験成功後、認証済みupload/authの成功ケースがHTTP_401。追加の修正は行っていない。

成功: `bun run build:wasm`。実Chromium 152.0.7977.64でDOM/CanvasのCSV取得・加工・複数file multipart・受信進捗・cancel・画面置換、100 MiB GET/PUT File/POST FormDataのsize/hash照合、全量JS読込API禁止。
未完走: 境界/CORS/認証の判定、2タブWeb Locks、PLANの全JS/Rust/check/docs/build検証。既存テスト期待値変更なし。

## 再開の判断・選択肢

質問: 次ターンでT11の未コミット差分を引き継ぎ、認証fixtureとの固定テストtokenの一致を確認して全検査を完走するか。

- 推奨: scripts/transfer-server.mjsのauth fixtureが要求する値とtests/browser/opfs-file-transfer.mjsの試験tokenを照合。まずブラウザ検査を完走し、2タブ排他も実行してPLANの検証コマンドを通す。検証成功後にT11だけ完了としてコミットする。
- 代案: fixtureの固定テストtokenを共通の明示的定数にしてサーバー試験とブラウザ試験を一致させる。公開認証契約は変更しない。

未コミット対象: bun.lock、package.json、examples/opfs-file-transfer/boot.js、scripts/test-transfer-browser.mjs、tests/browser/。
試験サーバーとブラウザはrunnerのfinallyで終了。手動プローブのViteも終了済み。固有OPFS namespaceはcleanup実行済み。T12未着手。
