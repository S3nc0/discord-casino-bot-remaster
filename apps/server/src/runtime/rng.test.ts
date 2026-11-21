import { describe, expect, it } from 'vitest';
import { cryptoRng } from './rng.ts';
import { systemClock } from './clock.ts';

describe('runtime', () => {
  it('cryptoRng stays in range', () => {
    for (let i = 0; i < 2000; i++) {
      const n = cryptoRng.int(-3, 4);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThan(4);
      const f = cryptoRng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(() => cryptoRng.int(1, 1)).toThrow(RangeError);
  });

  it('systemClock reads wall time', () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(1000);
  });
});
