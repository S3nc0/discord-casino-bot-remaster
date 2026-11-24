[English](shop.md) | **日本語**

# ショップ、持ち物、着せ替え、帝愛オークションと闇市の仕様（`shop`）

> 担当：**B2-B** · 画面 ID：`shop`、`inventory` · 台帳の理由：`shop_purchase`、`teiai_auction_buy`、`teiai_market_buy`

## 1. 元ファイル

- `catalogs/shop.yaml`（L1–L366）：アイテムのカタログ全体（静的 60 件 ＋ 動的に生成する発掘品 24 件 ＝ 計 84 件）、種類のラベル、在庫のルール、確認の閾値
- `catalogs/skins.yaml`（L1–L170）：着せ替えスキンの表示文言と、季節の帝愛の馬のアイコン
- `catalogs/teiai.yaml`（L49–L61）：帝愛の押収オークション、帝愛の期間限定市場、闇市のパラメーター
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/shop.py`（L1–L160）：`Item`、`CATALOG`、`RELIC_VALUE`、検索の補助関数、`STOCK_RULES`、`stock_now`、`next_refill_at`
  - `domain/nick.py`（L1–L68）：UTF-16 でのニックネームの称号の付け外しの純粋な処理（`NICK_LIMIT = 32`）
  - `domain/teiai_market.py`（L1–L110）：毎日の期間限定市場の計画、ダッチオークションの価格、闇市の鑑定のロジック
  - `infra/db/shop.py`（L1–L211）：`ShopRepo` の在庫、購入、持ち物、プロフィールと装備、消耗品の準備、破産時の差し押さえ
  - `infra/db/auction.py`（L1–L263）：`AuctionRepo` の押収アイテムのオークションと、帝愛の期間限定市場・闇市
  - `services/shop.py`（L1–L170）：`ShopService` のファサード
  - `cogs/shop/{cog,actions,discord_ops,embeds,views,texts}.py`：`/ショップ` のパネル、Discord のロールとニックネームの同期、2 分間隔のステータス・ニックネームのバックグラウンドタスク
  - `cogs/shared/messages/economy.py`（L11–L14、L98–L107）：失敗メッセージ
- `docs/shop.md`（L1–L129）：元の設計ドキュメント

---

## 2. ショップのカタログとアイテムの種類（`catalogs/shop.yaml`、`domain/shop.py`）

### 2.1 アイテムの種類と一意性
- **`unique = True`**（最大 1 つまで持てる。再購入できない）：`title`、`card_color`、`card_icon`、`skin_dice`、`skin_table`、`color_role`、`collection`。
- **`unique = False`**（重ねて持てる、または即時に使う）：`consumable`、`racing`、`market`、`relic`。
- **装備のスロット**（`ShopRepo.SLOTS`）：`title`、`card_color`、`card_icon`、`skin_dice`、`skin_table`（ほかに、接頭辞 `"ペリカ・"` のサーバーのロールで管理する、Discord の `color_role`）。
- **債務によるプロフィールの凍結**（`infra/db/shop.py:154-173`）：ユーザーの社会的な身分が `KATAGI` でないとき、`get_profile(uid)` は 5 つのスロットをすべて `None`、`frozen = True` で返します（保存された装備は残り、債務、延滞、破産が解消されると再開します）。
- **購入の確認の閾値**：`CONFIRM_FROM = 10,000` ペリカ（`insider_memo` と、`black`（闇市）の出品では、常に確認します）。
- **債務があると通常の買い物ができない**：`debt > 0` は `ShopRepo.purchase` をブロックします（`verb="買い物はできません"`）。

### 2.2 カタログ全体のまとめ（`catalogs/shop.yaml:34-366`）

- **称号（`title`、購入可能 10 件 ＋ 限定 1 件）**：
  - `title_rookie`（`🎲 見習いギャンブラー`、2,000）、`title_broke`（`💸 破産常連`、3,000）、`title_regular`（`🎰 常連`、5,000）、`title_zawa`（`😨 ざわ…ざわ…`、8,000）、`title_underground`（`🕳️ 地下の住人`、12,000）、`title_lucky`（`🍀 強運の持ち主`、20,000）、`title_emperor`（`🔱 地下の帝王`、100,000）、`title_creditor`（`💰 債権王`、500,000）、`title_fixer`（`🕴️ フィクサー`、2,000,000）、`title_100oku`（`💴 百億の男`、10,000,000）。
  - 限定（購入不可）：`title_weekly_king`（`👑週間王者`、0。週間ランキングの 1 位に自動で付与）。
- **カードの色（`card_color`、6 件、すべて 3,000）**：`cardcolor_red`（`0xE74C3C`）、`cardcolor_blue`（`0x3498DB`）、`cardcolor_green`（`0x2ECC71`）、`cardcolor_gold`（`0xF1C40F`）、`cardcolor_purple`（`0x9B59B6`）、`cardcolor_dark`（`0x2C2F33`）。
- **カードのアイコン（`card_icon`、6 件）**：`cardicon_slot`（`🎰`、3,000）、`cardicon_gem`（`💎`、3,000）、`cardicon_fire`（`🔥`、3,000）、`cardicon_moon`（`🌙`、3,000）、`cardicon_dragon`（`🐉`、3,000）、`cardicon_crown`（`👑`、5,000）。
- **消耗品（`consumable`、4 件）**：
  - `daily_double`（`🎟️ デイリー2倍券`、3,000）：持ち物から準備すると `profile.daily_boost += 1` になり、次のデイリーが 2 倍になります。
  - `insurance`（`🛡️ 保険券`、2,000）：持ち物から準備すると `profile.insurance += 1` になり、次に負けたカジノの賭けの 50% を、`INSURANCE_CAP = 1,000` まで返金します。
  - `streak_guard`（`🔥 連続守り券`、16,000、自動で使用）：1 日を逃したままデイリーを受け取るとき、ストリークを守るため自動で消費されます（逃した日 1 日につき 1 枚）。
  - `labor_drink`（`🥤 栄養ドリンコ`、300、`/地下 作業` で自動で使用）：疲労を `60` 回復します。**ユーザーごとの在庫の上限**：`max = 10`、補充は `2.0/時間`（30 分に 1 本、最初は満タンの 10）。
- **競馬（`racing`、3 件、`/競馬 厩舎` で自動で使用）**：
  - `horse_voucher`（`🐎 競走馬（購入券）`、30,000）、`carrot`（`🥕 にんじん`、1,000）、`gold_carrot`（`🥇 金にんじん`、50,000）。
- **帝愛の市場（`market`、1 件、即時に効果が出る。持ち物には入らない）**：
  - `insider_memo`（`🕴️ 裏情報メモ（決算）`、5,000）：次の株の決算の方向を **80% の精度**（20% はガセ）で明かします。1 回の決算につき、1 ユーザーあたり最大 1 件、サーバーあたり最大 5 件（`docs/spec/stocks.ja.md` を参照）。
- **スキン（`skin_dice` と `skin_table`、5 件、見た目だけ）**：
  - `skin_kuro`（30,000）、`skin_gold_dice`（150,000）、`skin_glass_dice`（500,000）、`skin_vip`（300,000）、`skin_numa`（1,000,000）。
- **コレクション（`collection`、9 件、残高カードに表示され、購入価格で総資産に数えられる）**：
  - `col_beer`（`🍺`、13,500）、`col_yakitori`（`🍢`、25,000）、`col_gaishutsu`（`🎫`、50,000）、`col_sunglasses`（`🕶️`、100,000）、`col_teppan`（`🔥`、250,000）、`col_megaphone`（`🎙️`、500,000）、`col_gold_bar`（`🪙`、1,000,000）、`col_stock`（`🏢`、3,000,000）、`col_throne`（`👑`、10,000,000）。
- **カラーロール（`color_role`、12 件、すべて 20,000）**：`role_red`、`role_orange`、`role_yellow`、`role_green`、`role_cyan`、`role_blue`、`role_purple`、`role_pink`、`role_gold`、`role_silver`、`role_black`、`role_white`（権限 0 で、名前が `"ペリカ・<色名>"` のロールを作って付与し、Bot の最上位のロールのすぐ下に置きます）。リマスターは §2.4 を参照。
- **発掘品（`relic`、限定 24 件）**：基本の発掘品 6 種 × 星 4 段階（★0..★3）、価格 `0`、`limited=True`。`docs/spec/relics.ja.md` を参照。

### 2.3 ユーザーごとの在庫の補充の式（`domain/shop.py:139-159`）
- `stock_now(rule, stock, updated, now) = min(rule.max, stock + max(0.0, now - updated) / 3600.0 * rule.per_hour)`
- 使える整数の在庫：`int(exact + 1e-9)`。
- `next_refill_at = None if stock >= rule.max else now + (1.0 - (stock - int(stock))) / rule.per_hour * 3600.0`。

---

### 2.4 名前の色のロール（リマスター、マイグレーション 0014）

持ち主の決定（2026-11-24）で復活：`color_role` を付けると、元の Bot（`cogs/shop/discord_ops.py`）と同じく、本物の Discord のロールでメンバーの名前に色が付きます。

- **スロット。** `color_role` は装備のスロットです（`EQUIP_SLOTS`、`profiles.color_role`）。一度に1色。借金による凍結では隠しません（元の Bot と同じく、借金中も Discord のロールは付いたまま）。チャット：ショップの `🌈 名前の色（ロール）` の売り場（持っている色のメニューと「外す」ボタン）。アクティビティ：持ち物の「付ける／外す」。`POST /api/life/shop/color-role`（`ShopColorRoleRequest` → 任意の `notice` 付きの `ShopColorRoleResponse`）と `ShopView.colorRole`。
- **ロール。** 名前は `COLOR_ROLE_PREFIX` ＋色の名前（`ペリカ・赤`。`catalogs/shop.yaml` の `role_prefix` と品の `name`）、色は品の `value`、権限 0、メンバー一覧で別表示しない、メンションできない。初めて使うときに作り、Bot の最上位のロールのすぐ下へ動かします（間にあるのが自分の色ロールだけなら動かしません）。色を付けると、前に付けていた色のロールは外します。
- **自分のロールだけ。** Bot は作ったロール（`color_roles`）と、各メンバーに付けたロール（`color_role_holders`）を記録し、ほかのロールには触りません。Bot が作っていない同じ名前のロールや、権限が付いた・連携用になった自分のロールは使いません。その色は付けなかったことにし、管理者に名前を変えてもらうよう伝えます（`shop.colorRole.notice.name_taken`）。ロールを付け外しする前に、Bot は毎回サーバーのロールを読み直します。名前が変わった・権限が付いた・連携用になった自分のロールは忘れ（そのロールを付けたメンバーの記録も）、二度と付け外ししません。管理者が別の用途にしたロールは、持っている人にそのまま残ります。このことはサーバーごとに 10 分に1行ログに出ます。Discord で削除された記録済みのロール（Unknown Role）は忘れ、次の同期で作り直します。ロールは削除しません（機能をオフにしたときや、Bot がサーバーを抜けたときも）。
- **コミットの後。** 変更のたびに、同じトランザクションで `color_role_sync` の行を書きます。Discord を呼ぶのはコミットの後だけで、Bot の discord.js クライアントの REST ポート（`ColorRoleRest`：ロール一覧と Bot のメンバー、ロールの作成、色・位置の変更、メンバーへのロールの付け外し）を、サーバーごとのロックの下で使います（同時に付けても、色ごとにロールは1つ）。インテントは `Guilds` だけで、メンバーのキャッシュは使いません。付けた操作はその行をすぐ反映し（待つのは数秒まで）、残りは `shop:color-role-sweep` ジョブ（30 秒ごと）が反映するので、再起動や Discord のエラーは遅れになるだけです。
- **Discord に断られたとき。** ロールの管理の権限がない、または色ロールが Bot の最上位のロールより下にないときは、選んだ色は記録したまま、メンバーにお知らせを1回出し（`missing_permissions`／`hierarchy`）、間隔を空けながらやり直し（30 秒、2 分、10 分、1 時間、その後は1時間ごと。断られている間は10分以上空けます）、ログはサーバーごとに 10 分に1行です。Bot がメンバーに付けた色のロールが、いま付けている色のものでない間は、行は残ります。外す処理はあきらめません。あきらめるのは付ける処理だけで、想定外のエラーが3回続いたときか、1日断られ続けたときです。サーバーやメンバーが見つからないときは、静かに終えます。拒否（denied）されたサーバーの行は、再び承認されるまでそのまま待ちます。すでに付けている色をもう一度選んでも、Discord がそれに合っていれば Discord は呼びません。
- **持ち主が変わるとき。** 最後の1つがなくなると（`Inventory.take`：破産の差し押さえ、プレイヤー間の市場への出品〔預かり〕、そのほかの取り上げ）、同じトランザクションでスロットを空け、同期の行を積むので、ロールが外れます（プロフィールにはもう色がなくても、Bot がそのロールを付けたと記録しているメンバーなら積みます）。買い戻し・競売で落札・受け取りでは、自動で付けません。ペリカは動きません。付けるのは無料です（`tests/invariants/color-role.test.ts`）。

## 3. 称号のニックネームへの付与（`domain/nick.py`、`cogs/shop/cog.py:82-175`）

- メンバーのニックネームに `【<title>】` を付け足します（`NICK_LIMIT = 32` の UTF-16 コードユニット。超えるときは、元の名前を切り詰めて `…` を付け、`max(2, 32 - ulen(suffix))` を残します）。
- `(original, applied)` をサーバーのニックネームの状態に保存し、装備を外すと元のニックネームに戻します。ただしユーザーが手動で編集していた場合は、既知の称号とステータスの接尾辞だけを取り除きます。
- ステータスの身分（`地下労働者`、`多重債務者`、`破産者`）は、装備した見た目の称号より優先され、`2` 分ごとに同期されます（1 ティックにつき、サーバーあたり最大 `200` 人）。

---

## 4. 帝愛の押収オークションと、期間限定市場・闇市（`infra/db/auction.py`、`domain/teiai_market.py`、`catalogs/teiai.yaml:49-61`）

- **カタギのみ**：買い手は `status == KATAGI` である必要があります（`auction_katagi_only`）。収益はすべて、帝愛銀行の収入になります（`bank_income_for`）。
- **出品できるものの条件（`listable(item_id)`）**：`limited`、`collection`、`title`、`price <= 0` を除きます。

### 4.1 押収したアイテムと馬のオークション
- プレイヤーが破産を宣言したとき（持ち物と馬をすべて差し押さえ）に、品が入ります。
- 価格は、経過した日数ごとに直線的に下がります：`teiai.auction_rate(listed_at, now) = max(0.30, 0.80 - 0.10 * int(elapsed / 86400))`（`AUCTION_START = 0.80`、`AUCTION_STEP = 0.10/日`、`AUCTION_FLOOR = 0.30`）。
- 単価：`max(1, round(base_price * rate))`（馬は `horse_voucher` の価格 `30,000` を使います）。古い（安い）ロットから順に売れます（FIFO）。

### 4.2 帝愛の期間限定市場と闇市（`domain/teiai_market.py`）
- UTC の 1 日に 1 回、遅延で計画します（`day_start = now - now % 86400`）。`[day, day + 86400)` の一様にランダムな開始時刻で、**`MARKET_SLOTS_PER_DAY = 3`** 件の出品を作ります：
  - **ダッチオークション（`mode='auction'`、確率 `0.40`）**：`qty = 1`、`start_price = round(price * uniform(0.75, 0.95))`、`end_price = round(start_price * 0.50)`、長さは `uniform(2.0, 6.0)` 時間。価格は `round(start + (end - start) * t)` で直線的に補間し、`>= 1` に収めます。
  - **固定の割引（`mode='fixed'`、確率 `0.60`）**：`start_price = end_price = round(price * uniform(0.65, 0.85))`、長さは `6.0` 時間、`unique` なら `qty = 1`、そうでなければ `randint(1, 5)`。
- **闇市（`black = True`、確率 `0.25`）**：
  - 買うまで鑑定されず、返品できません。常に確認のダイアログが出ます。
  - 購入のとき、`reveal(item_id, rng, pool)` が `u = rng.random()` を引きます：
    - `u < 0.20`（`MARKET_BLACK_WORSE`）：より安いアイテムを厳密にランダムに選びます（同じ `kind` を優先し、なければ出品できる任意のアイテム）。
    - `0.20 <= u < 0.30`（`MARKET_BLACK_BETTER = 0.10`）：より高いアイテムを厳密にランダムに選びます（同じ `kind` を優先し、なければ出品できる任意のアイテム）。
    - `u >= 0.30`（70%）：`SAME`（表示どおりのアイテム）。
    - エッジケース：鑑定の結果が `unique` で、買い手がすでに持っている場合は、`(shown_item_id, "same")` に戻します（`infra/db/auction.py:242-243`）。

---

## 5. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
|---|---|---|
| `shop.cmd.desc` | `🛍️ 景品を見る・買う・身につける（ボタンで操作）` | `cogs/shop/cog.py:180` |
| `shop.buy.ok` | `購入しました` | `cogs/shop/actions.py:276` |
| `shop.buy.err` | `買えませんでした` | `cogs/shop/actions.py:20` |
| `shop.buy.confirm_title` | `購入しますか？` | `cogs/shop/actions.py:191,268` |
| `shop.buy.already_owned` | `すでに持っています。「🎒 持ち物」の画面で身につけられます。` | `cogs/shop/actions.py:241` |
| `shop.buy.limited` | `**{name}** は買えない限定称号です。毎週月曜0時の週間ランキングで、1位の人に贈られます。` | `cogs/shop/actions.py:221` |
| `shop.use.not_owned` | `「🎒 持ち物」の画面で確認できます。` | `cogs/shop/actions.py:288` |
| `shop.use.in_game_blocked` | `ゲームの途中は、消耗品を使えません。終わってからにしてください。` | `cogs/shop/actions.py:306` |
| `shop.use.armed` | `**{name}**: {desc}\n有効な枚数: **{active}枚**` | `cogs/shop/actions.py:317` |
| `shop.use.equipped` | `` **{label}**\n`/ペリカ 残高` で確認できます。 `` | `cogs/shop/actions.py:371,376` |
| `shop.market.black_warn` | `闇市品です。中身は買うまで分からず、返品はできません。` | `cogs/shop/actions.py:136` |
| `shop.market.reveal_worse` | `😱 鑑定の結果……中身は **{label}** でした。闇市なので、返品はできません。` | `cogs/shop/actions.py:153` |
| `shop.market.reveal_better` | `✨ 鑑定の結果……中身はなんと **{label}** でした！` | `cogs/shop/actions.py:155` |
| `shop.market.reveal_same` | `🔍 鑑定の結果、表示どおりの品でした。` | `cogs/shop/actions.py:157` |
| `shop.err.invalid_qty_or_price` | `個数と値段は1以上にしてください。` | `cogs/shared/messages/economy.py:99` |
| `shop.err.out_of_stock` | `在庫が足りません（いまの在庫: {stock}個）{when}。在庫は1人ずつ別々で、時間がたつと補充されます。` | `cogs/shared/messages/economy.py:13` |
| `shop.err.auction_unavailable` | `その品は競売にありません。` | `cogs/shared/messages/economy.py:101` |
| `shop.err.auction_katagi_only` | `競売で買えるのは、借金も延滞もないカタギだけです。` | `cogs/shared/messages/economy.py:102` |
| `shop.err.auction_insufficient_qty` | `その数は残っていません。` | `cogs/shared/messages/economy.py:103` |
| `shop.err.auction_horse_sold` | `その馬は、もう売れてしまいました。` | `cogs/shared/messages/economy.py:104` |
| `shop.err.insider_no_event` | `いま、売れる情報はありません（次の決算が決まるまで、お待ちください）。` | `cogs/shared/messages/economy.py:105` |
| `shop.err.insider_already_bought` | `この決算の裏情報メモは、もう買っています。` | `cogs/shared/messages/economy.py:106` |
| `shop.err.insider_sold_out` | `この決算の裏情報メモは、売り切れです（サーバーで5枚まで）。` | `cogs/shared/messages/economy.py:107` |
| `shop.ledger.purchase` | `購入:{label}[×{qty}]` | `infra/db/shop.py:130` |
| `shop.ledger.auction` | `競売:{label}[×{qty}]` | `infra/db/auction.py:133` |
| `shop.ledger.teiai_market` | `帝愛の出品:{label}[×{qty}]` | `infra/db/auction.py:245` |

---

## 6. 持ち込まないもの

- **リマスターでは未実装：** Discord のニックネームへの称号付与・同期（`domain/nick.py`、§3、ニックネームの管理権限）は移植していません。称号は残高カードとアクティビティのプロフィールに表示されます（`color_role` のロールは移植済み：§2.4）。
