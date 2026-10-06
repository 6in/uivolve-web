# VERIFICATION — renderer-font-size-parity

- 判定: **合格**（verify round 3 / turn 21 / 2026-10-07）
- 対象: `main...HEAD`（`gsd-lite/renderer-font-size-parity`、38 コミット、`src/` 7 ファイル・`tests/` 16 ファイル・`scripts/` 2 ファイル・`docs/` 4 ファイル）
- round 1（turn 13）は F1〜F5、round 2（turn 19）は F6 で差し戻し。round 3 は PLAN「verify round 2 の記録」の
  とおり **F6 の各項目の照合・最終 gate・木のクリーン確認だけ**を行い、新しいクラスの探索はしていない
  （格子のプローブと変異の確認は round 2 で全条件を再確認済みで、F6 は製品の挙動と検査の判定を変えていない）。
- 実行エンジン: Claude Code（verify はサブエージェント 1 本を読み取り専用で並行）。

## 観点と確認したこと

### 1. 最終 gate（クリーンな木から）

`git status --short` が空であることを確認してから `bun scripts/verify-font-parity.mjs` を実行し、
**14 手順とも成功（exit 0）**。実行後も木はクリーン。件数は turn 19 / 20 と完全に同じ。

| 手順                            | 結果                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vitest（全ファイル）            | 30 ファイル / 631 件 passed                                                                                                                                |
| test:rust                       | ok（15 passed）                                                                                                                                            |
| check / docs:check              | 成功 / 470 リンク（57 ファイル）                                                                                                                           |
| build / build:runtime / minimal | 成功                                                                                                                                                       |
| `roles`                         | 28 ケース・DOM 1243・Canvas 1276・1254 スロット / 37 kind・48/48 xtype・18 状態・host-rule 6 読み取り（90 部品）                                           |
| `editing`                       | 16 ケース・DOM 353・Canvas 665（Grid 編集 11）・638 スロット / 25 kind・操作 12 本 / 6 画面（両面）・合成 composition 2・host-rule 12 読み取り（654 部品） |
| `surfaces`                      | 18 ケース・sprite の対 257・media 枠 46（案内 28）・ダイアログアイコン 6                                                                                   |
| `lifecycle`                     | 11 ケース・倍率 2/1/2.5/1・実フォント FreeMono                                                                                                             |
| `matrix`                        | 168 ケース・DOM 5496・Canvas 6052・2904 スロット / 28 kind・26 役割・入力位置 288 件 / 7 画面・journey 2 本・画像 64 枚                                    |
| `distribution`                  | 8 ケース・32 比較・サイズ差 0・編集 16 本すべて 13px・画像 12 枚                                                                                           |

### 2. F6 の各項目の照合（round 2 の指摘が直っているか）

F6 の差分は `docs/renderer-font-parity.md`（216 行）、`src/canvas-renderer.js`（コメント 6 行）、
`tests/browser/font-parity.mjs`（`evidence` 文字列 2 つ）、`.gsd-lite/PLAN.md` だけで、
`git diff --stat 8c8d76e..HEAD -- src/ tests/` も同じ 2 ファイル・6 行の追加・4 行の削除。製品の挙動と検査の判定は不変。

親が直接確かめたこと:

- **(B)7** `render(scene)` は `src/canvas-renderer.js:476` で `syncSurface()` を呼んでから `paint()` に入り、
  `paint()` は `resolveFonts()`（607 行）→ `syncSurface()`（610 行）の順。新しいコメントと台帳の記述はこの順序どおり。
- **(B)2** `.ui-grid-header span` / `.ui-row span` は `src/runtime.css:705-712` で `font-size` を宣言していない。
  台帳の参照先と主張（親から継承するのでタグだけのホスト規則が勝つ・F4 は未実測・`main` から同じ）は正しい。
- **(C) 節の並び** 見出しの実際の順は T2 → T3 → T4 → T5 → T6 → F3 → T7 → T8 → T9 → F1 → F2 → F4 → まとめ で、
  台帳冒頭の記述と一致。`displayfield` が T3 の kind 表に入り、`drag ghost も同じ分岐` は消え、
  F4 の見出しは「3 ケース・18 回の読み取り」、修正後画像の置き場所は `before-fix/` の親、と直っている。
