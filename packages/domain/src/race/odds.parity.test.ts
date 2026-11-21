import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeAllOdds, makeOdds, isHit, ticketPayout, type BetKind } from './odds.ts';
import type { Runner } from './sim.ts';

const fx = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/legacy/horse/races.json', import.meta.url),
    'utf8',
  ),
);
const runners: Runner[] = fx.runners;

describe('odds (legacy parity)', () => {
  it('record-only odds of the equal-ability field', () => {
    const odds = makeOdds(runners, fx.track, { sims: 0 });
    expect(odds.map(([w, p]) => [w / 10, p / 10])).toEqual(fx.make_odds);
  });

  it('blended win/place odds with the fixed-seed simulation', () => {
    const all = makeAllOdds(runners, fx.track);
    for (const lane of Object.keys(fx.make_all_odds_win_place.win)) {
      expect((all.win[lane] as number) / 10).toBe(fx.make_all_odds_win_place.win[lane]);
      expect((all.place[lane] as number) / 10).toBe(fx.make_all_odds_win_place.place[lane]);
    }
  });

  it('pays floor(stake * odds)', () => {
    expect(ticketPayout(1000, 43)).toBe(fx.payout_1000_at_4_3);
  });

  it('ticket hits follow the legacy rules', () => {
    // The fixture orders runner indexes; the hit rules are order-based, so feed them as lanes.
    const order: number[] = fx.simulation.order;
    for (const c of fx.combo_checks as { kind: string; lanes: number[]; hit: boolean }[]) {
      // Legacy returned false for win/place (a list was compared with an int) and for the
      // trifecta, which it did not know. The remaining five kinds replay exactly.
      if (c.kind === 'win' || c.kind === 'place' || c.kind === 'trifecta') continue;
      expect(isHit(c.kind as BetKind, c.lanes, order)).toBe(c.hit);
    }
    expect(isHit('win', [order[0] as number], order)).toBe(true);
    expect(isHit('place', [order[2] as number], order)).toBe(true);
    expect(isHit('trifecta', [4, 2, 0], order)).toBe(true);
    expect(isHit('trifecta', [4, 0, 2], order)).toBe(false);
  });
});
