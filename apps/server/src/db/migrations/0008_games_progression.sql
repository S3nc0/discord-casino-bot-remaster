-- 0008_games_progression: horse racing, arena, labor, quiz, lottery, polls, shop and the
-- progression tables (daily, missions, weekly ranking, play state). All per guild unless noted.
-- Money never lives here: held stakes are ledger rows (race_bet, arena_bet, lottery_entry, ...).

-- ---------------------------------------------------------------- progression
CREATE TABLE play_state (
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  win_streak     INTEGER NOT NULL DEFAULT 0,
  best_streak    INTEGER NOT NULL DEFAULT 0,
  day_streak     INTEGER NOT NULL DEFAULT 0,
  streak_day     TEXT,
  plays          INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  net_total      INTEGER NOT NULL DEFAULT 0,
  games_played   INTEGER NOT NULL DEFAULT 0,
  total_wagered  INTEGER NOT NULL DEFAULT 0,
  total_won      INTEGER NOT NULL DEFAULT 0,
  biggest_win    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TABLE missions (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  progress   INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  PRIMARY KEY (guild_id, user_id, day, mission_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TABLE weekly_stats (
  guild_id TEXT NOT NULL,
  week     TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  net      INTEGER NOT NULL DEFAULT 0,
  plays    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, week, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TABLE weekly_champions (
  guild_id TEXT NOT NULL,
  week     TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  net      INTEGER NOT NULL,
  PRIMARY KEY (guild_id, week)
) STRICT;

CREATE TABLE weekly_state (
  guild_id  TEXT PRIMARY KEY,
  last_week TEXT NOT NULL
) STRICT;

CREATE TABLE daily_claims (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  streak     INTEGER NOT NULL DEFAULT 0,
  last_day   INTEGER,                 -- local day number of the last claim
  last_slot  INTEGER,
  ready_slot INTEGER,                 -- last slot a DailyReady event was sent for
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

-- ---------------------------------------------------------------- shop and items
CREATE TABLE inventory (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  item_id  TEXT NOT NULL,
  qty      INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (guild_id, user_id, item_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TABLE profiles (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  title       TEXT,
  card_color  TEXT,
  card_icon   TEXT,
  skin_dice   TEXT,
  skin_table  TEXT,
  daily_boost INTEGER NOT NULL DEFAULT 0,
  insurance   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TABLE shop_stock (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  stock_milli INTEGER NOT NULL,       -- units * 1000, so refills stay integer
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, item_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TABLE seized_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL REFERENCES guilds (guild_id),
  item_id   TEXT NOT NULL,           -- 'horse_voucher' for seized horses
  qty       INTEGER NOT NULL CHECK (qty >= 0),
  listed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE teiai_market_days (
  guild_id TEXT NOT NULL,
  day      INTEGER NOT NULL,         -- UTC day number
  PRIMARY KEY (guild_id, day)
) STRICT;

CREATE TABLE teiai_market (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL REFERENCES guilds (guild_id),
  item_id    TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('auction', 'fixed')),
  black      INTEGER NOT NULL CHECK (black IN (0, 1)),
  qty        INTEGER NOT NULL CHECK (qty >= 0),
  start_price INTEGER NOT NULL,
  end_price  INTEGER NOT NULL,
  listed_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

-- ---------------------------------------------------------------- horses and races
CREATE TABLE horses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL REFERENCES guilds (guild_id),
  owner_id   TEXT,                   -- NULL: retired
  name       TEXT NOT NULL,
  coat       TEXT NOT NULL,
  silks      TEXT NOT NULL,
  speed      INTEGER NOT NULL,
  stamina    INTEGER NOT NULL,
  power      INTEGER NOT NULL,
  guts       INTEGER NOT NULL,
  style      TEXT,                   -- NULL: automatic
  bonus      INTEGER NOT NULL DEFAULT 0,
  races      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  places     INTEGER NOT NULL DEFAULT 0,
  retired_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX horses_owner ON horses (guild_id, owner_id);

CREATE TABLE horse_races (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL REFERENCES guilds (guild_id),
  kind        TEXT NOT NULL CHECK (kind IN ('regular', 'special')),
  status      TEXT NOT NULL CHECK (status IN ('entry', 'betting', 'done')),
  major       INTEGER NOT NULL CHECK (major IN (0, 1)),
  start_at    INTEGER NOT NULL,
  entry_open  INTEGER NOT NULL,
  entry_close INTEGER NOT NULL,
  bet_close   INTEGER NOT NULL,
  track       TEXT,                  -- JSON {distance, going}
  placings    TEXT,                  -- JSON lanes first to last
  timeline    TEXT,                  -- JSON frames for the Activity animation
  UNIQUE (guild_id, kind, start_at)
) STRICT;

CREATE TABLE horse_entries (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id  INTEGER NOT NULL REFERENCES horse_races (id),
  guild_id TEXT NOT NULL,
  horse_id INTEGER,                  -- NULL: NPC
  owner_id TEXT,
  name     TEXT NOT NULL,
  lane     INTEGER NOT NULL,         -- -1 until the entries close
  speed    INTEGER NOT NULL DEFAULT 50,
  stamina  INTEGER NOT NULL DEFAULT 50,
  power    INTEGER NOT NULL DEFAULT 50,
  guts     INTEGER NOT NULL DEFAULT 50,
  style    TEXT NOT NULL DEFAULT 'nige',
  form     INTEGER NOT NULL DEFAULT 0,
  races    INTEGER NOT NULL DEFAULT 0,
  wins     INTEGER NOT NULL DEFAULT 0,
  places   INTEGER NOT NULL DEFAULT 0,
  silks    TEXT NOT NULL DEFAULT '',
  coat     TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX horse_entries_race ON horse_entries (race_id);

CREATE TABLE horse_odds (
  race_id INTEGER NOT NULL REFERENCES horse_races (id),
  kind    TEXT NOT NULL,
  key     TEXT NOT NULL,
  odds_tenths INTEGER NOT NULL,
  PRIMARY KEY (race_id, kind, key)
) STRICT;

CREATE TABLE horse_bets (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id  INTEGER NOT NULL REFERENCES horse_races (id),
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,
  key      TEXT NOT NULL,
  stake    INTEGER NOT NULL CHECK (stake > 0),
  odds_tenths INTEGER NOT NULL,
  payout   INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;
CREATE INDEX horse_bets_race ON horse_bets (race_id);

-- ---------------------------------------------------------------- arena
CREATE TABLE arena_tournaments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guilds (guild_id),
  day      TEXT NOT NULL,
  format   TEXT NOT NULL CHECK (format IN ('duel', 'royale')),
  status   TEXT NOT NULL CHECK (status IN ('semi_betting', 'final_betting', 'done')),
  champion_id INTEGER,
  UNIQUE (guild_id, day, format)
) STRICT;

CREATE TABLE arena_fighters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES arena_tournaments (id),
  name          TEXT NOT NULL,
  base_power    INTEGER NOT NULL,
  group_no      INTEGER NOT NULL,
  stage         TEXT NOT NULL CHECK (stage IN ('semi', 'final', 'out')),
  result        TEXT CHECK (result IN ('won', 'lost')),
  bet_total     INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE arena_bets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES arena_tournaments (id),
  guild_id      TEXT NOT NULL,
  user_id       TEXT,                -- NULL: NPC spectator
  fighter_id    INTEGER NOT NULL REFERENCES arena_fighters (id),
  stage         TEXT NOT NULL CHECK (stage IN ('semi', 'final')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  payout        INTEGER
) STRICT;

-- ---------------------------------------------------------------- labor
CREATE TABLE work_state (
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  pick         INTEGER NOT NULL DEFAULT 0,
  glove        INTEGER NOT NULL DEFAULT 0,
  dorm         INTEGER NOT NULL DEFAULT 0,
  fatigue_milli INTEGER NOT NULL DEFAULT 0,   -- fatigue * 1000
  fatigue_at   INTEGER NOT NULL DEFAULT 0,
  last_click   INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  day          TEXT,
  day_clicks   INTEGER NOT NULL DEFAULT 0,
  day_earned   INTEGER NOT NULL DEFAULT 0,
  earned_total INTEGER NOT NULL DEFAULT 0,
  pot          INTEGER NOT NULL DEFAULT 0,    -- unclaimed Pelica (held)
  idle_at      INTEGER NOT NULL DEFAULT 0,
  ores         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ores)),
  relics       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(relics)),
  donated      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;

CREATE TABLE work_workers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('apprentice', 'miner', 'craftsman', 'foreman')),
  expires_at INTEGER NOT NULL,
  renew      INTEGER NOT NULL DEFAULT 1 CHECK (renew IN (0, 1)),
  FOREIGN KEY (guild_id, user_id) REFERENCES guild_members (guild_id, user_id)
) STRICT;
CREATE INDEX work_workers_owner ON work_workers (guild_id, user_id);

CREATE TABLE work_finds (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  at        INTEGER NOT NULL,
  worker    TEXT NOT NULL,
  item      TEXT NOT NULL,
  qty       INTEGER NOT NULL,
  collected INTEGER NOT NULL DEFAULT 0 CHECK (collected IN (0, 1))
) STRICT;

CREATE TABLE work_click_hours (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  hour     INTEGER NOT NULL,         -- epoch hour
  clicks   INTEGER NOT NULL,
  pay      INTEGER NOT NULL,
  gaps     INTEGER NOT NULL,
  sum_gap_ms  INTEGER NOT NULL,
  sum_gap2_ms INTEGER NOT NULL,      -- ms squared
  min_gap_ms  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, hour)
) STRICT;

-- ---------------------------------------------------------------- quiz (questions are global
-- for official quizzes, per guild for user quizzes), lottery, polls
CREATE TABLE quiz_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT,                  -- NULL: official quiz, global
  author_id   TEXT,                  -- NULL: official
  question    TEXT NOT NULL,
  choices     TEXT NOT NULL CHECK (json_valid(choices)),  -- shown order
  answer      INTEGER NOT NULL,      -- index into choices
  explanation TEXT NOT NULL DEFAULT '',
  reward      INTEGER NOT NULL CHECK (reward >= 1),
  expires_at  INTEGER,
  earned      INTEGER NOT NULL DEFAULT 0,
  settled     INTEGER NOT NULL DEFAULT 0 CHECK (settled IN (0, 1)),
  created_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE quiz_answers (
  quiz_id  INTEGER NOT NULL REFERENCES quiz_questions (id),
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  choice   INTEGER NOT NULL,
  correct  INTEGER NOT NULL CHECK (correct IN (0, 1)),
  counted  INTEGER NOT NULL CHECK (counted IN (0, 1)),
  at       INTEGER NOT NULL,
  PRIMARY KEY (quiz_id, guild_id, user_id)
) STRICT;

CREATE TABLE raffles (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL REFERENCES guilds (guild_id),
  host_id   TEXT NOT NULL,
  fee       INTEGER NOT NULL CHECK (fee >= 1),
  closes_at INTEGER NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
  winner_id TEXT,
  prize     INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE UNIQUE INDEX raffles_one_open ON raffles (guild_id) WHERE status = 'open';

CREATE TABLE raffle_entries (
  raffle_id INTEGER NOT NULL REFERENCES raffles (id),
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (raffle_id, user_id)
) STRICT;

CREATE TABLE polls (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL REFERENCES guilds (guild_id),
  creator_id TEXT NOT NULL,
  title     TEXT NOT NULL,
  closes_at INTEGER NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  adj_yes   INTEGER NOT NULL DEFAULT 0,
  adj_no    INTEGER NOT NULL DEFAULT 0,
  rigs      INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls (id),
  user_id TEXT NOT NULL,
  yes     INTEGER NOT NULL CHECK (yes IN (0, 1)),
  PRIMARY KEY (poll_id, user_id)
) STRICT;
