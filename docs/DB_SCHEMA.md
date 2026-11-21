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
| Pelica | `INTEGER`. No `REAL` column holds money or a rate, anywhere. |
| Rates | `INTEGER` basis points (`_bps`, 1 bp = 0.01 %). |
| Prices, quantities | Fixed-point `INTEGER`: prices in micro-Pelica (`_micros`, ×1,000,000), quantities in milli-units (`_milli`, ×1,000). `REAL` is not used for money, rates, prices or quantities. |
| Rounding | One rule, applied where an amount becomes Pelica: amounts paid to a player round down, amounts charged to a player round up. The ledger only ever sees integers. |
| Time | `INTEGER` epoch milliseconds, UTC. Game days use `UTC_OFFSET_HOURS` (JST = 9) in code. |
| Booleans | `INTEGER` 0/1 with a `CHECK`. |
| JSON | `TEXT` with `CHECK (json_valid(...))`. |
| Tables | `STRICT`. Per-guild tables carry `guild_id` and reference `guild_members` where a player is involved. |
| Enums | `TEXT`. The value lists live in `packages/shared` (`LedgerReason`, `ScreenId`, `NotificationKind`, ...). |

## Connection pragmas

Set by `applyPragmas` (`apps/server/src/db/pragmas.ts`) on every open (they are per connection, so they are not in a migration):

| Pragma | Value | Why |
| --- | --- | --- |
| `journal_mode` | `WAL` | Readers do not block the writer. |
| `synchronous` | `NORMAL` | Safe with WAL, far fewer fsyncs (SD cards on a Pi). |
| `busy_timeout` | `5000` | Wait instead of failing when the backup or a CLI holds a lock. |
| `foreign_keys` | `ON` | Off by default in SQLite. |
| `recursive_triggers` | `ON` | Makes the implicit delete of `INSERT OR REPLACE` fire DELETE triggers. The ledger triggers hold without it too (tested both ways). |
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
| `user_settings` | `user_id` | Language (`NULL` = auto), sound, volume, motion (`system`/`full`/`reduced`), theme, DM digest. Global per user. Reshaped by 0004 (below). |
| `notification_prefs` | `user_id, kind` | DM opt-in (off by default) and inbox (on by default) per `NotificationKind`. |
| `notification_queue` | `id` | Outgoing DMs with status, attempts, `next_attempt_at`, `dedupe_key`. |
| `inbox` | `id` | In-Activity inbox per user and guild, with `read_at`. |

### Ledger invariants (enforced by triggers)

- `ledger` rejects `UPDATE` and `DELETE`, and an insert whose explicit `id` already exists, so
  `INSERT OR REPLACE` and upserts cannot overwrite history.
- An insert must satisfy `balance_after = previous balance (0 if none) + delta`.
- After each insert, `balances` is upserted from the new row.
- `balances` rejects any insert (including `INSERT OR REPLACE`), update or delete that does not
  mirror the newest ledger row of that account, so a direct write cannot move money.
- `CHECK (balance_after >= 0)` and `CHECK (balance >= 0)`: a balance never goes below zero.

### Decision: balances are never negative

The original keeps debt out of the wallet: `users.debt` is Teiai debt repaid by withholding from
income, and player-to-player loans live in `loans`. Nothing in the old schema lets `balance` go
below zero. We keep that: debt and loans live in their own per-guild tables (`bank_accounts`,
`loans`), the wire schemas use non-negative `Pelica`, and SQL enforces it. Interest and
repayment never push a balance below zero: a repayment or withholding debits at most the current
balance (`loan_repay`, `debt_withholding`), and what is left stays on the debt row. The importer
reports any negative legacy balance as an error instead of importing it.

So `balances.balance = SUM(ledger.delta)` per account always holds. `EconomyService` is the only
code that inserts ledger rows; it also checks business rules (caps, fees, transfer limits) that
the triggers do not know about. The test `0001_init.test.ts` covers the triggers.

### `user_settings` after 0004 (B1)

