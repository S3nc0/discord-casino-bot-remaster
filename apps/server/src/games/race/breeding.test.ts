import { createSeededRng, manualClock, type DomainEvent } from '@casino/shared';
import {
  BREED_COOLDOWN_MS,
  BREED_FEE,
  STAT_KEYS,
  foalStats,
  statSum,
  type Stats,
} from '@casino/domain/race';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IdentityRepo } from '../../db/identity.ts';
import { EconomyService } from '../../economy/economy-service.ts';
import { EventBus } from '../../runtime/bus.ts';
import { GUILD, memoryStore, OTHER_USER, USER } from '../../runtime/test-kit.ts';
import { createMemoryTeiai } from '../progression/ports.ts';
import { createNonCasinoGames } from '../progression/register.ts';
import { GameRuleError } from '../progression/context.ts';
import { foalRangeCacheSize, foalRanges } from './breeding.ts';

/** Monday 2025-01-06 07:30 JST. */
const MONDAY_0730 = 1_736_116_200_000;
const H = 3_600_000;

function harness(startingBalance?: number, seed = 7) {
  const store = memoryStore();
  const clock = manualClock(MONDAY_0730);
  const bus = new EventBus((e) => {
    throw e;
  });
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  identity.ensureGuild(GUILD, 'approved');
  const teiai = createMemoryTeiai();
  const games = createNonCasinoGames({
    store,
    economy,
    bus,
    clock,
    rng: createSeededRng(seed),
    teiai,
    offsetHours: 9,
  });
  const events: DomainEvent[] = [];
  bus.onAnyDomain((e) => events.push(e));
  economy.ensureMember(GUILD, USER);
  economy.ensureMember(GUILD, OTHER_USER);
  const topUp = (userId: string, amount: number): void => {
    economy.credit({
      guildId: GUILD,
      userId,
      amount,
      reason: 'admin_grant',
      idempotencyKey: `topup:${userId}:${amount}`,
    });
  };
  if (startingBalance !== undefined) {
    const have = economy.getBalance(GUILD, USER);
    if (startingBalance > have) topUp(USER, startingBalance - have);
    else if (startingBalance < have)
      economy.debit({
        guildId: GUILD,
        userId: USER,
        amount: have - startingBalance,
        reason: 'admin_revoke',
        idempotencyKey: 'trim',
      });
  }
  /** A voucher horse with a few races behind it. */
  const horse = (userId: string, name: string, races = 4): number => {
    games.shop.inventory.add(GUILD, userId, 'horse_voucher', 1);
    const v = games.race.createHorse(GUILD, userId, { name, coat: '鹿毛', silks: '🟥' });
    store.stmt('UPDATE horses SET races = ? WHERE id = ?').run(races, v.id);
    return v.id;
  };
  const breed = (a: number, b: number, key = 'k1', name = 'コウマ', userId = USER) =>
    games.breeding.breed({
      guildId: GUILD,
      userId,
      parentA: a,
      parentB: b,
      name,
      silks: '🟦',
      idempotencyKey: key,
    });
  const rule = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      if (e instanceof GameRuleError) return e.rule;
      throw e;
    }
    return 'no error';
  };
  const count = (table: string): number =>
    (store.stmt(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { store, clock, bus, economy, teiai, games, events, horse, breed, rule, count, topUp };
}

describe('scripted run: breed two horses, pay the fee, mature the foal', () => {
  it('writes one ledger row and one event, then lets the foal race at 48 h', () => {
    const h = harness();
    const { games, economy, clock, store } = h;
    h.topUp(USER, 20_000);
    const a = h.horse(USER, 'アルファ');
    const b = h.horse(USER, 'ブラボー');
    const before = economy.getBalance(GUILD, USER);

    const res = h.breed(a, b);
    expect(res.replayed).toBe(false);
    expect(res.fee).toBe(BREED_FEE);
    expect(economy.getBalance(GUILD, USER)).toBe(before - BREED_FEE);

    const rows = economy.history(GUILD, USER, 50).filter((e) => e.reason === 'horse_breeding_fee');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: -BREED_FEE,
      refType: 'horse_breeding',
      refId: String(res.breedingId),
    });

    const foalEvents = h.events.filter((e) => e.type === 'HorseFoaled');
    expect(foalEvents).toHaveLength(1);
    expect(foalEvents[0]).toMatchObject({
      type: 'HorseFoaled',
      guildId: GUILD,
      userId: USER,
      foalId: res.foal.id,
      foalName: 'コウマ',
      parentIds: [a, b],
      generation: 1,
      maturesAt: MONDAY_0730 + 48 * H,
      statTotal: statSum(res.foal.stats),
    });

    // parents carry the cooldown and a foal each; the foal starts clean and cheaper
    const parents = store
      .stmt('SELECT last_bred_at, foal_count FROM horses WHERE id IN (?, ?)')
      .all(a, b);
    expect(parents).toEqual([
      { last_bred_at: MONDAY_0730, foal_count: 1 },
      { last_bred_at: MONDAY_0730, foal_count: 1 },
    ]);
    const stable = games.race.stable(GUILD, USER);
    expect(stable).toHaveLength(3);
    const foal = stable.find((x) => x.id === res.foal.id)!;
    expect(foal).toMatchObject({
      races: 0,
      generation: 1,
      parentIds: [a, b],
      baseValue: BREED_FEE,
      maturesAt: MONDAY_0730 + 48 * H,
    });
    // net worth counts a foal at 15,000: 2 x 30,000 (races 4, no results: -8,000 each) + 15,000
    expect(games.race.horseValue(GUILD, USER)).toBe(2 * (30_000 - 8_000) + 15_000);

    // the same key replays the stored foal; nothing is charged twice
    const again = h.breed(a, b);
    expect(again).toMatchObject({ replayed: true, breedingId: res.breedingId });
    expect(again.foal.id).toBe(res.foal.id);
    expect(h.count('horse_breedings')).toBe(1);
    expect(economy.getBalance(GUILD, USER)).toBe(before - BREED_FEE);
    expect(h.events.filter((e) => e.type === 'HorseFoaled')).toHaveLength(1);

    // maturity: entries for Wednesday's 09:00 race open 07:00 and close 08:00
    clock.set(MONDAY_0730 + 48 * H - 1000);
    const raceId = games.race.ensureDay(GUILD)[0] as number;
    expect(h.rule(() => games.race.register(GUILD, USER, raceId, res.foal.id))).toBe(
      'foal_immature',
    );
    clock.set(MONDAY_0730 + 48 * H);
    games.race.register(GUILD, USER, raceId, res.foal.id);
    expect(games.race.card(raceId).race.status).toBe('entry');
  });
});

