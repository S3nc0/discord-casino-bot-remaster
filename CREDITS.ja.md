[English](CREDITS.md) | **日本語**

# クレジットとサードパーティの表示

このプロジェクトに同梱した素材は、すべてローカルで動き、実行時に外部の URL を一切使いません。下の項目は、どれも同じ欄（作者、ライセンス、出典、使い方）を持ちます。参考資料はそれぞれ 1 回だけ載せています。

## 元の Bot

### discord-casino-bot

- **作者：** fatcorn753
- **ライセンス：** MIT License（両方の作者を [LICENSE](LICENSE) に記載しています）
- **出典：** https://github.com/fatcorn753/discord-casino-bot
- **使い方：** ゲームのルールと数値のもとです。このプロジェクトはそのハードフォークで、TypeScript で書き直しました。元の Python のコードはツリーにはなく、v1.0.0 より前の git 履歴にあります。`docs/spec/` の挙動の仕様がその内容を説明しています。

## 音

### ZzFX (Zuper Zmall Zound Zynth)

- **作者：** Frank Force (KilledByAPixel)
- **ライセンス：** MIT License（`Copyright (c) 2019 Frank Force`）
- **出典：** https://github.com/KilledByAPixel/ZzFX
- **使い方：** TypeScript の合成エンジンを `packages/ui/src/audio/zzfx.ts` に取り込み、`packages/ui/src/audio/sfx.ts` のレトロな効果音をすべてこれで鳴らしています。

