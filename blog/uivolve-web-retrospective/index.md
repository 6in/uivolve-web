# 🦀 uivolveの考えをWebへ！共通WASMエンジンの開発を振り返る

画面の定義を読み込み、名前を入力し、ボタンを押す。同じ挨拶がDOMにもCanvasにも現れます。小さなHello Worldですが、その裏には「画面の状態を誰が決めるのか」という設計があります。今回はuivolve-webの共通エンジンを、この一連の流れから見ていきます。通信や保存へ広げた経緯と、AIに実装を任せる運用で分かったことも紹介します。🌱

## 🌱 出発点：宣言的な画面をWebへ

出発点は、uivolveの宣言的な部品・配置の考えをWebへ移す試作です。画面ごとにDOM操作を書くのではなく、「どんな部品を、どの配置で、どの状態につなぐか」を定義します。完全なuivolve互換やExtJS互換を目指した実装ではありません。似た部品名が出てきても、対応範囲はこの試作の契約で決まります。🧩

この記事で振り返る履歴は、既存成果を取り込んだ2026年10月2日の`868983e`から、OPFS転送の振り返りを残した10月5日の`a8fdffe`までです。最初のコミット以前にどう試行錯誤したかは、この記録からは分かりません。性能改善が最初の動機だったといった、残っていない物語も補いません。

設計の中心はRust/WASMに状態・イベント・配置を集め、ブラウザとの接点をJavaScriptへ置くことです。比較デモは共通の結果を二つの描画方式へ渡します。部品を増やす際に考えるのは、見た目だけではなく、入力をどう表現し、何を検証し、どの状態を確定するかです。この分担が、後の通信や構造化操作にもつながりました。🔗

## 🦀 共通エンジン：状態と描画の間にSceneを置く

画面はJSONまたはYAML、処理はRhaiで記述します。HTTPで取得するのはJSホストです。YAMLはホスト側でJSON相当の構造へ変換してから渡します。WASM自身が画面URLへfetchしたり、DOM要素を作ったりする構成ではありません。取得・認証・ブラウザAPIの都合を、画面の状態計算から分けています。📦

Rust/WASMは画面定義を読み、状態と部品の関係を検証し、イベントを処理します。RhaiソースはWASM内でASTへコンパイルして実行します。画面用Rhaiから新しいWASMバイナリを生成するわけではありません。同じエンジンへ別の画面定義とスクリプトを渡せるので、画面の変更とエンジンのビルドを分けられます。

配置も共通側の仕事です。`layout(width)`へ幅を渡すと、部品の座標・寸法・表示値などを持つSceneが返ります。DOMレンダラーはその結果から要素を更新し、Canvasレンダラーは描画します。両者が別々に業務状態を決めることはありません。ただし入力幅が違えば配置結果も違います。「状態が同じ」と「画素が完全に同じ」は別の話です。🎨

![画面取得を担うJSホスト、共通RustとWASM、SceneからDOMとCanvasへの責務分担](./architecture.png)

図では取得をJSへ、状態・イベント・配置をWASMへ、描画を二つのレンダラーへ分けています。Sceneを境界に置くと、「挨拶の値が違う」のか「同じ値の描き方が違う」のかを切り分けやすくなります。部品の契約は共通でも、ブラウザ固有の入力補助や描画手段はホスト側に残ります。

JSとWASMの基本ABIはUTF-8 JSONです。JSは入力領域を確保して書き込み、requestを呼び、応答を読み終えてからfinallyで入力を解放します。応答領域はエンジンが所有し、次のrequestまで有効です。呼び出しでメモリが成長する可能性があるため、応答には呼び出し後の`memory.buffer`を参照します。ポインターを保存して後から使い続ける契約ではありません。🔎

この境界にはシリアライズやコピーの費用もあります。共通化できたから高速だと結論づけるのではなく、何を渡し、どこで確定するかが説明できることを、この試作の設計上の成果として捉えています。詳しい責務は[アーキテクチャ](../../docs/architecture.md)にまとまっています。

