-- 0004_user_settings: reshape user_settings for UserSettings (packages/shared/src/settings.ts).
-- SQLite cannot change a CHECK in place, so the table is rebuilt: create, copy, drop, rename.
--   volume (0-100)  -> sfx_volume and music_volume; existing rows copy their old volume,
--                      new rows default to 30
--   theme           -> 'discord' | 'light' | 'dark'; old 'system' rows become 'discord'
-- locale, sound, motion, dm_digest and updated_at are unchanged. See docs/DB_SCHEMA.md.

CREATE TABLE user_settings_new (
  user_id      TEXT PRIMARY KEY REFERENCES users (user_id),
  locale       TEXT CHECK (locale IN ('en', 'ja')),                -- NULL: auto-detect
  sound        INTEGER NOT NULL DEFAULT 1 CHECK (sound IN (0, 1)),
  sfx_volume   INTEGER NOT NULL DEFAULT 30 CHECK (sfx_volume BETWEEN 0 AND 100),
  music_volume INTEGER NOT NULL DEFAULT 30 CHECK (music_volume BETWEEN 0 AND 100),
  motion       TEXT NOT NULL DEFAULT 'system' CHECK (motion IN ('system', 'full', 'reduced')),
  theme        TEXT NOT NULL DEFAULT 'discord' CHECK (theme IN ('discord', 'light', 'dark')),
  dm_digest    INTEGER NOT NULL DEFAULT 1 CHECK (dm_digest IN (0, 1)),
  updated_at   INTEGER NOT NULL
) STRICT;

INSERT INTO user_settings_new
  (user_id, locale, sound, sfx_volume, music_volume, motion, theme, dm_digest, updated_at)
SELECT user_id, locale, sound, volume, volume, motion,
       CASE theme WHEN 'system' THEN 'discord' ELSE theme END,
       dm_digest, updated_at
FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;
