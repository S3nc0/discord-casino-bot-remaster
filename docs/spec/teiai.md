# Teiai Bank, Debt, Bankruptcy Grace, CDS, Thermostat & Escape Specification

Planned owner: `B3` | Screen IDs: `teiai-bank`, `teiai-bank-cds`, `teiai-bank-debt` (`packages/shared/src/ids.ts`) | Feature toggle: none (always enabled; `/ペリカ 帝愛`, `/ペリカ 返済`, `/ペリカ 破産`)

> Related specs: Teiai Corporate Bonds (`docs/spec/stocks.md`), P2P Loans (`docs/spec/p2p-loans.md`), Teiai Kyosai (`docs/spec/kyosai.md`).

## Source Files
- `catalogs/teiai.yaml:1-112`
- `docs/teiai.md:1-110`
- `legacy/python/domain/teiai.py:1-115`
- `legacy/python/domain/thermostat.py:1-89`
- `legacy/python/domain/rates.py:1-68`
- `legacy/python/infra/db/bank.py:1-755`
- `legacy/python/infra/db/debt.py:1-669`
- `legacy/python/infra/db/repositories.py:202-276`
- `legacy/python/services/teiai.py:1-135`
- `legacy/python/cogs/teiai/panel.py:1-308`
- `legacy/python/cogs/teiai/escape.py:1-100`
- `legacy/python/cogs/teiai/texts.py:1-64`
- `legacy/python/cogs/shared/messages/economy.py:109-142`
- `legacy/python/cogs/shared/messages/notices.py:10-20,25-30,39-41`

## Rules & Exact Numbers

### 1. Teiai Finance (Debt, Interest, Withholding, Skims, Seed Loans, Status)
- **Constants** (`catalogs/teiai.yaml:2-16,34-39,66,97-112`, `domain/teiai.py:19-55,80-101`):
  - `SEED = 3_000` (seed loan cap & Blackjack Teiai credit double cap)
  - `REPAY_RATE = 0.30` (30% of eligible `income` withheld toward debt: `int(income * 0.30)`; senior Teiai first, remaining budget to overdue P2P loans oldest-first)
  - `SKIM_RATE = 0.20` (20% daily bonus skim while in debt: `int(amount * 0.20)`, credited to Teiai House Account `teiai_house`, does NOT reduce debt)
  - `LABOR_SKIM_RATE = 0.03` (3% labor pot claim skim credited to `teiai_house`; note `docs/teiai.md:46` stale-says 1%)
  - `HORSE_PRIZE_SKIM_RATE = 0.0` (0%)
  - `DEBT_RATE_PER_DAY = 0.01` (1%/day simple interest = トイチ, whole completed days only)
  - `DEBT_INTEREST_MAX_DAYS = 10` (caps single accrual at 10 days; excess elapsed days reset `debt_interest_at = now`)
  - `GRACE_DEBT = 15_000` (debt `>= 15,000` triggers 24h bankruptcy grace)
  - `DEBT_INTEREST_CEILING = GRACE_DEBT - 1 = 14_999` (interest alone never pushes a user into grace!)
  - `GRACE_HOURS = 24`
  - `BANKRUPT_FLOOR = 10_000` (debt compressed to at most `10,000` on voluntary/forced bankruptcy; `0` on successful escape)
  - `BLACKLIST_DAYS = 7` (P2P loan borrowing ban for 7 days AFTER debt reaches 0 following bankruptcy)
  - `SEIZE_RATE = 0.50` (50% liquidation rate on unsellable junk bonds, shop belongings, and owned horses)
  - `WEALTHY_ASSETS = 1_000_000` (cosmetic `🟡 富豪` display status when `status == katagi` and `net_worth >= 1,000,000`)
- **Statuses** (`infra/db/debt.py:294-308`):
  1. `bankrupt` (`🔴 破産者`): `bankrupt_at IS NOT NULL AND debt > 0`.
  2. `underground` (`🟤 地下労働者`): `debt > 0 OR has_overdue_p2p_loan`.
  3. `katagi` (`🟢 カタギ`): otherwise (displayed as `🟡 富豪` if `net_worth >= 1,000,000`).
  - While `underground` or `bankrupt`, shop titles/card skins/effects/collections are frozen (not lost; restored on returning to `katagi`).
