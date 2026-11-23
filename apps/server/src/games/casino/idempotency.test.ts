import { describe, expect, it } from 'vitest';
import { manualClock } from '@casino/shared';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { AppError } from '../../runtime/errors.ts';
import { GUILD, START_MS, USER, memoryStore } from '../../runtime/test-kit.ts';
import { IdempotencyStore } from './idempotency.ts';

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const store = memoryStore();
  const clock = manualClock(START_MS);
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock });
  const idem = new IdempotencyStore(store, clock);
  economy.ensureMember(GUILD, USER);
  return { store, clock, economy, idem };
}

const who = { guildId: GUILD, userId: USER };
const KEY = 'client-key-000000001';

const failure = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
};

describe('IdempotencyStore', () => {
  it('replays the stored response within the window', () => {
    const { idem } = setup();
    let runs = 0;
    expect(idem.run(who, KEY, 's', { a: 1 }, () => ++runs)).toEqual({
      response: 1,
      replayed: false,
    });
    expect(idem.run(who, KEY, 's', { a: 1 }, () => ++runs)).toEqual({
      response: 1,
      replayed: true,
    });
    expect(runs).toBe(1);
  });

  it('R-1: a purged key whose ledger rows remain is conflict and the work never runs again', () => {
    const { idem, clock, economy } = setup();
    let runs = 0;
    const spend = (key: string) => () => {
      runs += 1;
      economy.debit({
        ...who,
        amount: 100,
        reason: 'company_invest',
        idempotencyKey: `${key}:buy`,
      });
      return runs;
    };
    idem.run(who, KEY, 's', {}, spend(KEY));
    clock.advance(DAY + 1);
    expect(idem.purge()).toBe(1);

    expect(failure(() => idem.run(who, KEY, 's', {}, spend(KEY))).code).toBe('conflict');
    expect(runs).toBe(1);
    expect(economy.getBalance(GUILD, USER)).toBe(2900);

    // the raw key in the ledger counts too
    const raw = 'client-key-000000002';
    idem.run(who, raw, 's', {}, () =>
      economy.debit({ ...who, amount: 1, reason: 'company_invest', idempotencyKey: raw }),
    );
    clock.advance(DAY + 1);
    idem.purge();
    expect(failure(() => idem.run(who, raw, 's', {}, () => 0)).code).toBe('conflict');
  });

  it('R-1: a purged key without ledger rows (or a longer key sharing its prefix) runs as new', () => {
    const { idem, clock, economy } = setup();
    idem.run(who, KEY, 's', {}, () => 1);
    clock.advance(DAY + 1);
    idem.purge();
    expect(idem.run(who, KEY, 's', {}, () => 2)).toEqual({ response: 2, replayed: false });

    economy.debit({ ...who, amount: 1, reason: 'company_invest', idempotencyKey: `${KEY}9:buy` });
    economy.debit({ ...who, amount: 1, reason: 'company_invest', idempotencyKey: `${KEY}-x` });
    clock.advance(DAY + 1);
    idem.purge();
    expect(idem.run(who, KEY, 's', {}, () => 3)).toEqual({ response: 3, replayed: false });
  });
});
