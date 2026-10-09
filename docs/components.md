# 画面合成（コンポーネント）

状態: 実装済み契約（段階5）。方式の選定理由・却下案・段階計画は[部品化の計画・検討](components-plan.md)にあるが、現行仕様の根拠は本文書とコードとする。

画面パッケージは別の画面パッケージを埋め込める。埋め込まれた側はエンジン内で独立したInstance（自分のRhaiエンジン・AST・state・確定UIツリー）になり、Sceneは1つ、確定は1トランザクション。単体の画面の契約は[画面契約](screen-format.md)、Instanceと確定の流れは[アーキテクチャ](architecture.md)を参照。

## 用語

- **コンポーネント**: 親の`components`で宣言し、`xtype`に宣言名を書いて埋め込む別の画面パッケージ。1つの配置が1つのInstance。同じパッケージを2か所に置けばInstanceは2つ。
- **ウィジェット（組み込み部品）**: エンジンが持つ48種の`xtype`（`container`・`grid`・`button`など）。本リポジトリで「部品」と呼ぶのはこちらで、追加は[部品開発ガイド](component-development.md)。
- **componentノード**: `xtype`が宣言名のノード。自分の`items`を持たず、その矩形に子Instanceの確定UIツリーが入る。
- **接頭辞付きitemId**: `"<componentノードのitemId>/<子の中のitemId>"`。Instanceの識別パス、Sceneの`key`、イベントの`target`、効果と完了の`instance`に共通で使う。rootのパスは空文字列。

## 宣言`components`

トップレベルの任意の`components`は宣言名から`{ "url": ... }`への対応表。エントリは`url`のみで、他のキーは読み込みエラー。

- 宣言名はASCII英数字1–40文字で先頭は英字（`^[A-Za-z][A-Za-z0-9]{0,39}$`）。外れると`Component name {name} requires 1–40 ASCII letters or digits starting with a letter`。
- 組み込みxtypeと衝突してはならない。`XTYPES`の48種だけでなく、正規化が別のxtypeやポートへ書き換える別名（`form`・`combo`・`gridpanel`・`box`・`tbar`・`imagecomponent`・`msgbox`・`code`・`codeeditor`など）も予約。衝突すると`Component name {name} collides with a built-in xtype`。
- `url`は1–2048バイト。外れると`Component {name} needs a URL of at most 2048 bytes`。
- `url`は**宣言した画面のURL基準**で相対解決する。子が宣言する孫のURLは、その子自身のURL基準。解決後の絶対URLが同じパッケージは1回だけ取得して共有する。

```json
"components": { "orderList": { "url": "parts/order-list.json" } }
```

実例は2つある。

- `public/screens/order-dashboard.json` / `.rhai`（親）と`public/screens/parts/order-list.json` / `.rhai`（子）。同じ子を2か所に置いて接頭辞で区別する最小の形。
- `public/screens/parts-lab.json` / `.rhai`（親。`components`のキーは`products`→`http-grid.json`、`note`→`parts/note-pad.json`、`approval`→`parts/approval.json`）と、`public/screens/parts/note-pad.json` / `.rhai`（自分の`storage`で保存し`emit("saved", …)`する子）、`public/screens/parts/approval.json` / `.rhai`（自分で`confirm`を出し`emit("answered", …)`する子）。子が自分で効果を出す形はこちら。

## componentノードの許可属性

componentノードに書けるのは`xtype`・`itemId`・`config`・`listeners`・`flex`・`width`の6属性と`visibleBind`。他を書くと`Component {itemId}: attribute {key} is not supported (only xtype, itemId, config, listeners, flex, width and visibleBind)`。