- **Debt Interest Accrual** (`infra/db/debt.py:336-375`):
  - If `debt <= 0`: resets `debt_interest_at = 0`.
  - If `debt_interest_at == 0`: initializes `debt_interest_at = now` (0 interest charged on init).
  - `days = int(max(0.0, now - since) // 86400)`; if `days <= 0`, return `0`.
  - `counted = min(days, 10)`; `add = max(0, min(int(debt * 0.01 * counted), 14_999 - debt))`.
  - `new_since = now if days > counted else since + days * 86400.0`.
- **Forced Execution Order (`owe_for`)** (`infra/db/debt.py:425-430,487-503`, `infra/db/repositories.py:254-263`):
  1. Cash (`users.balance`)
  2. Teiai Trust deposit (`DepositSeizureStep`, ignores bank freeze/available cash limits)
  3. Company funds (`CompanySeizureStep`, leaves facility intact)
  4. Margin positions (`MarginSeizureStep`)
  5. Spot holdings (`CryptoSeizureStep`, `taxable=False`)
  6. Active options (`OptionSeizureStep`)
  7. Sellable normal bonds (`BondSeizureStep`)
  8. Self-CDS coverage (`cds_cover_self_for`, oldest active self-CDS first, one-shot per contract, no cash handed to user)
  9. Remaining `need > 0` added to `users.debt`; if `cash == 0`, auto-lends `SEED = 3,000`; runs `grace_update_for`.
- **Seed Loans** (`infra/db/debt.py:432-485`):
  - Manual (`/ペリカ 帝愛` button `種銭を借りる`): blocked if `bankrupt`, in grace, or `balance >= 3,000`; lends `3,000 - balance` (adds to `debt`, public announcement).
  - Auto on debt creation (`_seed_if_empty_for`): if `debt > 0 and balance == 0`, lends `3,000`.
  - Auto on daily claim (`topup_seed_for`): if `debt > 0 and balance < 3,000`, lends `3,000 - balance`.
  - Blackjack credit double (`can_borrow_for_bet`): up to `3,000`, blocked if `bankrupt` or in grace.
- **Voluntary Repayment** (`/ペリカ 返済`, `infra/db/debt.py:508-529`):
  - Repays `min(debt, balance)` if amount omitted; triggers `after_debt_change` (exits grace if `< 15,000`; starts 7-day blacklist timer when bankrupt user hits `debt == 0`).

### 2. Bankruptcy & Overseas Escape (海外逃亡)
- **Bankruptcy Sequence (`bankrupt_for`)** (`infra/db/debt.py:600-666`, `infra/db/repositories.py:264-276`):
  - Blocked if already `bankrupt` OR (`debt <= 0` and no active/overdue P2P loans).
  - 1. `bankrupt_prep_hook`: pulls back all active P2P listings & bids, plus active Kyosai auction bids (refunded cash enters liquidation pool).
  - 2. `liquidation_step`: Margin → Spot (`taxable=False`) → Bonds (normal cancelled via DCF, junk written off at 50%) → Options → Teiai Trust deposits → Company dissolved (funds returned to cash, stakes wiped) → Kyosai units recovered to `HOUSE` (0 value).
  - 3. Cash seized into `pool`.
  - 4. Shop belongings & owned horses seized (sent to Teiai seized auction; `int(purchase_value * 0.50)` added to `pool`).
  - 5. Waterfall distribution: Senior Teiai debt paid first → Junior P2P loans paid oldest-first (`repaid` if remaining == 0, else `discharged`) → surplus returned to user (`破産の整理のあまり`).
  - 6. Teiai debt compressed to `<= 10,000` (or `0` if `escape=True`). `bankrupt_at = now`, `blacklist_until = NULL`.
  - 7. `after_debt_change`, `_seed_if_empty_for` (note: if `escape=True`, `debt == 0`, so no seed loan!), clear `grace_until`.
  - 8. CDS settlement: `payable = forced or in_grace`. If `payable`, runs `cds_settle_default_for(..., debt_before, now)`; else `cds_void_for`.
  - **Doc vs Code Nuance**: `docs/teiai.md:35` states escape voids CDS, whereas `infra/db/debt.py:650` checks `payable = forced or in_grace` — escaping while already in grace DOES settle third-party CDS; escaping before grace voids them.
