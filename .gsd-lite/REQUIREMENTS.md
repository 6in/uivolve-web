# 要件 — component-effects（段階 4: 効果の instance ルーティング）

## 背景

- 画面パッケージの部品化計画（`docs/components-plan.md`）の段階 4。段階 3（同期のみの合成、PR #2 マージ済み）では子 Instance の非同期効果 19 関数と宣言 7 種を拒否した。
- 本マイルストーンで子 Instance の非同期効果を解禁し、effect と `*_result` op に `instance` を持たせて完了を正しい Instance へ返す。storage / files の scope 区切りと `http` effect の `kind` もここで決める。

## 用語

- 画面パッケージ / コンポーネント / component ノード / Instance / 接頭辞付き itemId / config / emit / listeners: 前回（`archive/component-composition/REQUIREMENTS.md`）と同じ。
- 効果（effect）: Rhai の効果関数が積み、応答の `effects` 配列でホストへ渡る依頼（http / storage / file / rpc / host / dialog / navigate）。
- 完了（completion）: ホストが効果の結果を返す ABI op（`http_result` / `storage_result` / `file_result` / `rpc_result` / `host_result` / `host_progress` / `dialog_result`）。
- instance パス: 効果を積んだ Instance の接頭辞付き itemId（`"a"`, `"a/b"`）。root は空。

## 要求

### R1. 子 Instance の非同期効果の解禁

- 子 Instance で効果関数 19 個（`alert` / `confirm` / `prompt` / `file_*` 8 本 / `host_call` / `host_cancel` / `http_get` / `navigate` / `rpc_call` / `storage_*` 3 本）を本物として登録し、段階 3 の stub と `AST::walk` 走査による拒否を外す。
- 子パッケージの宣言 `requests` / `operations` / `storage` / `files` / `rpc` / `pages` を許可する。`webmcp` は引き続き `webmcp is not available in components (reserved for a later stage)` 相当で拒否（文言は plan が決め、契約文書と一致させる）。
- 子 ui の `window`（`messagebox` / `msgbox` 含む）の拒否は据え置き（段階 4 の対象外）。
- `file_bytes`（純粋なコンストラクタ）は子で使える。契約文書に 1 文、テスト 1 本。

### R2. effect と完了 op の `instance`

- 子 Instance が積んだ effect（http / storage / file / rpc / host / host_cancel / dialog / navigate）は `"instance": "<接頭辞付き itemId>"`（例 `"a"`, `"a/b"`）を持つ。root の effect は `instance` を持たない（既存応答と同一）。
- 完了 op（`http_result` / `storage_result` / `file_result` / `rpc_result` / `dialog_result` / `host_result` / `host_progress`）は、子の effect に対しては `instance` 必須。省略は root を指す。
- id は Instance ごとの連番のまま（root と子で同じ id が存在しうる。`instance` で区別する）。dialog の id は root の採番で画面内一意だが、子のダイアログの `dialog_result` にも `instance` を必須にする（ルールを 1 つにする）。
- 不正な完了（未知の `instance`、その Instance に無い id、root の完了に子の id、子の完了に `instance` 省略、同じ完了の重複、`instance` の形が不正）は英語のエラー文言で `ok: false` を返し、root と子すべての state・pending・revision を変えない。文言は plan が既存（`Unknown HTTP request id` 等）に倣って決め、契約文書に列挙する。

### R3. 子の完了ハンドラのトランザクション

- 子の完了ハンドラの実行は、子への dispatch と同じ経路: 子の handler → 子の state 候補 → 子の `emit` → 親の `listeners` → 親の commit → `config` の下方伝播。全体で 1 commit・revision +1。どこかで失敗すれば root と子すべて不変。
- 完了ハンドラ中の `emit` は許可。`config` handler 中の `emit` 禁止は据え置き。
- 完了時にも既存どおり全 Instance の `clear_queues` と `pages.clear()` / `dialogs.clear()` を行う（失敗したイベントで積んだ依頼は持ち越さない）。

### R4. `http` effect の `kind`

- すべての http effect に `kind: "http"` を付ける（root も子も）。effect の形は `{kind, id, request, url[, instance]}`。
- `scripts/compare-engine-behavior.mjs` は http effect の `kind` だけを正規化して base と比較し、それ以外は従来どおり文字列一致。正規化の対象をスクリプト内に明記する。
- JS（`src/runtime.js`）の `!effect.kind || effect.kind === "http"` は `effect.kind === "http"` に揃える（互換のため `!effect.kind` を残すかは plan が決め、残すなら理由を書く）。

