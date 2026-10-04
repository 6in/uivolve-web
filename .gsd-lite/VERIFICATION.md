# VERIFICATION — opfs-file-transfer — turn 18

判定: 差し戻し（初回検証、指摘1件）。コード・セキュリティレビューと最終判定コマンドは完了。受け入れ基準のContent-Type既定値が本文アップロードに実装されていないため、マージしない。

## 確認したこと

- クリーンな作業ツリーから `main...HEAD` のマイルストーン全体を確認。REQUIREMENTS / DECISIONS / PLANと突き合わせ、読み取り専用のコードレビュー・セキュリティレビューを統合した。
- `bun run verify:transfer` 成功: WASM生成、JS613件（29ファイル）、Rust15件、check（206ファイル整形・90ファイルlint、警告0）、docs:check（445リンク・56文書）、build。
- 実Chromium152.0.7977.64: DOM/CanvasのCSV取得・加工・multipart・進捗・中止・画面置換、100 MiB GET/File/FormDataのsize/hash・全量JS読み込み禁止、CORS/認証/上書き/容量、2タブWeb Locks A+B/B+A/A+A・第2キー競合・解放が成功。
- 保存のclose確定境界、失敗時の旧ファイル保持、新規entry cleanup、実処理settleまでのロック保持、同名cancel、世代と進捗pendingをレビュー。既存テスト期待値変更はPROGRESSと照合した。
- セキュリティ: 引数allowlist・サイズ・型、宣言領域/権限/相対パス、URL範囲、許可ヘッダー、JWT origin・credentials/redirect、再送禁止、秘密情報のエラー除去を確認。新規の具体的なセキュリティ指摘なし。
- 文書追従チェックリストの数値・未対応記述を再検索。一般HTTP/Rhai/files/Workerと過去調査の制限は現行転送制限と区別されている。Content-Typeの主張は下記F1で実装へ合わせる。
- `git diff --check main...HEAD` 成功。originは未設定。

## 初回の堅牢性格子

本製品の境界はブラウザ/WASM APIであり、argv・環境変数・stdin・stdout/stderr fdは転送APIの入出力ではない。該当する面は最終runnerが実行した次の境界試験と実装レビューで一括確認した。

| 入力/出力経路                      | 確認したクラス・境界                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| YAML/Rhai/JSON args                | null・配列・型不正・未知属性・不正file/parts・未宣言/read領域・親不足・パス逸脱・UTF-8上限・32/33parts・8/9files・期限/容量設定境界              |
| HTTP/認証/応答                     | 事前認証失敗・401/403・非2xx・通信失敗・json/UTF-8/容量解析失敗・Content-Length有無/虚偽/不正・gzip復号後超過                                    |
| OPFS/read/write/close/abort/remove | Error/DOMExceptionの代表と列挙外例外・容量0/境界/超過・旧/新ファイル・cleanup失敗・reader閉鎖・書込/close/abort gate・中止/期限/画面置換との交差 |
| 完了/進捗/共有ロック               | handler失敗・不正/終了済み進捗・応答JSON上限・終端通知停止・古い世代破棄・2runtime/2tab競合・複数キー取得失敗時の解放                            |

## 指摘 F1 — 本文アップロードの既定Content-Type

- 対象: `src/adapters/http.js` のupload送信（268行付近）、`tests/opfs-file-transfer.test.js` の988〜989行付近。
- REQUIREMENTS最終合意は既定 `application/octet-stream` を要求する。実装はtypeが空のOPFS Fileと空Headersを渡し、本文アップロードにContent-Typeを設定しない。既存試験も欠落を期待している。
- 再現: `bun -e 'const file = new File(["abc"], "a.bin"); const request = new Request("http://localhost/upload", {method:"POST", body:file}); console.log(JSON.stringify({type:file.type,contentType:request.headers.get("content-type")}));'` → `{"type":"","contentType":null}`。
- 影響: 合意したmedia typeを要求するサーバーで本文転送が拒否され得る。PLAN末尾のF1で既定値・明示値・multipartをまとめて回帰確認する。

## 残留リスク

- Web Locks未対応環境は同じホスト実行環境内の排他のみ。ブラウザ内部の送信buffer量、サーバーの中止/巻き戻し、close確定後の取消は保証対象外で、文書に記載済み。
- 実ブラウザ検証は今回のChromium/Linux環境。別ブラウザの実測は今回の合否の前提に追加しない。

## 次の遷移

verify_roundを0から1へ更新し、phase=impl / next_command=/gsd-lite-implへ差し戻す。修正上限3以内。BLOCKEDではない。次のverifyは本格子の回帰とF1修正差分を確認する。

## turn 20 — 回帰検証結果

判定: 合格。前回の初回堅牢性格子とF1修正差分を確認し、新規指摘なし。本文uploadはPOST/PUTとも既定application/octet-streamを送信し、明示Content-Typeを保持する。multipartは既定file partの型とブラウザ生成boundary・項目順序を維持する。空typeの実OPFS Fileをサーバー受信ヘッダー・size/hashまで照合した。PROGRESSの期待値変更は合意した既定値への修正として妥当。

- クリーンな作業ツリーからmain...HEADの全体と前回検証後の差分を確認。入力検証、宣言権限、URL/origin、認証再送禁止、秘密情報除去、確定境界とcleanup/ロック保持について前回結果の回帰を確認。新しい例外クラスの探索は行っていない。
- bun run verify:transfer成功: WASM生成、JS614件/29ファイル、Rust15件、check（207ファイル整形・90ファイルlint、警告0）、445文書リンク/56文書、build。Chromium152.0.7977.64でDOM/Canvas、100 MiB GET/File/FormData、CORS/認証、上書き/容量/中止、2タブWeb Locksと解放が成功。
- 文書追従チェックリストの数値・未対応記述を再検索し、一般HTTP/Rhai/files/Workerおよび過去計画の制限と転送の制限が区別されていることを確認。git diff --check main...HEAD成功。
- 残留リスクは初回記録のとおり（Web Locks未対応環境の排他範囲、ブラウザ内部buffer、サーバー巻き戻し、別ブラウザ未実測）。
- origin未設定のためmainへローカルマージする。成功後はreflectへ遷移する。
