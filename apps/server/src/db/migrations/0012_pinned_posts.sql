-- 0012_pinned_posts: the polls, kyosai motions and raffles whose post the bot has pinned.
-- A row means "this message is pinned and must be unpinned once the thing is no longer open";
-- the sweep job (notify/post-pins.ts) deletes the row after it has unpinned. No foreign key:
-- the three source tables differ, and a source row that is gone counts as closed.

CREATE TABLE pinned_posts (
  kind       TEXT    NOT NULL CHECK (kind IN ('poll', 'motion', 'raffle')),
  ref_id     INTEGER NOT NULL,
  guild_id   TEXT    NOT NULL,
  channel_id TEXT    NOT NULL,
  message_id TEXT    NOT NULL,
  pinned_at  INTEGER NOT NULL,
  -- Unpin attempts that failed with an unexpected error; the row is dropped after a few.
  tries      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, ref_id)
) STRICT;