- `itemId`は必須。無いと`Component {xtype} requires itemId`。`/`と`:`は使えない（`itemId must not contain '/' (reserved for component paths)`）。
- 置けるのは`container`・`panel`・`fieldset`・`window`の`items`だけ。それ以外は`Component {xtype}: components are supported only in the items of a container, panel, fieldset or window`。`toolbar` / `menu` / `tabpanel`直下、`tbar` / `bbar` / `buttons` / `menu`の中、`columns[].editor`の中は同じエラーで拒否する。
- `flex`と`width`は親レイアウトでの配置に使う。子の高さは子の確定UIツリーを測って親レイアウトへ返すので、親のvbox / hboxに自然に積める。
- `visibleBind`は親が子に対して持てる唯一のbindで、親stateの最上位キーのみ（`Component {itemId}: visibleBind must be a top-level state key`）。**キーが`true`のときだけ**配置・測定し、偽のときは高さ0で描かずイベントも届かない。未指定なら常に配置する。
- `layout: accordion`の親の`items`に置いたcomponentノードは折りたたみの対象にならない。accordionには置かない。

## `config`

`config`はオブジェクト（`Component {itemId}: config must be an object`）。値は2種類だけ。

- 固定値。そのまま子へ渡す。
- `{ "bind": "<親stateの最上位キー>" }`。そのキーの値を渡す。キーが空またはドットを含むと`Component {itemId}: config {key} must bind a non-empty top-level state key`、親stateに無いと`Component {path}: config bind {key} is not in the parent state`。`bind`1キーだけのオブジェクトがこの形で、キー数が違えば固定値として扱う。

解決した`config`は子の`state.config`へ注入される。`stateSchema`の検証より前に注入されるので、子は`config`を自分のstateの一部として扱える。

子は任意で`config(state, event)`handlerを持てる。`event`は`#{ config: <解決後のconfig> }`で、`state.config`も呼び出し前に新しい値へ差し替わっている。戻り値はstateオブジェクト。

呼び出し時機は2つに分かれる。

- **load時は呼ばない**。`config`を`state.config`へ入れてから`init(state)`が走る。子は`init`で`state.config`を読む。
- **差分があるときだけ呼ぶ**。トランザクション中、親の候補stateで解決した`config`が確定stateで解決した`config`と等しければ何もしない。異なるときだけ注入して`config`handlerを呼ぶ。handlerが無ければ注入だけ。

## `emit`と`listeners`

子のhandlerは`emit(name, payload)`で親へ知らせる。`payload`はJSONへ直せる値（できないと`emit {name}: payload must be JSON-serializable`）。

親はcomponentノードの`listeners`で、emit名から自分のhandler名へ対応付ける。handlerは`handler(state, event)`で、`event`のキーは3つだけ。

| キー     | 値                                              |
| -------- | ----------------------------------------------- |
| `target` | emitしたcomponentノードの`itemId`（接頭辞なし） |
| `action` | emit名                                          |
| `value`  | `payload`                                       |

- `listeners`に無いemitは**無視する**。エラーにしない。子は知らせるだけで、どれが自分に関係するかは親が決める。
- `listeners`が指すhandlerは親パッケージに定義されていること。無いと`{itemId}: listener {event} references undefined handler: {handler}`。
- 1handlerあたり8件まで。9件目で`At most 8 emits per handler`。
- `init`中は禁止。`emit is only available in event handlers, not init`。
- `config`handler中は禁止。`Component {path}: emit is not available in config`。configの反映は下方向の連鎖で、答えるべきイベントが無い。
- rootのエンジンに`emit`は登録しない。root画面のスクリプトでは未定義の関数。

## トランザクション順序

1イベントで動くのは次の順序。

1. 対象Instanceのhandlerを実行し、候補stateを得る（確定はしない）。
2. そのInstanceの`emit`キューを取り出す。
3. 親のcomponentノードの`listeners`を引き、該当するhandlerを候補stateに対して順に呼ぶ。親がさらにemitしていれば同じことをその親に対して繰り返し、rootで終わる。
4. 候補stateが動いた各Instanceについて、保持するcomponentノードの`config`を再解決し、差分がある子だけ`reconfigure`する。その子の`config`handlerが自分の子の`config`を動かせば、さらに下へ続く。
5. root→子（パス順）の全候補を検証する。state→UIツリーの再解決、handler存在、組み込みの状態制約、`stateSchema`、1 MB上限。
6. 親（root）をapplyし、rootのeffectをcommitする。
7. 子をパス順にapplyする。
8. `revision`を1つ進める。

