**English** | [日本語](transfer.ja.md)

# Player Transfer Specification

Planned owner: `B2-B` | Screen ID: `transfer` (`packages/shared/src/ids.ts`) | Feature toggle: none

## Source Files
- `catalogs/economy.yaml:13-17`
- `legacy/python/domain/types.py:84-90`
- `legacy/python/infra/db/wallet.py:305-356`
- `legacy/python/services/economy.py:132-148`
- `legacy/python/cogs/economy/cog.py:35-40,256-317`
- `legacy/python/cogs/shared/confirm.py:13-87`
- `legacy/python/cogs/shared/messages/economy.py:20,84,88-97`

## Rules & Exact Numbers

### Constants (`catalogs/economy.yaml:13-17`)
- `TRANSFER_FEE_RATE = 0.10` (10% fee, paid ON TOP by sender; receiver gets the exact `amount`).
- `TRANSFER_DAILY_LIMIT = 20_000` (sum of sent principal per calendar day in configured timezone, default JST `00:00` reset; fees do NOT count toward the daily limit).
- `TRANSFER_CONFIRM_FROM = 5_000` (amounts `>= 5,000` require an ephemeral confirmation button with 30s timeout).
- `TRANSFER_MIN_GAMES = 3` (sender must have `users.games_played >= 3`; anti-alt farming guard).
- Slash command input range: `1 <= amount <= 1_000_000` (`cogs/economy/cog.py:265`).

### Fee Formula
- `fee = math.ceil(round(amount * fee_rate, 6)) if fee_rate else 0` (`infra/db/wallet.py:320-322`, `cogs/economy/cog.py:277`).
- Rounded to 6 decimal places before ceiling to prevent IEEE 754 float artifacts (e.g. `amount = 10` → `round(1.0, 6)` → `fee = 1`; `amount = 1` → `fee = 1`, minimum 1 Pelica for any positive amount).
- Fee is burned (NOT credited to Teiai house account).

### Validation Order
1. **Cog pre-checks** (`cogs/economy/cog.py:267-295`):
   - Rejects `member.bot == True` (`Bot には送金できません。`).
   - Acquires per-user session lock (`user_session(sessions, interaction, "いまは送れません")`) so players cannot siphon cash mid-game or start a game during confirmation.
   - Pre-checks `balance_of(gid, uid) < amount + fee` before showing confirmation UI.
   - If `amount >= 5_000`: prompts ephemeral `ConfirmView` (`timeout = 30s`, owner-only).
2. **Repository atomic checks inside DB transaction** (`infra/db/wallet.py:316-355`):
   1. `sender == receiver` → `transfer_self`
   2. `amount <= 0` → `amount_must_be_positive`
   3. Ensures both `sender` and `receiver` accounts exist (`account.ensure` — note: sending to an unregistered user creates their account with initial `3,000`!).
   4. Checks `sender.games_played < min_games` (3) → `transfer_min_games`
   5. Computes `sent_today = -COALESCE(SUM(delta), 0)` from `ledger` where `reason LIKE '送金（送）%' AND ts >= day_start_ts` (midnight `00:00` of `now.date()` in configured TZ).
      If `sent_today + amount > daily_limit` (20,000) → `transfer_daily_limit`.
   6. Checks `sender_debt = account.debt(gid, sender)` (accruing interest). If `sender_debt > 0` → `debt_blocks` (`verb="送金はできません"`).
   7. Checks `raw_balance(gid, sender) < amount + fee` → `transfer_insufficient_balance`.

### Ledger Execution (`infra/db/wallet.py:349-355`)
1. `account.apply(gid, sender, -amount, f"送金（送）→{receiver}")` (no `income`)
2. If `fee > 0`: `account.apply(gid, sender, -fee, "送金手数料")` (separate row so `sent_today` sums principal only; `domain/history.py:62-64` folds this row back into the transfer line for display)
3. `account.apply(gid, receiver, amount, f"送金（受）←{sender}", income=amount)` — note `income=amount` means if the receiver has Teiai debt, 30% (`repay_rate = 0.30`) of the received amount is automatically withheld for debt repayment!

## State Machine
- `IDLE` --(`/ペリカ 送金`)--> `LOCKED` (user session acquired)
  - If `amount >= 5,000`: `LOCKED` → `CONFIRMING` (30s timeout) → `EXECUTING` (on click) or `CANCELLED` (on cancel/timeout).
  - If `amount < 5,000`: `LOCKED` → `EXECUTING`.
