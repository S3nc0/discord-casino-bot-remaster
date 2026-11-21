import { createSeededRng, manualClock } from '@casino/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BREED_COOLDOWN_MS,
  BREED_FEE,
  breedFoal,
  checkBreeding,
  FOAL_MATURITY_MS,
  foalStats,
  HOUR_MS,
  type BreedParent,
  type BreederState,
} from './breed.ts';
import { addGoldCarrot, STAT_KEYS, statSum, TOTAL_CAP, type Stats } from './horse.ts';

const NOW = 1_800_000_000_000;
const USER = '123456789012345678';

/** Four multiples of 5 in 20..80 with a total in 190..210. */
const statsArb = fc
  .tuple(
    fc.integer({ min: 4, max: 16 }),
    fc.integer({ min: 4, max: 16 }),
    fc.integer({ min: 4, max: 16 }),
    fc.integer({ min: 4, max: 16 }),
  )
  .map(([a, b, c, d]) => ({ speed: a * 5, stamina: b * 5, power: c * 5, guts: d * 5 }) as Stats)
  .filter((s) => statSum(s) >= 190 && statSum(s) <= 210);

function parent(id: number, stats: Stats, over: Partial<BreedParent> = {}): BreedParent {
  return {
    id,
    ownerId: USER,
    name: `Horse${id}`,
    stats,
    coat: '栗毛',
    races: 4,
    generation: 0,
    maturesAt: null,
    lastBredAt: null,
    foalCount: 0,
    ...over,
  };
}
const FLAT: Stats = { speed: 50, stamina: 50, power: 50, guts: 50 };
const breeder = (over: Partial<BreederState> = {}): BreederState => ({
  userId: USER,
  balance: BREED_FEE,
  debt: 0,
  horseCount: 2,
  ...over,
});
const ctx = (seed: number, at = NOW) => ({ rng: createSeededRng(seed), clock: manualClock(at) });

function valid(s: Stats): boolean {
  const total = statSum(s);
  return (
    STAT_KEYS.every((k) => s[k] % 5 === 0 && s[k] >= 20 && s[k] <= 80) &&
    total >= 190 &&
    total <= 210 &&
    total <= TOTAL_CAP
  );
}

