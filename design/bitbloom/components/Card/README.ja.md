[English](README.md) | **日本語**

# Card

セーブスロット、アイテム、友だちなど、1 つの対象を入れる入れ物です。ピクセルアートのメディアと操作を、必要に応じて付けられます。

- Elevated（`bb-card`）: `surface-container-low`、`elevation-1`、`outline-variant` の枠線。クリックできるカードは、ホバーで `elevation-2` に浮き上がります。
- Filled（`--filled`）: `surface-container-highest`、影なし。カードを並べた中で、内容をまとめるときに使います。
- Outlined（`--outlined`）: `surface` に `outline` の枠線。控えめなヒントに使います。
- 余白は `space-4`、タイトルは `title-medium`、メタ情報は `body-small`、操作は右下に置きます。
- メディアは 2:1 で端から端まで広げます。ピクセルアートには `image-rendering: pixelated` が必要です。
- カードを入れ子にしたり、1 枚に 3 つ以上の操作を置いたりしないでください。