describe('breeding rules on the server', () => {
  it('fee: exactly 15,000 ends at 0; 14,999 writes nothing', () => {
    const exact = harness(BREED_FEE);
    const a = exact.horse(USER, 'A');
    const b = exact.horse(USER, 'B');
    expect(exact.economy.getBalance(GUILD, USER)).toBe(BREED_FEE);
    exact.breed(a, b);
    expect(exact.economy.getBalance(GUILD, USER)).toBe(0);

    const short = harness(BREED_FEE - 1);
    const c = short.horse(USER, 'A');
    const d = short.horse(USER, 'B');
    expect(short.rule(() => short.breed(c, d))).toBe('breed_fee_short');
    expect(short.count('horse_breedings')).toBe(0);
    expect(short.games.race.stable(GUILD, USER)).toHaveLength(2);
    expect(short.economy.getBalance(GUILD, USER)).toBe(BREED_FEE - 1);
  });

  it('rejects debt, a full stable, same horse, other owner, cooldown and the foal limit', () => {
    const h = harness();
    h.topUp(USER, 100_000);
    const a = h.horse(USER, 'A');
    const b = h.horse(USER, 'B');
    const other = h.horse(OTHER_USER, 'C');

    expect(h.rule(() => h.breed(a, a, 'x1'))).toBe('same_horse');
    expect(h.rule(() => h.breed(a, other, 'x2'))).toBe('select_own');
    h.teiai.setDebt(GUILD, USER, 1);
    expect(h.rule(() => h.breed(a, b, 'x3'))).toBe('in_debt');
    h.teiai.setDebt(GUILD, USER, 0);

    h.store.stmt('UPDATE horses SET races = 3 WHERE id = ?').run(a);
    expect(h.rule(() => h.breed(a, b, 'x4'))).toBe('min_races');
    h.store.stmt('UPDATE horses SET races = 4 WHERE id = ?').run(a);

    const third = h.horse(USER, 'Third', 0);
    expect(h.rule(() => h.breed(a, b, 'x5', 'ニ'))).toBe('stable_full');
    h.store.stmt('UPDATE horses SET owner_id = NULL WHERE id = ?').run(third);
    const first = h.breed(a, b, 'ok1');
    h.store.stmt('UPDATE horses SET owner_id = NULL WHERE id = ?').run(first.foal.id);
    expect(h.rule(() => h.breed(a, b, 'x6', 'ニ'))).toBe('cooldown');

    h.clock.advance(BREED_COOLDOWN_MS - 1);
    expect(h.rule(() => h.breed(a, b, 'x7', 'ニ'))).toBe('cooldown');
    h.clock.advance(1);
    h.breed(a, b, 'ok2', 'ニ');
    h.store.stmt('UPDATE horses SET owner_id = NULL WHERE name = ?').run('ニ');
    h.clock.advance(BREED_COOLDOWN_MS);
    expect(h.rule(() => h.breed(a, b, 'x8', 'サン'))).toBe('foal_limit');
    expect(h.count('horse_breedings')).toBe(2);
  });

  it('an immature foal cannot breed, and a bred horse breeds once mature', () => {
    const h = harness();
    h.topUp(USER, 100_000);
    const a = h.horse(USER, 'A');
    const b = h.horse(USER, 'B');
    const f = h.breed(a, b).foal.id;
    h.store.stmt('UPDATE horses SET owner_id = NULL WHERE id = ?').run(b);
    h.store.stmt('UPDATE horses SET races = 4 WHERE id = ?').run(f);
    h.clock.advance(72 * H);
    // 72 h: the parents are cool, the foal is mature (48 h)
    expect(h.breed(a, f, 'k2', 'マゴ').foal.generation).toBe(2);
  });

  it('feature off blocks new breedings only', () => {
    const h = harness();
    h.topUp(USER, 100_000);
    const a = h.horse(USER, 'A');
    const b = h.horse(USER, 'B');
    h.store
      .stmt(`INSERT INTO guild_features_off (guild_id, feature) VALUES (?, 'horse')`)
      .run(GUILD);
    expect(h.rule(() => h.breed(a, b))).toBe('feature_disabled');
  });

  it('a different body under a used key is rejected', () => {
    const h = harness();
    h.topUp(USER, 100_000);
    const a = h.horse(USER, 'A');
    const b = h.horse(USER, 'B');
    h.breed(a, b, 'same');
    expect(h.rule(() => h.breed(b, a, 'same'))).toBe('idempotency_key_reused');
  });

  it('keeps the ledger consistent: one -15,000 sink row and a balanced supply', () => {
    const h = harness();
    h.topUp(USER, 20_000);
    const a = h.horse(USER, 'A');
    const b = h.horse(USER, 'B');
    const res = h.breed(a, b);
    const sum = (
      h.store
        .stmt('SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE user_id = ?')
        .get(USER) as { s: number }
    ).s;
    expect(sum).toBe(h.economy.getBalance(GUILD, USER));
    expect(
      h.store
        .stmt(`SELECT delta FROM ledger WHERE reason = 'horse_breeding_fee' AND ref_id = ?`)
        .all(String(res.breedingId)),
    ).toEqual([{ delta: -BREED_FEE }]);
  });
});

