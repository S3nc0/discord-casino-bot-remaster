import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_REASONS,
  LEDGER_REASON_SIGN,
  isDeltaAllowed,
  manualClock,
  type BalanceUpdate,
} from '@casino/shared';
import { IdentityRepo } from '../db/identity.ts';
import { migrations } from '../db/migrations/index.ts';
import { openStore, type Store } from '../db/store.ts';
import { EventBus } from '../runtime/bus.ts';
import { AppError } from '../runtime/errors.ts';
import {
  GUILD,
  OTHER_GUILD,
  OTHER_USER,
  START_MS,
  USER,
  memoryStore,
} from '../runtime/test-kit.ts';
import { EconomyService, INITIAL_BALANCE, LedgerSignError } from './economy-service.ts';

function setup(store: Store = memoryStore()) {
  const clock = manualClock(START_MS);
  const bus = new EventBus();
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  const updates: BalanceUpdate[] = [];
  bus.onBalance((u) => updates.push(u));
  return { store, economy, updates, clock };
}

const failure = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
};

describe('first sight', () => {
  it('grants 3,000 once, as an initial_grant ledger row', () => {
    const { economy, store, updates } = setup();
    expect(economy.getBalance(GUILD, USER)).toBe(0);
    expect(economy.ensureMember(GUILD, USER)).toEqual({ created: true, balance: INITIAL_BALANCE });
    expect(INITIAL_BALANCE).toBe(3000);
    expect(economy.ensureMember(GUILD, USER)).toEqual({ created: false, balance: 3000 });
    expect(economy.history(GUILD, USER)).toMatchObject([
      { reason: 'initial_grant', delta: 3000, balanceAfter: 3000 },
    ]);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 1 });
    expect(updates).toHaveLength(1);
  });

  it('a first apply() also creates the account with its grant', () => {
    const { economy } = setup();
    const { entry } = economy.apply({
      guildId: GUILD,
      userId: USER,
      delta: 500,
      reason: 'daily_bonus',
    });
    expect(entry.balanceAfter).toBe(3500);
    expect(economy.history(GUILD, USER).map((e) => e.reason)).toEqual([
      'daily_bonus',
      'initial_grant',
    ]);
  });

  it('can create an account without the grant (importer)', () => {
    const { economy } = setup();
    expect(economy.ensureMember(GUILD, USER, { initialGrant: false })).toEqual({
      created: true,
      balance: 0,
    });
    expect(economy.history(GUILD, USER)).toEqual([]);
  });
});

describe('per guild', () => {
  it('keeps one balance per guild and user', () => {
    const { economy } = setup();
    economy.credit({ guildId: GUILD, userId: USER, amount: 100, reason: 'admin_grant' });
    expect(economy.getBalance(GUILD, USER)).toBe(3100);
    expect(economy.getBalance(OTHER_GUILD, USER)).toBe(0);
    economy.debit({ guildId: OTHER_GUILD, userId: USER, amount: 1000, reason: 'game_stake' });
    expect(economy.getBalance(OTHER_GUILD, USER)).toBe(2000);
    expect(economy.getBalance(GUILD, USER)).toBe(3100);
    expect(economy.getBalance(GUILD, OTHER_USER)).toBe(0);
  });
});

describe('balance cannot go negative', () => {
  it('rejects an overdraft and leaves no trace', () => {
    const { economy, updates } = setup();
    economy.ensureMember(GUILD, USER);
    updates.length = 0;
    const error = failure(() =>
      economy.debit({ guildId: GUILD, userId: USER, amount: 3001, reason: 'game_stake' }),
    );
    expect(error.code).toBe('insufficient_funds');
    expect(economy.getBalance(GUILD, USER)).toBe(3000);
    expect(economy.history(GUILD, USER)).toHaveLength(1);
    expect(updates).toEqual([]);
    // exactly the balance is fine
    expect(
      economy.debit({ guildId: GUILD, userId: USER, amount: 3000, reason: 'game_stake' }).entry
        .balanceAfter,
    ).toBe(0);
  });

  it('refuses invalid changes', () => {
    const { economy } = setup();
    const bad = (partial: Record<string, unknown>): string =>
      failure(() =>
        economy.apply({
          guildId: GUILD,
          userId: USER,
          delta: 1,
          reason: 'admin_grant',
          ...partial,
        }),
      ).code;
    expect(bad({ delta: 0 })).toBe('invalid_payload');
    expect(bad({ delta: 1.5 })).toBe('invalid_payload');
    expect(bad({ delta: Number.MAX_SAFE_INTEGER })).toBe('invalid_payload'); // overflow of the balance
    expect(bad({ reason: 'made_up' })).toBe('invalid_payload');
    expect(bad({ userId: 'not-a-snowflake' })).toBe('invalid_payload');
    expect(bad({ idempotencyKey: '' })).toBe('invalid_payload');
    expect(
      failure(() =>
        economy.credit({ guildId: GUILD, userId: USER, amount: -5, reason: 'admin_grant' }),
      ).code,
    ).toBe('invalid_payload');
  });

  it('the database itself refuses a negative balance and direct balance writes', () => {
    const { economy, store } = setup();
    economy.ensureMember(GUILD, USER);
    expect(() => store.db.prepare('UPDATE balances SET balance = 999999').run()).toThrow(/ledger/);
    expect(() =>
      store.db
        .prepare(
          `INSERT INTO ledger (guild_id, user_id, delta, balance_after, reason, created_at)
           VALUES (?, ?, -5000, -2000, 'game_stake', 0)`,
        )
        .run(GUILD, USER),
    ).toThrow();
  });
});

