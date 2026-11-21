import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PyRandom } from '../progression/py-random.ts';
import {
  generateFighters,
  simulateMatch,
  matchOdds,
  settleMatch,
  weaponBonus,
  type MatchBet,
} from './arena.ts';

const fx = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/legacy/arena/tournaments.json', import.meta.url),
    'utf8',
  ),
);

describe('arena (legacy parity)', () => {
  it('generates fighters with the legacy name and power draws', () => {
    const rng = new PyRandom(fx.seeds.gen);
    const duel = generateFighters('duel', rng);
    expect(duel.map(({ name, basePower }) => ({ name, base_power: basePower }))).toEqual(
      fx.fighters_duel,
    );
    const royale = generateFighters('royale', rng);
    expect(royale.map(({ name, basePower }) => ({ name, base_power: basePower }))).toEqual(
      fx.fighters_royale,
    );
  });

  it('computes semi-final odds', () => {
    for (const [format, table] of [
      ['duel', fx.odds_duel],
      ['royale', fx.odds_royale],
    ] as const) {
      const fighters = (format === 'duel' ? fx.fighters_duel : fx.fighters_royale).map(
        (f: { name: string; base_power: number }) => ({
          name: f.name,
          basePower: f.base_power,
          betTotal: 0,
        }),
      );
      const odds = matchOdds(fighters, false);
      fighters.forEach((f: { name: string }, i: number) => {
        expect((odds[i] as number) / 100).toBe(table[f.name]);
      });
    }
  });

  it('match simulation picks the fixture winner (the fixture does not record its inputs; a two-fighter semi group reproduces it)', () => {
    const fighters = fx.fighters_duel
      .slice(0, 2)
      .map((f: { base_power: number }) => ({ basePower: f.base_power, betTotal: 0 }));
    expect(simulateMatch(fighters, new PyRandom(fx.seeds.sim))).toBe(fx.sim_winner_idx);
  });

  it('weapon bonus', () => {
    for (const [total, bonus] of Object.entries(fx.weapon_bonus)) {
      expect(weaponBonus(Number(total))).toBeCloseTo(bonus as number, 10);
    }
  });

  it('settlement: full pool and capped by the bank subsidy', () => {
    const odds = new Map([[1, 250]]);
    const full: MatchBet[] = [
      { id: 1, userId: '200000000000000001', fighterId: 1, amount: 1000 },
      { id: 2, userId: '200000000000000002', fighterId: 1, amount: 2000 },
      { id: 3, userId: null, fighterId: 2, amount: 10_000 },
    ];
    const a = settleMatch({
      bets: full,
      winnerIds: new Set([1]),
      oddsHundredths: odds,
      bankCash: 100_000,
    });
    expect(a.payouts.map((p) => p.payout)).toEqual(fx.settle_payouts_full[0]);
    expect(a.subsidy).toBe(fx.settle_payouts_full[1]);
    expect(a.leftover).toBe(fx.settle_payouts_full[2]);

    const capped: MatchBet[] = [
      { id: 1, userId: '200000000000000001', fighterId: 1, amount: 10_000 },
      { id: 2, userId: '200000000000000002', fighterId: 1, amount: 10_000 },
    ];
    const b = settleMatch({
      bets: capped,
      winnerIds: new Set([1]),
      oddsHundredths: odds,
      bankCash: 100_000,
    });
    expect(b.payouts.map((p) => p.payout)).toEqual(fx.settle_payouts_capped[0]);
    expect(b.subsidy).toBe(fx.settle_payouts_capped[1]);
    expect(b.leftover).toBe(fx.settle_payouts_capped[2]);
  });

  it('payout scale is pool over due', () => {
    const odds = new Map([[1, 350]]);
    const bets: MatchBet[] = [
      { id: 1, userId: '200000000000000001', fighterId: 1, amount: 10_000 },
      { id: 2, userId: null, fighterId: 2, amount: 10_000 },
    ];
    const r = settleMatch({ bets, winnerIds: new Set([1]), oddsHundredths: odds, bankCash: 0 });
    expect(r.scale).toBeCloseTo(0.4, 10);
  });
});
