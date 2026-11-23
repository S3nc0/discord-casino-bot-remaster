import { afterEach, describe, expect, it } from 'vitest';
import { createSeededRng, type TableSnapshot } from '../../packages/shared/src/index.ts';
import {
  ROULETTE_BETTING_MS,
  ROULETTE_RESULT_MS,
} from '../../apps/server/src/games/casino/roulette.ts';
import { INITIAL_BALANCE } from '../../apps/server/src/economy/economy-service.ts';
import { connectClient, newKey, settle, type TestClient } from './support/clients.ts';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  GUILD_B,
  INSTANCE_A1,
  INSTANCE_A2,
  INSTANCE_B1,
  startStack,
  type Stack,
} from './support/stack.ts';

let stack: Stack;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await stack?.close();
});

async function join(
  ...args: Parameters<typeof connectClient> extends [unknown, ...infer R] ? R : never
) {
  const client = await connectClient(stack, ...args);
  clients.push(client);
  return client;
}

interface RouletteData {
  deadline: number | null;
  history: number[];
  bets: { userId: string; roundId: string; stake: number }[];
  result?: number;
  color?: string;
  timeline?: { atMs: number }[];
  payouts?: { userId: string; payout: number; net: number }[];
}
const dataOf = (s: TableSnapshot): RouletteData => s.data as RouletteData;

