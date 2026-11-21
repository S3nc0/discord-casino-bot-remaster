# Weekly Ranking & Titles Specification

Planned owner: `B2-B` | Screen ID: `ranking` (`packages/shared/src/ids.ts`) | Feature toggle: none

## Source Files
- `catalogs/economy.yaml:61-64`
- `catalogs/shop.yaml:42-48` (`title_weekly_king`)
- `legacy/python/domain/weekly.py:1-33`
- `legacy/python/domain/history.py:95-97`
- `legacy/python/infra/db/records.py:68-72,117-218`
- `legacy/python/services/economy.py:149-160`
- `legacy/python/cogs/weekly/cog.py:1-125`
- `legacy/python/cogs/weekly/embeds.py:1-31`
- `legacy/python/cogs/shared/messages/base.py:102-110`

## Rules & Exact Numbers

### Week Boundaries & Identifiers
- Week runs **Monday 00:00 through Sunday 23:59:59** in the configured timezone (default JST, `UTC+9`) (`domain/weekly.py:3,15-25`).
- `week_start(day) = day - timedelta(days=day.weekday())` (ISO Monday).
- `week_id(day) = week_start(day).isoformat()` (e.g. `"2026-10-26"`).
- `previous_week_id(day) = (week_start(day) - timedelta(days=7)).isoformat()`.
- `week_label(week)`: `"{start.month}/{start.day}〜{end.month}/{end.day}"` where `end = start + timedelta(days=6)` (no zero-padding, e.g. `"10/26〜11/1"`).

### Recording & Standings
- Every recorded casino game play (`RecordRepo.record_play`) upserts `weekly_stats(guild_id, week, user_id, net, plays)` with `net += game_net`, `plays += 1` (`infra/db/records.py:68-72`). Note: unlike daily missions, there is NO `MIN_BET` filter on `weekly_stats` recording.
- Standings sort order (`infra/db/records.py:123`):
  `ORDER BY net DESC, plays ASC, user_id ASC` (highest net profit first; tie-breaker: fewer plays first; then lowest `user_id`).
- `weekly_rank(week, user_id)` scans up to 10,000 rows and returns `(rank_1based, net, plays, total_players)` or `None` (`infra/db/records.py:128-134`).

### Champion Qualification & Title Award
- Constants (`catalogs/economy.yaml:61-64`):
  - `MIN_PLAYS = 5` (minimum games played in that week)
  - `ANNOUNCE_TOP = 5` (top N players displayed in the weekly announcement)
  - `CHECK_MINUTES = 5` (background polling interval in minutes)
- Exclusive title item: `shop.WEEKLY_KING = "title_weekly_king"` (display name `今週の王者` in `catalogs/shop.yaml:42-48`, non-purchasable, `price: 0`).
- `weekly_award(week)` atomicity (`infra/db/records.py:155-192`):
  1. Checks `weekly_state.last_week` for `guild_id`. If `last is not None and last >= week`, returns `None` (idempotent guard against double announcement).
  2. Finds all current holders of `title_weekly_king` in `inventory` for this guild (`previous`).
  3. Strips `title_weekly_king` from ALL users in this guild:
     - `DELETE FROM inventory WHERE guild_id=? AND item_id='title_weekly_king'`
     - `UPDATE profile SET title=NULL WHERE guild_id=? AND title='title_weekly_king'`
  4. Selects champion: `WHERE guild_id=? AND week=? AND net > 0 AND plays >= 5 ORDER BY net DESC, plays ASC, user_id ASC LIMIT 1`.
  5. If a champion exists:
     - Inserts into `weekly_champions(guild_id, week, user_id, net)` (`INSERT OR REPLACE`).
     - Grants `inventory(guild_id, user_id, 'title_weekly_king', qty=1)` (upsert `qty=1`). Note: it is NOT auto-equipped; the champion equips it via `/ショップ`.
     - Computes cumulative `wins = COUNT(*) FROM weekly_champions WHERE guild_id=? AND user_id=?`.
  6. Records `weekly_state.last_week = week`.
  7. Returns `{"champion": (uid, net, plays) | None, "previous": [u for u in previous if not champion or u != champion[0]], "wins": wins, "standings": weekly_top(week, 5)}`.