`revision`は動いたInstanceの数に関係なく**1つだけ**進む。検証のどこかで失敗すれば親子ともapplyせず、`revision`も動かない（「失敗したら何も変わらない」が画面全体で成り立つ）。applyは失敗しない処理だけを残してあるので、1つでも動き始めたら途中で止まることはない。

失敗したイベントで子が積んだ`emit`は捨てられ、次のイベントや完了処理（`http_result`等）に持ち越さない。

emitは**上方向のみ**、configは**下方向のみ**に連鎖する。emitの歩みはrootで終わり、rootは`emit`を持たない。configの歩みは各Instanceを1度しか訪れず、`config`handlerからのemitは拒否される。したがって親子のピンポンは構造的に起きない。

## Sceneとeventの接頭辞

子の確定UIツリーは、子自身が画面rootであるかのように配置してから、生成したwidgetの`key`と（空でない）`target`の先頭へ`"<componentノードのitemId>/"`を付ける。入れ子では段ごとに1つ前置されるので、`"outer/inner/field"`のようになる。同じパッケージを2か所に置いても、接頭辞だけが2つの配置を区別する。

イベントの`target`は`/`で分けて辿る。先頭の要素は現在のInstanceのcomponentノードでなければならず（違えば`Unknown itemId: {target}`）、その子Instanceへ降りて残りを同じように解く。末尾の要素が最終的なInstance内のitemId。

途中のcomponentノードが`visibleBind`で隠れている、または親の無効・折りたたみ・非表示タブ・モーダル背後に入っている場合、イベントは**捨てる**。stateも`revision`も動かない。

## 効果

子は非同期効果を自分で出せる。効果関数（`alert`・`confirm`・`file_list`・`file_mkdir`・`file_read_bytes`・`file_read_text`・`file_remove`・`file_stat`・`file_write_bytes`・`file_write_text`・`host_call`・`host_cancel`・`http_get`・`navigate`・`prompt`・`rpc_call`・`storage_read`・`storage_remove`・`storage_write`）はすべてrootと同じに子でも使え、バイト列を作る純粋なコンストラクタの`file_bytes`（効果を積まない）も子で使える。

トップレベルの効果宣言のうち`requests` / `operations` / `storage` / `files` / `rpc` / `pages`の6種は子でも宣言できる。残る`webmcp`だけが据え置き。

### effectの形

- 全kindが`kind`キーを持つ。`http`・`storage`・`file`・`rpc`・`dialog`・`navigate`・`host`・`host_cancel`のどれも`kind`で振り分ける。
- **子のeffectには`instance: "<接頭辞付きitemId>"`が付く。rootのeffectには`instance`キーが無い**。hostはこのキーだけを見て、完了をどのInstanceへ返すかを決める。
- JSONのキー順はアルファベット順（`serde_json`の`BTreeMap`由来）。キー順に依存した読み方をしてはならない。

### 連結順

`take_effects`が返す配列は2段に並ぶ。

1. rootの7連結。`http` → `storage` → `files` → `rpc` → `dialogs` → `pages` → `host`。
2. 続いて子を**パス順**（`BTreeMap`のキー順）に、各Instanceごとに`http` → `storage` → `files` → `rpc` → `host`。

dialogs / pagesのキューは画面で1本なのでrootの位置に並び、子が出したものもそこに`instance`付きで出る。

### 完了opの`instance`

`http_result` / `storage_result` / `file_result` / `rpc_result` / `dialog_result` / `host_result` / `host_progress`の7 opが`instance`を受ける。

