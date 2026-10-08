# 画面合成（コンポーネント）

状態: 実装済み契約（段階3）。方式の選定理由・却下案・段階計画は[部品化の計画・検討](components-plan.md)にあるが、現行仕様の根拠は本文書とコードとする。

画面パッケージは別の画面パッケージを埋め込める。埋め込まれた側はエンジン内で独立したInstance（自分のRhaiエンジン・AST・state・確定UIツリー）になり、Sceneは1つ、確定は1トランザクション。単体の画面の契約は[画面契約](screen-format.md)、Instanceと確定の流れは[アーキテクチャ](architecture.md)を参照。

## 用語

- **コンポーネント**: 親の`components`で宣言し、`xtype`に宣言名を書いて埋め込む別の画面パッケージ。1つの配置が1つのInstance。同じパッケージを2か所に置けばInstanceは2つ。
- **ウィジェット（組み込み部品）**: エンジンが持つ48種の`xtype`（`container`・`grid`・`button`など）。本リポジトリで「部品」と呼ぶのはこちらで、追加は[部品開発ガイド](component-development.md)。
- **componentノード**: `xtype`が宣言名のノード。自分の`items`を持たず、その矩形に子Instanceの確定UIツリーが入る。
- **接頭辞付きitemId**: `"<componentノードのitemId>/<子の中のitemId>"`。Instanceの識別パス、Sceneの`key`、イベントの`target`に共通で使う。rootのパスは空文字列。

## 宣言`components`

トップレベルの任意の`components`は宣言名から`{ "url": ... }`への対応表。エントリは`url`のみで、他のキーは読み込みエラー。

- 宣言名はASCII英数字1–40文字で先頭は英字（`^[A-Za-z][A-Za-z0-9]{0,39}$`）。外れると`Component name {name} requires 1–40 ASCII letters or digits starting with a letter`。
- 組み込みxtypeと衝突してはならない。`XTYPES`の48種だけでなく、正規化が別のxtypeやポートへ書き換える別名（`form`・`combo`・`gridpanel`・`box`・`tbar`・`imagecomponent`・`msgbox`・`code`・`codeeditor`など）も予約。衝突すると`Component name {name} collides with a built-in xtype`。
- `url`は1–2048バイト。外れると`Component {name} needs a URL of at most 2048 bytes`。
- `url`は**宣言した画面のURL基準**で相対解決する。子が宣言する孫のURLは、その子自身のURL基準。解決後の絶対URLが同じパッケージは1回だけ取得して共有する。

```json
"components": { "orderList": { "url": "parts/order-list.json" } }
```

実例は`public/screens/order-dashboard.json` / `.rhai`（親）と`public/screens/parts/order-list.json` / `.rhai`（子）。

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

## 制限

Instanceごとの既存上限はそのまま。1画面分の予算を部品が食い潰さないので、既存画面を無改修で部品にできる。

| 対象                      | 上限                                 |
| ------------------------- | ------------------------------------ |
| Instance数                | 8（rootを含む）                      |
| 入れ子の深さ              | 3（rootが1段目）                     |
| UIノード / 階層           | Instanceごとに200ノード / 20階層     |
| スクリプト                | Instanceごとに100 KB                 |
| state                     | InstanceごとにJSONシリアライズ後1 MB |
| ABIの1リクエスト          | 2 MB（子を同梱した合計。据え置き）   |
| ABIの`components`エントリ | 8パッケージ                          |

- 超過時のエラーは`At most 8 instances per screen (root included); exceeded at component {path}`、`Component {path}: nesting depth exceeds 3`、`UI exceeds 200 nodes or 20 nesting levels`、`Script exceeds 100 KB`、`State exceeds 1 MB`、`Request exceeds 2 MB`、`At most 8 component packages`。
- Instance数と同梱パッケージ数は別物。同じURLの子は1回だけ同梱され、置いた回数だけInstanceになる。
- 2MBはJS側とRust側の2段構え。JS側は子を同梱した後のバイト数を数え、超えたら`リクエストが2 MBを超えています（同梱後 {総バイト数} バイト。最大の子: {URL} {バイト数} バイト）`で、どの子が大きいかまで出す。Rust側は入力長だけを見て`Request exceeds 2 MB`を返す。Instance数・入れ子の深さ・循環参照も同じ2段構えで、JS側は取得中に日本語（`コンポーネントの数が8を超えています（rootを含む）: {URL}`、`コンポーネントの入れ子が3段を超えています: {URL}`、`コンポーネント {名前} の循環参照: {URL}`）、Rust側はload時に英語（上記と`Component {path}: circular reference to {url}`）で拒否する。
- `itemId`は`/`を予約する。componentノードでも通常のウィジェットでも使えない。接頭辞付きパスとの区別がつかなくなるため。
- 宣言していないxtypeを置いた、または同梱されていないURLを宣言したときは`Component {path}: {xtype} is not declared`、`Component {path}: package {url} was not bundled`。
- JSローダーは**宣言単位**で循環・深さを検査し、uiに置かれていない宣言も取得・検査する。Rustは**配置単位**で検査する。したがってraw ABIでは通る「置かれていない自己参照の宣言」は、ローダーでは拒否される。

