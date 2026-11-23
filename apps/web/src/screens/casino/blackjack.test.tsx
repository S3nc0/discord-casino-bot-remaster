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

  describe('Teiai credit double', () => {
    const play = async (stake: number, balance: number) => {
      prepare({ balance });
      const out = await show();
      const seats = [
        seat({ userId: USER_ID, index: 0, stake, cards: [c('5', '♥'), c('6', '♦')], value: 11 }),
      ];
      act(() => out.client.push(snap(view({ seats, turn: 0 }))));
      return out;
    };
    const dialog = () => document.body.querySelector('[role="dialog"], [role="alertdialog"]');

    it('keeps the plain Double while the cash covers it', async () => {
      const { view: v } = await play(100, 5_000);
      expect(buttons(v.container).some((b) => b.textContent === 'Borrow and double')).toBe(false);
      expect(button(v.container, 'Double').disabled).toBe(false);
    });

    it('offers Borrow and double when short, and only sends credit after the confirm', async () => {
      const { view: v, client } = await play(1_000, 400);
      expect(buttons(v.container).some((b) => b.textContent === 'Double')).toBe(false);
      await click(button(v.container, 'Borrow and double'));
      expect(client.actions).toEqual([]);
      expect(text(dialog() as HTMLElement)).toContain('600 Pelica short');
      expect(text(dialog() as HTMLElement)).toContain('debt');
      client.answer(view({}));
      const confirm = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent === 'Borrow and double',
      )!;
      await click(confirm);
      expect(client.actions.map((a) => [a.action, a.args])).toEqual([['double', { credit: true }]]);
    });

    it('cancelling the warning sends nothing', async () => {
      const { view: v, client } = await play(1_000, 400);
      await click(button(v.container, 'Borrow and double'));
      const cancel = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent === 'Cancel',
      )!;
      await click(cancel);
      expect(client.actions).toEqual([]);
      expect(dialog()).toBeNull();
    });

    it('does not offer credit above the Teiai cap and says why', async () => {
      const { view: v } = await play(5_000, 500);
      expect(button(v.container, 'Double').disabled).toBe(true);
      expect(text(v.container)).toContain('Teiai lends at most 3,000');
    });

    it('says so when the server refuses the loan', async () => {
      const { view: v, client } = await play(1_000, 400);
      await click(button(v.container, 'Borrow and double'));
      client.fail('insufficient_funds');
      const confirm = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent === 'Borrow and double',
      )!;
      await click(confirm);
      expect(text(v.container)).toContain('Teiai would not lend it.');
    });
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

  it('keeps every hand and its cards on one table in the result state', async () => {
    const { view: v, client } = await show();
    act(() =>
      client.push(
        snap(
          view({
            phase: 'settled',
            dealer: [c('8', '♣'), c('K', '♥')],
            dealerValue: 18,
            turn: -1,
            deadline: null,
            seats: [
              seat({
                userId: USER_ID,
                index: 0,
                cards: [c('K', '♣'), c('J', '♣')],
                value: 20,
                status: 'done',
                result: 'win',
                payout: 200,
                settlement: settlement(100, 100, 'blackjack'),
              }),
              seat({
                userId: OTHER,
                index: 1,
                cards: [c('8', '♦'), c('5', '♦'), c('7', '♣')],
                value: 20,
                status: 'done',
                result: 'win',
              }),
            ],
          }),
        ),
      ),
    );
    const felt = v.container.querySelector('.cc-felt') as HTMLElement;
    const hands = [...felt.querySelectorAll('.cc-hand')].map((hand) =>
      [...hand.querySelectorAll('.cc-card')].map((card) => ({
        label: card.getAttribute('aria-label'),
        drawn: card.querySelector('svg.cc-art path') !== null,
      })),
    );
    expect(hands).toEqual([
      [
        { label: '8 of ♣', drawn: true },
        { label: 'K of ♥', drawn: true },
      ],
      [
        { label: 'K of ♣', drawn: true },
        { label: 'J of ♣', drawn: true },
      ],
      [
        { label: '8 of ♦', drawn: true },
        { label: '5 of ♦', drawn: true },
        { label: '7 of ♣', drawn: true },
      ],
    ]);
    // one table: one dealer's strip, one printed arc, one rail, in that order round the hands
    for (const part of ['.cc-felt__dealer', '.cc-felt__arc', '.cc-felt__rail'])
      expect(v.container.querySelectorAll(part)).toHaveLength(1);
    const order = [...felt.children].map((el) => el.getAttribute('class')?.split(' ').pop());
    expect(order).toEqual([
      'cc-felt__dealer',
      'cc-hand',
      'cc-felt__arc',
      'cc-hand',
      'cc-hand',
      'cc-felt__rail',
    ]);
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
