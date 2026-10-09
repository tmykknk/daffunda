# パーサーのテストケース（P-系）

- 関数: parse(text) → 結果。NFKC正規化後の値を返す。かな統一（norm_name）は parser ではなく normalize.ts の責務
- 結果の型: add{items} / remove{items} / list / help / remind_list / reminder{raw} / usage{command} / reserved_word{words} / limit_error / ignore

| ID | 入力 | 期待 |
|---|---|---|
| P-01 | `+牛乳` | add ["牛乳"] |
| P-02 | `+牛乳 パン　卵`（全角スペース含む） | add ["牛乳","パン","卵"] |
| P-03 | `＋牛乳`（全角プラス） | add ["牛乳"] |
| P-04 | `+ 牛乳` | add ["牛乳"] |
| P-05 | `+ｱｲｽ`（半角カナ） | add ["アイス"] |
| P-06 | `+牛乳 牛乳` | add ["牛乳"] |
| P-07 | `+` | usage "add" |
| P-08 | `-` | usage "remove" |
| P-09 | `/` | usage "reminder" |
| P-10 | `-牛乳 卵` | remove ["牛乳","卵"] |
| P-11 | `－牛乳`（全角マイナス） | remove ["牛乳"] |
| P-12 | `-みるく` | remove ["みるく"] |
| P-13 | `牛乳` | ignore |
| P-14 | `牛乳 済` | ignore |
| P-15 | `` （空文字） | ignore |
| P-16 | `リスト` | list |
| P-17 | `りすと` | list |
| P-18 | `リスト追加` | ignore |
| P-19 | `リストを見せて` | ignore |
| P-20 | `+リスト` | reserved_word ["リスト"] |
| P-21 | `+ヘルプ` | reserved_word ["ヘルプ"] |
| P-22 | `ヘルプ` | help |
| P-23 | `リマインド` | remind_list |
| P-24 | `リマインド削除 3` | ignore |
| P-25 | `リマインド削除` | ignore |
| P-26 | `リマインド削除 abc` | ignore |
| P-27 | `/歯医者 明日15時` | reminder raw="歯医者 明日15時" |
| P-28 | `／歯医者　明日１５時` | reminder raw="歯医者 明日15時" |
| P-29 | `+i01 i02 i03 i04 i05 i06 i07 i08 i09 i10 i11 i12 i13 i14 i15 i16 i17 i18 i19 i20 i21` | limit_error |
| P-30 | `+` の後ろに「あ」を51個 | limit_error |
| P-31 | `  +牛乳  `（前後に空白） | add ["牛乳"] |
| P-32 | `+牛乳、パン` | add ["牛乳、パン"]（読点は区切りにしない） |
| P-33 | `-牛乳` と `卵` を改行で区切った2行 | remove ["牛乳","卵"] |
| P-34 | `+牛乳` と `パン` を改行で区切った2行 | add ["牛乳","パン"] |
