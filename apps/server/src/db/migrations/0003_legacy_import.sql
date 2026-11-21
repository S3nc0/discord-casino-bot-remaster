-- 0003_legacy_import: bookkeeping for apps/server/scripts/import-legacy.ts.

-- Read-only copy of the Python bot's ledger. Never replayed into `ledger`: the opening
-- `legacy_import` row is the start of the new chain.
CREATE TABLE legacy_ledger (
  legacy_id     TEXT NOT NULL,
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  PRIMARY KEY (guild_id, legacy_id)
) STRICT;

CREATE INDEX legacy_ledger_member ON legacy_ledger (guild_id, user_id, ts);

-- One row per applied import. `source_digest` identifies the legacy data, so a second run on
-- the same data is a no-op.
CREATE TABLE legacy_import_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_digest TEXT NOT NULL UNIQUE,
  source_path   TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER NOT NULL,
  totals        TEXT NOT NULL CHECK (json_valid(totals))
) STRICT;
