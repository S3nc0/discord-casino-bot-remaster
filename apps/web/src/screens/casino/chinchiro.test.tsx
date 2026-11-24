// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChinchiroRollView, ChinchiroTableData, ChinchiroView } from '@casino/shared';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import ChinchiroScreen from './ChinchiroScreen.tsx';
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

const roll = (
  dice: [number, number, number],
  kind: ChinchiroRollView['hand']['kind'],
  value = 0,
): ChinchiroRollView => ({
  dice,
  hand: { kind, value },
});

const dealt: ChinchiroView = {
  roundId: 'ch-1',
  stake: 100,
  status: 'player_turn',
  dealerRolls: [roll([4, 4, 2], 'me', 2)],
  playerRolls: [],
  rollsLeft: 3,
  deadline: Date.now() + 60_000,
};

async function show(client = new FakeClient()) {
  const { element } = withServices(<ChinchiroScreen />, { client });
  mounted = render(element);
  await settle();
  return { view: mounted, client };
}

const dice = (root: ParentNode) =>
  [...root.querySelectorAll('.cc-die')].map((d) => d.querySelectorAll('.cc-die__pip').length);

describe('Chinchiro, solo', () => {
  beforeEach(() => prepare());

  it('starts with the rules, the bet controls and a Deal in button', async () => {
    const { view } = await show();
    expect(view.container.querySelector('h1')?.textContent).toBe('Chinchiro');
    expect(text(view.container)).toContain('roll up to 3 times');
    button(view.container, 'Deal in');
    expect(view.container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('deals, lets the player roll, and shows the hands and the payout', async () => {
    const client = new FakeClient().answer(dealt, { roundId: 'ch-1' }).answer<ChinchiroView>(
      {
        ...dealt,
        status: 'settled',
        playerRolls: [roll([6, 6, 5], 'me', 5)],
        rollsLeft: 0,
        deadline: null,
        result: {
          outcome: 'lose',
          multiplier: 1,
          payout: 0,
          penalty: 0,
          settlement: settlement(-100, 100, 'chinchiro'),
        },
      },
      { roundId: 'ch-1' },
    );
    const { view } = await show(client);
    await click(button(view.container, 'Deal in'));
    expect(client.bets[0]).toEqual({ game: 'chinchiro', request: { stake: 100 } });
    expect(text(view.container)).toContain('Point 2');
    expect(text(view.container)).toContain('3 rolls left');
    await click(button(view.container, 'Roll the dice'));
    expect(client.actions).toEqual([{ game: 'chinchiro', roundId: 'ch-1', action: 'roll' }]);
    expect(dice(view.container)).toEqual([4, 4, 2, 6, 6, 5]);
    expect(text(view.container)).toContain('Point 5');
    expect(text(view.container)).toContain('You lost 100 Pelica');
    expect(text(view.container)).toContain('The dealer wins');
    button(view.container, 'Play again');
  });

  it('draws the faces the server rolled', async () => {
    const client = new FakeClient().answer(dealt, { roundId: 'ch-1' });
    const { view } = await show(client);
    await click(button(view.container, 'Deal in'));
    // dealer 4,4,2 → pips 4,4,2; the player's dice are blank (0 pips) until the first roll
    expect(dice(view.container)).toEqual([4, 4, 2, 0, 0, 0]);
  });

  it('prompts for another roll after no point and shows the multiplier loss note', async () => {
    const client = new FakeClient()
      .answer(dealt, { roundId: 'ch-1' })
      .answer<ChinchiroView>(
        { ...dealt, playerRolls: [roll([1, 3, 5], 'menashi')], rollsLeft: 2 },
        { roundId: 'ch-1' },
      )
      .answer<ChinchiroView>(
        {
          ...dealt,
          status: 'settled',
          playerRolls: [roll([1, 3, 5], 'menashi'), roll([1, 2, 3], 'hifumi')],
          rollsLeft: 0,
          deadline: null,
          result: {
            outcome: 'lose',
            multiplier: 2,
            payout: 0,
            penalty: 100,
            settlement: { ...settlement(-200, 100, 'chinchiro'), penalty: 100 },
          },
        },
        { roundId: 'ch-1' },
      );
    const { view } = await show(client);
    await click(button(view.container, 'Deal in'));
    await click(button(view.container, 'Roll the dice'));
    expect(text(view.container)).toContain('No hand… you can roll 2 more.');
    await click(button(view.container, 'Roll the dice'));
    expect(text(view.container)).toContain('Hifumi 1-2-3');
    expect(text(view.container)).toContain('Multiplier loss 100 Pelica');
  });
});

describe('Chinchiro, shared table', () => {
  beforeEach(() => prepare());

  const seatsOf = (...ids: (string | null)[]) =>
    Array.from({ length: 6 }, (_, index) => ({ index, userId: ids[index] ?? null }));
  const base: ChinchiroTableData = {
    minBet: 10,
    minSeats: 2,
    rakeBps: 1000,
    stepMs: 900,
    deadline: null,
    folded: false,
  };

  async function openTable(client: FakeClient) {
    const { view } = await show(client);
    await click(
      view.container.querySelector<HTMLElement>('[role="tab"]:nth-child(2)') as HTMLElement,
    );
    await settle();
    return view;
  }

  it('watches the table and offers to open one when it is idle', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    expect(client.watched).toEqual(['chinchiro']);
    expect(text(view.container)).toContain('Loading the table');
    act(() => client.push(tableSnapshot('chinchiro', 'idle', base, { seats: seatsOf() })));
    expect(text(view.container)).toContain('No table is open');
    client.answer({ tableRound: 'cht-1', roundId: 'ch-9', host: true, deadline: null });
    await click(button(view.container, 'Open a table'));
    expect(client.bets[0]).toEqual({
      game: 'chinchiro',
      request: { stake: 100, args: { table: true } },
    });
  });

  it('leaves the table room when the tab is closed', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    mounted?.unmount();
    mounted = null;
    expect(client.unwatched).toEqual(['chinchiro']);
    void view;
  });

  it('shows the lobby: bet, seats, host, and lets a seated host stand or start', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    const lobby = tableSnapshot(
      'chinchiro',
      'lobby',
      { ...base, hostId: USER_ID, bet: 200, deadline: Date.now() + 30_000 },
      { seats: seatsOf(USER_ID, '200000000000000002') },
    );
    act(() => client.push(lobby));
    expect(text(view.container)).toContain('Bet 200 Pelica each · Table fee 10% of the losers');
    expect(text(view.container)).toContain('2 players or more');
    expect(text(view.container)).toContain('Waiting for players');
    expect(text(view.container)).toContain('Host');
    expect(view.container.querySelectorAll('.cc-seat[data-free="true"]')).toHaveLength(4);
    client.answer({ tableRound: 'tbl-1', seats: 2 }).answer({ tableRound: 'tbl-1', refunded: 200 });
    await click(button(view.container, 'Start now'));
    await click(button(view.container, 'Stand up'));
    expect(client.actions).toEqual([
      { game: 'chinchiro', roundId: 'tbl-1', action: 'begin' },
      { game: 'chinchiro', roundId: 'tbl-1', action: 'stand' },
    ]);
  });

  it('lets someone else sit for the lobby bet on the lobby round', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    act(() =>
      client.push(
        tableSnapshot(
          'chinchiro',
          'lobby',
          { ...base, hostId: '200000000000000002', bet: 200, deadline: Date.now() + 30_000 },
          { seats: seatsOf('200000000000000002') },
        ),
      ),
    );
    client.answer({ tableRound: 'tbl-1', roundId: 'ch-5', host: false, deadline: null });
    await click(button(view.container, 'Sit for 200 Pelica'));
    expect(client.bets[0]).toEqual({
      game: 'chinchiro',
      request: { stake: 200, args: { table: true }, roundId: 'tbl-1' },
    });
    expect(buttons(view.container).some((b) => b.textContent === 'Start now')).toBe(false);
  });

  it('lets a seated player roll once, and marks who has not rolled yet', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    const other = '200000000000000002';
    const rolling = (mine: ChinchiroRollView[]) =>
      tableSnapshot(
        'chinchiro',
        'rolling',
        {
          ...base,
          hostId: USER_ID,
          bet: 100,
          deadline: Date.now() + 45_000,
          hands: [
            { userId: USER_ID, roundId: 'ch-7', rolled: mine.length > 0, rolls: mine },
            { userId: other, roundId: 'ch-8', rolled: false, rolls: [] },
          ],
        },
        { seats: seatsOf(USER_ID, other) },
      );
    act(() => client.push(rolling([])));
    expect(text(view.container)).toContain('Not rolled yet');
    expect(text(view.container)).toMatch(/4[45]s to roll/);
    client.answer({ tableRound: 'tbl-1', rolls: [roll([4, 5, 6], 'shigoro')], finished: false });
    await click(button(view.container, '🎲 Roll'));
    expect(client.actions).toEqual([{ game: 'chinchiro', roundId: 'tbl-1', action: 'table_roll' }]);
    act(() => client.push(rolling([roll([4, 5, 6], 'shigoro')])));
    expect(buttons(view.container).some((b) => b.textContent === '🎲 Roll')).toBe(false);
    expect(view.container.querySelectorAll('.cc-seatroll')).toHaveLength(2);
  });

  it('shows the pot result: strongest first with the crown, the fee and my payout', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    const other = '200000000000000002';
    act(() =>
      client.push(
        tableSnapshot(
          'chinchiro',
          'result',
          {
            ...base,
            hostId: other,
            bet: 100,
            hands: [
              { userId: other, roundId: 'ch-8', rolled: true, rolls: [roll([4, 4, 3], 'me', 3)] },
              {
                userId: USER_ID,
                roundId: 'ch-7',
                rolled: true,
                rolls: [roll([6, 6, 2], 'me', 2), roll([5, 6, 6], 'me', 5)],
              },
            ],
            results: [
              { userId: USER_ID, isWinner: true, payout: 190, net: 90, settled: true },
              { userId: other, isWinner: false, payout: 0, net: -100, settled: true },
            ],
            rake: 10,
            refunded: false,
          },
          { seats: seatsOf(other, USER_ID) },
        ),
      ),
    );
    expect(text(view.container)).toContain('👑 You take the pot!');
    const rows = [...view.container.querySelectorAll('.cc-seatroll')];
    expect(rows.map((r) => r.getAttribute('data-winner'))).toEqual(['true', 'false']);
    expect(rows[0]?.textContent).toContain('👑');
    expect(rows[0]?.textContent).toContain('Point 5');
    expect(rows[1]?.textContent).toContain('Point 3');
    expect(text(view.container)).toContain('Table fee 10 Pelica');
    expect(text(view.container)).toContain('You won 90 Pelica');
    expect(text(view.container)).toContain('You take the pot!');
  });

  it('says the stakes came back when settling failed', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    act(() =>
      client.push(
        tableSnapshot(
          'chinchiro',
          'result',
          {
            ...base,
            bet: 100,
            hands: [{ userId: USER_ID, roundId: 'ch-7', rolled: true, rolls: [] }],
            results: [{ userId: USER_ID, isWinner: true, payout: 0, net: 0, settled: false }],
            rake: 0,
            refunded: true,
          },
          { seats: seatsOf(USER_ID) },
        ),
      ),
    );
    expect(text(view.container)).toContain('Every stake was returned');
    expect(text(view.container)).not.toContain('You won');
  });

  it('says why a table of one was folded', async () => {
    const client = new FakeClient();
    const view = await openTable(client);
    act(() => client.push(tableSnapshot('chinchiro', 'idle', { ...base, folded: true })));
    expect(text(view.container)).toContain('Fewer than 2 players sat down');
  });
});
