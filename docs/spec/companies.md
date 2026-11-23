**English** | [日本語](companies.ja.md)

# Companies (`/会社`) Specification

Planned owner: `B3` | Screen IDs: `company`, `company-invest` (`packages/shared/src/ids.ts`) | Feature toggle: `company` (always allowed even when OFF: `会社 状況`, `会社 持分`)

## Source Files
- `catalogs/company.yaml:1-35`
- `docs/company.md:1-46`
- `legacy/python/domain/company.py:1-170`
- `legacy/python/infra/db/company.py:1-459`
- `legacy/python/services/company.py:1-76`
- `legacy/python/cogs/company/cog.py:1-165`
- `legacy/python/cogs/company/embeds.py:1-112`
- `legacy/python/cogs/company/texts.py:1-25`
- `legacy/python/cogs/company/views.py:1-151`
- `legacy/python/cogs/shared/messages/economy.py:23-53`
- `legacy/python/cogs/shared/messages/notices.py:21-24`

## Rules & Exact Numbers

### 1. Founding, Levels, Upkeep & Caps (`catalogs/company.yaml:3-15`, `domain/company.py:20-36,51-84`)
- 1 company per user per guild (every company is a Teiai subsidiary).
- Name validation (`check_name`): stripped, `1..12` chars (`NAME_MAX = 12`), cannot contain any of `@<>`*_~|#:/\\\n\r` or substring `"http"` (case-insensitive).
- **Founding Cost**: `200,000` Pelica total (`FOUND_FEE = 100_000` → Teiai Bank via `bank_income_for`; `BUILD_COSTS[0] = 100_000` → Teiai House Account via `house_receive_for`).
- Eligibility to found / self-invest / stake-invest: must be `🟢 カタギ` (`company_katagi_only`).
- **Facility Levels (Lv1–Lv5)** (`BUILD_COSTS = [100_000, 200_000, 400_000, 800_000, 1_600_000]`):
  | Level | Upgrade Cost (from company funds → House) | Cumulative `invested(level)` | Daily Upkeep (`0.3%`) | Max External Stakes (`2.0x`) |
  |---|---|---|---|---|
  | `Lv1` | `100,000` (at founding) | `100,000` | `300` | `200,000` |
  | `Lv2` | `200,000` | `300,000` | `900` | `600,000` |
  | `Lv3` | `400,000` | `700,000` | `2,100` | `1,400,000` |
  | `Lv4` | `800,000` | `1,500,000` | `4,500` | `3,000,000` |
  | `Lv5` | `1,600,000` | `3,100,000` | `9,300` | `6,200,000` |
- `UPKEEP_RATE = 0.003` (`int(invested * 0.003)`/day deducted at local `00:00` → `house_receive_for`).
- `BANKRUPT_DAYS = 3` consecutive unpaid upkeep days → company deleted, remaining `funds` taken by `house_receive_for`, all investor stakes wiped, public `🏚️ 倒産` announcement + `company_bankrupt` notice.
- Changing facility kind (`company_change_kind`): costs `100,000` from company funds (→ House), resets to `Lv1`, wipes cumulative construction cost & warehouse stock.

### 2. Facility Kinds, Daily Weather/Market RNG & Production (`catalogs/company.yaml:19-35`, `domain/company.py:73-137`)
- `STORAGE_DAYS = 3` (`storage_cap = daily_output * 3`; overflow discarded).
- `PINHANE_RATE = 0.03` (3% skim on shipment gross).
- `DAILY_GRANT = 30_000` (server-wide daily buyout grant when `teiai_house.balance` runs out).
- **Deterministic Daily State (`day_state(kind, guild_id, day)`)**:
  - Seeded with `random.Random(f"company:{kind}:{guild_id}:{day}")` (`day` = `YYYY-MM-DD` in configured TZ, default JST).
  - Weighted random condition via `rng.choices`, then `price = round(rng.uniform(price_lo, price_hi), 2)`.
