import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PyRandom } from '../progression/py-random.ts';
import { drawLottery, randomFee, validateJoin } from './lottery.ts';

const fx = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/legacy/lottery/draws.json', import.meta.url),
    'utf8',
  ),
);

describe('lottery (legacy parity)', () => {
  it('draws the seeded winner and pays the whole pot', () => {
    const draw = fx.normal_draw.closed;
    const ids = draw.entries.map(String);
    const r = drawLottery(ids, draw.fee, new PyRandom(fx.seeds.draw));
    expect(r).toEqual({ outcome: 'won', winnerId: String(draw.winner), prize: draw.prize });
  });

  it('refunds everyone when cancelled or short of entrants', () => {
    expect(drawLottery(['1', '2'], 500, new PyRandom(1), true)).toEqual({
      outcome: 'refunded',
      prize: 0,
    });
    expect(drawLottery(['1'], 500, new PyRandom(1))).toEqual({ outcome: 'refunded', prize: 0 });
    expect(drawLottery([], 500, new PyRandom(1))).toEqual({ outcome: 'refunded', prize: 0 });
  });

  it('join rules in legacy order', () => {
    const ok = {
      nowMs: 0,
      closesMs: 10,
      status: 'open' as const,
      alreadyJoined: false,
      debt: 0,
      balance: 1000,
      fee: 1000,
    };
    expect(validateJoin(ok)).toBeNull();
    expect(validateJoin({ ...ok, alreadyJoined: true })).toBe(fx.normal_draw.joins[3][1].code);
    expect(validateJoin({ ...ok, nowMs: 10 })).toBe('raffle_closed');
    expect(validateJoin({ ...ok, debt: 1 })).toBe('debt_blocks');
    expect(validateJoin({ ...ok, balance: 999 })).toBe('insufficient_balance');
  });

  it('a random fee is a multiple of 100 in 500..3,000', () => {
    const rng = new PyRandom(7);
    for (let i = 0; i < 200; i++) {
      const f = randomFee(rng);
      expect(f % 100).toBe(0);
      expect(f).toBeGreaterThanOrEqual(500);
      expect(f).toBeLessThanOrEqual(3000);
    }
  });
});