- **Overseas Escape (`escape_attempt`)** (`catalogs/teiai.yaml:10-15`, `infra/db/debt.py:547-598`, `cogs/teiai/escape.py:45-100`):
  - Requirements: not `bankrupt`, `debt >= 5,000`, `escape_tries < 2` (lifetime cap per guild), cooldown `24h` since last attempt.
  - Confirmation modal, then outcome rolled immediately (`ESCAPE_CHANCE = 0.01`, 1%), followed by 6-frame ASCII ship animation (`1.4s` per frame = `8.4s` total).
  - Success (1%): calls `bankrupt_for(..., escape=True)` → all assets seized, loans discharged, `debt = 0`, 7-day loan blacklist.
  - Failure (99%): adds fine `max(1_000, int(debt * 0.10))` to `debt` (can push user into bankruptcy grace!), starts 24h cooldown.

### 3. Teiai Bank (Fractional Reserve Trust, Bank Run, Waterfall, CIR `r_f`, House Account)
- **Constants** (`catalogs/teiai.yaml:41-57`, `domain/teiai.py:58-71`):
  - `BANK_MIN_DEPOSIT = 100` (`katagi` only).
  - `RESERVE_RATIO = 0.20` (on deposit, 20% → `cash`, 80% → `loaned` underground loans).
  - `LOAN_RECOVERY_PER_HOUR = 0.02` (`moved = loaned * (1 - 0.98^hours)` recovers to `cash` continuously on sync).
  - `LOCK_DEBT_RATE = 0.05` (5% of every debtor's debt locked as reserve provision).
  - `TRUST_PREMIUM_PER_DAY = 0.001` (default +0.1%/day above `r_f`; changeable via Kyosai motion).
  - `RUN_WARN_RATIO = 0.15` (`🟡`), `RUN_DANGER_RATIO = 0.05` (`🔴`), `available <= 0` when `liabilities > 0` → `frozen` (`🚨 支払停止`).
  - `RF_MIN_PCT = 1.5`, `RF_MAX_PCT = 8.0`, `RF_ALPHA = 4.25`, `RF_KAPPA_PER_DAY = 2.0`, `RF_SIGMA = 0.02`.
- **Available Cash & Reserve Ratio `θ`** (`infra/db/bank.py:166-190`):
  - `locks = sum(0.05 * u.debt) + sum(min(third_party_cds_claims, 0.50 * u.debt) for u in grace)`
  - `available = cash - locks`
  - `liabilities = total_trust_deposits + total_active_bond_principal`
  - `θ = available / liabilities` (or `None` if `liabilities == 0`).
  - Withdrawals capped at `int(available)`; first-come, first-served (bank run mechanics).
- **Teiai Trust Hourly Interest (`bank_trust_accrue`)** (`infra/db/bank.py:442-483`):
  - Runs once elapsed `>= 1h` since `trust_ts` (first call initializes `trust_ts = now`).
  - Rate `r_trust = r_f + trust_premium` (daily continuous compounding).
  - `due = total_deposits * expm1(r_trust * hours / 24) + trust_accrued`.
  - Paid via `_outflow_for(..., int(due), use_trust=False, thermo=True)` (cash → thermostat/kyosai, NEVER haircuts trust to pay trust).
  - Distributed pro-rata `paid * amt // total` directly to depositor cash balance (`income=gain`), unallocated dust returned to cash and carried in `trust_accrued`.
- **Bank Payment Waterfall (`_outflow_for` / `bank_pay_batch_for`)** (`infra/db/bank.py:313-401`):
  1. Bank `cash` (`cash_pay = min(amount, max(cash, 0))`).
  2. **Teiai Trust Haircut (First Loss)** (`use_trust=True`): takes `min(ceil(shortfall - 1e-9), total_deposits)`, scales every depositor balance by `int(amt * (1 - take / total))`. Trust never goes negative.
  3. **Excess Loss**: `excess = max(0, shortfall - trust_take)`.
     - Thermostat absorbs `shock = max(0, -net - trust_take)` → returns `bailout` (`0` while `enforce=False`).
     - Remaining `left = int(excess - cover)` charged to Kyosai holders via `charge_excess_for`; unpaid HOUSE share recorded in `excess_unpaid`.
- **Teiai House Account (`teiai_house`)** (`infra/db/bank.py:235-293`):
  - Separate from bank reserves (`teiai_bank`).
  - Receives daily/labor skims (`house_income_for`, increments `skimmed`) and company build/upkeep fees (`house_receive_for`).
  - Funds company shipment buyouts (`house_pay_for`) before falling back to daily `30,000` grant (`grant_day`, `grant_used`).

### 4. Frontline Thermostat (`domain/thermostat.py`)
- **Constants** (`catalogs/teiai.yaml:69-74`): `ENFORCE = False` (observation-only mode in legacy!), `COOL_DAYS = 7` (`λ_L = ln(10)/7`), `memory_ratio = 4` (`λ_E = λ_L / 4`, 28d), `E_MIN = 20_000.0`, `COUPLING = 1.0`.
- **Exact Decay over `days`**:
  - `fall_l = exp(-λ_L * days)`, `fall_e = exp(-λ_E * days)`
  - `E' = max(E_MIN, E_MIN + (E - E_MIN) * fall_e + L * (fall_e - fall_l))`
  - `L' = L * fall_l`
- **Split-Invariant Absorption**:
  - `compute_net(amount, load, cap) = (max(cap - c*load, 0) / c) * (-expm1(-c * amount / cap))`
  - `absorb_inflow(state, gain)`: passes `fill = min(gain, max(-L, 0))` straight through, passes `gain - fill` through `compute_net` → `(state', net, burn)`.
  - `absorb_shock(state, loss)`: passes `covered = min(loss, max(L, 0))` straight through, passes `loss - covered` through `compute_net` → `(state', effective, bailout)`.
  - While `ENFORCE = False`: tracks `thermo_load`, `thermo_capacity`, `thermo_burned`, `thermo_bailed` for display without altering bank cash.

### 5. Credit Default Swaps (CDS)
- **Constants** (`catalogs/teiai.yaml:59-64`, `domain/teiai.py:74-78,103-108`):
  - `CDS_MIN_STAKE = 100`, `CDS_MIN_ODDS = 1.2`, `CDS_MAX_ODDS = 15.0`, `CDS_TERM_DAYS = 14`.
  - `CDS_SELF_CAP = 50_000` (max active self-CDS total expected payout `SUM(stake * odds)`).
  - `CDS_PAYOUT_CAP_RATE = 0.50` (aggregate third-party CDS payout capped at `50% * debt_before` on default, scaled pro-rata).
- **Odds Formula** (`domain/teiai.py:103-108`):
  - `r = 0.04` if `status == "katagi"` else `0.25 + 0.5 * min(1.0, debt / 15_000)`.
  - If `margin_ratio is not None and margin_ratio < 1.5`: `r += 0.1`.
  - `odds = round(min(15.0, max(1.2, 0.85 / r)), 1)`.
  - Examples: `katagi` clean → `0.85 / 0.04 = 21.25` → clamped `15.0x`; `katagi` with `margin_ratio < 1.5` → `0.85 / 0.14 = 6.1x`; `underground` with `debt = 15,000` → `0.85 / 0.75 = 1.13` → clamped `1.2x`.
- **Restrictions**: Cannot buy CDS on a target already in grace (`cds_target_in_grace`) or already `bankrupt` (`cds_target_bankrupt`), or unregistered user. Stake goes directly to Teiai Bank (`bank_income_for`).
- **Payout Visibility**: Buying self-CDS is ephemeral; buying third-party CDS is **public** (`💀 {buyer} が、<@{target}> の破産に賭けた`).

## Timers & Schedules
- **1-Minute Economy/Bank Loop**: `grace_expire` (expires CDS past `expires`, executes forced bankruptcy for `grace_until <= now`), `bank_rf_tick` (CIR step for `r_f`), `bank_trust_accrue` (pays hourly when elapsed `>= 1h`).
- **2-Minute Nickname Sync**: appends `【地下労働者】`, `【破産者】`, or `【富豪】` to nicknames.
- **UI Timeouts**: `TeiaiPanel` = `300s`, `TargetView` = `120s`, `ConfirmView` = `30s`.

## State Machine
- **Player Debt/Status**: `katagi` → `underground` (`debt > 0` or overdue loan) → `grace` (`debt >= 15,000`, 24h timer) → `bankrupt` (voluntary or forced; `debt <= 10,000`, `bankrupt_at` set) → `debt == 0` (status returns to `katagi`/`underground`; 7-day `blacklist_until` starts).
- **Bank Liquidity Level**: `safe` (`θ >= 0.15` or `None`) ↔ `warn` (`0.05 <= θ < 0.15`) ↔ `danger` (`0 < θ < 0.05`) ↔ `frozen` (`available <= 0` and `liabilities > 0`).
- **CDS Contract**: `active` → `paid` (self-covered or target defaulted while forced/in-grace) | `void` (target voluntarily bankrupted before grace) | `expired` (`now >= expires`).

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `teiai.panel_title` | `🏦 帝愛銀行` | `cogs/teiai/panel.py:77` |
| `teiai.house_field` | `🕴️ 帝愛の胴元の口座` | `cogs/teiai/panel.py:79` |
| `teiai.thermo_title` | `🌡️ サーモスタット` | `cogs/teiai/texts.py:62` |
| `teiai.thermo_obs` | `（いまは観測だけ。銀行の現金には、まだ反映していません）` | `cogs/teiai/texts.py:63` |
| `teiai.level_safe` | `🟢 余裕あり` | `cogs/teiai/texts.py:49,56` |
| `teiai.level_warn` | `🟡 取り付け警戒` | `cogs/teiai/texts.py:50,57` |
| `teiai.level_danger` | `🔴 取り付け危険水域！` | `cogs/teiai/texts.py:51,58` |
| `teiai.level_frozen` | `🚨 支払停止（信託の解約停止）` | `cogs/teiai/texts.py:52,59` |
| `teiai.btn_deposit` | `信託に入れる` | `cogs/teiai/panel.py:226` |
| `teiai.btn_withdraw` | `信託から引き出す` | `cogs/teiai/panel.py:232` |
| `teiai.btn_cds` | `CDS を掛ける` | `cogs/teiai/panel.py:254` |
| `teiai.btn_seed` | `種銭を借りる` | `cogs/teiai/panel.py:267` |
| `teiai.btn_escape` | `🚢 海外逃亡チャンス！！` | `cogs/teiai/panel.py:281` |
| `teiai.cds_public_title` | `💀 {buyer} が、<@{target}> の破産に賭けた` | `cogs/teiai/panel.py:178` |
| `teiai.seed_public_title` | `💸 {name} が帝愛から種銭を借りました` | `cogs/teiai/panel.py:273` |
| `teiai.escape_confirm` | `海外逃亡を試しますか？` / button `逃亡する！` | `cogs/teiai/escape.py:55,63` |
| `teiai.escape_ok` | `🎉 {name} の海外逃亡、成功！！` | `cogs/teiai/escape.py:88` |
| `teiai.escape_fail` | `🚨 {name} の海外逃亡、失敗…` | `cogs/teiai/escape.py:95` |
| `teiai.err_frozen` | `🚨 帝愛は支払停止中です（信託の解約停止）。手元の現金が、引当金のロックで尽きています。` | `cogs/shared/messages/economy.py:113` |
| `teiai.err_katagi` | `帝愛信託に入れられるのは、🟢 カタギだけです（借金か延滞がある人、破産者は入れられません）。` | `cogs/shared/messages/economy.py:109` |
| `teiai.err_cds_grace` | `その人は、すでに破産猶予に入っているので、掛けられません。` | `cogs/shared/messages/economy.py:118` |
| `teiai.err_cds_self_cap` | `自分への CDS は、配当の見込みの合計が {cap:,}ペリカ までです（いま {have:,}ペリカ分。あと掛けられるのは {room:,}ペリカ）。` | `cogs/shared/messages/economy.py:121-122` |
| `teiai.notice_grace_in` | `⚠️ 借金が {grace_debt:,}ペリカ に達し、**破産猶予**に入りました。<t:{until}:R> までに借金を {grace_debt:,}ペリカ 未満へ戻せなければ、強制破産です。` | `cogs/shared/messages/notices.py:11-12` |
| `teiai.notice_grace_out` | `😮‍💨 借金が減り、破産猶予から抜けました。` | `cogs/shared/messages/notices.py:14` |
| `teiai.ledger_deposit` | `帝愛への預金` | `infra/db/bank.py:515` |
| `teiai.ledger_withdraw` | `帝愛からの引き出し` | `infra/db/bank.py:547` |
| `teiai.ledger_trust_int` | `帝愛信託:利息` | `infra/db/bank.py:472` |
| `teiai.ledger_repay` | `帝愛への返済` / `帝愛への返済（収入から天引き）` | `infra/db/debt.py:403,527` |
| `teiai.ledger_seed` | `帝愛の種銭貸付` | `infra/db/debt.py:434` |
| `teiai.ledger_interest` | `帝愛の利息（トイチ・日利{rate:.0%}・{days}日分）+{add:,}` | `infra/db/debt.py:372` |
