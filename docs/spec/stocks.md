**English** | [日本語](stocks.ja.md)

# Securities Market (Stocks, Margin, Options, Bonds, Events & Earnings) Specification

Planned owner: `B3` | Screen IDs: `stocks`, `stocks-detail`, `stocks-margin`, `stocks-options`, `stocks-bonds` (`packages/shared/src/ids.ts`) | Feature toggles: `market` (spot/margin/options/chart/holdings), `bonds` (`/証券 注文 債券`)

> Note: Spot holdings of all 4 tickers (including default `cs` = CSトークン) share `CryptoRepo` and table `crypto`. See `docs/spec/crypto.md` for the CSトークン spot ledger, milli-unit math, collateral lock, and legacy `/暗号` → `/証券` consolidation details.

## Source Files
- `catalogs/market.yaml:1-158`
- `catalogs/bonds.yaml:1-22`
- `docs/stocks.md:1-157`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/market.py:1-339`
  - `domain/market_events.py:1-128`
  - `domain/earnings.py:1-104`
  - `domain/options.py:1-194`
  - `domain/bonds.py:1-80`
  - `domain/rates.py:1-68`
  - `infra/db/market.py:1-190`
  - `infra/db/market_events.py:1-75`
  - `infra/db/earnings.py:1-95`
  - `infra/db/crypto.py:1-192`
  - `infra/db/margin.py:1-518`
  - `infra/db/options.py:1-355`
  - `infra/db/bonds.py:1-252`
  - `services/market.py:1-285`
  - `cogs/market/cog.py:1-395`
  - `cogs/market/orders.py:1-345`
  - `cogs/market/bond_cog.py:1-66`
  - `cogs/market/embeds.py:1-454`
  - `cogs/market/bond_embeds.py:1-30`
  - `cogs/market/feed.py:1-93`
  - `cogs/market/views.py:1-242`
  - `cogs/shared/messages/market.py:1-107`

## Rules & Exact Numbers

### 1. Tickers & Global Price Engine (1-Minute Ticks)
- **Scope**: Prices are **global across all guilds** (`market_prices` has no `guild_id`). Positions, holdings, bonds, and options are strictly **per-guild**.
- **4 Symbols** (`catalogs/market.yaml:16-40`, `domain/market.py:39-42`):
  | Key | Name | Emoji | `start` | `sigma` (1-min) | `drift` (log/day) | Default Option Strike OTM |
  |---|---|---|---|---|---|---|
  | `cs` | `CSトークン` | `🪙` | `1000.0` | `0.0012` | `0.008` | `0.03` (3%) |
  | `teio` | `TEIO重工` | `🏭` | `1200.0` | `0.0007` | `0.007` | `0.02` (2%) |
  | `numa` | `NUMAバイオ` | `🧪` | `400.0` | `0.0022` | `0.010` | `0.05` (5%) |
  | `gold` | `GOLD地金` | `🥇` | `3000.0` | `0.0004` | `0.003` | `0.015` (1.5%) |
- **Correlation Matrix** (`catalogs/market.yaml:41-53`, symmetric, diagonal `1.0`):
  - `(cs, teio) = +0.60`, `(cs, numa) = +0.05`, `(teio, numa) = +0.05`
  - `(cs, gold) = -0.60`, `(teio, gold) = -0.50`, `(numa, gold) = -0.10`
- **Covariance & Cholesky** (`domain/market.py:135-158`):
  - `Σ[i][j] = σ_i * σ_j * ρ_ij` in order `[cs, teio, numa, gold]`.
  - Lower-triangular Cholesky `L` satisfies `Σ = L L^T`.
- **1-Minute Tick Formula** (`domain/market.py:54-59,161-186`):
  - Constants: `MIN_PRICE = 20`, `MAX_PRICE = 50_000`, `KEEP_DAYS = 30`, `DRIFT_BAND = 8.0`, `EVENT_PROB = 1 / 720` (~2x/day), `EVENT_RANGE = (0.015, 0.035)`, `EVENT_SCALE_MAX = 1.5`.
  - Draw `z = [rng.gauss(0, 1) for _ in SYMBOLS]`, `shock[i] = Σ_{k<=i} L[i][k] * z[k]`.
  - Panic shock: with probability `1/720`, `event ∈ {+1, -1}` (50/50), `size ~ Uniform(0.015, 0.035)`.
    `panic_i = 1 + event * size * min(1.5, σ_i / σ_cs)`.
  - Drift with high-price fade:
    - If `drift <= 0` or `price <= start`: `d_i = drift / 1440.0`.
    - Else: `fade = max(0.0, 1.0 - ln(price / start) / ln(8.0))`, `d_i = drift * fade / 1440.0`. (Reaches `0` at `8x start`.)
  - Volatility event multiplier `m_i = market_events.multiplier(events, sym.key, now)` (`2.0` during active event, else `1.0`).
  - `factor_i = exp(d_i - m_i^2 * Σ[i][i] / 2 + m_i * shock[i]) * panic_i`
  - `new_fair_i = min(50_000, max(20, round(fair_i * factor_i, 2)))`
- **Daily Price Limits & Pin Locks (±30%)** (`domain/market.py:62-95`, `infra/db/market.py`):
  - `DAILY_LIMIT = 0.30`. Reference price `ref` = price at `now - 86_400s` (24h ago; no limit if absent).
  - Fair price (`fair_price`) evolves freely (and absorbs earnings jumps). Displayed/traded `price = clamp(fair, ref * 0.70, ref * 1.30)`.
  - Pin state: `+1` (`🚀 ストップ高`) if `fair >= ref * 1.30`, `-1` (`🚨 ストップ安`) if `fair <= ref * 0.70`, else `0`.
  - Blocked actions while pinned (`catalogs/market.yaml:56-58`):
    - Pin `-1` (limit down): blocks `sell_spot`, `close_long`, `sell_call`.
    - Pin `+1` (limit up): blocks `buy_spot`, `open_long`, `cover_short`.
    - Reverse-side orders and profit-taking remain allowed.
- **Formatting & Chart** (`domain/market.py:206-208,263-339`):
  - `fmt(price)`: `f"{price:,.2f}"` if `price < 100` else `f"{price:,.0f}"`.
  - `UNIT = 1000` (1 share = 1,000 milli-units `口`, formatted `f"{units / 1000:,.3f}枚"`).
  - Periods: `1h` (3600s), `6h` (21600s), `24h` (86400s), `7d` (604800s).
  - ASCII block chart: `width = 32`, `height = 8`, 8-step blocks `" ▁▂▃▄▅▆▇█"`, live chart auto-refreshes every 1 min for `LIVE_MINUTES = 60` min (`cogs/market/embeds.py:18`).
  - Correlation display requires `>= 30` matched timestamp pairs (`domain/market.py:271`). Thresholds: `>= 0.6` (`🔗 強く連動`), `>= 0.3` (`↗️ やや連動`), `> -0.3` (`➖ ほぼ無関係`), `> -0.6` (`↘️ やや逆に動く`), `<= -0.6` (`🔀 逆に動く`).

### 2. Spot Trading & Progressive Capital Gains Tax
- See `docs/spec/crypto.md` for full `CryptoRepo` buy/sell quote, milli-unit math, and collateral check rules.
- `FEE_RATE = 0.0` (zero trading fee). `CONFIRM_FROM = 5_000`.
- **Progressive Capital Gains Tax** (`catalogs/market.yaml:64-72`, `domain/market.py:99-114`):
  - Applied per profitable close on **spot sells** and **margin closes** (`profit > 0`, `taxable=True`; forced bankruptcy liquidation passes `taxable=False`).
  - Marginal brackets:
    | Profit Slice (Pelica) | Rate |
    |---|---|
    | `0 .. 10,000` | `0%` |
    | `10,001 .. 100,000` | `3%` |
    | `100,001 .. 1,000,000` | `7%` |
    | `1,000,001+` | `12%` |
  - Result truncated via `int(tax)`. Tax revenue goes to Teiai Bank (`house_income_for`).

### 3. Cross-Margin Trading (Long & Short)
- **Constants** (`catalogs/market.yaml:62-63,73-83`, `domain/market.py:25-26,117-125,190-204`):
  - Allowed leverages: `SHORT_LEVERAGES = (1, 2, 3, 5)`.
  - `SHORT_MIN_MARGIN = 10` Pelica.
  - `RISK_K = 20.0` (portfolio margin coefficient).
  - `OPEN_RATIO = 1.30` (130% minimum ratio required to open/add margin or sell/cancel collateral).
  - `LOSSCUT_RATIO = 1.00` (100% forced liquidation trigger).
  - Collateral haircuts (`COLLATERAL_HAIRCUT`): `spot = 0.80`, `normal` bond = `0.95`, `junk` bond = `0.50`.
  - Margin interest (`BORROW_RATE_PER_DAY`):
    - `long`: `0.001` / day (0.1%/day) charged on `max(0.0, entry_value - margin)` (borrowed principal).
    - `short`: `0.0005` / day (0.05%/day) charged on `max(0.0, entry_value)` (stock-lending fee on full notional).
    - `INTEREST_MIN_CHARGE = 10` Pelica (accumulated in `interest_acc` per tick until `>= 10`, then deducted from position `margin` and credited to Teiai house; if `margin` runs dry, overflows into Teiai debt).
    - **Doc vs Code Discrepancy**: `docs/stocks.md:38` says "手数料も金利もありません" (stale), while `docs/stocks.md:22`, `catalogs/market.yaml:73-76`, and `infra/db/margin.py:424-465` actively charge margin interest.
- **Order Input Semantics**:
  - In `/証券 注文 信用買い` / `空売り`, user passes `amount` = **collateral (margin) to post**, and `leverage ∈ {1, 2, 3, 5}`.
  - Target notional = `amount * leverage`; `units = int(notional * UNIT // price)` (or `margin_open` computes `margin = math.ceil(entry_value / leverage)` where `entry_value = units * price / UNIT`).
  - Cannot hold both `long` and `short` on the same symbol simultaneously (`margin_opposite_open`).
  - Adding to an existing position in the same direction averages into the single `(guild_id, user_id, symbol, side)` row (`units += u`, `entry_value += ev`, `margin += m`).
  - Debtors (`debt > 0`) cannot open new margin positions (`margin_debt_blocks`).
- **Cross-Margin Portfolio Equity & Collateral Headroom (担保余裕度)** (`domain/market.py:196-204`, `infra/db/margin.py`):
  - Signed exposure vector `w[s] = +notional` (long) or `-notional` (short) at current prices.
  - `required_margin(w) = 20.0 * sqrt(max(0.0, w^T Σ w))` — correlated hedges (e.g., long `cs` + short `teio`) offset variance and reduce required margin!
  - `margin_pnl(side, units, entry_value, price)`: `round(now - entry_value)` (long), `round(entry_value - now)` (short), where `now = units * price / UNIT`.
  - `equity = sum(pos.margin + pnl) + 0.80 * spot_value + 0.95 * normal_bond_principal + 0.50 * junk_bond_principal`.
  - `ratio = equity / required` (or `None` if no open positions / `required == 0`).
- **Forced Liquidation (Loss-Cut)** (`infra/db/margin.py`):
  - Runs every 1-minute tick across all guilds (`margin_losscut`).
  - While `ratio < 1.00`: sorts open positions by worst PnL first and force-closes them one by one until `ratio >= 1.00` or no positions remain.
  - **Pin immunity / slip**: forced close ignores pin locks so runaway losses still liquidate; if returned cash `margin + pnl < 0`, excess loss becomes **Teiai debt** (unsecured shortfall recorded via `add_debt_for`)!
  - Partial closes (`pct` in `HoldingsView`, 1..100%) pro-rate `entry_value` and `margin` by `units / have` and apply progressive capital gains tax on positive profit.

### 4. Options & Pair Warrants (Black-Scholes & Margrabe)
- **Constants** (`catalogs/market.yaml:99-130`, `domain/options.py:19-35,87-88`):
  - `OPTION_HOURS = 6` hours (fixed expiry). `TICK_SECONDS = 60`.
  - `SPREAD = 0.015` (+1.5% ask on buy, -1.5% bid on sell/buyback — ~3% round-trip spread to Teiai Bank).
  - `PAYOUT_CAP_MULT = 50` (buyer payout capped at `50 * premium`).
  - `MIN_PREMIUM = 100`.
  - `MAX_OPEN_PREMIUM = 20_000` (max total active long premium per user).
  - `MARGIN_RATE = 0.20` (naked short writing collateral = `0.20 * strike * units / UNIT`).
  - `MAX_SHORT_MARGIN = 20_000` (max total active short collateral per user).
  - `MAX_TARGET_PCT = 50` (custom OTM target `1..50%`).
  - Kinds:
    - `call`: `🚀 爆騰コール` (`上がると儲かる`), short: `コール裸売り`
    - `put`: `📉 暴落プット` (`下がると儲かる`), short: `プット裸売り`
    - `pair`: `⚖️ ペア・ワラント` (`相手の銘柄より上がると儲かる`, buy-only)
- **Single-Asset Variance & Black-Scholes Pricing** (`domain/options.py:37-122`):
  - Jump variance per 1-min tick:
    `E[size^2] = (hi^3 - lo^3) / (3 * (hi - lo))` with `lo=0.015, hi=0.035`.
    `jump_var = (1/720) * E[size^2] * min(1.5, σ_sym / σ_cs)^2`.
  - `total_variance(symbol, seconds, now, events)`:
    1. Base + panic: `(seconds / 60) * (Σ_ii + jump_var)`.
    2. If no active/announced volatility event on `symbol`: adds baseline expected future event variance:
       `expected_event_ticks(seconds, 60) * Σ_ii * (2.0^2 - 1)`, where `cycle = 300 + 15 + 20 + 60 = 395` min, `expected_event_ticks = (seconds/60) * 20 / 395 / 4`.
    3. For each event in `events` matching `symbol`:
       - Earnings (`"jump_var" in ev`): if `now < ev["jump_at"] <= now + seconds`, adds `earnings.jump_variance()`.
       - Volatility event: adds `extra_variance_ticks(ev, now, seconds, 60) * Σ_ii * (factor^2 - 1)` (with `priced_at_announce = 1.0`, fully priced in immediately upon announcement).
  - Zero-interest European Black-Scholes (`fair_price(kind, S, K, v)`):
    - If `v <= 1e-12`: `max(0, S - K)` (call) or `max(0, K - S)` (put).
    - Else: `d1 = (ln(S/K) + v/2) / sqrt(v)`, `d2 = d1 - sqrt(v)`.
      `C = S*Φ(d1) - K*Φ(d2)`, `P = K*Φ(-d2) - S*Φ(-d1)`.
  - `ask_per_unit = fair * 1.015 / 1000`, `bid_per_unit = fair * 0.985 / 1000`.
  - `strike = round(spot * (1 + pct), 2)` (call) or `round(spot * (1 - pct), 2)` (put).
  - `intrinsic = int(max(0, ±(spot - strike)) * units / 1000)`.
- **Pair Warrant (Margrabe Exchange Option)** (`domain/options.py:125-184`):
  - `pair_variance(a, b, seconds, now, events)`:
    `ticks * (Σ_aa + Σ_bb - 2*Σ_ab + (1/720)*E[size^2]*(scale_a - scale_b)^2)` + expected or announced event variance contributions + earnings `jump_var` for either `a` or `b`.
  - `pair_fair_rate(rel_a, rel_b, v) = fair_price("call", rel_a, rel_b, v)`.
  - `pair_ask_rate = pair_fair_rate(1.0, 1.0, v) * 1.015`; `pair_bid_rate = pair_fair_rate(rel_a, rel_b, v) * 0.985`.
  - `pair_intrinsic(notional, a0, b0, a_t, b_t) = int(notional * max(0.0, a_t / a0 - b_t / b0))`.
- **Naked Short Writing (`side='short'`)** (`domain/options.py:186-189`, `infra/db/options.py`):
  - Writer posts `margin` (`>= 100`, total `<= 20,000`), receives `premium = int(units * bid_per_unit)` immediately from Teiai Bank (fails with `option_bank_no_cash` if bank cash cannot pay the premium).
  - Writer can buy back early at `ask_per_unit * units`, or hold to expiry.
  - At expiry: writer owes `intrinsic` (NO 50x cap for writer! Wait — check `infra/db/options.py`: writer pays up to `margin`, and any shortfall `intrinsic - margin` becomes **Teiai debt**!).
  - Buyer payout at expiry: `min(intrinsic, premium * 50)` paid from Teiai Bank (cascade: cash → trust → bath/kyosai); net gain `max(0, paid - premium)` counts as `income` for debt withholding.
  - Limit-down pin (`-1`) blocks early `sell_call` (`PIN_LOCKS[-1]`).

### 5. Volatility Events, Spread Alerts & Weekly Earnings
- **Volatility Events** (`catalogs/market.yaml:132-142`, `domain/market_events.py:20-88`):
  - Triggered on 1-min tick with probability `1/300` (~5h avg) when no active/announced event exists and `COOLDOWN_MIN = 60` min have passed since last event end.
  - Random symbol from all 4; `LEAD_MIN = 15` min warning (`announced`), `DURATION_MIN = 20` min active (`active`) with `FACTOR = 2.0`x volatility.
  - Kept in DB for `KEEP_DAYS = 7` days.
- **Correlation Breakdown Spread Alerts** (`domain/market_events.py:90-121`):
  - Pairs with `|ρ| >= 0.5` (`cs-teio`, `cs-gold`, `teio-gold`), window `ALERT_WINDOW = 60` min (requires `n >= 10`).
  - `z = (r_a - sign(ρ) * r_b) / sqrt((Σ_aa + Σ_bb - 2 * sign(ρ) * Σ_ab) * n)`.
  - Alert shown on `/証券 市況` if `|z| >= 2.5`, sorted by `|z|` descending (top 3 displayed).
- **Weekly Earnings & Insider Memos** (`catalogs/market.yaml:144-157`, `domain/earnings.py:16-104`):
  - Eligible symbols: `teio`, `numa`.
  - Announcement: **Monday 09:00** (configured TZ, default JST).
  - Release: **Tuesday 13:30** (configured TZ, default JST).
  - Pre-rolled when scheduled: `direction ∈ {+1, -1}` (50/50); `surprise` with probability `0.15` (`size ~ Uniform(0.35, 0.60)`), else normal (`size ~ Uniform(0.08, 0.22)`), rounded to 3 decimals.
  - At release: fair price multiplied by `exp(direction * ln(1 + size))` (log-symmetric so E[log jump] = 0; surprise > 30% punches through daily limit and pins limit up/down!).
  - Earnings jump variance for options: `0.85 * E[ln(1+U(0.08,0.22))^2] + 0.15 * E[ln(1+U(0.35,0.60))^2]` (200-bin midpoint quadrature).
  - **Insider Memos**:
    - Daily claim (`MEMO_PROB = 0.10`, only when release is within `MEMO_LEAD_HOURS = 48`h): truth accuracy `MEMO_TRUTH = 0.70` (30% fake/reversed).
    - Teiai Shop purchase (`insider_memo`, `10,000` Pelica, `SHOP_STOCK = 5` per guild per earnings): truth accuracy `SHOP_TRUTH = 0.80` (20% fake).

### 6. Teiai Corporate Bonds & Dynamic Risk-Free Rate (`r_f`)
- **Bond Catalog** (`catalogs/bonds.yaml:1-22`, `domain/bonds.py:16-80`):
  - `MIN_AMOUNT = 1_000`. `SALE_DISCOUNT_PER_HOUR = 0.001`.
  - | Key | Name | Emoji | Maturity | Base Rate | Default Prob | Max Principal/User | Early Sale |
    |---|---|---|---|---|---|---|---|
    | `normal` | `通常債` | `🏦` | `72h` (3d) | `4%` | `0%` | `30,000` | Yes (DCF) |
    | `junk` | `ジャンク債` | `🗑️` | `24h` (1d) | `20%` | `20%` | `10,000` | No |
- **Dynamic Risk-Free Rate `r_f` (CIR Process)** (`domain/rates.py:14-68`, linked to `docs/spec/teiai.md`):
  - `BASE_RISK_FREE_PER_DAY = ln(1.04) / 3 ≈ 0.0130737/day`.
  - Bounds from `teiai.yaml`: `RF_MIN = per_day(rf_min_pct, 72)`, `RF_MAX = per_day(rf_max_pct, 72)`.
  - Target `μ(θ) = RF_MIN + (RF_MAX - RF_MIN) * exp(-RF_ALPHA * max(0, θ))` (or `BASE_RISK_FREE_PER_DAY` if `θ is None`). Lower Teiai reserve ratio `θ` raises bond yields to attract cash.
  - Step over `days`: `drift = μ + (r - μ) * exp(-RF_KAPPA_PER_DAY * days)`, `noise = RF_SIGMA * sqrt(max(r, 0) * min(days, 1/24)) * z`, clamped to `[RF_MIN, RF_MAX]`.
  - Purchase coupon fixed at purchase time: `spread = per_day(kind.rate, kind.hours) - BASE_RISK_FREE_PER_DAY`, `rate_pct = round(max(0, expm1((rf + spread) * kind.hours / 24) * 100), 2)`.
- **Early DCF Sale (Normal Bonds Only)** (`domain/bonds.py:65-79`, `domain/rates.py:31,65-67`):
  - `SALE_SPREAD_PER_HOUR = max(0, 0.001 - BASE_RISK_FREE_PER_DAY / 24)`.
  - `discount_per_hour = rf / 24 + SALE_SPREAD_PER_HOUR`.
  - `sale_value = int(maturity_payout * exp(-discount_per_hour * remaining_hours))`.
  - Blocked if bond is needed as cross-margin collateral (`check_bond_cancel` maintains `ratio >= 1.30`).
- **Junk Bond Continuous Default (Poisson Hazard)** (`domain/bonds.py:53-62`, `infra/db/bonds.py:132-142`):
  - Hazard rate `λ = -ln(1 - 0.20) / 24 ≈ 0.0092976 / hour`.
  - Every tick, tests `rng.random() < 1 - exp(-λ * elapsed_hours)` using `until = min(now, due)` since `checked` (or `ts`).
  - Default sets `status = 'defaulted', paid = 0`; Teiai Bank keeps principal as profit.
- **Seniority & Settlement** (`infra/db/bonds.py:121-162`):
  - Bond principal + interest are **senior liabilities** of Teiai Bank (paid in full via `bank_pay_batch_for` cascade: cash → trust → bath/kyosai).
  - At maturity: `interest` triggers `income` withholding (30% if debtor); `principal` is applied via `repay_all_of_for` (100% applied toward any Teiai debt first!).
  - Debtors (`debt > 0`) cannot buy new bonds (`debt_blocks`).

## Timers & Schedules
- **1-Minute Global Market Loop** (`cogs/market/cog.py:316-395`):
  1. Advance global prices (`next_prices`), record fair/limited prices & pin states, prune > 30d history.
  2. Roll/maintain volatility events (`market_events`) & check weekly earnings release (Tue 13:30) / announcement (Mon 09:00).
  3. Per guild: settle matured/defaulted bonds, settle expired options, accrue margin interest, run margin loss-cut.
  4. Post earnings announcements/results (`feed.earnings_posts`) and edit active live charts (`LIVE_MINUTES = 60`).
- **UI View Timeouts**: `HoldingsView` = `600s`, `MarketView` = `300s`, `ConfirmView` = `30s` (`confirm_from = 5,000`).

## State Machine
- **Bond Lifecycle**: `active` --(junk hazard roll hit)--> `defaulted` (`paid=0`); `active` --(early sell / bankruptcy seizure)--> `cancelled`; `active` --(`now >= due`)--> `paid`.
- **Option Lifecycle**: `active` --(early sell/buyback)--> `sold`; `active` --(`now >= expiry` & `intrinsic > 0`)--> `exercised`; `active` --(`now >= expiry` & `intrinsic == 0`)--> `expired`.
- **Market Event**: `announced` (`now < start_ts`) → `active` (`start_ts <= now < end_ts`) → `done` (`now >= end_ts`).
- **Earnings**: scheduled → announced (Mon 09:00) → released (Tue 13:30).

## Edge Cases
- Selling spot or cancelling normal bonds while holding margin positions triggers `check_spot_sell` / `check_bond_cancel` and fails if post-sale ratio would drop below `OPEN_RATIO = 1.30`.
- Bankruptcy force-liquidates spot (`taxable=False`), margin positions, and normal bonds (`bond_write_off_for`).
- `MarketView` is per-owner (`OwnerView`) and does not auto-refresh; `/証券 市況` posts a non-live interactive view, while live charts (`chart_posts`) edit in place for 60 minutes.
- `/債券` command cog (`cogs/market/bond_cog.py`) is retained purely as a legacy redirect message pointing users to `/証券 注文 債券` and `/証券 保有`.

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `market.group_name` | `証券` (`📈 株・信用・オプション・債券の取引`) | `cogs/market/cog.py` |
| `market.event_up` | `📈 急騰！` | `cogs/market/embeds.py:20` |
| `market.event_down` | `📉 急落！` | `cogs/market/embeds.py:20` |
| `market.tax_line` | `🕴️ 帝愛の税（利益の累進課税）: **−{tax:,}ペリカ**（帝愛銀行の収入になります）\n` | `cogs/market/embeds.py:27` |
| `market.margin_ratio` | `{mark} **口座の担保余裕度 {ratio:.0%}**　有効証拠金 {equity} ÷ 必要証拠金 {req}\n（{losscut:.0%} を下回ると、損の大きい建玉から強制決済。現物・債券は担保に数えます）` | `cogs/market/embeds.py:48-51` |
| `market.pin_banner` | `\n**{mark}に張り付き中**　約定しない売買: {locked}` | `cogs/market/embeds.py:135` |
| `market.pin_down_err` | `🚨 {name} は**ストップ安に張り付いています**。{act}は、買い手がいなくて約定しません（下げが止まるまで、待つしかありません）。` | `cogs/shared/messages/market.py:25-26` |
| `market.pin_up_err` | `🚀 {name} は**ストップ高に張り付いています**。{act}は、売り手がいなくて約定しません（上げが止まるまで、待つしかありません）。` | `cogs/shared/messages/market.py:34-35` |
| `market.ev_active` | `⚡ **発生中**　{emoji}{name} の値動きが **{factor:g}倍**（<t:{end_ts}:R> まで）。上がるか下がるかは分かりませんが、大きく動きます。` | `cogs/market/embeds.py:160-163` |
| `market.ev_announced` | `📢 **予告**　{emoji}{name} の値動きが、<t:{start_ts}:R> から {dur}分間、**{factor:g}倍**になります。上がるか下がるかは分かりませんが、大きく動きます。オプションの値段には、もう織り込まれています。` | `cogs/market/embeds.py:164-167` |
| `market.earnings_announce_title` | `📢 今週の決算発表` | `cogs/market/embeds.py:384` |
| `market.earnings_result_title` | `📊 {name} 決算発表: {好決算！\|悪決算…}` | `cogs/market/embeds.py:396` |
| `market.summary_title` | `📈 市況（全銘柄）` | `cogs/market/embeds.py:285` |
| `market.holdings_title` | `💼 証券` | `cogs/market/embeds.py:315,365` |
| `market.holdings_empty` | `まだ持っていません。\`/証券 注文 現物\` などで買えます。` | `cogs/market/embeds.py:315` |
| `market.holdings_owner_only` | `自分の \`/証券 保有\` で操作してください。` | `cogs/market/views.py:50` |
| `market.view_owner_only` | `自分の \`/証券 市況\` で操作してください。` | `cogs/market/views.py:186` |
| `market.modal_pct_title` | `手放す割合` / `割合（1〜100の数字。100で全部）` | `cogs/market/views.py:25-27` |
| `market.bond_buy_title` | `{emoji} {name}を買いました` | `cogs/market/embeds.py:453` |
| `market.err_collateral_locked` | `信用取引の担保になっているので、売れません（売ると担保余裕度が {ratio:.0%}・{open_ratio:.0%} 以上が必要）。先に建玉を決済してください。` | `cogs/shared/messages/market.py:46-47` |
| `market.err_margin_opposite` | `{name}の{other_label}を建てています。先に決済してください。` | `cogs/shared/messages/market.py:53` |
| `market.err_margin_ratio` | `口座の担保余裕度が足りなくなります（建てると {ratio:.0%}・{open_ratio:.0%} 以上が必要）。証拠金を減らすか、レバレッジを下げるか、現物や債券を担保に持ってください。` | `cogs/shared/messages/market.py:67-68` |
| `market.err_opt_bank_no_cash` | `いま帝愛銀行の手元の現金が足りず、プレミアムを払えません（準備率が低いとき）。` | `cogs/shared/messages/market.py:88` |
| `market.err_bond_min` | `{min_amount:,}ペリカ以上で買ってください。` | `cogs/shared/messages/market.py:91` |
| `market.err_bond_max` | `{name}は元本の合計が {max_total:,}ペリカ まで（いま {held:,}ペリカ 保有）。あと {room:,}ペリカ まで買えます。` | `cogs/shared/messages/market.py:93-94` |
| `market.err_bond_unsellable` | `{name}は売れません（満期まで持つだけです）。` | `cogs/shared/messages/market.py:97` |
| `market.ledger_spot_buy` | `{name}購入:{lots}@{fmt_price}` | `infra/db/crypto.py:122` |
| `market.ledger_spot_sell` | `{name}売却:{lots}@{fmt_price}` | `infra/db/crypto.py:172` |
| `market.ledger_bond_buy` | `債券購入:{name}` | `infra/db/bonds.py:77` |
| `market.ledger_bond_mature` | `債券償還:{name}` | `infra/db/bonds.py:156` |
| `market.ledger_bond_sell` | `返金:債券売却` | `infra/db/bonds.py:249` |
| `market.ledger_bond_seize` | `破産:債券の差し押さえ` | `infra/db/bonds.py:219` |
