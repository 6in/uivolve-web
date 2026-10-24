# DECISIONS — ui-bridge からの要望: 失敗応答の本文・冪等キー・4xx の outcome（http-error-body）

## 前提（discuss 冒頭）

- 前回マイルストーン component-loader は `done`。成果物は `.gsd-lite/archive/component-loader/` へ退避し、state をテンプレートから作り直した（engine / model / subagents / reflect は引き継ぎ）。
- 起点は main `9c1ddf0`（依頼書 `docs/requests/ui-bridge.md` の書式修正を含む）。
- 依頼書は「名前・宣言の形・上限は uivolve-web 側で決めてよい」「既存の契約（トークンを画面へ渡さない、自動再送を前提にしない、未知の属性を拒否する）を崩してまで合わせる必要はない」としている。

## Round 1

### slug: `http-error-body`（採用）

- 中心の依頼書 R1 を名前にする。R2 / R3 / 残留リスクも同じマイルストーンに含める。
- 却下: `ui-bridge-requests`（中身が伝わりにくい）、`http-failure-contract`。

### 範囲: 依頼書 R1 + R2 + R3 すべて（採用）

- 採用理由: ui-bridge 側の取り込み（Release 版の固定）が 1 回で済む。
- 却下: R1 + R2（4xx の扱いを画面に任せる）、R1 のみ（再送の課題が残る）。

### 前回の残留リスク 1 / 3 / 5 / 10: 全部含める（採用）

- ユーザーの選択。推奨は「含めない」だったが、まとめて片付ける判断。振り返りの提案どおり 3 と 5 は最初のテストタスクに置く。

### 堅牢性の受け入れ基準: 入れる（採用）

- REQUIREMENTS R5。

### 前回 reflect の「スキルを直す」提案: 本 discuss で反映（採用）

- `.gsd-lite/reflect/20261009-1151-component-loader.md` の提案のうちスキル改善 10 件（1〜9・11）を `.claude/skills/gsd-lite-{plan,impl,verify,reflect}/SKILL.md` へ反映し、要件確定のコミットに含める。提案 8（turns.jsonl の `usage_total`）はループ本体の変更になるため、reflect スキルの計測表の注記だけにした。提案 10（残留リスク）は REQUIREMENTS R4。
- 却下: 反映しない（提案が蓄積したままになる）。

### Release: 人が行う（採用）

- 無人ループは実装・文書・テストと、依頼書 `docs/requests/ui-bridge.md` の「状態」を「実装済み（Release 待ち）」にするところまで。タグ付け・GitHub Release の公開と、依頼書への版の追記は MR マージ後に人が行う。
- 採用理由: Release は外部への公開で取り消しにくい。マージ前の版が公開されるのを避ける。
- 却下: ループが verify 合格後に Release まで行う。

## Round 2（R1 の形）

### opt-in の場所: 操作の `options`（採用）

- 採用理由: 依頼書の例どおり操作ごと。`http.js` の options 許可キーに足すだけで Worker モックにも効く（モックは `http.validate` と同じ fetch 経路を通る）。
- 却下: 接続（全操作に効くが操作ごとに切れない）、両方（契約・テストが倍）。

### 置き場所: `error.body` + `error.status`、status は opt-in に関係なく常に（採用）

- 採用理由: Rust の `validate_result` は error の余分なキーを拒否しないので、追加キーで既存画面は壊れない。画面が `code` の文字列（`HTTP_422`）を切らずにステータスを判断できる。
- 却下: どちらも opt-in 時だけ（互換は文字どおりだが status の価値が opt-in に縛られる）、`response.body`（トップレベルのキー検査が別に要る）。
- 注: 依頼書の「opt-in しない操作の振る舞いは今と同じ」から `error.status` の追加だけ外れる。互換の判定は「既存のキーと値が変わらないこと」とする。

### 上限: 64,000 バイト（採用）

- 依頼書の例。既存の上限（900,000 / 1,000,000）に合わせて 10 進で数える。却下: 16 KB、256 KB。

### download: 対象にする（採用）

- reader は取得済みなので追加は小さく、契約が 4 操作で揃う。却下: 対象外（契約に例外が残る）。

## Round 3（R2 / R3 / 残留リスク 5）

### R2 の方式: `uuid_v4()`、乱数はホストが ABI 要求に添える（採用）

- 採用理由: WASM は import を持てない（`scripts/build.mjs`）。時計（`clock`）を ABI 要求に添える既存の前例がそのまま使える。画面がキーを state に持てば再送で同じ値を使え、「自動の冪等キーは付けない・自動再送しない」既存の決定と衝突しない。
- 却下: 操作の宣言でホストがキーを入れる（再送で同じキーを使うにはホストがキーを覚える仕組みが要り、`docs/files-cache-rpc.md:180` の決定との整理も要る）、両方。