### R5. storage / files の子 scope

- 子 Instance の storage / files の scope は `<root の id>__<instance パスの / を __ に置換>`（例 `orders__a__b`）。root は従来どおり `<id>`。
- storage または files を宣言する子を置くとき、scope が `[A-Za-z0-9_-]{1,80}` に合わなければ load エラー。Rust（load 時）と JS（ローダーの宣言検査）の 2 段。文言は英語（Rust）/ 日本語（JS）で契約文書に列挙する。
- scope は Rust が決めて effect に載せるのではなく、JS が `effect.instance` と root の `id` から同じ規則で合成する（規則は契約文書に 1 か所で書く）。どちらが持つかは plan が決めてよいが、Rust と JS の規則が食い違わないテストを置く。
- OPFS のファイルロック（`fileLockKey(scope, volume)`）は scope 単位なので、同じ子を 2 か所に置いても衝突しない。種別共有の宣言は入れない。

### R6. JS 側のルーティング

- `UiRuntime` は effect の `instance` から Instance → 宣言 URL（子パッケージ URL）を引き、`requests` / `rpc` / `pages` / `operations` の相対 URL をその URL 基準で解決する。root は従来どおり root パッケージ URL 基準。
- `HostEffects.prepare` を Instance ごと（root + 各子の `operations`、scope と `files` はその Instance のもの）に行い、`host_progress` / `host_result` に `instance` を付けて返す。`host_cancel` は同じ Instance の操作だけを対象にする。
- storage / files の完了・http / rpc / dialog の完了はすべて `instance` を付けて WASM に返す。
- `network-first` と配信キャッシュ、エディタの「変更を適用」の挙動は段階 3 のまま（変更しない）。

### R7. 上限

- pending 8 / handler あたり 8 / RPC 定義 8 / state 1 MB などの既存上限は Instance ごと（キュー構造のまま）。契約文書に「画面全体では Instance 数 × 上限になりうる」と書く。

### R8. layout の子スナップショットのキャッシュ

- `layout_scope()` が毎回作る全子の `ui.clone()` と `state_json()` を、Instance の revision（または commit 単位の世代）をキーにキャッシュし、state が変わっていない子の再シリアライズを省く。応答（Scene）は不変であること（照合と既存テストで確認）。

### R9. デモと候補のみの検証

- デモに storage / http / dialog を使う子 3 種を置く（order-dashboard の拡張か新デモ 1 画面かは plan が決める）。http の子は既存 `public/screens/http-grid` を**無改修**で宣言する。
- `scripts/probe-composition.mjs` に、子の各効果が `instance` 付きで出ること・`instance` 付き完了が子へ届き emit で親が動くこと・不正な完了で state 不変であることの列を足す。
- Vitest で DOM / Canvas 両レンダラーの `UiRuntime` 経由（scope の形、基準 URL、`instance` の往復）を確認する。

### R10. 契約文書の追従

- `docs/components.md`: 「拒否」節を段階 4 の内容に書き換え（効果の解禁、`instance`、scope、上限、エラー文言の列挙）、「段階4以降の課題」から該当項目を外す。`:117` 相当の JS 文言列挙に `コンポーネント {名前} の宣言が不正です（url を文字列で指定してください）` を 1 件足す。
- `docs/components-plan.md`: 冒頭の状態注記と段階計画を「段階 4 完了」に更新し、残課題から scope 区切りと `http` の `kind` を外す。
- effect の形を書いている契約文書（`docs/http-adapter.md` / `files-cache-rpc.md` / `host-adapters-design.md` / `dialogs.md` / `screen-format.md` 等、plan が `rg` で洗い出す）に `kind: "http"` と `instance` を追記。`docs/testing.md` に照合の正規化と probe の追加列を追記。
- 件数（「効果関数19個」「宣言7種」等）を書いている文書は追従先チェックリストで全部拾う。

## 受け入れ基準