- **Kinds & Conditions**:
  - `farm` (`🌾 農場`, `yield_rate = 0.018` / day):
    | Key | Label | Weight | `yield_mult` | `price_lo..price_hi` |
    |---|---|---|---|---|
    | `sunny` | `☀️ 晴れ` | `40` (40%) | `1.0` | `0.9..1.1` |
    | `rain` | `🌧️ 恵みの雨` | `20` (20%) | `1.3` | `0.8..1.0` |
    | `bumper` | `🌾 豊作` | `10` (10%) | `1.8` | `0.6..0.8` |
    | `drought` | `🥀 日照り` | `15` (15%) | `0.5` | `1.3..1.5` |
    | `storm` | `🌀 嵐` | `5` (5%) | `0.1` | `1.5..1.9` |
    | `season` | `🍂 旬` | `10` (10%) | `1.0` | `1.4..1.6` |
  - `mine` (`⛏ 採掘場`, `yield_rate = 0.024` / day):
    | Key | Label | Weight | `yield_mult` | `price_lo..price_hi` |
    |---|---|---|---|---|
    | `steady` | `⛏ 平常操業` | `1` (100%) | `1.0` | `0.9..1.1` |
- **Continuous Production (`produce`)**:
  - Integrates second-by-second across calendar day boundaries: `stock += (end - cursor) * (daily_output / 86400) * day_state(...).yield_mult`, capped at `storage_cap`.
- **Shipment Sale & Budget Cap (`sale`)** (`domain/company.py:123-137`, `infra/db/company.py:232-266`):
  - Server buyout budget = `teiai_house.balance + house_grant_left(day, 30_000)`.
  - `gross = int(stock * price)`, `net = gross - int(gross * 0.03)`.
  - If `net <= budget`: sells 100%, returns `(net, gross - net, 0.0)`.
  - Else (partial buyout): `fraction = budget / net`, `sold_gross = int(gross * fraction)`, `paid = min(budget, sold_gross - int(sold_gross * 0.03))`, `left_stock = stock * (1 - fraction)`.
  - Payment draws from `teiai_house.balance` first, then consumes daily grant for `paid - from_house`.
  - `paid` enters `company.funds` and increments `sold_total`.

### 3. External Equity Investment & Dividends (`domain/company.py:143-170`, `infra/db/company.py:309-380`)
- `/会社 出資`: `STAKE_MIN = 1_000` Pelica, non-self, investor must be `katagi`, company total stakes `<= 2.0 * invested(level)`.
- Non-refundable! Paid into `company.funds`; tracked in `company_stakes(guild_id, owner_id, investor_id, amount, dividends)`.
- **Withdrawal Lock** (`infra/db/company.py:216-226`): CEO can only withdraw `max(0, funds - sum(stakes))` to personal cash (staked funds may be used for upgrades and upkeep).
- **Dividends**: CEO sets `dividend_rate ∈ [0.0, 0.50]` (`DIVIDEND_MAX = 0.5` via `/会社 配当率 0..50`).
  - On every shipment, `pool = int(paid * rate)` is paid from `company.funds` to investors as `pool * stake_amount // total_stakes` (`配当:{name}`, `income=0` — note `infra/db/company.py:254` does NOT pass `income`!). Dust stays in `company.funds`.
- **Net Worth Valuation (`stake_values`)** (`domain/company.py:158-169`):
  - `company_value = funds + invested(level)`.
  - If `total_stakes > 0`: `scale = min(1.0, max(0, company_value) / total_stakes)`; each investor valued at `int(amt * scale)`; CEO valued at `max(0, company_value - total_stakes)`. Prevents double-counting in rankings!
- **Seizure & Personal Bankruptcy** (`infra/db/company.py:406-459`):
  - Forced execution (`CompanySeizureStep`): seizes up to `need` from `company.funds` (even if staked; facility untouched).
  - Personal bankruptcy (`CompanyLiquidationStep`): dissolves company, wipes all stakes, seizes remaining `company.funds` into bankruptcy pool.

