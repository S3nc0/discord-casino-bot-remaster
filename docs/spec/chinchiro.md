**English** | [日本語](chinchiro.ja.md)

# Chinchiro (`chinchiro`)

Dice hand-comparison game: solo against a dealer (`/カジノ チンチロ`), or a multiplayer table where the players roll against each other and the strongest hand takes the pot (`/カジノ チンチロ卓`).
Shared contract alignment: `GameId = 'chinchiro'`, `ScreenId = 'chinchiro'`, `LEDGER_REASONS` (`game_stake`, `game_payout`, `game_refund`, `jackpot_payout`, `debt_withholding`). See [casino-common.md](./casino-common.md) for escrow, RTP, events, insurance, skins, and jackpot.

## Source Files

- `catalogs/games.yaml:74-96,151-157`
- `catalogs/skins.yaml:8-53,81-96`
- `docs/casino.md:5-22,138-144`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/games/chinchiro.py:1-139`
  - `domain/games/rtplevel.py:27,86`
  - `cogs/casino/cog.py:51-63`
  - `cogs/casino/chinchiro.py:1-229`
  - `cogs/casino/chinchiro_table.py:1-209`
  - `cogs/casino/texts.py:42-76`

## Rules & Exact Numbers

### Dice & Hand Classification (`classify`)
Roll 3 standard 6-sided dice (`randint(1, 6)` × 3), sorted as `(a, b, c)`:

| Kind ID | Japanese Name | Condition | `strength` | Base `mult` |
|---|---|---|---|---|
| `pinzoro` | `ピンゾロ` | `a == b == c == 1` | `100` | `5` |
| `arashi` | `嵐（{v}のゾロ目）` | `a == b == c`, `v ∈ {2..6}` | `40 + v` | `3` |
| `shigoro` | `シゴロ` | `(4, 5, 6)` | `30` | `2` |
| `me` | `{v}の目` | `a == b` (`v = c`) or `b == c` (`v = a`) | `10 + v` | `1` |
| `menashi` | `目なし` | None of the above | `1` | `1` |
| `hifumi` | `ヒフミ` | `(1, 2, 3)` | `0` | `1` |

- `MAX_ROLLS = 3`: A participant rolls up to 3 times, stopping immediately on any roll where `hand.kind != "menashi"`.
- `HIFUMI_FACTOR = 2`: If the losing side holds `hifumi`, the winning side's multiplier is doubled.
- `MAX_MULT = 5 * 2 = 10` (`pinzoro` vs `hifumi`).

### Comparison & Payout (`compare`, `payout`)
- `player.strength == dealer.strength`:
  - If `player.kind == "menashi"`: **House edge rule** → `Outcome("lose", 1)` (double `menashi` is dealer's win).
  - Otherwise: `Outcome("draw", 0)` (push; stake refunded).
- `player.strength > dealer.strength`:
  - `mult = ROLE_MULT[player.kind] * (2 if dealer.kind == "hifumi" else 1)`
  - `Outcome("win", mult)` → `(payout = bet + bet * mult, penalty = 0)`.
- `player.strength < dealer.strength`:
  - `mult = ROLE_MULT[dealer.kind] * (2 if player.kind == "hifumi" else 1)`
  - `Outcome("lose", mult)` → `(payout = 0, penalty = bet * (mult - 1))`.

### Odds & RTP
- Base RTP profile (`rtplevel.py:27`): `CHINCHIRO_RTP = 0.985`, `CHINCHIRO_W = 0.653`.
- Level 1–6 approx RTP: `90.5%` / `94.5%` / `98.5%` / `102.5%` / `106.5%` / `110.5%`.
- `expected_value()` in `chinchiro.py:129-138` measures net EV per 1 Pelica wagered (slightly negative, ~`-0.015`, solely from `menashi` vs `menashi` going to dealer).

### Debt & Forced Seizure on Multiplier Loss
- When `penalty = bet * (mult - 1) > 0`:
  - Deducted from player cash in the same transaction as settlement.
  - Any shortfall triggers `debt.owe_for(gid, user_id, penalty - taken, "チンチロの倍払い")`, seizing assets (margin → stocks → normal bonds) before creating Teiai debt.
  - Insurance consumable (`保険券`) refunds `min(bet // 2, 1000)` only against the base `bet`, never against `penalty`.

### Limits & Timers
- `MIN_BET = 10`, no max bet (`balance_factor = 1` — you do NOT need `10×` balance up front).
- Solo Chinchiro:
  - Animation step delay: `CHINCHIRO_STEP_SECONDS = 0.9s`.
  - Player roll view timeout: `60s` (`ChinchiroView`, `chinchiro.py:121`). Timeout settles as `menashi` if no rolls yet, or last rolled hand.
  - Replay view timeout: `90s`.
- Multiplayer Table (`/カジノ チンチロ卓`; winner takes all since upstream cc6dc77; remaster `packages/domain/src/casino/chinchiro/table.ts`):
  - Seats: `TABLE_MIN_SEATS = 2` to `TABLE_MAX_SEATS = 6`. The host sits first. Every seat stakes the same `bet` (its own escrowed round; the seat's casino session is locked).
  - Lobby: `TABLE_JOIN_MS = 60 000` (starts by itself after 60 s; the host can press `▶️ 始める` early). Standing up before the start (`🚪 立つ`) refunds the full `bet`.
  - Start with fewer than 2 seats: the table folds and every stake is refunded.
  - Rolling: each seated player presses `🎲 振る` once. One press plays the whole hand: up to 3 rolls until a hand forms, the same `play_hand` as solo. `TABLE_ROLL_MS = 45 000`: when it ends, every seat that has not rolled is rolled automatically. When the last seat rolls, the table settles at once.
  - Settlement, `potPayouts(hands, bet)` (upstream `pot_payouts`):
    - `best = max(strength)`, `winners = seats with strength == best`, `losers = seats - winners`.
    - `share = floor(floor(bet × losers × 9 / 10) / winners)` (`TABLE_RAKE_BPS = 1000`, 10 % of the losers' stakes). A winner gets `bet + share`; a loser gets 0. All equal: everyone gets `bet` back.
    - The table keeps `rake = bet × seats − Σ payouts` (the fee plus the division leftover). It is a sink: the losers' `game_stake` that is never paid back.
    - No double payment at the table: `hifumi` is simply the weakest hand, and no `penalty` is taken. No RTP correction (`rtpDone: true`).
    - Worked examples: bet 1000, 3 seats, 1 winner → 2800 / 0 / 0, rake 200. Bet 1000, 4 seats, 2 tied → 1900 each, rake 200. Bet 333, 3 seats, 2 tied → `floor(299.7) // 2 = 149`, 482 each, rake 35. Bet 500, 3 seats, all tied → 500 each, rake 0.
    - Event bonus, insurance and the jackpot still apply per seat on settle (the shared pipeline), so a bonus event can still add Pelica at the table.
  - The whole table settles in one transaction: all payouts or none. If any seat fails, nothing is paid and every stake is refunded instead (also one transaction). Upstream settled winners first and refunded the rest on error, which could pay winners from stakes that were then refunded.
  - The result stays for `CHINCHIRO_TABLE_RESULT_MS = 10 000`, then the table is free for a new lobby.
  - Chat: the lobby message has `🪑 座る` / `🚪 立つ` / `▶️ 始める`; while rolling it has `🎲 振る` (custom id `b:cht:roll:<tableRound>`). Activity: the `game:action` `table_roll` on the table round.

## State Machine

### Solo Chinchiro
```text
INIT -> [start_game: lock + escrow] -> DEALER_ROLLING (0.9s steps)
DEALER_ROLLING -> [dealer completes 1..3 rolls] -> PLAYER_TURN (60s timeout)
DEALER_ROLLING -> [message deleted (NotFound)] -> SETTLED (player treated as menashi)
PLAYER_TURN -> [click 🎲 サイコロを振る] -> PLAYER_ROLLING (0.9s)
PLAYER_ROLLING -> [menashi and rolls < 3] -> PLAYER_TURN
PLAYER_ROLLING -> [non-menashi or rolls == 3] -> SETTLED
PLAYER_TURN -> [timeout 60s or NotFound] -> SETTLED (player = last roll or menashi)
```

### Multiplayer Table
```text
IDLE -> [sit: open lobby, host seated, lock + escrow] -> LOBBY (60s countdown)
LOBBY -> [sit: <=6 seats, same bet, lock + escrow] -> LOBBY
LOBBY -> [stand: refund + unlock] -> LOBBY
LOBBY -> [host clicks begin OR 60s elapsed, seats < 2] -> IDLE (folded, every stake refunded)
LOBBY -> [host clicks begin OR 60s elapsed, seats >= 2] -> ROLLING (45s countdown)
ROLLING -> [seat clicks roll: whole hand, once per seat] -> ROLLING
ROLLING -> [last seat rolls OR 45s elapsed: the rest auto-roll] -> RESULT (one transaction)
RESULT -> [10s] -> IDLE
```

## Edge Cases

- **Anti-cancel on delete**: Once dealer rolls are shown, deleting the message (`discord.NotFound`) settles immediately with player = `menashi` instead of refunding, preventing players from dodging dealer `pinzoro`/`arashi` (`chinchiro.py:110-113,198-201`).
- **Button double-click race**: `_busy` flag rejects concurrent roll clicks; `ctx.done` prevents double settlement if timeout overlaps with rolling.
- **Dealer `hifumi` win text**: Overrides normal win line with `親がヒフミ…！ 倍もらう…！` even if a skin is equipped (`chinchiro.py:167-168`).
- **Table settle failure**: settling runs in one transaction; on any error it rolls back and every seat is refunded in one more transaction (`卓の精算に失敗しました` / `精算前の賭け金は、全額返しました。`). A process crash leaves the rounds open, and start-up recovery refunds them.
- **Table roll refusals** (in this order): not seated → `この卓に座っていません。`, settled → `もう決着しています。`, still in the lobby → `まだ始まっていません。`, rolled → `もう振りました。`. A replayed idempotency key answers the first roll again and never rolls twice.
- **Table result order**: strongest hand first, ties in seat order. Winners get 👑, the others a full-width space. The final embed is gold.

## User-Facing Japanese Strings

| Key | Verbatim Text | Source |
|---|---|---|
| `chinchiro.cmd.desc` | `🎲 チンチロ。親と勝負、目が出なければ3回まで振れる` | `cogs/casino/cog.py:51` |
| `chinchiro.table.cmd.desc` | `🎲 チンチロの卓を立てる。みんなで振って、いちばん強い役が総取り（60秒で締切）` | upstream cc6dc77 `cogs/casino/cog.py` |
| `chinchiro.table.bet.desc` | `1人あたりの賭け金（座る人は全員この額）` | `cogs/casino/cog.py:60` |
| `chinchiro.title` | `🎲 地下チンチロ` | `cogs/casino/texts.py:42` |
| `chinchiro.table.title` | `🎲 地下チンチロの卓` | `cogs/casino/chinchiro_table.py:25` |
| `chinchiro.role.pinzoro` | `ピンゾロ` | `catalogs/games.yaml:78` |
| `chinchiro.role.arashi` | `嵐（{v}のゾロ目）` / catalog: `嵐（アラシ）` | `domain/games/chinchiro.py:55`, `catalogs/games.yaml:81` |
| `chinchiro.role.shigoro` | `シゴロ` | `catalogs/games.yaml:84` |
| `chinchiro.role.me` | `{v}の目` | `domain/games/chinchiro.py:53` |
| `chinchiro.role.menashi` | `目なし` | `catalogs/games.yaml:90` |
| `chinchiro.role.hifumi` | `ヒフミ` | `catalogs/games.yaml:93` |
| `chinchiro.start` | `賭け金: **{bet:,}ペリカ**\n\nざわ… ざわ…\n親（ディーラー）が丼にサイコロを放る…` | `cogs/casino/chinchiro.py:83` |
| `chinchiro.rolling` | `{dice}　カラカラカラ…` | `cogs/casino/chinchiro.py:65` |
| `chinchiro.reroll` | `　→ 振り直し` | `cogs/casino/chinchiro.py:58` |
| `chinchiro.prompt.first` | `あなたの番。ボタンで振る（目が出なければ振り直せる）` | `cogs/casino/chinchiro.py:139` |
| `chinchiro.prompt.reroll` | `目なし…！ あと **{left}回** 振れる` | `cogs/casino/chinchiro.py:141` |
| `chinchiro.btn.roll` | `🎲 サイコロを振る` | `cogs/casino/chinchiro.py:191` |
| `chinchiro.busy` | `処理中です。少し待ってください。` | `cogs/casino/chinchiro.py:194` |
| `chinchiro.timeout_player` | `**あなた**\n時間切れ…（目なし扱い）` | `cogs/casino/chinchiro.py:182` |
| `chinchiro.win.pinzoro` | `ピンゾロ…ッ！ 5倍…！ 場の空気が凍りつく…` | `cogs/casino/texts.py:61` |
| `chinchiro.win.arashi` | `嵐…ッ！ 3倍…！ ざわ…ざわ…` | `cogs/casino/texts.py:62` |
| `chinchiro.win.shigoro` | `シゴロ…！ 2倍…。流れが来ている…` | `cogs/casino/texts.py:63` |
| `chinchiro.win.me` | `目で押し切った…！ 静かな勝利…` | `cogs/casino/texts.py:64` |
| `chinchiro.win.menashi` | `相手のヒフミに救われた…！` | `cogs/casino/texts.py:65` |
| `chinchiro.win.dealer_hifumi` | `親がヒフミ…！ 倍もらう…！` | `cogs/casino/chinchiro.py:168` |
| `chinchiro.lose.pinzoro` | `親のピンゾロ…！ 5倍払い…。血の気が引いていく…` | `cogs/casino/texts.py:69` |
| `chinchiro.lose.arashi` | `親の嵐…！ 3倍払い…。地下に悲鳴が響く…` | `cogs/casino/texts.py:70` |
| `chinchiro.lose.shigoro` | `親のシゴロ…2倍払い…。` | `cogs/casino/texts.py:71` |
| `chinchiro.lose.me` | `親の目が上だった…。` | `cogs/casino/texts.py:72` |
| `chinchiro.lose.menashi` | `目なし同士は親の勝ち…。それが地下のルール…` | `cogs/casino/texts.py:73` |
| `chinchiro.lose.hifumi` | `ヒフミ…ッ！ 倍払い…！ 地獄だ…` | `cogs/casino/texts.py:74` |
| `chinchiro.lose.debt` | `払い切れない…！ 残りは借金になった…` | `cogs/casino/chinchiro.py:173` |
| `chinchiro.draw` | `引き分け…。ざわ……何も動かない…` | `cogs/casino/chinchiro.py:175` |
| `chinchiro.table.btn.sit` | `🪑 座る` | `cogs/casino/chinchiro_table.py:163` |
| `chinchiro.table.btn.leave` | `🚪 立つ` | `cogs/casino/chinchiro_table.py:171` |
| `chinchiro.table.btn.begin` | `▶️ 始める` | `cogs/casino/chinchiro_table.py:177` |
| `chinchiro.table.err.started` | `もう始まっています。` | `cogs/casino/chinchiro_table.py:66` |
| `chinchiro.table.err.already_sat` | `もう座っています。` | `cogs/casino/chinchiro_table.py:68` |
| `chinchiro.table.err.full` | `満席です（6人）。` | `cogs/casino/chinchiro_table.py:70` |
| `chinchiro.table.err.not_seated` | `座っていないか、もう始まっています。` | `cogs/casino/chinchiro_table.py:174` |
| `chinchiro.table.err.host_only` | `始められるのは、卓を立てた人だけです。` | `cogs/casino/chinchiro_table.py:180` |
| `chinchiro.table.pot` | `賭け金: **{bet}**（全員同じ）　場代: 負けた分の10%` | upstream cc6dc77 `chinchiro_table.py` |
| `chinchiro.table.lobby_rule` | `全員が振って、**いちばん強い役の人が総取り**します（並んだら山分け）。2人から遊べます。` | upstream cc6dc77 |
| `chinchiro.table.btn.roll` | `🎲 振る` | upstream cc6dc77 |
| `chinchiro.table.not_rolled` | `…まだ振っていません` | upstream cc6dc77 |
| `chinchiro.table.roll_prompt` | `座っている人は「🎲 振る」を押してください（45秒で、まだの人は自動で振ります）。` | upstream cc6dc77 |
| `chinchiro.table.err.not_at_table` | `この卓に座っていません。` | upstream cc6dc77 |
| `chinchiro.table.err.finished` | `もう決着しています。` | upstream cc6dc77 |
| `chinchiro.table.err.not_started` | `まだ始まっていません。` | upstream cc6dc77 |
| `chinchiro.table.err.already_rolled` | `もう振りました。` | upstream cc6dc77 |
| `chinchiro.table.folded` | `2人そろわなかったので、卓をたたみました（賭け金は全額返しました）。` | upstream cc6dc77 |
| `chinchiro.table.head.draw` | `全員が同じ強さで、引き分け。賭け金は全額戻りました。` | upstream cc6dc77 |
| `chinchiro.table.head.single` | `👑 **{name}** の総取り！` | upstream cc6dc77 |
| `chinchiro.table.head.split` | `👑 {name1}・{name2} の山分け！` | upstream cc6dc77 |
| `chinchiro.table.result_title` | `🎲 地下チンチロの卓 — 決着` | upstream cc6dc77 |
| `chinchiro.table.rake` | `場代: **{rake}**` | remaster addition |
| `chinchiro.table.failed_title` | `卓の精算に失敗しました` | upstream cc6dc77 |
| `chinchiro.table.failed_body` | `精算前の賭け金は、全額返しました。` | upstream cc6dc77 |

Removed with the pot table (upstream cc6dc77): the verdicts `🟢 勝ち` / `🔴 負け` / `⚪ 引き分け`, `ざわ…ざわ…　子が振る…`, `誰も座らなかったので、卓をたたみました。` and the "same dealer" texts.
