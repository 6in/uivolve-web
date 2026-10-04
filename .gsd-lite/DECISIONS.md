# OPFSファイル転送 決定記録

## ラウンド1: スコープと統合方式

- 3方式すべてとDOM/Canvasサンプル、テスト用サーバーを今回の対象にする。ユーザーが選択。サンプルとサーバーを後回しにする案は採用しない。
- operations / host_callに統合し、ホスト接続・認証設定とfiles領域宣言を再利用する。ユーザーが選択。専用宣言・専用Rhai関数の追加案は採用しない。
- 異常時の堅牢性を合否条件に含める。ユーザーが選択。成功経路だけを合否条件とする案は採用しない。
- 要件の詳細と実行設定は引き続きdiscussで確定する。現時点でループは起動しない。

## ラウンド2

- ユーザーが複数ファイル・同名項目の複数値を選択。単一ファイルとmapに限定する案は採用しない。
- ユーザーが既定100 MiB・ホスト変更可能を選択。10 MiB/1 GiBの既定案は採用しない。
- ユーザーが明示的中止とダウンロード受信進捗を選択。アップロード進捗取得のための別通信方式は今回導入しない。

## ラウンド3

- 上書きは既定拒否・宣言で許可し、親は事前mkdirをユーザーが選択。既定上書き・親自動作成は採用しない。
- 既定120秒・操作別変更可能、通常filesと共有の関係領域排他をユーザーが選択。15秒既定案は採用しない。
- json/text/empty応答、既存HTTPのoutcome契約と再送なしをユーザーが選択。statusとヘッダーだけに限定する案は採用しない。

## ラウンド4

- 操作名・引数形式・32parts/8files・応答メタデータ・進捗頻度を提示し、ユーザーが採用。
- 操作名で中止するhost_cancel(name)をユーザーが選択。IDをhost_callから返す案は採用しない。

## 最終要件合意

- 権限・認証・ファイル名とContent-Type既定・ライフサイクル・進捗handler失敗・サンプル・大容量検証の補足を提示し、ユーザーが確定を選択。
- researchの3調査対象すべてを含む内容に合意。

## 実行設定

- マイルストーン: opfs-file-transfer。baseはmain、作業ブランチはgsd-lite/opfs-file-transfer。
- ユーザーが現在の設定を維持する選択をした。research / plan / impl / verify / reflectはすべてCodex。
- codex.model / codex.reasoning_effortは未指定で各フェーズのCLI既定を使用。Claude用model設定は維持されるが今回のCodex実行には適用されない。
- subagents=auto、reflect=true。CLIが対応しない並列実行はスキルの定める従来動作へ戻す。
- 6スキルはホストテンプレートと一致。GSD_LITE_ENGINE/GSD_LITE_CODEX_SANDBOX環境変数による上書きなし。gsd-lite-loop.sh --check合格。
- 要件確定とresearchへの遷移を一括コミットする。ループ起動方法は最後の確認で決める。

## Codexループの再開設定

- ユーザーが2026-10-04に承認したため、再開時は `GSD_LITE_CODEX_SANDBOX=danger-full-access` を指定する。workspace-writeでは既存試験のlocalhost bindがEPERMとなり、approval_policy=neverの無人ターンでは解除できない。ファイルシステムのsandbox制限が外れることを説明したうえで承認された。
- プロジェクトローカルの6スキルと管理文書をvp fmtで整形し、指示内容は維持する。
