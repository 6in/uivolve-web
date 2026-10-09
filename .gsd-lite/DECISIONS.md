# DECISIONS — 段階 5: 子を含む画面の配信キャッシュ（component-loader）

## 前提（discuss 冒頭）

- 前回マイルストーン component-effects は `done`。PR #3 はユーザーが discuss 中にマージし、main（`aa79bd1`）を base にする。
- 前回 reflect の「スキルを直す」提案 10 件を本 discuss 中に `.claude/skills/gsd-lite-{discuss,impl,plan,research,verify}/SKILL.md` へ反映（reflect スキルは既に同じ規則を持つため未変更）。残る 1 件（残留リスクを research の入力にする）は REQUIREMENTS R6 に写した。
  - 注: `vite.config.js` の `fmt.ignorePatterns` に `.claude/**` が入っているため `bunx vp fmt <SKILL.md>` は対象なしで終わる。合否は `bun run check` の green で見る（discuss スキルにその旨を追記）。
- 段階 5 の定義は `docs/components-plan.md:100`「ローダー。子パッケージの再帰取得・キャッシュ・入力 2MB 上限の扱い」。調査の結果、再帰取得と 2 MB 検査は段階 3 / 4 で済んでおり、未実装は「子を含む画面の配信キャッシュ」だった。本マイルストーンの中核はそこに置く。

## Round 1

### スコープの追加（multiSelect で 4 件とも採用）

- 採用: デモのマニフェスト生成（`build:wasm` / `publish:packages` が `parts-lab` / `order-dashboard` の木を生成）。
- 採用: ページ遷移をまたぐ子のメモリ共有。
- 採用: 前回の残留リスク 3（`配送先が未登録です` の自動テスト）。reflect の提案どおり plan の最初のテストタスクへ。
- 採用: 前回の残留リスク 1（`instance` 文字列の長さ上限）。

### マニフェストの形: root の 1 マニフェストに全子孫を列挙（採用）

- 採用理由: 取得・保存・復元が 1 版で完結し、「同じ版の親子」が自明。OPFS に複数ファイルをまとめるトランザクションが無い制約（`docs/opfs-cache-rpc-investigation.md:98`）の下で、版の整合を root の `current.json` 1 つで保証できる。既存のロック（URL ごとの Web Lock）・直前版の保持・削除の仕組みをそのまま木に広げられる。
- 却下: 子ごとに別マニフェストを参照。複数の親で子のキャッシュを共有できるが、版の整合（root と子の `current.json` が別々に進む）・削除（どの親からも参照されない子の判定）・ロック（複数 URL の同時取得）が複雑になる。子は小さい（Rhai 100 KB、DSL 1 MB、木全体 2 MB）ので重複保存のコストは小さい。
- 帰結: 子の更新で root の `revision` も変わる。配信側は root を再生成する（`publish:packages` は root から再帰する）。

### 2 MB 上限: 据え置き + マニフェスト段階で早期拒否（採用）

- 採用理由: 上限値を変えると Rust ABI・文書・probe の全部に波及する。マニフェストに `size` があるので取得前に合計を見られ、無駄な取得を避けつつ「最大の子」を文言に出せる。
- 却下: 検査を load 時だけに残す（実装は小さいが、超過する木を全部取得してから失敗する）。
- 却下: 上限の引き上げ（必要性の根拠が無い）。

### 堅牢性の受け入れ基準: 入れる（採用）

- 既存の「更新中断・容量不足でも保存版と表示中の UI を維持」を木に拡張し、plan が初回タスクに含め、verify が違反を差し戻す。

## Round 2

### slug: `component-loader`（採用）

- `docs/components-plan.md` の「段階 5（ローダー）」に対応し、component-composition / component-effects と並ぶ。却下: `component-delivery-cache`（中核は表すが段階名と揃わない）。

### マニフェストは version 2 に上げる（採用）

- 採用理由: 形の変更（`components` と `revision` の式）を番号で明示する。ローダーは 1（子なし）と 2 の両方を受け入れるので既存の配信物・保存版は壊れない。
- 却下: version 1 のまま `components` を任意キーで足す。子なし画面の版が変わらない利点はあるが、同じ `version: 1` で `revision` の式が 2 通りになる。
- 帰結: 生成スクリプトは常に 2 を出し、子の無い画面も再生成で `revision` が変わる（受け入れ済み）。version 1 に `components` があれば不正。

