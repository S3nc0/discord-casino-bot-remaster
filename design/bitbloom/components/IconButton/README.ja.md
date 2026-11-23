[English](README.md) | **日本語**

# IconButton

ピクセルのアイコンを 1 つ持つ、48px の正方形のボタンです。検索、お気に入り、閉じるなど、場所を取らない操作や、繰り返し使う操作に使います。

- バリアント: M3 と同じく、standard（`bb-icon-btn`）、`--filled`、`--tonal`、`--outlined`。
- トグルは `aria-pressed` を設定します。押された状態では、アイコンが `primary` になります。
- 必ず `aria-label` を付けます。アイコンが誰にでも通じるものでなければ、ツールチップも付けます。
- アイコンは、12×12 のピクセルアートを 24px で描き、`currentColor` で塗ります。