1. **全検査 green**: `bun run build:wasm` → `vp test run` → `test:rust` → `check` → `docs:check` → `build`。既存テストの期待値変更は `kind: "http"` の追加に起因するものだけで、すべて PROGRESS に列挙。
2. **挙動照合**: `compare-engine-behavior.mjs --base <main の WASM> --candidate <HEAD の WASM>` が http effect の `kind` 正規化のもとで差分 0。変異（`build-engine-variant.mjs --mutation`）は既存 5 本に段階 4 用（例: `instance` を落とす / 他 Instance へ完了を配る / scope 規則を変える）を足し、すべて exit 1。
3. **候補のみの probe**: `probe-composition.mjs` が R9 の列を含めて problems 0。
4. **ルーティングの格子**: Rust 単体テストで「入口 8 本（`dispatch` / `progress_host` / `complete_host` / `complete_http` / `complete_storage` / `complete_file` / `complete_rpc` / `complete_dialog`）× 対象（root / 子 / 孫）× 結果（正常 / handler 失敗 / 不正な `instance` / 他 Instance の id / 重複 / `instance` 省略）」を網羅し、各セルで state・pending・revision の期待を確認する（plan は直交表を PLAN に置く）。
5. **堅牢性（R-robust）**: 上記格子に加え、reload 後の遅延完了、2 MB 境界、scope 80 バイト境界、`emit` を伴う完了の失敗で WASM の trap / JS の未処理例外が 0、前画面 / 現画面の state を失わない。
6. **契約文書と実装の一致**: `docs/components.md` のエラー文言・effect の形・scope 規則が実装（Rust / JS）と一対一で突き合わせられる。件数を書いた文書に古い値が残っていない（`rg`）。
7. **公開シグネチャ**: `Runtime` の `pub fn` の名前と引数は不変（`instance` は `Value` の中で渡すか、新しい `pub fn` を足すなら ABI からだけ呼ぶ。plan が決めて DECISIONS に書く）。`abi.rs` の op 名は不変。
8. **デモ**: 子 3 種が DOM / Canvas で同じ Scene を出し、storage の子で保存 → reload → 復元、http の子で worker mock API から行が出る、dialog の子で confirm → 完了 → emit → 親 state が動くことを Vitest で確認。
9. **整形**: `bun run check` green。`.gsd-lite/*.md` も `bunx vp fmt` 済み。

- R-robust: どの入力・応答状態（不正な `instance`、他 Instance の id、順序違い、重複完了、reload 後の遅延完了）でも WASM の trap / JS のトレースバックを出さず、既存の画面 state（root と子）を失わない。verify は違反を差し戻し対象にする。

## スコープ外

- 子パッケージのローダー改修（再帰取得・キャッシュ・配信キャッシュ `network-first` / 復元・2 MB 上限の扱い）: 段階 5。
- 子の `webmcp` の合成: 段階 6。
- 子 ui の `window`（モーダル層の親子共有）: 後の段階。
- storage / files の種別共有の宣言（`scope: "package"` 等）: 後の段階。
- 画面全体で共有する pending 上限の追加。
- id を画面全体で一意にする採番の変更。
- `thread_local`（`dialogs::SEQUENCE` / `buffers` / `BYTE_USAGE` / テーマ）の Instance への移動、`with_clock` の文脈分離。
- emit の連鎖深さ上限の見直し。
- ループやスキルの改修（本 discuss で行った 6 スキルの編集を除く）、lean-ctx フックの project root。

## 検証の道具（既存）

- `scripts/compare-engine-behavior.mjs`（base との応答照合）/ `scripts/probe-composition.mjs`（候補のみ）/ `scripts/build-engine-variant.mjs`（別コミット・変異ビルド）/ `scripts/verify-instance-refactor.mjs`（最終判定）。最終判定は既存スクリプトを拡張する（新規に分けるかは plan が決める）。
- `engine/src/composition_tests.rs`（61 本）/ `tests/components-loader.test.js` / `tests/components-demo.test.js` / `tests/abi.test.js`。

## research への入力

- 前回 VERIFICATION 残留リスク 1（layout の子スナップショット）・3（`file_bytes`）・9（JS 文言の未列挙）。
- `engine/src/{http,storage,files,rpc,host,dialogs,pages}.rs` の effect 構造体と `pending` の形、`abi.rs` の完了 op、`src/runtime.js` の effects 振り分けと各 `*Effects.reset(...)`、`src/storage-client.js` / `src/file-client.js` の scope 検査、`src/host-effects.js` の `prepare`。
- 段階 3 の決定（`archive/component-composition/DECISIONS.md`）と契約（`docs/components.md`）。

## 運用

- in-repo 形。base = `main`。verify 合格後に `gsd-lite/component-effects` を origin へ push し PR を作る。`.gsd-lite/`（archive 退避を含む）も PR に含める。マージは人間 / CI。