describe('breeding properties', () => {
  it('never makes a balance negative and only charges when a foal is born', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40_000 }), fc.boolean(), (balance, indebted) => {
        const h = harness(balance);
        const a = h.horse(USER, 'A');
        const b = h.horse(USER, 'B');
        if (indebted) h.teiai.setDebt(GUILD, USER, 500);
        const before = h.economy.getBalance(GUILD, USER);
        let born = false;
        try {
          h.breed(a, b);
          born = true;
        } catch (e) {
          expect(e).toBeInstanceOf(GameRuleError);
        }
        const after = h.economy.getBalance(GUILD, USER);
        expect(after).toBeGreaterThanOrEqual(0);
        expect(born).toBe(before >= BREED_FEE && !indebted);
        expect(after).toBe(born ? before - BREED_FEE : before);
        expect(h.count('horse_breedings')).toBe(born ? 1 : 0);
        expect(h.games.race.stable(GUILD, USER)).toHaveLength(born ? 3 : 2);
      }),
      { numRuns: 60 },
    );
  });

  it('foals stay within the stat bounds for any seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const h = harness(20_000, seed);
        const a = h.horse(USER, 'A');
        const b = h.horse(USER, 'B');
        h.store
          .stmt('UPDATE horses SET speed = 80, stamina = 40, power = 40, guts = 40 WHERE id = ?')
          .run(a);
        const t = statSum(h.breed(a, b).foal.stats);
        expect(t).toBeGreaterThanOrEqual(190);
        expect(t).toBeLessThanOrEqual(210);
      }),
      { numRuns: 30 },
    );
  });
});