`UserSettings` (`packages/shared/src/settings.ts`) is global per user, so the table keeps its
`user_id` key. SQLite cannot change a `CHECK` in place, so `0004_user_settings.sql` rebuilds the
table (create `user_settings_new`, copy, drop, rename, in the migration's transaction):

| Column | 0001 | After 0004 | Wire (`UserSettings`) |
| --- | --- | --- | --- |
| `user_id` | `TEXT` PK → `users` | unchanged | (session) |
| `locale` | `'en'`/`'ja'`, `NULL` = auto | unchanged | `language`: `NULL` ↔ `'auto'` |
| `sound` | 0/1, default 1 | unchanged | `sound.enabled` |
| `volume` | 0–100, default 70 | **dropped** | — |
| `sfx_volume` | — | **added**: `INTEGER NOT NULL DEFAULT 30 CHECK (sfx_volume BETWEEN 0 AND 100)`, copied from `volume` | `sound.sfxVolume` |
| `music_volume` | — | **added**: `INTEGER NOT NULL DEFAULT 30 CHECK (music_volume BETWEEN 0 AND 100)`, copied from `volume` | `sound.musicVolume` |
| `motion` | `system`/`full`/`reduced`, default `system` | unchanged | `motion` |
| `theme` | `system`/`light`/`dark`, default `system` | **changed**: `CHECK (theme IN ('discord', 'light', 'dark'))`, default `'discord'`; `'system'` rows become `'discord'` | `theme` |
| `dm_digest` | 0/1, default 1 | unchanged | (not in `UserSettings`) |
| `updated_at` | ms | unchanged | — |

A user without a row gets `DEFAULT_USER_SETTINGS`; `PUT /api/settings` upserts the whole row.

## Planned tables (Wave 2)

Owners create these in their own migrations (`0002_...` onward), following the conventions.
Names are a starting point; owners may refine them.

**Every table that holds Pelica, a stake, a position or a claim is per guild** (`guild_id`, and
`guild_members` for player rows). That includes securities: holdings, margin, options and bonds
are per guild. Only the read-only feeds below are shared by all guilds, as in the original.

| Area | Per-guild tables | Owner |
| --- | --- | --- |
| Stats | `player_stats` | B1 (the `GameSettled` subscriber) |
| Casino games | `game_rounds` (open rounds, held stakes), `jackpots`, `rtp_levels`, `pachinko_spins`, `pachinko_sets` | B2-A |
| Daily, missions, ranking | `daily_claims`, `missions`, `weekly_stats`, `weekly_champions`, `weekly_state`, `titles`, `nick_prefs` | B2-B |
| Events | `event_state`, `manual_events` | B2-B |
| Races, arena | `horses`, `horse_races`, `horse_entries`, `horse_bets`, `horse_odds`, `arena_tournaments`, `arena_fighters`, `arena_bets` | B2-B |
| Work, quiz, lottery, polls | `work_state`, `work_finds`, `work_click_hours`, `work_workers`, `quiz_answers`, `raffles`, `raffle_entries`, `polls`, `poll_votes` | B2-B |
| Shop and items | `inventory`, `shop_stock`, `profiles`, `seized_items`, `teiai_market`, `teiai_market_days` | B2-B |
| Player market | `marketplace_listings` | B3 |
| Securities | `positions_spot`, `positions_short`, `positions_long`, `options`, `bonds`, `earnings_memos`, `earnings_shop` | B3 |
| Teiai bank | `bank_accounts` (debt, bankrupt_at, blacklist_until), `bank_reserve`, `house_account`, `bank_deposits`, `loans`, `cds` | B3 |
| Kyosai, companies | `kyosai_units`, `kyosai_auctions`, `kyosai_offers`, `kyosai_motions`, `kyosai_votes`, `companies`, `company_stakes` | B3 |
| Bot | `bot_messages`, `guild_webhooks` (personas) | B4 |
| Import | `legacy_ledger` (read-only old history), `legacy_import_runs` | B1 |

| Shared feed (no `guild_id`, no money) | Owner |
| --- | --- |
| `market_prices` (`price_micros`), `market_fair`, `market_events`, `earnings` | B3 |
| `quiz_questions` | B2-B |

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
| `seized_items`, `teiai_market`, `teiai_market_days` | same names | `day` (REAL) becomes a date or ms. |
| `quiz_questions`, `quiz_answers` | same names | Questions are global. |
| `raffle`, `raffle_entries` | `raffles`, `raffle_entries` | Entry fees of open raffles are held Pelica. |
| `polls`, `poll_votes` | same names | 1:1. |
| `market_prices`, `market_fair`, `market_events`, `earnings` | same names | Shared feed. Prices and factors to fixed-point integers. |
| `earnings_memos`, `earnings_shop` | same names | Per guild (they are bought with Pelica). |
| `crypto`, `crypto_short`, `crypto_long` | `positions_spot`, `positions_short`, `positions_long` | Per guild. Quantities to `_milli`, prices to `_micros`. Margin is held Pelica. |
| `options`, `bonds`, `loans`, `cds` | same names | Per guild. Strike and spot to `_micros`; `loans.rate_tenths` (0.1 %/day) to `rate_bps` (×10). |
| `teiai_bank`, `teiai_house`, `teiai_deposits` | `bank_reserve`, `house_account`, `bank_deposits` | Per guild. Legacy `REAL` cash, loaned and thermostat amounts become `INTEGER` Pelica (rounded with the rule above; the importer reports the total rounding residue). Rates to bps. |
| `kyosai_units`, `kyosai_auctions`, `kyosai_offers`, `kyosai_motions`, `kyosai_votes` | same names | `user_id = 0` (house units) becomes `NULL` user plus a house flag. |
| `companies`, `company_stakes` | same names | Company funds are separate from player balances. |
| `leaderboards`, `chart_posts`, `chart_boards` | `bot_messages` | Message pointers; safe to drop if the channel is gone. |

### Value conversions

- Ids: legacy `INTEGER` ids are read with `safeIntegers(true)` (BigInt) and written as decimal
  strings. Never go through a JS number.
- Time: legacy `REAL` epoch seconds become `Math.round(ts * 1000)` ms. Text dates stay text.
- Money: legacy `INTEGER` Pelica is copied as is. Legacy `REAL` money (bank internals) is
  rounded once at import with the rounding rule; player balances are always `INTEGER` already, so
  the per-player proof below is exact.
- Rates, prices, quantities: converted to bps, micro-Pelica and milli-units (no `REAL` left).
- Negative legacy balances, if any, stop the import with a report (see the decision above).

### Proof that no Pelica moved

The importer prints, per guild and per user, legacy and new totals for each bucket (player
balance, held stakes, held bids, unclaimed work pot, deposits, bond principal, margin, raffle
fees) and exits non-zero on any difference. For each player, the new balance equals
`users.balance` plus refunded `escrow`, and every other held amount is carried unchanged into its
new table. A second run on the same file must be a no-op (`legacy_import_runs`).
