[English](README.md) | **日本語**

# Checkbox

一覧から、いくつでも選べる選択肢のための、ピクセルで描いたチェックボックスです。

- `bb-check` のラベルの中に、ネイティブの `input type="checkbox"` を置きます。48px の行全体が操作の対象です。
- ボックスは 12×12 ピクセルのマスクを 24px で描いたものです。オフのときは `on-surface-variant`、オンのときは、チェックを抜いた `primary` の塗りのボックスになります。
- 関連する選択肢は、凡例（legend）付きの `bb-group` の fieldset にまとめます。
- すぐに効く 1 つの設定には、Switch を使います。
