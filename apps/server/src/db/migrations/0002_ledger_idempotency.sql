-- 0002_ledger_idempotency: one ledger row per (guild, user, idempotency key).
-- EconomyService looks a key up before it posts; this index is the database-level backstop, so
-- two writers racing on the same key cannot both post.
CREATE UNIQUE INDEX ledger_idempotency
  ON ledger (guild_id, user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
