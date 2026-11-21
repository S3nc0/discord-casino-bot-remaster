-- Horse breeding (docs/spec/horse-breeding.md §5). Existing horses keep the defaults: generation 0,
-- no parents, never bred, base value 30,000 (the voucher price).
ALTER TABLE horses ADD COLUMN parent_a_id INTEGER REFERENCES horses (id);
ALTER TABLE horses ADD COLUMN parent_b_id INTEGER REFERENCES horses (id);
ALTER TABLE horses ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE horses ADD COLUMN foaled_at INTEGER;
ALTER TABLE horses ADD COLUMN matures_at INTEGER;
ALTER TABLE horses ADD COLUMN last_bred_at INTEGER;
ALTER TABLE horses ADD COLUMN foal_count INTEGER NOT NULL DEFAULT 0 CHECK (foal_count BETWEEN 0 AND 2);
ALTER TABLE horses ADD COLUMN base_value INTEGER NOT NULL DEFAULT 30000;

-- One row per breeding: the audit trail, the ledger ref_id and the idempotency record.
CREATE TABLE horse_breedings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL REFERENCES guilds (guild_id),
  user_id         TEXT NOT NULL,
  parent_a_id     INTEGER NOT NULL REFERENCES horses (id),
  parent_b_id     INTEGER NOT NULL REFERENCES horses (id),
  foal_id         INTEGER NOT NULL UNIQUE REFERENCES horses (id),
  fee             INTEGER NOT NULL CHECK (fee > 0),
  idempotency_key TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (guild_id, user_id, idempotency_key)
) STRICT;
CREATE INDEX horse_breedings_user ON horse_breedings (guild_id, user_id);