- **子の完了には必須**。`instance`キーの省略がroot宛という意味になる。
- 受理する形は「1つ以上の空でない要素を`/`で繋いだもの。`:`を含まない」（正規表現なら`^[^/:]+(/[^/:]+)*$`）。rootを空文字列で名乗ることはできず、キーを省略して名乗る。
- 形から外れた値は`Invalid component instance`。形は合うが存在しないパスは`Unknown component instance: {instance}`。
- 長さは256バイト（UTF-8）まで。256バイトを超えるパスは形の検査より先に`Component instance path exceeds 256 bytes`で拒否し、**その値を文言に載せない**。

`dialog_result`も同じ規則で名乗る。ダイアログのスタックは画面のものだが、**どのInstanceのhandlerが走るかは「効果を出したInstance」（リクエスト側）が決める**。hostはeffectに載っていた`instance`をそのまま名乗る契約で、違うInstanceを名乗ると他人のダイアログを食べずに拒否される。

### 完了ハンドラのトランザクション

完了もイベントと同じ1トランザクション。子のhandler → その子のemit → 親のlisteners → configの下方向連鎖 → 全Instanceの検証 → 1 commitで`revision`を1つ進める。どこかで失敗すれば**全Instanceが不変で`revision`も動かない**。

- handlerの失敗は完了を消費する（既存どおり）。同じidで二度目を返しても`Unknown or completed …`になる。ただし`host_progress`は例外で、progressはpendingを消費しないため、progress handlerが失敗しても同じidの`host_progress` / `host_result`はその後も届く。
- 不正な完了（宛先違い・消費済み）はpendingを**不変**のまま残す。別のInstanceを名乗った完了が、名乗られた側の待ちを壊すことはない。

### 相対URLの基準

子の`requests` / `rpc` / `pages` / `operations`の相対URLは、**その子のパッケージURL基準**で解決する。親のURL基準ではない。同じ子をURLの違う2つの親へ置いても、子の相対URLの意味は変わらない。

### ABIの`descriptors`

`load`の`components[url]`には任意の`descriptors`（`{名前: bufferId}`）を置ける。これが子のRPC descriptorになる。検査はrootの`descriptors`と同じで、objectでなければ`Invalid descriptors`、9件以上は`At most 8 descriptors`、idが不正なら`Invalid descriptor buffer`。

## 保存領域のscope

Instanceの保存領域scopeは「`<rootパッケージのid>`に、パスの`/`を`__`へ置き換えたものを`__`で繋いだもの」。root自身はidそのまま。storage / filesの保存先はこのscopeで分かれる。

- **各要素に`__`を含めてはならない**。含めると2つの配置が同じscopeを組めてしまう。
- 各要素と連結後のscopeが`[A-Za-z0-9_-]`のみ。連結後は80バイト以内。
- 同じ子を2か所に置けば`host__a`と`host__b`のように別scopeになる。片方の保存が他方に見えることはない。

**RustとJSの2段**で検査する。

- Rustはload時に検証だけを行う。外れると`Component {path}: storage scope {scope} requires 1–80 ASCII letters, digits, - or _ without "__" in any part`。検証するのは`storage`か`files`を宣言する子だけで、データを持たない子はscope規則の外に置ける`itemId`でもよい。
- JSは実際にscopeを組んでstorage / filesの呼び出しに使う。検査は子を取得する経路で、Rustと同じく`storage`か`files`を宣言する子だけに掛ける。外れたら`コンポーネント {path} の保存領域 {scope} が不正です（英数字・-・_ で80バイト以内、各要素に __ を含めない）`。

scope規則の定義は本節が唯一で、他の文書はここを参照する。

## 据え置きの拒否

子に許していないのは次の3つだけ。

**子の`webmcp`**。`webmcp`を宣言する子は`webmcp is not available in components (reserved for a later stage)`。画面全体のツール面はrootのもの。

**子uiの`window`**。`window is not available in components (reserved for a later stage)`。画面全体のモーダル層とフォーカスはrootのもの。正規化が`window`へ書き換える`messagebox` / `msgbox`も同じエラーで拒否される。判定はload時に解決済みUIツリーへ掛けるので、`visibleBind`などで条件付きに現れるwindowも通らない。