/** The old preview: every roll of `foalStats` itself (5 x 15^4). */
function sweepFoalStats(a: Stats, b: Stats) {
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, { min: Infinity, max: -Infinity }]));
  const total = { min: Infinity, max: -Infinity };
  const offsets = Array.from({ length: 15 }, (_, i) => i - 7);
  for (const draw of [0, 1, 3, 7, 9])
    for (const o1 of offsets)
      for (const o2 of offsets)
        for (const o3 of offsets)
          for (const o4 of offsets) {
            const script = [draw, o1, o2, o3, o4];
            let i = 0;
            const foal = foalStats(a, b, { int: () => script[i++] as number, float: () => 0 });
            const sum = statSum(foal);
            total.min = Math.min(total.min, sum);
            total.max = Math.max(total.max, sum);
            for (const k of STAT_KEYS) {
              const r = stats[k] as { min: number; max: number };
              r.min = Math.min(r.min, foal[k]);
              r.max = Math.max(r.max, foal[k]);
            }
          }
  return { total, stats };
}

describe('breeding preview', () => {
  it('R-8: refuses a pair with a horse the caller does not own, without its stats', () => {
    const h = harness(20_000);
    const a = h.horse(USER, 'A');
    const b = h.horse(USER, 'B');
    const other = h.horse(OTHER_USER, 'C');
    expect(h.rule(() => h.games.breeding.preview(GUILD, USER, a, other))).toBe('select_own');
    expect(h.rule(() => h.games.breeding.preview(GUILD, USER, other, a))).toBe('select_own');
    expect(h.games.breeding.preview(GUILD, USER, a, b).eligible).toEqual({ ok: true });
  });

  it('R-8: the ranges match every roll of foalStats', () => {
    const pairs: [Stats, Stats][] = [
      [
        { speed: 50, stamina: 50, power: 50, guts: 50 },
        { speed: 50, stamina: 50, power: 50, guts: 50 },
      ],
      [
        { speed: 80, stamina: 40, power: 40, guts: 40 },
        { speed: 50, stamina: 50, power: 50, guts: 50 },
      ],
      [
        { speed: 80, stamina: 80, power: 25, guts: 20 },
        { speed: 75, stamina: 80, power: 30, guts: 25 },
      ],
      [
        { speed: 20, stamina: 20, power: 80, guts: 80 },
        { speed: 35, stamina: 55, power: 65, guts: 45 },
      ],
      [
        { speed: 60, stamina: 65, power: 55, guts: 40 },
        { speed: 45, stamina: 70, power: 60, guts: 35 },
      ],
    ];
    for (const [a, b] of pairs)
      expect(foalRanges(a, b), JSON.stringify([a, b])).toEqual(sweepFoalStats(a, b));
  });

  it('R-8: the range cache is bounded and keeps what was used last', () => {
    const kept = { speed: 50, stamina: 50, power: 50, guts: 50 };
    const first = foalRanges(kept, kept);
    for (let i = 0; i < 200; i++) {
      const s = 20 + 5 * (i % 13);
      foalRanges({ speed: s, stamina: 20 + 5 * Math.floor(i / 13), power: 50, guts: 50 }, kept);
      expect(foalRanges(kept, kept)).toBe(first);
    }
    expect(foalRangeCacheSize()).toBeLessThanOrEqual(128);
  });
});
