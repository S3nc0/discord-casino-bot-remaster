// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PachinkoResultView } from '@casino/shared';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import PachinkoScreen from './PachinkoScreen.tsx';
import {
  FakeClient,
  button,
  byLabel,
  click,
  prepare,
  settle,
  settlement,
  text,
  withServices,
} from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const spin = (rounds: number[]) => ({
  omen: '' as const,
  tier: '' as const,
  hitProb: 0.01,
  hit: rounds.length > 0,
  rounds,
});

const result: PachinkoResultView = {
  roundId: 'pa-1',
  bet: 100,
  sets: [
    { starts: 7, spins: Array.from({ length: 7 }, () => spin([])), raw: 0 },
    {
      starts: 5,
      spins: [spin([2, 10, 30]), ...Array.from({ length: 4 }, () => spin([]))],
      raw: 42,
    },
  ],
  topRound: 30,
  settlement: settlement(4_000, 200, 'pachinko'),
};

async function show(client = new FakeClient()) {
  const { element } = withServices(<PachinkoScreen />, { client });
  mounted = render(element);
  await settle();
  return { view: mounted, client };
}

describe('Pachinko', () => {
  beforeEach(() => prepare());

  it('shows the board, the sets stepper with the total stake, and a launch button', async () => {
    const { view } = await show();
    expect(view.container.querySelector('h1')?.textContent).toBe('Pachinko');
    expect(view.container.querySelectorAll('.cc-ball').length).toBeGreaterThan(0);
    expect(text(view.container)).toContain('Total stake 100');
    await click(byLabel(view.container, 'More sets'));
    await click(byLabel(view.container, 'More sets'));
    expect(text(view.container)).toContain('Total stake 300');
    expect(text(view.container)).toContain('Sets (100 balls each): 3');
    button(view.container, 'Launch');
  });

  it('launches with the bet per set and the number of sets, then lists every set and the result', async () => {
    const client = new FakeClient().answer(result);
    const { view } = await show(client);
    await click(byLabel(view.container, 'More sets'));
    await click(button(view.container, 'Launch'));
    expect(client.bets).toEqual([{ game: 'pachinko', request: { stake: 100, args: { sets: 2 } } }]);
    const sets = view.container.querySelectorAll('.cc-set');
    expect(sets).toHaveLength(2);
    expect(sets[0]?.textContent).toContain('All 7 spins missed.');
    expect(sets[1]?.textContent).toContain('3-round chain, ×42');
    expect(sets[1]?.textContent).toContain('Hot streak ×30');
    expect(sets[1]?.getAttribute('data-hit')).toBe('true');
    expect(text(view.container)).toContain('Best round ×30');
    expect(text(view.container)).toContain('You won 4,000 Pelica');
    expect(text(view.container)).toContain('A hot streak!');
  });

  it('refuses a total above the balance without calling the server', async () => {
    prepare({ balance: 250 });
    const { view, client } = await show();
    await click(byLabel(view.container, 'More sets'));
    await click(byLabel(view.container, 'More sets'));
    expect(text(view.container)).toContain('Total stake 300');
    expect(button(view.container, 'Launch').disabled).toBe(true);
    expect(client.bets).toHaveLength(0);
  });

  it('caps the sets at ten', async () => {
    const { view } = await show();
    for (let i = 0; i < 12; i += 1) {
      const plus = byLabel(view.container, 'More sets');
      if (!plus.disabled) await click(plus);
    }
    expect(text(view.container)).toContain('Total stake 1,000');
  });
});
