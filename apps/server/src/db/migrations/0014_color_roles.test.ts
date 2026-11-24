import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPragmas } from '../pragmas.ts';
import { runMigrations } from '../migrate.ts';
import { migrations } from './index.ts';

const G = '223456789012345678';
const U = '323456789012345678';

function db(version: number): Database.Database {
  const d = new Database(':memory:');
  applyPragmas(d);
  runMigrations(
    d,
    migrations.filter((m) => m.version <= version),
  );
  return d;
}

const columns = (d: Database.Database, table: string) =>
  (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('0014_color_roles', () => {
  it('applies right after 13 and adds the slot and the three tables', () => {
    const d = db(13);
    // Later migrations may follow: this one only has to be the 14th and apply right after 13.
    const upTo14 = migrations.filter((m) => m.version <= 14);
    expect(upTo14.map((m) => m.version).at(-1)).toBe(14);
    expect(runMigrations(d, upTo14)).toEqual([14]);
    expect(runMigrations(d, upTo14)).toEqual([]);
    expect(columns(d, 'profiles')).toContain('color_role');
    expect(columns(d, 'color_roles')).toEqual(['guild_id', 'item_id', 'role_id', 'created_at']);
    expect(columns(d, 'color_role_holders')).toEqual([
      'guild_id',
      'user_id',
      'role_id',
      'applied_at',
    ]);
    expect(columns(d, 'color_role_sync')).toEqual([
      'guild_id',
      'user_id',
      'queued_at',
      'next_at',
      'tries',
      'seq',
    ]);
    const strict = d
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE 'color_role%'`,
      )
      .all() as { name: string; sql: string }[];
    expect(strict).toHaveLength(3);
    for (const t of strict) expect(t.sql).toMatch(/\)\s*STRICT$/);
  });

  it('keeps existing profiles with no colour worn', () => {
    const d = db(13);
    d.prepare(
      `INSERT INTO guilds (guild_id, status, created_at, updated_at) VALUES (?, 'approved', 0, 0)`,
    ).run(G);
    d.prepare(
      `INSERT INTO users (user_id, username, created_at, updated_at) VALUES (?, 'u', 0, 0)`,
    ).run(U);
    d.prepare(`INSERT INTO guild_members (guild_id, user_id, created_at) VALUES (?, ?, 0)`).run(
      G,
      U,
    );
    d.prepare(`INSERT INTO profiles (guild_id, user_id, title) VALUES (?, ?, 'title_rookie')`).run(
      G,
      U,
    );
    runMigrations(d, migrations);
    expect(d.prepare('SELECT title, color_role FROM profiles').get()).toEqual({
      title: 'title_rookie',
      color_role: null,
    });
    expect(d.pragma('foreign_key_check')).toEqual([]);
  });

  it('stores one role per colour per guild, a role id once, and one row per member', () => {
    const d = db(14);
    const role = d.prepare(
      'INSERT INTO color_roles (guild_id, item_id, role_id, created_at) VALUES (?, ?, ?, 0)',
    );
    role.run(G, 'role_red', 'r1');
    expect(() => role.run(G, 'role_red', 'r2')).toThrow();
    expect(() => role.run(G, 'role_blue', 'r1')).toThrow();
    const sync = d.prepare(
      'INSERT INTO color_role_sync (guild_id, user_id, queued_at, next_at) VALUES (?, ?, 0, 0)',
    );
    sync.run(G, U);
    expect(() => sync.run(G, U)).toThrow();
    expect(d.prepare('SELECT tries, seq FROM color_role_sync').get()).toEqual({ tries: 0, seq: 1 });
  });
});
