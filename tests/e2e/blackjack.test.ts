import { afterEach, describe, expect, it } from 'vitest';
import {
  createSeededRng,
  type IntentAck,
  type TableSnapshot,
} from '../../packages/shared/src/index.ts';
import {
  BLACKJACK_BETTING_MS,
  BLACKJACK_RESULT_MS,
  BLACKJACK_SEATS,
  BLACKJACK_TURN_MS,
  type BlackjackView,
} from '../../apps/server/src/games/casino/blackjack.ts';
import { INITIAL_BALANCE } from '../../apps/server/src/economy/economy-service.ts';
import { connectClient, settle, type TestClient } from './support/clients.ts';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  GUILD_B,
  INSTANCE_A2,
  INSTANCE_B1,
  startStack,
  type Person,
  type Stack,
} from './support/stack.ts';

let stack: Stack;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await stack?.close();
});

const viewOf = (s: TableSnapshot): BlackjackView => s.data as BlackjackView;

async function sit(person: Person, options: Parameters<typeof connectClient>[2] = {}) {
  const client = await connectClient(stack, person, options);
  clients.push(client);
  await client.join('blackjack');
  return client;
}

/**
 * Seats three players and deals. The seeded stream decides the cards, so look for a seed whose
 * first hand leaves at least two seats to act (no naturals), which the turn-order tests need.
 */
async function dealtTable(seats = 3): Promise<{ players: TestClient[]; roundId: string }> {
  for (let seed = 1; seed <= 40; seed++) {
    stack = await startStack({ rng: createSeededRng(seed) });
    const players: TestClient[] = [];
    for (const person of [ALICE, BOB, CAROL].slice(0, seats)) players.push(await sit(person));
    for (const p of players) expect(await p.bet('blackjack', 100)).toMatchObject({ ok: true });
    const roundId = (players[0] as TestClient).lastTable('blackjack')?.roundId as string;
    // Alice starts the hand early; the window would deal it anyway after 15 s.
    const dealt = await (players[0] as TestClient).action('blackjack', roundId, 'deal');
    expect(dealt).toMatchObject({ ok: true });
    const view = (dealt as Extract<IntentAck, { ok: true }>).result as BlackjackView;
    if (view.phase === 'player' && view.seats.filter((s) => s.status === 'playing').length >= 2) {
      return { players, roundId };
    }
    for (const c of clients.splice(0)) c.close();
    await stack.close();
  }
  throw new Error('no seed in 1..40 leaves two seats to act');
}

