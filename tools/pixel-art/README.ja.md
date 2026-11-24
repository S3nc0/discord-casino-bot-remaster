[English](README.md) | **日本語**

# ドット絵のジェネレーター

アプリのアイコン、スプライト、場面は、どれも手で直さず、ジェネレーターで作っています。コマンドはすべてリポジトリのルートから実行します。どの `ship.js` も実行するたびに同じファイルを書き出すので、ジェネレーターを変えずに実行し直しても差分は出ません。出荷する絵は画像ではなくデータ（行の文字列と、パレットのトークンの凡例）です。どの画面も自分の絵だけを読み込むので、絵はその画面の遅延読み込みのチャンクに入り、ホームと一緒には読み込まれません。

| フォルダ | 描くもの | 説明 |
| --- | --- | --- |
| `icons/` | ゲームアイコン 35 個 | [アイコンと競走馬](#アイコンと競走馬) |
| `horse/` | 8 コマの競走馬 | [アイコンと競走馬](#アイコンと競走馬) |
| `scenes/` | レース、厩舎、配合、闘技場、鉱山、ショップ、持ち物 | [場面](#場面) |
| `casino/` | スロット、チンチロ、ブラックジャック、ルーレット、パチンコ | [カジノの場面](#カジノの場面) |
| `social/` | クイズ、抽選、投票、ミッション、ランキング、発掘品、送金、デイリー、履歴、プロフィール | [ソーシャルとプレイヤーの場面](#ソーシャルとプレイヤーの場面) |
| `finance/` | 銀行、融資、共済、株、暗号資産、会社、マーケット | [金融の場面](#金融の場面) |
| `app-icon/` | アプリアイコン（`512x512`）と Activity 用ファビコン（`32x32`、`16x16`） | [アイコンと競走馬](#アイコンと競走馬) |
| `lib/` | 共通のパレットの名前、8 倍で描く補助、出力先 | |
| `vendor/` | codixel の中核 | |

## アイコンと競走馬

```sh
# アイコン：packages/ui/src/pixel/icon-art.ts と packages/ui/src/styles/bundle.css の色を書き出す
node tools/pixel-art/icons/build.js

# アイコンの確認用シート（ART_OUT に絵の出力先のフォルダが必要）
ART_OUT=/some/folder node tools/pixel-art/icons/sheet.js

# アプリアイコン：docs/images/app-icon-512.png と apps/web/public/favicon-{32,16}.png を書き出す
node tools/pixel-art/app-icon/build.js

# 競走馬：apps/web/src/screens/horse/horse-art.ts と horse.css の毛色と勝負服の色を書き出す
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/horse/ship.js

# 確認用（工程のシート、駆け足の gif、8 つの毛色）と README の gif
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/horse/build.js
node tools/pixel-art/horse/readme.js
```

- `vendor/pixel.js` は MIT ライセンスの codixel の中核です（ライセンスのファイルが隣にあります）。
- 色はすべて、ラウンド 2 のパレット（`design/bitbloom/tokens.css`）の段階です。`lib/palette.js` が段階に名前を付けています。光は 1 つで、左上から当てます。
- `icons/*.js` は、各アイコンを 8 倍の大きさの図形として描き（`lib/hi.js`）、16×16 のマスに切り出します。
- 馬には参考の図版が必要です。`The_Horse_in_Motion_high_res.jpg`（Eadweard Muybridge、1878 年、パブリックドメイン。`CREDITS.ja.md` を参照）をダウンロードし、半分の大きさの PNG に変換して（`sips -s format png -Z 2847`）、`$ART_REF/muy_half.png` として保存します。写真はリポジトリに置きません。

## 場面

レース、厩舎と配合の画面、闘技場、鉱山、ショップ、持ち物の背景と、その中に立つスプライトです。リポジトリのルートから実行します。

```sh
# race-art.ts、stable-art.ts、arena-art.ts（apps/web/src/screens/horse/）と
# mine-art.ts、shop-art.ts、inventory-art.ts（apps/web/src/screens/life/）を書き出し、整形する
ART_REF=/some/folder/ref node tools/pixel-art/scenes/ship.js

# 確認用で出荷しないもの：3〜6 倍のシート、gif、絵を 1 枚ずつ
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/scenes/preview-race.js
#   ... preview-stable.js、preview-portrait.js、preview-arena.js、preview-fighters.js、
#       preview-mine.js、preview-finds.js、preview-shop.js、preview-pack.js（4 倍のシートと gif）

# README の駆け足の gif：夜の芝の上で、土ぼこりを立てて走るレースのコマ
node tools/pixel-art/scenes/readme-gallop.js
```

- どの絵も、同じコードで 2 回描きます。昼のパレット（ライトテーマ）と夜のパレット（ダークテーマ）です。闘技場、鉱山、ショップ、倉庫はどちらでも同じです。`kit.js` がその組を行の文字列と凡例 `文字 -> [ライトのトークン, ダークのトークン]` にまとめ、`packages/ui/src/pixel/` の `PixelScene` が、各文字を今のテーマの `var(--token)` で、整数倍の大きさで塗ります。
- 重なり：馬房と放牧場には奥と手前（扉、柵）があり、そのあいだに馬の肖像が入ります。戦士と鉱夫は別のスプライトで、闘技場と鉱山の上に置きます。
- `race.js` はスタンドと観客、刈り目のある芝のタイル、内ラチ、スターティングゲート、土ぼこり（4 コマ）。`stable.js` は馬房と放牧場。`portrait.js` はレース用スプライトと同じ役割（`.hr-px-<char>`）で描いた馬の頭で、毛色と勝負服のクラスで色が付きます。`arena.js` は闘技場（たいまつ 3 コマ）。`fighters.js` は戦士 16 人の待機と攻撃を、左右両方の向きで。`mine.js` と `miner.js` は鉱山と、4 コマのつるはしの振り。`finds.js` は鉱石 6 種と発掘品 6 種の 16×16 のアイコン。`shop.js` はショップの棚、倉庫、アイテムのアイコンの後ろのタイル。
- 参考資料（`CREDITS.ja.md` を参照。PNG で `$ART_REF` に保存し、リポジトリには置きません）：`head_tb.png`。「Head of a thoroughbred racehorse.jpg」（CC0）を幅 900 px にしたもので、`portrait.js` で使います。戦士と鉱夫の姿勢は、Muybridge の図版 336 と 385（パブリックドメイン）で測った関節の座標を `fighters.js` と `miner.js` に書いてあるので、ファイルは要りません。

## カジノの場面

```sh
# apps/web/src/screens/casino/art/*-art.ts を書き出す（prettier で整形する）
node tools/pixel-art/casino/ship.js

# 確認用：すべての場面の 4 倍のシート、gif、番号付きのコマのシート
ART_OUT=/some/folder node tools/pixel-art/casino/preview.js
```

- `casino/kit.js` は、カジノの色の段階（フェルト、磁器、畳、漆、クローム、真鍮、果物）、3×5 のフォント、球と輪郭の補助を持ちます。`shared.js` はチップ、ペリカのコイン、当たりの光、`symbols.js` はリールの 6 つの絵柄です。
- ゲームごとに 1 つのファイルが場面を描きます：`slots.js`（筐体、リール、回転のぶれ）、`chinchiro.js`（畳、どんぶり、サイコロと転がり）、`cards.js` と `table.js`（J/Q/K の肖像のある 52 枚の表、裏、親の帯、円弧、手すり）、`roulette.js`（盤、玉、賭けのボード）、`pachinko.js`（台の表、釘、チューリップ、ランプ、玉の通り道）。
- `ship.js` は、各スプライトを、パレットのトークンの凡例つきの行の文字列として保存します。変わる部分（電球、レバー、ランプ、チューリップ、光るポケット）は、穴のあいた土台と、状態ごとの小さな重ね絵で出荷します。画面は、それをトークンの変数で塗った SVG のパスとして、1 つの絵の点が整数個の画面の点になる大きさで描きます。
- 一から描いています。参考画像はありません。

## ソーシャルとプレイヤーの場面

クイズ、抽選、投票、ミッション、ランキング、発掘品、送金の画面の上の絵、デイリーボーナスの部屋、履歴の帳簿、プロフィールカードです。参考資料なしでコードで描いています。リポジトリのルートから実行します。

```sh
# quiz-art.ts、lottery-art.ts、poll-art.ts、missions-art.ts、ranking-art.ts、relics-art.ts、
# transfer-art.ts（apps/web/src/screens/life/）、daily-art.ts、history-art.ts
# （apps/web/src/screens/casino/）、profile-art.ts（apps/web/src/screens/profile/）を書き出し、整形する
node tools/pixel-art/social/ship.js

# 確認用で出荷しないもの：すべての場面の 4 倍のシートと gif
ART_OUT=/some/folder node tools/pixel-art/social/preview.js
```

- どの場面も幅 176 点で、1 点を CSS の 2 px で描きます（352 px で、幅 390 px のスマホに収まります）。場面は自分の枠と壁を持つので、ライトとダークのテーマで同じトークンを使い、紺の上でもクリーム色の上でも読めます。
- 動く部分は小さな重ね絵で出荷します。`ship.js` はすべてのコマを全体で描き、止まった絵と違う部分を囲む箱を見つけ、その箱だけを切り出します（置く場所は `*_AT`）。重ね絵の 0 コマ目が止まった絵で、動きを減らす設定ではそれを見せます（`packages/ui/src/pixel/` の `useSceneFrame` と `useSceneOnce` がそこに留まります）。
- `kit.js` の共通の補助：`prop()` は光の当たった部品を 8 倍で描き（`lib/hi.js`）、`frame()` は段々の 2 px の枠、`glaze()` はディザの色かけです。`person.js` は 26×32 の人物（上着、髪、腕の姿勢）です。
- `quiz.js` はクイズ番組のステージ、看板の電球（2 コマ）、司会者。`fx.js` は正解の丸と不正解のバツ（4 コマで、最後が止まった絵）。`lottery.js` はお祭りの窓口と抽選器（6 コマ）、くじ券。`poll.js` は記入台、投票する人と投票箱、票が落ちる動き（8 コマ）。`missions.js` は依頼の掲示板、ピンの頭、完了のはんこ。`ranking.js` は表彰台、トロフィーの輝き（8 コマ）、1〜3 位のメダル。`relics.js` は博物館のホールと、ケースごとに、鉱山の発掘品のスプライト（`scenes/finds.js`）を囲むシルエットと 4 段階の光で、2 つの画面が同じ発掘品を見せます。`transfer.js` は通りと手紙が飛ぶ動き（8 コマ）。`daily.js` は部屋、カレンダーのはんこ、プレゼントの箱（6 コマ）。`history.js` は帳簿の机。`profile.js` はプレイヤーのカードとその枠（`PROFILE_SLOTS`）で、アバターの代わりの胸像は `ship.js` で描いています。
- これらの場面に置く数字（プレート、能力値）は読む用の書体（`--font-body`）を使います。見出しの書体は、小さい大きさで 2 と 5 が 8 に近すぎるためです。

## 金融の場面

銀行、融資、共済、株、暗号資産、会社、マーケットの場面と、銘柄のコイン、会社のバッジ、ハンマー、配当のコインです。

```sh
# apps/web/src/screens/finance/art/*.ts を書き出す（prettier で整形する）
node tools/pixel-art/finance/ship.js

# 確認用：両方のテーマのすべての場面、スプライトのシート、アニメーションの GIF と
# コマのシート（ART_THEME=day か night で、GIF のテーマを 1 つ選べます）
ART_OUT=/some/folder node tools/pixel-art/finance/preview.js
ART_OUT=/some/folder node tools/pixel-art/finance/sheet.js
ART_OUT=/some/folder node tools/pixel-art/finance/anim.js
```

- `finance/*.js` は、各場面を同じ形で 2 回、ライト（昼）とダーク（夜）で描きます。2 つが違うと `lib.js` がエラーにします。各点はパレットのトークンを持つので、出荷する行は文字ごとに [ライト, ダーク] のトークンの組を指し、画面は CSS でどちらかを選びます。動く部分は、変わる点だけを小さく切り出して出荷します。
- 一から描いています。参考画像はありません。
