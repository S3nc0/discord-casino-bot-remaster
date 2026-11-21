# Missions & Win Streaks Specification

Planned owner: `B2-B` | Screen ID: `missions` (`packages/shared/src/ids.ts`) | Feature toggle: none (always active alongside casino games)

## Source Files
- `catalogs/missions.yaml:1-97`
- `legacy/python/domain/missions.py:1-97`
- `legacy/python/infra/db/records.py:27-116,220-236`
- `legacy/python/services/economy.py:38-45,113-122`
- `legacy/python/cogs/economy/cog.py:43-50,194-200`
- `legacy/python/cogs/economy/embeds.py:154-168`

## Rules & Exact Numbers

### Daily Mission Selection
- Reset cadence: midnight `00:00` in configured timezone (default JST, `UTC+9`), keyed by ISO date `YYYY-MM-DD` (`domain/missions.py:67`, `services/economy.py:118-121`).
- `PER_DAY = 3` missions per day, identical for all players across all guilds (`catalogs/missions.yaml:12`, `domain/missions.py:61-70`).
- Deterministic RNG seed: `random.Random(f"mission:{day.isoformat()}")` (`domain/missions.py:67`).
- Selection slots (`domain/missions.py:68-70`):
  1. `first`: `rng.choice(UNIVERSAL)` (8 universal missions)
  2. `second`: `rng.choice(BLACKJACK_MISSIONS)` (4 Blackjack missions — guarantees Blackjack-only players can complete at least 2/day)
  3. `third`: `rng.choice([m for m in POOL if m.id not in (first.id, second.id)])` (1 mission from remaining pool of 21 − 2 = 19)
- Pool construction order (`domain/missions.py:32-57`, critical for parity):
  `POOL = UNIVERSAL + OTHER_GAMES + BLACKJACK_MISSIONS + [BIG_WIN]` (21 total missions).
  - `GAMES` order (`catalogs/missions.yaml:3-8`): `["スロット", "ルーレット", "チンチロ", "ブラックジャック", "パチンコ"]`.
  - `OTHER_GAMES` generates 4 `play_game` missions (all `GAMES` except `"ブラックジャック"` in order) followed by 4 `game_win` missions (same order).

### Complete Mission Pool (21 missions)
| Group | ID | Name (JA) | Kind | Target | Reward | Game / Tag |
|---|---|---|---|---:|---:|---|
| `UNIVERSAL` | `play5` | ゲームを5回遊ぶ | `play` | 5 | 300 | — |
| `UNIVERSAL` | `play10` | ゲームを10回遊ぶ | `play` | 10 | 500 | — |
| `UNIVERSAL` | `win3` | 3回勝つ | `win` | 3 | 400 | — |
| `UNIVERSAL` | `win5` | 5回勝つ | `win` | 5 | 600 | — |
| `UNIVERSAL` | `wager5k` | 合計5,000ペリカ賭ける | `wager` | 5,000 | 400 | — |
| `UNIVERSAL` | `wager20k` | 合計20,000ペリカ賭ける | `wager` | 20,000 | 700 | — |
| `UNIVERSAL` | `streak2` | 2連勝する | `streak` | 2 | 400 | — |
| `UNIVERSAL` | `streak3` | 3連勝する | `streak` | 3 | 700 | — |
| `OTHER_GAMES` | `game_スロット` | スロットを3回遊ぶ | `play_game` | 3 | 400 | `スロット` |
| `OTHER_GAMES` | `game_ルーレット` | ルーレットを3回遊ぶ | `play_game` | 3 | 400 | `ルーレット` |
| `OTHER_GAMES` | `game_チンチロ` | チンチロを3回遊ぶ | `play_game` | 3 | 400 | `チンチロ` |
| `OTHER_GAMES` | `game_パチンコ` | パチンコを3回遊ぶ | `play_game` | 3 | 400 | `パチンコ` |
| `OTHER_GAMES` | `gwin_スロット` | スロットで2回勝つ | `game_win` | 2 | 600 | `スロット` |
| `OTHER_GAMES` | `gwin_ルーレット` | ルーレットで2回勝つ | `game_win` | 2 | 600 | `ルーレット` |
| `OTHER_GAMES` | `gwin_チンチロ` | チンチロで2回勝つ | `game_win` | 2 | 600 | `チンチロ` |
| `OTHER_GAMES` | `gwin_パチンコ` | パチンコで2回勝つ | `game_win` | 2 | 600 | `パチンコ` |
| `BLACKJACK_MISSIONS` | `game_ブラックジャック` | ブラックジャックを3回遊ぶ | `play_game` | 3 | 300 | `ブラックジャック` |
| `BLACKJACK_MISSIONS` | `gwin_ブラックジャック` | ブラックジャックで2回勝つ | `game_win` | 2 | 400 | `ブラックジャック` |
| `BLACKJACK_MISSIONS` | `bj_double` | ブラックジャックでダブルダウンに成功する | `tag` | 1 | 600 | `ブラックジャック` / `double_win` |
| `BLACKJACK_MISSIONS` | `bj_natural` | ナチュラルブラックジャックを出す | `tag` | 1 | 700 | `ブラックジャック` / `natural` |
| `BIG_WIN` | `big3x` | 賭け金の3倍以上の利益を1回で出す | `big_win` | 3 | 600 | — |

