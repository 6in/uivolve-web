# VERIFICATION — component-webmcp（段階 6: WebMCP の合成）

- 実施: 2026-10-10 / gsd-lite-verify（turn 13、verify round 2。round 1 は turn 11）
- 対象: `git diff main...HEAD`（main `52ec888` → HEAD `49ef038`。コード・文書・デモは 25 ファイル / +1,134 / −92。`.gsd-lite/` と `.claude/skills/` を含めると 40 ファイル）。round 1 の HEAD `790d32b` からの差分は F1（`engine/src/lib.rs` 5 行 + `engine/src/composition_tests.rs` 1 本 + `tests/components-demo.test.js` の `find` → `filter` + `docs/components.md` / `docs/webmcp.md` の 3 断言）だけ
- 実行エンジン: Claude Code（Claude Fable 5.1）。round 2 はサブエージェントなし（round 1 の格子の再確認 + F1 の回帰だけで、新しいクラスの探索はしない）
- 判定: **合格**。受け入れ基準 1〜9（6b 含む）を満たし、round 1 の指摘 F1 は完了基準どおりに直っている。リモートは github.com なので push + PR 作成（ローカルマージはしない）
- PR: （作成後に追記）

## round 2 で確認したこと

### 最終判定（クリーンな状態から再実行）

`git status --porcelain` が空の HEAD `49ef038` で `bun scripts/verify-instance-refactor.mjs` → exit 0（`.gsd-lite/logs/component-webmcp/scratch/turn-013-final.log`。合計 85.8 秒）。F1 で `engine/src/lib.rs` が動いたので再実行が必要だった。

| 手順                                                   | 結果                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `bun run build:wasm` / `bunx vp test run`              | 0 / 0（Vitest 35 files / **736** passed）                                |
| `bun run test:rust` / `bun run check`                  | 0 / 0（cargo **103** passed。round 1 の 102 + F1 の 1 本）               |
| `bun run docs:check` / `bun run build`                 | 0 / 0                                                                    |
| base `52ec888` との照合 / probe composition            | 370 ステップ 差分 0 / 57 ステップ problems 0（6 列）                     |
| 変異 8 本（`build-engine-variant.mjs` の `MUTATIONS`） | 各 exit 1（M8 `components-omitted` は `child-webmcp-published` の 2 件） |

最終判定のあと `bun scripts/probe-composition.mjs --candidate public/engine.wasm` を 1 回回して `target/engine-compare/composition.json` を real candidate の `problems: 0` に戻した（最終手順が変異の probe で証跡を上書きするため。gitignore 済み）。

### round 1 の格子の再確認（新規探索なし）

- `bun .gsd-lite/logs/component-webmcp/scratch/turn-011-robustness.mjs` → exit 0。key 22 種 × 表示・非表示 × `ui_dispatch` + `ui_get_state` = 88 セル + 遷移 1 + 上限境界 18 で**未捕捉例外 0・失敗セルでの revision / root state の変化 0・期待不一致 0**（round 1 と同じ出力。ログ `scratch/turn-013-robustness.log`）
- `bash .gsd-lite/logs/component-webmcp/scratch/turn-010-checklist.sh` → 追従先チェックリスト 14 行すべて条件どおり（ログ `scratch/turn-013-checklist.log`）。F1 で語が変わった行 6 は新しい条件 `git grep -n -F '最初の' -- docs/webmcp.md` が `:71` の 1 件で OK。行 13 は変異 8 本すべて `from` が `lib.rs` に 1 回。行 14 は `git status --porcelain` が全体で空

### F1 の回帰（PLAN F1 の期待結果の表を再実行）

