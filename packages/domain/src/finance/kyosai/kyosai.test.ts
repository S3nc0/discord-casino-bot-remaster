import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  doesMotionPass,
  hamiltonSplit,
  isKyosaiGateLocked,
  isPremiumRateValid,
  kyosaiDividendPool,
  kyosaiMinNextBid,
  kyosaiTransferFee,
} from './index.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));

interface KyosaiFixture {
  readonly domain_math: {
    readonly split_1000_3holders: Record<string, number>;
    readonly split_1000_weighted: Record<string, number>;
    readonly dividend_pool_excess: number;
    readonly dividend_pool_below_buffer: number;
    readonly gate_locked_ok: boolean;
    readonly gate_locked_low_theta: boolean;
    readonly gate_locked_grace: boolean;
    readonly motion_passes_yes: boolean;
    readonly motion_passes_quorum_fail: boolean;
    readonly premium_ok_0_05: boolean;
    readonly premium_ok_0_50: boolean;
  };
}

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/legacy/kyosai/operations.json'), 'utf8'),
) as KyosaiFixture;

describe('kyosai domain parity', () => {
  it('matches legacy domain_math fixture 100%', () => {
    expect(
      hamiltonSplit(1_000, [
        { holderId: '1', units: 1 },
        { holderId: '2', units: 1 },
        { holderId: '3', units: 1 },
      ]),
    ).toEqual(fixture.domain_math.split_1000_3holders);

    expect(
      hamiltonSplit(1_000, [
        { holderId: '1', units: 5 },
        { holderId: '2', units: 3 },
        { holderId: '3', units: 2 },
      ]),
    ).toEqual(fixture.domain_math.split_1000_weighted);

    expect(kyosaiDividendPool(200_000, 100_000)).toBe(fixture.domain_math.dividend_pool_excess);
    expect(kyosaiDividendPool(110_000, 100_000)).toBe(
      fixture.domain_math.dividend_pool_below_buffer,
    );
    expect(kyosaiDividendPool(20_000, 100_000)).toBe(0);

    expect(isKyosaiGateLocked(0.15, 0)).toBe(fixture.domain_math.gate_locked_ok);
    expect(isKyosaiGateLocked(0.05, 0)).toBe(fixture.domain_math.gate_locked_low_theta);
    expect(isKyosaiGateLocked(0.2, 1)).toBe(fixture.domain_math.gate_locked_grace);
    expect(isKyosaiGateLocked(0.2, 0)).toBe(false);
    expect(isKyosaiGateLocked(null, 0)).toBe(false);

    expect(doesMotionPass(60, 20, 100)).toBe(fixture.domain_math.motion_passes_yes);
    expect(doesMotionPass(10, 0, 100)).toBe(fixture.domain_math.motion_passes_quorum_fail);
    expect(doesMotionPass(50, 50, 100)).toBe(false);

    expect(isPremiumRateValid(0.05)).toBe(fixture.domain_math.premium_ok_0_05);
    expect(isPremiumRateValid(0.5)).toBe(fixture.domain_math.premium_ok_0_50);
    expect(isPremiumRateValid(0)).toBe(false);
    expect(isPremiumRateValid(1.01)).toBe(false);

    expect(kyosaiTransferFee(8_000)).toBe(400);
    expect(kyosaiMinNextBid(0)).toBe(1);
    expect(kyosaiMinNextBid(5_000)).toBe(5_250);
  });

  it('conserves exact integer Pelica across arbitrary Hamilton splits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.uniqueArray(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 20 }),
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 20, maxLength: 20 }),
        (amount, ids, weights) => {
          const holdings = ids.map((id, i) => ({ holderId: String(id), units: weights[i] ?? 1 }));
          const shares = hamiltonSplit(amount, holdings);
          const sum = Object.values(shares).reduce((a, b) => a + b, 0);
          expect(sum).toBe(amount);
          for (const v of Object.values(shares)) {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
