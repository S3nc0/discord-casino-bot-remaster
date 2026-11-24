-- 0013_stream: the stream panel (docs/spec/stream.md §14). Streams with super chats and
-- win/lose rounds whose stakes are escrowed in the ledger (`stream_bet`) and paid back as
-- `stream_payout` / `stream_refund`. Millisecond timestamps, TEXT snowflakes. The bot never
-- creates a voice channel (decision D4): `voice_channel_id` is only the Activity's own channel.

CREATE TABLE streams (
  id               INTEGER PRIMARY KEY,
  guild_id         TEXT    NOT NULL,
  streamer_id      TEXT    NOT NULL,
  title            TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  url              TEXT    CHECK (url IS NULL OR length(url) <= 300),
  -- Text channel and message of the chat panel; null for a stream started in the Activity only.
  channel_id       TEXT,
  message_id       TEXT,
  -- Voice channel of the streamer's Activity instance (location), or null. Never bot-made.
  voice_channel_id TEXT,
  started_at       INTEGER NOT NULL,
  ends_at          INTEGER NOT NULL CHECK (ends_at > started_at),
  ended_at         INTEGER,
  tips             INTEGER NOT NULL DEFAULT 0 CHECK (tips >= 0),
  tip_count        INTEGER NOT NULL DEFAULT 0 CHECK (tip_count >= 0),
  status           TEXT    NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
  FOREIGN KEY (guild_id, streamer_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

-- One live panel per streamer per guild.
CREATE UNIQUE INDEX streams_one_live ON streams (guild_id, streamer_id) WHERE status = 'live';
-- The 1-minute close job: live streams of a guild by end time.
CREATE INDEX streams_live_due ON streams (guild_id, ends_at) WHERE status = 'live';

CREATE TABLE stream_rounds (
  id           INTEGER PRIMARY KEY,
  stream_id    INTEGER NOT NULL REFERENCES streams (id),
  guild_id     TEXT    NOT NULL,
  -- Empty means the default name (`screen.stream.round.default`), shown in the reader's language.
  label        TEXT    NOT NULL CHECK (length(label) <= 60),
  status       TEXT    NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'locked', 'win', 'lose', 'void')),
  created_at   INTEGER NOT NULL,
  -- Bets close by themselves at this time (created_at + 10 minutes, decision D3-1).
  auto_lock_at INTEGER NOT NULL CHECK (auto_lock_at >= created_at),
  locked_at    INTEGER,
  settled_at   INTEGER,
  CHECK ((status IN ('win', 'lose', 'void')) = (settled_at IS NOT NULL)),
  CHECK (status <> 'locked' OR locked_at IS NOT NULL)
) STRICT;

-- One undecided round per stream.
CREATE UNIQUE INDEX stream_rounds_one_active ON stream_rounds (stream_id)
  WHERE status IN ('open', 'locked');
-- The 1-minute lock job: open rounds of a guild by auto-lock time.
CREATE INDEX stream_rounds_open_due ON stream_rounds (guild_id, auto_lock_at) WHERE status = 'open';

-- One row per person per round: a second bet on the same side adds to the stake.
CREATE TABLE stream_bets (
  round_id INTEGER NOT NULL REFERENCES stream_rounds (id),
  guild_id TEXT    NOT NULL,
  user_id  TEXT    NOT NULL,
  side     TEXT    NOT NULL CHECK (side IN ('win', 'lose')),
  amount   INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (round_id, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

-- Owner audit log (decision D3-2): one row per round that ended, written in the same transaction
-- as the settle or void. Owner-only, kept for the life of the database.
CREATE TABLE stream_round_audit (
  round_id    INTEGER PRIMARY KEY REFERENCES stream_rounds (id),
  stream_id   INTEGER NOT NULL REFERENCES streams (id),
  guild_id    TEXT    NOT NULL,
  streamer_id TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  opened_at   INTEGER NOT NULL,
  locked_at   INTEGER,
  ended_at    INTEGER NOT NULL,
  outcome     TEXT    NOT NULL CHECK (outcome IN ('win', 'lose', 'void')),
  cause       TEXT    NOT NULL CHECK (cause IN ('streamer', 'owner', 'stream_end', 'timeout')),
  actor_id    TEXT,
  reason      TEXT    CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 200),
  bettors     INTEGER NOT NULL CHECK (bettors >= 0),
  win_total   INTEGER NOT NULL CHECK (win_total >= 0),
  lose_total  INTEGER NOT NULL CHECK (lose_total >= 0),
  -- Teiai's deduction plus the rounding dust; 0 when refunded.
  rake        INTEGER NOT NULL CHECK (rake >= 0),
  refunded    INTEGER NOT NULL CHECK (refunded IN (0, 1)),
  -- JSON array of {userId, amount}, largest first, at most 10.
  top         TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(top))
) STRICT;

CREATE INDEX stream_round_audit_guild ON stream_round_audit (guild_id, ended_at);
