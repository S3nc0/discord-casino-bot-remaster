-- 0005_casino: tables of the casino games (chinchiro, slots, blackjack, roulette, pachinko).
-- Money itself moves only through the ledger; these tables hold the open rounds (escrow
-- bookkeeping), the shared jackpot pool, the per-guild RTP levels and pachinko statistics.
-- See docs/DB_SCHEMA.md and docs/spec/casino-common.md.

-- One row per player round. `stake` is the escrow held for it (a blackjack double raises it).
-- An 'open' row at start-up means the process died mid-round: the stake is refunded.
CREATE TABLE game_rounds (
  round_id    TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  game        TEXT NOT NULL
              CHECK (game IN ('chinchiro', 'pachinko', 'slots', 'blackjack', 'roulette')),
  stake       INTEGER NOT NULL CHECK (stake > 0),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'refunded')),
  payout      INTEGER CHECK (payout IS NULL OR payout >= 0),   -- total credited when settled
  net         INTEGER,                                         -- payout - stake - penalty
  instance_id TEXT,                                            -- Activity instance, NULL in chat
  table_round TEXT,                                            -- shared table round it belongs to
  detail      TEXT CHECK (detail IS NULL OR json_valid(detail)),
  created_at  INTEGER NOT NULL,
  settled_at  INTEGER,
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE INDEX game_rounds_open ON game_rounds (status) WHERE status = 'open';
CREATE INDEX game_rounds_player ON game_rounds (guild_id, user_id, created_at);

-- Shared jackpot per guild: 5 % of every loss goes in, a hit takes the whole pool.
CREATE TABLE jackpots (
  guild_id   TEXT PRIMARY KEY REFERENCES guilds (guild_id),
  pool       INTEGER NOT NULL DEFAULT 0 CHECK (pool >= 0),
  updated_at INTEGER NOT NULL
) STRICT;

-- RTP level 1..6 per guild and game. Level 3 is the default and has no row.
CREATE TABLE rtp_levels (
  guild_id   TEXT NOT NULL REFERENCES guilds (guild_id),
  game       TEXT NOT NULL
             CHECK (game IN ('chinchiro', 'pachinko', 'slots', 'blackjack', 'roulette')),
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6 AND level <> 3),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, game)
) STRICT;

-- Pachinko statistics (admin view): every set and every start-pocket spin.
CREATE TABLE pachinko_sets (
  round_id   TEXT NOT NULL REFERENCES game_rounds (round_id),
  set_index  INTEGER NOT NULL,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  starts     INTEGER NOT NULL CHECK (starts BETWEEN 0 AND 100),
  raw        INTEGER NOT NULL CHECK (raw >= 0),                -- sum of round multipliers
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, set_index)
) STRICT;

CREATE INDEX pachinko_sets_guild ON pachinko_sets (guild_id, created_at);

CREATE TABLE pachinko_spins (
  round_id   TEXT NOT NULL,
  set_index  INTEGER NOT NULL,
  spin_index INTEGER NOT NULL,
  omen       TEXT NOT NULL CHECK (omen IN ('', 'blue', 'red', 'gold')),
  tier       TEXT NOT NULL CHECK (tier IN ('', 'normal', 'super', 'premium')),
  hit        INTEGER NOT NULL CHECK (hit IN (0, 1)),
  rounds     TEXT NOT NULL CHECK (json_valid(rounds)),         -- e.g. [2,10]
  PRIMARY KEY (round_id, set_index, spin_index),
  FOREIGN KEY (round_id, set_index) REFERENCES pachinko_sets (round_id, set_index)
) STRICT;
