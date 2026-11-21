# P2P Loans (`/貸付`) Specification

Planned owner: `B3` | Screen ID: `loans` (`packages/shared/src/ids.ts`) | Feature toggle: `loan` (always allowed even when OFF: `貸付 返済`, `貸付 一覧`, and declining/cancelling existing offers)

## Source Files
- `catalogs/economy.yaml:20-30`
- `docs/teiai.md:111-124`
- `legacy/python/domain/loans.py:1-67`
- `legacy/python/infra/db/loans.py:1-432`
- `legacy/python/services/loan.py:1-94`
- `legacy/python/cogs/loan/cog.py:1-331`
- `legacy/python/cogs/loan/embeds.py:1-70`
- `legacy/python/cogs/loan/views.py:1-149`
- `legacy/python/cogs/shared/messages/economy.py:144-167,200-202`

## Rules & Exact Numbers

### 1. Parameters & Limits (`catalogs/economy.yaml:20-30`, `domain/loans.py:15-26`)
- `USER_MIN_PRINCIPAL = 100` Pelica (no upper cap on principal).
- Interest rate (`rate_tenths`): stored as integer tenths of 1% per day (`1` = `0.1%/day`, `0` = `0%/day`; no upper cap). Slash command accepts float `>= 0.0`, converted via `round(rate * 10)`.
- Term: `MIN_TERM_DAYS = 1`, `MAX_TERM_DAYS = 30` days.
- `OFFER_HOURS = 24` (expiry for pending lender offers and borrower requests).
- Concurrent caps:
  - `MAX_BORROWER_OPEN = 1` (active borrower `request` postings per user).
  - `MAX_LENDER_OPEN = 5` (pending lender `offer` postings per user).
  - `MAX_LENDER_ACTIVE = 10` (active + overdue lent loans per lender).
  - No cap on how many active loans a borrower can borrow simultaneously.
- `REMIND_HOURS = 24` (channel reminder posted once when `due - now <= 24h`).
- Late penalty parameters:
  - `LATE_MIN_RATE_TENTHS = 20` (`2.0%/day` minimum penalty rate).
  - `LATE_CAP = 2` (max cumulative late penalty = `2 * principal`).

### 2. Interest & Late Penalty Formulas (`domain/loans.py:33-66`)
- Simple daily interest, ceiling on elapsed days:
  - `elapsed_days(accepted_at, now, term_days) = min(term_days, max(1, math.ceil((now - accepted_at) / 86400)))` (minimum 1 day even if repaid immediately!).
  - `interest(principal, rate_tenths, days) = principal * rate_tenths * days // 1000` (integer floor division).
- Late penalty (when `now > due` where `due = accepted_at + term_days * 86400.0`):
  - `late_rate_tenths(r) = max(r * 3 // 2, 20)` (`max(1.5x contract rate, 2.0%/day)`).
  - `overdue_days = math.ceil((now - due) / 86400)`.
  - `late_interest = min(principal * 2, principal * late_rate_tenths * overdue_days // 1000)`.
- `total_owed = principal + interest(elapsed_days) + late_interest`.
- `remaining = max(0, total_owed - paid)`.
- Early repayment lowers regular interest because `elapsed_days` is evaluated at repayment timestamp `now`.

### 3. Two Creation Flows
1. **Lender Offer (`/貸付 提案`)**:
   - Lender specifies `member` (non-bot, != self), `principal`, `rate`, `days`.
   - Validates lender cash `>= principal`, `opened < 5`, `active < 10`. Does NOT lock lender cash at offer time!
   - Posts public offer embed pinging borrower with persistent `LoanButton` items (`承諾`, `辞退`, `取り下げ`).
   - When borrower clicks `承諾` (`loan_accept`): checks not expired, borrower not blacklisted & no overdue loans (Teiai debt IS allowed — refinancing), and re-checks lender balance `>= principal`. Transfers `principal` directly from lender to borrower (`income=0` so borrowed principal is NOT subject to Teiai 30% withholding!), sets `status='active'`, `accepted_at = now`, `due = now + term_days * 86400`.
2. **Borrower Request (`/貸付 募集`)**:
   - Borrower specifies `principal`, `rate`, `days`. Validates borrower not blacklisted, no overdue loans, and `< 1` open request.
   - Posts public request embed showing borrower credit report (`borrower_note`: status, Teiai debt, grace, repaid/overdue/discharged counts, active count/principal owed, last bankruptcy date — hides cash/stocks/deposits!) with `貸す` and `取り下げ` buttons.
   - First non-borrower to click `貸す` gets a 30s confirmation modal (`handle_lend`), then `loan_lend` atomically re-checks borrower eligibility, lender balance & `active < 10`, transfers cash, and marks `active`.

