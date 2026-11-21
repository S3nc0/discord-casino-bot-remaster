import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPragmas } from '../pragmas.ts';
import { migrations } from './index.ts';

const G = '234567890123456789';
const U = '123456789012345678';

type Mode =
  'recursive_triggers ON (production pragmas)' | 'recursive_triggers OFF (SQLite default)';
const MODES: Mode[] = [
  'recursive_triggers ON (production pragmas)',
  'recursive_triggers OFF (SQLite default)',
];

function open(mode: Mode): Database.Database {
  const db = new Database(':memory:');
  if (mode.startsWith('recursive_triggers ON')) {
    applyPragmas(db);
  } else {
    db.pragma('foreign_keys = ON');
    db.pragma('recursive_triggers = OFF');
  }
  for (const m of migrations) db.exec(m.sql);
  db.prepare('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, 0, 0)').run(U);
  db.prepare('INSERT INTO guilds (guild_id, created_at, updated_at) VALUES (?, 0, 0)').run(G);
  db.prepare('INSERT INTO guild_members (guild_id, user_id, created_at) VALUES (?, ?, 0)').run(
    G,
    U,
  );
  return db;
}

function helpers(db: Database.Database) {
  const post = (delta: number, balanceAfter: number) =>
    db
      .prepare(
        `INSERT INTO ledger (guild_id, user_id, delta, balance_after, reason, created_at)
         VALUES (?, ?, ?, ?, 'initial_grant', 0)`,
      )
      .run(G, U, delta, balanceAfter);
  const balance = () =>
    db.prepare('SELECT balance FROM balances WHERE guild_id = ? AND user_id = ?').pluck().get(G, U);
  const sum = () =>
    db
      .prepare('SELECT SUM(delta) FROM ledger WHERE guild_id = ? AND user_id = ?')
      .pluck()
      .get(G, U);
  const ledgerRow = (id: number) =>
    db.prepare('SELECT delta, balance_after FROM ledger WHERE id = ?').get(id);
  return { post, balance, sum, ledgerRow };
}

describe.each(MODES)('0001_init with %s', (mode) => {
  it('applies cleanly and keeps balances in step with the ledger', () => {
    const { post, balance, sum } = helpers(open(mode));
    post(3000, 3000);
    post(-500, 2500);
    expect(balance()).toBe(2500);
    expect(sum()).toBe(2500);
  });

  it('rejects a broken balance chain', () => {
    const { post } = helpers(open(mode));
    post(3000, 3000);
    expect(() => post(100, 9999)).toThrow(/balance_after/);
  });

  it('makes the ledger append-only', () => {
    const db = open(mode);
    const { post } = helpers(db);
    post(3000, 3000);
    expect(() => db.prepare('UPDATE ledger SET delta = 1').run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM ledger').run()).toThrow(/append-only/);
  });

  it('refuses direct balance writes', () => {
    const db = open(mode);
    const { post } = helpers(db);
    post(3000, 3000);
    expect(() => db.prepare('UPDATE balances SET balance = 1000000').run()).toThrow(
      /through the ledger/,
    );
    expect(() => db.prepare('DELETE FROM balances').run()).toThrow(/through the ledger/);
  });

  // Review finding 1, scenario 1: INSERT OR REPLACE rolls balances back to an older ledger row.
  it('blocks INSERT OR REPLACE INTO balances with a stale ledger row', () => {
    const db = open(mode);
    const { post, balance, sum } = helpers(db);
    post(3000, 3000);
    post(-2500, 500);
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO balances (guild_id, user_id, balance, last_ledger_id, updated_at)
           VALUES (?, ?, 3000, 1, 0)`,
        )
        .run(G, U),
    ).toThrow(/through the ledger/);
    expect(balance()).toBe(500);
    post(100, 600);
    expect(balance()).toBe(sum());
  });

  it('blocks upserts into balances', () => {
    const db = open(mode);
    const { post, balance } = helpers(db);
    post(3000, 3000);
    post(-2500, 500);
    expect(() =>
      db
        .prepare(
          `INSERT INTO balances (guild_id, user_id, balance, last_ledger_id, updated_at)
           VALUES (?, ?, 3000, 1, 0)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET balance = excluded.balance,
             last_ledger_id = excluded.last_ledger_id`,
        )
        .run(G, U),
    ).toThrow(/through the ledger/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO balances (guild_id, user_id, balance, last_ledger_id, updated_at)
           VALUES (?, ?, 500, 2, 0)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET balance = 999999`,
        )
        .run(G, U),
    ).toThrow(/through the ledger/);
    expect(balance()).toBe(500);
  });

  // Review finding 1, scenario 2: INSERT OR REPLACE overwrites a historical ledger row.
  it('blocks INSERT OR REPLACE INTO ledger with an existing id', () => {
    const db = open(mode);
    const { post, balance, sum, ledgerRow } = helpers(db);
    post(3000, 3000);
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO ledger (id, guild_id, user_id, delta, balance_after, reason, created_at)
           VALUES (1, ?, ?, 5000, 8000, 'admin_grant', 0)`,
        )
        .run(G, U),
    ).toThrow(/append-only/);
    expect(ledgerRow(1)).toEqual({ delta: 3000, balance_after: 3000 });
    expect(balance()).toBe(3000);
    expect(sum()).toBe(3000);
  });

  it('blocks upserts into ledger', () => {
    const db = open(mode);
    const { post, ledgerRow } = helpers(db);
    post(3000, 3000);
    expect(() =>
      db
        .prepare(
          `INSERT INTO ledger (id, guild_id, user_id, delta, balance_after, reason, created_at)
           VALUES (1, ?, ?, 3000, 6000, 'admin_grant', 0)
           ON CONFLICT (id) DO UPDATE SET delta = 99999`,
        )
        .run(G, U),
    ).toThrow(/append-only/);
    expect(ledgerRow(1)).toEqual({ delta: 3000, balance_after: 3000 });
  });

  // Review finding 2: balances never go below zero (debt lives in its own tables).
  it('rejects a debit below zero', () => {
    const { post, balance } = helpers(open(mode));
    post(3000, 3000);
    expect(() => post(-3001, -1)).toThrow(/CHECK constraint/);
    expect(balance()).toBe(3000);
    post(-3000, 0);
    expect(balance()).toBe(0);
  });

  it('requires a guild member for ledger rows', () => {
    const db = open(mode);
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
