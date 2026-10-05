# 🧩 モックから「動く画面」へ！uivolveをRust/WASMで育ててみた

🎮 **まずは触ってみよう！ [GitHub Pagesの公開デモ](https://6in.github.io/uivolve-web/pages/hello-world/)**

インストール不要で、ブラウザから試せます。Hello Worldで名前を入力して挨拶ボタンを押したり、サンプル一覧から別の画面を選んだりしながら、この記事を読んでみてください。✨

![受注管理サンプルのDOM版とCanvas版。件数・合計金額、受注一覧、選択した受注の編集欄が並ぶ画面](./orders.png)

こちらは受注管理サンプル。集計カード、検索、一覧、編集欄を組み合わせた、業務画面の雰囲気です。左がDOM、右がCanvasで、どちらから操作しても同じ状態を表示します。[受注管理を試す](https://6in.github.io/uivolve-web/pages/orders/)から開けます。🧾

### 🧰 どんなことができる？

今の機能をざっくり並べると、こんな感じです。詳しい使い方は[READMEの機能一覧](https://github.com/6in/uivolve-web/blob/main/README.md)からたどれます。

| 分野 | 試せること |
| --- | --- |
| 画面づくり | JSON/YAML＋Rhai、画面遷移、動的タブ、テーマ切替、DOM/Canvas表示 |
| 入力・操作 | テキスト・数値・日付、チェック・ラジオ・選択、スライダー、ダイアログ、KANBAN |
| 一覧・配置 | Gridの検索・ソート・編集、ツリー・メニュー、パネル・ウィンドウ、各種レイアウト |
| 表現 | Markdown、コード・差分、チャート・図、会話・ログ、画像・動画・iframeなどの基本機能 |
| 通信・保存 | HTTP・JWT、IndexedDB・OPFS、ファイル転送、ProtobufのUnary RPC、WebMCP |

部品の対応範囲は[移植対応表](https://github.com/6in/uivolve-web/blob/main/docs/uivolve-port.md)と[ギャラリーの契約](https://github.com/6in/uivolve-web/blob/main/docs/uivolve-gallery.md)へ。編集部品やチャートなどは、まず基本機能を試せる段階です。🎨

**Web Workerへの拡張**では、別スレッドにモックAPIを置き、JSON/YAMLで定義したデータを一覧取得・登録・更新・削除できます。サーバーを用意する前に画面を動かし、後で接続をHTTPへ切り替える使い方です。[WorkerモックAPI](https://github.com/6in/uivolve-web/blob/main/docs/worker-mock-api.md)で構成を紹介しています。⚙️

**AI向けスキル**もあります。[app-dev](https://github.com/6in/uivolve-web/blob/main/skills/uivolve-web-app-dev/SKILL.md)は画面とRhaiでアプリを作るため、[engine-dev](https://github.com/6in/uivolve-web/blob/main/skills/uivolve-web-engine-dev/SKILL.md)はRust/WASMや部品・ホストを拡張するための案内です。[配布・利用方法](https://github.com/6in/uivolve-web/blob/main/docs/skills.md)も用意しています。開発工程を進めるgsd-liteのdiscuss／research／plan／impl／verify／reflectについては、後半で振り返ります。🤖

「画面のモックを作ったら、その定義を使って、実際の動きまで確かめたい！」

uivolve-webは、そんな方向へ進んだWeb向けUIエンジンの試作です。画面をJSONやYAMLで書き、ボタンを押したときの処理はRhaiへ。Rust/WASMが状態と配置をまとめ、DOMとCanvasの両方へ表示します。🦀✨

今回は、その仕組みと開発の歩みを振り返ります。まずは元のuivolveが目指していたことから。ここが分かると、Hello World、WebMCP、仮のサーバー、AIによる開発が、一つの話としてつながります。さっそく見ていきましょう！🚀

## 🌱 出発点：uivolveは「モックを作って終わり」にしない

元の[uivolve](https://github.com/6in/uivolve/blob/3d22a3cfab5488afe3c60f8775676a85c51593ec/README.md)は、React製の画面モックアップライブラリです。ExtJSの宣言的なconfigの書き方を取り入れ、部品と配置をDSLで記述します。入力欄や一覧、ボタンを定義して、画面の形を素早く確かめるための道具です。🧩

その狙いは、**モックを素早く作り、そのDSLをAIへ渡して、任意のUIライブラリで本実装につなげること**。ここが大事です。見た目を決める作業と、コードを書く作業の間に、読み取れる画面定義を置きます。

たとえば受注画面なら、「一覧が中央、検索が上、保存ボタンが右」と書けます。`itemId`で部品を識別し、`handler`の名前で操作の動線も残せます。元のモックではhandlerを宣言し、AIへの引き渡しに使います。処理を実行するコードは、次の本実装へつなぐ役割です。✍️

Playgroundの「AI用にコピー」には、DSLと一緒に使用部品のリファレンスも入ります。人がプレビューで確認した画面を、部品の意味を添えてAIへ渡せる仕組みです。独自の部品でも説明を付けられるので、画面の意図を引き継ぎやすくなります。🤝

もう一つの柱が、**Markdownの仕様書と、画面モックを同じソースで管理すること**。Markdown/MDXの中にuivolveのコードフェンスを書くと、その場所にモックを表示できます。説明文と画面が隣にあり、定義を変えればプレビューにも反映される。仕様を読む人、画面を確認する人、実装するAIが、同じ材料を見られる構成です。📄🎨

この考えをWeb向けに広げたのが、今回のuivolve-webです。画面定義にstateとRhaiの処理を組み合わせ、入力、ボタン、通信、保存まで動かします。元の「モック→AIへ引き渡す」という流れに対し、こちらでは**定義した画面の振る舞いを共通エンジンで試す**ところを掘り下げました。🎮

両者のつながりは、部品名だけではありません。画面の意図を宣言として残し、確認できる形にする発想を引き継いでいます。元のReact実装をそのままWASMへ載せたわけではなく、部品・状態・イベント・描画の分担を組み直した試作です。

なお、ここまでの実装はuivolve/ExtJSの完全互換ではありません。元のMarkdown統合やAI用コピーを、こちらへそのまま移植したわけでもありません。今回追うのは、その出発点から生まれた「動く画面」の仕組みです。🔍

## 🦀 共通エンジン：画面の中身を一か所に集める

**WASMエンジンは、開いたブラウザの中で動いています。** 同じブラウザ内にJSホストとDOM／Canvasの描画部分があり、エンジンを中心に操作と表示が循環します。JSON/YAMLが「どんな部品を置くか」、Rhaiが「操作でどう状態を変えるか」を担当します。画面を追加するために、毎回Rustを書き直す必要はありません。📦

画面定義とRhaiはJSホストがHTTPで取得します。YAMLをJSON相当へ変換し、共通エンジンへ渡すところまでがホストの仕事です。エンジンは定義を検証し、RhaiをASTへコンパイルしてイベントごとに実行します。画面用のRhaiから、新しいWASMバイナリを作る方式ではありません。

ここで、状態と描画の間に**Scene**を置きます。`layout(width)`へ表示幅を渡すと、部品の座標、寸法、表示値などが返ります。その結果を、DOMレンダラーとCanvasレンダラーが受け取ります。🎨

![ブラウザ内のWASMエンジンとJSホスト、DOMとCanvasの間で操作と描画更新が循環する構造](./architecture.png)

たとえば「挨拶する」ボタンなら、次の順で動きます。🔄

1. DOM／CanvasでのクリックをJSが受け取り、WASMへイベントを渡す。
2. WASM内でRhaiのhandlerを実行し、挨拶の文字列をstateへ確定する。
3. JSホストがWASMへ配置計算を求め、配置と表示値をまとめたSceneを受け取る。
4. JSのレンダラーがDOM要素やCanvasの描画を更新し、次の操作を待つ。

**WASMが表示内容・配置とイベント後の状態を決め、JSがブラウザの描画APIを呼ぶ**分担です。挨拶のような画面内の処理は、このブラウザ内の往復で進みます。通信や保存が必要なときは、JSホストが外部APIを呼び、その結果を再びWASMへ渡します。

DOM側はinputやbuttonなどの要素を更新し、Canvas側は面を描き直します。「挨拶は何と表示するか」を決める状態は共有し、「どう描くか」をそれぞれへ任せる分担です。表示幅が違えば配置も変わるので、両画面の画素がすべて同じになる仕組みではありません。

この分担は、部品を増やすときにも効いてきます。入力値、許される操作、イベント後の結果を共通側で決めておけば、DOMとCanvasで業務処理を二重に書く範囲を減らせます。レンダラーごとに残る入力や描画の違いも、Sceneを境に追えます。🛠️

JSとWASMの基本的な受け渡しはUTF-8 JSONです。JSが入力メモリを確保し、requestを呼び、結果を読んだら入力を解放します。応答はエンジン所有で、次のrequestまで有効。メモリが拡張される可能性があるため、結果を読むときは呼び出し後の`memory.buffer`を使います。

この境界にはコピーや変換の費用もあります。WASMを使っただけで高速と決めつけず、まずは責務を説明できる設計を作る。詳細は[アーキテクチャ](https://github.com/6in/uivolve-web/blob/main/docs/architecture.md)へ置き、ここからは小さな画面で流れを追います。👣

## 👋 Hello World：一つの定義で二つの画面を動かす

最初の例は、名前を入力して挨拶する画面です。小さいですが、画面定義と処理のつながりがよく見えます。使うのは[Hello WorldのJSON](https://github.com/6in/uivolve-web/blob/main/public/screens/hello-world.json)と[Rhai](https://github.com/6in/uivolve-web/blob/main/public/screens/hello-world.rhai)。まずはJSONの部品部分を抜粋します。🧩

```json
[
  { "xtype": "textfield", "itemId": "nameInput", "bind": "name" },
  { "xtype": "button", "itemId": "helloButton", "text": "挨拶する", "handler": "sayHello" },
  { "xtype": "label", "itemId": "greetingLabel", "bind": "greeting" }
]
```

入力欄はstateの`name`、結果ラベルは`greeting`につながっています。名前を入力するとnameが更新され、ボタンを押すとsayHelloが呼ばれます。完全な画面JSONには、初期stateやコンテナもあります。上の抜粋は、その中のitemsです。

続いて、挨拶を作るRhaiの抜粋はこちら。🦀

```rhai
fn sayHello(state, event) {
    let name = state.name;
    name.trim();
    if name == "" {
        name = "World";
    }
    state.greeting = "Hello " + name;
    state
}
```

太郎と入力して押せば「Hello 太郎」。空白だけなら「Hello World」です。Rhaiではこの`name.trim();`で変数の値を整えます。DOMを探すコードも、Canvasに文字を書くコードも、このhandlerには登場しません。状態を返すと、共通エンジンとレンダラーが表示へつなぎます。✨

![DOMまたはCanvasの入力から候補state、Rhai、検証、確定を経て両描画へ届く流れ](./event-flow.png)

イベント処理では、現在のstateから候補を作り、入力の変更とRhaiを適用してから検証します。成功したところでstateと部品木、必要なeffectsを確定します。処理途中で失敗した候補は、現在の状態へ混ぜません。画面の読み込みでも、候補が成立してから切り替えるので、壊れた定義で表示中の画面を失わないようにしています。🛟

この流れは、ブラウザを開かずに実WASMでUTできます。[既存のテスト](https://github.com/6in/uivolve-web/blob/main/tests/engine.test.js)から、操作と確認を抜粋してみます。engine、screen、scriptの準備には、完全なHello Worldファイルとビルド済みWASMを使います。

```javascript
const initial = engine.load(screen, script);
const entered = engine.dispatch("nameInput", { value: "  太郎  " });
expect(entered.state.greeting).toBe(initial.state.greeting);
expect(engine.dispatch("helloButton").state.greeting).toBe("Hello 太郎");
expect(engine.layout(500).widgets.find((w) => w.key === "greetingLabel").text).toBe("Hello 太郎");
engine.dispatch("nameInput", { value: " 	 " });
expect(engine.dispatch("helloButton").state.greeting).toBe("Hello World");
```

expectは`vite-plus/test`、WasmEngineは`src/engine.js`から読み込みます。`bun install --frozen-lockfile`と`bun run build:wasm`で準備し、`public/engine.wasm`をcompile/instantiateしてテストごとに独立したengineを作ります。

確認できるのは「入力だけでは挨拶を変えない」「押すと更新する」「Sceneにも同じ文字が入る」という振る舞いです。画面の計算を小さく試せるのが便利！ 実際の文字や入力操作は、次のようにブラウザでも確認します。📸

![Hello Worldを操作し、DOMとCanvasの両側に同じ挨拶を表示した比較画面](./dom-canvas.png)

## 📬 通信と保存：画面の外の仕事もつなぐ

挨拶が動いたら、次はデータを取りに行きたくなります。開発ではHTTP取得、型付きstateと保存、OPFSファイル、キャッシュ、ProtobufのUnary RPCへと機能を広げました。共通runtimeや独立アプリの配布も加わり、画面の周りにホストの役割が育っていきます。🌱

Rhaiは同期実行なので、通信完了までその場で待つ書き方は採りません。`host_call`で依頼し、検証後に確定したeffectsをJSへ渡します。ホストのアダプターが通信や保存を実行し、結果を`host_result`で戻すと、Rhaiの完了handlerが呼ばれます。📮

![確定したeffectsをJSアダプターへ送り、結果を最新stateのhandlerへ戻す非同期経路](./host-effects.png)

戻ってきた結果は、完了時点の最新stateへ適用します。通信中に入力した内容を、依頼時の古いstateで上書きしないためです。画面切替後の古い結果は、依頼idと世代の確認で新しい画面への混入を防ぎます。

この分担が特に分かりやすいのがOPFS転送です。大容量ファイルをWASMへコピーすると、画面のstateとは別の重い荷物を抱えることになります。そこでdownloadはJS側でreaderからOPFSへ少しずつ保存し、uploadはFile、multipartはFormDataで送ります。WASMは領域、パス、サイズなどの制御情報を扱います。📁

「Rust/WASMを使うから、全部そこを通す」という設計にはしませんでした。ブラウザが持つファイルや通信APIをホストで使い、画面側は開始、進捗、結果を扱う。この境界を保って、100 MiB級の転送も実ブラウザで検証しています。

中止や保存確定も、設計しておく必要があります。downloadはwriter.closeの成功が確定点で、close開始後の巻き戻しは保証しません。中止しても実処理とcleanupが終わるまで排他を保持します。Web Locks対応環境では別タブにも排他が及び、未対応なら同じホスト実行環境内が範囲です。条件の詳細は[OPFS転送契約](https://github.com/6in/uivolve-web/blob/main/docs/opfs-file-transfer.md)へまとめています。🔒

## 🤖 WebMCP：AIにも「このボタン」を伝えられる

元のuivolveは、画面の意図をDSLでAIへ渡します。こちらのuivolve-webでは、**動いている画面をAIから構造化して扱う入口**も備えています。それがWebMCPです。設計時の引き渡しと、実行中の操作で、AIとの接点が広がりました。🤝✨

比較デモでは起動時に共通ツールを自動登録します。画面や状態を読み、表示中の部品keyへイベントを送れます。Canvasでも、座標を画像から推測する経路に加えて、部品を指定して操作できる構成です。

人が押してもツールが操作しても、共通WASMの検証とRhaiのhandlerを通ります。画面tokenとrevisionを確認するので、古い画面や状態への操作も拒否できます。Sceneとイベントを共通にしたことが、ここでも役立ちます。🛠️

利用には対応ブラウザAPIとsecure contextが必要です。比較デモはデフォルトで登録を試み、独立アプリでは`webmcp: true`で有効にします。未対応ブラウザでも通常UIは動きます。詳しくは[WebMCP接続](https://github.com/6in/uivolve-web/blob/main/docs/webmcp.md)をどうぞ。

## 🧪 WorkerモックとUT：仮のサーバーも用意できます

画面ができたら、一覧を取ったり、注文を追加したりする動きも確かめたいところ。そんなときは、WebWorkerのメモリで処理するモックAPIを使えます。仮のサーバーの初期データとルートを、画面とは別のJSON/YAMLへ記述します。📦

[注文モック](https://github.com/6in/uivolve-web/blob/main/public/mock/orders-api.yaml)を小さくした例です。項目とルートを減らした、一覧取得用の定義として読めます。

```yaml
version: 1
collections:
  orders:
    key: id
    seed:
      - { id: O001, customer: 山田商店 }
      - { id: O002, customer: 佐藤工業 }
routes:
  listOrders: { method: GET, path: orders, operation: list, collection: orders }
```

完全例には登録、更新、削除、リセットや固定応答もあります。ホストへworkerMockAdapterを明示登録すると、画面とRhaiはhost_callで依頼できます。実HTTPへ移るときも同じ呼び出し形式を使い、接続や必要なoperation設定を切り替えられます。🔌

このモックは宣言した固定応答とCRUDを扱います。任意のサーバーコードを実行する仕組みではなく、検索や遅延、永続化は現行の対象外。それでも、バックエンドの実装を待たずに画面のデータの流れを確かめられるのはうれしいところです。

UTではWorkerも描画も外し、MockApiModelへ入力して結果を確認できます。[既存のモックテスト](https://github.com/6in/uivolve-web/blob/main/tests/worker-mock.test.js)から、一覧の確認を抜粋するとこのサイズです。✅

```javascript
const model = new MockApiModel(definition);
expect(model.request({ method: "GET", path: "orders" }).body).toHaveLength(2);
```

expectは`vite-plus/test`、MockApiModelは`src/mock-api-model.js`からimportします。definitionは`src/package-format.js`のparsePackageでYAMLを読んだ値です。上のミニ版でも完全な注文定義でも、初期レコードは2件あります。

実WASMとモックの対象テストは、WASM生成後に`bunx vp test run tests/engine.test.js tests/worker-mock.test.js`で実行できます。状態とロジックを先にUTし、実Workerの読み込み、CORS、DOM/Canvasの操作はブラウザで確認する。役割を分けると、失敗した場所も追いやすくなります。🔍

## 📝 AI開発の振り返り：任せるための準備も大切でした

OPFS転送では、gsd-liteとCodexの無人ループを使いました。人が要件と判断基準を決め、AIが調査、計画、実装、検証を進め、記録を残して次へ渡す流れです。画面をAIへ渡すuivolveの考え方と同じく、意図を読める形で残すことが出発点でした。🤝

![人が要件を決め、AIがdiscussからreflectまでの記録を読みながら進み、BLOCKEDとverifyでは人が判断へ戻る開発ループ](./ai-workflow.png)

図の中央にあるREQUIREMENTS、DECISIONS、PROGRESSは、会話の代わりに残す引き継ぎです。何を作るか、なぜその判断をしたか、どこまで進み、何が想定外だったかをファイルへ置きます。次のAIは新しい会話でも記録を読んで、先頭の未完了タスクから続けられます。📓

implでは一つのタスクを実装してテストし、進捗と次の注意点を残します。verifyは「コードが通るか」だけでなく、最初に決めた契約どおりかを見る工程です。図のループに人の判断点を残したのは、止まった原因をAIだけのリトライ回数として数えないためです。🔄

今回はdownload、本文upload、multipartについて、容量・中止・期限・排他・DOM/Canvasの確認まで先に決めました。researchからverifyは20試行、試行内所要の合計は5,697秒、約95分です。待機や人の対話、この記事の作業は含みません。⏱️

自動で一直線には進みません。BLOCKEDは3回あり、実行環境、RhaiのCSV加工、ブラウザ認証fixtureを人が見直して再開しました。verifyでは、uploadの既定Content-Typeが欠け、テストもその欠けを期待していたことを発見。**実装とテストが同じ勘違いをすれば、両方そろって緑になります。** 要件から期待値を決め、受信側・実WASM・実ブラウザで観測する必要を学びました。記録を残すのは、同じ迷いを繰り返さず、どこで人が判断すべきかを次回へ渡すためでもあります。🧭

詳細は[OPFSの振り返り記録](https://github.com/6in/uivolve-web/blob/main/.gsd-lite/reflect/20261005-0843-opfs-file-transfer.md)へ。要件、判断、進捗を残すことが、人とAIが次の実装を判断する共通の材料になります。🌱✨

## 🚧 制限と次の実験：まだまだ育てる余地があります

小さなモックから、入力、通信、保存、AIの構造化操作まで話が広がりました。共通エンジンで画面の振る舞いを確かめ、必要な外部処理はホストへ任せる。その形が、今のuivolve-webです。🌱

次に確かめたいこともあります。Canvasの入力はネイティブ入力欄を併用しており、実IME、読み上げ、アクセシビリティは実機での確認が必要です。Rhaiは同期実行なので、重い処理を自由に走らせる仕組みではありません。現在の描画はCanvas 2Dで、GPU描画はこれからの検討です。⌨️

DOM/Canvas比較のCPU再描画時間は、処理区間の測定値です。FPSやGPU性能の優位を証明するものではありません。共通化の便利さと実際の操作性、性能は、それぞれ利用場面を決めて確かめていきます。📊

元のuivolveが、仕様書、モック、AIによる本実装をつなごうとしたように、こちらでは画面定義、実行、テスト、構造化操作のつながりを育てています。宣言として残した画面の意図を、どこまで同じ材料で確かめられるか。Hello Worldから始まった実験は、もう少し先へ進めそうです。🧩🚀

## 📚 参考リンク

- [元のuivolve：目的、AIへの引き渡し、Markdown/MDX統合](https://github.com/6in/uivolve/blob/3d22a3cfab5488afe3c60f8775676a85c51593ec/README.md)
- [uivolveの部品移植と対応範囲](https://github.com/6in/uivolve-web/blob/main/docs/uivolve-port.md)
- [設計と責務](https://github.com/6in/uivolve-web/blob/main/docs/architecture.md)
- [画面定義の契約](https://github.com/6in/uivolve-web/blob/main/docs/screen-format.md)
- [ホストHTTPアダプター](https://github.com/6in/uivolve-web/blob/main/docs/http-adapter.md)
- [OPFS転送と中止・確定の境界](https://github.com/6in/uivolve-web/blob/main/docs/opfs-file-transfer.md)
- [WebMCP接続](https://github.com/6in/uivolve-web/blob/main/docs/webmcp.md)
- [WorkerモックAPI](https://github.com/6in/uivolve-web/blob/main/docs/worker-mock-api.md)
- [テストの案内](https://github.com/6in/uivolve-web/blob/main/docs/testing.md)
- [OPFS開発の進捗記録](https://github.com/6in/uivolve-web/blob/main/.gsd-lite/archive/opfs-file-transfer/PROGRESS.md)
