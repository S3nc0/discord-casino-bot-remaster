-- 0014_color_roles: name-colour roles (docs/spec/shop.md §2). The equipped colour is a profile
-- slot like the title; the bot keeps the ids of the roles it created and the colour role it put
-- on each member, and a pending row per member until Discord matches the database. Discord is
-- only ever called after the transaction that changed the colour has committed
-- (games/shop/color-roles.ts).

-- The equipped colour item (`role_red` ...), or NULL. Cleared when the last copy leaves.
ALTER TABLE profiles ADD COLUMN color_role TEXT;

-- The colour roles the bot created in a guild. The bot touches no role that is not listed here.
CREATE TABLE color_roles (
  guild_id   TEXT    NOT NULL,
  item_id    TEXT    NOT NULL,
  role_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, item_id),
  UNIQUE (guild_id, role_id)
) STRICT;

-- The colour role the bot last put on a member (one at a time), so a change knows what to take
-- off without reading the member list.
CREATE TABLE color_role_holders (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  role_id    TEXT    NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
) STRICT;

-- Members whose Discord roles must be brought in line with their equipped colour. Written in the
-- same transaction as the change; the 30 s sweep applies it and deletes the row.
CREATE TABLE color_role_sync (
  guild_id  TEXT    NOT NULL,
  user_id   TEXT    NOT NULL,
  queued_at INTEGER NOT NULL,
  -- The sweep skips the row until then (a missing permission is retried every 10 minutes).
  next_at   INTEGER NOT NULL,
  -- Failed attempts: a few for an unexpected error, a day of 10-minute retries for a missing
  -- permission; then the row is dropped (the member can equip again).
  tries     INTEGER NOT NULL DEFAULT 0,
  -- Bumped on every new change, so a sync that finished never deletes a newer request.
  seq       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, user_id)
) STRICT;

CREATE INDEX color_role_sync_next ON color_role_sync (next_at);
