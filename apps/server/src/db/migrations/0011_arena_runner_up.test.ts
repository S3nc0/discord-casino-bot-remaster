import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPragmas } from '../pragmas.ts';
import { runMigrations } from '../migrate.ts';
import { migrations } from './index.ts';

const GUILD = '223456789012345678';

function upTo(version: number): Database.Database {
  const db = new Database(':memory:');
  applyPragmas(db);
  runMigrations(
    db,
    migrations.filter((m) => m.version <= version),
  );
  return db;
}

function tournament(db: Database.Database, day: string, status: string, champion: number | null) {
  return Number(
    db
      .prepare(
        `INSERT INTO arena_tournaments (guild_id, day, format, status, champion_id) VALUES (?, ?, 'duel', ?, ?)`,
      )
      .run(GUILD, day, status, champion).lastInsertRowid,
  );
}

function fighter(db: Database.Database, tournamentId: number, name: string) {
  return Number(
    db
      .prepare(
        `INSERT INTO arena_fighters (tournament_id, name, base_power, group_no, stage) VALUES (?, ?, 50, 1, 'out')`,
      )
      .run(tournamentId, name).lastInsertRowid,
  );
}

describe('0011_arena_runner_up', () => {
  it('is the next migration after 10 and applies on its own', () => {
    // Later migrations may follow: this one only has to be the 11th and apply right after 10.
    const upTo11 = migrations.filter((m) => m.version <= 11);
    expect(upTo11.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const db = upTo(10);
    expect(runMigrations(db, upTo11)).toEqual([11]);
    expect(runMigrations(db, upTo11)).toEqual([]);
  });

  it('keeps finished tournaments and leaves their runner-up empty', () => {
    const db = upTo(10);
    db.prepare(
      `INSERT INTO guilds (guild_id, status, created_at, updated_at) VALUES (?, 'approved', 0, 0)`,
    ).run(GUILD);
    const old = tournament(db, '2025-01-05', 'done', null);
    const champion = fighter(db, old, 'Champion');
    db.prepare('UPDATE arena_tournaments SET champion_id = ? WHERE id = ?').run(champion, old);
    const open = tournament(db, '2025-01-06', 'semi_betting', null);

    runMigrations(db, migrations);

    const rows = db
      .prepare('SELECT id, status, champion_id, runner_up_id FROM arena_tournaments ORDER BY id')
      .all();
    expect(rows).toEqual([
      { id: old, status: 'done', champion_id: champion, runner_up_id: null },
      { id: open, status: 'semi_betting', champion_id: null, runner_up_id: null },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('stores a runner-up that must be a real fighter', () => {
    const db = upTo(11);
    db.prepare(
      `INSERT INTO guilds (guild_id, status, created_at, updated_at) VALUES (?, 'approved', 0, 0)`,
    ).run(GUILD);
    const t = tournament(db, '2025-01-06', 'done', null);
    const second = fighter(db, t, 'Second');
    db.prepare('UPDATE arena_tournaments SET runner_up_id = ? WHERE id = ?').run(second, t);
    expect(
      db.prepare('SELECT runner_up_id AS r FROM arena_tournaments WHERE id = ?').get(t),
    ).toEqual({ r: second });
    expect(() =>
      db.prepare('UPDATE arena_tournaments SET runner_up_id = 999999 WHERE id = ?').run(t),
    ).toThrow(/FOREIGN KEY/);
    const columns = (
      db.prepare('PRAGMA table_info(arena_tournaments)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).toContain('runner_up_id');
  });
});
