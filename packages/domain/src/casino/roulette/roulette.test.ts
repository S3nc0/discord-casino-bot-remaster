import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pyRandom } from '../testing/pyrandom.ts';
import {
  BET_KINDS,
  colorOf,
  payoutOf,
  rouletteProfile,
  spin,
  spinTimeline,
  validateBet,
  wins,
  type RouletteBet,
} from './index.ts';

interface Fixture {
  seed: number;
  colors: Record<string, string>;
  rtps: Record<string, number>;
  bet_checks: {
    result: number;
    color: string;
    bets: Record<string, { payout_1000: number; wins: boolean }>;
  }[];
  seeded_spins: { number: number; color: string }[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/legacy/roulette/spins.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

const JA = { green: '緑', red: '赤', black: '黒' } as const;
const parse = (spec: string): RouletteBet =>
  spec.startsWith('number:')
    ? { kind: 'number', number: Number(spec.slice(7)) }
    : ({ kind: spec } as RouletteBet);

describe('roulette parity with the legacy fixtures', () => {
  it('colors all 37 pockets', () => {
    for (let n = 0; n <= 36; n++) expect(JA[colorOf(n)]).toBe(fixture.colors[String(n)]);
  });

  it('wins and pays every bet spec on every listed outcome', () => {
    for (const check of fixture.bet_checks) {
      expect(JA[colorOf(check.result)]).toBe(check.color);
      for (const [spec, expected] of Object.entries(check.bets)) {
        const bet = parse(spec);
        expect(wins(bet, check.result)).toBe(expected.wins);
        expect(payoutOf(bet, 1000, check.result)).toBe(expected.payout_1000);
      }
    }
  });

  it('replays the 30 seeded spins', () => {
    const rng = pyRandom(fixture.seed);
    for (const expected of fixture.seeded_spins) {
      const n = spin(rng);
      expect(n).toBe(expected.number);
      expect(JA[colorOf(n)]).toBe(expected.color);
    }
  });

  it('has 36/37 RTP for every bet kind', () => {
    for (const kind of BET_KINDS) {
      expect(rouletteProfile(kind).rtp).toBeCloseTo(fixture.rtps[kind] as number, 9);
    }
    expect(rouletteProfile('dozen1').w).toBeCloseTo(24 / 37, 12);
    expect(rouletteProfile('number').w).toBeCloseTo(35 / 37, 12);
    expect(rouletteProfile('red').w).toBeCloseTo(18 / 37, 12);
  });
});

describe('roulette bets', () => {
  it('validates number rules before any money moves', () => {
    expect(validateBet({ kind: 'number', number: 0 })).toEqual({ kind: 'number', number: 0 });
    expect(validateBet({ kind: 'number', number: 36 })).toEqual({ kind: 'number', number: 36 });
    expect(validateBet({ kind: 'number' })).toBeNull();
    expect(validateBet({ kind: 'number', number: 37 })).toBeNull();
    expect(validateBet({ kind: 'number', number: 1.5 })).toBeNull();
    expect(validateBet({ kind: 'red', number: 3 })).toBeNull();
    expect(validateBet({ kind: 'split' })).toBeNull();
  });

  it('zero loses every outside bet', () => {
    for (const kind of BET_KINDS.filter((k) => k !== 'number')) {
      expect(wins({ kind }, 0)).toBe(false);
    }
  });

  it('builds a timeline that ends on the real pocket', () => {
    const t = spinTimeline(pyRandom(3), 17);
    expect(t.map((f) => f.kind)).toEqual(['start', 'bounce', 'slow', 'result']);
    expect(t.at(-1)).toEqual({ atMs: 2700, kind: 'result', pocket: 17 });
  });
});