describe('idempotency', () => {
  it('replays the original entry and posts nothing twice', () => {
    const { economy, updates } = setup();
    const change = {
      guildId: GUILD,
      userId: USER,
      delta: -400,
      reason: 'game_stake',
      idempotencyKey: 'bet-1',
      refType: 'round',
      refId: 'r1',
    } as const;
    const first = economy.apply(change);
    updates.length = 0;
    const second = economy.apply(change);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.entry).toEqual(first.entry);
    expect(economy.getBalance(GUILD, USER)).toBe(2600);
    expect(economy.history(GUILD, USER)).toHaveLength(2);
    expect(updates).toEqual([]);
  });

  it('a replay still works after the balance has moved on or dropped below the amount', () => {
    const { economy } = setup();
    const change = {
      guildId: GUILD,
      userId: USER,
      delta: -3000,
      reason: 'game_stake',
      idempotencyKey: 'all-in',
    } as const;
    const first = economy.apply(change);
    expect(economy.getBalance(GUILD, USER)).toBe(0);
    expect(economy.apply(change)).toEqual({ entry: first.entry, replayed: true });
  });

  it('the same key with a different change is a conflict', () => {
    const { economy } = setup();
    economy.apply({
      guildId: GUILD,
      userId: USER,
      delta: -10,
      reason: 'game_stake',
      idempotencyKey: 'k',
    });
    expect(
      failure(() =>
        economy.apply({
          guildId: GUILD,
          userId: USER,
          delta: -11,
          reason: 'game_stake',
          idempotencyKey: 'k',
        }),
      ).code,
    ).toBe('conflict');
    expect(
      failure(() =>
        economy.apply({
          guildId: GUILD,
          userId: USER,
          delta: -10,
          reason: 'shop_buy',
          idempotencyKey: 'k',
        }),
      ).code,
    ).toBe('conflict');
  });

  it('keys are scoped to the account', () => {
    const { economy } = setup();
    const base = { delta: -10, reason: 'game_stake', idempotencyKey: 'k' } as const;
    economy.apply({ guildId: GUILD, userId: USER, ...base });
    expect(economy.apply({ guildId: GUILD, userId: OTHER_USER, ...base }).replayed).toBe(false);
    expect(economy.apply({ guildId: OTHER_GUILD, userId: USER, ...base }).replayed).toBe(false);
  });

  it('the unique index is the backstop against a second row for one key', () => {
    const { economy, store } = setup();
    economy.apply({
      guildId: GUILD,
      userId: USER,
      delta: -10,
      reason: 'game_stake',
      idempotencyKey: 'k',
    });
    expect(() =>
      store.db
        .prepare(
          `INSERT INTO ledger (guild_id, user_id, delta, balance_after, reason, idempotency_key, created_at)
           VALUES (?, ?, -10, 2980, 'game_stake', 'k', 0)`,
        )
        .run(GUILD, USER),
    ).toThrow(/UNIQUE/);
  });
});

