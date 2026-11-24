import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPragmas } from '../pragmas.ts';
import { runMigrations } from '../migrate.ts';
import { migrations } from './index.ts';

describe('0012_pinned_posts', () => {
  const db = (): Database.Database => {
    const d = new Database(':memory:');
    applyPragmas(d);
    return d;
  };

  it('applies right after 11 and creates the table', () => {
    const d = db();
    runMigrations(
      d,
      migrations.filter((m) => m.version <= 11),
    );
    expect(
      runMigrations(
        d,
        migrations.filter((m) => m.version <= 12),
      ),
    ).toEqual([12]);
    const cols = (d.prepare('PRAGMA table_info(pinned_posts)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual([
      'kind',
      'ref_id',
      'guild_id',
      'channel_id',
      'message_id',
      'pinned_at',
      'tries',
    ]);
  });

  it('allows one row per post and only the three kinds', () => {
    const d = db();
    runMigrations(d, migrations);
    const insert = d.prepare(
      `INSERT INTO pinned_posts (kind, ref_id, guild_id, channel_id, message_id, pinned_at)
       VALUES (?, ?, 'g', 'c', 'm', 0)`,
    );
    insert.run('poll', 1);
    expect(() => insert.run('poll', 1)).toThrow();
    expect(() => insert.run('quiz', 1)).toThrow();
    insert.run('raffle', 1);
  });
});
