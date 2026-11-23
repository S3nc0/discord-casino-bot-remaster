[English](README.md) | **日本語**

# NavigationBar

スマホで、3〜5 個のトップレベルの行き先を行き来するための、下部のバーです。Badge も含みます。

- `surface-container` の塗りで、すべての項目にアイコンとラベルを付けます（ラベルは隠しません）。
- 今のページには `aria-current="page"` が付き、アイコンの後ろに `secondary-container` のピクセルのピルが出ます。
- バッジ: `bb-badge`（件数。`error` の塗りで、最大は「99+」）か `bb-badge--dot`。スクリーンリーダーには、意味も必ず伝えます（「新着 3 件」）。
