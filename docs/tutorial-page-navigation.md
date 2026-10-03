# ボタンから別の画面をダウンロードする

[画面AのYAML](../public/screens/page-navigation.yaml)と[Rhai](../public/screens/page-navigation.rhai)、[画面BのYAML](../public/screens/page-navigation-detail.yaml)と[Rhai](../public/screens/page-navigation-detail.rhai)を別々に配信する。デモは「はじめに」の「画面遷移 · 画面A」、または`/pages/page-navigation`から開ける。

画面Aでボタンを押すと、画面BのYAMLと、その`script`で指定したRhaiをHTTPから取得する。共通WASMでコンパイル・初期化した後にDOM/Canvasの両方を置き換える。画面Bの戻るボタンも、画面Aを再取得して開く。

## 画面定義

トップレベルの`pages`へ遷移先を名前付きで宣言し、ボタンのhandlerで呼び出す。

```yaml
pages:
  details:
    url: page-navigation-detail.yaml
ui:
  xtype: container
  layout: vbox
  items:
    - xtype: button
      itemId: openDetails
      text: 画面Bを開く
      handler: openDetails
```

Rhaiでは遷移先の宣言名を渡す。

```rhai
fn init(state) { state }

fn openDetails(state, event) {
    navigate("details");
    state
}
```

`navigate`は同期でダウンロードせず、遷移の依頼をキューへ入れる。handlerが正常に終了し、state・部品の検証が成功した後だけ、ホストへ`kind: "navigate"`の更新命令を返す。ホストは既存のApplicationLoaderを使って取得・表示する。独自ホストにもこの更新命令の処理が必要。

## URL・失敗・状態

- `pages.*.url`は宣言元の画面パッケージURLを基準に解決する。遷移先の`script`は遷移先パッケージURLから解決する。HTTPS/HTTPを使用し、既存のCORS・JWT・配信キャッシュ設定を共用する。
- 読み込み・コンパイル・initに失敗したら現在の画面とstateを保持し、デモのエラー欄に原因を表示する。画面Aには存在しないURLへのボタンがあり、入力したメモを失わず再試行できることを確認できる。遷移元handler自体が正常に変更したstateは保持される。
- 成功時は遷移先の初期stateを使用する。引数の受け渡し・画面ごとの履歴state保存は行わない。画面Bでメモを入力して表示すると、別のRhaiが実行されることを試せる。
- デモに登録済みのパッケージURLへ移動した場合は`/pages/<id>`も更新し、「戻る」「進む」・直接アクセスが使える。外部パッケージは表示を切り替えるが、デモの画面カタログへは登録せずURLも書き換えない。外部アプリのURL・履歴は利用するホストで管理する。
- 宣言は最大8件、名前は1〜80バイト、URLは1〜2048バイト。1回のhandlerで遷移は1件。`init`からの遷移と、同じhandlerからの他の非同期依頼・ダイアログとの同時発行は拒否する。イベントや非同期完了handlerから呼び出せる。

## 確認

1. 画面Aのメモへ日本語を入力し、「取得失敗を試す」を押す。エラーが出てもメモと画面Aが残る。
2. 「画面Bをダウンロードして開く」を押す。URL、一覧の選択、DOM/Canvasが画面Bになる。「定義とスクリプト」も画面Bへ切り替わる。
3. 画面Bでメモを表示し、戻るボタンで画面Aへ移動する。ブラウザの戻る・進むでも両画面を再取得できる。

取得を確認する場合は、ブラウザのNetworkで`page-navigation-detail.yaml`と`page-navigation-detail.rhai`を見る。画面切り替えのたびにWASM本体を再ダウンロードする必要はない。
