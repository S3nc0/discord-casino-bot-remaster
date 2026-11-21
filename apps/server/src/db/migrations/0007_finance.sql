-- Finance tables: Teiai Bank/Debt/CDS, P2P Loans, Kyosai, Securities (Stocks/Crypto/Options/Bonds),
-- Companies, and Player Market. Every table is STRICT with zero REAL columns; money is integer Pelica
-- or micro-Pelica (* 1_000_000), quantities are milli-units (* 1_000), rates are basis points (* 10_000)
-- or nano-rates (* 1_000_000_000), timestamps are UTC epoch milliseconds, and Discord IDs are TEXT.

-- ---------------------------------------------------------------------------
-- 1. Teiai Bank, Trust Deposits, Toichi Debt, Reserve & Thermostat, House, CDS
-- ---------------------------------------------------------------------------

CREATE TABLE bank_accounts (
  guild_id         TEXT    NOT NULL,
  user_id          TEXT    NOT NULL,
  debt             INTEGER NOT NULL DEFAULT 0 CHECK (debt >= 0),
  debt_interest_at INTEGER NOT NULL DEFAULT 0,
  bankrupt_at      INTEGER,
  grace_until      INTEGER,
  blacklist_until  INTEGER,
  escape_tries     INTEGER NOT NULL DEFAULT 0 CHECK (escape_tries >= 0),
  last_escape_at   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
) STRICT;

CREATE INDEX idx_bank_accounts_grace
  ON bank_accounts (guild_id, grace_until)
  WHERE grace_until IS NOT NULL;

CREATE TABLE bank_reserve (
  guild_id              TEXT    PRIMARY KEY,
  cash_micros           INTEGER NOT NULL DEFAULT 0,
  loaned_micros         INTEGER NOT NULL DEFAULT 0,
  recovery_at           INTEGER NOT NULL DEFAULT 0,
  trust_at              INTEGER NOT NULL DEFAULT 0,
  trust_accrued_micros  INTEGER NOT NULL DEFAULT 0,
  trust_paid_micros     INTEGER NOT NULL DEFAULT 0,
  trust_premium_nano    INTEGER NOT NULL DEFAULT 1000000,
  risk_free_nano        INTEGER NOT NULL DEFAULT 13073571,
  risk_free_at          INTEGER NOT NULL DEFAULT 0,
  excess_unpaid_micros  INTEGER NOT NULL DEFAULT 0,
  kyosai_div_at         INTEGER NOT NULL DEFAULT 0,
  thermo_load_micros    INTEGER NOT NULL DEFAULT 0,
  thermo_cap_micros     INTEGER NOT NULL DEFAULT 20000000000,
  thermo_at             INTEGER NOT NULL DEFAULT 0,
  thermo_burned_micros  INTEGER NOT NULL DEFAULT 0,
  thermo_bailed_micros  INTEGER NOT NULL DEFAULT 0,
  thermo_enforce        INTEGER NOT NULL DEFAULT 0 CHECK (thermo_enforce IN (0, 1))
) STRICT;

CREATE TABLE house_account (
  guild_id   TEXT    PRIMARY KEY,
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  skimmed    INTEGER NOT NULL DEFAULT 0 CHECK (skimmed >= 0),
  grant_day  TEXT    NOT NULL DEFAULT '',
  grant_used INTEGER NOT NULL DEFAULT 0 CHECK (grant_used >= 0),
  updated_at INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE bank_deposits (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
) STRICT;

CREATE TABLE cds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  buyer_id    TEXT    NOT NULL,
  target_id   TEXT    NOT NULL,
  stake       INTEGER NOT NULL CHECK (stake > 0),
  odds_tenths INTEGER NOT NULL CHECK (odds_tenths > 0),
  status      TEXT    NOT NULL CHECK (status IN ('open', 'paid', 'expired', 'void')),
  payout      INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  settled_at  INTEGER
) STRICT;

CREATE INDEX idx_cds_guild_target_status ON cds (guild_id, target_id, status);
CREATE INDEX idx_cds_status_expires ON cds (status, expires_at);

-- ---------------------------------------------------------------------------
-- 2. P2P Loans
-- ---------------------------------------------------------------------------

