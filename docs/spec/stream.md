**English** | [日本語](stream.ja.md)

# Stream Panel (`stream`, upstream catch-up)

> Status: **contract spec for Wave 5** (cards S0 contracts, S1 server, S2 Activity, S3 chat bot). Planned owner: **S0** (this file and `packages/shared`) · Screen ID: `stream` · Feature toggle: `stream` · New ledger reasons: `stream_bet`, `stream_payout`, `stream_refund`.
>
> Source: upstream commits `eff8eac` (super chats and win/lose bets) and `213c555` (voice channel location). The numbers and Japanese wording are the upstream's; §0 lists what the owner changed (decisions **D3** and **D4**, 2026-11-24). Where this file and the upstream differ, this file wins.

## 0. Owner decisions that differ from the upstream

| # | Upstream | Remaster |
| --- | --- | --- |
| D3-1 | The streamer can declare win or lose while bets are still open. | **A round must be locked before win or lose can be declared** (`stream_not_locked`). Voiding is allowed at any time, open or locked. |
| D3-1 | Bets close only when the streamer presses "lock". | Bets also **close by themselves 10 minutes after the round opens** (`ROUND_AUTO_LOCK_MS = 600_000`). The streamer can lock earlier. |
| D3-2 | No owner tool. | **`/admin stream-void`** voids a round (or a stream's active round) with a written reason, and every round that ends writes an **audit row** (§9). |
| D3 | — | **Not adopted:** a profit cap per person per round, a per-guild cap on live panels. Upstream's per-person stake cap (10,000) stays the only money guard on the payout side. |
| D4 | The bot creates `📺 {name}の配信` voice channels (needs Manage Channels) and deletes them at the end. | **No auto-created voice channels, no Manage Channels.** The location is the voice channel of the streamer's own Activity instance, or nothing (§8). The `created_vc` column is not ported. |

## 1. Player story

1. *A friend is about to play a hard boss. They post a stream panel in the channel (or start it from the Activity).*
2. *I watch, send a super chat with a message, and bet 500 Pelica that they lose the next fight.*
3. *The streamer opens the round, I bet, the bets close (by hand or after 10 minutes), the fight happens, the streamer declares the result, and the winners share the losers' pot.*

Everything money-related is decided by the server. The streamer is always the session user (Activity) or the interaction user (chat); no request names the streamer.

## 2. Numbers

| Name | Value | Wire constant (`STREAM_LIMITS`) |
| --- | --- | --- |
| Title length | 1 to 100 | `titleMax` |
| Stream URL | optional, must start with `http://` or `https://`, at most 300 characters | `urlMax` |
| Panel auto-close | 24 h after start | `maxHours` |
| Smallest tip | 100 | `tipMin` |
| Tip message | 0 to 150 characters | `tipMessageMax` |
| Smallest bet | 100 | `betMin` |
| Most one person stakes on one round (both bets added) | 10,000 | `betMax` |
| Teiai rake | 5 % of the losing side's total, floor | `rakeBps = 500` |
| Round name | 0 to 60 characters, empty means `Next round` / `次の勝負` | `roundLabelMax` |
| Bets close by themselves | 10 minutes after the round opens | `roundAutoLockMs` |
| Owner void reason | 1 to 200 characters | `voidReasonMax` |
| Payout lines in a result | top 10, largest first | `resultTopMax` |
| Tips kept for the feed | 20 | `recentTipsMax` |

Tip fee, daily cap, minimum games and confirmation threshold are **the transfer numbers** ([transfer.md](transfer.md): fee 10 % rounded up and paid on top, 20,000 per day, 3 games played, confirm from 5,000). They are not repeated here and not copied into code.

## 3. Panel and tips

- **Open.** `/stream start title [url]` in chat, or the Activity's start form. One live panel per streamer per guild (`stream_already_live`). The panel auto-closes at `startedAt + 24 h`. No cap on live panels per guild.
- **Panel content.** Streamer, location (§8) if known, URL if given, tip total and count, the active round (name, status, win/lose totals with indicative odds, bettor count, and when bets close), when the panel auto-closes. Footer: the rules. Red (`0xE62117`) while live; buttons removed when it ends.
- **Chat buttons** (persistent, restart-proof custom ids via the bot's `cid()` router): `💸 Super chat`, `🏆 Bet on a win`, `💀 Bet on a loss`, `🎛️ Streamer menu`.
- **Tip.** The streamer cannot tip themselves (`stream_self_tip`). Amount at least 100 (`stream_tip_min`); message up to 150 characters. The money moves exactly like `/pelica transfer`: the sender pays `amount + fee` (fee = 10 % rounded up), the streamer receives `amount` (Teiai debt withholding applies as for any transfer), `transfer_out` / `transfer_in` / `transfer_fee` rows with `ref_type = 'stream'`, `ref_id = streamId`. The tip counts toward the 20,000 per day cap, needs 3 games played, is refused with debt (`stream_debt`), asks for confirmation from 5,000.
- **Tip card.** After the commit the bot posts a coloured embed in the panel's channel with **no mentions allowed**: author `{name}　💸 {amount}ペリカ`, description = the message. Colour by amount (`streamTipColor`): ≥ 20,000 red `#E62117`; ≥ 10,000 magenta `#E91E63`; ≥ 5,000 orange `#F57C00`; ≥ 2,000 yellow `#FFCA28`; ≥ 1,000 green `#1DE9B6`; ≥ 500 cyan `#00E5FF`; below that blue `#1E88E5`. Panel totals update.
- The message is stored nowhere but the `StreamTipped` event and a small in-memory ring (`recentTips`, 20); it can be empty after a restart.

## 4. State machine

**Stream:** `live` → `ended`. Ended by the streamer (`⏹️ End the stream`, confirmed) or by the 1-minute job at `endsAt` (`cause: timeout`). An unsettled round is **voided** first, in the same transaction (everyone refunded). The panel becomes `⏹️ 配信終了: …` and loses its buttons.

**Round** (one active round per stream, enforced by a unique index):

```
 (none) --open--> OPEN --lock (streamer) / 10 min timer--> LOCKED --win | lose (streamer)--> SETTLED
                    |                                         |
                    +--------- void (streamer, owner, stream end, 24 h close) ---------+--> VOID
```

| Action | Who | Needs | Refused with |
| --- | --- | --- | --- |
| open | streamer | stream live, no active round, name ≤ 60 | `stream_ended`, `stream_not_streamer`, `stream_round_active`, `stream_bad_label` |
| bet | anyone but the streamer | round `open` and now < `autoLockAt`, request names the active round | `stream_no_open_round` (none, locked, or past `autoLockAt`), `stream_round_changed`, `stream_self_bet`, `stream_bad_side`, `stream_debt`, `stream_bet_min`, `stream_other_side`, `stream_bet_max`, `insufficient_funds` |
| lock | streamer | round `open` | `stream_no_round`, `stream_round_changed`, `stream_no_open_round` (already locked) |
| settle win / lose | streamer | round **`locked`** | `stream_no_round`, `stream_round_changed`, **`stream_not_locked`** (round still open) |
| void | streamer, or owner via `/admin stream-void` | round `open` or `locked` | `stream_no_round`, `stream_round_changed`, `stream_round_settled` (already paid) |
| end | streamer | stream live | `stream_ended`, `stream_not_streamer` |

- **Auto-lock is lazy and exact.** A 1-minute job (`stream.lockDue`) persists `locked` and publishes `StreamRoundLocked { cause: 'auto' }`, but the server also treats an `open` round with `now >= autoLockAt` as locked in `bet`, `view` and `settle`, so the 10 minutes hold to the second even between job runs.
- Lock, settle and void carry the `roundId`, so a double click or a stale menu cannot act on the next round. Every write has an `idempotencyKey`; settle and end are guarded by the row status inside one `store.transaction`, so a double click and the tick settle once.
- The feature switch `stream` off refuses `start`, `tip` and `bet` (new panels and new money in); **`open`, `lock`, `settle`, `void` and `end` keep working** (the streamer menu is never switched off) so escrow can always be released.

## 5. Bets

- A bet is **escrowed at once**: `stream_bet` (sink, negative) with `ref_type = 'stream_round'`, `ref_id = roundId`. One row per bet; a second bet on the same side adds to the person's stake. The side cannot be switched (`stream_other_side`). The streamer cannot bet (`stream_self_bet`). Debt blocks betting (`stream_debt`). Per person per round at most 10,000 in total (`stream_bet_max` shows how much is already placed).
- Rejected without ledger rows: every refusal happens before any row is written.
- Checks run in this order: stream live → feature on → round open and named → streamer? → side valid → debt → amount ≥ 100 → other side → cap → balance. (Per-user session lock around the whole call, as every money action.)

## 6. Settlement (parimutuel)

Inputs: the bets of the round, the winner (`win` or `lose`). All integers.

```
winnerTotal = sum of stakes on the winning side
loserTotal  = sum of stakes on the other side
rake        = floor(loserTotal * 500 / 10000)
pot         = loserTotal - rake
payout(i)   = stake(i) + floor(pot * stake(i) / winnerTotal)       for each winner i
dust        = pot - sum(floor(pot * stake(i) / winnerTotal))
```

- Rake and dust are never paid back: they go to the Teiai bank's income (like the other house takes). **No Pelica is created**: Σ payouts = winnerTotal + pot − dust ≤ winnerTotal + loserTotal = Σ bets.
- **Refund instead of payout** (`stream_refund`, faucet, exactly the stake back): the round is **void** (any cause), or **one-sided** (a side with 0 total), or nobody bet. `refunded: true` in the result.
- Payout rows are `stream_payout` (faucet). The part above the stake is income, so Teiai **debt withholding** applies to it as for a game payout (`debt_withholding`); the stake part is never withheld.
- A winner always gets their stake back plus a non-negative share, never less.
- Settle runs in **one `store.transaction`** with the round status change and the audit row (§9): either every payout/refund row and the status change land, or none.

**Worked example** (from the upstream spec): win side A 1,000 and B 3,000, lose side C 2,000, streamer **wins** → winnerTotal 4,000, loserTotal 2,000, rake 100, pot 1,900. A = 1,000 + floor(1,900 × 1,000 / 4,000) = **1,475**; B = 3,000 + floor(1,900 × 3,000 / 4,000) = **4,425**; dust 0. Σ out 5,900 ≤ Σ in 6,000; Teiai keeps 100. C gets nothing.

**Indicative odds** (`streamOddsBps`): for a side with total `mine` against `other`: `10,000 + floor((other − floor(other × 500 / 10,000)) × 10,000 / mine)` basis points of the stake, i.e. x1.475 = 14,750. `null` while either side is 0. A hint only.

**Result post** (chat): title `🏁 {title} の勝負の結果`; head (`結果: **🏆 配信者の勝ち**`, the refunded sentence, or the void sentence); the top 10 payouts as `<@id> **amount**`; `ほか N人` if more; `帝愛の控除: {rake}`; `当てた人はいませんでした。` if the winning side had nobody. A void by the owner adds the reason line. Posted with no mentions allowed.

## 7. Jobs

| Job | Every | Does |
| --- | --- | --- |
| `stream.lockDue` | 1 min | Locks open rounds past `autoLockAt` (`StreamRoundLocked` `cause: auto`), posts the auto-lock notice once. |
| `stream.closeDue` | 1 min | For each live stream with `endsAt <= now`: void the active round (`cause: timeout`), end the stream (`StreamEnded` `cause: timeout`), update the panel. |

Both run per guild that is not denied, one guild failing never stops the others. The database is the only state, so a restart loses nothing; a missed tick is caught up on the next one. Panel message edits are debounced (at most one edit per panel every 2 to 3 seconds, latest state wins).

## 8. Location (decision D4)

- `StreamView.location` is `{ channelId, source: 'activity' }` or `null`. The server sets it **only** when the stream is started from the Activity: it asks Discord for the activity instance (`GET /applications/{app}/activity-instances/{instanceId}`, already used by token verification) and takes `location.channel_id` when that channel is a voice channel. Never from client input.
- A stream started from chat has no location. The bot has the `Guilds` intent only and no voice-state cache, and that stays so.
- **The bot never creates, renames or deletes a channel and needs no Manage Channels.** The `created_vc` column and the `📺 {name}の配信` channel are not ported. The chat panel shows `📍 場所: <#channel>` only when `location` is set.

## 9. Owner tool and audit log (decision D3-2)

**`/admin stream-void`** (owner-only, like every `/admin` command; a normal guild-targeted admin command):

| Option | Meaning |
| --- | --- |
| `target` (string, required) | `stream:<id>` = that stream's active round; `round:<id>` = that round; a bare number means a round id. |
| `reason` (string, required) | 1 to 200 characters. Shown in the channel post and kept in the audit row. |
| `guild_id` | The guild, like the other admin commands (autocomplete). |

- Voids an `open` or `locked` round: every bettor is refunded their exact stake (`stream_refund`), result `outcome: void`, `cause: owner`, the panel is refreshed and the result post says `Voided by the server owner. Reason: …`. The stream itself stays live.
- Refusals: unknown id or a stream with no active round → `stream_void_target`; empty or too long reason → `stream_void_reason`; a round that already paid out → `stream_round_settled` (money cannot be clawed back).
- Works while the feature switch is off.

**Audit log.** Every round that ends (win, lose, void by streamer, owner, stream end or timeout) writes one `StreamAuditEntry` in the same transaction: round and stream ids, guild, streamer, label, opened / locked / ended times, outcome, cause, **who settled or voided** (`actorId`, null for timers), the owner's reason, bettor count, win and lose totals, rake, `refunded`, and the **top winners** (up to 10, with amounts). Owner-only; never sent to the Activity. Kept for the life of the database.

## 10. Abuse guards

| Risk | Guard | Status |
| --- | --- | --- |
| Throwing: the streamer loses on purpose while a friend bets on "lose" | Streamer cannot bet; 10,000 per person per round; **owner void with a reason**; **audit log** (streamer, totals, top winners, who settled); the owner can switch the feature off per guild | adopted (D3-2) |
| Throwing: unlimited profit | Profit cap per person per round | **not adopted** (D3) |
| Posting the result early: viewers see the outcome live and bet late | **Bets auto-close 10 minutes after the round opens**; **win or lose only after the round is locked** | adopted (D3-1) |
| Streamer holds a locked round for hours | Auto-close of the whole panel at 24 h voids it | kept; no extra timer |
| Tip message abuse | 150 characters, no mentions allowed, `tipperId` kept in the event for the owner's logs; the feature can be switched off. Links are not stripped. | kept as upstream |
| Panel spam | One live panel per streamer; no cap per guild | **not adopted** (D3) |
| Tips as a transfer loophole | Same service, rules and daily cap as transfers | kept |
| Bettor in debt | Bets refused with debt; payout profit goes through debt withholding | kept |
| Race between tick, double click and settle | Status guarded inside one transaction; ids in requests; idempotency keys | kept |

## 11. Money and invariants

| Flow | Reason | Class |
| --- | --- | --- |
| Tip: sender | `transfer_out` (−amount), `transfer_fee` (−fee) | transfer, sink |
| Tip: streamer | `transfer_in` (+amount) | transfer |
| Bet | `stream_bet` | sink (escrow) |
| Payout | `stream_payout` | faucet |
| Refund (void, one-sided, ended stream) | `stream_refund` | faucet |

Invariant commands for `tests/invariants` (S1): `streamStart`, `streamOpen`, `streamBet`, `streamLock`, `streamSettle`, `streamVoid`, `streamEnd`, `streamCloseDue`, `streamTip`. Checks: per round, refunded ⇒ every bettor got exactly their stake; otherwise every winner gets ≥ stake and Σ out ≤ Σ in; rake + dust = Σ in − Σ out ≥ 0; no negative balance; a round is paid at most once; a locked-only rule: `settle` on an open round changes nothing.

## 12. Contracts (`packages/shared`)

| Piece | Where | Value |
| --- | --- | --- |
| Ledger reasons | `ledger.ts` | `stream_bet` (sink, −1), `stream_payout` (faucet, +1), `stream_refund` (faucet, +1), appended after `quiz_author_pay` |
| History labels | `screen.casino.history.reason.stream_*` | Stream bet / 配信の賭け, Stream payout / 配信の払い戻し, Stream refund / 配信の返金 |
| Screen | `ids.ts` `SCREEN_IDS` | `stream`; label `screen.stream` |
| Ids | `ids.ts` | `StreamId`, `StreamRoundId` (positive integers) |
| Room | `rooms.ts` | `rooms.stream(guildId, streamId)` = `stream:{guild}:{id}`; parsed as `{ kind: 'stream' }`; joinable by any session of that guild, joined with `stream:join` (ack = the caller's `StreamView`), left with `stream:leave` |
| Events | `events.ts` | `StreamStarted`, `StreamTipped`, `StreamBetPlaced`, `StreamRoundOpened`, `StreamRoundLocked`, `StreamRoundSettled`, `StreamEnded` (the last five are the required ones; `StreamStarted` and `StreamBetPlaced` let a live list and the totals update without polling). None carries `userId`, so the socket layer's default ("goes to that user only") never leaks them: S1 fans them out to the stream room. |
| Rule codes | `stream.ts` `STREAM_RULES` | 22 codes, §13; message key `screen.stream.rule.<rule>`; sent as `StreamError.rule` next to a generic `error` code |
| Routes | `activity/stream.ts` `STREAM_ROUTES` | below |
| Feature key | `apps/server/src/bot/admin-tools.ts`, `commands.ts` | `stream` (`bot.admin.feature.stream`: `Streams (tips & win/lose bets)` / `配信（スパチャ・勝敗の賭け）`) |

**HTTP routes** (all under `/api`, session token, guild and user from the token, writes carry `idempotencyKey` and are replayable):

| Route | Method | Request | Response |
| --- | --- | --- | --- |
| `/api/stream` | GET | | `StreamList` (live streams of the guild, the caller's own) |
| `/api/stream/view` | GET | `StreamViewQuery { streamId }` | `StreamView` |
| `/api/stream/start` | POST | `StreamStartRequest { title, url? }` | `StreamStartResponse` |
| `/api/stream/tip` | POST | `StreamTipRequest { streamId, amount, message? }` | `StreamTipResponse` (+ amount, fee, received, withheld) |
| `/api/stream/bet` | POST | `StreamBetRequest { streamId, roundId, side, amount }` | `StreamBetResponse` (+ side, total) |
| `/api/stream/round/open` | POST | `StreamOpenRequest { streamId, label? }` | `StreamWriteResponse` |
| `/api/stream/round/lock` | POST | `StreamRoundRequest { streamId, roundId }` | `StreamWriteResponse` |
| `/api/stream/round/settle` | POST | `StreamSettleRequest { streamId, roundId, winner }` | `StreamSettleResponse` (+ result) |
| `/api/stream/round/void` | POST | `StreamRoundRequest` | `StreamSettleResponse` |
| `/api/stream/end` | POST | `StreamEndRequest { streamId }` | `StreamEndResponse` (+ voided) |

Every write response is `{ replayed, balance, stream: StreamView, … }`. Request schemas reject unknown properties: no `streamerId`, `userId` or payout can be smuggled in. Refusals use `StreamError`: a generic `ErrorCode` (`forbidden`, `conflict`, `not_found`, `feature_disabled`, `insufficient_funds`, `rate_limited`, …) plus `rule` and `params`. Rate limits: the existing per-user HTTP limiter on tip and bet.

**View.** `StreamView` carries the stream, the active round (totals, indicative odds in basis points, `autoLockAt`), the last 20 tips, `location`, and `me` (is streamer, balance, own stake on the round, room left under the cap). Tip fee, the remaining daily cap and the confirmation threshold come from the existing `GET /api/life/transfer` view; the screen does not duplicate them.

## 13. Strings

Rule messages (`screen.stream.rule.<code>`). The Japanese for the first 16 is the upstream's, verbatim; the last 6 are new for D3 and the admin tool.

| Code | EN | JA |
| --- | --- | --- |
| `stream_bad_title` | Write a title of 1 to {max} characters. | 配信のタイトルは 1〜{max}文字 で書いてください。 |
| `stream_bad_url` | The URL must start with https:// or http:// (a full web address). | URL は https:// か http:// で始めてください。 |
| `stream_already_live` | You already have a live panel. Close it first with "End stream". | 配信中のパネルがあります。先に「⏹️ 配信を終える」で閉じてください。 |
| `stream_ended` | This stream has ended. | この配信は終わりました。 |
| `stream_not_streamer` | Only the streamer can do this (or the stream has ended). | これは配信者だけが使えます（または、配信が終わっています）。 |
| `stream_self_tip` | You can't send a super chat to your own stream. | 自分の配信には、スパチャを送れません。 |
| `stream_tip_min` | Super chats start at {min} Pelica. | スパチャは {min}ペリカ から送れます。 |
| `stream_bad_label` | Round names are up to {max} characters. | 勝負の名前は {max}文字 までにしてください。 |
| `stream_round_active` | A round is still undecided. Settle or void it before starting a new one. | 決まっていない勝負があります。勝敗を決めるか、無効にしてから始めてください。 |
| `stream_no_open_round` | Bets are not open right now. | いまは賭けを受け付けていません。 |
| `stream_no_round` | There is no undecided round. | 決まっていない勝負がありません。 |
| `stream_bad_side` | That is not a valid side to bet on. | 賭ける側が正しくありません。 |
| `stream_self_bet` | The streamer can't bet on their own round. | 配信者は、自分の勝負に賭けられません。 |
| `stream_other_side` | You already bet on the other side of this round (you can't switch sides). | この勝負には、もう反対の側に賭けています（側は変えられません）。 |
| `stream_bet_min` | Bets start at {min} Pelica. | 賭けは {min}ペリカ からです。 |
| `stream_bet_max` | You can bet up to {max} Pelica per round (you have already bet {already} Pelica). | 1回の勝負に賭けられるのは、1人 {max}ペリカ までです（いま {already}ペリカ 賭けています）。 |
| `stream_not_locked` | Close the bets first. A win or loss can be declared only after the bets are locked (you can void a round at any time). | 先に「🔒 賭けを締め切る」を押してください。勝敗を決められるのは、賭けを締め切ったあとです（無効にするのは、いつでもできます）。 |
| `stream_round_changed` | That round is no longer the current one. | その勝負は、もう終わっています（いまの勝負ではありません）。 |
| `stream_round_settled` | That round has already paid out, so it cannot be voided. | この勝負は、もう精算が終わっているので、無効にできません。 |
| `stream_debt` | You cannot send super chats or bet while you have Teiai debt. | 借金があるあいだは、スパチャも賭けもできません。 |
| `stream_void_reason` | Write a reason of 1 to {max} characters. | 理由を 1〜{max}文字 で書いてください。 |
| `stream_void_target` | No stream or round matches that id. | その番号の配信も勝負も見つかりません。 |

Shared labels (Activity and chat): `screen.stream.side.win|lose` (`🏆 配信者の勝ち` / `💀 配信者の負け`), `screen.stream.round.open|locked` (`賭けを受付中` / `締切（勝敗を待っています）`), `screen.stream.round.default` (`次の勝負`), `screen.stream.odds` (`（当たれば約 {odds}倍）`).

Chat texts live under `bot.stream.*` in `packages/shared/i18n` (EN and JA, parity-checked): `panel.*` (title live and ended, streamer, location, tips, round, win, lose, bettors, no round, closes, auto-lock, footer), `btn.*` (the four button labels), `tip.*` (modal, amount, message, card author, confirm title, body and button, sent title and body, error title), `bet.*` (modal, amount, done title and body, error title), `round.*` (modal, label, opened title and body, auto-locked notice), `menu.*` (title, the six buttons, owner-only notices, locked), `settle.*`, `end.*`, `result.*`, and `help.*`. The Japanese is the upstream's, verbatim, for everything the upstream had; additions for D3 and D4 (auto-lock lines, the owner-void line, the location help line) are new. Admin: `bot.admin.feature.stream`, `bot.admin.streamVoid.title|body|errTitle`.

Panel layout (JA, upstream): `🔴 配信中: {title}` / `⏹️ 配信終了: {title}`; `配信者: <@id>`; `📍 場所: <#id>`; `📺 {url}`; `💸 スパチャ **{amount}**（{count}件）`; blank line; `🎲 **{label}** ・ 賭けを受付中`; `🏆 勝ち **{amount}** （当たれば約 {x.xx}倍）`; `💀 負け **{amount}** …`; `賭けた人 {n}人`; or `🎲 いまは勝負がありません（配信者が「🎛️ 配信者メニュー」から始めます）`; `このパネルは <t:{ends}:R> に自動で閉じます`. Buttons: `💸 スパチャ` (danger), `🏆 勝ちに賭ける` (success), `💀 負けに賭ける` (secondary), `🎛️ 配信者メニュー` (primary). Streamer menu (private, 600 s, streamer only): `🎲 勝負を始める`, `🔒 賭けを締め切る`, `🏆 勝った`, `💀 負けた`, `↩️ 無効にする（全額返す）`, `⏹️ 配信を終える`; win, lose and void ask `勝敗を決めますか？` with `取り消せません。`; end asks `配信を終えますか？`.

## 14. Data model (for S1)

Next free migration number at S1's rebase. STRICT tables, millisecond timestamps, TEXT snowflakes.

- `streams(id, guild_id, streamer_id, title, url, channel_id, message_id, voice_channel_id, started_at, ends_at, ended_at, tips, tip_count, status CHECK live/ended)`; partial unique index `(guild_id, streamer_id) WHERE status = 'live'`. No `created_vc`.
- `stream_rounds(id, stream_id, guild_id, label, status CHECK open/locked/win/lose/void, created_at, auto_lock_at, locked_at, settled_at)`; unique index on `stream_id WHERE status IN ('open','locked')`.
- `stream_bets(round_id, guild_id, user_id, side CHECK win/lose, amount CHECK > 0, PRIMARY KEY (round_id, user_id))`.
- `stream_round_audit(round_id PK, stream_id, guild_id, streamer_id, label, opened_at, locked_at, ended_at, outcome, cause, actor_id, reason, bettors, win_total, lose_total, rake, refunded, top JSON)` written with the status change.

## 15. Not ported

The upstream's auto-created voice channel and its Manage Channels permission (D4); declaring win or lose while bets are open (D3-1); a profit cap and a per-guild panel cap (not adopted, D3). Kept from the upstream: `start` creates the streamer's account if it is missing, and the feature switch never blocks settling or ending.