- **旧文言の残存**: `media 案内 46 件` / `遅延配信の前後 5 ケース` / 旧 sha256 の 2 値 / `T1〜T9・F1〜F5` /
  `drag ghost も同じ分岐` / `0,1,0・F4 で確定` / `T5 の限界に既記` / `同じディレクトリの matrix-` を
  `docs/` `tests/` `src/` で `git grep` し **0 件**（PLAN.md の F5 / F6 の指摘本文に引用として残るだけ）。
- **(A)3** `tests/browser/font-parity.mjs` の `evidence` 2 つは台帳の状態表の文言と一致し、gate の `surfaces` ログ
  「46 media frames (28 showing a notice)」とも整合。
- **(A)1 の方針**: 台帳は sha256 の値を写さず `distribution.json` の `builds` を指す形になっている
  （turn 20 の申し送りどおり、生の実測値の写しを減らす方針が保たれている）。

サブエージェント（読み取り専用）に証跡 JSON（`distribution.json` / `lifecycle.json` / `roles-parity.json` /
`matrix.json` / `roles-coverage.json` / `surfaces.json` / `editing.json`）との照合を任せた結果、**(A) 4 件・(B) 9 件・(C) 全項目が
証跡と一致**（(B)9 の「`ResizeObserver` で再通知」だけは round 2 のプローブ出力で、読み取り専用では再実行していない。
`compile()` の順序 render → `onError(null)` → `onLoad` はコードで確認）。親が報告の要点を再確認したもの:

- (A)1 `distribution.json` の `builds` は `runtimeDist` と `appDistRuntime` が 3 件とも同じ値。
- (A)2 `lifecycle.json` の `fonts-arrival.remeasured` は 4。before / after の draws を検査と同じ規則で数え直すと台帳が名指す
  4 文字列と幅になり、200 文字の `W…` は省略後の文字列が 58 → 85 code point で同一文字列の照合から外れる。
- (B)1 `roles-parity.json` の `kanban-drag-canvas` の `canvasOnly` は `empty`（12px）と `kanban-lane`（11px）の 2 件。
- (B)4 `matrix.json` の journey 2 本は各 6 段で、全段 `fontSize: 13`・`same: true`。
- (B)5 `dialog-text-icon` の 24 ケースすべてで `declaredSizes` が `[11,12,13,20,30]`、他画面に 30 は出ない。
- (C) media 枠 46 = DOM 30 ＋ Canvas native overlay 16、案内 28 = 24 ＋ 4。行列に乗らない kind は 9 件で 28 + 9 = 37。
  F4 の読み取りは `editing.json` 12 ＋ `roles` 6 = 18。

### 3. 目視（今回の gate が生成した画像）

- `distribution-embed-20px-dark.png`: 配布物の組み込みホスト、DOM / Canvas の両面で「名前」「例：太郎」「挨拶する」
  「名前を入力して…」が同じ大きさ・同じ行位置。欠け・重なりなし。
- `matrix-standalone-grid-lab-narrow-dpr1-zoom100-dark.png`: 390px / dark の grid-lab。両面の metric・tab・
  見出し・セル・paging・案内文のサイズが揃っている。見える差は metric タイルの省略方式（DOM はクリップ、
  Canvas は `…`）だけで、台帳の「表現差（省略）」に既記。

### 4. 受け入れ基準との対応（round 1・2 の確認を含む最終状態）

| 基準                                      | 根拠                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1 役割ごとの実効 px 一致・対象外の一覧    | `roles` 1254 スロット・37 kind・48 xtype で不一致 0。F1 で key × スロットの突き合わせに変更（変異 8 件で非 0 を確認）。一覧は台帳まとめ節 |
| 2 実ブラウザ・フォント後・画像の目視      | 全 suite が `document.fonts.ready` 後に計測。round 1〜3 で代表画像を目視                                                                  |
| 3 代表画面の通常 / focus / 編集確定・取消 | `editing` 操作 12 本 / 6 画面（両面）、Grid の Rhai 拒否と下書き保持、`errors` の assert（F2）                                            |
| 4 日本語・英数字・空・長文、欠け・重なり  | `roles` の形の集計、幅境界 fixture の両側（F2）、`matrix` の枠外描画 0（独立 runtime）                                                    |
| 5 幅・拡大・DPR、実ズームとの区別         | `matrix` 168 ケース（195/390/720/1440・DPR 1/2・拡大 100/200%）。実ズームは headless 不可として台帳で別記録                               |
| 6 テーマ切替・再描画・編集中の focus      | `lifecycle` 11 ケース、journey 2 本 × 6 段、合成 composition（実 IME は限界として記録）                                                   |
| 7 回帰・build・check                      | 最終 gate 14 手順                                                                                                                         |