CREATE TABLE loans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT    NOT NULL,
  lender_id        TEXT    NOT NULL,
  borrower_id      TEXT    NOT NULL,
  principal        INTEGER NOT NULL CHECK (principal > 0),
  rate_bps         INTEGER NOT NULL CHECK (rate_bps >= 0),
  term_days        INTEGER NOT NULL CHECK (term_days > 0),
  status           TEXT    NOT NULL CHECK (
    status IN ('offer', 'request', 'active', 'overdue', 'repaid', 'discharged', 'declined', 'cancelled', 'expired')
  ),
  paid             INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  reminded         INTEGER NOT NULL DEFAULT 0 CHECK (reminded IN (0, 1)),
  channel_id       TEXT,
  message_id       TEXT,
  created_at       INTEGER NOT NULL,
  offer_expires_at INTEGER NOT NULL,
  accepted_at      INTEGER,
  due_at           INTEGER
) STRICT;

CREATE INDEX idx_loans_guild_status_due ON loans (guild_id, status, due_at);
CREATE INDEX idx_loans_guild_borrower_status ON loans (guild_id, borrower_id, status);

-- ---------------------------------------------------------------------------
-- 3. Teiai Kyosai (Mutual Aid)
-- ---------------------------------------------------------------------------

CREATE TABLE kyosai_units (
  guild_id   TEXT    NOT NULL,
  holder_key TEXT    NOT NULL,
  user_id    TEXT,
  is_house   INTEGER NOT NULL DEFAULT 0 CHECK (is_house IN (0, 1)),
  units      INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  PRIMARY KEY (guild_id, holder_key)
) STRICT;

CREATE INDEX idx_kyosai_units_guild_user ON kyosai_units (guild_id, user_id);

CREATE TABLE kyosai_auctions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  units         INTEGER NOT NULL CHECK (units > 0),
  status        TEXT    NOT NULL CHECK (status IN ('open', 'sold', 'unsold')),
  top_bid       INTEGER NOT NULL DEFAULT 0 CHECK (top_bid >= 0),
  top_bidder_id TEXT,
  ends_at       INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_kyosai_auctions_guild_status ON kyosai_auctions (guild_id, status, ends_at);

CREATE TABLE kyosai_offers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  seller_id  TEXT    NOT NULL,
  buyer_id   TEXT    NOT NULL,
  units      INTEGER NOT NULL CHECK (units > 0),
  price      INTEGER NOT NULL CHECK (price >= 0),
  fee        INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  status     TEXT    NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  done_at    INTEGER
) STRICT;

CREATE INDEX idx_kyosai_offers_guild_status ON kyosai_offers (guild_id, status, done_at);

CREATE TABLE kyosai_motions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id              TEXT    NOT NULL,
  proposer_id           TEXT    NOT NULL,
  proposed_premium_nano INTEGER NOT NULL CHECK (proposed_premium_nano > 0),
  status                TEXT    NOT NULL CHECK (status IN ('open', 'passed', 'rejected')),
  yes_units             INTEGER NOT NULL DEFAULT 0 CHECK (yes_units >= 0),
  no_units              INTEGER NOT NULL DEFAULT 0 CHECK (no_units >= 0),
  circulating_units     INTEGER NOT NULL DEFAULT 0 CHECK (circulating_units >= 0),
  channel_id            TEXT,
  message_id            TEXT,
  created_at            INTEGER NOT NULL,
  closes_at             INTEGER NOT NULL,
  closed_at             INTEGER
) STRICT;

CREATE INDEX idx_kyosai_motions_guild_status ON kyosai_motions (guild_id, status, closes_at);

CREATE TABLE kyosai_votes (
  motion_id INTEGER NOT NULL REFERENCES kyosai_motions(id) ON DELETE CASCADE,
  user_id   TEXT    NOT NULL,
  vote      INTEGER NOT NULL CHECK (vote IN (0, 1)),
  voted_at  INTEGER NOT NULL,
  PRIMARY KEY (motion_id, user_id)
) STRICT;

-- ---------------------------------------------------------------------------
-- 4. Securities: Global Market Feed + Per-Guild Positions, Options, Bonds, Earnings
-- ---------------------------------------------------------------------------

