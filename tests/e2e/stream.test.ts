import { afterEach, describe, expect, it } from 'vitest';
import {
  STREAM_ROUTES,
  type DomainEvent,
  type StreamSettleResponse,
  type StreamStartResponse,
  type StreamView,
} from '../../packages/shared/src/index.ts';
import { INITIAL_BALANCE } from '../../apps/server/src/economy/economy-service.ts';
import { connectClient, newKey, settle, type TestClient } from './support/clients.ts';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  GUILD_B,
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

const post = async <T>(c: TestClient, url: string, payload: object): Promise<T> => {
  const res = await stack.app.inject({ method: 'POST', url, headers: c.headers(), payload });
  if (res.statusCode !== 200) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return res.json<T>();
};

const ofType = <T extends DomainEvent['type']>(c: TestClient, type: T) =>
  c.seen.domain.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);

describe('stream panel over HTTP and the stream room', () => {
  it('two viewers see the totals move, the streamer settles and the balances match', async () => {
    stack = await startStack();
    const alice = await join(ALICE); // streamer
    const bob = await join(BOB);
    const carol = await join(CAROL);
    const daveB = await join(DAVE, { guildId: GUILD_B, instanceId: INSTANCE_B1 });

    const start = await post<StreamStartResponse>(alice, STREAM_ROUTES.start, {
      idempotencyKey: newKey('start'),
      title: 'Boss fight',
    });
    const streamId = start.stream.id;

    // Both viewers join the room; another guild cannot.
    for (const c of [bob, carol]) {
      const ack = await c.socket.emitWithAck('stream:join', { streamId });
      expect(ack).toMatchObject({ ok: true, data: { id: streamId, status: 'live' } });
    }
    expect(await daveB.socket.emitWithAck('stream:join', { streamId })).toMatchObject({
      ok: false,
      error: 'not_found',
    });
    // The start is public in the guild (the live list); the other guild hears nothing.
    await bob.waitFor(() => ofType(bob, 'StreamStarted').length === 1, 'StreamStarted');

    const opened = await post<{ stream: StreamView }>(alice, STREAM_ROUTES.open, {
      idempotencyKey: newKey('open'),
      streamId,
    });
    const roundId = opened.stream.round!.id;
    await carol.waitFor(() => ofType(carol, 'StreamRoundOpened').length === 1, 'round opened');

    await post(bob, STREAM_ROUTES.bet, {
      idempotencyKey: newKey('bet'),
      streamId,
      roundId,
      side: 'win',
      amount: 1000,
    });
    await post(carol, STREAM_ROUTES.bet, {
      idempotencyKey: newKey('bet'),
      streamId,
      roundId,
      side: 'lose',
      amount: 2000,
    });
    for (const c of [bob, carol]) {
      await c.waitFor(
        () =>
          ofType(c, 'StreamBetPlaced').some(
            (e) => e.winTotal === 1000 && e.loseTotal === 2000 && e.bettors === 2,
          ),
        'both totals',
      );
    }

    await post(alice, STREAM_ROUTES.lock, { idempotencyKey: newKey('lock'), streamId, roundId });
    const settled = await post<StreamSettleResponse>(alice, STREAM_ROUTES.settle, {
      idempotencyKey: newKey('settle'),
      streamId,
      roundId,
      winner: 'win',
    });
    // Carol's 2,000 lose: rake 100, Bob gets 1,000 + 1,900.
    expect(settled.result).toMatchObject({
      rake: 100,
      payouts: [{ userId: BOB.id, amount: 2900 }],
    });
    for (const c of [bob, carol]) {
      await c.waitFor(() => ofType(c, 'StreamRoundSettled').length === 1, 'settled');
    }
    expect(await bob.balance()).toBe(INITIAL_BALANCE - 1000 + 2900);
    expect(await carol.balance()).toBe(INITIAL_BALANCE - 2000);
    expect(await alice.balance()).toBe(INITIAL_BALANCE);

    // Leaving the room stops the room's events; the guild-wide end still arrives.
    bob.socket.emit('stream:leave', { streamId });
    await settle();
    await post(alice, STREAM_ROUTES.end, { idempotencyKey: newKey('end'), streamId });
    await carol.waitFor(() => ofType(carol, 'StreamEnded').length === 1, 'ended');
    await bob.waitFor(() => ofType(bob, 'StreamEnded').length === 1, 'ended (guild)');
    expect(ofType(carol, 'StreamEnded')).toHaveLength(1);
    await settle();
    expect(daveB.seen.domain.filter((e) => e.type.startsWith('Stream'))).toEqual([]);
  });
});