### 5. セキュリティ

round 1・2 から変化なし。F6 の差分は文書・コメント・証跡へ書く文字列だけ。`package.json` / lockfile / `engine/` / `public/` は
`main` から不変。`src/` は秘密情報・外部入力の評価・新しい依存なし。検査スクリプトは `shell: true` を使わず、
所有サーバーは 127.0.0.1 に限定。

## 残留リスク（修正しない・台帳の限界表と同じ）

1. ホストの `* { font: inherit }` が SVG sprite の `font-size` 属性より強く効く（検査は属性値を読むので検出しない。`main` から同じ）。
2. ホストが `canvas` に `max-width` 等を指定すると bitmap が縮む（検査は `canvas.style.width` を読む。`main` から同じ）。
3. figure / document の文字は DPR 2・拡大・dark で測っていない。9px の役割と Grid 編集オーバーレイも 1 条件のみ。
4. ブラウザの最小フォントサイズ設定の影響（9px の `meta`）は未計測。
5. ホストの `span { font-size }` は `.ui-row span` / `.ui-grid-header span` に届く（F4 の範囲外・`main` から同じ）。
6. 実 IME・実ブラウザズーム・`--browser-endpoint` の実接続は未実施（代用と限界は台帳に記録）。
7. CLI を手で使う場合のみ: runner のサーバー起動失敗時に `bunx vp dev` の process group が残る、`--evidence` に repo 外のパスを渡せる。

## 字句の残留（差し戻さない）

- 台帳 T3 節の drag ghost の参照 `src/canvas-renderer.js:883-921` は、実際のブロックは 885〜923 行（`const drag = …` から
  `ctx.restore()` と閉じ括弧まで）。2 行のずれ（F6 自身のコメント修正で 2 行増えた）で、主張（ghost は card の分岐と別のブロック、
  `caption` 600 + `label` の 2 件）は正しい。同じ文の **`paintKanban` という関数は `src/` に存在しない**。ghost を描くのは
  `paint()` の末尾（`const drag = this.kanban.drag;` 以降）。
- 台帳 T9 節「（この節を直したコメント修正でも変わりました）」は誤り。バンドルはコメントを落とすので、F6 のコメント修正で
  `runtime-dist/index.js` の sha256 は変わっていない（verify 実測 `ba581f54…`、PLAN F6 (A)1 が F6 前の値として挙げたものと同じ。
  PLAN の前提「コメント修正でも変わる」自体が誤りだった）。「値を台帳に写さない」という方針と `builds` を指す記述は正しいまま。
- 台帳冒頭の章立て順「… → F4 → まとめ」の後に「実行環境（T1 で確定）」の節が続く（列挙から抜けている）。
- 台帳 T4 節・T8 節の「light / dark × desktop / 390px × 拡大 100 / 200% の 6 段」は格子に読めるが、journey は 6 段の経路
  （light は開始の desktop 100% だけ、390px と 200% は dark で測る）。「6 段」の件数は正しい。
- 台帳 F3 節「CSS 箱が既定幅 240px になる」の 240 は CSS ではなく `src/runtime.js` のレイアウトの下限 `Math.max(240, clientWidth)`。
- `tests/browser/font-parity.mjs` の ghost の対応付けコメント「whichever card or lane」は、実測では `empty` / `kanban-lane` へ
  帰属するので「下にある kind」が正確（コメントのみ、判定は無関係）。

いずれも受け入れ基準の達成や検査の範囲を誤って伝えるものではないため、PLAN「verify round 2 の記録」の round 3 の方針どおり
差し戻さず、ここに残す。

## マージ結果

対象リポジトリに `origin` は無い（ローカルのみ）ため、`main` へ `git merge --no-ff gsd-lite/renderer-font-size-parity` で
マージする。`git log HEAD..main` は空（`main` に取り込み漏れのコミットなし）。結果はこの節の末尾に追記する。
