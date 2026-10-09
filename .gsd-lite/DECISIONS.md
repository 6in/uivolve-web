# DECISIONS — 段階 6: WebMCP の合成

## D1. テーマ: 段階 6（WebMCP の合成）

- 選んだ案: `docs/components-plan.md` 段階計画の残り 1 段である段階 6。
- 却下: 子の `window`（UI 面の変更が大きい）、残留リスクだけの堅牢化マイルストーン（新機能なし）、maintenance-plan の整理候補。
- 併せて、前回 VERIFICATION の残留リスク 3・5（`TypeError` 2 件）を最初のテストタスクに含める（直近の振り返りの提案。前回 T1 が最短ターンで片付いた形を踏襲）。

## D2. 子パッケージ直下の webmcp: 受け入れて instance 別に一覧公開

- 選んだ案: 拒否を無くし、`ui_get_screen.components: [{instance, id, title, webmcp}]` で部品単位に並べる。`screen.webmcp` は root のまま。
- 却下: root の `webmcp` へ合成（tags の和集合。どの子の情報かが失われる）、検証のみで公開しない（受け入れる意味が薄い）、拒否のまま据え置き（段階 6 の課題が残る）。

## D3. 子 Instance の state は WebMCP から読めない（据え置き）

- 選んだ案: `ui_get_state` は root state のまま。AI は子の値を接頭辞付き key の `widgets[].value` で見る。ABI 変更なし。
- 却下: `instance` 引数と Instance の state を返す ABI 経路の追加（ABI / runtime の変更が増える。設計決定「親は子 state を見ない」とも別軸の話になる）。必要になれば次段で扱う。

## D4. 堅牢性の受け入れ基準を入れる

- plan が初回タスクに含め、verify は差し戻し対象にする。

## D5. 受け入れ確認は自動テスト + probe 照合

- 選んだ案: Vitest と `scripts/probe-composition.mjs` の列更新（`child-webmcp-refused` → 受け入れ列）、`target/engine-compare/composition.json` の再生成。
- 却下: WebMCP 有効 Chromium での実機確認（環境準備が要り、無人ループで不安定）。

## D6. 非表示の子も `components[]` に `hidden: true` で出す

- 選んだ案: load 済みの全 Instance を一覧し、親の `visibleBind` が false のものに `hidden: true`。AI が「あるが今は操作できない部品」を知れる。
- 却下: 表示中の子だけ（存在が分からない）、全部出すがフラグ無し（widgets の有無で推測させる）。

## D7. `widgets[].instance` は足さない

- 選んだ案: 既存契約どおり key の接頭辞だけで所属を表す。`components[].instance` との突き合わせ規則を `docs/webmcp.md` に書く。
- 却下: `widgets[].instance` の追加（応答が増える。接頭辞で一意に決まる）。

## D8. デモの子パッケージ 3 つに webmcp を足す

- 選んだ案: parts-lab（note-pad / approval）と order-dashboard（order-list）の子に足し、マニフェストを再生成する。
- 却下: parts-lab だけ、テスト fixture だけ（公開デモで合成が見えない）。

## D9. 前回残留リスク 1・10 を含める（R0b / R0c）

- 選んだ案: 宣言件数上限（8 件）と `manifest()` の基準統一をローダー側の小タスクとして R0 の後に置く。
- 却下: 含めない（次回以降への持ち越し）。残留 2 / 4 / 6 / 7 / 8 / 9 は文書化済みの仕様・設計なので触らない。
- 用語の確認: 当初の回答で「含めない」と 1 / 10 が同時に選ばれたため再確認し、「両方含める」で確定。

## D10. 実行パターン: すべて Claude（現状維持）、subagents = auto、reflect = true

- engine=claude, phase_engines={}。model は research / plan / verify / reflect = claude-fable-5-1、impl = claude-opus-5（前 5 マイルストーンと同じ）。
- research.targets = local_projects / official_docs / similar_oss。
- 却下: impl だけ Codex、verify だけ Codex（Codex sandbox の検証で止まるリスク、別モデルの目は今回は不要）。