**エディタの「変更を適用」**。直前の`load`で取得した子をそのまま再利用する。編集した定義の宣言URLが、再利用できる子のURLと一致しなければ`コンポーネント {名前} の本体がありません（URLから読み込んでください）`。子を差し替えたいときは「URLから読み込む」で取り直す。

## 子パッケージのメモリ共有

同じ`UiRuntime`（= 同じ`ApplicationLoader`インスタンス）内で、**子だけ**をページ遷移をまたいでメモリに保持する。rootは共有しない。

- 無効化の契機は3つ。(1)`fetch`の`refresh`（「再読込」）、(2)キャッシュ方式（`mode`）が変わった、(3)認証設定（`getAuthentication()`の値）が変わった。どれかで共有マップを丸ごと捨てる。`mode`と認証は**値で比較する**（`getAuthentication`は毎回新しいオブジェクトを返す）。
- `network-first`では、共有している子は**マニフェストが約束するsha256がsource・script・descriptor（キー集合と各sha256）のすべてで一致するときだけ**読み直しの代わりに使う。1つでも違えばその版は別のファイルを配信しているので読み直す。
- `network-only`では比較する相手が無いので、共有している子はそのまま使う。したがって**トークンだけを差し替えた配信は検知しない**。セッション内で子の更新を取り込むには「再読込」（`refresh`）で取り直す。
- 保存版からの復元（`restore`）では共有を一切使わない。全ファイルを読み直すことが壊れた版の検出そのものだから。
- 共有マップに入るのは**検査をすべて通った走査の結果だけ**。途中の中断・拒否では何も入らない。

## エラー文言

合成で増えた文言はここにまとめる。

英語（Rust）。

- `Invalid component instance`
- `Component instance path exceeds 256 bytes`
- `Unknown component instance: {instance}`
- `Component {path}: Unknown or completed {HTTP request|storage request|file request|RPC call|host call|dialog request}`
- `Component {path}: storage scope {scope} requires 1–80 ASCII letters, digits, - or _ without "__" in any part`
- `webmcp is not available in components (reserved for a later stage)`
- `Host operation has no progress handler`

日本語（JS）。

- `コンポーネント {名前} の宣言が不正です（url を文字列で指定してください）`。`components`の宣言の`url`が文字列でないとき、ローダー・`UiRuntime`・生成スクリプト（`scripts/publish-packages.mjs`）が出す。
- `コンポーネント {path} の保存領域 {scope} が不正です（英数字・-・_ で80バイト以内、各要素に __ を含めない）`
- `コンポーネント {instance} の配送先が未登録です`。root由来のeffectだと`{instance}`が空文字になり、文中に空白が2つ並ぶ。
- `マニフェストのコンポーネント情報が不正です`。version 2の子エントリの形・子の件数・子のファイル情報・絶対化後の重複が外れたとき。`components`自体が無い・`null`・配列・object以外のときは`配信マニフェストが不正です`。括弧付きの派生がある。
  - `マニフェストのコンポーネント情報が不正です（マニフェストに無い子: {URL}）`。宣言から辿った子がマニフェストに無い（配信・保存の両方、および`save`のとき）。
  - `マニフェストのコンポーネント情報が不正です（宣言に無い子: {URL}）`。マニフェストにあるのに宣言から辿れない子。
- `配信ファイルの合計が2 MBを超えています（合計 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）`。ローダーと生成スクリプト（`scripts/publish-packages.mjs`。`{URL}`の位置は子キー）が同じ文言を使う。
- `配信ファイルのサイズ・ハッシュが一致しません`。rootのファイルが約束と違うとき。子は`配信ファイルのサイズ・ハッシュが一致しません（{URL}）`で、どのパッケージのファイルが壊れていたかを足した形。
- `通信に失敗し、利用できる保存版もありません`。通信障害で復元へ落ちたのに、どの保存版も使えなかったとき。版を1つでも試せた場合は`通信に失敗し、利用できる保存版もありません（{最後に試した版の失敗文言}）`で、ポインタが1つも無いときは括弧なしの基本形。

