# RhaiからWASM内のRust関数を呼ぶ

画面のRhaiから、エンジンへ登録したRust関数を普通の関数として呼べる。計算や文字列処理をRustにまとめ、ページ側は入力と結果の反映を記述する。DOM版・Canvas版・WebMCPのどれから操作しても同じWASM内で実行する。

```rhai
let valid = regex_is_match("^[0-9]{3}-[0-9]{4}$", "123-4567");
let numbers = regex_find_all("[0-9]+", "注文3件、追加12件");
let total = sum_ints([10, 20, 30]);
```

実行例は「Rust拡張・正規表現」画面、URLは`?screen=native-extensions`。[画面JSON](../public/screens/native-extensions.json)と[Rhai](../public/screens/native-extensions.rhai)で正規表現・置換を試し、「整数の一括集計」タブでは数値入力をまとめてRustへ渡せる。これらのページ固有の処理をRustへ埋め込む必要はない。

## 現在の共通関数

| Rhaiの呼び出し                                  | 結果                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `regex_is_match(pattern, text)`                 | 一致があればboolのtrue。文字列全体を検査するときは`^...$`などのアンカーを使う                                            |
| `regex_find_all(pattern, text)`                 | 重ならない一致の文字列配列。見つからなければ空配列                                                                       |
| `regex_captures(pattern, text)`                 | 最初の一致のグループ配列。0は一致全体、1以降は括弧の順。未一致の任意グループは`()`, JSONではnull。全体が未一致なら空配列 |
| `regex_replace_all(pattern, text, replacement)` | すべての一致を置換した文字列。一致なしなら元の文字列                                                                     |
| `sum_ints(values)`                              | 整数配列の合計。空配列は0。小数・null・整数以外やi64の加算オーバーフローはエラー                                         |

