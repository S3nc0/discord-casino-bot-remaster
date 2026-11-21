# Database schema

One SQLite file, opened by the single server process through `better-sqlite3`. Migrations live in
`apps/server/src/db/migrations/` as numbered `.sql` files, are inlined into the server bundle,
and are applied in order inside one transaction each. A merged migration is never edited; add a
new file. `0001_init.sql` holds the core tables below. Feature tables come in later migrations
written by their owners (see [Planned tables](#planned-tables-wave-2)).

## Conventions

| Thing | Rule |
| --- | --- |
| Discord ids | `TEXT` snowflakes. JS numbers lose precision above 2^53. |
| Pelica | `INTEGER`. Never `REAL`. |
| Time | `INTEGER` epoch milliseconds, UTC. Game days use `UTC_OFFSET_HOURS` (JST = 9) in code. |
| Booleans | `INTEGER` 0/1 with a `CHECK`. |
| JSON | `TEXT` with `CHECK (json_valid(...))`. |
| Tables | `STRICT`. Per-guild tables carry `guild_id` and reference `guild_members` where a player is involved. |
| Enums | `TEXT`. The value lists live in `packages/shared` (`LedgerReason`, `ScreenId`, `NotificationKind`, ...). |

## Connection pragmas

Set by the connection code on every open (they are per connection, so they are not in a migration):

| Pragma | Value | Why |
| --- | --- | --- |
| `journal_mode` | `WAL` | Readers do not block the writer. |
| `synchronous` | `NORMAL` | Safe with WAL, far fewer fsyncs (SD cards on a Pi). |
| `busy_timeout` | `5000` | Wait instead of failing when the backup or a CLI holds a lock. |
| `foreign_keys` | `ON` | Off by default in SQLite. |
| `temp_store` | `MEMORY` | No temp files. |
| `cache_size` | `-8000` (8 MB) | Fits the 150 MB idle RSS target. |

Every money change runs inside one `db.transaction(...)`. Prepared statements are created once
and reused. Nightly backups use the online backup API (`sqlite3 .backup`), never a file copy.

## Core tables (0001_init)

| Table | Key | Purpose |
| --- | --- | --- |
| `users` | `user_id` | Global identity cache (username, global name, avatar). |
| `guilds` | `guild_id` | Guild and its approval status (`pending` / `approved` / `denied`, for `REQUIRE_APPROVAL`). |
| `guild_config` | `guild_id` | Per-guild settings: preferred `locale`, `announce_channel_id` (falls back to `ANNOUNCE_CHANNEL_ID`), announcement on/off, big-win threshold, announcement rate. |
| `guild_announce_types` | `guild_id, event_type` | Per event type on/off and channel override. |
| `guild_features_off` | `guild_id, feature` | Features an owner switched off. |
| `guild_members` | `guild_id, user_id` | A player's account in one guild. Economies are per guild. |
| `ledger` | `id` | Append-only money log: `delta`, `balance_after`, `reason`, optional `ref_type`/`ref_id`, `idempotency_key`, `meta`. |
| `balances` | `guild_id, user_id` | Current balance, maintained by a trigger from the ledger. |
| `idempotency_keys` | `guild_id, user_id, key` | First response per key, replayed on repeats; `request_hash` detects a reused key with a different body. |
| `launch_intents` | `guild_id, user_id` | Screen to open after auth. Newest replaces older; expires after 2 minutes; `consumed_at` set on use. |
| `user_settings` | `user_id` | Language (`NULL` = auto), sound, volume, motion (`system`/`full`/`reduced`), theme, DM digest. Global per user. |
| `notification_prefs` | `user_id, kind` | DM opt-in (off by default) and inbox (on by default) per `NotificationKind`. |
| `notification_queue` | `id` | Outgoing DMs with status, attempts, `next_attempt_at`, `dedupe_key`. |
| `inbox` | `id` | In-Activity inbox per user and guild, with `read_at`. |

### Ledger invariants (enforced by triggers)

- `ledger` rejects `UPDATE` and `DELETE`.
- An insert must satisfy `balance_after = previous balance (0 if none) + delta`.
- After each insert, `balances` is upserted from the new row.
- `balances` rejects any insert, update or delete that does not mirror the newest ledger row of
  that account, so a direct write cannot move money.

So `balances.balance = SUM(ledger.delta)` per account always holds. `EconomyService` is the only
code that inserts ledger rows; it also checks business rules (no negative balance, caps, fees)
that the triggers do not know about. The test `0001_init.test.ts` covers the triggers.

## Planned tables (Wave 2)

Owners create these in their own migrations (`0002_...` onward), following the conventions.
Names are a starting point; owners may refine them.

| Area | Tables | Owner |
| --- | --- | --- |
| Stats | `player_stats` (plays, wins, wagered, won, biggest win, streaks, net) | B1 (written by the `GameSettled` subscriber) |
| Casino games | `game_rounds` (open rounds and held stakes), `jackpots`, `rtp_levels`, `pachinko_spins`, `pachinko_sets` | B2 |
| Daily, missions, ranking | `daily_claims`, `missions`, `weekly_stats`, `weekly_champions`, `weekly_state`, `titles`, `nick_prefs` | B2 |
| Events | `event_state`, `manual_events` | B2 |
| Races | `horses`, `horse_races`, `horse_entries`, `horse_bets`, `horse_odds` | B2 |
| Arena | `arena_tournaments`, `arena_fighters`, `arena_bets` | B2 |
| Work | `work_state`, `work_finds`, `work_click_hours`, `work_workers` | B2 |
| Quiz, lottery, polls | `quiz_questions`, `quiz_answers`, `raffles`, `raffle_entries`, `polls`, `poll_votes` | B2 |
| Securities | `market_prices`, `market_fair`, `market_events`, `earnings`, `earnings_memos`, `earnings_shop`, `positions_spot`, `positions_short`, `positions_long`, `options`, `bonds` | B3 |
| Teiai bank | `bank_accounts` (debt, bankrupt_at, blacklist_until), `bank_reserve`, `house_account`, `bank_deposits`, `loans`, `cds` | B3 |
| Kyosai, companies | `kyosai_units`, `kyosai_auctions`, `kyosai_offers`, `kyosai_motions`, `kyosai_votes`, `companies`, `company_stakes` | B3 |
| Shop, items, player market | `inventory`, `shop_stock`, `profiles`, `marketplace_listings`, `seized_items`, `teiai_market`, `teiai_market_days` | to be assigned by the Leader |
| Bot | `bot_messages` (leaderboard, chart and listing posts), `guild_webhooks` (personas) | B4 |
| Import | `legacy_ledger` (read-only copy of the old history), `legacy_import_runs` | B1 |

Market tables are global (no `guild_id`), as in the original.

## Legacy table mapping

Source: the Python bot's `data/casino.db`. The importer (`apps/server/scripts/import-legacy.ts`,
B1) runs with the Python bot stopped.

| Legacy table | New table(s) | Notes |
| --- | --- | --- |
| `users` | `guild_members`, `balances` via ledger, `player_stats`, `daily_claims`, `bank_accounts` | `balance` becomes one `legacy_import` ledger row. `daily_streak`, `last_daily`, `last_slot` go to `daily_claims`. `games_played`, `total_wagered`, `total_won`, `biggest_win` go to `player_stats`. `debt`, `bankrupt_at`, `blacklist_until` go to `bank_accounts`. |
| `guild_users` | `guild_members` | Also creates `users` rows. |
| `guild_status` | `guilds` | `status`, `name`, `decided_by`, `updated_at`, `notified_at`. |
| `features_off` | `guild_features_off` | 1:1. |
| `ledger` | `legacy_ledger` | Copied as read-only history. Not replayed into `ledger`: the opening `legacy_import` row is the new chain's start. |
| `escrow` | ledger `game_refund` | Stakes of unfinished games are refunded right after the opening row. |
| `play_state` | `player_stats` | Streaks, plays, wins, net. |
| `missions` | `missions` | 1:1. |
| `weekly_stats`, `weekly_champions`, `weekly_state` | same names | 1:1. |
| `nick_prefs` | `nick_prefs` | 1:1. |
| `profile` | `profiles`, `titles` | Title, card, skins, daily boost, insurance. |
| `inventory`, `shop_stock` | same names | 1:1. |
| `jackpot` | `jackpots` | Pool carried over. |
| `rtp_level` | `rtp_levels` | 1:1. |
| `pachinko_spins`, `pachinko_sets` | same names | Statistics only; optional. |
| `event_state`, `manual_event` | `event_state`, `manual_events` | 1:1. |
| `horses`, `horse_races`, `horse_entries`, `horse_bets`, `horse_odds` | same names | Open bets keep their held stakes. |
| `arena_tournaments`, `arena_fighters`, `arena_bets` | same names | NPC bettors use negative user ids: store them as `NULL` user plus an NPC column. |
| `labor`, `labor_finds`, `labor_click_hours`, `labor_workers` | `work_state`, `work_finds`, `work_click_hours`, `work_workers` | Unclaimed `pot` is held Pelica. |
| `market_listings` | `marketplace_listings` | Highest bids are held Pelica. |
| `seized_items`, `teiai_market`, `teiai_market_days` | same names | 1:1. |
| `quiz_questions`, `quiz_answers` | same names | Questions are global. |
| `raffle`, `raffle_entries` | `raffles`, `raffle_entries` | Entry fees of open raffles are held Pelica. |
| `polls`, `poll_votes` | same names | 1:1. |
| `market_prices`, `market_fair`, `market_events`, `earnings`, `earnings_memos`, `earnings_shop` | same names | Global. |
| `crypto`, `crypto_short`, `crypto_long` | `positions_spot`, `positions_short`, `positions_long` | Margin is held Pelica. |
| `options`, `bonds`, `loans`, `cds` | same names | Premiums, principal and margin as in the original. |
| `teiai_bank`, `teiai_house`, `teiai_deposits` | `bank_reserve`, `house_account`, `bank_deposits` | Bank-side money is not a player balance. |
| `kyosai_units`, `kyosai_auctions`, `kyosai_offers`, `kyosai_motions`, `kyosai_votes` | same names | `user_id = 0` (house units) becomes `NULL` user plus a house flag. |
| `companies`, `company_stakes` | same names | Company funds are separate from player balances. |
| `leaderboards`, `chart_posts`, `chart_boards` | `bot_messages` | Message pointers; safe to drop if the channel is gone. |

### Value conversions

- Ids: legacy `INTEGER` ids are read with `safeIntegers(true)` (BigInt) and written as decimal
  strings. Never go through a JS number.
- Time: legacy `REAL` epoch seconds become `Math.round(ts * 1000)` ms. Text dates stay text.
- Money: legacy `INTEGER` Pelica is copied as is. Legacy `REAL` amounts (bank internals,
  fractional stock) stay `REAL` in their finance tables; owners decide where rounding happens.

### Proof that no Pelica moved

The importer prints, per guild and per user, legacy and new totals for each bucket (player
balance, held stakes, held bids, unclaimed work pot, deposits, bond principal, margin, raffle
fees) and exits non-zero on any difference. For each player, the new balance equals
`users.balance` plus refunded `escrow`, and every other held amount is carried unchanged into its
new table. A second run on the same file must be a no-op (`legacy_import_runs`).