CREATE TABLE market_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol       TEXT    NOT NULL,
  price_micros INTEGER NOT NULL CHECK (price_micros > 0),
  shock        INTEGER NOT NULL DEFAULT 0 CHECK (shock IN (-1, 0, 1)),
  recorded_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_market_prices_symbol_at ON market_prices (symbol, recorded_at DESC, id DESC);

CREATE TABLE market_fair (
  symbol      TEXT    PRIMARY KEY,
  fair_micros INTEGER NOT NULL CHECK (fair_micros > 0),
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE market_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT    NOT NULL,
  factor_bps  INTEGER NOT NULL CHECK (factor_bps > 0),
  announce_at INTEGER NOT NULL,
  start_at    INTEGER NOT NULL,
  end_at      INTEGER NOT NULL,
  announced   INTEGER NOT NULL DEFAULT 0 CHECK (announced IN (0, 1))
) STRICT;

CREATE INDEX idx_market_events_end ON market_events (end_at);

CREATE TABLE earnings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT    NOT NULL,
  direction   INTEGER NOT NULL CHECK (direction IN (-1, 1)),
  size_bps    INTEGER NOT NULL CHECK (size_bps > 0),
  announce_at INTEGER NOT NULL,
  release_at  INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('planned', 'announced', 'released'))
) STRICT;

CREATE INDEX idx_earnings_status_release ON earnings (status, release_at);

CREATE TABLE positions_spot (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  symbol      TEXT    NOT NULL,
  units_milli INTEGER NOT NULL DEFAULT 0 CHECK (units_milli >= 0),
  cost        INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
  PRIMARY KEY (guild_id, user_id, symbol)
) STRICT;

CREATE TABLE positions_long (
  guild_id                TEXT    NOT NULL,
  user_id                 TEXT    NOT NULL,
  symbol                  TEXT    NOT NULL,
  units_milli             INTEGER NOT NULL DEFAULT 0 CHECK (units_milli >= 0),
  entry_value_micros      INTEGER NOT NULL DEFAULT 0 CHECK (entry_value_micros >= 0),
  margin                  INTEGER NOT NULL DEFAULT 0 CHECK (margin >= 0),
  opened_at               INTEGER NOT NULL,
  interest_at             INTEGER NOT NULL,
  interest_accrued_micros INTEGER NOT NULL DEFAULT 0 CHECK (interest_accrued_micros >= 0),
  PRIMARY KEY (guild_id, user_id, symbol)
) STRICT;

CREATE TABLE positions_short (
  guild_id                TEXT    NOT NULL,
  user_id                 TEXT    NOT NULL,
  symbol                  TEXT    NOT NULL,
  units_milli             INTEGER NOT NULL DEFAULT 0 CHECK (units_milli >= 0),
  entry_value_micros      INTEGER NOT NULL DEFAULT 0 CHECK (entry_value_micros >= 0),
  margin                  INTEGER NOT NULL DEFAULT 0 CHECK (margin >= 0),
  opened_at               INTEGER NOT NULL,
  interest_at             INTEGER NOT NULL,
  interest_accrued_micros INTEGER NOT NULL DEFAULT 0 CHECK (interest_accrued_micros >= 0),
  PRIMARY KEY (guild_id, user_id, symbol)
) STRICT;

CREATE TABLE options (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  user_id        TEXT    NOT NULL,
  side           TEXT    NOT NULL DEFAULT 'long' CHECK (side IN ('long', 'short')),
  kind           TEXT    NOT NULL CHECK (kind IN ('call', 'put', 'pair')),
  symbol         TEXT    NOT NULL,
  symbol_b       TEXT,
  strike_micros  INTEGER NOT NULL DEFAULT 0 CHECK (strike_micros >= 0),
  units_milli    INTEGER NOT NULL DEFAULT 0 CHECK (units_milli >= 0),
  notional       INTEGER NOT NULL DEFAULT 0 CHECK (notional >= 0),
  entry_a_micros INTEGER NOT NULL DEFAULT 0 CHECK (entry_a_micros >= 0),
  entry_b_micros INTEGER NOT NULL DEFAULT 0 CHECK (entry_b_micros >= 0),
  premium        INTEGER NOT NULL DEFAULT 0 CHECK (premium >= 0),
  margin         INTEGER NOT NULL DEFAULT 0 CHECK (margin >= 0),
  payout         INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
  status         TEXT    NOT NULL CHECK (status IN ('open', 'settled', 'sold', 'bought_back')),
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  settled_at     INTEGER
) STRICT;