## 👋 Hello World：入力から両方の描画まで

現行の例は[Hello WorldのJSON](../../public/screens/hello-world.json)と[Rhai](../../public/screens/hello-world.rhai)です。ここでは必要部分だけを抜粋します。完全なJSONにはversion、id、script、初期state、コンテナなどもあります。この断片だけを画面ファイルとして読み込むものではありません。📋

```json
[
  { "xtype": "textfield", "itemId": "nameInput", "bind": "name" },
  { "xtype": "button", "itemId": "helloButton", "text": "挨拶する", "handler": "sayHello" },
  { "xtype": "label", "itemId": "greetingLabel", "bind": "greeting" }
]
```

入力欄のbindは`name`、表示ラベルのbindは`greeting`です。名前を入力すると共通イベントがWASMへ届き、候補stateのnameを更新します。この入力欄にはhandlerがないので、入力しただけでは挨拶を計算しません。押下イベントでhelloButtonのsayHelloを呼ぶと、次の処理が走ります。

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

こちらも抜粋で、完全例にはinitがあります。Rhaiの`name.trim();`は変数を更新する書き方です。前後に空白のある太郎ならHello 太郎、空白だけならHello Worldになります。JavaScriptの文字列操作の感覚で別の書き方へ置き換えず、実際のRhai例と実行結果に合わせています。✨

イベントでは、現在の状態から候補を作り、入力の型処理やRhaiを適用します。その後、stateがオブジェクトか、部品とのbindが成立するか、handlerが存在するか、宣言されたschemaに合うかなどを検証します。effectsも準備してから、stateと部品木、依頼を確定します。Rhaiが途中で失敗した場合に、その候補stateを現在の状態へ混ぜないための順序です。

![DOMまたはCanvasの入力から候補state、Rhai、検証、確定を経て両描画へ届く流れ](./event-flow.png)

図の候補stateと確定stateは別の段階です。画面置換でも候補を読み込み、成立した後に切り替えるので、壊れた候補画面で現在の画面を失わないようにしています。これはエンジンとランタイムの保持規則です。Hello WorldのRhai自身に、通信失敗の通知や独自の例外処理が実装されているという意味ではありません。🛟

描画なしでも、この流れを実WASMで確かめられます。次は[実WASMのUT](../../tests/engine.test.js)のHello World試験を短くした抜粋です。`vite-plus/test`からexpectをimportし、`src/engine.js`のWasmEngineを使います。先に`bun install --frozen-lockfile`と`bun run build:wasm`を実行し、public/engine.wasmを読み、WebAssembly.compileとinstantiateで独立インスタンスを作ります。screenとscriptには先ほどの完全ファイルを読み込んでください。

```javascript
const initial = engine.load(screen, script);
const entered = engine.dispatch("nameInput", { value: "  太郎  " });
expect(entered.state.greeting).toBe(initial.state.greeting);
expect(engine.dispatch("helloButton").state.greeting).toBe("Hello 太郎");
expect(engine.layout(500).widgets.find((w) => w.key === "greetingLabel").text).toBe("Hello 太郎");
engine.dispatch("nameInput", { value: " \t " });
expect(engine.dispatch("helloButton").state.greeting).toBe("Hello World");
```

stateだけでなくSceneのラベルまで確認できるのが便利です。ただし、ブラウザがその文字を正しく描いたことは別途確かめます。次の比較画像はそのための実画面確認用です。DOMとCanvasのどちらから操作しても同じ挨拶へ届く、という流れを対応づけます。📸

![Hello Worldを操作したDOMとCanvasの比較画面](./dom-canvas.png)

## 📬 通信と保存：effectsでブラウザへ依頼する

挨拶の計算は同期で完結しますが、通信や保存はそうはいきません。Rhai内で待ち続ける代わりに、依頼をeffectsとして取り出し、JSホストが実行し、完了をイベントとして戻します。履歴ではHello WorldからHTTP effectsへ進み、YAML・保存・型、files/cache/RPC、共通runtimeと独立アプリ、ホストアダプターへ広がりました。現在のAPIの説明と、この実装順序は分けて読んでください。🧭

