import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PyRandom } from '../progression/py-random.ts';
import { simulate, type Runner } from './sim.ts';

const fx = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/legacy/horse/races.json', import.meta.url),
    'utf8',
  ),
);

describe('simulate (legacy parity)', () => {
  it('replays the seed-2002 fixture race: order and interpolated finish times', () => {
    const runners: Runner[] = fx.runners;
    const out = simulate(runners, fx.track, new PyRandom(fx.seeds.sim));
    expect(out.order).toEqual(fx.simulation.order);
    out.times.forEach((t, i) => expect(t).toBeCloseTo(fx.simulation.finish[i], 8));
    expect(out.frames.length).toBeGreaterThan(55);
    expect(out.frames.at(-1)?.every((p) => p === 1000)).toBe(true);
  });
});
