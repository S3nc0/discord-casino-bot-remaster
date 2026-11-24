**English** | [日本語](player-market.ja.md)

# Player Market, Auctions & Escrow (P2P) Specification

Planned owner: `B3` | Screen IDs: `market`, `market-create`, `market-mine` (`packages/shared/src/ids.ts`) | Feature toggle: `p2p`

> Entry Point: No standalone slash command exists in legacy; accessed via `/ショップ` → `🕴️ 帝愛の競売` → `🤝 プレイヤーの出品` / `📤 出品する` / `📋 自分の取引` (`cogs/p2p/cog.py:1-8`), plus persistent `🔍 見る・買う・入札` buttons on announcement channel posts.

## Source Files
- `catalogs/economy.yaml:66-92`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/p2p.py:1-77`
  - `infra/db/p2p.py:1-454`
  - `services/p2p.py:1-100`
  - `cogs/p2p/cog.py:1-318`
  - `cogs/p2p/embeds.py:1-93`
  - `cogs/p2p/views.py:1-263`
  - `cogs/shared/messages/economy.py:85,169-190`
  - `cogs/shared/messages/notices.py:46-62,72-75`

## Rules & Exact Numbers

### 1. Constants & Limits (`catalogs/economy.yaml:66-92`, `domain/p2p.py:15-38`)
- `FEE_RATE = 0.05` (`int(price * 0.05)` deducted from seller proceeds, credited to Teiai Bank via `bank_income_for`).
- `MAX_ACTIVE = 5` concurrent active listings per seller.
- `FIXED_DAYS = 7` days (listing expiry for fixed-price listings).
- `AUCTION_HOURS = [1, 6, 24, 72]` allowed auction durations (hours).
- Auction bidding:
  - `MIN_INCREMENT_RATE = 0.05`, `MIN_INCREMENT = 100`.
  - `min_next_bid(start, current) = start` if `current <= 0`, else `current + max(100, math.ceil(current * 0.05))`.
  - Anti-snipe: `SNIPE_SECONDS = 300` (5 min); if `end_at - now < 300`, extends `end_at = max(end_at, now + 300)`.
- `PAIR_DAILY_LIMIT = 100_000` Pelica rolling 24h volume cap between any unordered pair `{A, B}`, **shared** with Kyosai unit P2P transfers (`market_listings` sold + `kyosai_offers` done in last 86,400s).
- `CONFIRM_FROM = 10_000` (buy/bid `>= 10,000` prompts 30s `ConfirmView`).
- `ESCROW_OWNER = -3` (`horses.owner_id` set to `-3` while a horse is listed in escrow — hides from stable and blocks race entries).

### 2. Tradable Assets & Price Bounds (`domain/p2p.py:40-60`)
- **Tradable items**:
  - Relics (`kind == "relic"`): tradable iff `item_id in shop.RELIC_VALUE` (even though `price == 0` and `limited == True`).
  - Shop items: tradable iff `price > 0`, `not limited`, and `kind ∈ {consumable, racing, card_color, card_icon, skin_dice, skin_table, color_role}`.
  - Titles, collections, limited items, and Teiai black-market exclusives are NOT tradable.
- **Tradable horses**: owned by seller AND not entered in any `entry`/`betting` race (`p2p_horse_in_race`).
- **Price Range Guards (Anti-RMT / Transfer Bypass)**:
  - `MIN_PRICE = 100`, `ITEM_PRICE_RANGE = [0.10, 5.0]`, `HORSE_PRICE_RANGE = [3_000, 300_000]`.
  - For horses: `[3_000, 300_000]`.
  - For items: `base = RELIC_VALUE.get(item_id, item.price) * max(1, qty)`.
    `high = min(100_000, math.floor(base * 5.0))`, `low = min(max(100, math.ceil(base * 0.10)), high)`.

### 3. Escrow, Buying, Bidding & Settlement (`infra/db/p2p.py:106-403`)
- **Listing (`p2p_list`)**:
  - Blocked if seller is in bankruptcy grace (`grace_lock`) or has `>= 5` active listings.
  - Items: atomically deducts `qty` from `inventory`; if item is equipped in `profile.{card_color|card_icon|skin_dice|skin_table}` and remaining `qty <= 0`, auto-unequips it.
  - Horses: sets `horses.owner_id = -3`.
  - Posts public embed to `announce_channel` with persistent `ListingButton` (`p2p:open:<id>`).
- **Buyer Checks (`_p2p_buyer_check`)**:
  - Cannot buy/bid own listing (`p2p_self_buy`).
  - Buyer must be `🟢 カタギ` (`p2p_katagi_only`) AND not in grace (`grace_lock`).
  - Cash `>= amount`.
  - Can receive: for horses, `horse_count < MAX_HORSES (3)`; for `unique` items, must not already own (`already_owned`).
  - Pair 24h limit: `pair_total + amount <= 100,000`.
- **Fixed-Price Buy (`p2p_buy`)**:
  - Atomic: deducts `price` from buyer (`取引:購入（{label}）`), pays `price - fee` to seller (`取引:売却（{label}）`, `income = price - fee` → triggers 30% debt withholding if seller later became indebted!), credits `fee` to bank, transfers item/horse to buyer, marks `sold`.
- **Auction Bid (`p2p_bid`)**:
  - Cannot outbid self (`p2p_already_highest_bidder`).
  - Refunds previous `bidder_id` (`取引:入札の返金（{label}）`) + sends `p2p_outbid` notice.
  - Escrows new `amount` from bidder (`取引:入札（{label}）`), updates `bid`, `bidder_id`, and anti-snipe `end_at`.
- **Cancellation (`p2p_cancel`)**:
  - Seller can cancel active fixed listings OR auctions with **no bids** (`bidder_id == 0`). Once a bid exists, seller cannot cancel (`p2p_cancel_has_bid`).
- **Forced Pull-Back (`p2p_pull_back_for`)**:
  - Triggered automatically when a user enters **bankruptcy grace** (`on_grace_enter`) or declares **bankruptcy** (`prepare`).
  - Cancels all user's active listings (refunding top bidders with `p2p_seller_pulled_back` notice and returning items/horses to seller so bankruptcy can seize them!), AND removes user's active top bids (refunding escrowed cash back to user).
- **Auction & Expiry Settlement (`p2p_settle`)**:
  - Runs every 30 seconds (`P2PCog.tick`).
  - Auctions with a `bidder_id`: re-checks `_p2p_can_receive` AND 24h pair limit!
    - If valid: completes sale (`_p2p_sell`), notifies winner (`p2p_won`) and posts `🔨 競りの落札` to `announce_channel`.
    - If invalid (e.g., winner bought 3 horses or hit pair cap mid-auction): refunds escrowed bid to winner (`p2p_won_failed`), returns asset to seller (`p2p_buyer_cannot_receive`), marks `expired`.
  - Unsold fixed/auction listings: returns asset to seller, marks `expired`, sends `p2p_unsold` notice.

### 4. Sort Orders (`infra/db/p2p.py:26-31`)
- `end` (default): `end_at ASC, id ASC`
- `price_asc`: `CASE WHEN bid>0 THEN bid ELSE price END ASC, id ASC`
- `price_desc`: `CASE WHEN bid>0 THEN bid ELSE price END DESC, id ASC`
- `new`: `id DESC`

### 5. Teiai's Daily Relic Auction (added in the remaster; upstream 736efad)
Once per guild per **UTC** day Teiai itself puts **one relic** up on this market as a 24-hour auction.
- **Config** (`catalogs/teiai.yaml`: `relic_auction_per_day: 1`, `relic_auction_hours: 24`; code: `RELIC_AUCTION_PER_DAY`, `RELIC_AUCTION_HOURS` in `packages/domain/src/shop/teiai-market.ts`). `0` per day turns it off. The server option `relicAuctionPerDay` carries it; test worlds (server test kit, e2e, invariants) default to `0` unless a test turns it on.
- **Which relic** (`pickRelic`): weighted by the underground-work dig odds, unstarred only: fossil 0.0033, bone 0.0017, meteor 0.00067, vase 0.00027, crown 0.000067, tear 0.000017, normalised to 54.8 % / 28.2 % / 11.1 % / 4.5 % / 1.1 % / 0.28 %. The Dragon's tear is rare.
- **Listing**: `mode = auction`, `qty = 1`, starting price = the relic's reference value (`RELIC_VALUE`: 1,500 / 4,000 / 10,000 / 25,000 / 60,000 / 100,000), no upper bid cap. `seller_id = '0'` (`TEIAI_SELLER_ID`, not a snowflake, so it can never be a real account). Nothing is escrowed: the relic appears from nowhere (an **item faucet**, mean reference value about 5,133 per day per guild).
- **Once per day, idempotent**: the day's guard is the listings table itself. `teiaiDaily(guildId)` counts Teiai listings with `created_at >= UTC day start` and lists only the missing ones, inside one transaction. A second tick, a restart, or two instances on one database list nothing more. It runs from the 1-minute player-market job (`runPlayerMarketSettleTick`, `relicListed` in its report) and skips guilds whose status is `denied`.
- **Normal auction rules apply**: +5 % (min +100) per bid, the 5-minute anti-snipe extension, bid holds (`marketplace_hold`) and refunds on outbid (`marketplace_release`), the grace/bankruptcy pull-back of a user's own bids. Buying or bidding on a Teiai listing does **not** count toward, nor is it blocked by, the 100,000 / 24 h `PAIR_DAILY_LIMIT` (Teiai is not a player to pair with, so it is no transfer loophole).
- **Settlement** (`settleExpired`):
  - Sold: the winner's held bid is the whole price. It is a **sink** that is never released; it goes to **Teiai Bank income** (`teiai.bankIncome(price)`, thermostat on). No seller credit (`marketplace_auction_sale`), no `marketplace_fee`, no transfer rows. The relic is delivered to the winner. The row is `sold` with `fee = 0`.
  - Unsold: the row is `expired`; nothing is delivered and nothing moves (the relic disappears, since Teiai keeps it).
  - The original's "winner cannot receive, so refund and Teiai keeps it" branch does not exist here: a relic has no receive limit (not unique, not a horse), and `deliverAsset` cannot fail.
- **No win post**: the remaster posts nothing when any player-market auction is won, so the original's `…落札しました（出品者 🕴️ 帝愛）。` post has no counterpart; the winner just finds the relic in the inventory.
- **Never touched by players**: `cancelListing` answers `marketplace_not_seller`; `pullBackForUser` only moves listings whose seller is that user.
- **Announcement**: the listing publishes the `TeiaiRelicListed` domain event (after commit, guild-wide on the socket). The announcer posts an embed in the guild channel as the Teiai bank persona (title `🕴️ Teiai lists: {item}`, start price, end time) with the launch button to the market screen. This is on by default per guild like other announcements.
- **Screens**: in the Activity market (Players tab) a Teiai listing shows the seller as `🕴️ Teiai` (EN) / `🕴️ 帝愛` (JA), a `Teiai relic` tag, and a hint line under the market hint. The listings API returns `seller.id = '0'` for it; screens key off `TEIAI_SELLER_ID`.
- **Invariants** (`tests/invariants`, command `teiaiRelic`, `relicBid`, `relicSettle`): at most `perDay` Teiai listings per guild per UTC day; each is one unstarred relic auction of 24 h or more; a Teiai listing has only `marketplace_hold` / `marketplace_release` ledger rows (never a sale, fee or transfer); the Pelica held on it nets to the current bid while active, to the winning bid once sold, to 0 when expired; and the relics in inventories equal the Teiai sales.

## Timers & Schedules
- **30-Second Settlement Loop (`P2PCog.tick`)**: settles expired/ended listings, edits ended announcement posts to remove buttons (`post_done = 1`), posts auction win announcements.
- **View Timeouts**: `DetailView`, `SellView`, `MineView` = `300s`; `ConfirmView` = `30s`.

## State Machine
- Listing: `active` → `sold` (fixed buy or auction win) | `cancelled` (seller cancel or forced pull-back) | `expired` (unsold timeout or auction winner failed receive/pair-limit check).

## Edge Cases
- Selling a horse via P2P counts toward the buyer's `MAX_HORSES` limit (checked both at bid time and at settlement time).
- Seller's net proceeds pass `income = price - fee` to `AccountCore.apply` — if the seller accumulated Teiai debt while the listing was live, 30% of net sale proceeds is withheld.
- Bid escrows appear under `escrow` in `総資産` (`assets.py`), while listed items/relics/horses still count in the seller's fixed assets until sold.

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `p2p.post_title` | `📣 出品: {label}` | `cogs/p2p/embeds.py:88` |
| `p2p.detail_title` | `🤝 {label}` | `cogs/p2p/embeds.py:70` |
| `p2p.btn_open` | `🔍 見る・買う・入札` | `cogs/p2p/views.py:27` |
| `p2p.btn_buy` / `bid` | `🛒 買う` / `🔨 入札する` | `cogs/p2p/views.py:75` |
| `p2p.btn_modes` | `💴 定価で出す` / `🔨 競りに出す` | `cogs/p2p/views.py:186` |
| `p2p.sell_title` | `📤 出品する` | `cogs/p2p/views.py:193` |
| `p2p.mine_title` | `📋 自分の取引` | `cogs/p2p/views.py:245` |
| `p2p.won_announce` | `🔨 競りの落札` / `**{label}** を、<@{buyer}> が **{price}** で落札しました（出品者 <@{seller}>）。` | `cogs/p2p/cog.py:297-298` |
| `p2p.ended_sold` | `✅ 売れました` / `{label} は、<@{buyer}> が **{price}** で買いました。` | `cogs/p2p/embeds.py:74` |
| `p2p.ended_expired` | `⏳ 終了（売れ残り）` / `{label} は、買い手がつかず、終了しました。` | `cogs/p2p/embeds.py:75` |
| `p2p.ended_cancelled` | `🚫 取り消されました` / `{label} の出品は、取り消されました。` | `cogs/p2p/embeds.py:76` |
| `p2p.err_grace` | `破産猶予中は、取引（出品・買う・入札）ができません（破産の前に、資産を移して、借金を踏み倒すのを防ぐためです）。` | `cogs/shared/messages/economy.py:85` |
| `p2p.err_pair_limit` | `同じ相手との取引は、24時間で合計 {limit:,}ペリカ までです（いま {used:,}ペリカ・今回 {amount:,}ペリカ）。` | `cogs/shared/messages/economy.py:173-174` |
| `p2p.err_price_range` | `値段は {lo:,}〜{hi:,}ペリカ にしてください（定価の幅に収めます）。` | `cogs/shared/messages/economy.py:183` |
| `p2p.ledger_buy` / `sell` | `取引:購入（{label}）` / `取引:売却（{label}）` | `infra/db/p2p.py:221,258` |
| `p2p.teiai_seller` (remaster) | `🕴️ 帝愛` | `screen.finance.listings.sellerTeiai` |
| `p2p.teiai_post_title` (remaster) | `🕴️ 帝愛の出品: {item}` | `notify.event.TeiaiRelicListed.title` |
| `p2p.teiai_help` (remaster) | `🕴️ 帝愛も1日（UTC）に1回、発掘品を1つ競りで出す（開始は目安の価値、24時間。掘れる確率どおりに選ぶので、竜の涙はまれ）。代金は帝愛銀行へ` | `screen.finance.listings.teiaiHint` |
| `p2p.ledger_bid` / `refund` | `取引:入札（{label}）` / `取引:入札の返金（{label}）` | `infra/db/p2p.py:284,288,391` |
