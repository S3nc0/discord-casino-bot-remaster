**English** | [日本語](casino-common.ja.md)

# Casino Common Mechanics (RTP, Jackpot, Events, Escrow, Sessions, Skins)

Shared infrastructure across all 5 casino games (`chinchiro`, `pachinko`, `slots`, `blackjack`, `roulette`).
Shared contract alignment: `GameId` (`packages/shared/src/ids.ts:48-58`), `LEDGER_REASONS` (`game_stake`, `game_payout`, `game_refund`, `jackpot_payout`, `debt_withholding` in `packages/shared/src/ledger.ts:19-22,78`).

## Source Files

- `catalogs/games.yaml:1-12,151-161`
- `catalogs/events.yaml:1-13`
- `catalogs/skins.yaml:1-126`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/games/rtplevel.py:1-181`
  - `domain/games/jackpot.py:1-35`
  - `domain/events.py:1-66`
  - `domain/skins.py:1-123`
  - `services/casino.py:1-220`
  - `services/session.py:1-35`
  - `services/event.py:1-40`
  - `infra/db/escrow.py:1-206`
  - `infra/db/rtp.py:1-55`
  - `cogs/casino/common.py:1-308`
  - `cogs/casino/texts.py:78-117`
  - `cogs/event/cog.py:1-163`
  - `cogs/event/texts.py:1-15`

## Rules & Exact Numbers

### Betting Limits & Session Guard
- `MIN_BET`: `10` Pelica (`catalogs/games.yaml:3`). No upper bet cap (limited by balance; autocomplete offers 25%/50%/75%/100%).
- Session exclusivity (`services/session.py:9-35`): a user may hold at most 1 active session across casino games, shop purchases, transfers, and confirmations.
- Post-session cooldown: `1.5` seconds (`cooldown = 1.5`) measured via monotonic clock after `end()`.
- Stale `_last_end` entries pruned when `len(_last_end) > 1000`.

### Escrow & Settlement Pipeline
1. **Begin (`begin_game`)** (`services/casino.py:86-116`, `infra/db/escrow.py:31-49`):
   - Check feature flag (`features.CASINO_GAMES[game]`).
   - Acquire session lock (`sessions.try_start(user_id)`).
   - Validate `bet >= 10` and `balance >= bet * balance_factor` (default `balance_factor = 1`).
   - Debit `bet` from wallet (`ledger`: `賭け:{game}` → `game_stake`), insert `escrow` row, increment `users.total_wagered += bet`.
   - Resolve active skin (`skins.skin_for(profile, game, now)`).
2. **Additional Wager (`add_to_escrow`)** (`infra/db/escrow.py:51-76`):
   - Used by Blackjack double down. If `short = extra - raw_balance > 0` and `credit = True`, borrows `short` via Teiai credit (`can_borrow_for_bet_for`, max `3,000` Pelica total debt credit).
   - Debits `extra` (`追加の賭け:{game}`), increments `escrow.amount` and `users.total_wagered`.
3. **Settlement (`settle_game` → `settle_with_penalty`)** (`services/casino.py:118-182`, `infra/db/escrow.py:93-151`):
   - **Step A (RTP Adjustment)**: If guild RTP level `!= 3` and `not rtp_done` (Pachinko adjusts per-set beforehand), adjust `payout` against `escrow_amount`.
   - **Step B (Event Bonus)**: Compute `boost = events.best_boost(game, scheduled, manual)`. If `boost > 0`, `event_bonus = min(int((payout - bet) * boost), 10_000)` when `payout > bet` else `0`; `payout += event_bonus`.
   - **Step C (Insurance Consumable)**: If `payout == 0` and `profile.insurance > 0`, decrement `insurance` by 1 and grant `insured = min(amount // 2, 1000)` (`INSURANCE_CAP = 1000`). Insurance never covers Chinchiro extra penalty.
   - **Step D (Credit & Debt Withholding)**: `total = payout + insured`. If `total > 0`, apply credit with `income = max(0, payout - amount)` (only net profit above wager is taxed by 30% debt withholding; refunded stake and insurance refund are not withheld).
   - **Step E (House Loss Share & Jackpot Contribution)**:
     - Delete `escrow` row (prevents double settlement; duplicate returns `None`).
     - `lost = max(0, amount - total)`.
     - Teiai Bank income: `int(lost * 0.03)` (`teiai.LOSS_SHARE = 0.03`).
     - Shared Jackpot contribution: `int(lost * 0.05)` (`jackpot.SHARE = 0.05`), added to per-guild `jackpot.pool`.
   - **Step F (Extra Penalty)**: If `penalty > 0` (Chinchiro multiplier loss), deduct up to available cash; shortfall triggers `debt.owe_for(gid, user_id, penalty - taken, f"{game}の倍払い")` (forced asset seizure → Teiai debt).
   - **Step G (Stats & Records)**:
     - `net = total - amount - max(penalty, 0)`.
     - Update `users`: `games_played += 1`, `total_won += total`, `biggest_win = MAX(biggest_win, net)`.
     - Call `record_play(user_id, game, bet, net, today, tags)` for streaks, daily missions, and weekly stats.
   - **Step H (Jackpot Draw)**: Draw against post-contribution `jackpot.pool`. If hit, pay full `pool` as `income = pool` (subject to 30% debt withholding) and reset `pool = 0`.
4. **Abort / Crash Recovery** (`infra/db/escrow.py:175-205`):
   - `refund(escrow_id)` returns full `escrow.amount` (`返金:{game}` → `game_refund`); does not increment `games_played` or `total_won`.
   - On bot startup, `refund_all_escrows()` refunds all remaining rows (`返金（中断したゲーム）:{game}`).

### RTP Levels (Admin-Configurable)
- Per-guild, per-game level in `{1, 2, 3, 4, 5, 6}`; default `3` (`rtplevel.py:21-24`). Level 3 deletes the DB row.
- `STEP = 0.04` (4 percentage points of RTP per level).
- Formula (`rtplevel.py:146-158`):
  - `factor(game, level, kind) = 1 + (level - 3) * 0.04 / W`
  - `approx_rtp(game, level, kind) = base_rtp + (level - 3) * 0.04`
  - `adjust(game, level, bet, payout, kind)`: if `level == 3` or `payout <= bet`, unchanged; else `bet + max(0, int((payout - bet) * factor))`.
- Base `(RTP, W)` per game:
  - `slots`: exact enumeration over `6^3 = 216` reel combos (`rtplevel.py:32-45`).
  - `roulette`: exact per bet `kind`: `p = hits/37`, `RTP = p * mult`, `W = p * (mult - 1)` (default kind `"red"`).
  - `pachinko`: exact DP convolution: `RTP = pachinko.rtp()`, `W = rtp() - hit_rate()`.
  - `chinchiro`: fixed `RTP = 0.985`, `W = 0.653`.
  - `blackjack`: fixed `RTP = 0.918`, `W = 0.412`.

### Shared Per-Guild Jackpot
- `SHARE = 0.05` (5% of `lost = max(0, bet - (payout + insured))`).
- `PELICA_PER_CERTAIN = 2_000_000`.
- `MAX_CHANCE = 0.02` (2% cap per settlement; reached at `bet >= 40_000`).
- `MIN_POOL = 10_000` (cannot trigger while `pool < 10_000`).
- `chance(bet, pool) = 0.0` if `bet <= 0` or `pool < 10_000`, else `min(0.02, bet / 2_000_000)`.
- `draw(rng, bet, pool) = p > 0 and rng.random() < p`.

### Sudden Events & Manual Special Events
- Daily sudden event (`domain/events.py:14-50`):
  - Deterministic PRNG seed: `random.Random(f"event:{guild_id}:{day.isoformat()}")`.
  - Game: `rng.choice(sorted(["チンチロ", "パチンコ", "スロット", "ブラックジャック", "ルーレット"]))`.
  - Start minute (JST): `rng.randrange(720, 1411, 5)` (12:00–23:30 inclusive, 5-minute steps).
  - Duration: `30` minutes (`end_min = start_min + 30`, never crosses midnight).
  - Active window: `start_min <= now_min < end_min`.
  - Boost: `+0.5` (+50% of profit `payout - bet`), capped at `BONUS_CAP = 10_000` per game.
  - Announcement loop: every 1 minute (`cogs/event/cog.py:59`). Phases: `0` (not announced) → `1` (start announced) → `2` (end announced). If bot missed the window (`phase == 0` and `now_min >= end_min`), sets `phase = 2` silently without posting.
- Manual special event (`services/event.py:24-39`):
  - Owner sets `game`, `boost_pct` (1–300, default 50), `minutes` (1–180, default 30), optional target channel. Replaces any active manual event.
  - Non-stacking rule (`events.best_boost`): takes `max(scheduled_boost, manual_boost)` when matching `game`. Same `10_000` cap.

### Skins & Seasonal Skins
- Equipment slots (`catalogs/skins.yaml:2-5`): `チンチロ → skin_dice`; `パチンコ / ブラックジャック → skin_table`.
- Priority (`domain/skins.py:109-111`): equipped skin for matching game takes precedence; otherwise active season skin (`season.start <= now < season.end`).
- Cosmetic only: never changes odds, payout, or animation frame count.
- Under debt (`underground` / `bankrupt`), owned skins are seized/hidden (`get_profile` returns empty slots).
- Configured season: `christmas_2026` (`2026-11-21T00:00:00+09:00` to `2026-12-26T00:00:00+09:00`), providing skins for all 5 games, `daily_title`, `daily_line`, and `house_horse_icon: "🦌"`.

### Celebration Thresholds & Replay View
- Big win tiers on `ratio = net / bet` (`cogs/casino/texts.py:81-85,108-116`):
  - `>= 50`: Jackpot-class banner + ASCII `JACKPOT_ART` (`missions.is_jackpot`, `jackpot_multiplier = 50`).
  - `>= 10`: Super big win banner; embed color upgraded to `ui.GOLD`.
  - `>= 3`: Big win banner.
- Win streak display: shown from `streak >= 2`; fire emojis `min(streak // 2 + 1, 4)`; personal best badge shown when `new_best and streak >= 3`.
- Replay buttons (`ReplayView`, timeout `90` seconds): same bet (`bet`) and double bet (`bet * 2`).

## State Machine

```text
IDLE -> [begin_game: lock + validate + debit escrow] -> IN_PLAY
IN_PLAY -> [settle_game: RTP -> event -> insurance -> payout/penalty -> stats -> jackpot -> unlock] -> SETTLED
IN_PLAY -> [abort_game / startup refund_all_escrows: full refund -> unlock] -> ABORTED
```

## Edge Cases

- Duplicate `settle()` calls are no-ops (`ctx.done` guard + `DELETE FROM escrow` returning `None`).
- If `payout == 0` and player has insurance, `lost = amount - insured` (bank `loss_share` and jackpot `contribution` use post-insurance loss).
- `result_lines()` displays `payout + ctx.rtp_shift + ctx.insured_refund` as 払い戻し, keeping RTP level hidden from players.
- Interactive games (Blackjack, Chinchiro) use `random.SystemRandom()` in production; pure domain functions accept injected `random.Random`.
- ReplayView timeout removes buttons (`edit_original_response(view=None)`).

## User-Facing Japanese Strings

| Key | Verbatim Text | Source |
|---|---|---|
| `session.active` | `いま遊んでいるゲームがあります。終わってから次を始めてください。` | `services/session.py:19` |
| `session.cooldown` | `少し待ってください（あと {wait:.1f} 秒）。` | `services/session.py:22` |
| `casino.group.desc` | `🎰 ペリカを賭けて遊ぶ（遊びのゲーム用の仮想通貨です）` | `cogs/casino/cog.py:45` |
| `casino.bet.help` | `賭けるペリカ（{MIN_BET:,}以上。上限なし）` | `cogs/casino/cog.py:25` |
| `casino.err.cannot_start` | `まだ始められません` | `cogs/casino/common.py:144` |
| `casino.err.min_bet_title` | `賭け金が少なすぎます` | `cogs/casino/common.py:148` |
| `casino.err.min_bet_body` | `{MIN_BET:,}ペリカ 以上で指定してください。` | `cogs/casino/common.py:148` |
| `casino.err.no_balance_title` | `ペリカが足りません` | `cogs/casino/common.py:156` |
| `casino.err.no_balance_factor` | `{factor_reason}賭け金の **{balance_factor}倍**（{need:,}ペリカ）以上の残高が必要です（いまの残高: {balance:,}ペリカ）。\nいまの残高なら、**{max_bet:,}ペリカ** まで賭けられます。` | `cogs/casino/common.py:152-155` |
| `casino.err.no_balance_daily` | `賭け金 {bet:,}ペリカ に対して、残高は {balance:,}ペリカ です。\n\`/ペリカ デイリー\` で6時間ごとにもらえます。` | `cogs/casino/common.py:158` |
| `casino.err.no_balance_short` | `賭け金 {bet:,}ペリカ に対して、残高は {balance:,}ペリカ です。` | `cogs/casino/common.py:164` |
| `casino.err.not_owner` | `これは他の人のゲームです。\`/カジノ\` で自分も遊べます。` | `cogs/casino/common.py:247` |
| `casino.err.disabled_guild_title` | `使えません` | `cogs/casino/common.py:263` |
| `casino.err.disabled_guild_body` | `このサーバーでは、いまは遊べません。` | `cogs/casino/common.py:264` |
| `casino.err.runtime_title` | `エラーが発生しました` | `cogs/casino/common.py:301` |
| `casino.err.runtime_body` | `ゲームを中止しました。精算前なら賭け金はお返ししています（\`/ペリカ 履歴\` で確認できます）。` | `cogs/casino/common.py:302` |
| `casino.result.insurance` | `🎟️ 保険券を使った！ 賭け金の半分（{refund:,}ペリカ）が戻った` | `cogs/casino/common.py:193` |
| `casino.result.event_bonus` | `🔥 **突発イベントのボーナス +{bonus:,}ペリカ**` | `cogs/casino/common.py:194` |
| `casino.result.bet` | `賭け金: **{bet:,}ペリカ**` | `cogs/casino/common.py:196` |
| `casino.result.payout` | `払い戻し: **{payout:,}ペリカ**` | `cogs/casino/common.py:197` |
| `casino.result.net` | `損益: **{signed_net}ペリカ**` | `cogs/casino/common.py:198` |
| `casino.result.balance` | `残高: **{balance:,}ペリカ**` | `cogs/casino/common.py:199` |
| `casino.result.debt` | `借金: **{debt:,}ペリカ**（収入の{pct}%が天引きで返済されます）` | `cogs/casino/common.py:203` |
| `casino.result.jackpot_pool` | `💰 共有ジャックポット: いま **{pool:,}ペリカ**` | `cogs/casino/common.py:206` |
| `casino.result.jackpot_won` | `# 💰 共有ジャックポット！！ 💰\n**+{won:,}ペリカ** を総取り！` | `cogs/casino/common.py:222` |
| `casino.result.mission_done` | `📜 ミッション達成！ 「{name}」 **+{reward:,}ペリカ**` | `cogs/casino/common.py:232` |
| `casino.result.mission_all` | `🎁 **今日のミッションを全部達成！** ボーナス **+{bonus:,}ペリカ**` | `cogs/casino/common.py:234` |
| `casino.replay.again` | `🔁 同じ額でもう一度（{bet:,}）` | `cogs/casino/common.py:253` |
| `casino.replay.double` | `⏫ 倍にして（{bet2:,}）` | `cogs/casino/common.py:254` |
| `casino.tier.50x` | `🎰💥 **超特大ジャックポット級！！** 💥🎰` | `cogs/casino/texts.py:82` |
| `casino.tier.10x` | `💎✨ **特大勝ち！！** ✨💎` | `cogs/casino/texts.py:83` |
| `casino.tier.3x` | `🎉 **大勝ち！** 🎉` | `cogs/casino/texts.py:84` |
| `casino.streak.line` | `{fire} **{streak}連勝中！**` | `cogs/casino/texts.py:102` |
| `casino.streak.best` | `　🏅 自己ベスト更新！` | `cogs/casino/texts.py:104` |
| `event.title.chinchiro` | `🎲 チンチロ大会` / `親も子も熱くなる時間。` | `cogs/event/texts.py:4` |
| `event.title.pachinko` | `🎰 パチンコ爆裂タイム` / `玉がよく入る気がする…！` | `cogs/event/texts.py:5` |
| `event.title.slots` | `🍒 スロット確変タイム` / `リールが今日はよく回る。` | `cogs/event/texts.py:6` |
| `event.title.blackjack` | `🃏 ブラックジャック・ナイト` / `21を狙うなら今夜。` | `cogs/event/texts.py:7` |
| `event.title.roulette` | `🎡 ルーレット・フィーバー` / `ボールの行方は誰にも読めない。` | `cogs/event/texts.py:8` |
| `event.start.title` | `🔥 突発イベント発生！ {title}` | `cogs/event/cog.py:79` |
| `event.start.body` | `{blurb}\n\n**{start} 〜 {end}**（{dur}分間）の間、\`/カジノ {game}\` で勝つと、**勝ち分が{mult:g}倍**になります。\n（上乗せは1回につき最大 {cap:,}ペリカ まで）` | `cogs/event/cog.py:74-78` |
| `event.manual.title` | `🔥 特別イベント発生！ {title}` | `cogs/event/cog.py:90` |
| `event.end.title` | `{title} は終了しました` | `cogs/event/cog.py:73` |
| `event.end.body` | `また次のイベントをお楽しみに！` | `cogs/event/cog.py:73` |
| `ledger.bet` | `賭け:{game}` | `infra/db/escrow.py:40` |
| `ledger.bet_add` | `追加の賭け:{game}` | `infra/db/escrow.py:68` |
| `ledger.payout` | `払い戻し:{game}` | `infra/db/escrow.py:127` |
| `ledger.insurance` | `保険券で半額返金:{game}` | `infra/db/escrow.py:127` |
| `ledger.penalty` | `追加の支払い:{game}` | `infra/db/escrow.py:141` |
| `ledger.jackpot` | `ジャックポット` | `infra/db/escrow.py:168` |
| `ledger.refund` | `返金:{game}` | `infra/db/escrow.py:184` |
| `ledger.refund_crash` | `返金（中断したゲーム）:{game}` | `infra/db/escrow.py:203` |