## Timers & Schedules
- **10-Minute Maintenance Loop (`CompanyCog.tick`)**: settles all companies (`produce` + daily upkeep at local `00:00`), announces bankruptcies (`🏚️ 倒産`) to `announce_channel`.
- **View Timeouts**: `CompanyPanel` = `600s`, `KindView` = `180s`.

## State Machine
- `NO_COMPANY` --(`/会社 設立`, -200,000)--> `ACTIVE(Lv1, unpaid=0)`
- `ACTIVE` --(upgrade)--> `ACTIVE(Lv+1)` (up to Lv5)
- `ACTIVE` --(change_kind, -100,000 funds)--> `ACTIVE(Lv1, stock=0)`
- `ACTIVE` --(3 consecutive unpaid days OR CEO personal bankruptcy)--> `NO_COMPANY` (deleted, stakes wiped).

## Edge Cases
- Investor dividends (`infra/db/company.py:254`) are credited with `income=0` (no 30% Teiai withholding even if the investor later goes into debt).
- CEO personal withdrawals (`infra/db/company.py:229`) also pass `income=0` (own money).
- If a CEO downgrades facility kind (resetting `Lv` to `1`), existing external stakes can exceed the new `Lv1` `stake_cap` (`200,000`); existing stakes remain intact and new stakes are simply blocked (`room <= 0`).

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `company.group_name` | `会社` (`🏢 会社（帝愛の子会社を作って、製品を売る）`) | `cogs/company/cog.py:46` |
| `company.found_ok` | `🏢 会社を設立しました` / `{user} が、帝愛の子会社 **{name}**（{kind}）を設立しました。` | `cogs/company/cog.py:64-65` |
| `company.stake_ok` | `🤝 出資しました` / `{user} が、{owner} の **{name}** に **{amount}** を出資しました（この会社への出資の合計 {total}）。\n出資は払い戻しできません。配当は、社長が決めた配当率で、出荷のたびに届きます。` | `cogs/company/cog.py:89-92` |
| `company.div_ok` | `配当率を決めました` / `これからの出荷では、買取代金の **{rate:.0%}** を出資者に配ります。` | `cogs/company/cog.py:110` |
| `company.bankrupt_post` | `🏚️ 倒産` / `<@{uid}> の **{name}** は、維持費を払えない日が続いたため倒産しました。` | `cogs/company/cog.py:143-144` |
| `company.panel_btns` | `📦 出荷する`, `💴 出資する`, `🏧 引き出す`, `🏗️ 増築する`, `🔁 種類を変える`, `🔄 更新` | `cogs/company/views.py:76-81` |
| `company.owner_only` | `これは他の人の会社です。\`/会社 状況\` で自分の会社を開けます。` | `cogs/company/views.py:60` |
| `company.holdings_title` | `🤝 出資先` | `cogs/company/embeds.py:79,91` |
| `company.err_katagi` | `帝愛への借金や、延滞中の貸付がある間は、会社の設立と出資はできません。` | `cogs/shared/messages/economy.py:29` |
| `company.err_no_budget` | `帝愛の買取予算（胴元の口座と、今日の買取枠）が尽きていて、いまは買い取ってもらえません。日付が変わると、買取枠が戻ります。` | `cogs/shared/messages/economy.py:37` |
| `company.err_locked` | `会社資金は、出資者から預かっている {locked:,}ペリカ を超える分しか引き出せません（出資者のお金は、増築や維持費には使えます）。` | `cogs/shared/messages/economy.py:41-42` |
| `company.ledger_found` | `会社設立:{name}（設立費・建設費）` | `infra/db/company.py:172` |
| `company.ledger_invest` | `会社へ出資:{name}` / `会社から引き出し:{name}` | `infra/db/company.py:198,229` |
| `company.ledger_stake` | `出資:{name}` / `配当:{name}` | `infra/db/company.py:254,330` |