### Eligibility, Progress, Payouts & Limits
- Minimum bet gate: `MIN_BET = 100` (`catalogs/missions.yaml:10`, `infra/db/records.py:46`). Plays with `bet < 100` still update overall `win_streak`, `best_streak`, `plays`, `wins`, `net_total`, and `weekly_stats`, but do NOT advance `day_streak` or any daily mission (`infra/db/records.py:42-74`).
- `progress_after(m, current, game, bet, net, streak, tags)` (`domain/missions.py:73-91`):
  - `play`: `current + 1`
  - `win`: `current + (1 if net > 0 else 0)`
  - `wager`: `current + bet`
  - `streak`: `max(current, day_streak)` where `day_streak` resets at date change (`streak_day != day.isoformat()`), increments on `net > 0`, resets to `0` on `net < 0`, unchanged on `net == 0` (push) (`infra/db/records.py:39-48`).
  - `big_win`: `max(current, net // bet if net > 0 and bet > 0 else 0)` (integer floor division of net profit by bet).
  - `play_game`: `current + (1 if game == m.game else 0)`
  - `game_win`: `current + (1 if game == m.game and net > 0 else 0)`
  - `tag`: `current + (1 if m.tag in tags else 0)`
- Stored progress is clamped to `min(progress, m.target)` (`infra/db/records.py:90`).
- Automatic payout on completion (`infra/db/records.py:92-101`):
  - Individual mission completion credits `m.reward` with `income=m.reward` (subject to Teiai debt withholding, no daily skim), ledger reason `f"ミッション報酬:{m.name}"`.
  - When all `PER_DAY = 3` missions for `(guild_id, user_id, day)` have `done = 1`, credits `COMPLETE_BONUS = 500` with `income=500`, ledger reason `"ミッション全達成ボーナス"`.
- Already-completed missions (`done == 1`) are skipped so rewards and the all-complete bonus are paid at most once per day (`infra/db/records.py:81-82,95-101`).

### Win Streaks & Jackpot Detection
- `play_state` tracks per `(guild_id, user_id)`: `win_streak`, `best_streak`, `day_streak`, `streak_day`, `plays`, `wins`, `net_total` (`infra/db/records.py:51-67`).
  - `net > 0`: `win_streak += 1`; `net < 0`: `win_streak = 0`; `net == 0`: unchanged.
  - `new_best = streak > best`; `best = max(best, streak)`.
- Jackpot helper: `is_jackpot(bet, net)` returns `bet > 0 and net >= bet * 50` (`jackpot_multiplier: 50`, `catalogs/missions.yaml:96`, `domain/missions.py:94-96`). Used by casino UI for special celebration.

## State Machine & Flow
1. Player completes a casino game → `RecordRepo.record_play(user_id, game, bet, net, day, tags)` runs in a DB transaction.
2. Updates `play_state` and `weekly_stats` unconditionally.
3. If `bet >= 100`, evaluates each of `today_missions(day)` not yet `done`:
   - Computes `progress_after(...)` and upserts `missions(guild_id, user_id, day, mission_id, progress, done)`.
   - On transition `done: 0 -> 1`, credits `m.reward` (`income=m.reward`).
4. If at least one mission completed on this play and `COUNT(done=1) >= 3`, credits `COMPLETE_BONUS` (`500`, `income=500`).
5. `/ペリカ ミッション` reads `mission_status(user_id, today)` without creating an account (`infra/db/records.py:104-115`) and renders an ephemeral embed with a 10-block progress bar (`🟩` / `⬜`).

## Edge Cases
- Viewing `/ペリカ ミッション` before ever playing does NOT create a `users` row (`infra/db/records.py:105`).
- Pushes (`net == 0`) count toward `play`, `play_game`, and `wager`, do NOT count toward `win`/`game_win`, and preserve both `win_streak` and `day_streak`.
- `day_streak` does NOT carry over across midnight even if `win_streak` does (`infra/db/records.py:39-41`).
- If a play has `bet < 100`, `streak_day` is NOT overwritten (`d if counts else (row["streak_day"] if row else None)`, `infra/db/records.py:63`).
- Progress bar uses integer floor `10 * min(progress, m.target) // m.target` (`cogs/economy/embeds.py:157`).

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `missions.cmd_name` | `ミッション` | `cogs/economy/cog.py:194` |
| `missions.cmd_desc` | `今日のミッションと進み具合を見る` | `cogs/economy/cog.py:194` |
| `missions.embed_title` | `📜 今日のミッション` | `cogs/economy/embeds.py:167` |
| `missions.row` | `{mark} **{name}**　報酬 {reward}\n{bar} {shown:,} / {target:,}` (`mark` = `✅` / `🔸`, `bar` = `🟩`/`⬜` ×10) | `cogs/economy/embeds.py:157-160` |
| `missions.min_bet_note` | `※ 賭け金 {min_bet} 以上のゲームだけが数えられます。連勝はその日の分だけです。` | `cogs/economy/embeds.py:162` |
| `missions.complete_bonus_line` | `🎁 3つ全部で、さらに **+{bonus}**` | `cogs/economy/embeds.py:164` |
| `missions.streak_line` | `🔥 いまの連勝: **{win_streak}** ／ 自己ベスト: **{best_streak}**` | `cogs/economy/embeds.py:165` |
| `missions.reset_line` | `🕛 次の更新: **{reset_text}**（<t:{ts}:R>）` | `cogs/economy/embeds.py:166` |
| `missions.ledger_reward` | `ミッション報酬:{name}` | `infra/db/records.py:93` |
| `missions.ledger_bonus` | `ミッション全達成ボーナス` | `infra/db/records.py:101` |
| `missions.tz_jst` | `日本時間` | `cogs/economy/cog.py:44` |
| `missions.reset_label_jst` | `日本時間 0:00` | `cogs/economy/cog.py:49` |
| `missions.reset_label_other` | `{tz_label} の 0:00` | `cogs/economy/cog.py:49` |
