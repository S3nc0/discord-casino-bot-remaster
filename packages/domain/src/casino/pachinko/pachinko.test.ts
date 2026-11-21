import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pyRandom } from '../testing/pyrandom.ts';
import {
  OMEN_TABLE,
  PACHINKO_PROFILE,
  TIER_TABLE,
  clampSets,
  hitProbability,
  hitRate,
  play,
  rollRounds,
  rollSet,
  rollSpin,
  rtp,
  type Omen,
  type Tier,
} from './index.ts';

interface SpinFx {
  hit: boolean;
  hit_prob: number;
  omen: string;
  tier: string;
  rounds: number[];
}
interface Fixture {
  seed: number;
  stats: {
    hit_rate: number;
    hit_rate_by_omen: Record<string, number>;
    hit_rate_by_tier: Record<string, number>;
    mean_hit_prob: number;
    rtp: number;
  };
  seeded_spins: SpinFx[];
  seeded_sets: { raw: number; starts: number; spins: SpinFx[] }[];
  seeded_round_rolls: number[][];
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/legacy/pachinko/spins.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

const asFx = (s: ReturnType<typeof rollSpin>): SpinFx => ({
  hit: s.hit,
  hit_prob: s.hitProb,
  omen: s.omen,
  tier: s.tier,
  rounds: s.rounds,
});
const near = (s: SpinFx): SpinFx => ({ ...s, hit_prob: Math.round(s.hit_prob * 1e10) / 1e10 });

describe('pachinko parity with the legacy fixtures', () => {
  // The generator drew the three sections from one Random(seed), in this order.
  it('replays the 30 seeded spins, 8 seeded sets and 15 round chains from one stream', () => {
    const rng = pyRandom(fixture.seed);
    const spins = fixture.seeded_spins.map(() => near(asFx(rollSpin(rng))));
    expect(spins).toEqual(fixture.seeded_spins.map(near));
    for (const expected of fixture.seeded_sets) {
      const set = rollSet(rng);
      expect(set.starts).toBe(expected.starts);
      expect(set.raw).toBe(expected.raw);
      expect(set.spins.map((s) => near(asFx(s)))).toEqual(expected.spins.map(near));
    }
    for (const expected of fixture.seeded_round_rolls) expect(rollRounds(rng)).toEqual(expected);
  });

  it('has the legacy hit probabilities, hit rate and RTP', () => {
    expect(rtp()).toBeCloseTo(fixture.stats.rtp, 9);
    expect(hitRate()).toBeCloseTo(fixture.stats.hit_rate, 9);
    expect(PACHINKO_PROFILE.w).toBeCloseTo(fixture.stats.rtp - fixture.stats.hit_rate, 9);
    expect(hitProbability('', '')).toBeCloseTo(0.00022, 12);
    // Hit rate given the omen (tier averaged) and given the tier (omen averaged).
    const meanTier = TIER_TABLE.reduce((s, t) => s + t.prob * t.bonus, 0);
    const meanOmen = OMEN_TABLE.reduce((s, o) => s + o.prob * o.bonus, 0);
    for (const o of OMEN_TABLE) {
      const p = hitProbability(o.key as Omen, '') + meanTier;
      expect(p).toBeCloseTo(fixture.stats.hit_rate_by_omen[o.key] as number, 9);
    }
    for (const t of TIER_TABLE) {
      const p = hitProbability('', t.key as Tier) + meanOmen;
      expect(p).toBeCloseTo(fixture.stats.hit_rate_by_tier[t.key] as number, 9);
    }
    expect(fixture.stats.mean_hit_prob).toBe(0.01322);
  });
});

describe('pachinko play', () => {
  it('clamps the set count and stakes bet × sets', () => {
    expect(clampSets(0)).toBe(1);
    expect(clampSets(99)).toBe(10);
    expect(clampSets(3.9)).toBe(3);
    const r = play(pyRandom(1), 100, 25, 3);
    expect(r.sets).toHaveLength(10);
    expect(r.total).toBe(1000);
  });

  it('applies the RTP level per set, then sums', () => {
    const base = play(pyRandom(11), 1000, 10, 3);
    const high = play(pyRandom(11), 1000, 10, 6);
    expect(base.payout).toBe(base.rawPayout);
    expect(high.rawPayout).toBe(base.rawPayout);
    if (base.rawPayout > 1000) expect(high.payout).toBeGreaterThan(base.payout);
  });

  it('pays back about its RTP over many sets', () => {
    const rng = pyRandom(2024);
    let paid = 0;
    const n = 40_000;
    for (let i = 0; i < n; i++) paid += rollSet(rng).raw;
    expect(paid / n).toBeGreaterThan(0.9);
    expect(paid / n).toBeLessThan(1.05);
  });
});