### R2 の範囲: UUID v4 + `random_int(min, max)`（ユーザーの選択）

- 推奨は UUID だけだったが、同じ乱数供給で作れるので整数乱数も足す判断。

### R3 の場所: 接続（採用）

- 採用理由: 「4xx では処理しない」はサーバ単位の保証なので接続に書くのが意味に合う。ui-bridge への接続だけで有効にすれば全操作に効く。
- 却下: 操作の options（サーバの保証を画面が自己申告する形）、両方、対応しない。

### 残留リスク 5: 壊れた current として扱い上書き保存（採用）

- 自己回復し、利用者の操作が要らない。却下: 契約文言で失敗して clear を案内（clear するまで毎回失敗する）。

## Round 4（R1 の受付条件 / R2 の上限 / 残留リスク 1 / 検証）

### R1 の受付条件（multiSelect で 3 件とも採用）

- 採用: Content-Type は `problem+json` / `json` に加えて `+json` 接尾辞も可（パラメータ無視・大文字小文字無視）。
- 採用: JSON の値は object のみ（problem+json は object と定められている）。
- 採用: 載せられなかった理由を `error.bodyError` で知らせる（推奨外。ユーザーの選択。デバッグを楽にするため契約が 1 キー増えることを受け入れた）。

### R2 の上限: 1 実行 1,024 バイト（採用）

- 毎回の要求に 1 KB 添える。却下: 乱数を使う画面だけ添える（コンパイル時判定が複雑）、256 バイト（一括で多数のキーを作る画面で足りない）。

### 残留リスク 1: 1 パッケージ 8 件（採用）

- 既存の「Instance 8」「descriptors 8 件」と揃う。却下: 16 件。

### DOM / Canvas の確かめ方: Vitest で両 surface + 実ブラウザ 1 本（採用）

- 実 WASM の Vitest で DOM / Canvas の両方に同じ画面を載せて確かめ、既存の `test:transfer:browser`（Playwright、dom/canvas ループ）に 422 + problem+json のケースを 1 本足す。
- 却下: Vitest だけ（実際の fetch / ReadableStream を通らない）、実ブラウザで全ケース（遅く、無人ループで不安定）。

## Round 5（WebMCP / デモ）

### WebMCP: 失敗本文を出さない（採用）

- 今と同じく host の結果はスナップショットに出ない。handler が state に書いた内容だけが `ui_get_state` で見える（画面が決める）。却下: 直前の失敗を出す（サーバの文言がそのまま AI に渡る）。

### デモ: 既存の「受注管理・Worker API」画面に足す（採用）

- 422 + problem+json の項目エラー表示と、`uuid_v4()` の冪等キーで送り直す例。画面数（24）は変えない。
- 却下: 新しいサンプル画面（25 画面になり一覧・README の追従が増える）、追加しない。

### discuss が決めた細部（トレードオフが小さいもの）

- R1 は `code` / `message` / `outcome` / `retryable` の決め方を変えない。outcome を変えるのは R3 だけ。
- `error.status` は応答を受け取った失敗だけに付ける（通信例外・開始前の拒否・TIMEOUT には付けない）。
- 旧来の `requests` / `http_get` と `rpc_call` は対象外（依頼書の対象 action に無い）。
- 名前（opt-in のキーと値、`bodyError` の値、R3 の接続キー、乱数の ABI フィールド名）は plan が決める。

## 終了シーケンス

- 確定内容サマリーにユーザーが合意（2026-10-19）。
- research の調査対象: `local_projects` / `official_docs` / `similar_oss`（全選択）。`local_search_paths` に依頼元 `../ui-bridge-component`（`HANDOFF.md` §2.7・§2.11）を足した。
- 実行パターン: 現在の設定を維持（すべて Claude、`phase_engines: {}`。research / plan / verify / reflect は `claude-fable-5-1`、impl は `claude-opus-5`）。`subagents: auto`、`reflect: true`。
- 環境: rustup が `~/.bashrc` に追記した `. "$HOME/.cargo/env"` が非対話 guard より後ろにあり、サブエージェント・無人ループで `cargo` が PATH に無かった。ユーザーの選択で guard より前へ移した（`gsd-lite-loop.sh --check` は cargo を見ないため、起動前に `bash -c 'command -v cargo'` 相当で確認した）。
- `gsd-lite-loop.sh --check` は green（trust accepted）。`.gsd-lite/state.json` は `vite.config.js` の `fmt.ignorePatterns` に入っている。
- 資源の上限（limits）: メモリ半分・CPU 半分（`{"memory_max": "8G", "cpu_quota": "200%"}`。マシンは 4 コア・15 GB、`delegate.conf` で cpu / memory を委譲済み）。discuss の後でテンプレートを更新して入った手順のため、要件確定の後に追加で選んだ。