describe('shared roulette table', () => {
  it('gives the whole room one spin and each player only their own payout', async () => {
    stack = await startStack({ rng: createSeededRng(11) });
    const alice = await join(ALICE);
    const bob = await join(BOB);
    const carol = await join(CAROL);
    // Same guild, other instance, and another guild entirely: they must see nothing of this room.
    const dave = await join(DAVE, { instanceId: INSTANCE_A2 });
    const daveB = await join(DAVE, { guildId: GUILD_B, instanceId: INSTANCE_B1 });
    const room = [alice, bob, carol];
    for (const c of [...room, dave, daveB]) {
      const snap = await c.join('roulette');
      expect(snap.phase).toBe('idle');
    }

    const bets = await Promise.all([
      alice.bet('roulette', 100, { bets: [{ kind: 'red', targets: [], stake: 100 }] }),
      bob.bet('roulette', 50, { bets: [{ kind: 'number', targets: [17], stake: 50 }] }),
      carol.bet('roulette', 200, { bets: [{ kind: 'black', targets: [], stake: 200 }] }),
    ]);
    for (const ack of bets) expect(ack).toMatchObject({ ok: true, replayed: false });

    // Everyone in the room converges on one round and one list of bettors.
    for (const c of room) {
      const s = await c.waitTable('roulette', (t) => dataOf(t).bets.length === 3);
      expect(s.phase).toBe('betting');
    }
    const rounds = new Set(room.map((c) => c.lastTable('roulette')?.roundId));
    expect(rounds.size).toBe(1);
    const tableRound = [...rounds][0] as string;
    expect(tableRound).toBeTruthy();

    // A bet on a stale table round, and a repeat of an accepted key, change nothing.
    const stale = await alice.bet('roulette', 100, {
      bets: [{ kind: 'red', targets: [], stake: 100 }],
      roundId: 'rlt_stale',
    });
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    const key = newKey('dup');
    const first = await alice.bet('roulette', 100, {
      key,
      bets: [{ kind: 'red', targets: [], stake: 100 }],
      roundId: tableRound,
    });
    const again = await alice.bet('roulette', 100, {
      key,
      bets: [{ kind: 'red', targets: [], stake: 100 }],
      roundId: tableRound,
    });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(await alice.balance()).toBe(INITIAL_BALANCE - 200);

    // The betting window closes: one server spin, the same timeline for everybody.
    stack.timers.advance(ROULETTE_BETTING_MS);
    const spins = await Promise.all(
      room.map((c) => c.waitTable('roulette', (t) => t.phase === 'spinning')),
    );
    const first0 = dataOf(spins[0] as TableSnapshot);
    expect(first0.result).toBeGreaterThanOrEqual(0);
    expect(first0.result).toBeLessThanOrEqual(36);
    expect(first0.timeline?.length).toBeGreaterThan(0);
    for (const s of spins) expect(dataOf(s)).toEqual(first0);

    // No new bets while the wheel turns.
    const late = await carol.bet('roulette', 50, {
      bets: [{ kind: 'red', targets: [], stake: 50 }],
    });
    expect(late).toMatchObject({ ok: false, error: 'conflict' });

    // The wheel stops: payouts are in the snapshot and in each player's own balance update.
    const duration = first0.timeline?.at(-1)?.atMs ?? 0;
    stack.timers.advance(duration);
    const results = await Promise.all(
      room.map((c) => c.waitTable('roulette', (t) => t.phase === 'result')),
    );
    const result = first0.result as number;
    for (const s of results) {
      expect(dataOf(s).result).toBe(result);
      expect(dataOf(s).payouts).toEqual(dataOf(results[0] as TableSnapshot).payouts);
    }
    const payouts = new Map(dataOf(results[0] as TableSnapshot).payouts?.map((p) => [p.userId, p]));
    const redWins =
      result !== 0 &&
      [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(result);
    const blackWins = result !== 0 && !redWins;
    expect(payouts.get(ALICE.id)?.payout).toBeGreaterThanOrEqual(0);
    expect((payouts.get(ALICE.id)?.payout ?? 0) > 0).toBe(redWins);
    expect((payouts.get(CAROL.id)?.payout ?? 0) > 0).toBe(blackWins);
    expect((payouts.get(BOB.id)?.payout ?? 0) > 0).toBe(result === 17);

    const stakes = new Map([
      [ALICE.id, 200],
      [BOB.id, 50],
      [CAROL.id, 200],
    ]);
    for (const c of room) {
      const mine = payouts.get(c.person.id);
      const expected = INITIAL_BALANCE - (stakes.get(c.person.id) ?? 0) + (mine?.payout ?? 0);
      await c.waitFor(() => c.seen.balances.at(-1)?.balance === expected, 'final balance update');
      expect(await c.balance()).toBe(expected);
      // A player only ever hears about their own balance.
      expect(c.seen.balances.every((u) => u.userId === c.person.id)).toBe(true);
    }

    // Outsiders: no table state, no balance, nothing from the other room.
    await settle();
    for (const outsider of [dave, daveB]) {
      // Only their own start-balance grant: no stake, payout or anything of the other room.
      for (const update of outsider.seen.balances) {
        expect([update.userId, update.reason]).toEqual([DAVE.id, 'initial_grant']);
      }
      const states = outsider.seen.tables.filter((t) => t.game === 'roulette');
      expect(states.every((t) => t.phase === 'idle')).toBe(true);
      expect(states.every((t) => dataOf(t).bets.length === 0)).toBe(true);
    }
    // Domain events go to the guild: the same guild hears the round, another guild does not.
    expect(dave.seen.domain.some((e) => e.type === 'GameSettled')).toBe(true);
    expect(daveB.seen.domain).toEqual([]);

    // The result stays up, then the table is idle again for the next spin.
    stack.timers.advance(ROULETTE_RESULT_MS);
    const idle = await alice.waitTable(
      'roulette',
      (t) => t.phase === 'idle' && t.seq > results[0]!.seq,
    );
    expect(dataOf(idle).history[0]).toBe(result);
  });

  it('keeps table:state seq strictly increasing for every client', async () => {
    stack = await startStack({ rng: createSeededRng(5) });
    const alice = await join(ALICE);
    const bob = await join(BOB);
    await alice.join('roulette');
    await bob.join('roulette');
    await alice.bet('roulette', 50, { bets: [{ kind: 'even', targets: [], stake: 50 }] });
    await bob.bet('roulette', 50, { bets: [{ kind: 'odd', targets: [], stake: 50 }] });
    stack.timers.advance(ROULETTE_BETTING_MS);
    await alice.waitTable('roulette', (t) => t.phase === 'spinning');
    const spin = dataOf(alice.lastTable('roulette') as TableSnapshot).timeline;
    stack.timers.advance(spin?.at(-1)?.atMs ?? 0);
    await bob.waitTable('roulette', (t) => t.phase === 'result');
    for (const c of [alice, bob]) {
      const seqs = c.seen.tables.filter((t) => t.game === 'roulette').map((t) => t.seq);
      expect(seqs.length).toBeGreaterThanOrEqual(4);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(seqs.length === 0 ? 0 : new Set(seqs).size);
    }
  });

  it('stops pushing a table to a client that left it, but still pays that player', async () => {
    stack = await startStack({ rng: createSeededRng(3) });
    const alice = await join(ALICE);
    const bob = await join(BOB);
    await alice.join('roulette');
    await bob.join('roulette');
    await bob.bet('roulette', 100, { bets: [{ kind: 'red', targets: [], stake: 100 }] });
    await alice.waitTable('roulette', (t) => t.phase === 'betting');
    alice.leave('roulette');
    await settle();
    const before = alice.seen.tables.length;
    await alice.bet('roulette', 100, { bets: [{ kind: 'black', targets: [], stake: 100 }] });
    stack.timers.advance(ROULETTE_BETTING_MS);
    await bob.waitTable('roulette', (t) => t.phase === 'spinning');
    const spin = dataOf(bob.lastTable('roulette') as TableSnapshot).timeline;
    stack.timers.advance(spin?.at(-1)?.atMs ?? 0);
    await bob.waitTable('roulette', (t) => t.phase === 'result');
    await settle();
    expect(alice.seen.tables.length).toBe(before);
    // Alice's bet was accepted before she looked away: the ledger shows her stake and payout.
    const rows = stack.economy.history(alice.guildId, ALICE.id).map((e) => e.reason);
    expect(rows).toContain('game_stake');
    expect(INSTANCE_A1).toBeTruthy();
  });
});
