**English** | [日本語](kyosai.ja.md)

# Teiai Kyosai (`/共済`) Specification

Planned owner: `B3` | Screen ID: `kyosai` (`packages/shared/src/ids.ts`) | Feature toggle: `kyosai` (always allowed even when OFF: `共済 状況`, `共済 取消`)

## Source Files
- `catalogs/teiai.yaml:76-95`
- `docs/teiai.md:64-80`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/kyosai.py:1-77`
  - `infra/db/kyosai.py:1-560`
  - `services/kyosai.py:1-95`
  - `cogs/kyosai/cog.py:1-410`
  - `cogs/shared/messages/economy.py:57-77`
  - `cogs/shared/messages/notices.py:31-38`

## Rules & Exact Numbers

### 1. Fixed Supply & Backstop Layer (`catalogs/teiai.yaml:77-94`, `domain/kyosai.py:17-34`)
- **Fixed Guild Supply**: `TOTAL_UNITS = 10_000` units per guild (`1` unit = `0.01%`), never minted or burned.
- Initial state (`_ensure_supply_for`): all `10,000` units belong to `HOUSE = 0` (`user_id = 0`), sold off via Teiai auctions.
- New accounts receive **0** units; players acquire units via **Teiai auctions** (`/共済 入札`) or **P2P transfers** (`/共済 譲渡` → `/共済 受諾`).
- **Pro-rata Split (`kyosai.split`)** (`domain/kyosai.py:36-46`):
  - Largest-remainder (Hamilton) method so shares sum to exact `amount`; ties broken by lowest `user_id`.
- **Excess Loss Backstop (`charge_excess_for`)** (`infra/db/kyosai.py:122-152`):
  - Triggered when Teiai Bank outflow exhausts both `cash` and Teiai Trust (and thermostat bailout).
  - Splits `amount` across ALL `10,000` units (including `HOUSE`).
  - `HOUSE` share is NOT paid (logged as `teiai_bank.excess_unpaid`).
  - Each player holder pays from cash balance (`共済:超過損失の負担`); any shortfall becomes **Teiai debt** (`共済:超過損失の負担（借金 {rest:,}ペリカ）`) and calls `after_debt_change`.

### 2. Daily Dividend & Dormant Unit Recovery (`infra/db/kyosai.py:157-210`)
- Runs once every `24h` (`86,400s`, tracked via `teiai_bank.kyosai_div_ts`; first tick initializes timestamp only).
- Step 1 — **Dormant Recovery (`DORMANT_DAYS = 30`)**:
  - Checks every non-house holder's latest `ledger.ts` excluding passive entries `('共済:配当', '帝愛信託:利息')` and `'共済:超過損失の負担%'` (fallback: `users.created_at`).
  - If `last < now - 30 * 86400`: all units return to `HOUSE`, and any open sell offers by that user are cancelled.
  - Bankruptcy also recovers all units to `HOUSE` with 0 liquidation value (`KyosaiLiquidationStep`).
- Step 2 — **Surplus Dividend (`dividend_pool`)** (`domain/kyosai.py:49-54`):
  - `TARGET_RATIO = 0.30`, `DIVIDEND_SHARE = 0.05`, `DIVIDEND_CAP = 50_000`.
  - `surplus = available_cash - 0.30 * (deposits + active_bond_principal)`.
  - `pool = min(50_000, int(surplus * 0.05))` if `surplus > 0` else `0`.
  - Split across all `10,000` units; `HOUSE` share stays in bank; player shares paid from bank with `thermo=False` and credited with `income=share` (subject to 30% debt withholding).

### 3. Teiai House Unit Auctions (`infra/db/kyosai.py:215-286`)
- `AUCTION_LOT = 100` units per auction (`min(house_units, 100)`), `AUCTION_HOURS = 24`h, `AUCTION_MIN_BID = 1` Pelica.
- Runs even when the liquidity gate is locked (auction proceeds inject cash into Teiai Bank).
- Bidding (`/共済 入札`):
  - Debtors (`debt > 0`) cannot bid (`debt_blocks`).
  - Minimum next bid reuses `p2p.min_next_bid(1, top_bid)` (`1` if no bid yet, else `top_bid + max(100, ceil(top_bid * 0.05))`).
  - Escrows bid from cash balance; raising own top bid only checks `bal + own >= amount`, refunds old top bid first then deducts new amount.
  - Anti-snipe: reuses `p2p.end_after_bid` (bid within final 5 min extends end to `now + 300s`).
  - Entering bankruptcy grace or declaring bankruptcy pulls back open top bids (`kyosai_pull_back_for`), refunding cash and resetting `top_bid = 0, top_bidder = NULL`.
- Settlement: at `now >= ends`, transfers `units` from `HOUSE` to `top_bidder`, credits `top_bid` to bank via `bank_income_for`, and immediately opens the next lot if `house > 0` (re-listings after unsold do NOT announce to avoid spam).

### 4. P2P Unit Transfers & Liquidity Gate (`infra/db/kyosai.py:290-396`)
- **Liquidity Gate (`gate_locked`)** (`domain/kyosai.py:57-59`):
  - Locked (`kyosai_gate_locked`) whenever `grace_debtors > 0` OR `(theta is not None and theta < 0.20)`.
  - Blocks both creating (`/共済 譲渡`) and accepting (`/共済 受諾`) P2P unit offers to prevent insiders dumping liability during a bank run.
- Offer terms: `units >= 1`, `0 <= price <= 100,000` (`p2p.PAIR_DAILY_LIMIT`), `buyer != seller`, `buyer != 0`, expires in `OFFER_HOURS = 24`h.
- Acceptance: checks buyer `debt == 0`, cash `>= price`, and shared 24h pair volume (`kyosai_offers + market_listings <= 100,000`).
- Fee: `5%` (`p2p.fee_of(price)`) deducted from seller proceeds and credited to Teiai Bank; seller net credited with `income = net`.
- Either seller or buyer can cancel an open offer (`/共済 取消`).

### 5. Governance Motions (Trust Interest Premium) (`infra/db/kyosai.py:400-525`)
- Controls `teiai_bank.trust_premium` (daily continuous premium added to `r_f` for Teiai Trust interest).
- Valid range: `0 < premium <= 1.0` (`PREMIUM_LIMIT = 1.0`, i.e., `> 0%/day` up to `100%/day`; slash command accepts `0.001..100.0` % and divides by 100).
- Proposer restrictions:
  - Must hold `>= 100` units (`MOTION_MIN_UNITS = 100`, 1% of supply).
  - Max `1` open motion per proposer (`MOTION_MAX_OPEN_PER_USER = 1`).
  - `6` hours cooldown since proposer's last motion (`MOTION_COOLDOWN_HOURS = 6`).
  - Multiple motions from different proposers CAN run concurrently.
  - Proposer automatically votes `yes`.
- Voting (`/共済 投票` or persistent `MotionButton` `kyosai:yes|no:<id>`):
  - Any user with `units > 0` may vote and change their vote before `closes` (`now + 24h`).
  - Votes are **re-tallied using unit balances at close time** (`_tally_for`) to prevent double-voting via unit transfers!
- Passing condition (`motion_passes`, `domain/kyosai.py:62-68`):
  - `yes_units > no_units` (strict majority; tie rejects) **AND** `yes_units >= 0.25 * circulating_units` (`circulating = 10,000 - house_units`).
  - Motions close in `(closes, id)` order; each passing motion overwrites `trust_premium` (last-closed wins).

### 6. Pinned Motion Post (remaster, port of upstream 22a1f66)
- The public reply of `/kyosai propose` is **pinned** in its channel right after it is posted, and **unpinned** once the motion is `passed` or `rejected` (the minute tick closes it). A motion proposed in the Activity has no chat post and is not pinned.
- Needs the **Pin Messages** permission in that channel. Without it, with a full pin list or a deleted message, the motion works the same, just unpinned: the failure is logged (one line per guild per 10 minutes at most) and never shown to players.
- Mechanism: the message is recorded in `pinned_posts` (kind `motion`); the `notify:pin-sweep` job (every 30 s) unpins every recorded post whose motion is not `open` and deletes the row. A deleted message is ignored silently. See [DB_SCHEMA.md](../DB_SCHEMA.md).

## Timers & Schedules
- **1-Minute Tick (`KyosaiCog.tick`)**: `kyosai_daily` (every 24h), `kyosai_close_motions` (edits motion embed & posts verdict), `kyosai_auction_tick` (settles & opens lots, posts `sold`/`listed`).

## State Machine
- Auction: `open` → `sold` | `unsold` (immediately spawns next `open` if `house > 0`).
- Offer: `open` → `done` | `cancelled` (or ignored past `expires`).
- Motion: `open` → `passed` (updates `trust_premium`) | `rejected`.

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `kyosai.group_name` | `共済` (`🏛️ 帝愛共済（配当と、最後の損の負担・口の競りと譲渡・動議）`) | `cogs/kyosai/cog.py:148` |
| `kyosai.status_title` | `🏛️ 帝愛共済` | `cogs/kyosai/cog.py:72` |
| `kyosai.motion_title` | `🗳️ 帝愛共済の動議 #{id}` | `cogs/kyosai/cog.py:95` |
| `kyosai.motion_result_title` | `🗳️ 帝愛共済の動議の結果` | `cogs/kyosai/cog.py:388` |
| `kyosai.auction_sold_title` | `🔨 帝愛共済の競りの結果` | `cogs/kyosai/cog.py:394` |
| `kyosai.auction_list_title` | `🔨 帝愛共済の口の競り` | `cogs/kyosai/cog.py:399` |
| `kyosai.btn_yes_no` | `👍 賛成` / `👎 反対` | `cogs/kyosai/cog.py:105-106` |
| `kyosai.err_gate` | `いまは口の売買が止まっています（帝愛銀行の準備率が低いか、破産猶予中の人がいます）。` | `cogs/shared/messages/economy.py:64` |
| `kyosai.err_motion_units` | `動議を出せるのは、共済の口を {need:,}口 以上持っている人だけです（いま {have:,}口）。` | `cogs/shared/messages/economy.py:72` |
| `kyosai.err_bad_premium` | `上乗せ金利は 0%/日 より大きく、{max_pct:g}%/日 以下で指定してください。` | `cogs/shared/messages/economy.py:69` |
| `kyosai.ledger_excess` | `共済:超過損失の負担` / `共済:超過損失の負担（借金 {rest:,}ペリカ）` | `infra/db/kyosai.py:132,143` |
| `kyosai.ledger_div` | `共済:配当` | `infra/db/kyosai.py:184` |
| `kyosai.ledger_bid` | `共済:競りの入札（預かり）` / `共済:競りの入札の返金` / `共済:競りの入札の返金（取引停止）` | `infra/db/kyosai.py:91,276,279` |
| `kyosai.ledger_trade` | `共済:口の購入` / `共済:口の売却` | `infra/db/kyosai.py:367,370` |