現行のoperationsはconnection、action、handler、optionsを宣言し、Rhaiの`host_call`で依頼します。依頼した瞬間にfetchするのではなく、状態検証後に確定したeffectsを配送します。登録アダプターが処理し、`host_result`が戻ると完了handlerを呼び、再び候補stateを検証して確定します。WASMは処理の意図を持ち、JSは外部資源を所有します。

![確定したeffectsをJSアダプターへ送り、結果を最新stateのhandlerへ戻す非同期経路](./host-effects.png)

図の戻り先は、依頼を出した時点の古いstateではなく、完了時点の最新stateです。通信中に別の入力があっても、その編集を古いコピーで上書きしないためです。pendingの依頼idとホスト側の世代も区別します。画面切替やdispose後の古い完了・進捗は、新しい画面へ適用しません。⌛

OPFS転送では、さらに「ファイル本体をどこへ通すか」が焦点になりました。大容量downloadはJSで応答readerからchunkを読み、OPFS writableへ順に書きます。uploadはFile本文、multipartはFormDataを使います。WASMやJSON stateへファイル本体を載せず、領域・パス・サイズなどの制御情報を扱います。通常のFileBytesやRhaiの容量上限を広げたわけではありません。ブラウザ内部のバッファリングまで保証するものでもありません。📁

中止と確定にも境界があります。downloadはwriter.closeの成功が確定点で、close開始後の巻き戻しは保証しません。成功して閉じたファイルを、後から取消やcleanupで削除しません。送信側も中止だけでサーバー未更新とは判断できず、結果不明や確定後の失敗を区別します。「取消ボタンがある」だけではundoの保証にならないのです。

通常files操作と転送は同じ画面id・領域の排他を共有します。中止や期限切れでも実処理とcleanupが落ち着くまでロックを保持します。Web Locks対応環境では別タブにも排他が及び、未対応環境では同じホスト実行環境内に限られます。詳しい確定・認証・上限の条件は[OPFS転送契約](../../docs/opfs-file-transfer.md)へまとめています。🔒

## 🤖 WebMCP：描画方式を越える構造化操作

この試作はWebMCP対応を標準で備え、比較デモでは起動時に共通ツールの登録を試みます。画面や状態を参照し、表示中の部品へイベントを送る入口です。Canvasでも、画像の座標を推定してクリックする経路とは別に、部品keyとpayloadでWASMへ到達できます。人の操作と同じ状態検証・Rhai handlerを通す点が、共通エンジンの設計とつながります。🛠️

ただし独立アプリのcreateApplicationでは`webmcp: true`を明示します。対応ブラウザAPIとsecure contextも必要です。APIがない環境では登録せず、通常UIは動きます。ここで述べるのはリポジトリの実装条件で、全ブラウザや全アプリで既定有効という保証ではありません。

構造化操作にも現在性の確認があります。画面tokenとrevisionを参照し、古い画面や人の操作で進んだ状態への依頼を拒否します。非表示や無効な部品を自由に操作したり、stateへ直接書き込んだりする入口ではありません。認可や業務別ツールをどう設計するかは、今後のアプリ側の契約として残ります。詳細は[WebMCP接続](../../docs/webmcp.md)で確認できます。🔍

## 🧪 WorkerモックとUT：画面の前に契約を試す

バックエンドを待たずに画面を試すため、WebWorkerのメモリで固定応答やCRUDを処理するモックもあります。画面DSLとは別のJSON/YAMLに初期データとルートを書きます。次は[注文モック定義](../../public/mock/orders-api.yaml)の抜粋です。seedは完全例のデータを使い、ここでは一覧ルートだけを示します。📚

```yaml
version: 1
collections:
  orders:
    key: id
    seed: []
routes:
  listOrders: { method: GET, path: orders, operation: list, collection: orders }
```