describe('foalStats properties', () => {
  it('stays on the grid and inside 190..210 for any valid parents', () => {
    fc.assert(
      fc.property(statsArb, statsArb, fc.integer(), (a, b, seed) => {
        expect(valid(foalStats(a, b, createSeededRng(seed)))).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('is deterministic for the same seed and parents', () => {
    fc.assert(
      fc.property(statsArb, statsArb, fc.integer(), (a, b, seed) => {
        expect(foalStats(a, b, createSeededRng(seed))).toEqual(
          foalStats(a, b, createSeededRng(seed)),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('gives the same total distribution when parents are swapped', () => {
    const a: Stats = { speed: 80, stamina: 40, power: 45, guts: 45 };
    const b: Stats = { speed: 40, stamina: 80, power: 45, guts: 45 };
    const sum = (x: Stats, y: Stats): number => {
      const rng = createSeededRng(11);
      let t = 0;
      for (let i = 0; i < 2000; i++) t += statSum(foalStats(x, y, rng));
      return t / 2000;
    };
    expect(Math.abs(sum(a, b) - sum(b, a))).toBeLessThan(0.7);
  });

  it('does not drift upward under random pairing (400 horses, 50 generations)', () => {
    const rng = createSeededRng(2024);
    let pop: Stats[] = Array.from({ length: 400 }, () => ({ ...FLAT, speed: 50 }));
    for (let g = 0; g < 50; g++) {
      pop = pop.map(() =>
        foalStats(pop[rng.int(0, pop.length)] as Stats, pop[rng.int(0, pop.length)] as Stats, rng),
      );
    }
    const mean = (f: (s: Stats) => number): number =>
      pop.reduce((t, s) => t + f(s), 0) / pop.length;
    expect(Math.abs(mean(statSum) - 200)).toBeLessThanOrEqual(2);
    for (const k of STAT_KEYS) expect(Math.abs(mean((s) => s[k]) - 50)).toBeLessThanOrEqual(2);
    expect(pop.every(valid)).toBe(true);
  });

  it('stays bounded when always breeding the top 10% by total', () => {
    const rng = createSeededRng(77);
    let pop: Stats[] = Array.from({ length: 400 }, () => ({ ...FLAT }));
    for (let g = 0; g < 50; g++) {
      const top = [...pop].sort((x, y) => statSum(y) - statSum(x)).slice(0, 40);
      pop = pop.map(() =>
        foalStats(top[rng.int(0, top.length)] as Stats, top[rng.int(0, top.length)] as Stats, rng),
      );
    }
    expect(Math.max(...pop.map(statSum))).toBeLessThanOrEqual(210);
    expect(pop.reduce((t, s) => t + statSum(s), 0) / pop.length).toBeLessThanOrEqual(206);
    expect(pop.every(valid)).toBe(true);
  });
});

describe('eligibility', () => {
  const a = parent(1, FLAT);
  const b = parent(2, FLAT);
  const check = (x: BreedParent, y: BreedParent, br = breeder()) =>
    checkBreeding({ a: x, b: y, name: 'Foal', silks: '🟥' }, br, NOW);

  it('accepts two eligible horses', () => {
    expect(check(a, b)).toEqual({ ok: true, name: 'Foal' });
  });
  it.each([
    ['3 races', { races: 3 }, 'min_races'],
    ['32 races', { races: 32 }, 'retired_by_age'],
    ['foal_count 2', { foalCount: 2 }, 'foal_limit'],
    ['another owner', { ownerId: 'x' }, 'not_owner'],
    ['immature', { maturesAt: NOW + 1 }, 'immature'],
    ['cooldown 71h59m', { lastBredAt: NOW - BREED_COOLDOWN_MS + 60_000 }, 'cooldown'],
  ] as const)('rejects %s', (_n, over, error) => {
    expect(check(parent(1, FLAT, over), b)).toMatchObject({ ok: false, error });
  });
  it('allows the exact cooldown and maturity boundaries', () => {
    const edge = parent(1, FLAT, { lastBredAt: NOW - BREED_COOLDOWN_MS, maturesAt: NOW });
    expect(check(edge, b).ok).toBe(true);
  });
  it('rejects the same horse twice, debt, a full stable and a short balance', () => {
    expect(check(a, a)).toMatchObject({ error: 'same_horse' });
    expect(check(a, b, breeder({ debt: 1 }))).toMatchObject({ error: 'in_debt' });
    expect(check(a, b, breeder({ horseCount: 3 }))).toMatchObject({ error: 'stable_full' });
    expect(check(a, b, breeder({ balance: BREED_FEE - 1 }))).toMatchObject({
      error: 'insufficient_funds',
    });
  });
  it('validates the name and silks', () => {
    const r = (name: string, silks = '🟥') => checkBreeding({ a, b, name, silks }, breeder(), NOW);
    expect(r('')).toMatchObject({ error: 'name_empty' });
    expect(r('http')).toMatchObject({ error: 'name_invalid_chars' });
    expect(r('x'.repeat(13))).toMatchObject({ error: 'name_too_long' });
    expect(r('ok', 'z')).toMatchObject({ error: 'invalid_look' });
  });
});

describe('breedFoal', () => {
  it('builds a generation-1 foal that matures 48 h later', () => {
    const a = parent(1, FLAT, { generation: 2 });
    const b = parent(2, FLAT, { coat: '黒鹿毛' });
    const res = breedFoal({ a, b, name: ' Foal ', silks: '🟦' }, breeder(), ctx(5));
    if (!res.ok) throw new Error('expected ok');
    const f = res.outcome.state;
    expect(f).toMatchObject({
      name: 'Foal',
      silks: '🟦',
      generation: 3,
      parentAId: 1,
      parentBId: 2,
      foaledAt: NOW,
      maturesAt: NOW + FOAL_MATURITY_MS,
      baseValue: 15_000,
      fee: 15_000,
    });
    expect(FOAL_MATURITY_MS).toBe(48 * HOUR_MS);
    expect(valid(f.stats)).toBe(true);
  });

  it('inherits the coat 45/45/10', () => {
    const a = parent(1, FLAT, { coat: '栗毛' });
    const b = parent(2, FLAT, { coat: '白毛' });
    const rng = createSeededRng(3);
    const seen = { a: 0, b: 0, other: 0 };
    for (let i = 0; i < 4000; i++) {
      const res = breedFoal({ a, b, name: 'F', silks: '🟥' }, breeder(), {
        rng,
        clock: manualClock(NOW),
      });
      if (!res.ok) throw new Error('expected ok');
      const c = res.outcome.state.coat;
      if (c === '栗毛') seen.a++;
      else if (c === '白毛') seen.b++;
      else seen.other++;
    }
    expect(seen.a / 4000).toBeGreaterThan(0.4);
    expect(seen.b / 4000).toBeGreaterThan(0.4);
    expect(seen.other / 4000).toBeGreaterThan(0.05);
    expect(seen.other / 4000).toBeLessThan(0.12);
  });
});

describe('gold carrot total cap', () => {
  it('fails on a 205 horse and succeeds on 200 up to 210', () => {
    const t205: Stats = { speed: 55, stamina: 50, power: 50, guts: 50 };
    expect(addGoldCarrot(t205, 'speed', 'guts')).toEqual({
      ok: false,
      error: 'gold_carrot_total_cap',
    });
    const r = addGoldCarrot(FLAT, 'speed', 'guts');
    expect(r.ok && statSum(r.stats)).toBe(210);
  });
});
