-- 0001_init: core tables shared by every feature.
-- Conventions: Discord ids are TEXT snowflakes; Pelica amounts are INTEGER; times are INTEGER
-- epoch milliseconds (UTC); booleans are INTEGER 0/1; JSON is TEXT checked with json_valid.
-- Connection pragmas (WAL, synchronous=NORMAL, busy_timeout, foreign_keys, recursive_triggers)
-- are set by the connection code (src/db/pragmas.ts), not here. See docs/DB_SCHEMA.md.
-- Balances are never negative (CHECK below). Debt lives in its own tables, as in the original.

-- ---------------------------------------------------------------- identities

CREATE TABLE users (
  user_id     TEXT PRIMARY KEY,
  username    TEXT NOT NULL DEFAULT '',
  global_name TEXT,
  avatar      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE guilds (
  guild_id    TEXT PRIMARY KEY,
  name        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'denied')),
  decided_by  TEXT,
  decided_at  INTEGER,
  notified_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

-- Per-guild settings. One row per guild, created together with the guild row.
CREATE TABLE guild_config (
  guild_id            TEXT PRIMARY KEY REFERENCES guilds (guild_id) ON DELETE CASCADE,
  locale              TEXT CHECK (locale IN ('en', 'ja')),        -- NULL: use Discord's preferred locale
  announce_channel_id TEXT,                                       -- NULL: fall back to ANNOUNCE_CHANNEL_ID
  announce_enabled    INTEGER NOT NULL DEFAULT 1 CHECK (announce_enabled IN (0, 1)),
  big_win_threshold   INTEGER NOT NULL DEFAULT 100000 CHECK (big_win_threshold >= 0),
  announce_per_minute INTEGER NOT NULL DEFAULT 6 CHECK (announce_per_minute BETWEEN 1 AND 60),
  updated_at          INTEGER NOT NULL
) STRICT;

-- Which domain event types this guild announces (missing row = default from code).
CREATE TABLE guild_announce_types (
  guild_id   TEXT NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  enabled    INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  channel_id TEXT,                                                -- NULL: guild announce channel
  PRIMARY KEY (guild_id, event_type)
) STRICT;

-- Features an owner switched off (row present = off).
CREATE TABLE guild_features_off (
  guild_id TEXT NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  feature  TEXT NOT NULL,
  PRIMARY KEY (guild_id, feature)
) STRICT;

-- A player's account in one guild. Every per-guild table references this.
CREATE TABLE guild_members (
  guild_id   TEXT NOT NULL REFERENCES guilds (guild_id),
  user_id    TEXT NOT NULL REFERENCES users (user_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
) STRICT;

CREATE INDEX guild_members_user ON guild_members (user_id);

-- ---------------------------------------------------------------- money

-- Append-only. The only way to change a balance is to insert a row here.
CREATE TABLE ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  delta           INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  reason          TEXT NOT NULL,                                  -- LedgerReason in packages/shared
  ref_type        TEXT,                                           -- e.g. 'round', 'race', 'transfer'
  ref_id          TEXT,
  idempotency_key TEXT,
  meta            TEXT CHECK (meta IS NULL OR json_valid(meta)),
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE INDEX ledger_member ON ledger (guild_id, user_id, id);
CREATE INDEX ledger_ref ON ledger (ref_type, ref_id) WHERE ref_id IS NOT NULL;

-- Current balance per account. Maintained only by the ledger trigger below.
CREATE TABLE balances (
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  balance        INTEGER NOT NULL CHECK (balance >= 0),
  last_ledger_id INTEGER NOT NULL REFERENCES ledger (id),
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'ledger is append-only');
END;

CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'ledger is append-only');
END;

-- An explicit id may never collide with an existing row. Without this, INSERT OR REPLACE
-- (or an upsert) on ledger could overwrite history, because with recursive_triggers OFF the
-- implicit REPLACE delete does not fire ledger_no_delete.
CREATE TRIGGER ledger_no_reuse_id BEFORE INSERT ON ledger
WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM ledger WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'ledger is append-only');
END;

-- balance_after must equal the previous balance (0 for a new account) plus delta.
CREATE TRIGGER ledger_check_chain BEFORE INSERT ON ledger
WHEN NEW.balance_after IS NOT
     COALESCE((SELECT balance FROM balances
               WHERE guild_id = NEW.guild_id AND user_id = NEW.user_id), 0) + NEW.delta
BEGIN
  SELECT RAISE(ABORT, 'ledger balance_after does not match previous balance + delta');
END;

