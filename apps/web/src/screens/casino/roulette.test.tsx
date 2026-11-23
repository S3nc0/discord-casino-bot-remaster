// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouletteTableData } from '@casino/shared';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import RouletteScreen from './RouletteScreen.tsx';
import {
  FakeClient,
  USER_ID,
  button,
  click,
  prepare,
  settle,
  tableSnapshot,
  text,
  withServices,
} from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const base: RouletteTableData = { deadline: null, minBet: 10, history: [17, 4, 0], bets: [] };

async function show(client = new FakeClient()) {
  const { element } = withServices(<RouletteScreen />, { client });
  mounted = render(element);
  await settle();
  return { view: mounted, client };
}

const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('Roulette', () => {
  beforeEach(() => prepare());

  it('joins the shared table and shows the idle wheel with the recent numbers', async () => {
    const { view, client } = await show();
    expect(client.watched).toEqual(['roulette']);
    expect(text(view.container)).toContain('Loading the table');
    act(() => client.push(tableSnapshot('roulette', 'idle', base)));
    expect(text(view.container)).toContain('Place a bet to open the next spin.');
    const recent = [...view.container.querySelectorAll('.cc-numbers li')].map((li) =>
      li.getAttribute('data-color'),
    );
    expect(recent).toEqual(['black', 'black', 'green']);
    expect(view.container.querySelector('.cc-wheel .cc-wheel__art')).not.toBeNull();
  });

  it('builds a slip of lines, totals it and sends one bet with every line', async () => {
    const { view, client } = await show();
    act(() => client.push(tableSnapshot('roulette', 'idle', base)));
    await click(button(view.container, 'Red (×2)'));
    await click(button(view.container, '25–36 (×3)'));
    await click(button(view.container, 'Red (×2)')); // the same line twice is one line
    const field = view.container.querySelectorAll('input')[1] as HTMLInputElement;
    await typeInto(field, '17');
    await click(button(view.container, 'Add number'));
    expect(view.container.querySelectorAll('.cc-slip li')).toHaveLength(3);
    expect(button(view.container, /^Place bets/).textContent).toContain('Total 300');
    client.answer({ tableRound: 'rlt-1', roundId: 'rl-1', lines: [], deadline: null });
    await click(button(view.container, /^Place bets/));
    expect(client.bets).toEqual([
      {
        game: 'roulette',
        request: {
          stake: 300,
          bets: [
            { kind: 'red', targets: [], stake: 100 },
            { kind: 'dozen3', targets: [], stake: 100 },
            { kind: 'number', targets: [17], stake: 100 },
          ],
        },
      },
    ]);
    expect(view.container.querySelectorAll('.cc-slip li')).toHaveLength(0);
  });

  it('bets on the open round and shows the countdown while betting', async () => {
    const { view, client } = await show();
    act(() =>
      client.push(
        tableSnapshot(
          'roulette',
          'betting',
          { ...base, deadline: Date.now() + 15_000 },
          { roundId: 'rlt-4' },
        ),
      ),
    );
    expect(text(view.container)).toMatch(/Betting is open: \d+s/);
    await click(button(view.container, 'Odd (×2)'));
    client.answer({ tableRound: 'rlt-4', roundId: 'rl-2', lines: [], deadline: null });
    await click(button(view.container, /^Place bets/));
    expect(client.bets[0]?.request.roundId).toBe('rlt-4');
  });

  it('blocks bets while the ball is rolling and shows the result and my payout after', async () => {
    const { view, client } = await show();
    const mine = {
      userId: USER_ID,
      roundId: 'rl-3',
      stake: 200,
      lines: [
        { kind: 'red' as const, stake: 100 },
        { kind: 'number' as const, number: 7, stake: 100 },
      ],
    };
    const timeline = [
      { atMs: 0, kind: 'start' as const },
      { atMs: 900, kind: 'bounce' as const, pocket: 3 },
      { atMs: 1800, kind: 'slow' as const, pocket: 9 },
      { atMs: 2700, kind: 'result' as const, pocket: 7 },
    ];
    act(() =>
      client.push(
        tableSnapshot('roulette', 'spinning', {
          ...base,
          bets: [mine],
          result: 7,
          color: 'red',
          timeline,
        }),
      ),
    );
    expect(text(view.container)).toContain('No more bets');
    expect(view.container.querySelector('.cc-slip')).toBeNull();
    act(() =>
      client.push(
        tableSnapshot(
          'roulette',
          'result',
          {
            ...base,
            bets: [mine],
            result: 7,
            color: 'red',
            timeline,
            payouts: [{ userId: USER_ID, payout: 3_800, net: 3_600 }],
          },
          { seq: 3 },
        ),
      ),
    );
    expect(text(view.container)).toContain('The ball stopped on 7');
    expect(view.container.querySelector('.cc-wheel__ball')?.getAttribute('data-color')).toBe('red');
    expect(text(view.container)).toContain('You won 3,600 Pelica');
    expect(text(view.container)).toContain('Number 7 (×36)');
  });

  it('ignores an older snapshot of the same round', async () => {
    const { view, client } = await show();
    act(() =>
      client.push(
        tableSnapshot(
          'roulette',
          'result',
          { ...base, result: 5, color: 'red' },
          { seq: 5, roundId: 'a' },
        ),
      ),
    );
    act(() =>
      client.push(
        tableSnapshot(
          'roulette',
          'betting',
          { ...base, deadline: Date.now() + 9_000 },
          { seq: 2, roundId: 'a' },
        ),
      ),
    );
    expect(text(view.container)).toContain('The ball stopped on 5');
  });

  it('reads in Japanese', async () => {
    prepare({ language: 'ja' });
    const { view, client } = await show();
    act(() => client.push(tableSnapshot('roulette', 'idle', base)));
    expect(view.container.querySelector('h1')?.textContent).toBe('ルーレット');
    button(view.container, '赤（2倍）');
    expect(text(view.container)).toContain('最近の出目');
  });
});
