**English** | [日本語](DB_SCHEMA.ja.md)

# Database schema

One SQLite file, opened by the single server process through `better-sqlite3`. Migrations live in
`apps/server/src/db/migrations/` as numbered `.sql` files, are inlined into the server bundle,
and are applied in order inside one transaction each. A merged migration is never edited; add a
new file. `0001_init.sql` holds the core tables below. Feature tables come in later migrations
(see [Feature tables](#feature-tables)).

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
| `notification_prefs` | `user_id, kind` | DM opt-in (off by default) and inbox (on by default) per `NotificationKind`. System inbox kinds (`SYSTEM_INBOX_KINDS`: `dm_disabled`) have no row: they are always written and never DMed. |
| `notification_queue` | `id` | Outgoing DMs with status, attempts, `next_attempt_at`, `dedupe_key`. |
| `inbox` | `id` | In-Activity inbox per user and guild, with `read_at`. `kind` is an `InboxKind` (`NOTIFICATION_KINDS` plus `dm_disabled`); `payload` is the JSON of an `InboxPayload` (the domain event, or a `DmDisabledNotice`). |

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

### `arena_tournaments` after 0011

`0011_arena_runner_up.sql` adds one nullable column to `arena_tournaments`:

| Column | Type | Meaning |
| --- | --- | --- |
| `runner_up_id` | `INTEGER REFERENCES arena_fighters (id)` | Second place of the final: a fighter of the same tournament, set together with `champion_id` when the final settles. `NULL` while the tournament is open and for tournaments that finished before the migration (their second place was never stored). |

Nothing is backfilled and no money column is involved. See [arena.md](spec/arena.md) §4.5.

## Feature tables

Each feature added its tables in its own migration, following the conventions above.

**Every table that holds Pelica, a stake, a position or a claim is per guild** (`guild_id`, and
`guild_members` for player rows). That includes securities: holdings, margin, options and bonds
are per guild. Only the read-only feeds below are shared by all guilds, as in the original.

| Migration | Area | Per-guild tables |
| --- | --- | --- |
| `0003_legacy_import` | Import | `legacy_ledger` (read-only old history), `legacy_import_runs` |
| `0005_casino` | Casino games | `game_rounds` (open rounds, held stakes), `jackpots`, `rtp_levels`, `pachinko_sets`, `pachinko_spins` |
| `0006_notify_webhooks` | Bot | `guild_webhooks` (personas) |
| `0007_finance` | Teiai bank | `bank_accounts` (debt, bankrupt_at, blacklist_until), `bank_reserve`, `house_account`, `bank_deposits`, `loans`, `cds` |
| `0007_finance` | Kyosai, companies | `kyosai_units`, `kyosai_auctions`, `kyosai_offers`, `kyosai_motions`, `kyosai_votes`, `companies`, `company_stakes` |
| `0007_finance` | Securities, player market | `positions_spot`, `positions_short`, `positions_long`, `options`, `bonds`, `earnings_memos`, `earnings_shop`, `marketplace_listings` |
| `0008_games_progression` | Stats, daily, missions, ranking | `play_state` (streaks and play counts), `daily_claims`, `missions`, `weekly_stats`, `weekly_champions`, `weekly_state` |
| `0008_games_progression` | Shop and items | `inventory`, `profiles`, `shop_stock`, `seized_items`, `teiai_market`, `teiai_market_days` |
| `0008_games_progression` | Races, arena | `horses`, `horse_races`, `horse_entries`, `horse_odds`, `horse_bets`, `arena_tournaments`, `arena_fighters`, `arena_bets` |
| `0008_games_progression` | Work, quiz, lottery, polls | `work_state`, `work_workers`, `work_finds`, `work_click_hours`, `quiz_answers`, `raffles`, `raffle_entries`, `polls`, `poll_votes` |
| `0009_horse_breeding` | Breeding | `horse_breedings` (ledger `ref_id` of `horse_breeding_fee`), plus parent, generation, foaled, maturity and cooldown columns on `horses` ([horse-breeding.md](spec/horse-breeding.md) §5) |
| `0010_bot_tools` | Owner tools | `leaderboards` (a pinned board message per guild), `casino_events` (the owner's manual special event, at most one per guild) |
| `0011_arena_runner_up` | Arena | `arena_tournaments.runner_up_id` (see above) |
| `0012_pinned_posts` | Bot | `pinned_posts` (see below) |
| `0013_stream` | Stream panel | `streams`, `stream_rounds`, `stream_bets`, `stream_round_audit` (see below) |

`0012_pinned_posts.sql` creates `pinned_posts`: one row per poll, kyosai motion or raffle whose chat
post the bot has pinned. Columns: `kind` (`poll`, `motion` or `raffle`), `ref_id` (the id in
`polls`, `kyosai_motions` or `raffles`; primary key with `kind`), `guild_id`, `channel_id`,
`message_id`, `pinned_at` and `tries` (unpin attempts that failed with an unexpected error). There
is no foreign key: a source row that is gone counts as ended. The `notify:pin-sweep` job unpins a
post when its source is no longer `open` and then deletes the row. It holds no Pelica and has no
ledger rows. The importer does not carry it. See [spec/polls.md](spec/polls.md) §2.5,
[spec/kyosai.md](spec/kyosai.md) §6 and [spec/lottery.md](spec/lottery.md) §2.3.

`0013_stream.sql` holds the stream panel ([spec/stream.md](spec/stream.md) §14). All four tables
are STRICT, with millisecond timestamps and TEXT snowflakes.

- `streams`: one panel. `guild_id`, `streamer_id` (a `guild_members` row), `title` (1 to 100),
  `url` (null or at most 300), `channel_id` and `message_id` of the chat panel (null for a stream
  started in the Activity only), `voice_channel_id` (the voice channel of the streamer's Activity
  instance, verified with Discord; never a channel the bot made, decision D4), `started_at`,
  `ends_at` (= start + 24 h), `ended_at`, `tips` and `tip_count` (panel totals), `status`
  (`live` or `ended`; `ended_at` is set exactly when ended). Partial unique index
  `streams_one_live` on `(guild_id, streamer_id) WHERE status = 'live'`: one live panel per
  streamer per guild. `streams_live_due` serves the close job.
- `stream_rounds`: one win/lose round. `stream_id`, `guild_id`, `label` (0 to 60; empty means the
  default name in the reader's language), `status` (`open`, `locked`, `win`, `lose`, `void`),
  `created_at`, `auto_lock_at` (= created + 10 minutes), `locked_at`, `settled_at` (set exactly
  when decided). Partial unique index `stream_rounds_one_active` on `stream_id WHERE status IN
  ('open', 'locked')`: one undecided round per stream. A one-sided round keeps its declared
  status (`win` or `lose`) and is refunded; the audit row says `refunded`.
- `stream_bets`: one row per person per round, primary key `(round_id, user_id)`; `side` (`win`
  or `lose`) and `amount` (> 0, the whole stake: a second bet adds to it). The money is in the
  ledger: `stream_bet` rows (`ref_type = 'stream_round'`, `ref_id` = round id), paid back as
  `stream_payout` or `stream_refund` under the same reference, keyed
  `stream_round:{id}:payout|refund` in each bettor's account so a round pays a person at most once.
- `stream_round_audit`: one row per round that ended, written in the transaction that settled or
  voided it (decision D3-2): `round_id` (primary key), `stream_id`, `guild_id`, `streamer_id`,
  `label`, `opened_at`, `locked_at`, `ended_at`, `outcome` (`win`, `lose`, `void`), `cause`
  (`streamer`, `owner`, `stream_end`, `timeout`), `actor_id` (null for timers), `reason` (the
  owner's, 1 to 200), `bettors`, `win_total`, `lose_total`, `rake` (Teiai's deduction plus the
  rounding dust, 0 when refunded), `refunded` (0/1), `top` (JSON, up to 10 `{userId, amount}`,
  largest first; empty when refunded). Owner-only, kept for the life of the database.

Super chats have no table of their own: they are `transfer_out` / `transfer_fee` / `transfer_in`
ledger rows with `ref_type = 'stream'` and `ref_id` = stream id. The tip message is not stored.
The importer does not carry any of these tables (the original bot had no stream panel at the
import point).

| Shared feed (no `guild_id`, no money) | Migration |
| --- | --- |
| `market_prices` (`price_micros`), `market_fair`, `market_events`, `earnings` | `0007_finance` |
| `quiz_questions` (`guild_id` is `NULL` for the official quiz and set for a server's own questions) | `0008_games_progression` |

## Legacy table mapping

Source: the original bot's `data/casino.db`. The importer (`apps/server/scripts/import-legacy.ts`,
logic in `apps/server/src/db/legacy-import.ts`) runs with the original bot stopped and does a dry
run unless `--apply` is given.

In v1.0.0 the importer carries the wallet tables only:

| Legacy table | New table(s) | Notes |
| --- | --- | --- |
| `users` | `users`, ledger `legacy_import` | `balance` becomes one `legacy_import` ledger row per member. |
| `guild_users` | `guild_members` | Also creates `users` rows. |
| `guild_status` | `guilds` | `status`, `name`, `decided_by`, `updated_at`, `notified_at`. |
| `escrow` | ledger `game_refund` | Stakes of unfinished games are refunded right after the opening row. |
| `ledger` | `legacy_ledger` | Copied as read-only history. Not replayed into `ledger`: the opening `legacy_import` row is the new chain's start. |

Every other legacy table (stats, streaks, profiles, inventory, horses, arena, labor, market,
finance, quizzes, polls, raffles and message pointers) is not imported: those features start
fresh on the remaster. Legacy money held in them (open bets, bids, work pots, deposits, margin)
should be settled in the original bot before the import.

### Value conversions

- Ids: legacy `INTEGER` ids are read with `safeIntegers(true)` (BigInt) and written as decimal
  strings. Never go through a JS number.
- Time: legacy `REAL` epoch seconds become `Math.round(ts * 1000)` ms.
- Money: legacy `INTEGER` Pelica is copied as is.
- Negative legacy balances, if any, stop the import with a report.

### Proof that no Pelica moved

The importer prints, per guild and per user, the expected and the imported balance and exits
non-zero on any difference. For each player, the new balance equals `users.balance` plus refunded
`escrow`. A second run on the same file is a no-op (`legacy_import_runs` keeps the source digest).