describe('shared blackjack table', () => {
  it('seats players in order and shows every client the same table', async () => {
    stack = await startStack({ rng: createSeededRng(1) });
    const alice = await sit(ALICE);
    const bob = await sit(BOB);
    const idle = alice.lastTable('blackjack') as TableSnapshot;
    expect(idle.phase).toBe('idle');
    expect(idle.seats).toHaveLength(BLACKJACK_SEATS);
    expect(idle.seats.every((s) => s.userId === null)).toBe(true);

    expect(await alice.bet('blackjack', 100)).toMatchObject({ ok: true });
    expect(await bob.bet('blackjack', 250)).toMatchObject({ ok: true });
    // One seat per player, in the order they sat.
    for (const c of [alice, bob]) {
      const s = await c.waitTable('blackjack', (t) => t.seats[1]?.userId === BOB.id);
      expect(s.phase).toBe('betting');
      expect(s.seats.map((x) => x.userId).slice(0, 3)).toEqual([ALICE.id, BOB.id, null]);
    }
    expect(alice.lastTable('blackjack')?.roundId).toBe(bob.lastTable('blackjack')?.roundId);
    // A second bet by a seated player and a stale round are conflicts; nothing is taken.
    expect(await alice.bet('blackjack', 100)).toMatchObject({ ok: false, error: 'conflict' });
    expect(await bob.bet('blackjack', 100, { roundId: 'bjt_old' })).toMatchObject({
      ok: false,
      error: 'conflict',
    });
    expect(await alice.balance()).toBe(INITIAL_BALANCE - 100);
    expect(await bob.balance()).toBe(INITIAL_BALANCE - 250);
  });

  it('lets only the seat whose turn it is act, and hides the hole card from everybody', async () => {
    const { players } = await dealtTable(3);
    const [alice, bob, carol] = players as [TestClient, TestClient, TestClient];
    for (const c of players) {
      const s = await c.waitTable('blackjack', (t) => t.phase === 'player');
      const v = viewOf(s);
      expect(v.dealer[0]).not.toBeNull();
      expect(v.dealer[1]).toBeNull();
      expect(v.dealerValue).toBeNull();
    }
    const view = viewOf(alice.lastTable('blackjack') as TableSnapshot);
    const byTurn = [alice, bob, carol][view.turn] as TestClient;
    const roundId = alice.lastTable('blackjack')?.roundId as string;
    const others = players.filter((p) => p !== byTurn);
    for (const other of others) {
      expect(await other.action('blackjack', roundId, 'stand')).toMatchObject({
        ok: false,
        error: 'conflict',
      });
    }
    expect(await byTurn.action('blackjack', roundId, 'stand')).toMatchObject({ ok: true });
    const next = await alice.waitTable(
      'blackjack',
      (t) => t.phase !== 'idle' && t.phase !== 'betting' && viewOf(t).turn !== view.turn,
    );
    expect(viewOf(next).seats[view.turn]?.status).toBe('done');
    // An outsider who is not seated cannot act on the table either.
    const dave = await sit(DAVE);
    expect(await dave.action('blackjack', roundId, 'hit')).toMatchObject({
      ok: false,
      error: 'conflict',
    });
  });

  it('stands a seat that runs out of time, then settles everyone and reopens the table', async () => {
    const { players } = await dealtTable(3);
    const [alice] = players as [TestClient];
    const roundId = alice.lastTable('blackjack')?.roundId as string;
    const playing = viewOf(alice.lastTable('blackjack') as TableSnapshot);
    let turns = 0;
    let previousTurn = playing.turn;
    // Nobody moves: each seat's 30 s ends and the next one is up, until the dealer plays.
    while (viewOf(alice.lastTable('blackjack') as TableSnapshot).phase === 'player') {
      stack.timers.advance(BLACKJACK_TURN_MS);
      await settle(60);
      const v = viewOf(alice.lastTable('blackjack') as TableSnapshot);
      if (v.phase === 'player') expect(v.turn).toBeGreaterThan(previousTurn);
      previousTurn = v.turn;
      expect(++turns).toBeLessThanOrEqual(BLACKJACK_SEATS);
    }
    for (const c of players) {
      const s = await c.waitTable('blackjack', (t) => t.phase === 'settled');
      const v = viewOf(s);
      expect(v.dealer.every((card) => card !== null)).toBe(true);
      expect(v.seats.every((x) => x.settlement !== undefined)).toBe(true);
      const mine = v.seats.find((x) => x.userId === c.person.id);
      expect(await c.balance()).toBe(INITIAL_BALANCE - 100 + (mine?.payout ?? 0));
    }
    // After the result window the table is idle and empty again.
    stack.timers.advance(BLACKJACK_RESULT_MS);
    const idle = await alice.waitTable(
      'blackjack',
      (t) => t.phase === 'idle' && t.roundId === null,
    );
    expect(idle.seats.every((s) => s.userId === null)).toBe(true);
    // The old round is gone: acting on it is a conflict.
    expect(await alice.action('blackjack', roundId, 'hit')).toMatchObject({
      ok: false,
      error: 'conflict',
    });
  });

  it('deals by itself when the betting window closes', async () => {
    stack = await startStack({ rng: createSeededRng(2) });
    const alice = await sit(ALICE);
    const bob = await sit(BOB);
    await alice.bet('blackjack', 100);
    await bob.bet('blackjack', 100);
    stack.timers.advance(BLACKJACK_BETTING_MS);
    const s = await bob.waitTable(
      'blackjack',
      (t) => t.phase === 'player' || t.phase === 'settled',
    );
    expect(['player', 'settled']).toContain(s.phase);
    expect(viewOf(s).seats).toHaveLength(2);
  });

  it('keeps a seat when its player leaves the room, and stops sending them the table', async () => {
    const { players } = await dealtTable(2);
    const [alice, bob] = players as [TestClient, TestClient];
    const roundId = alice.lastTable('blackjack')?.roundId as string;
    bob.leave('blackjack');
    await settle();
    const pushed = bob.seen.tables.length;
    // The hand plays on without Bob's screen: his seat is still his, so he can act from it.
    const turn = viewOf(alice.lastTable('blackjack') as TableSnapshot).turn;
    expect(await (turn === 0 ? alice : bob).action('blackjack', roundId, 'stand')).toMatchObject({
      ok: true,
    });
    // Whatever is left times out (30 s per seat) and the hand is paid.
    for (let i = 0; i < BLACKJACK_SEATS; i++) {
      if (viewOf(alice.lastTable('blackjack') as TableSnapshot).phase !== 'player') break;
      stack.timers.advance(BLACKJACK_TURN_MS);
      await settle(60);
    }
    const settled = await alice.waitTable('blackjack', (t) => t.phase === 'settled');
    await settle();
    expect(bob.seen.tables.length).toBe(pushed);
    // Money still reaches him through his own channel, and he is paid exactly once.
    const seat = viewOf(settled).seats[1];
    expect(await bob.balance()).toBe(INITIAL_BALANCE - 100 + (seat?.payout ?? 0));
    // Rejoining the room returns the live table.
    expect((await bob.join('blackjack')).roundId).toBe(roundId);
  });

  it('shows nothing to another instance or another guild', async () => {
    stack = await startStack({ rng: createSeededRng(4) });
    const alice = await sit(ALICE);
    const bob = await sit(BOB);
    const otherInstance = await sit(DAVE, { instanceId: INSTANCE_A2 });
    const otherGuild = await sit(DAVE, { guildId: GUILD_B, instanceId: INSTANCE_B1 });
    await alice.bet('blackjack', 100);
    await bob.bet('blackjack', 100);
    await alice.waitTable('blackjack', (t) => t.seats[1]?.userId === BOB.id);
    stack.timers.advance(BLACKJACK_BETTING_MS);
    await alice.waitTable('blackjack', (t) => t.phase === 'player' || t.phase === 'settled');
    await settle();
    for (const outsider of [otherInstance, otherGuild]) {
      const live = outsider.seen.tables.filter((t) => t.game === 'blackjack' && t.phase !== 'idle');
      expect(live).toEqual([]);
      for (const update of outsider.seen.balances) expect(update.userId).toBe(DAVE.id);
    }
    // The table of the other instance is its own: Dave can sit there alone.
    expect(await otherInstance.bet('blackjack', 100)).toMatchObject({ ok: true });
    const solo = await otherInstance.waitTable('blackjack', (t) => t.phase === 'betting');
    expect(solo.seats[0]?.userId).toBe(DAVE.id);
    expect(solo.seats[1]?.userId).toBeNull();
    expect(solo.roundId).not.toBe(alice.lastTable('blackjack')?.roundId);
  });
});
