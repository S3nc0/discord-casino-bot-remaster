[English](README.md) | **日本語**

# Progress

何かがどこまで進んだかを示す、区切り付きのピクセルのバーです。M3 の linear progress indicator に当たります。

- トラック: 高さ 16px、`surface-container-highest`、`outline` のピクセルの枠線。塗り: `primary` の 10px のセグメントを、2px の隙間をあけて並べます。
- `--success` にすると、何かが完了したときにセグメントが `success` になります。不確定の表示は 12 コマで進み、動きを減らす設定では、静止した中間調のバーになります。
- 必ずラベルを付け、数字がわかるときは数字も添えます（「45%」、「10 / 10」）。
