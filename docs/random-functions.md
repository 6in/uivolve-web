# 乱数と冪等キーの共通関数

画面のRhaiから呼べる乱数関数は`uuid_v4()`と`random_int(min, max)`の2つだけ。WASMはOSやブラウザから乱数を取得せず、ホストが実行単位で1,024バイトを供給し、関数はそこから必要な分を切り出す。自分で乱数を作らないのでWASMのimportは増えない。主な用途はHTTP更新の冪等キーで、[HTTPアダプター](http-adapter.md)の送り直しと組み合わせて使う。

[受注管理・Worker API](../public/screens/worker-orders.yaml)と[Rhai](../public/screens/worker-orders.rhai)は`/pages/worker-orders`で開き、`uuid_v4()`で作った冪等キーの送り直しを試せる。供給の仕組みは[日付・時計の共通関数](date-functions.md)と同じで、ほかの共通関数は[RhaiからWASM内のRust関数を呼ぶ](native-extensions.md)にまとめている。

## 関数

| Rhaiの呼び出し         | 結果                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `uuid_v4()`            | RFC 9562のversion 4 UUID。小文字の`8-4-4-4-12`。1回16バイト消費 |
| `random_int(min, max)` | min以上max以下の一様な整数。1試行8バイト消費                    |

`uuid_v4()`は16バイトを取り、octet 6の上位4ビットにversion 4、octet 8の上位2ビットにvariant 10を立てる。残る122ビットはホストが供給したバイトのまま。小文字16進で出力するのはRFC 4122 §3の出力慣習と`crypto.randomUUID()`に合わせるため。

`random_int`は棄却サンプリングで一様性を保つ。`span = max - min + 1`を求め、8バイトをリトルエンディアンの`u64`として読み、spanで割り切れない端の区間に落ちた値は捨てて次の8バイトを取る。棄却の確率は常に1/2未満。`min > max`は例外で乱数を消費せず、`min == max`は`min`を返してやはり消費しない。

両関数は`with_volatility(true)`で登録してあり、Rhaiの最適化が呼び出しを定数へ畳み込まない。例外は3つで、乱数が付かないopでの呼び出しが`random: ホストがこの実行に乱数を供給していません`、残量不足が`random: この実行の乱数1,024バイトを使い切りました`、範囲の誤りが`random_int: minはmax以下にしてください`。これらの文言は要件に従って日本語で、`date_*`など既存関数の英語の文言とは揃っていない。例外は`try / catch`で扱え、未処理の例外はイベントのstate・UI・revision変更を破棄する。

```rhai
let key = uuid_v4();          // 小文字の8-4-4-4-12。16バイト消費
let dice = random_int(1, 6);  // 1〜6の一様な整数。1試行8バイト
let fixed = random_int(7, 7); // 7。乱数は消費しない
```

## 乱数の供給と再現性

ブラウザホストはRhaiを実行する`load`、`event`、`host_result`、`host_progress`、`http_result`、`storage_result`、`file_result`、`rpc_result`、`dialog_result`ごとに一度だけ乱数を採取する。時計を採取するopと同じ9つで、layoutやthemeだけの操作では採取しない。

ABIの任意フィールドはトップレベルの`random`、値は0〜255の整数1,024個のJSON配列。長さが1,024でなければホストの誤りとして`Request random must be exactly 1024 bytes`を返す。この検査だけは英語の文言になる。JSON化した配列で1要求あたり約3.6 KB増えるが、2 MBの要求上限に対しては無視できる大きさ。

1実行の持ち分は1,024バイトで、使い切ってもプールは伸長しない。`uuid_v4()`は16バイト×64で1実行64個まで、`random_int`は1試行8バイトなので128回目までは確定し、棄却が出るとそれより早く尽きる。残量が足りない呼び出しは例外になり、途中まで消費することはない。次の実行はまた1,024バイトから始まる。

WasmEngine、UiRuntime、createApplicationは`randomProvider`を受け取る。既定は`crypto.getRandomValues`で1,024バイトを作る`browserRandom`で、providerが`undefined`を返すとrandomを省略する。受け付ける値は`undefined`、長さ1,024の`Uint8Array`、長さ1,024で全要素が0〜255の整数の配列で、それ以外は`randomには0〜255の整数1,024個が必要です`。関数以外を渡すと`randomProviderには関数が必要です`。固定の配列を返すproviderを注入すればテストや再生を再現できる。

```js
const randomProvider = () => new Uint8Array(1024).fill(0x5a);
const runtime = new UiRuntime({ ...options, randomProvider });
```

WASM再取得でもproviderを引き継ぐ。各Runtimeは独立した乱数スコープを持ち、成功・失敗とも実行終了時に解除する。`random`を送らない旧ホストで新しいWASMを動かすと、乱数を使う画面は乱数不足の例外になる（乱数を読まない画面はそのまま動く）。逆に新しいホストが`random`を付けて旧WASMを呼ぶと、未知のキーとして無視される。

Rustで乱数を提供する場合は`Runtime::load_with_host_context(package, script, descriptors, host, components, register)`と`runtime.with_host_context(host, |runtime| runtime.dispatch(...))`を使う。型は`extensions::HostContext { clock, random }`で、clockとrandomはどちらも省略できる。旧APIの`load`、`load_with_extensions`、`load_with_descriptors`、`load_with_clock`、`with_clock`はシグネチャを変えずに維持する。

## 冪等キーの運用

冪等キーは1つの論理操作に1つ。画面が`uuid_v4()`でキーを作ってstateに持ち、本文に載せて送る。`outcome`が`unknown`の間は同じキーで送り直し、成功したとき、または入力を直して送り直すときに捨てる。ホストはキーを自動で付けないし自動再送もしない。

handlerの中で毎回`uuid_v4()`を呼ぶと送り直しのたびに別のキーになり、重複登録を防げない。stateのキーが空のときだけ作る形にする。1実行64個の上限は、1操作1キーで使う限り問題にならない。
