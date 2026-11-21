import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrations } from './index.ts';

const G = '234567890123456789';
const U = '123456789012345678';

function open(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of migrations) db.exec(m.sql);
  db.prepare('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, 0, 0)').run(U);
  db.prepare('INSERT INTO guilds (guild_id, created_at, updated_at) VALUES (?, 0, 0)').run(G);
  db.prepare('INSERT INTO guild_members (guild_id, user_id, created_at) VALUES (?, ?, 0)').run(
    G,
    U,
  );
  return db;
}

describe('0001_init', () => {
  let db: Database.Database;
  const post = (delta: number, balanceAfter: number) =>
    db
      .prepare(
        `INSERT INTO ledger (guild_id, user_id, delta, balance_after, reason, created_at)
         VALUES (?, ?, ?, ?, 'initial_grant', 0)`,
      )
      .run(G, U, delta, balanceAfter);
  const balance = () =>
    db.prepare('SELECT balance FROM balances WHERE guild_id = ? AND user_id = ?').pluck().get(G, U);

  beforeEach(() => {
    db = open();
  });

  it('applies cleanly and keeps balances in step with the ledger', () => {
    post(3000, 3000);
    post(-500, 2500);
    expect(balance()).toBe(2500);
    const sum = db
      .prepare('SELECT SUM(delta) FROM ledger WHERE guild_id = ? AND user_id = ?')
      .pluck()
      .get(G, U);
    expect(sum).toBe(2500);
  });

  it('rejects a broken balance chain', () => {
    post(3000, 3000);
    expect(() => post(100, 9999)).toThrow(/balance_after/);
  });

  it('makes the ledger append-only', () => {
    post(3000, 3000);
    expect(() => db.prepare('UPDATE ledger SET delta = 1').run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM ledger').run()).toThrow(/append-only/);
  });

  it('refuses direct balance writes', () => {
    post(3000, 3000);
    expect(() => db.prepare('UPDATE balances SET balance = 1000000').run()).toThrow(
      /through the ledger/,
    );
    expect(() => db.prepare('DELETE FROM balances').run()).toThrow(/through the ledger/);
  });

  it('requires a guild member for ledger rows', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO ledger (guild_id, user_id, delta, balance_after, reason, created_at)
           VALUES ('345678901234567890', ?, 1, 1, 'admin_grant', 0)`,
        )
        .run(U),
    ).toThrow(/FOREIGN KEY/);
  });
});
