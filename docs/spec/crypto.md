**English** | [日本語](crypto.ja.md)

# Crypto (CS Token & Spot Ledger) Specification

Planned owner: `B3` | Screen IDs: `stocks`, `stocks-detail` (`packages/shared/src/ids.ts`) | Feature toggle: `market`

> Architecture Note: Originally a standalone `/暗号` module for `CSトークン`, crypto was consolidated into `/証券` (`docs/stocks.md:25`) alongside `TEIO重工`, `NUMAバイオ`, and `GOLD地金`. In the legacy codebase, `cs` (`CSトークン`) remains the `DEFAULT` symbol, and all spot holdings for all 4 tickers live in the `crypto` SQLite table managed by `CryptoRepo`. See `docs/spec/stocks.md` for the shared Cholesky price engine, margin, options, bonds, and UI panels.

## Source Files
- `catalogs/market.yaml:10-22,41-53,64-72,80-81`
- `docs/stocks.md:1-35`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/market.py:22-23,39-48,176-186,211-265`
  - `infra/db/crypto.py:1-192`
  - `cogs/shared/messages/market.py:42-51`
  - `cogs/market/embeds.py:54-62,322-330`

## Rules & Exact Numbers

### 1. CS Token Parameters (`catalogs/market.yaml:17-22`)
- Symbol key: `cs` (`domain/market.py:41-42`, `DEFAULT = "cs"`, compatibility aliases `NAME = "CSトークン"`, `START_PRICE = 1000.0`, `SIGMA = 0.0012`).
- Display: `🪙 CSトークン`.
- `start = 1000.0` Pelica / 1 token (`1.000枚`).
- `sigma = 0.0012` per 1-minute tick (also serves as the baseline volatility denominator `sym.sigma / CS.sigma` for panic shock scaling across all 4 tickers).
- `drift = 0.008` log growth/day (fades linearly in log-price to `0` at `8x` start = `8,000` Pelica).
- Correlations: `+0.60` with `teio`, `+0.05` with `numa`, `-0.60` with `gold`.
- Price bounds: `MIN_PRICE = 20`, `MAX_PRICE = 50_000`. Daily price limit: `±30%` vs 24h-ago reference.
- Default option OTM strike offset: `3%` (`strike_by_symbol.cs = 0.03`).
- Earnings eligibility: **None** (only `teio` and `numa` have weekly earnings; `cs` is eligible for random 2x volatility events).

### 2. Milli-Unit Spot Accounting (`CryptoRepo`)
- Precision: `UNIT = 1000` (`QUANTITY_SCALE = 1000` in `packages/shared/src/ids.ts`).
  - `1` stored unit = `0.001枚` (1 milli-token / 1 `口`).
  - Display format: `lots(units) = f"{units / 1000:,.3f}枚"`.
- Trading fee: `FEE_RATE = 0.0` (`_fee(gross) = math.ceil(gross * FEE_RATE)`).
- **Buy Quote** (`domain/market.py:215-224`):
  - Input: budget `amount` (integer Pelica), current `price` (float).
  - Initial estimate: `units = int(amount * 1000 // (price * (1 + FEE_RATE)))`.
  - Decrements `units` by `1` while `gross + fee > amount`, where `gross = math.ceil(round(units * price / 1000, 6))` and `fee = math.ceil(gross * FEE_RATE)`.
  - Returns `(units, gross + fee, fee)` or `(0, 0, 0)` if `units == 0`.
  - Note: Because `gross` uses `math.ceil`, actual spent `total` may be slightly less than `amount` (player keeps the unspent remainder!).
- **Sell Quote** (`domain/market.py:227-231`):
  - `gross = int(round(units * price / 1000, 6) // 1)` (floor after 6-decimal rounding to avoid float off-by-one).
  - `fee = math.ceil(gross * FEE_RATE)`.
  - Returns `(max(0, gross - fee), fee)`.
- **Average Cost Basis & PnL** (`domain/market.py:234-242`, `infra/db/crypto.py:124-128,166-182`):
  - Stored per `(guild_id, user_id, symbol)` as `(units, cost)` where `cost` is cumulative integer Pelica spent.
  - On buy: `units += bought_units`, `cost += total_paid`.
  - On partial sell of `u` out of `have` units:
    `removed_cost = cost if u == have else round(cost * u / have)` (Python banker's rounding to avoid leftover dust cost).
  - Realized profit: `profit = proceeds - removed_cost`.
  - `avg_price = cost * 1000 / units`; `pnl_percent = (price - avg_price) / avg_price * 100`.

### 3. Validation, Tax & Collateral Rules (`infra/db/crypto.py:92-191`)
- **Buy (`crypto_buy`)**:
  1. Ensures user account (`3,000` initial balance if new).
  2. Rejects `amount <= 0 or price <= 0` (`crypto_invalid_amount`).
  3. Rejects if symbol is pinned limit-up (`+1` blocks `buy_spot`).
  4. Rejects if `debt > 0` (`debt_blocks`, verb `"買えません"`).
  5. Rejects if `raw_balance < amount` (`crypto_insufficient_balance`).
  6. Rejects if `buy_quote` returns `units < 1` (`crypto_amount_too_small`).
  7. Deducts `total` with ledger reason `"{name}購入:{lots}@{fmt(price)}"` (no `income`).
- **Sell (`crypto_sell`)**:
  1. Rejects if symbol is pinned limit-down (`-1` blocks `sell_spot`).
  2. If `have > 0`: runs `collateral_guard.check_spot_sell` — spot holdings count at **80% haircut** (`COLLATERAL_HAIRCUT.spot = 0.8`) toward cross-margin equity; sell is rejected (`crypto_collateral_locked`) if post-sell margin ratio would fall below `OPEN_RATIO = 1.30`.
  3. Rejects if `have <= 0` (`crypto_not_held`), `units < 1 or units > have` (`crypto_sell_range`), or `proceeds < 1 and units != have` (`crypto_proceeds_too_small`).
  4. Charges progressive capital gains tax (`0% / 3% / 7% / 12%`) on `profit = proceeds - removed_cost` when `taxable=True` (disabled during forced bankruptcy seizure).
  5. Credits `proceeds - tax` with ledger reason `"{name}売却:{lots}@{fmt(price)}"` (`income=0` — selling own spot asset does NOT trigger 30% Teiai debt withholding, though capital gains tax still goes to Teiai).
  6. Deletes `crypto` row when `units == have`, else updates remaining `units` and `cost`.
- **Valuation in Rankings** (`infra/db/crypto.py:74-90`):
  - Valued at current `sell_quote(units, latest_price)[0]` across all symbols with a recorded price.

## State Machine
- Per `(guild_id, user_id, symbol)`:
  - `NO_POSITION` --(`crypto_buy`, `units >= 1`)--> `HOLDING(units, cost)`
  - `HOLDING(units, cost)` --(`crypto_buy`)--> `HOLDING(units + u, cost + total)`
  - `HOLDING(units, cost)` --(`crypto_sell` partial, `u < units`)--> `HOLDING(units - u, cost - removed)`
  - `HOLDING(units, cost)` --(`crypto_sell` full, `u == units` or bankruptcy liquidation)--> `NO_POSITION` (row deleted)

## Edge Cases
- Full liquidation (`units == have`) is permitted even when `proceeds == 0` (clears dust holdings cleanly), whereas partial sells with `proceeds < 1` fail with `crypto_proceeds_too_small` (`infra/db/crypto.py:164`).
- `crypto_buy` checks `bal < amount` (the user's requested budget) BEFORE computing `total` (actual rounded spend `<= amount`).
- Because spot sells pass `income=0` to `AccountCore.apply`, a debtor selling spot retains 100% of net proceeds (after capital gains tax) rather than losing 30% to withholding, unlike casino winnings or daily bonuses.
- No standalone `/暗号` slash command exists in the current legacy bot; all spot orders go through `/証券 注文 現物` and `/証券 保有`.

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `crypto.symbol_name` | `CSトークン` (`🪙`) | `catalogs/market.yaml:18-19` |
| `crypto.err_invalid_amount` | `金額が正しくありません。` | `cogs/shared/messages/market.py:42` |
| `crypto.err_balance` | `ペリカが足りません（残高 {balance:,}ペリカ）。` | `cogs/shared/messages/market.py:43` |
| `crypto.err_too_small` | `その金額では 0.001枚も買えません。金額を増やしてください。` | `cogs/shared/messages/market.py:44` |
| `crypto.err_collateral` | `信用取引の担保になっているので、売れません（売ると維持率が {ratio:.0%}・{open_ratio:.0%} 以上が必要）。先に建玉を決済してください。` | `cogs/shared/messages/market.py:46-47` |
| `crypto.err_not_held` | `{name}を持っていません。` | `cogs/shared/messages/market.py:49` |
| `crypto.err_sell_range` | `売れるのは 0.001〜{max_lots} です（持っている分）。` | `cogs/shared/messages/market.py:50` |
| `crypto.err_proceeds_small` | `その数量では受け取れる額が 1ペリカ未満です。もう少し多く売ってください。` | `cogs/shared/messages/market.py:51` |
| `crypto.pos_text` | `保有: **{lots}**\n取得 {avg} → いま {price}　{arrow}**{pct:+.1f}%**\n評価損益: **{diff:+,}ペリカ**（売ったときの手取り {value}）` | `cogs/market/embeds.py:60-61` |
| `crypto.ledger_buy` | `{name}購入:{lots}@{price}` | `infra/db/crypto.py:122` |
| `crypto.ledger_sell` | `{name}売却:{lots}@{price}` | `infra/db/crypto.py:172` |
