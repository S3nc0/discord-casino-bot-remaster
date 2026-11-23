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
| `p2p.ledger_bid` / `refund` | `取引:入札（{label}）` / `取引:入札の返金（{label}）` | `infra/db/p2p.py:284,288,391` |
