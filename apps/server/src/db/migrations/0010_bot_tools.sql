-- Chat-bot owner tools (docs/spec/admin.md, docs/spec/economy-core.md §4, docs/spec/casino-common.md).
-- One live ranking post per guild (`/pelica leaderboard`): the bot rewrites this message on a timer.
CREATE TABLE leaderboards (
  guild_id   TEXT PRIMARY KEY REFERENCES guilds (guild_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  updated_at INTEGER NOT NULL
) STRICT;

-- The owner's manual special event (`/admin event start`): at most one per guild, replaced by the next.
CREATE TABLE casino_events (
  guild_id   TEXT PRIMARY KEY REFERENCES guilds (guild_id) ON DELETE CASCADE,
  game       TEXT NOT NULL
             CHECK (game IN ('chinchiro', 'pachinko', 'slots', 'blackjack', 'roulette')),
  boost_pct  INTEGER NOT NULL CHECK (boost_pct BETWEEN 1 AND 300),
  starts_at  INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL CHECK (ends_at > starts_at),
  channel_id TEXT
) STRICT;
