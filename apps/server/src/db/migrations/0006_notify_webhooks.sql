-- 0006_notify_webhooks: per-guild webhook personas toggle and cached Discord webhook credentials.
-- See docs/DB_SCHEMA.md (guild_webhooks, guild_config).

ALTER TABLE guild_config
  ADD COLUMN personas_enabled INTEGER NOT NULL DEFAULT 0 CHECK (personas_enabled IN (0, 1));

CREATE TABLE guild_webhooks (
  guild_id   TEXT NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
  persona    TEXT NOT NULL CHECK (persona IN ('race_caller', 'market_news', 'teiai_bank')),
  channel_id TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  token      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, persona, channel_id)
) STRICT;

CREATE INDEX guild_webhooks_guild ON guild_webhooks (guild_id);
