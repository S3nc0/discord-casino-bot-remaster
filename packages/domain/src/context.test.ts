import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSeededRng, manualClock } from '@casino/shared';
import type { DomainContext, Outcome } from './index.ts';

// Shape check for the domain contract: a pure step function with injected rng and clock
// returns the same outcome for the same seed, inputs and time.
interface Pot {
  total: number;
}

function exampleStep(ctx: DomainContext, state: Pot, stake: number): Outcome<Pot> {
  const roll = ctx.rng.int(1, 7);
  return {
    state: { total: state.total + stake * roll },
    events: [],
  };
}

describe('domain context', () => {
  it('is deterministic for a given seed and clock', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 10_000 }), (seed, stake) => {
        const make = (): DomainContext => ({ rng: createSeededRng(seed), clock: manualClock(0) });
        const a = exampleStep(make(), { total: 0 }, stake);
        const b = exampleStep(make(), { total: 0 }, stake);
        expect(a).toEqual(b);
        expect(a.state.total).toBeGreaterThanOrEqual(stake);
        expect(a.state.total).toBeLessThanOrEqual(stake * 6);
      }),
    );
  });
});