正規表現の引数はすべて文字列。Rustの[regexクレート](https://docs.rs/regex/1.13.1/regex/)の構文を使う。日本語やUnicode文字クラス、`(?i)`などのインラインフラグ、名前付きキャプチャに対応する。先読み・後読み・パターン内の後方参照は未対応。

置換文字列は`$1`、`${1}`、`$name`、`${name}`でキャプチャを参照する。`$$`は文字としての`$`。存在しないキャプチャは空文字列。`$1a`は名前`1a`として解釈するので、グループ1に文字aを続ける場合は`${1}a`とする。

```rhai
// Rhaiの通常の文字列ではバックスラッシュをエスケープする。
let result = regex_replace_all("(?P<word>[^\\s]+)", "日本語 Rust", "[${word}]");
// result: [日本語] [Rust]
```

例外は通常のRhaiと同じ`try / catch`で処理できる。捕まえずにhandlerから出た例外は、そのイベントのstate・UI・revision変更を破棄する。サンプルは全Rust処理をローカル変数へ受けてからstateへ入れ、失敗時には前回の結果を残してメッセージを更新する。

```rhai
try {
    let result = regex_find_all(state.pattern, state.text);
    state.result = result;
} catch (error) {
    state.notice = error.to_string();
}
```

## Rust関数を追加する

共通の登録窓口は[engine/src/extensions/mod.rs](../engine/src/extensions/mod.rs)の`register(engine)`。新しいRustモジュールで関数を実装し、そこからRhaiの`Engine::register_fn`へ登録する。Rhaiの[登録API](https://rhai.rs/book/rust/functions.html)と[失敗を返す関数](https://rhai.rs/book/rust/fallible.html)を利用している。

たとえば`engine/src/extensions/pricing.rs`を作る。

```rust
use rhai::{Engine, EvalAltResult, INT};

fn subtotal(price: INT, quantity: INT) -> Result<INT, Box<EvalAltResult>> {
    if price < 0 || quantity < 0 {
        return Err("subtotal: price and quantity must be non-negative".into());
    }
    price.checked_mul(quantity)
        .ok_or_else(|| "subtotal: integer overflow".into())
}

pub fn register(engine: &mut Engine) {
    engine.register_fn("subtotal", subtotal);
}
```

`extensions/mod.rs`へ`mod pricing;`を追加し、既存のregex・sum_intsの登録に続けて`pricing::register(engine);`を呼ぶ。WASMをビルドし直してから、画面のRhaiで呼ぶ。

```rhai
fn calculate(state, event) {
    state.total = subtotal(state.price, state.quantity);
    state
}
```

登録する引数の型は`rhai::INT`、`rhai::FLOAT`、bool、`ImmutableString`または`&str`、`Array`、`Map`、`Dynamic`など。配列やmapの要素はDynamicなので、Rust側で要素の型を検査する。関数に合わない引数の型や個数はRhaiの呼び出しエラーになる。エラーは`Result<T, Box<EvalAltResult>>`で返す。入力依存のpanicやunwrap、整数の暗黙のオーバーフローを避ける。

大量の要素を処理するときは配列をまとめて渡す。Rhaiのループから1要素ずつRustを呼ぶ回数と型変換を減らせる。返り値はJSONへ変換できる値を使い、Rust独自のオブジェクトをそのままstateへ保存する前提にしない。Rustで動くことだけで高速化を保証しないので、必要なケースで呼び出し・変換・処理の合計時間を測る。

## Rust側で個別のエンジンへ追加する

RustからRuntimeを組み込む用途では`Runtime::load_with_extensions(package, script, register)`も使える。共通関数とHTTP関数の登録後、Rhaiのコンパイル・initより前に追加の登録関数を実行する。

```rust
let runtime = Runtime::load_with_extensions(package, script, |engine| {
    pricing::register(engine);
})?;
```

通常のブラウザ向けABIは`Runtime::load`を使い、共通登録窓口の関数を公開する。Rust側の機能追加では**エンジンのWASM再ビルドと再配信**が必要。登録済み関数を利用する画面JSON・RhaiはHTTPで差し替えられる。任意のRustシンボルを名前で呼ぶ機構、ブラウザからのネイティブ関数の後付け読み込み、ページ単位のRustコンパイルは実装していない。

## 実装と確認の基準

- 同名・同じ型の関数を上書きしないよう、機能を表す名前を付ける。共通登録は画面loadごとに実行し、キャッシュなどはそのエンジン内に置く。
- 計算関数は入力から結果を返す。stateの確定前に外部へ副作用を実行すると、Rhaiの失敗時に巻き戻せない。通信は既存の[HTTP依頼と完了handler](tutorial-http-grid.md)を使う。
- ネイティブ関数の内部ループや確保量はRhaiの操作数上限で直接制御できない。入力・件数・出力・コンパイル容量などをRust側で制限する。現在は同期実行で、Workerへ分離する仕組みや時間による強制中断はない。
- 関数単体に加え、実WASMからRhaiを通した引数・返り値・エラー時の巻き戻しを確認する。UIに使う例はDOM/Canvas/WebMCPで確認する。[検証基準](testing.md)を参照。
- 依存クレートを追加した場合はwasm32対応、WASMサイズ、ライセンス通知を確認する。今回のregex追加でエンジンは約2,292 KiBから約3,193 KiBへ増えた。圧縮前の実ビルドの値で、性能測定ではない。

現在の正規表現はパターン1,024 UTF-8バイト、対象と出力65,536バイト、置換テンプレート4,096バイト。抽出・置換は最大256件、キャプチャはグループ0を含め256個。キャプチャの文字列合計も65,536バイト以内。超過時は結果を切り捨てずエラーにする。コンパイルされたパターンは最近使った8個を保持し、1パターンのコンパイル容量1 MiB、遅延DFAキャッシュ256 KiB、構文の深さ64で制限する。これは入力などの上限であり、実行時間の保証ではない。整数集計は最大10,000要素で、i64の範囲内。