| 条件                                                  | 実測                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root の UI ノード（itemId なし）が `webmcp` を宣言    | 候補: `root.0` / `a/root.0` とも `webmcp=undefined`。同じ入力で base `52ec888` は両方に `{"description":"ROOT-NODE"}` が載る（`scratch/turn-013-rootnode-webmcp.log`）       |
| itemId の無いノードの `webmcp`                        | Rust テスト `a_node_without_an_item_id_publishes_its_webmcp_on_no_widget` が target 空の全 widget と `root.0` / `a/root.0` を確かめ、`search`（itemId あり）は従来どおり出る |
| 照合 / probe                                          | 差分 0 / exit 0・57 歩・問題 0（上の最終判定）                                                                                                                               |
| order-dashboard の `open/orders*` / `shipped/orders*` | `tests/components-demo.test.js` が `filter` で各 3 件以上・全件が宣言どおり・両側 deep-equal（Vitest 736 passed に含む）                                                     |
| `MUTATIONS[*].from` 8 本                              | 各 1 回（チェックリスト行 13）                                                                                                                                               |

文書の 3 断言は実装と一対一になった:

1. 「`itemId` を持たないノードの `webmcp` はどこにも出ない。root の UI ノード自身も同じ」→ `lib.rs:1355` の `if widget.target.is_empty() { continue; }`。上の rootnode の実測で候補側に載らない
2. 「`widgets[].key` の最初の `:` より前を末尾の `/` で割った左側が `components[].instance`。`itemId` は `:` と `/` を含めない」→ `lib.rs:1815-1819`（`itemId must not contain ':'` / `'/'`）。advanced grid の行 key `a/g:row:"x/y"` で `scratch/turn-011-gridkey2.mjs` の `fixedRule` が全 10 widget で `"a"`（旧規則 `docRule` は `a/g:row:"x` になる。`scratch/turn-013-gridkey2.log`）
3. 「`hidden` は配置ノード自身の `visibleBind` による非表示だけ。root の `window` の中の子は window が閉じていても `hidden: false`」→ `hidden_component`（`lib.rs:1913`）が `node.visible_bind` だけを見る。`visibleBind` を持てるのは `window` / `toast`（`lib.rs:1845`）と component ノード（`composition.rs:183`）だけなので、文書の列挙で尽きている。`scratch/turn-011-window-child.mjs` → window 閉: `components=[{hidden:false,…}] keys=["o"]`、window 開: `keys=[…,"a/txt"]`（`scratch/turn-013-window-child.log`）

### 受け入れ基準（round 1 の判定を round 2 の実測で再確認）

| #   | 基準                                                                                       | 根拠                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 子ノードの `webmcp` が `widgets[].metadata.webmcp` に出る                                  | Rust 深さ 1 / 深さ 3 / 2 か所（`composition_tests.rs`）、`tests/parts-lab.test.js` の `note/text`、probe `child-webmcp-published` の `part/fire`  |
| 2   | 子パッケージ直下の `webmcp` を load でき `components[]` に出る。上限超過は root と同じ文言 | `reject_effect_declarations` 0 件、格子の上限境界 18 ケース（`Component a: webmcp: description/label/tags exceed limits or have duplicate tags`） |
| 3   | `screen.webmcp` は root のものだけ                                                         | Rust `the_tool_surface_stays_with_the_root…` 系、probe `data.webmcp === undefined`、`components-demo.test.js`                                     |
| 4   | `ui_get_state` / `stateKeys` は root のまま                                                | 格子の `ui_get_state` 子キーが全状態 `UNKNOWN_KEY`、`parts-lab.test.js` の `stateKeys === ["notice"]`                                             |
| 5   | probe の列を置き換え、照合が通る                                                           | 列 `child-webmcp-published`、`composition.json` `problems: 0` / `steps: 57`、`docs/components.md:304` / `docs/testing.md:91` の数字と一致         |
| 6   | R0 / R0b / R0c の回帰テスト                                                                | `tests/components-loader.test.js` +13 本、`tests/publish-packages.test.js` +2 本（round 1 で確認。期待値変更 0）                                  |
| 6b  | 非表示の子が `hidden: true` → 表示で `false` と widgets                                    | Rust 直交表、`components-loader.test.js` の `visibleBind` ケース、probe `layout:800` → `layout:800:shown`、格子の遷移 1                           |
| 7   | 契約文書が実装と一致、`reserved for a later stage` 0 件                                    | チェックリスト行 1 / 2 / 3 / 6 / 7 + 上の 3 断言                                                                                                  |
| 8   | R4 の堅牢性                                                                                | 格子 88 セル + 遷移 + 上限 18、T8 の 50 セル（未捕捉例外 0）                                                                                      |
| 9   | `check` / Vitest / `cargo test` / `build:wasm` green                                       | 最終判定の表                                                                                                                                      |

