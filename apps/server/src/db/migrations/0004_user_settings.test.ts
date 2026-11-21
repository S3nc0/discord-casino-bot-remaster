import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPragmas } from '../pragmas.ts';
import { runMigrations } from '../migrate.ts';
import { migrations } from './index.ts';

const U1 = '123456789012345678';
const U2 = '123456789012345679';
const U3 = '123456789012345670';

describe('0004_user_settings', () => {
  const upToV3 = (): Database.Database => {
    const db = new Database(':memory:');
    applyPragmas(db);
    runMigrations(
      db,
      migrations.filter((m) => m.version <= 3),
    );
    return db;
  };

  it('rebuilds the table: old volume is copied to both volumes, system theme becomes discord', () => {
    const db = upToV3();
    for (const id of [U1, U2, U3]) {
      db.prepare('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, 0, 0)').run(id);
    }
    const insert = db.prepare(
      `INSERT INTO user_settings (user_id, locale, sound, volume, motion, theme, dm_digest, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(U1, 'ja', 0, 55, 'reduced', 'dark', 0, 111);
    insert.run(U2, null, 1, 70, 'system', 'system', 1, 222);
    insert.run(U3, 'en', 1, 0, 'full', 'light', 1, 333);

    expect(
      runMigrations(
        db,
        migrations.filter((m) => m.version <= 4),
      ),
    ).toEqual([4]);

    const rows = db.prepare('SELECT * FROM user_settings ORDER BY updated_at').all();
    expect(rows).toEqual([
      {
        user_id: U1,
        locale: 'ja',
        sound: 0,
        sfx_volume: 55,
        music_volume: 55,
        motion: 'reduced',
        theme: 'dark',
        dm_digest: 0,
        updated_at: 111,
      },
      {
        user_id: U2,
        locale: null,
        sound: 1,
        sfx_volume: 70,
        music_volume: 70,
        motion: 'system',
        theme: 'discord',
        dm_digest: 1,
        updated_at: 222,
      },
      {
        user_id: U3,
        locale: 'en',
        sound: 1,
        sfx_volume: 0,
        music_volume: 0,
        motion: 'full',
        theme: 'light',
        dm_digest: 1,
        updated_at: 333,
      },
    ]);
    const columns = (
      db.prepare('PRAGMA table_info(user_settings)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).not.toContain('volume');
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'user_settings_new'").all(),
    ).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('new rows default to sfx and music volume 30, sound on, system motion, discord theme', () => {
    const db = new Database(':memory:');
    applyPragmas(db);
    runMigrations(db, migrations);
    db.prepare('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, 0, 0)').run(U1);
    db.prepare('INSERT INTO user_settings (user_id, updated_at) VALUES (?, 5)').run(U1);
    expect(db.prepare('SELECT * FROM user_settings').get()).toEqual({
      user_id: U1,
      locale: null,
      sound: 1,
      sfx_volume: 30,
      music_volume: 30,
      motion: 'system',
      theme: 'discord',
      dm_digest: 1,
      updated_at: 5,
    });
  });

  it('enforces the new checks and keeps the foreign key to users', () => {
    const db = new Database(':memory:');
    applyPragmas(db);
    runMigrations(db, migrations);
    db.prepare('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, 0, 0)').run(U1);
    const put = (col: string, value: unknown): void =>
      void db
        .prepare(
          `INSERT OR REPLACE INTO user_settings (user_id, ${col}, updated_at) VALUES (?, ?, 0)`,
        )
        .run(U1, value);
    expect(() => put('theme', 'system')).toThrow(/CHECK/);
    expect(() => put('sfx_volume', 101)).toThrow(/CHECK/);
    expect(() => put('music_volume', -1)).toThrow(/CHECK/);
    expect(() => put('motion', 'wild')).toThrow(/CHECK/);
    expect(() =>
      db.prepare('INSERT INTO user_settings (user_id, updated_at) VALUES (?, 0)').run(U2),
    ).toThrow(/FOREIGN KEY/);
  });
});