### 4. Repayment, Maturity Auto-Collection & Overdue Garnishment
- **Manual Repayment (`/貸付 返済`)**: borrower pays `amount` (or `min(remaining, balance)` if omitted). Deducts from borrower, credits lender (`income=0` — loan recovery is NOT taxed by Teiai withholding!). Sets `status='repaid'` when `remaining <= 0`.
- **Maturity Auto-Collection (`loan_collect_due`)**: runs every 1 minute. When `now >= due`, evaluates `remaining` at exact `loan["due"]` (so zero late penalty on the exact maturity sweep), seizes `min(borrower_balance, remaining)` and transfers to lender. If `left <= 0` → `repaid`; else → `overdue` (turns borrower status to `🟤 地下労働者`).
- **Overdue Income Garnishment (`collect_overdue_for`)**: P2P loans are **junior debt** behind Teiai debt. Whenever a borrower earns `income`, `AccountCore` withholds `30%`: first pays Teiai debt, and any leftover from that 30% budget is swept into overdue P2P loans in ascending `id` (oldest-first) order.
- **Bankruptcy Interaction**: During `bankrupt_for`, after Teiai debt is paid in full, any remaining liquidation pool pays active/overdue P2P loans oldest-first (`貸付の配当（借り手の自己破産）`); unpaid balances become `discharged` (lender loss). Borrower is blacklisted from borrowing until `7` days after Teiai debt reaches `0`.

## Timers & Schedules
- **1-Minute Tick (`LoanCog.tick`)**: expires offers/requests (`offer_expires <= now`), posts 24h-before-due reminders (`reminded = 0`), executes `loan_collect_due` and posts results to the originating channel (fallback: `announce_channel`).

## State Machine
- Offer path: `offer` → `active` (`accept`) | `declined` (`decline`) | `cancelled` (`cancel`) | `expired` (24h timeout).
- Request path: `request` → `active` (`lend`) | `cancelled` (`cancel`) | `expired` (24h timeout).
- Active path: `active` → `repaid` (manual or maturity auto-collect) | `overdue` (shortfall at maturity) | `discharged` (borrower bankruptcy).
- Overdue path: `overdue` → `repaid` (manual or garnishment) | `discharged` (borrower bankruptcy).

## Edge Cases
- Lender cash is NOT escrowed when posting `/貸付 提案`; if lender spends it before borrower clicks `承諾`, acceptance fails with `loan_lender_insufficient_balance`.
- `loan_collect_due` evaluates owed amount at `loan["due"]`, NOT `now`, so bot downtime does not add late penalties before the loan transitions to `overdue`.
- Repayment credit to lender passes `income=0`, so a lender in Teiai debt receives 100% of principal + interest back without 30% withholding.
- Overdue P2P loans put the borrower in `underground` status, but do NOT trigger bankruptcy grace (`grace_debt` counts Teiai debt only).

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `loan.group_name` | `貸付` (`🤝 ペリカの貸し借り（日割りの単利つき）`) | `cogs/loan/cog.py:75` |
| `loan.offer_title` | `🤝 貸付の提案 #{id}` | `cogs/loan/embeds.py:65` |
| `loan.request_title` | `🙋 貸付の募集 #{id}` | `cogs/loan/embeds.py:53` |
| `loan.state_title` | `🤝 貸付 #{id} {title}` (`成立` / `辞退されました` / `取り下げられました` / `承諾の期限が切れました` / `募集の期限が切れました`) | `cogs/loan/embeds.py:69`, `views.py:64,147`, `cog.py:265` |
| `loan.btn_labels` | `承諾`, `辞退`, `取り下げ`, `貸す` | `cogs/loan/views.py:26-29` |
| `loan.confirm_lend` | `この募集に貸しますか？` | `cogs/loan/views.py:87` |
| `loan.remind_msg` | `⏰ 貸付 #{id} の返済の期限は <t:{due}:R> です。<@{borrower}> さん、\`/貸付 返済\` で返せます（期限には、残高から自動で回収します）。` | `cogs/loan/cog.py:274` |
| `loan.due_repaid` | `✅ 貸付 #{id} の期限が来て、{collected}を回収し、返済が終わりました。` | `cogs/loan/cog.py:281` |
| `loan.due_overdue` | `⚠️ 貸付 #{id} は延滞です。{collected}を回収しましたが、残り {left} があります。<@{borrower}> さんに入るお金から、自動で回収していきます。` | `cogs/loan/cog.py:287` |
| `loan.err_blacklisted` | `破産のブラックリストの間は、貸付を借りられません（完済して7日たつと解除されます）。` | `cogs/shared/messages/economy.py:144` |
| `loan.err_overdue` | `延滞中の貸付があるので、借りられません。先に返してください。` | `cogs/shared/messages/economy.py:145` |
| `loan.ledger_lend` | `貸付→{borrower_id}（#{id}）` / `借入←{lender_id}（#{id}）` | `infra/db/loans.py:213-214,307-308` |
| `loan.ledger_repay` | `貸付の返済→{lender_id}（#{id}）` / `貸付の回収←{borrower_id}（#{id}）` | `infra/db/loans.py:76,78` |
