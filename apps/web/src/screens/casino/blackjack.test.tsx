// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BlackjackSeatView, BlackjackView, CardView } from '@casino/shared';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import BlackjackScreen from './BlackjackScreen.tsx';
import {
  FakeClient,
  USER_ID,
  button,
  buttons,
  click,
  prepare,
  settle,
  settlement,
  tableSnapshot,
  text,
  withServices,
} from './testing.tsx';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const c = (rank: CardView['rank'], suit: CardView['suit'] = '♠'): CardView => ({ rank, suit });
const OTHER = '200000000000000002';

const seat = (
  patch: Partial<BlackjackSeatView> & Pick<BlackjackSeatView, 'userId' | 'index'>,
): BlackjackSeatView => ({
  cards: [],
  value: 0,
  stake: 100,
  doubled: false,
  status: 'playing',
  ...patch,
});

const view = (patch: Partial<BlackjackView>): BlackjackView => ({
  roundId: 'bjt-1',
  shared: true,
  phase: 'player',
  dealer: [c('9'), null],
  dealerValue: null,
  seats: [],
  turn: -1,
  deadline: Date.now() + 30_000,
  ...patch,
});

const snap = (data: BlackjackView, seq = 1) =>
  tableSnapshot('blackjack', data.phase, data, { roundId: data.roundId, seq });

async function show(client = new FakeClient()) {
  const { element } = withServices(<BlackjackScreen />, { client });
  mounted = render(element);
  await settle();
  return { view: mounted, client };
}

const myHand = [seat({ userId: USER_ID, index: 0, cards: [c('5', '♥'), c('6', '♦')], value: 11 })];

describe('Blackjack', () => {
  beforeEach(() => prepare());

  it('joins the table room and offers a bet when the table is idle', async () => {
    const { view: v, client } = await show();
    expect(client.watched).toEqual(['blackjack']);
    act(() => client.push(tableSnapshot('blackjack', 'idle', { minBet: 10 })));
    expect(text(v.container)).toContain('Place a bet to open the table.');
    client.answer(view({ phase: 'betting', seats: [seat({ userId: USER_ID, index: 0 })] }));
    await click(button(v.container, 'Bet'));
    expect(client.bets).toEqual([{ game: 'blackjack', request: { stake: 100 } }]);
  });

  it('shows the betting window with the countdown and lets a seated player deal now', async () => {
    const { view: v, client } = await show();
    act(() =>
      client.push(
        snap(
          view({
            phase: 'betting',
            dealer: [],
            seats: [seat({ userId: USER_ID, index: 0 })],
            deadline: Date.now() + 12_000,
          }),
        ),
      ),
    );
    expect(text(v.container)).toMatch(/Betting is open\. Dealing in \d+s\./);
    expect(text(v.container)).toContain('You are seated');
    client.answer(view({}));
    await click(button(v.container, 'Deal now'));
    expect(client.actions).toEqual([{ game: 'blackjack', roundId: 'bjt-1', action: 'deal' }]);
  });

  it('a late player joins the open betting round on its id', async () => {
    const { view: v, client } = await show();
    act(() =>
      client.push(
        snap(view({ phase: 'betting', dealer: [], seats: [seat({ userId: OTHER, index: 0 })] })),
      ),
    );
    client.answer(view({}));
    await click(button(v.container, 'Bet'));
    expect(client.bets[0]?.request).toEqual({ stake: 100, roundId: 'bjt-1' });
  });

  it('shows my hand, a face-down dealer card, and Hit, Stand and Double on my turn', async () => {
    const { view: v, client } = await show();
    act(() =>
      client.push(
        snap(
          view({
            seats: [
              ...myHand,
              seat({ userId: OTHER, index: 1, cards: [c('K'), c('7')], value: 17 }),
            ],
            turn: 0,
          }),
        ),
      ),
    );
    expect(v.container.querySelectorAll('.cc-card--down')).toHaveLength(1);
    expect(text(v.container)).toContain('Total 11');
    expect(text(v.container)).toContain('Your turn');
    const labels = [...v.container.querySelectorAll('.cc-card')].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(labels).toContain('5 of ♥');
    expect(v.container.querySelector('.cc-card--red')).not.toBeNull();
    client.answer(view({})).answer(view({})).answer(view({}));
    await click(button(v.container, 'Hit'));
    await click(button(v.container, 'Double'));
    await click(button(v.container, 'Stand'));
    expect(client.actions.map((a) => a.action)).toEqual(['hit', 'double', 'stand']);
  });

  it('turns Double off after the first move and the actions off when it is not my turn', async () => {
    const { view: v, client } = await show();
    const seats = [
      seat({ userId: USER_ID, index: 0, cards: [c('2'), c('3'), c('4')], value: 9 }),
      seat({ userId: OTHER, index: 1, cards: [c('K'), c('7')], value: 17 }),
    ];
    act(() => client.push(snap(view({ seats, turn: 0 }))));
    expect(button(v.container, 'Double').disabled).toBe(true);
    act(() => client.push(snap(view({ seats, turn: 1 }), 5)));
    expect(buttons(v.container).some((b) => b.textContent === 'Hit')).toBe(false);
    expect(text(v.container)).toContain('Seat 2 is playing');
  });

  it('shows both hands, the result words and the payout when the hand is settled', async () => {
    const { view: v, client } = await show();
    act(() =>
      client.push(
        snap(
          view({
            phase: 'settled',
            dealer: [c('9'), c('8')],
            dealerValue: 17,
            turn: -1,
            deadline: null,
            seats: [
              seat({
                userId: USER_ID,
                index: 0,
                cards: [c('K'), c('Q')],
                value: 20,
                status: 'done',
                result: 'win',
                payout: 200,
                settlement: settlement(100, 100, 'blackjack'),
              }),
            ],
          }),
        ),
      ),
    );
    expect(v.container.querySelectorAll('.cc-card--down')).toHaveLength(0);
    expect(text(v.container)).toContain('Total 17');
    expect(text(v.container)).toContain('You won 100 Pelica');
    expect(text(v.container)).toContain('Win');
  });

  it('names a refused action', async () => {
    const { view: v, client } = await show();
    act(() => client.push(snap(view({ seats: myHand, turn: 0 }))));
    client.fail('conflict');
    await click(button(v.container, 'Hit'));
    expect(v.container.querySelector('[role="alert"]')?.textContent).toContain(
      'That changed in the meantime',
    );
  });

  it('reads in Japanese', async () => {
    prepare({ language: 'ja' });
    const { view: v, client } = await show();
    act(() => client.push(tableSnapshot('blackjack', 'idle', { minBet: 10 })));
    expect(v.container.querySelector('h1')?.textContent).toBe('ブラックジャック');
    expect(text(v.container)).toContain('ベットしてテーブルを開きましょう。');
  });
});
