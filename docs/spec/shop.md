**English** | [日本語](shop.ja.md)

# Shop, Inventory, Cosmetics & Teiai Auction/Market Specification (`shop`)

> Planned Owner: **B2-B** · Screen IDs: `shop`, `inventory` · Ledger Reasons: `shop_purchase`, `teiai_auction_buy`, `teiai_market_buy`

## 1. Source Files

- `catalogs/shop.yaml` (L1–L366): complete item catalog (60 static items + 24 dynamically generated relic items = 84 total), kind labels, stock rules, confirmation threshold
- `catalogs/skins.yaml` (L1–L170): cosmetic skin rendering texts & seasonal house horse icons
- `catalogs/teiai.yaml` (L49–L61): Teiai seized auction & Teiai timed market / black market parameters
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/shop.py` (L1–L160): `Item`, `CATALOG`, `RELIC_VALUE`, lookup helpers, `STOCK_RULES`, `stock_now`, `next_refill_at`
  - `domain/nick.py` (L1–L68): pure UTF-16 nickname title affixing/stripping (`NICK_LIMIT = 32`)
  - `domain/teiai_market.py` (L1–L110): daily timed market planner, Dutch auction pricing, black-market reveal logic
  - `infra/db/shop.py` (L1–L211): `ShopRepo` stock, purchase, inventory, profile/equip, consumable arming, bankruptcy seizure
  - `infra/db/auction.py` (L1–L263): `AuctionRepo` seized item auction & Teiai timed/black market
  - `services/shop.py` (L1–L170): `ShopService` facade
  - `cogs/shop/{cog,actions,discord_ops,embeds,views,texts}.py`: `/ショップ` panel, Discord role/nick sync, 2-minute status-nick background task
  - `cogs/shared/messages/economy.py` (L11–L14, L98–L107): failure messages
- `docs/shop.md` (L1–L129): original design doc

---

## 2. Shop Catalog & Item Kinds (`catalogs/shop.yaml`, `domain/shop.py`)

### 2.1 Item Kinds & Uniqueness
- **`unique = True`** (max 1 owned, cannot rebuy): `title`, `card_color`, `card_icon`, `skin_dice`, `skin_table`, `color_role`, `collection`.
- **`unique = False`** (stackable or instant): `consumable`, `racing`, `market`, `relic`.
- **Equipment slots** (`ShopRepo.SLOTS`): `title`, `card_color`, `card_icon`, `skin_dice`, `skin_table` (plus Discord `color_role` managed via guild roles with prefix `"ペリカ・"`).
- **Debt freeze on profile** (`infra/db/shop.py:154-173`): when user's social rank != `KATAGI`, `get_profile(uid)` returns all 5 slots as `None` and `frozen = True` (stored equipment persists and resumes once debt/overdue/bankruptcy clears).
- **Purchase confirmation threshold**: `CONFIRM_FROM = 10,000` Pelica (and always confirmed for `insider_memo` and `black` market listings).
- **Debt blocks regular shopping**: `debt > 0` blocks `ShopRepo.purchase` (`verb="買い物はできません"`).

### 2.2 Complete Catalog Summary (`catalogs/shop.yaml:34-366`)

- **Titles (`title`, 10 buyable + 1 limited)**:
  - `title_rookie` (`🎲 見習いギャンブラー`, 2,000), `title_broke` (`💸 破産常連`, 3,000), `title_regular` (`🎰 常連`, 5,000), `title_zawa` (`😨 ざわ…ざわ…`, 8,000), `title_underground` (`🕳️ 地下の住人`, 12,000), `title_lucky` (`🍀 強運の持ち主`, 20,000), `title_emperor` (`🔱 地下の帝王`, 100,000), `title_creditor` (`💰 債権王`, 500,000), `title_fixer` (`🕴️ フィクサー`, 2,000,000), `title_100oku` (`💴 百億の男`, 10,000,000).
  - Limited (not buyable): `title_weekly_king` (`👑週間王者`, 0 — auto-granted to #1 in weekly ranking).
- **Card Colors (`card_color`, 6 items, all 3,000)**: `cardcolor_red` (`0xE74C3C`), `cardcolor_blue` (`0x3498DB`), `cardcolor_green` (`0x2ECC71`), `cardcolor_gold` (`0xF1C40F`), `cardcolor_purple` (`0x9B59B6`), `cardcolor_dark` (`0x2C2F33`).
- **Card Icons (`card_icon`, 6 items)**: `cardicon_slot` (`🎰`, 3,000), `cardicon_gem` (`💎`, 3,000), `cardicon_fire` (`🔥`, 3,000), `cardicon_moon` (`🌙`, 3,000), `cardicon_dragon` (`🐉`, 3,000), `cardicon_crown` (`👑`, 5,000).
- **Consumables (`consumable`, 4 items)**:
  - `daily_double` (`🎟️ デイリー2倍券`, 3,000): armed via inventory → `profile.daily_boost += 1`, doubles next daily claim.
  - `insurance` (`🛡️ 保険券`, 2,000): armed via inventory → `profile.insurance += 1`, refunds 50% of next losing casino bet up to `INSURANCE_CAP = 1,000`.
  - `streak_guard` (`🔥 連続守り券`, 16,000, auto-used): automatically consumed on daily claim when missing a day to preserve streak (1 per missed day).
  - `labor_drink` (`🥤 栄養ドリンコ`, 300, auto-used in `/地下 作業`): restores `60` fatigue. **Per-user stock limit**: `max = 10`, refills `2.0/hour` (1 every 30 min, starts full at 10).
- **Racing (`racing`, 3 items, auto-used in `/競馬 厩舎`)**:
  - `horse_voucher` (`🐎 競走馬（購入券）`, 30,000), `carrot` (`🥕 にんじん`, 1,000), `gold_carrot` (`🥇 金にんじん`, 50,000).
- **Teiai Market (`market`, 1 item, instant effect — not stored in inventory)**:
  - `insider_memo` (`🕴️ 裏情報メモ（決算）`, 5,000): reveals next stock earnings direction with **80% accuracy** (20% fake); max 1/user/earnings and 5/guild/earnings (see `docs/spec/stocks.md`).
- **Skins (`skin_dice` & `skin_table`, 5 items, cosmetic only)**:
  - `skin_kuro` (30,000), `skin_gold_dice` (150,000), `skin_glass_dice` (500,000), `skin_vip` (300,000), `skin_numa` (1,000,000).
- **Collections (`collection`, 9 items, displayed on balance card, counted in net worth at purchase price)**:
  - `col_beer` (`🍺`, 13,500), `col_yakitori` (`🍢`, 25,000), `col_gaishutsu` (`🎫`, 50,000), `col_sunglasses` (`🕶️`, 100,000), `col_teppan` (`🔥`, 250,000), `col_megaphone` (`🎙️`, 500,000), `col_gold_bar` (`🪙`, 1,000,000), `col_stock` (`🏢`, 3,000,000), `col_throne` (`👑`, 10,000,000).
- **Color Roles (`color_role`, 12 items, all 20,000)**: `role_red`, `role_orange`, `role_yellow`, `role_green`, `role_cyan`, `role_blue`, `role_purple`, `role_pink`, `role_gold`, `role_silver`, `role_black`, `role_white` (creates/assigns 0-permission role named `"ペリカ・<色名>"` placed right below bot's top role). Remaster: see §2.4.
- **Relics (`relic`, 24 limited items)**: 6 base relics × 4 star tiers (★0..★3), price `0`, `limited=True`. See `docs/spec/relics.md`.

### 2.3 Per-User Stock Refill Formula (`domain/shop.py:139-159`)
- `stock_now(rule, stock, updated, now) = min(rule.max, stock + max(0.0, now - updated) / 3600.0 * rule.per_hour)`
- Available integer stock: `int(exact + 1e-9)`.
- `next_refill_at = None if stock >= rule.max else now + (1.0 - (stock - int(stock))) / rule.per_hour * 3600.0`.

---

### 2.4 Name colour roles (remaster, migration 0014)

Restored by owner decision 2026-11-24: wearing a `color_role` colours the member's name with a real Discord role, as the original bot did (`cogs/shop/discord_ops.py`).

- **Slot.** `color_role` is an equip slot (`EQUIP_SLOTS`, `profiles.color_role`), one colour at a time. It is not hidden by the debt freeze (the Discord role stays on while in debt, as in the original). Chat: the shop's `🌈 Name colors` category (a menu of the colours you own and a "take off" button). Activity: Wear / Take off in the inventory; `POST /api/life/shop/color-role` (`ShopColorRoleRequest` → `ShopColorRoleResponse` with an optional `notice`), and `ShopView.colorRole`.
- **Role.** Named `COLOR_ROLE_PREFIX` + the colour's name (`ペリカ・赤`, from `role_prefix` and the item's `name` in `catalogs/shop.yaml`), colour = the item's `value`, permissions 0, not hoisted, not mentionable, created on first use and moved directly below the bot's highest role unless only our colour roles sit between them. Wearing a colour takes the member's previous colour role off.
- **Ours only.** The bot records every role it creates (`color_roles`) and the role it put on each member (`color_role_holders`), and never touches another role. A same-name role it did not create, or one of ours that gained a permission or is managed, is refused: the choice is undone and the member is told to ask an admin to rename it (EN/JA `shop.colorRole.notice.name_taken`). A stored role deleted in Discord (unknown role) is forgotten and recreated on the next sync. Roles are never deleted, not even when the feature is off or the bot leaves.
- **After commit.** Every change writes a `color_role_sync` row in its own transaction; Discord is called only after the commit, through a REST port (`ColorRoleRest`: list roles and the bot's member, create role, edit colour/position, add/remove a member's role) on the bot's discord.js client, with a per-guild lock (one role per colour even for concurrent equips). Only the `Guilds` intent; no member cache. The equip applies its row at once (waiting a few seconds at most); the `shop:color-role-sweep` job (every 30 s) applies the rest, so a restart or a Discord error only delays it.
- **When Discord refuses.** Without Manage Roles, or with the colour role not below the bot's highest role, the choice stays recorded, the member sees one notice (`missing_permissions` / `hierarchy`), the row is retried every 10 minutes for a day and the server logs one line per guild per 10 minutes. Other errors are retried 3 times. An unknown guild or member ends the row quietly.
- **Ownership.** When the last copy leaves (`Inventory.take`: bankruptcy seizure, listing on the player market (escrow), any removal), the slot is cleared and a sync row is queued in that same transaction, so the role comes off. Buying it back, winning it at an auction or receiving it does not equip it. No Pelica moves: wearing is free (`tests/invariants/color-role.test.ts`).

## 3. Title Nickname Affixing (`domain/nick.py`, `cogs/shop/cog.py:82-175`)

- Appends `【<title>】` to member nickname (`NICK_LIMIT = 32` UTF-16 code units; if exceeded, truncates base name and appends `…` leaving `max(2, 32 - ulen(suffix))`).
- Stores `(original, applied)` in guild nick state so unequipping restores original nickname unless user manually edited it (in which case only known title/status suffixes are stripped).
- Status ranks (`地下労働者`, `多重債務者`, `破産者`) override equipped cosmetic titles and are synced every `2` minutes (up to `200` targets/guild per tick).

---

## 4. Teiai Seized Auction & Timed / Black Market (`infra/db/auction.py`, `domain/teiai_market.py`, `catalogs/teiai.yaml:49-61`)

- **Katagi-only**: buyers must have `status == KATAGI` (`auction_katagi_only`). All revenue goes to Teiai Bank income (`bank_income_for`).
- **Listable filter (`listable(item_id)`)**: excludes `limited`, `collection`, `title`, and `price <= 0`.

### 4.1 Seized Items & Horses Auction
- Populated when a player declares bankruptcy (all belongings & horses seized).
- Price decays linearly each elapsed day: `teiai.auction_rate(listed_at, now) = max(0.30, 0.80 - 0.10 * int(elapsed / 86400))` (`AUCTION_START = 0.80`, `AUCTION_STEP = 0.10/day`, `AUCTION_FLOOR = 0.30`).
- Unit price: `max(1, round(base_price * rate))` (horses use `horse_voucher` price `30,000`). Oldest (cheapest) lots sell first (FIFO).

### 4.2 Teiai Timed Market & Black Market (`domain/teiai_market.py`)
- Planned lazily once per UTC day (`day_start = now - now % 86400`), generating **`MARKET_SLOTS_PER_DAY = 3`** listings at uniform random start times in `[day, day + 86400)`:
  - **Dutch Auction (`mode='auction'`, prob `0.40`)**: `qty = 1`, `start_price = round(price * uniform(0.75, 0.95))`, `end_price = round(start_price * 0.50)`, duration `uniform(2.0, 6.0)` hours. Price interpolates linearly `round(start + (end - start) * t)` clamped to `>= 1`.
  - **Fixed Discount (`mode='fixed'`, prob `0.60`)**: `start_price = end_price = round(price * uniform(0.65, 0.85))`, duration `6.0` hours, `qty = 1` if unique else `randint(1, 5)`.
- **Black Market (`black = True`, prob `0.25`)**:
  - Unappraised until purchased; non-refundable. Always triggers confirmation dialog.
  - On purchase, `reveal(item_id, rng, pool)` rolls `u = rng.random()`:
    - `u < 0.20` (`MARKET_BLACK_WORSE`): randomly picks a strictly cheaper item (same `kind` preferred, else any listable item).
    - `0.20 <= u < 0.30` (`MARKET_BLACK_BETTER = 0.10`): randomly picks a strictly more expensive item (same `kind` preferred, else any listable item).
    - `u >= 0.30` (70%): `SAME` (displayed item).
    - Edge case: if revealed item is `unique` and buyer already owns it, falls back to `(shown_item_id, "same")` (`infra/db/auction.py:242-243`).

---

## 5. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
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

## 6. Not ported

- **Not in the remaster:** Discord nickname title affixing/syncing (`domain/nick.py`, §3, Manage Nicknames); titles show on the balance card and Activity profile. (`color_role` roles are ported: §2.4.)
