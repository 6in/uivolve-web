# 決定記録 — component-composition

## 前提

- 方式は `docs/components-plan.md` の B 案（エンジン内合成）。本マイルストーンは段階 3（同期のみの合成）に、段階 5 のローダー再帰取得（キャッシュ・manifest を除く）と段階 6 の契約文書・デモ（WebMCP を除く）を前倒しして含める。ユーザーの要望どおり。
- 前回振り返りからの採否（ユーザー指定）: 照合列を PLAN に固定する前に base WASM へ 1 度流す / サブエージェント依頼文に `git checkout` 系禁止 / research・plan も `bunx vp fmt <path>` / `rpc_result` の成功経路を照合列に足す。

## Round 1

### config handler の呼び出し時機

- **採用: 親 handler 直後・同一トランザクション内**。親 handler が返した state を検証した後、bind 値が変わった子だけに `config` を呼び、子 state も検証してから親子を 1 回の commit で確定。失敗したら親子とも変更なし。
- 却下: 次の layout 前（layout が state を書き換える経路になり「layout は読み取りのみ」が崩れる。WebMCP の state 取得との不整合）。却下: 初回ロード時のみ注入（フィルタ連動のデモが成立しない）。

### 連鎖の順序

- **採用: 深さ優先・一括 commit、`config` からの `emit` は禁止**。子 handler → 集めた emit を親 listener へ順に → 親 state の bind 差分で子の config を順に → すべて検証後に親 → 子の順で代入。`config` 内の `emit` はエラーにしてピンポン連鎖を構造的に封じる（emit 1 段 + config 1 段で深さ上限は不要になるが、設計文書の「連鎖深さ上限 4」は「本構造では 2 段で打ち切り」と読み替えて契約文書に書く）。
- 却下: config からの emit も許可（深さ 4）。表現力はあるがピンポン検出と順序の説明が要る。却下: emit を次トランザクションへ遅延（「失敗したら何も変わらない」が崩れる）。

### デモの子パッケージ

- **採用: 部品用に別ファイル**（`public/screens/parts/order-list.{json,rhai}`）。既存 22 画面を無改修に保ち、挙動照合の差分 0 を維持する。`public/screens/packages/` は生成物で gitignore のため使わない。
- 却下: `orders.json` / `orders.rhai` に `config` / `emit` を追加（照合列の orders の応答が変わり、差分 0 の例外定義が要る）。却下: `orders.json` をそのまま子にする（連動・選択通知のデモが成立しない）。

### 子の非同期効果の拒否時点

- **採用: 実行時拒否を必須、load 時検出は可能なら追加**。子 Instance の Rhai engine に効果関数を「子では使えない」エラーを返す形で登録。rhai は `internals` なしでビルドされており `AST::walk` が使えないため、load 時検出は research で feature 追加のコスト（ビルド・WASM サイズ）を確かめて判断する。
- 却下: load 時の静的検出のみ（動的呼び出しの取りこぼし・feature 追加の不確実性）。却下: 実行時のみ（早期検出がない。ただし採用案の下限として同じ）。

## Round 2

### 堅牢性の受け入れ基準

- **採用: 入れる**。R10 として列挙し、plan は初回タスクに含める。verify は違反を差し戻す。

### 2MB 上限

- **採用: 据え置き、超えたら load エラー**。JS 側で同梱後のサイズを先に検査し、どの子で超えたかを含むエラーで前画面を保つ。デモは数 KB × 3 で余裕。照合列 `abi-errors` の期待値も不変。
- 却下: 8,000,000 バイトへ引き上げ（`abi.rs` / `engine.js` / 文書 / テスト期待値の変更と WASM メモリの再確認が要る）。却下: 子 1 つあたりの上限を別に設ける（無改修で部品にできる範囲が狭まる）。

### 子 ui の window

- **採用: 本マイルストーンでは load エラー**。最前面判定と z 順は root の window だけを見ればよく dispatch の変更が小さい。解放は段階 4 以降の課題として `components.md` に記す。既存で該当するのは `components.json` のみ。
- 却下: 許可してページ全体の z 順に入れる（親子を通した最前面判定と座標変換の実装が要る）。

### 照合列の拡張

- **採用: 3 つすべて**。`rpc_result` 成功経路（残留リスク 1）、`handlerNodes` の走査を `menu` / `bbar` / `tbar` / `buttons` へ（残留リスク 2）、新デモ画面を「候補のみ」の列として証跡に残す（次回の base）。拡張列は PLAN 固定前に base WASM へ 1 度流す（前回振り返りの採用）。

## 終了シーケンス

- 確定内容サマリー（REQUIREMENTS.md / DECISIONS.md）にユーザーが合意。
- research の対象: local_projects（検索先 `.`）、official_docs（Rhai の AST 走査と `internals` feature / Engine ごとの関数登録 / `call_fn`、serde の `deny_unknown_fields` と値の形）、similar_oss（ExtJS の xtype / listeners / config の意味論、他の宣言的 UI エンジンの子コンポーネント合成。契約文書の語彙合わせ）。
- 実行パターン: 現在の設定を維持。全フェーズ Claude（engine=claude、phase_engines={}）。model は research / plan / verify / reflect = claude-fable-5-1、impl = claude-opus-5。subagents=auto、reflect=true。`gsd-lite-loop.sh --check` は discuss 中に通過（trust 受理済み、allowlist 有効）。
- リモート運用: 前回と同じ。verify 合格後に `gsd-lite/component-composition` を origin（github と同 URL）へ push して PR を作る。`.gsd-lite/` の管理文書（archive 退避を含む）も PR に含める。却下: archive 退避を別コミットに分ける / ローカルマージのみ。
- ブランチ: base は `main`（`ef582d5`、github/main と一致、PR #1 マージ済み）。

## discuss 側で確定した細目（ユーザーの明示判断なし。最終サマリーで提示）

- component ノードの許可属性は `xtype / itemId（必須）/ config / listeners / flex / width / visibleBind`。`bind` / `handler` / `items` 等はエラー（子の中身は子 ui が決める）。
- `config` の値で `{ "bind": "<key>" }`（キーが `bind` 1 つのオブジェクト）だけを親 state 参照とし、それ以外は固定値。`bind` は node の bind と同じ規則（最上位キー、ドットなし）。
- emit の event map は既存の形を流用: `#{ target: "<component itemId>", action: "<emit 名>", value: <payload> }`。`listeners` に無い emit は無視（ExtJS と同じ）。`init` 中と `config` 中の emit はエラー。
- `config` handler の引数は `(state, event)`、`event = #{ config: <map> }`。load 時は `state.config` を注入してから `init`（`config` handler は呼ばない。init が `state.config` を読む）。
- `/` を itemId の予約文字に加える（既存画面・tests に使用例なし）。
- Instance 数 8 は root を含む総数、深さ 3 は root を 1 と数える。
- `components` を持つ親の `network-first` は拒否（段階 5 まで）。
- 子パッケージの `requests` / `storage` / `files` / `rpc` / `pages` / `webmcp` 宣言は load エラー。
- 用語: 契約文書では「コンポーネント」= components 宣言の画面パッケージ、「ウィジェット（組み込み部品）」= 組み込み xtype。既存文書の「部品」は書き換えない。
- 新デモ画面は base WASM が load できないので照合列から除外し、Rust 単体テスト / Vitest で検証する。
