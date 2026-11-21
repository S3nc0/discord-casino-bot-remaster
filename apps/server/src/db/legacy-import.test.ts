import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { isDeltaAllowed, manualClock } from '@casino/shared';
import { EconomyService } from '../economy/economy-service.ts';
import { START_MS, memoryStore } from '../runtime/test-kit.ts';
import { IdentityRepo } from './identity.ts';
import { ImportMismatchError, planImport, runImport } from './legacy-import.ts';

const G1 = '234567890123456789';
const G2 = '234567890123456780';
const U1 = '123456789012345678';
const U2 = '123456789012345679';
const U3 = '999999999999999999'; // above 2^53 when read as a number

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function legacyDb(mutate?: (db: Database.Database) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-'));
  dirs.push(dir);
  const path = join(dir, 'casino.db');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE users (guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, balance INTEGER NOT NULL,
      created_at REAL NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id));
    CREATE TABLE guild_users (guild_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
    CREATE TABLE guild_status (guild_id INTEGER PRIMARY KEY, status TEXT NOT NULL, name TEXT, decided_by INTEGER,
      updated_at REAL NOT NULL, notified_at REAL);
    CREATE TABLE escrow (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL DEFAULT 0, user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL, game TEXT NOT NULL, created_at REAL NOT NULL);
    CREATE TABLE ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL DEFAULT 0, user_id INTEGER NOT NULL,
      delta INTEGER NOT NULL, balance_after INTEGER NOT NULL, reason TEXT NOT NULL, ts REAL NOT NULL);
    INSERT INTO users (guild_id, user_id, balance) VALUES (${G1}, ${U1}, 12345), (${G1}, ${U2}, 0), (${G2}, ${U1}, 777), (${G2}, ${U3}, 5);
    INSERT INTO guild_users (guild_id, user_id) VALUES (${G1}, ${U1}), (${G1}, ${U2}), (${G2}, ${U1}), (${G1}, ${U3});
    INSERT INTO guild_status (guild_id, status, name, decided_by, updated_at) VALUES (${G1}, 'approved', 'Main', ${U1}, 0), (${G2}, 'pending', 'Side', NULL, 0);
    INSERT INTO escrow (guild_id, user_id, amount, game, created_at) VALUES (${G1}, ${U1}, 500, 'blackjack', 0), (${G1}, ${U2}, 250, 'slots', 0);
    INSERT INTO ledger (guild_id, user_id, delta, balance_after, reason, ts) VALUES
      (${G1}, ${U1}, 12345, 12345, 'daily', 1700000000.5), (0, ${U1}, 1, 1, 'old', 1.0);
  `);
  mutate?.(db);
  db.close();
  return path;
}

function target() {
  const store = memoryStore();
  const clock = manualClock(START_MS);
  const identity = new IdentityRepo(store, () => clock.now());
  return { store, identity, economy: new EconomyService({ store, identity, clock }), clock };
}

describe('planImport (dry run)', () => {
  it('totals per guild and per user, reading ids without losing precision', () => {
    const plan = planImport(legacyDb());
    expect(plan.errors).toEqual([]);
    expect(plan.guilds).toEqual(
      [
        {
          guildId: G2,
          status: 'pending',
          name: 'Side',
          decidedBy: null,
          members: 2,
          expectedTotal: 782,
        },
        {
          guildId: G1,
          status: 'approved',
          name: 'Main',
          decidedBy: U1,
          members: 3,
          expectedTotal: 12345 + 500 + 250,
        },
      ].sort((a, b) => a.guildId.localeCompare(b.guildId)),
    );
    const u1 = plan.members.find((m) => m.guildId === G1 && m.userId === U1);
    expect(u1).toMatchObject({
      balance: 12345,
      expected: 12845,
      escrow: [{ id: '1', amount: 500 }],
    });
    expect(plan.members.some((m) => m.userId === U3)).toBe(true);
    expect(plan.legacyLedgerRows).toBe(2);
  });

  it('reports negative balances and bad ids as errors, and warns about guilds without status', () => {
    const plan = planImport(
      legacyDb((db) => {
        db.exec(`UPDATE users SET balance = -5 WHERE user_id = ${U2};
                 INSERT INTO users (guild_id, user_id, balance) VALUES (0, ${U1}, 10);
                 DELETE FROM guild_status WHERE guild_id = ${G2};`);
      }),
    );
    expect(plan.errors.some((e) => e.includes('negative balance -5'))).toBe(true);
    expect(plan.errors.some((e) => e.includes('invalid id guild=0'))).toBe(true);
    expect(plan.warnings.some((w) => w.includes(G2))).toBe(true);
  });

  it('opens the legacy file read-only', () => {
    const path = legacyDb();
    planImport(path);
    const db = new Database(path);
    expect((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(4);
    db.close();
  });

  it('digest follows the data', () => {
    const a = planImport(legacyDb());
    const b = planImport(legacyDb());
    const c = planImport(
      legacyDb(
        (db) => void db.exec(`UPDATE users SET balance = balance + 1 WHERE user_id = ${U2}`),
      ),
    );
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
  });
});

describe('runImport', () => {
  it('every ledger row it writes has a sign its reason allows', () => {
    const t = target();
    runImport({ legacyPath: legacyDb(), target: t, apply: true, clock: t.clock });
    const rows = t.store.db.prepare('SELECT reason, delta FROM ledger').all() as {
      reason: string;
      delta: number;
    }[];
    expect(new Set(rows.map((r) => r.reason))).toEqual(new Set(['legacy_import', 'game_refund']));
    for (const row of rows)
      expect(isDeltaAllowed(row.reason as 'legacy_import', row.delta), row.reason).toBe(true);
  });

  it('dry run touches nothing', () => {
    const t = target();
    const report = runImport({ legacyPath: legacyDb(), target: t, apply: false, clock: t.clock });
    expect(report.mode).toBe('dry-run');
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 0 });
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM guild_members').get()).toEqual({ n: 0 });
  });

  it('apply writes legacy_import and game_refund rows, no start grant, and verifies the totals', () => {
    const t = target();
    const report = runImport({ legacyPath: legacyDb(), target: t, apply: true, clock: t.clock });
    expect(report).toMatchObject({ mode: 'applied', verified: true });
    expect(t.economy.getBalance(G1, U1)).toBe(12845);
    expect(t.economy.getBalance(G1, U2)).toBe(250);
    expect(t.economy.getBalance(G2, U1)).toBe(777);
    expect(t.economy.getBalance(G2, U3)).toBe(5);
    expect(t.economy.getBalance(G1, U3)).toBe(0);
    expect(t.economy.hasAccount(G1, U3)).toBe(true); // guild_users only: account without a wallet
    expect(t.economy.history(G1, U1).map((e) => e.reason)).toEqual([
      'game_refund',
      'legacy_import',
    ]);
    expect(
      t.store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason = 'initial_grant'").get(),
    ).toEqual({ n: 0 });
    expect(t.identity.getGuildStatus(G1)).toBe('approved');
    expect(t.identity.getGuildStatus(G2)).toBe('pending');
    // history copied read-only; the pre-guild row (guild 0) is skipped
    expect(t.store.db.prepare('SELECT * FROM legacy_ledger').all()).toEqual([
      {
        legacy_id: '1',
        guild_id: G1,
        user_id: U1,
        delta: 12345,
        balance_after: 12345,
        reason: 'daily',
        ts: 1_700_000_000_500,
      },
    ]);
    // sum of all balances equals sum of all legacy balances + escrow
    const sum = t.store.db.prepare('SELECT SUM(balance) AS s FROM balances').get() as { s: number };
    expect(sum.s).toBe(12345 + 0 + 777 + 5 + 500 + 250);
  });

  it('a second run on the same data is a no-op', () => {
    const t = target();
    const path = legacyDb();
    runImport({ legacyPath: path, target: t, apply: true, clock: t.clock });
    const before = t.store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get();
    const again = runImport({ legacyPath: path, target: t, apply: true, clock: t.clock });
    expect(again.mode).toBe('already-imported');
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual(before);
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM legacy_import_runs').get()).toEqual({
      n: 1,
    });
  });

  it('refuses to import over accounts that already exist in the target', () => {
    const t = target();
    t.economy.ensureMember(G1, U1); // a player who already opened the new Activity
    expect(() =>
      runImport({ legacyPath: legacyDb(), target: t, apply: true, clock: t.clock }),
    ).toThrow(ImportMismatchError);
    expect(t.economy.getBalance(G1, U1)).toBe(3000);
    expect(t.economy.hasAccount(G2, U1)).toBe(false);
  });

  it('refuses when the plan has errors', () => {
    const t = target();
    const path = legacyDb(
      (db) => void db.exec(`UPDATE users SET balance = -1 WHERE user_id = ${U2}`),
    );
    expect(() => runImport({ legacyPath: path, target: t, apply: true, clock: t.clock })).toThrow(
      /refusing/,
    );
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM guilds').get()).toEqual({ n: 0 });
  });

  it('rolls everything back when a total does not match', () => {
    const t = target();
    // Corrupt the economy so one user's imported balance differs from the plan.
    const real = t.economy.apply.bind(t.economy);
    t.economy.apply = (change) =>
      real(change.userId === U2 ? { ...change, delta: change.delta + 1 } : change);
    expect(() =>
      runImport({ legacyPath: legacyDb(), target: t, apply: true, clock: t.clock }),
    ).toThrow(/expected/);
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 0 });
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM guild_members').get()).toEqual({ n: 0 });
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM legacy_import_runs').get()).toEqual({
      n: 0,
    });
  });
});