CREATE TRIGGER ledger_apply AFTER INSERT ON ledger
BEGIN
  INSERT INTO balances (guild_id, user_id, balance, last_ledger_id, updated_at)
  VALUES (NEW.guild_id, NEW.user_id, NEW.balance_after, NEW.id, NEW.created_at)
  ON CONFLICT (guild_id, user_id) DO UPDATE SET
    balance        = excluded.balance,
    last_ledger_id = excluded.last_ledger_id,
    updated_at     = excluded.updated_at;
END;

-- A balances row must always mirror the newest ledger row of its account. Checked on insert
-- too, so INSERT OR REPLACE with an older ledger row cannot roll a balance back.
CREATE TRIGGER balances_check_insert BEFORE INSERT ON balances
WHEN NEW.last_ledger_id IS NOT (SELECT MAX(id) FROM ledger
                                WHERE guild_id = NEW.guild_id AND user_id = NEW.user_id)
  OR NEW.balance IS NOT (SELECT balance_after FROM ledger
                         WHERE id = NEW.last_ledger_id
                           AND guild_id = NEW.guild_id AND user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'balances can only change through the ledger');
END;

CREATE TRIGGER balances_check_update BEFORE UPDATE ON balances
WHEN NEW.guild_id IS NOT OLD.guild_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.last_ledger_id IS NOT (SELECT MAX(id) FROM ledger
                                WHERE guild_id = NEW.guild_id AND user_id = NEW.user_id)
  OR NEW.balance IS NOT (SELECT balance_after FROM ledger WHERE id = NEW.last_ledger_id)
BEGIN
  SELECT RAISE(ABORT, 'balances can only change through the ledger');
END;

CREATE TRIGGER balances_no_delete BEFORE DELETE ON balances
BEGIN
  SELECT RAISE(ABORT, 'balances can only change through the ledger');
END;

-- One effect per (guild, user, key). The first response is stored and replayed on repeats.
CREATE TABLE idempotency_keys (
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  scope        TEXT NOT NULL,                                     -- e.g. 'game:bet:blackjack', 'transfer'
  request_hash TEXT NOT NULL,                                     -- same key + different body = conflict
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  response     TEXT CHECK (response IS NULL OR json_valid(response)),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, key)
) STRICT;

CREATE INDEX idempotency_keys_expiry ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------- launch from chat

CREATE TABLE launch_intents (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  screen      TEXT NOT NULL,                                      -- ScreenId in packages/shared
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  PRIMARY KEY (guild_id, user_id)                                 -- newest intent replaces the old one
) STRICT;

CREATE INDEX launch_intents_expiry ON launch_intents (expires_at);

-- ---------------------------------------------------------------- user settings and notifications

-- Global per user (not per guild).
CREATE TABLE user_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users (user_id),
  locale     TEXT CHECK (locale IN ('en', 'ja')),                -- NULL: auto-detect
  sound      INTEGER NOT NULL DEFAULT 1 CHECK (sound IN (0, 1)),
  volume     INTEGER NOT NULL DEFAULT 70 CHECK (volume BETWEEN 0 AND 100),
  motion     TEXT NOT NULL DEFAULT 'system' CHECK (motion IN ('system', 'full', 'reduced')),
  theme      TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  dm_digest  INTEGER NOT NULL DEFAULT 1 CHECK (dm_digest IN (0, 1)),
  updated_at INTEGER NOT NULL
) STRICT;

-- DMs are opt-in per kind; inbox entries are on unless switched off. Missing row = defaults.
CREATE TABLE notification_prefs (
  user_id    TEXT NOT NULL REFERENCES users (user_id),
  kind       TEXT NOT NULL,                                       -- NotificationKind in packages/shared
  dm         INTEGER NOT NULL DEFAULT 0 CHECK (dm IN (0, 1)),
  inbox      INTEGER NOT NULL DEFAULT 1 CHECK (inbox IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
) STRICT;

-- Outgoing DMs with retry. Digest batching groups pending rows per user.
CREATE TABLE notification_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  guild_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  payload         TEXT NOT NULL CHECK (json_valid(payload)),      -- the DomainEvent
  dedupe_key      TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dropped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER
) STRICT;

CREATE INDEX notification_queue_due ON notification_queue (status, next_attempt_at);
CREATE INDEX notification_queue_user ON notification_queue (user_id, status);

CREATE TABLE inbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL CHECK (json_valid(payload)),           -- the DomainEvent
  created_at INTEGER NOT NULL,
  read_at    INTEGER
) STRICT;

CREATE INDEX inbox_user ON inbox (user_id, guild_id, id DESC);
CREATE INDEX inbox_unread ON inbox (user_id, guild_id) WHERE read_at IS NULL;
