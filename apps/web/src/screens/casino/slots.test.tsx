// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SlotsResultView } from '@casino/shared';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import SlotsScreen from './SlotsScreen.tsx';
import {
  FakeClient,
  button,
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

const win: SlotsResultView = {
  roundId: 'sl-1',
  reels: ['🍒', '🍒', '🍋'],
  multiplier: 1.5,
  label: { kind: 'cherry2' },
  settlement: settlement(50, 100, 'slots'),
};

async function show(client = new FakeClient()) {
  const { element } = withServices(<SlotsScreen />, { client });
  mounted = render(element);
  await settle();
  return { view: mounted, client };
}

describe('Slots', () => {
  beforeEach(() => prepare());

  it('shows the title, the jackpot pool, three reels, the bet controls and the pay table', async () => {
    const { view } = await show();
    expect(view.container.querySelector('h1')?.textContent).toBe('Slots');
    expect(text(view.container)).toContain('Jackpot pool 48,200');
    expect(view.container.querySelectorAll('.cc-reel')).toHaveLength(3);
    expect((view.container.querySelector('input') as HTMLInputElement).value).toBe('100');
    for (const label of ['Min', 'Half', 'Double', 'All in', 'Spin']) button(view.container, label);
    expect(text(view.container)).toContain('×500');
    expect(text(view.container)).toContain('Last results');
    expect(text(view.container)).toContain('−100');
  });

  it('spins with the chosen bet and shows the reels, the payout and the net result', async () => {
    const client = new FakeClient().answer(win);
    const { view } = await show(client);
    await click(button(view.container, 'Spin'));
    expect(client.bets).toEqual([{ game: 'slots', request: { stake: 100 } }]);
    await settle();
    const reels = [...view.container.querySelectorAll('.cc-reel__symbol')].map(
      (r) => r.textContent,
    );
    expect(reels).toEqual(['🍒', '🍒', '🍋']);
    expect(text(view.container)).toContain('You won 50 Pelica');
    expect(text(view.container)).toContain('Two cherries');
    expect(text(view.container)).toContain('Paid out 150');
    expect(button(view.container, 'Play again')).toBeTruthy();
  });

  it('shows a loss and a jackpot in words', async () => {
    const client = new FakeClient().answer({
      ...win,
      reels: ['🍇', '🔔', '🍋'],
      multiplier: 0,
      label: { kind: 'miss' },
      settlement: { ...settlement(-100), jackpot: 0 },
    });
    const { view } = await show(client);
    await click(button(view.container, 'Spin'));
    await settle();
    expect(text(view.container)).toContain('You lost 100 Pelica');
    expect(text(view.container)).toContain('No match');
  });

  it('keeps the spin button off for a bet below the minimum or above the balance', async () => {
    const { view } = await show();
    const input = view.container.querySelector('input') as HTMLInputElement;
    await click(button(view.container, 'Min'));
    expect(input.value).toBe('10');
    expect(button(view.container, 'Spin').disabled).toBe(false);
    await click(button(view.container, 'All in'));
    expect(input.value).toBe('5000');
    await click(button(view.container, 'Double'));
    expect(input.value).toBe('5000');
    expect(button(view.container, 'Spin').disabled).toBe(false);
  });

  it('names the error code when the server refuses', async () => {
    const client = new FakeClient().fail('insufficient_funds');
    const { view } = await show(client);
    await click(button(view.container, 'Spin'));
    await settle();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'You do not have enough Pelica.',
    );
  });

  it('says so when the socket is not connected', async () => {
    const client = new FakeClient().fail('internal', true);
    const { view } = await show(client);
    await click(button(view.container, 'Spin'));
    await settle();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Not connected yet',
    );
  });

  it('reads in Japanese', async () => {
    prepare({ language: 'ja' });
    const { view } = await show();
    expect(view.container.querySelector('h1')?.textContent).toBe('スロット');
    button(view.container, '回す');
    expect(text(view.container)).toContain('配当表');
  });
});
