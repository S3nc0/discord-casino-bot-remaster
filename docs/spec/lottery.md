**English** | [日本語](lottery.ja.md)

# Lottery / Raffle Specification (`lottery`)

> Planned Owner: **B2-B** · Screen ID: `lottery` · Ledger Reasons: `lottery_ticket`, `lottery_payout`, `lottery_refund`

## 1. Source Files

- `catalogs/economy.yaml` (L54–L59): `raffle` constants
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `infra/db/raffle.py` (L1–L109): `RaffleRepo` open, join, close/draw/refund
  - `services/raffle.py` (L1–L45): `RaffleService` facade
  - `cogs/raffle/cog.py` (L1–L230): `RaffleCog` admin host/repost/cancel, persistent join handler, 20-second deadline loop
  - `cogs/raffle/embeds.py` (L1–L51): recruitment, result, and cancellation embeds
  - `cogs/raffle/views.py` (L1–L23): persistent `JoinView` (`custom_id="raffle:join"`)
  - `cogs/shared/messages/games.py` (L84–L90): failure messages

---

## 2. Rules, Exact Numbers & State Machine

### 2.1 Mechanics (`catalogs/economy.yaml:54-59`, `infra/db/raffle.py:39-108`, `cogs/raffle/cog.py:34-38`)
- Admin-hosted per guild (`/運営 抽選 …`); at most **1** open raffle per guild (`raffle_already_open`).
- **Entry Fee (`fee`)**:
  - Admin UI min fee: `MIN_FEE = 500` (no upper cap; DB lower bound `fee >= 1`).
  - If omitted when hosting: random 100-Pelica multiple in `[500, 3000]` (`RANDOM_FEE_RANGE = [500, 3000]`).
- **Duration (`minutes`)**: default `DEFAULT_MINUTES = 60`, max `MAX_MINUTES = 1440` (24h).
- **Zero House Edge (100% RTP)**: Winner takes `fee * len(entries)` with **0% fee**.
- **Joining**:
  - 1 entry per user per raffle (`raffle_already_joined`).
  - Blocked if `now >= closes` (`raffle_closed`), if user has `debt > 0` (`debt_blocks`, verb=`"参加できません"`), or if `balance < fee`.
  - Fee deducted immediately (`抽選参加費`).
- **Drawing / Refunding**:
  - Background loop checks every **20 seconds** (`cogs/raffle/cog.py:175`).
  - If `len(entries) >= 2` and not cancelled: uniform `rng.choice(entries)` wins `prize = fee * len(entries)` (`抽選当選`, `income = prize`).
  - If `len(entries) < 2` OR cancelled by admin: every entrant receives full refund `fee` (`返金:抽選`, `income = 0`).
- **Exclusions**: Does NOT count toward missions, win streaks, weekly rankings, or random casino events (`cogs/raffle/cog.py:6`).

### 2.2 State Machine
```
[ open ] ──(now >= closes, entrants >= 2)──► [ done ] (1 winner paid fee * N)
   │     ──(now >= closes, entrants < 2)───► [ done ] (all refunded)
   └───────(admin cancel)──────────────────► [ cancelled ] (all refunded)
```

---

## 3. Edge Cases

- Reposting updates `message_id` (and `channel_id`), automatically invalidating buttons on the old post (`raffle["message_id"] != interaction.message.id` returns `"募集は終わりました"`).
- Display lists up to `SHOWN_ENTRANTS = 20` entrants, collapsing the rest as `ほか{n}人`.
- If posting the recruitment message fails via Discord HTTP error, `host()` immediately cancels the DB record (`cogs/raffle/cog.py:94-96`).

---

## 4. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
|---|---|---|
| `raffle.embed.open_title` | `🎟️ 抽選 参加者募集中！` | `cogs/raffle/embeds.py:27` |
| `raffle.embed.closed_title` | `🎟️ 抽選（募集終了）` | `cogs/raffle/cog.py:212` |
| `raffle.embed.fee_line` | `参加費: **{fee}**（全員同じ額。押した時点で先に引かれます）` | `cogs/raffle/embeds.py:20` |
| `raffle.embed.prize_line` | `いまの賞金: **{prize}**（集めた参加費の全額。当選者は1人）` | `cogs/raffle/embeds.py:23` |
| `raffle.embed.refund_note` | `参加者が2人に満たないときは、全員に全額を返します。` | `cogs/raffle/embeds.py:25` |
| `raffle.btn.join` | `参加する` (`🎟️`) | `cogs/raffle/views.py:20` |
| `raffle.join.ok_title` | `参加しました` | `cogs/raffle/cog.py:168` |
| `raffle.join.ok_body` | `参加費 {fee} を預かりました。結果は締切にこのメッセージの下へ出ます。` | `cogs/raffle/cog.py:169` |
| `raffle.result.win_title` | `🎟️ 抽選 結果発表！` | `cogs/raffle/embeds.py:37` |
| `raffle.result.win_line` | `🎉 当選: <@{winner}>\n賞金: **{prize}**（参加 {n}人 × {fee}）` | `cogs/raffle/embeds.py:34-35` |
| `raffle.result.empty` | `参加者がいなかったので、抽選は行いませんでした。` | `cogs/raffle/embeds.py:39` |
| `raffle.result.too_few` | `参加者が{n}人だったので、抽選は行わず、全員に{fee}を返しました。` | `cogs/raffle/embeds.py:41` |
| `raffle.cancel.title` | `🎟️ 抽選 中止` | `cogs/raffle/embeds.py:47` |
| `raffle.cancel.body` | `抽選は中止されました。参加した{n}人に参加費を返しました。` | `cogs/raffle/embeds.py:48` |
| `raffle.err.min_fee` | `参加費は1ペリカ以上にしてください。` | `cogs/shared/messages/games.py:84` |
| `raffle.err.already_open` | `すでに募集中の抽選があります。` | `cogs/shared/messages/games.py:85` |
| `raffle.err.closed` | `募集は終わりました。` | `cogs/shared/messages/games.py:86` |
| `raffle.err.already_joined` | `すでに参加しています。` | `cogs/shared/messages/games.py:87` |
| `raffle.err.insufficient_balance` | `残高が足りません（参加費 {fee:,}ペリカ、いまの残高 {balance:,}ペリカ）。` | `cogs/shared/messages/games.py:89` |
| `raffle.ledger.join` | `抽選参加費` | `infra/db/raffle.py:83` |
| `raffle.ledger.refund` | `返金:抽選` | `infra/db/raffle.py:102` |
| `raffle.ledger.win` | `抽選当選` | `infra/db/raffle.py:107` |