- `EXECUTING` --(atomic DB tx)--> `DONE` (public success embed pinging `receiver` only, or ephemeral error embed) → releases session lock.

## Edge Cases
- Sending to an unregistered user triggers `account.ensure(gid, receiver)` BEFORE checking `games_played`/`daily_limit`/`debt`/`balance` (`infra/db/wallet.py:325-326`), which creates the receiver's account with `3,000` even if the transfer subsequently fails on validation! (Important legacy quirk.)
- Receivers in debt CAN receive transfers; the received amount triggers `withhold_income` (30% debt repayment, `repay_rate = 0.30`) because `income=amount`.
- Senders in debt CANNOT send transfers (`debt_blocks`).
- Senders are NOT blocked by bankruptcy grace directly via `grace_lock`, because anyone in bankruptcy grace has `debt >= 15,000` (`grace_debt = 15,000`) `> 0` and is already blocked by `debt_blocks`.
- Pre-check in Cog calls `balance_of` (which calls `ensure`), so an unregistered sender gets their 3,000 account created before `transfer()` runs.

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `transfer.cmd_name` | `送金` | `cogs/economy/cog.py:260` |
| `transfer.cmd_desc` | `ほかの人にペリカを送る（手数料10%）` | `cogs/economy/cog.py:260` |
| `transfer.opt_member_name` | `相手` (`送る相手`) | `cogs/economy/cog.py:261-262` |
| `transfer.opt_amount_name` | `金額` (`送る金額`) | `cogs/economy/cog.py:261-262` |
| `transfer.err_bot_title` | `送れません` | `cogs/economy/cog.py:269` |
| `transfer.err_bot_body` | `Bot には送金できません。` | `cogs/economy/cog.py:269` |
| `transfer.busy_title` | `いまは送れません` | `cogs/economy/cog.py:272` |
| `transfer.err_title` | `送金できません` | `cogs/economy/cog.py:282,308` |
| `transfer.confirm_title` | `送金しますか？` | `cogs/economy/cog.py:289` |
| `transfer.confirm_body` | `{member_mention} に **{amount}** を送ります。\n手数料: {fee}（合計 {total} が引かれます）` | `cogs/economy/cog.py:290` |
| `transfer.confirm_btn` | `送金する` | `cogs/economy/cog.py:291` |
| `transfer.cancel_btn` | `キャンセル` | `cogs/shared/confirm.py:31` |
| `transfer.confirm_owner_only` | `この操作を実行できるのはコマンドを使った本人だけです。` | `cogs/shared/confirm.py:18` |
| `transfer.confirm_running` | `実行します` / `処理中です…` | `cogs/shared/confirm.py:44` |
| `transfer.confirm_cancelled` | `中止` / `キャンセルしました。` | `cogs/shared/confirm.py:45` |
| `transfer.confirm_timeout` | `中止` / `30秒以内に操作がなかったため、中止しました。` | `cogs/shared/confirm.py:46` |
| `transfer.ok_title` | `送金しました` | `cogs/economy/cog.py:311` |
| `transfer.ok_body` | `{member_mention} に **{received}** を送りました。\n手数料: {fee}　あなたの残高: **{sender_balance}**` | `cogs/economy/cog.py:312-313` |
| `transfer.fail_self` | `自分には送金できません。` | `cogs/shared/messages/economy.py:88` |
| `transfer.fail_positive` | `金額は1以上にしてください。` | `cogs/shared/messages/economy.py:20` |
| `transfer.fail_min_games` | `送金は、{min_games}回以上ゲームで遊んでからできます（複数アカウントでの稼ぎ対策です）。` | `cogs/shared/messages/economy.py:90` |
| `transfer.fail_daily_limit` | `1日の送金は合計 {daily_limit:,} ペリカまでです（今日は {sent_today:,} ペリカ送金済み）。` | `cogs/shared/messages/economy.py:93` |
| `transfer.fail_debt` | `借金が {debt:,}ペリカ 残っているので、送金はできません。` | `cogs/shared/messages/economy.py:84` / `infra/db/wallet.py:346` |
| `transfer.fail_balance` | `残高が足りません（送金額 {amount:,} + 手数料 {fee:,} が必要です）。` | `cogs/shared/messages/economy.py:96` |
| `transfer.ledger_out` | `送金（送）→{receiver_id}` | `infra/db/wallet.py:350` |
| `transfer.ledger_fee` | `送金手数料` | `infra/db/wallet.py:353` |
| `transfer.ledger_in` | `送金（受）←{sender_id}` | `infra/db/wallet.py:354` |