`Component {path}: `の前置は失敗したInstanceを名乗るためのもので、rootの失敗には前置が付かない。2 MB・Instance数・入れ子の深さ・循環参照の文言は「制限」節にある。

## 制限

Instanceごとの既存上限はそのまま。1画面分の予算を部品が食い潰さないので、既存画面を無改修で部品にできる。

| 対象                      | 上限                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| Instance数                | 8（rootを含む）                                                                                   |
| 入れ子の深さ              | 3（rootが1段目）                                                                                  |
| UIノード / 階層           | Instanceごとに200ノード / 20階層                                                                  |
| スクリプト                | Instanceごとに100 KB                                                                              |
| state                     | InstanceごとにJSONシリアライズ後1 MB                                                              |
| ABIの1リクエスト          | 2 MB（子を同梱した合計。据え置き。配信はマニフェストの`source.size + script.size`合計で前段拒否） |
| ABIの`components`エントリ | 8パッケージ                                                                                       |
| 完了opの`instance`        | 256バイト（UTF-8。超過は値を文言に載せずに拒否）                                                  |

`instance`の256バイトは完了opの入口だけに掛かる。接頭辞付きのパスが256バイトを超える子は完了を受け取れないので、`itemId`はこの範囲に収める。

効果の上限は所属が2通りに分かれる。

| 対象                           | 上限 | 所属     | 超過時                                                                                                                                                                        |
| ------------------------------ | ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pendingのダイアログ            | 8    | 画面全体 | `At most 8 pending dialogs`                                                                                                                                                   |
| 1トランザクションの遷移        | 1    | 画面全体 | `At most one navigation per handler`                                                                                                                                          |
| 未配送の遷移                   | 8    | 画面全体 | `At most 8 undelivered navigations`                                                                                                                                           |
| pendingの非同期要求            | 8    | Instance | `At most 8 pending HTTP requests` / `At most 8 pending storage requests` / `At most 8 pending file requests` / `At most 8 pending host calls` / `At most 8 pending RPC calls` |
| 1handlerのホスト / RPC呼び出し | 8    | Instance | `At most 8 host calls per handler` / `At most 8 RPC calls per handler`                                                                                                        |
| RPC定義 / descriptor           | 8    | Instance | `At most 8 RPC definitions/descriptors`                                                                                                                                       |
| 同時ホスト操作（JS側）         | 8    | Instance | `同時ホスト操作は8件までです`                                                                                                                                                 |

- **Instanceごとの上限は画面全体では足し合わさる**。pendingの非同期要求は1Instanceで8件までだが、画面はInstance数×8件まで同時に抱えうる。
- `host_cancel`は**同じInstanceが出した操作だけ**を取り消す。他のInstanceの同名操作には届かない。
- 超過時のエラーは`At most 8 instances per screen (root included); exceeded at component {path}`、`Component {path}: nesting depth exceeds 3`、`UI exceeds 200 nodes or 20 nesting levels`、`Script exceeds 100 KB`、`State exceeds 1 MB`、`Request exceeds 2 MB`、`At most 8 component packages`。
- Instance数と同梱パッケージ数は別物。同じURLの子は1回だけ同梱され、置いた回数だけInstanceになる。
- 2MBは3段構え。段ごとに数えるものと文言が違う。

  | 段               | どこ                                     | 何を数えるか                                                                     | 超過時                                                                                                  |
  | ---------------- | ---------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | マニフェスト段階 | `manifest()`（生成スクリプトも同じ合計） | **生バイト**の`source.size + script.size`のroot + 全子の和。descriptorは含めない | `配信ファイルの合計が2 MBを超えています（合計 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）` |
  | 同梱後（JS）     | `load`の直前                             | 子を同梱した**JSON化後**のバイト数                                               | `リクエストが2 MBを超えています（同梱後 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）`       |
  | 入力長（Rust）   | load時                                   | 入力長だけ                                                                       | `Request exceeds 2 MB`                                                                                  |

  **マニフェスト段階は生バイトの粗い前段で、`load`時（JSON化後）が正**。descriptorを合計に含めないのは、`load`のリクエストに入るのがpackageとscriptだけでdescriptorはbuffer ABIを通るため。descriptorには1 MB / 8件 / 16 MBの上限が別にある。「最大の子」も同じ`source.size + script.size`の和で選び、同点はキー順。