### メモリ共有: 両モードで共有、明示の再読込で無効化（採用）

- 採用理由: 既定の `network-only` でもページ遷移の子の再取得が消える。無効化の契機（再読込 / cacheMode 変更 / 認証変更）は既存の UI 操作に対応し、新しい操作を足さない。`network-first` ではマニフェストの sha256 で古さを検出できる。
- 却下: `network-first` だけ共有（安全だが既定モードで効かない）。却下: セッション中は無効化しない（再読込でも子が更新されない）。
- トレードオフ（受け入れ済み）: `network-only` ではセッション内で子の更新を見ない。開発中は「再読込」で取り直す。
- 対象は子パッケージのみ。root / ページ自体の共有は入れない。

### 残留リスク 1: `instance` を 256 バイト超で拒否（採用）

- 採用理由: パスは itemId 最大 2 段（深さ 3）で、256 バイトは実用上の itemId を十分に収める。値を文言に載せない専用文言 `Component instance path exceeds 256 bytes` にして、2 MB 弱の文字列が応答と `onError` に写る経路を閉じる。
- 却下: 文言側の切り詰めだけ（拒否が増えないが長い値がそれ以降の検査に流れる）。却下: 両方（切り詰めは 256 バイト上限があれば不要）。

### discuss が決めた細部（トレードオフが小さいもの）

- 復元は木全体を 1 版として扱い、root と子の版の混在を作らない（`docs/opfs-cache-rpc-investigation.md:98` の既存方針の木への適用）。
- 子の保存先は root の `versions/<revision>/components/<i>/`（`<i>` はソートした子キーの添字）。別ディレクトリに分けると削除とロックが複数 URL にまたがる。
- 並列取得・ETag・cache-first は入れない（既存のスコープ外のまま）。
- 残留リスク 3 のテストは plan の最初のテストタスクに置く（reflect の提案どおり）。

### plan が決めた細部（2026-10-09 turn 2。RESEARCH §5 / §7 の選択肢。全文は PLAN.md「決めた事項」）

- R4 の「合計」は全パッケージの `source.size + script.size` の和で、**descriptor を含めない**（RESEARCH §7-1）。descriptor は buffer ABI 経由で `load` の JSON リクエストに入らず、含めると現状 load できる画面を前段が拒否する。文書には「マニフェスト段階は生バイトの粗い前段、load 時が正」と書く。
- `instance` の 256 バイト上限は**完了 op（`take_instance`）だけ**に掛け、load 時の対称検査は入れない（RESEARCH §7-2 の (b)）。R6 の範囲（`take_instance`・Rust テスト 1 本・既存文言不変）を超える防壁を足さない。制限表に「超える接頭辞付きパスの子は完了を受け取れない」と書き、verify が残留リスクとして記録してよい。
- 走査は供給元で抽象化した 1 本（`#walk` + network-only / network-first / 復元の 3 供給元。§5-A）。`manifest()` は形・上限・合計サイズ・revision までで、宣言の木との一致は走査後の `#matchTree`（§5-B）。
- 配信側の子ファイルの命名は `packages/<revision>/component-<i>-source` / `-script` / `-descriptor-<n>`（§5-E）。生成スクリプトは `manifestRevision` を `src/application-loader.js` から import して式を 1 か所にする。
- テストの置き場所: 木の検証・取得・共有・保存・復元は `tests/components-loader.test.js`、生成スクリプトは新規 `tests/publish-packages.test.js`、残留リスク 3 は `tests/components-effects.test.js`（§7-8）。

## 終了シーケンス

- 確定サマリーに合意。research の対象は local_projects / official_docs / similar_oss の 3 つ。
- 実行パターン: 現在の設定を維持（engine = claude、phase_engines = {}、model: research / plan / verify / reflect = claude-fable-5-1、impl = claude-opus-5）。subagents = auto、reflect = true。
- ブランチ: `gsd-lite/component-loader`（base = main `aa79bd1`、PR #3 マージ後）。
