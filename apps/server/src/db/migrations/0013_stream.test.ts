import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPragmas } from '../pragmas.ts';
import { runMigrations } from '../migrate.ts';
import { migrations } from './index.ts';

const G = '223456789012345678';
const U = '323456789012345678';
const V = '423456789012345678';

function db(version = 13): Database.Database {
  const d = new Database(':memory:');
  applyPragmas(d);
  runMigrations(
    d,
    migrations.filter((m) => m.version <= version),
  );
  return d;
}

function seed(d: Database.Database): void {
  d.prepare(
    `INSERT INTO guilds (guild_id, status, created_at, updated_at) VALUES (?, 'approved', 0, 0)`,
  ).run(G);
  for (const u of [U, V]) {
    d.prepare(
      `INSERT INTO users (user_id, username, created_at, updated_at) VALUES (?, 'u', 0, 0)`,
    ).run(u);
    d.prepare(`INSERT INTO guild_members (guild_id, user_id, created_at) VALUES (?, ?, 0)`).run(
      G,
      u,
    );
  }
}

const stream = (d: Database.Database, streamer = U, status = 'live') =>
  Number(
    d
      .prepare(
        `INSERT INTO streams (guild_id, streamer_id, title, started_at, ends_at, status, ended_at)
         VALUES (?, ?, 't', 0, 1, ?, ?)`,
      )
      .run(G, streamer, status, status === 'ended' ? 1 : null).lastInsertRowid,
  );

describe('0013_stream', () => {
  it('applies right after 12', () => {
    const d = db(12);
    expect(
      runMigrations(
        d,
        migrations.filter((m) => m.version <= 13),
      ),
    ).toEqual([13]);
    const tables = (
      d
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'stream%'`)
        .all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables.sort()).toEqual([
      'stream_bets',
      'stream_round_audit',
      'stream_rounds',
      'streams',
    ]);
    const cols = (d.prepare('PRAGMA table_info(streams)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('voice_channel_id');
    expect(cols).not.toContain('created_vc');
  });

  it('allows one live panel per streamer per guild', () => {
    const d = db();
    seed(d);
    stream(d, U);
    expect(() => stream(d, U)).toThrow(/UNIQUE/);
    stream(d, V);
    stream(d, U, 'ended');
    // ended_at must be set exactly when ended
    expect(() =>
      d
        .prepare(
          `INSERT INTO streams (guild_id, streamer_id, title, started_at, ends_at, status) VALUES (?, ?, 't', 0, 1, 'ended')`,
        )
        .run(G, U),
    ).toThrow(/CHECK/);
  });

  it('allows one undecided round per stream and checks bets', () => {
    const d = db();
    seed(d);
    const s = stream(d);
    const round = (status: string) =>
      Number(
        d
          .prepare(
            `INSERT INTO stream_rounds (stream_id, guild_id, label, status, created_at, auto_lock_at, locked_at, settled_at)
             VALUES (?, ?, '', ?, 0, 600000, ?, ?)`,
          )
          .run(
            s,
            G,
            status,
            status === 'open' ? null : 1,
            ['win', 'lose', 'void'].includes(status) ? 2 : null,
          ).lastInsertRowid,
      );
    round('win');
    round('void');
    const r = round('open');
    expect(() => round('locked')).toThrow(/UNIQUE/);
    const bet = d.prepare(
      `INSERT INTO stream_bets (round_id, guild_id, user_id, side, amount) VALUES (?, ?, ?, ?, ?)`,
    );
    bet.run(r, G, V, 'win', 100);
    expect(() => bet.run(r, G, V, 'lose', 100)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => bet.run(r, G, U, 'draw', 100)).toThrow(/CHECK/);
    expect(() => bet.run(r, G, U, 'win', 0)).toThrow(/CHECK/);
    expect(d.pragma('foreign_key_check')).toEqual([]);
  });
});