これは任意のサーバーコードやJavaScriptを実行する仕組みではありません。宣言された固定応答とCRUDの最小版です。ホストへworkerMockAdapterを明示登録して使います。画面のhost_callを保ち、ホストの接続とoperation設定を実HTTP向けに替えられるのが利点ですが、実サーバーとの契約を自動的に一致させる機能ではありません。

モデルだけならWorkerも描画も不要です。次は[モックUT](../../tests/worker-mock.test.js)の一覧検証を、ヘルパーを使わず直接書いた抜粋です。expectは`vite-plus/test`、MockApiModelは`src/mock-api-model.js`からimportします。definitionは完全なorders-api.yamlを`src/package-format.js`のparsePackageで読み込んだ値です。この完全例の初期注文は2件なので、上の空seed断片へそのまま適用する試験ではありません。✅

```javascript
const model = new MockApiModel(definition);
expect(model.request({ method: "GET", path: "orders" }).body).toHaveLength(2);
```

対象UTはWASM生成後に`bunx vp test run tests/engine.test.js tests/worker-mock.test.js`で実行できます。掲載抜粋も同じ準備で別途実行確認しています。モデルの入出力と実WASMの状態遷移は、ブラウザなしで小さく確かめられます。一方、UT内のTestWorkerはメッセージ契約を試す代替です。実Workerのロード、実HTTPのCORS、DOMやCanvasの描画、ブラウザ固有の取消は、実ブラウザで確認する別の対象です。試験の名前より、何を通ったかを見るのが大切です。🌐

## 📝 AI開発の振り返り：止まることも運用の一部

ここからは、共通エンジンを広げる作業をAIへ任せた運用の振り返りです。使ったgsd-liteは、discussで要件を詰め、researchで根拠を調べ、planでタスクと検証方法を決め、implで一つずつ実装し、verifyで全体を照合し、reflectで記録から振り返る流れです。要件を人が決めることと、決まった作業をループが進めることを分けています。🚦

一つの実装ターンでは先頭の未完了タスクだけを進めます。コードだけでなく、何を確認し、何が想定外で、何をやり直し、次に何を注意するかをPROGRESSへ残します。stateのturnや次コマンドを更新してコミットするので、次の実行は会話の記憶だけに頼らず再開できます。止まった理由も成果物です。未検証の状態を黙って完了扱いにしないことが、引き継ぎの土台になります。📓

OPFS転送の記録では、researchからverifyまでが20試行、試行内所要の合計が5,697秒、約95分でした。これはこの機能の該当試行だけの数字です。停止中の待機、対話介入、reflect、今回の記事作成は含めません。初期試作からの開発全体の時間でもありません。数字だけを見ると短い自動実装に見えますが、何を除いた集計なのかを添えて初めて意味が定まります。⏱️

実際にはBLOCKEDが3回あります。最初はlocalhostの実行制限と既存管理文書の書式で止まりました。次はCSV加工のRhaiの使い方、もう一つはブラウザ認証fixtureの不一致です。それぞれ環境や例を見直し、人の再開判断を挟んで別ターンで検証しました。完全無人のまま成功した、とまとめられる記録ではありません。停止は進捗の失敗というより、確認できない条件を明らかにする境目です。🛑

特にRhaiの文字列処理は、別言語の直感を持ち込むと例が崩れます。Hello Worldのtrimも、実物の書き方と結果を一緒に確認する理由がここにあります。ブラウザ認証ではfixture間のtokenが一致しているかが問題になりました。アプリ本体、テストサーバー、ブラウザ環境を一つの成功印でまとめず、どの層の前提がずれたかを記録することが再開に役立ちます。🧰

そして全テスト成功の後にも、verifyで差し戻しがありました。本文uploadのContent-Typeを省略した場合、合意した既定値はapplication/octet-streamでしたが、実装には欠落があり、既存試験までその欠落を期待していました。テストが緑でも、要件の既定値を満たしていなかったのです。これはBLOCKEDとは別の、契約照合から追加修正へ戻る工程でした。🔁