describe('concurrent credit and debit', () => {
  it('many interleaved calls on one connection keep the chain exact', async () => {
    const { economy, store } = setup();
    economy.ensureMember(GUILD, USER);
    const ops = Array.from({ length: 300 }, (_, i) => {
      const credit = i % 2 === 0;
      return Promise.resolve().then(() => {
        try {
          return credit
            ? economy.credit({ guildId: GUILD, userId: USER, amount: 7, reason: 'admin_grant' })
                .entry.delta
            : economy.debit({ guildId: GUILD, userId: USER, amount: 11, reason: 'game_stake' })
                .entry.delta;
        } catch (error) {
          if (error instanceof AppError && error.code === 'insufficient_funds') return 0;
          throw error;
        }
      });
    });
    const deltas = await Promise.all(ops);
    const sum = deltas.reduce((a, b) => a + b, 0);
    expect(economy.getBalance(GUILD, USER)).toBe(3000 + sum);
    expect(economy.getBalance(GUILD, USER)).toBeGreaterThanOrEqual(0);
    const check = store.db
      .prepare(
        'SELECT SUM(delta) AS s, MIN(balance_after) AS m FROM ledger WHERE guild_id = ? AND user_id = ?',
      )
      .get(GUILD, USER) as { s: number; m: number };
    expect(check.s).toBe(economy.getBalance(GUILD, USER));
    expect(check.m).toBeGreaterThanOrEqual(0);
  });

  it('two connections to one file never overdraw or double-post', () => {
    const dir = mkdtempSync(join(tmpdir(), 'economy-'));
    try {
      const path = join(dir, 'e.sqlite');
      const a = setup(openStore(path, { migrations })).economy;
      const b = setup(openStore(path, { migrations })).economy;
      a.ensureMember(GUILD, USER);
      let spent = 0;
      let refused = 0;
      // Alternate writers; each stakes 700 until the 3,000 run out (4 succeed, the rest refuse).
      for (let i = 0; i < 10; i++) {
        const writer = i % 2 === 0 ? a : b;
        try {
          writer.debit({
            guildId: GUILD,
            userId: USER,
            amount: 700,
            reason: 'game_stake',
            idempotencyKey: `s${i}`,
          });
          spent += 700;
        } catch (error) {
          expect((error as AppError).code).toBe('insufficient_funds');
          refused += 1;
        }
      }
      expect(spent).toBe(2800);
      expect(refused).toBe(6);
      expect(a.getBalance(GUILD, USER)).toBe(200);
      expect(b.getBalance(GUILD, USER)).toBe(200);
      // The same key through the other connection replays instead of posting again.
      expect(
        b.debit({
          guildId: GUILD,
          userId: USER,
          amount: 700,
          reason: 'game_stake',
          idempotencyKey: 's0',
        }).replayed,
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('atomic multi-step changes', () => {
  it('applyAll posts everything or nothing', () => {
    const { economy, updates } = setup();
    economy.ensureMember(GUILD, USER);
    economy.ensureMember(GUILD, OTHER_USER);
    updates.length = 0;
    const transfer = (amount: number) =>
      economy.applyAll([
        {
          guildId: GUILD,
          userId: USER,
          delta: -amount,
          reason: 'transfer_out',
          refType: 'transfer',
          refId: 't1',
        },
        {
          guildId: GUILD,
          userId: OTHER_USER,
          delta: amount,
          reason: 'transfer_in',
          refType: 'transfer',
          refId: 't1',
        },
      ]);
    expect(failure(() => transfer(5000)).code).toBe('insufficient_funds');
    expect(economy.getBalance(GUILD, USER)).toBe(3000);
    expect(economy.getBalance(GUILD, OTHER_USER)).toBe(3000);
    expect(updates).toEqual([]);
    transfer(1000);
    expect(economy.getBalance(GUILD, USER)).toBe(2000);
    expect(economy.getBalance(GUILD, OTHER_USER)).toBe(4000);
    expect(updates.map((u) => u.delta)).toEqual([-1000, 1000]);
  });

  it('events from inside a caller transaction wait for its commit and vanish on rollback', () => {
    const { economy, store, updates } = setup();
    economy.ensureMember(GUILD, USER);
    updates.length = 0;
    expect(() =>
      store.transaction(() => {
        economy.credit({ guildId: GUILD, userId: USER, amount: 5, reason: 'admin_grant' });
        expect(updates).toEqual([]);
        throw new Error('game state failed');
      }),
    ).toThrow();
    expect(economy.getBalance(GUILD, USER)).toBe(3000);
    expect(updates).toEqual([]);
    store.transaction(() =>
      economy.credit({ guildId: GUILD, userId: USER, amount: 5, reason: 'admin_grant' }),
    );
    expect(updates).toMatchObject([
      { guildId: GUILD, userId: USER, balance: 3005, delta: 5, reason: 'admin_grant' },
    ]);
  });
});

describe('reason signs (LEDGER_REASON_SIGN)', () => {
  const cases = LEDGER_REASONS.map((reason) => [reason, LEDGER_REASON_SIGN[reason]] as const);

  it.each(cases)('%s: posts its own sign and rejects the opposite one', (reason, sign) => {
    const { economy, store, updates } = setup();
    economy.ensureMember(GUILD, USER); // 3,000, so a debit of 5 is always covered
    updates.length = 0;
    const rows = (): number =>
      (store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n;
    const before = rows();

    const allowed = economy.apply({ guildId: GUILD, userId: USER, delta: sign * 5, reason });
    expect(allowed.entry).toMatchObject({ reason, delta: sign * 5, balanceAfter: 3000 + sign * 5 });
    expect(rows()).toBe(before + 1);

    const error = failure(() =>
      economy.apply({ guildId: GUILD, userId: USER, delta: -sign * 5, reason }),
    );
    expect(error).toBeInstanceOf(LedgerSignError);
    expect(error).toMatchObject({ code: 'invalid_payload', status: 400, reason, delta: -sign * 5 });
    expect(error.message).toContain(sign === 1 ? 'positive' : 'negative');
    expect(rows()).toBe(before + 1);
    expect(economy.getBalance(GUILD, USER)).toBe(3000 + sign * 5);
    expect(updates).toHaveLength(1);
  });

  it('covers every reason and agrees with isDeltaAllowed', () => {
    expect(cases.length).toBe(LEDGER_REASONS.length);
    for (const [reason, sign] of cases) {
      expect(isDeltaAllowed(reason, sign * 5)).toBe(true);
      expect(isDeltaAllowed(reason, -sign * 5)).toBe(false);
    }
  });

  it('credit and debit are checked too, even when the amount itself is valid', () => {
    const { economy } = setup();
    expect(
      failure(() =>
        economy.credit({ guildId: GUILD, userId: USER, amount: 10, reason: 'game_stake' }),
      ),
    ).toBeInstanceOf(LedgerSignError);
    expect(
      failure(() =>
        economy.debit({ guildId: GUILD, userId: USER, amount: 10, reason: 'game_payout' }),
      ),
    ).toBeInstanceOf(LedgerSignError);
    // nothing was written, not even the start grant (the whole call rolled back)
    expect(economy.hasAccount(GUILD, USER)).toBe(false);
  });

  it('a wrong sign inside applyAll rolls the whole batch back', () => {
    const { economy, updates } = setup();
    economy.ensureMember(GUILD, USER);
    economy.ensureMember(GUILD, OTHER_USER);
    updates.length = 0;
    const error = failure(() =>
      economy.applyAll([
        { guildId: GUILD, userId: USER, delta: -100, reason: 'transfer_out' },
        { guildId: GUILD, userId: OTHER_USER, delta: -100, reason: 'transfer_in' },
      ]),
    );
    expect(error).toBeInstanceOf(LedgerSignError);
    expect(economy.getBalance(GUILD, USER)).toBe(3000);
    expect(economy.getBalance(GUILD, OTHER_USER)).toBe(3000);
    expect(updates).toEqual([]);
  });

  it('a replayed key with the wrong sign is rejected, not replayed', () => {
    const { economy } = setup();
    const ok = {
      guildId: GUILD,
      userId: USER,
      delta: -10,
      reason: 'game_stake',
      idempotencyKey: 'k',
    } as const;
    economy.apply(ok);
    expect(failure(() => economy.apply({ ...ok, delta: 10 }))).toBeInstanceOf(LedgerSignError);
  });
});

describe('replay policy', () => {
  it('R-1: a replay-rejecting view refuses a spent key with conflict and moves nothing', () => {
    const { economy, store, updates } = setup();
    const strict = economy.rejectingReplays();
    const change = {
      guildId: GUILD,
      userId: USER,
      amount: 100,
      reason: 'company_invest',
      idempotencyKey: 'spent-key',
    } as const;
    expect(strict.debit(change).replayed).toBe(false);
    expect(strict.getBalance(GUILD, USER)).toBe(2900);
    updates.length = 0;
    const count = () =>
      (store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n;
    const before = count();

    const error = failure(() => strict.debit(change));
    expect(error.code).toBe('conflict');
    expect(count()).toBe(before);
    expect(economy.getBalance(GUILD, USER)).toBe(2900);
    expect(updates).toEqual([]);

    // the default service keeps returning the original entry (deterministic server keys)
    expect(economy.debit(change).replayed).toBe(true);
  });

  it('R-1: a rejected replay rolls back the surrounding transaction', () => {
    const { economy, store } = setup();
    const strict = economy.rejectingReplays();
    strict.credit({
      guildId: GUILD,
      userId: USER,
      amount: 50,
      reason: 'admin_grant',
      idempotencyKey: 'k1',
    });
    const error = failure(() =>
      store.transaction(() => {
        strict.credit({ guildId: GUILD, userId: USER, amount: 70, reason: 'admin_grant' });
        strict.credit({
          guildId: GUILD,
          userId: USER,
          amount: 50,
          reason: 'admin_grant',
          idempotencyKey: 'k1',
        });
      }),
    );
    expect(error.code).toBe('conflict');
    expect(economy.getBalance(GUILD, USER)).toBe(3050);
  });
});