録音した音声は同梱していません。[今後の音声素材](#今後の音声素材) を見てください。

## ドット絵の参考資料

写真はリポジトリに同梱も保存もしていません。入っているのは、生成したピクセルの行だけです。絵を作り直すときは、`tools/pixel-art/README.ja.md` の手順で参考資料を `$ART_REF` にダウンロードします。

### The Horse in Motion

- **作者：** Eadweard Muybridge（1830〜1904）
- **ライセンス：** パブリックドメイン（1878 年の発表。作者は 1904 年に死去）。米国議会図書館の版画写真部による、著作権のない複製です。
- **出典：** https://commons.wikimedia.org/wiki/File:The_Horse_in_Motion_high_res.jpg（「Sallie Gardner」が 1:40 のペースで Palo Alto のトラックを走る姿、1878 年 6 月 19 日）
- **使い方：** 3〜10 コマ目から、レース用スプライト（`apps/web/src/screens/horse/horse-art.ts`）の 8 つの姿勢を作りました。輪郭を切り抜き、体の部位に分け、Bitbloom のパレットで光と色を付け直しています。12 コマ目は、馬の頭のアイコンの比率の参考にしました。騎手、毛色、たてがみ、尾、勝負服はコードで描いています。

### Two men in pelvis clothes boxing（Animal Locomotion, plate 336, "Boxing, open hand"）

- **作者：** Eadweard Muybridge（1830〜1904）
- **ライセンス：** パブリックドメイン（1887 年の発表。作者は 1904 年に死去）。南カリフォルニア大学図書館によるスキャンです。
- **出典：** https://commons.wikimedia.org/wiki/File:Two_men_in_pelvis_clothes_boxing_(rbm-QP301M8-1887-336).jpg
- **使い方：** 7 コマ目（構え）と 11 コマ目（パンチ）から、闘技場の戦士 16 人（`apps/web/src/screens/horse/arena-art.ts`）の待機と攻撃の姿勢を作りました。関節の座標を測って `tools/pixel-art/scenes/fighters.js` に書いています。顔、髪、服、色はコードで描き、戦士はそれぞれ独自のデザインです。

### Nude farmer using a pick（Animal Locomotion, plate 385, "Farmer, using a pick"）

- **作者：** Eadweard Muybridge（1830〜1904）
- **ライセンス：** パブリックドメイン（1887 年の発表。作者は 1904 年に死去）。南カリフォルニア大学図書館によるスキャンです。
- **出典：** https://commons.wikimedia.org/wiki/File:Nude_farmer_using_a_pick_(rbm-QP301M8-1887-385).jpg
- **使い方：** 4、6、8、10 コマ目から、鉱夫がつるはしを振る 4 つの姿勢（`apps/web/src/screens/life/mine-art.ts`）を作りました。関節の座標を測って `tools/pixel-art/scenes/miner.js` に書いています。服、ヘルメット、つるはしはコードで描いています。

### Head of a thoroughbred racehorse

- **作者：** Mjitomobile（Wikimedia Commons のユーザー）
- **ライセンス：** CC0 1.0 Universal（パブリックドメインの宣言）
- **出典：** https://commons.wikimedia.org/wiki/File:Head_of_a_thoroughbred_racehorse.jpg
- **使い方：** 頭と首の輪郭と光の当たり方を、馬房と放牧場の馬の肖像（`apps/web/src/screens/horse/stable-art.ts`）に使いました。頭絡、毛色、たてがみはコードで描いています。

### 参考資料なしで描いたもの

ほかのドット絵は、すべて参考画像なしで `tools/pixel-art/` のコードで描いています。ゲームのアイコン 35 個（`packages/ui/src/pixel/icon-art.ts`）、レース場、馬房、放牧場、闘技場、鉱山、ショップ、倉庫の背景と鉱石と発掘品（`tools/pixel-art/scenes/`）、カジノの場面、トランプ、サイコロ、チップ、リールの絵柄（`tools/pixel-art/casino/`）、クイズ、抽選、投票、ミッション、ランキング、発掘品、送金、デイリーボーナス、履歴、プロフィールの場面（`tools/pixel-art/social/`）、そして金融の場面、コイン、会社のバッジ、ハンマー、配当のコイン（`tools/pixel-art/finance/`）です。

## ツール

### ドット絵のキット codixel（`core/pixel.js`）

- **作者：** mankidev
- **ライセンス：** MIT License（`Copyright (c) 2026 mankidev`）、ファイルは `tools/pixel-art/vendor/LICENSE`
- **出典：** `tools/pixel-art/vendor/pixel.js` に取り込んだコピー。ライセンスのファイルを隣に置いています。
- **使い方：** 生成スクリプトで PNG、GIF、シート、輪郭を作るのに使い、絵を作り直せるようにしています。アプリのバンドルには入りません。

## フォント

### Pixelify Sans

- **作者：** Stefie Justprince
- **ライセンス：** SIL Open Font License 1.1（`OFL-1.1`）
- **出典：** https://github.com/eifetx/Pixelify-Sans と https://fonts.google.com/specimen/Pixelify+Sans。`@fontsource/pixelify-sans`（https://fontsource.org/fonts/pixelify-sans）で取り込んでいます。
- **使い方：** 自前で配信するピクセルの見出し書体（`--font-display`）で、display、headline、title のスタイルに使います。数字にはこの書体の字形を使いません（2 が 8 に、5 が S に見えるため）。数字は下の Atkinson Hyperlegible で表示します。

### Atkinson Hyperlegible

- **作者：** Braille Institute of America（Applied Design Works と共同）
- **ライセンス：** SIL Open Font License 1.1（`OFL-1.1`）
- **出典：** https://www.brailleinstitute.org/freefont/、https://github.com/googlefonts/atkinson-hyperlegible、https://fonts.google.com/specimen/Atkinson+Hyperlegible。`@fontsource/atkinson-hyperlegible`（https://fontsource.org/fonts/atkinson-hyperlegible）で取り込んでいます。
- **使い方：** 自前で配信する本文の書体（`--font-body`）で、文章と操作部品、そしてすべての数字に使います。`--font-numeric` と、見出しの中の数字に使う `Bitbloom Numerals` の書体（`packages/ui/src/styles/numerals.css`）は、同じ同梱ファイルを使っています。ほかのフォントファイルは配信しません。

## 今後の音声素材

録音した音声（たとえば音楽のループや環境音）を足すときは：

1. **CC0 1.0 Universal**（または、同じくらい自由なパブリックドメインか MIT）の素材だけを使います。
2. ファイルはワークスペースの中に同梱し、実行時に外部の URL を参照しないでください。
3. 下の表に、素材のパス、題名と作者、ライセンス、出典の URL を書き足します。

| 素材のパス | 題名と作者 | ライセンス | 出典の URL |
| --- | --- | --- | --- |
| *（まだなし）* | — | — | — |
