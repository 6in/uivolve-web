# 開発振り返りブログ 進捗

## discuss — 仕様確定・開始準備

- やったこと: 選択式対話で主題/読者/分量/文体/図とコード/配置/追加内容/実行設定/監視方式を確定。前回OPFS成果をarchive/opfs-file-transferへ退避し、reflectとログは保持。REQUIREMENTS/DECISIONS/stateを新規マイルストーンへ更新。
- 想定外: なし。
- やり直し: 対話の仕様調整を反映（6,000〜8,000字、ポップで丁寧・絵文字多め、記事フォルダ直下のPNG4枚、WebMCP/モック/UT追加）。実装の立て直しではない。
- 次への注意: PATH上のgsd-lite-loop.shを使用。調査対象はこのrepoのみ。旧成果の根拠はarchive/opfs-file-transferと既存reflect/logs。WebMCPの既定有効範囲とUT/ブラウザ試験の境界を正確に説明。字数の除外規則を固定し、図は画像ファイルを相対参照する。