### 既存テストの期待値の変更

F1 は `tests/components-demo.test.js` の 1 本を `find`（1 件）から `filter`（全件）へ**強めた**だけで、期待する `webmcp` の値は不変（impl の PROGRESS turn 12 の記載と `git show eaaef82 -- tests` が一致）。T1〜T8 を通じて弱めた期待値は 0 件（T3 の `window` 文言の括弧落としのみ。挙動不変）。

### セキュリティ（F1 の差分だけ）

F1 の製品コードは `lib.rs` の guard 1 つで、新しい入力経路も出力も無い。round 1 のサブエージェント B の判定（NG 0: prototype pollution は到達不能、子キーは http(s) のみ、`build-engine-variant.mjs` は argv 配列で shell なし、`components[]` は 5 フィールド以外を出さない、子の上限は root と同じ `Metadata::validate`）はそのまま成り立つ。

## round 1 の記録（turn 11。要約）

受け入れ基準 1〜6b・8・9 は round 1 で OK。受け入れ 7 の 3 断言（itemId 無しノード / 突き合わせ規則 / `hidden` の定義）と grid の全 widget テストの弱さの計 4 点を F1 にまとめて差し戻した。round 1 の格子は 88 + 1 + 18 ケース / NG 0。詳細は PROGRESS turn 11。

## 残留リスク（要件外。差し戻さない）

1. **`save()` は `current.json` が object で url も一致するが `metadata` が不正なとき `配信マニフェストが不正です` で失敗する**（turn 3 からの推測を turn 11 の `scratch/turn-011-save-metadata.mjs` で実測。4 形: `metadata: {version:9}` / `null` / 欠落 / revision 不一致）。日本語文言で `TypeError` ではなく、既存の `versions/<rev>` も `current.json` も壊れないのでデータ損失は無いが、ポインタを消すまで毎回失敗し、指し手の無い `versions/` が溜まる。R0 の範囲（`null` ポインタ）外の既存挙動
2. **`components[].title` / `id` の長さ上限**は 1 MB のパッケージ上限だけで、`ui_get_screen` が大きくなり得る（root の `title` も同じ）
3. **Rust 側に宣言件数の上限が無い**（`composition.rs:22-41`）。JS のローダーと生成スクリプトが先に止めるので到達しない（REQUIREMENTS R0b の範囲どおり）
4. **`components` が文字列のとき `Object.keys` が 1 文字ずつ数え**、9 文字以上で「宣言が8件を超えています」と出る（拒否はされる。文言が実態とずれるだけ）
5. **`scripts/publish-packages.mjs` は `shape()` を通らない**ので `rpc` の値 `null` がビルド時に `TypeError`（配信時のみ。turn 4 のサブエージェント提案と同根）
6. **宣言上限は 1 パッケージ単位**なので 3 段の木では 8 + 8 + 8 = 24 キーを宣言できる（turn 4 の提案。Instance 数 8 で load 側が止める）
7. **`visibleBind` を持つ `toast` の中に子を置いた場合**は実測していない（`hidden` の文書は `window` だけを例示。`hidden_component` は配置ノード自身しか見ないので挙動は `window` と同じはず）