## 拒否

段階3の子は同期処理だけを行う。非同期効果と画面全体に関わる宣言は拒否する。

**効果関数19個**。`alert`・`confirm`・`file_list`・`file_mkdir`・`file_read_bytes`・`file_read_text`・`file_remove`・`file_stat`・`file_write_bytes`・`file_write_text`・`host_call`・`host_cancel`・`http_get`・`navigate`・`prompt`・`rpc_call`・`storage_read`・`storage_remove`・`storage_write`。

拒否は2段。

1. load時の`AST::walk`走査。スクリプトのどこか（クロージャの中を含む）にこれらの名前の呼び出しがあれば、`{name} is not available in components (line {行}, position {桁})`でコンパイル直後に落とす。
2. 実行時のstub。子のエンジンには本物の登録をせず、全呼び出し形を受けて`{name} is not available in components`を返すstubを登録する。

**拒否の根拠は実行時である**。1は早く分かりやすいエラーを出すための先回りにすぎない。`Fn("navigate")`のように文字列から関数ポインタを作る呼び出しはload時の走査では拾えず、stubが呼ばれて初めて拒否される。走査だけを根拠にしてはならない。

**子の宣言7種**。`requests`・`operations`・`storage`・`files`・`rpc`・`pages`・`webmcp`のいずれかを持つ子は`requests, operations, storage, files, rpc, pages and webmcp are not available in components (reserved for a later stage)`。

**子uiの`window`**。`window is not available in components (reserved for a later stage)`。画面全体のモーダル層とフォーカスはrootのもの。正規化が`window`へ書き換える`messagebox` / `msgbox`も同じエラーで拒否される。判定はload時に解決済みUIツリーへ掛けるので、`visibleBind`などで条件付きに現れるwindowも通らない。

**配信キャッシュ**。`components`を宣言する画面は`network-first`で取得できず、保存版からの復元もできない。`componentsを持つ画面は配信キャッシュ（network-first）に対応していません`。マニフェストが1パッケージ1本のため。

**エディタの「変更を適用」**。直前の`load`で取得した子をそのまま再利用する。編集した定義の宣言URLが、再利用できる子のURLと一致しなければ`コンポーネント {名前} の本体がありません（URLから読み込んでください）`。子を差し替えたいときは「URLから読み込む」で取り直す。

## stateSchema

`stateSchema`で`additionalProperties: false`を使う子は、`properties`に`config`を含めること。親から渡した`config`は子のstateの最上位キーとして注入され、スキーマ検証はload時のstateにも各commitの候補stateにも掛かるので、含めなければ`stateSchema state.config: additional property is not allowed`で落ちる。`config`を宣言しない（`additionalProperties`が既定のまま）子はそのままでよい。

## ExtJSとの違い

- **bubblingは無い**。emitは置いた親のcomponentノードの`listeners`にしか届かない。親がさらに上へ知らせるには、親自身が`emit`を呼ぶ。componentノードを飛び越して祖先が受け取ることはない。
- **handlerの`false`戻り値に意味は無い**。handlerはstateオブジェクトを返す契約で、`false`を返せば`Handler must return a state object`。伝播や既定動作を止める手段としては使えない。
- **`scope`は無い**。`listeners`は「emit名→同じパッケージ内の関数名」の対応表だけ。実行文脈を差し替える指定は持たない。

## 実装上の注意

load時の走査はrhaiの`internals` featureで公開される`AST::walk`と`Expr` / `Stmt`を使う。このAPIに安定性の約束は無いため、`engine/Cargo.toml`のrhaiはバージョンを固定したままにする。

## 段階4以降の課題

- 子の非同期効果。effectと`*_result` opに`instance`を持たせ、完了を正しいInstanceへ返す。storage / filesのscope区切り文字も同時に決める。
- 子の`window`。画面全体のモーダル層を親子で共有する方式。
- 配信キャッシュ。子を含む画面のマニフェストと`network-first` / 復元。
- WebMCPの合成。子の`webmcp`を画面1登録へまとめる方式。子ノードの`webmcp`は検証されるが登録されない（段階6）。
- `with_clock`は`ExtensionContext`を画面で1つ共有する前提に乗っている。rootから入った時計が子にも効くのはこの共有によるので、Instanceごとの文脈へ分ける変更は入れない。
- 計画で置いたemitの連鎖深さ上限4は、入れ子の深さが3の木では使われない。最も深い子からrootまでが2段で、そこで打ち切られる。深さを広げるときに改めて考える。

## 検証

合成の挙動は、合成の無いビルドとは応答照合できない。証跡ファイルは`target/engine-compare/composition.json`。検査の手順と、どの変異が検出されるべきかは[検証基準](testing.md)を参照する。
