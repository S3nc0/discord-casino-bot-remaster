import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BET_MAX,
  odds,
  rakeOf,
  settle,
  tipTier,
  validTitle,
  validUrl,
  type StreamStake,
} from './stream.ts';

const A = '100000000000000001';
const B = '100000000000000002';
const C = '100000000000000003';
const D = '100000000000000004';

describe('stream settle (docs/spec/stream.md §6)', () => {
  it('worked example: A 1,000 + B 3,000 win, C 2,000 lose, streamer wins', () => {
    const r = settle(
      [
        { userId: A, side: 'win', amount: 1000 },
        { userId: B, side: 'win', amount: 3000 },
        { userId: C, side: 'lose', amount: 2000 },
      ],
      'win',
    );
    expect(r).toEqual({
      refunded: false,
      winTotal: 4000,
      loseTotal: 2000,
      bettors: 3,
      rake: 100,
      dust: 0,
      payouts: [
        { userId: B, amount: 4425, stake: 3000 },
        { userId: A, amount: 1475, stake: 1000 },
      ],
    });
  });

  it('the lose side can win too', () => {
    const r = settle(
      [
        { userId: A, side: 'win', amount: 1000 },
        { userId: C, side: 'lose', amount: 2000 },
      ],
      'lose',
    );
    // rake = floor(1000 * 5%) = 50, pot 950, C = 2000 + 950
    expect(r.rake).toBe(50);
    expect(r.payouts).toEqual([{ userId: C, amount: 2950, stake: 2000 }]);
  });

  it('one-sided round refunds every stake exactly', () => {
    const r = settle(
      [
        { userId: A, side: 'win', amount: 700 },
        { userId: B, side: 'win', amount: 300 },
      ],
      'lose',
    );
    expect(r.refunded).toBe(true);
    expect(r.rake).toBe(0);
    expect(r.payouts).toEqual([
      { userId: A, amount: 700, stake: 700 },
      { userId: B, amount: 300, stake: 300 },
    ]);
  });

  it('void refunds every stake exactly, both sides', () => {
    const r = settle(
      [
        { userId: A, side: 'win', amount: 1000 },
        { userId: C, side: 'lose', amount: 2000 },
      ],
      'void',
    );
    expect(r.refunded).toBe(true);
    expect(r.payouts.map((p) => [p.userId, p.amount])).toEqual([
      [C, 2000],
      [A, 1000],
    ]);
  });

  it('nobody bet: refunded with nothing to pay', () => {
    expect(settle([], 'win')).toMatchObject({ refunded: true, payouts: [], bettors: 0 });
  });

  it('rounding dust stays with Teiai', () => {
    // three winners of 100 share a pot of 100 - 5 = 95: 31 each, dust 2
    const r = settle(
      [
        { userId: A, side: 'win', amount: 100 },
        { userId: B, side: 'win', amount: 100 },
        { userId: D, side: 'win', amount: 100 },
        { userId: C, side: 'lose', amount: 100 },
      ],
      'win',
    );
    expect(r.rake).toBe(5);
    expect(r.dust).toBe(2);
    expect(r.payouts.map((p) => p.amount)).toEqual([131, 131, 131]);
    expect(r.payouts.map((p) => p.userId)).toEqual([A, B, D]);
  });

  it('refuses a stake that is not a positive integer', () => {
    expect(() => settle([{ userId: A, side: 'win', amount: 0 }], 'win')).toThrow(RangeError);
    expect(() => settle([{ userId: A, side: 'win', amount: 1.5 }], 'win')).toThrow(RangeError);
  });

  const stakes = fc
    .uniqueArray(
      fc.record({
        userId: fc.bigInt({ min: 10n ** 17n, max: 10n ** 18n }).map(String),
        side: fc.constantFrom('win' as const, 'lose' as const),
        amount: fc.integer({ min: 1, max: BET_MAX }),
      }),
      { selector: (s) => s.userId, maxLength: 40 },
    )
    .map((xs): StreamStake[] => xs);
  const outcome = fc.constantFrom('win' as const, 'lose' as const, 'void' as const);

  it('property: Σ payouts + rake + dust = Σ stakes, winners ≥ stake, refund ⇒ exact stake', () => {
    fc.assert(
      fc.property(stakes, outcome, (xs, out) => {
        const r = settle(xs, out);
        const total = xs.reduce((s, x) => s + x.amount, 0);
        const paid = r.payouts.reduce((s, p) => s + p.amount, 0);
        expect(paid + r.rake + r.dust).toBe(total);
        expect(r.rake).toBeGreaterThanOrEqual(0);
        expect(r.dust).toBeGreaterThanOrEqual(0);
        const byUser = new Map(xs.map((x) => [x.userId, x]));
        if (r.refunded) {
          expect(r.payouts).toHaveLength(xs.length);
          for (const p of r.payouts) expect(p.amount).toBe(byUser.get(p.userId)?.amount);
        } else {
          expect(r.rake).toBe(rakeOf(out === 'win' ? r.loseTotal : r.winTotal));
          for (const p of r.payouts) {
            const s = byUser.get(p.userId);
            expect(s?.side).toBe(out);
            expect(p.amount).toBeGreaterThanOrEqual(s?.amount ?? Infinity);
          }
          expect(r.payouts).toHaveLength(xs.filter((x) => x.side === out).length);
        }
        for (let i = 1; i < r.payouts.length; i++) {
          expect(r.payouts[i - 1]!.amount).toBeGreaterThanOrEqual(r.payouts[i]!.amount);
        }
      }),
    );
  });
});

describe('odds and tip tiers', () => {
  it('odds of the worked example', () => {
    // win side 4,000 against 2,000: 1 + 1,900 / 4,000 = x1.475
    expect(odds(4000, 2000, 'win')).toBe(14_750);
    expect(odds(4000, 2000, 'lose')).toBe(10_000 + Math.floor((3800 * 10_000) / 2000));
    expect(odds(0, 2000, 'win')).toBeNull();
    expect(odds(4000, 0, 'win')).toBeNull();
  });

  it('tip tiers by amount', () => {
    expect(tipTier(100)).toEqual({ from: 0, color: 0x1e88e5 });
    expect(tipTier(499).color).toBe(0x1e88e5);
    expect(tipTier(500).color).toBe(0x00e5ff);
    expect(tipTier(1000).color).toBe(0x1de9b6);
    expect(tipTier(2000).color).toBe(0xffca28);
    expect(tipTier(5000).color).toBe(0xf57c00);
    expect(tipTier(10_000).color).toBe(0xe91e63);
    expect(tipTier(20_000)).toEqual({ from: 20_000, color: 0xe62117 });
  });

  it('title and URL checks', () => {
    expect(validTitle('  ')).toBe(false);
    expect(validTitle('x'.repeat(100))).toBe(true);
    expect(validTitle('x'.repeat(101))).toBe(false);
    expect(validUrl('https://example.com/live')).toBe(true);
    expect(validUrl('http://x')).toBe(true);
    expect(validUrl('ftp://x')).toBe(false);
    expect(validUrl('https://')).toBe(false);
    expect(validUrl(`https://${'a'.repeat(300)}`)).toBe(false);
  });
});
