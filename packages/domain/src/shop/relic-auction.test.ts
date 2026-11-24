import { createSeededRng } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { RELIC_DROPS } from '../work/labor.ts';
import { RELIC_VALUE } from '../work/relics.ts';
import { pickRelic, RELIC_AUCTION_HOURS, RELIC_AUCTION_PER_DAY } from './teiai-market.ts';

describe('Teiai daily relic auction', () => {
  it('runs once a day for 24 hours', () => {
    expect(RELIC_AUCTION_PER_DAY).toBe(1);
    expect(RELIC_AUCTION_HOURS).toBe(24);
  });

  it('starts at the reference value of an unstarred relic', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 200; i++) {
      const pick = pickRelic(rng);
      expect(pick.itemId).toMatch(/^relic_[a-z]+$/);
      expect(pick.itemId).not.toMatch(/_s\d$/);
      expect(pick.startPrice).toBe(RELIC_VALUE[pick.itemId as keyof typeof RELIC_VALUE]);
    }
  });

  it('is deterministic for a seed', () => {
    const a = Array.from(
      { length: 20 },
      (
        (rng) => () =>
          pickRelic(rng).itemId
      )(createSeededRng(3)),
    );
    const b = Array.from(
      { length: 20 },
      (
        (rng) => () =>
          pickRelic(rng).itemId
      )(createSeededRng(3)),
    );
    expect(a).toEqual(b);
  });

  it('follows the dig odds: mostly fossils, the Dragon tear is rare', () => {
    const rng = createSeededRng(2026);
    const n = 100_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const id = pickRelic(rng).itemId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = RELIC_DROPS.reduce((s, d) => s + d.prob, 0);
    for (const d of RELIC_DROPS.slice(0, 4)) {
      expect((counts.get(d.item) ?? 0) / n).toBeCloseTo(d.prob / total, 1);
    }
    const share = (id: string) => (counts.get(id) ?? 0) / n;
    expect(share('relic_fossil')).toBeGreaterThan(0.5);
    expect(share('relic_fossil')).toBeLessThan(0.6);
    expect(share('relic_tear')).toBeLessThan(0.01);
  });

  it('every relic is reachable at the ends of the roll', () => {
    const at = (x: number) => pickRelic({ int: () => 0, float: () => x }).itemId;
    expect(at(0)).toBe('relic_fossil');
    expect(at(0.999999)).toBe('relic_tear');
  });
});
