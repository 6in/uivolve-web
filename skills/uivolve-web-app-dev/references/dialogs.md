# ダイアログ

[独自ダイアログ契約](../../../docs/dialogs.md)と[定義](../../../public/screens/dialogs.yaml)・[Rhai](../../../public/screens/dialogs.rhai)を参照する。

- alert(message[, handler])、confirm(message, handler)、prompt(message[, defaultValue], handler)は依頼だけで、回答はhandler(state, response)へ届く。`if confirm(...)`やpromptの戻り値の代入をしない。
- 回答のok/data/error/operation/cancelledを使う。confirmのキャンセルはfalse、promptのキャンセルはnull（unit）、空文字のOKは空文字。成功・キャンセル・失敗で依頼時のloadingを戻す。
- 末尾のoptions mapでiconを指定できる。alert(message, options)はhandler省略用。info/success/warning/error/question/input/none、または`#{src: "../assets/icon.svg", alt: "説明"}`、`#{text: "🚀", alt: "説明"}`を使う。
- 本文・初期値・回答は各4096 UTF-8バイト、文字アイコン64・画像URL2048・alt160バイト以内。HTML/SVGソースやJWT付き画像取得は未対応。画像の相対URLは画面定義URLが基準。
- WASMがFIFO・共有下書き・回答・Scene構成を管理する。DOMとCanvasが各領域内へ描画し、背景操作は遮断する。Canvas入力中はIME用のネイティブ入力を使う。
- WebMCPの表示中key/actionsから通常のui_dispatchで操作する。内部keyをDSLへ書かない。任意フォーム・タイトル設定・専用回答ツールは未実装。