### Schedule & Startup Behavior
- Background task `check_weeks` loops every `5` minutes (`cogs/weekly/cog.py:58-63`).
- On `cog_load`, runs one-time `backfill_weekly(utc_offset_hours)` guarded by sentinel row `weekly_state(guild_id=0, last_week='backfilled')`, reconstructing historical `weekly_stats` from `ledger` via `domain.history.game_results()` (`infra/db/records.py:194-218`).
- On each tick (`cogs/weekly/cog.py:69-87`), for every allowed guild:
  - `prev_week = weekly.previous_week_id(clock.today())`.
  - If `weekly_last_announced(guild_id)` is `None`: seeds `last_week = prev_week` WITHOUT announcing (so first-ever run waits until next Monday).
  - Else if `last < prev_week`: calls `announce(guild, prev_week)`. If the bot was offline past Monday 00:00, it announces once on startup.
- Announcement channel: `announce_channel(guild, guild_repo)` (leaderboard channel if set & postable, else `guild.system_channel`) (`cogs/weekly/cog.py:93`).
- If `result["standings"]` is empty (nobody played that week), `weekly_award` still strips old title and marks `last_week = week`, and `announce` skips posting (`cogs/weekly/cog.py:90-92`).
- For every user in `result["previous"]` (stripped previous champions who did not repeat), calls `shop_bridge.sync_title_nick(uid, guild)` to remove the title from their Discord nickname (`cogs/weekly/cog.py:108-112`).

## State Machine
- Per guild `weekly_state.last_week`:
  `None` --(first poll)--> `prev_week` (no post)
  `W_old` --(clock crosses Monday 00:00, `W_old < prev_week`)--> `weekly_award(prev_week)` --> `prev_week` (post if `standings` non-empty; sync stripped nicks).

## Edge Cases
- If the previous champion repeats as champion, they are excluded from `previous` so the "前の王者 ... の称号は外れました" line is NOT printed and their nickname is not cleared (`infra/db/records.py:189`). Note: their `profile.title` IS cleared to `NULL` by line 167 before re-granting inventory, so a repeating champion must re-equip the title in `/ショップ` unless preserved! (Exact legacy quirk to note for parity.)
- If nobody played >= 5 games with `net > 0` (even if players played and lost, or played < 5 games), `champion` is `None`, the previous champion's title is STILL revoked, and the embed announces "王者はお休みです".
- Only the winning champion is pinged (`content=f"🎉 <@{champ[0]}>"` with `AllowedMentions(users=[champ])`); other standings mentions do not ping (`cogs/weekly/cog.py:96-105`).

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `weekly.embed_title` | `🏆 週間ランキング 発表！（{week_label}）` | `cogs/weekly/embeds.py:28` |
| `weekly.embed_footer` | `毎週月曜0時に発表 ｜ 稼ぎ = その週のゲームの損益の合計` | `cogs/weekly/embeds.py:29` |
| `weekly.ping_content` | `🎉 <@{user_id}>` | `cogs/weekly/cog.py:102` |
| `weekly.standing_line` | `{mark} <@{uid}>　**{net:+,}ペリカ**（{plays}戦）{me}` (`mark` = `🥇`/`🥈`/`🥉`/`\`{r:>2}\``, `me` = `　◀ あなた` or `""`) | `cogs/shared/messages/base.py:107-109` |
| `weekly.champion_line1` | `👑 **<@{user_id}>** が **{title_name}** を獲得しました！（通算{wins}回目）` | `cogs/weekly/embeds.py:18` |
| `weekly.champion_line2` | `今週の稼ぎ **{net:+,}ペリカ**（{plays}戦）。\`/ショップ\` の「持ち物」の画面で身につけられます（次の発表まで）。` | `cogs/weekly/embeds.py:19` |
| `weekly.no_champion` | `今週は、{min_plays}ゲーム以上遊んでプラスだった人がいませんでした。王者はお休みです。` | `cogs/weekly/embeds.py:24` |
| `weekly.previous_revoked` | `前の王者 {mentions_joined_by_nakaguro} の称号は外れました。` | `cogs/weekly/embeds.py:27` |