CREATE INDEX idx_options_guild_status_expires ON options (guild_id, status, expires_at);
CREATE INDEX idx_options_guild_user_status ON options (guild_id, user_id, status);

CREATE TABLE bonds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('normal', 'junk')),
  principal  INTEGER NOT NULL CHECK (principal > 0),
  rate_bps   INTEGER NOT NULL CHECK (rate_bps >= 0),
  status     TEXT    NOT NULL CHECK (status IN ('active', 'matured', 'defaulted', 'sold')),
  payout     INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
  created_at INTEGER NOT NULL,
  due_at     INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  settled_at INTEGER
) STRICT;

CREATE INDEX idx_bonds_guild_status_due ON bonds (guild_id, status, due_at);
CREATE INDEX idx_bonds_guild_user_status ON bonds (guild_id, user_id, status);

CREATE TABLE earnings_memos (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  earnings_id INTEGER NOT NULL,
  symbol      TEXT    NOT NULL,
  hint        INTEGER NOT NULL CHECK (hint IN (-1, 1)),
  truth_bps   INTEGER NOT NULL CHECK (truth_bps BETWEEN 0 AND 10000),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, earnings_id)
) STRICT;

CREATE TABLE earnings_shop (
  guild_id    TEXT    NOT NULL,
  earnings_id INTEGER NOT NULL,
  sold        INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
  PRIMARY KEY (guild_id, earnings_id)
) STRICT;

-- ---------------------------------------------------------------------------
-- 5. Companies
-- ---------------------------------------------------------------------------

CREATE TABLE companies (
  guild_id          TEXT    NOT NULL,
  user_id           TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  kind              TEXT    NOT NULL CHECK (kind IN ('farm', 'mine', 'factory')),
  level             INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  funds             INTEGER NOT NULL DEFAULT 0 CHECK (funds >= 0),
  stock_milli       INTEGER NOT NULL DEFAULT 0 CHECK (stock_milli >= 0),
  stock_at          INTEGER NOT NULL,
  dividend_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (dividend_rate_bps BETWEEN 0 AND 10000),
  unpaid_days       INTEGER NOT NULL DEFAULT 0 CHECK (unpaid_days >= 0),
  upkeep_day        TEXT    NOT NULL,
  sold_total        INTEGER NOT NULL DEFAULT 0 CHECK (sold_total >= 0),
  created_at        INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
) STRICT;

CREATE TABLE company_stakes (
  guild_id    TEXT    NOT NULL,
  owner_id    TEXT    NOT NULL,
  investor_id TEXT    NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, owner_id, investor_id)
) STRICT;

CREATE INDEX idx_company_stakes_investor ON company_stakes (guild_id, investor_id);

-- ---------------------------------------------------------------------------
-- 6. Player Market
-- ---------------------------------------------------------------------------

CREATE TABLE marketplace_listings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  seller_id  TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('item', 'horse')),
  ref        TEXT    NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  mode       TEXT    NOT NULL CHECK (mode IN ('fixed', 'auction')),
  price      INTEGER NOT NULL CHECK (price > 0),
  bid        INTEGER NOT NULL DEFAULT 0 CHECK (bid >= 0),
  bidder_id  TEXT,
  buyer_id   TEXT,
  sold_price INTEGER NOT NULL DEFAULT 0 CHECK (sold_price >= 0),
  fee        INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  status     TEXT    NOT NULL CHECK (status IN ('active', 'sold', 'expired', 'cancelled')),
  channel_id TEXT,
  message_id TEXT,
  created_at INTEGER NOT NULL,
  end_at     INTEGER NOT NULL,
  closed_at  INTEGER
) STRICT;

CREATE INDEX idx_marketplace_guild_status_end ON marketplace_listings (guild_id, status, end_at);
CREATE INDEX idx_marketplace_guild_seller ON marketplace_listings (guild_id, seller_id, status);
CREATE INDEX idx_marketplace_guild_bidder ON marketplace_listings (guild_id, bidder_id, status);
