[English](README.md) | **日本語**

# Chip

絞り込みや選択肢の選択に使う、小さな、オンとオフを切り替えるコントロールです。M3 の filter chip と assist chip の両方に当たります。

- 高さ 32px、`label-large` の 14px、`outline` のピクセルの枠線。
- 選択すると `aria-pressed="true"` になり、`secondary-container` で塗られ、先頭にチェックのアイコンが出ます。状態が色だけに頼ることはありません。
- チップは `bb-chips` の中に `space-3` の間隔で並べ、折り返させます。横スクロールにはしません。
- クリックできない状態のラベルには、Tag を使います。