修正では受信側のヘッダーを確かめ、再検証しました。記録には、ブラウザが拡張子からFile.typeを推定したり、multipart解析側が型を補ったりすることも残っています。見かけの値だけを確認すると、どこが既定値を付けたのか分からなくなります。契約が求める送信内容を、適切な境界で観測する必要がありました。テストを増やすことだけでなく、期待値をどこから決めたかが重要です。📨

この経験からの考察は、AIの出力を細かく読むだけでなく、要件と実測を対応づける作業を独立させるとよい、ということです。実装に合わせて試験を書くと、同じ誤解を二重に固定してしまいます。既定値、取消の確定点、排他を解放する時点などを先に言葉で決め、受信側や実ブラウザで照合すれば、モデルや担当者が替わっても判断の根拠を渡せます。🧭

今回の記事でも、コード断片の実行確認と、主張の実装照合と、画像の目視は別々に扱っています。字数検査が成功しても技術説明が正しいとは限らず、stateが正しくてもCanvasの文字が読めるとは限りません。管理文書の整形を済ませてから撮影し、終了処理の失敗で元の失敗を隠さない、という前回の申し送りも次の工程へ渡します。小さな順序の約束が、長い作業の再現性を支えます。📸

なお、ログから正確な実行モデル、出力・キャッシュのトークン内訳、費用は確定できません。設定に残るモデル名だけを実行証拠にしたり、未取得を無料やゼロとして扱ったりしません。ループのリトライがゼロでも、BLOCKEDやターン内のやり直しがゼロという意味ではありません。自動化の成果を評価するなら、成功件数だけでなく、人が判断した箇所と記録の欠けも一緒に読む必要があります。🔎

ここで述べた運用上の評価は、OPFSの[振り返り記録](../../.gsd-lite/reflect/20261005-0843-opfs-file-transfer.md)を踏まえた考察です。AIへ任せる範囲を広げるほど、人の仕事はなくなるというより、要件・境界・観測方法を決める側へ移ります。その判断をファイルへ残すことが、次の無人ターンを具体的に支えると考えています。🌱

## 🚧 制限と次の実験：同じ状態でも確認すべきことは残る

Canvasの入力はネイティブ入力欄を併用します。文字が描けることと、日本語IMEの実操作、フォーカス、読み上げ、アクセシビリティが十分なことは同じではありません。DOM版にもブラウザ固有の確認が残ります。Hello WorldのstateやSceneのUTが通っただけで、実IMEや支援技術まで対応済みと判断しないようにしています。⌨️

Rhaiは同期で実行します。操作数などの制限はありますが、重い業務処理を自由に走らせるための非同期計算基盤ではありません。I/Oをeffectsへ分けたことも、同期処理の負荷を消す魔法ではありません。画面定義のサイズ、イベントの頻度、配置や再描画の費用を、具体的な利用場面で観測する必要があります。

比較デモのCPU再描画計測は、その処理区間の所要を見ます。FPSやGPU性能の優位を証明する測定ではありません。現在のCanvas描画から、将来のGPU描画が速いとも断定できません。次の実験では測定対象と条件を先に決め、実IME、アクセシビリティ、描画方式の境界を一つずつ確かめたいところです。📊

小さな挨拶から通信・保存・構造化操作まで追うと、共通エンジンの役割が見えてきます。状態を確定する場所を共有しつつ、外部資源と描画はホストへ置く。その境界を実行例、契約、観測記録で確かめながら育てることが、この試作の次の一歩です。🦀

## 📚 参考リンク

- [設計と責務](../../docs/architecture.md)
- [画面定義の契約](../../docs/screen-format.md)
- [ホストHTTPアダプター](../../docs/http-adapter.md)
- [OPFS転送と中止・確定の境界](../../docs/opfs-file-transfer.md)
- [WebMCP接続](../../docs/webmcp.md)
- [WorkerモックAPI](../../docs/worker-mock-api.md)
- [テストの案内](../../docs/testing.md)
- [OPFS開発の進捗記録](../../.gsd-lite/archive/opfs-file-transfer/PROGRESS.md)