- Instance数・入れ子の深さ・循環参照はJS側とRust側の2段で、JS側は取得中に日本語（`コンポーネントの数が8を超えています（rootを含む）: {URL}`、`コンポーネントの入れ子が3段を超えています: {URL}`、`コンポーネント {名前} の循環参照: {URL}`）、Rust側はload時に英語（上記と`Component {path}: circular reference to {url}`）で拒否する。この日本語3文言は生成スクリプト（`scripts/publish-packages.mjs`）も出し、そのとき`{URL}`の位置は絶対ファイルパスになる。
- `itemId`は`/`を予約する。componentノードでも通常のウィジェットでも使えない。接頭辞付きパスとの区別がつかなくなるため。
- 宣言していないxtypeを置いた、または同梱されていないURLを宣言したときは`Component {path}: {xtype} is not declared`、`Component {path}: package {url} was not bundled`。
- JSローダーは**宣言単位**で循環・深さを検査し、uiに置かれていない宣言も取得・検査する。Rustは**配置単位**で検査する。したがってraw ABIでは通る「置かれていない自己参照の宣言」は、ローダーでは拒否される。

## stateSchema

`stateSchema`で`additionalProperties: false`を使う子は、`properties`に`config`を含めること。親から渡した`config`は子のstateの最上位キーとして注入され、スキーマ検証はload時のstateにも各commitの候補stateにも掛かるので、含めなければ`stateSchema state.config: additional property is not allowed`で落ちる。`config`を宣言しない（`additionalProperties`が既定のまま）子はそのままでよい。

## ExtJSとの違い

- **bubblingは無い**。emitは置いた親のcomponentノードの`listeners`にしか届かない。親がさらに上へ知らせるには、親自身が`emit`を呼ぶ。componentノードを飛び越して祖先が受け取ることはない。
- **handlerの`false`戻り値に意味は無い**。handlerはstateオブジェクトを返す契約で、`false`を返せば`Handler must return a state object`。伝播や既定動作を止める手段としては使えない。
- **`scope`は無い**。`listeners`は「emit名→同じパッケージ内の関数名」の対応表だけ。実行文脈を差し替える指定は持たない。

## 段階6以降の課題

- 子の`window`。画面全体のモーダル層を親子で共有する方式。
- WebMCPの合成。子の`webmcp`を画面1登録へまとめる方式。子ノードの`webmcp`は検証されるが登録されない（段階6）。
- `with_clock`は`ExtensionContext`を画面で1つ共有する前提に乗っている。rootから入った時計が子にも効くのはこの共有によるので、Instanceごとの文脈へ分ける変更は入れない。
- 計画で置いたemitの連鎖深さ上限4は、入れ子の深さが3の木では使われない。最も深い子からrootまでが2段で、そこで打ち切られる。深さを広げるときに改めて考える。

## 検証

合成の挙動は、合成の無いビルドとは応答照合できない。証跡ファイルは`target/engine-compare/composition.json`。probe（`scripts/probe-composition.mjs`）は6列・54ステップで、列IDは`order-dashboard` / `child-effect-written-out` / `child-effect-through-a-pointer` / `child-dialog-carries-its-instance` / `child-webmcp-refused` / `parts-lab`。部品ラボの列が効果の`instance`・完了のルーティング・宛先違い / 2 MB / 再load後の遅延完了の拒否を押さえる。検査の手順と、どの変異が検出されるべきかは[検証基準](testing.md)を参照する。
