import { describe, expect, it } from 'vitest';
import type { IntentAck, TableSnapshot } from '@casino/shared';
import { FakeSocket } from '../../shell/testing/fakes.ts';
import { GameError, createSocketClient, newKey } from './client.ts';

const accepted = (
  result: unknown,
  patch: Partial<Extract<IntentAck, { ok: true }>> = {},
): IntentAck => ({
  ok: true,
  idempotencyKey: 'k'.repeat(16),
  replayed: false,
  balance: 900,
  result,
  ...patch,
});

function setup(connected = true, instanceId: string | null = 'i-1') {
  const socket = new FakeSocket();
  socket.connected = connected;
  const client = createSocketClient({
    getSocket: () => socket.asSocket(),
    getInstanceId: () => instanceId,
    now: () => 1_000,
  });
  const last = () =>
    socket.emitted[socket.emitted.length - 1] as { event: string; args: unknown[] };
  /** The intent of the last emit (the first argument). */
  const intent = () => last().args[0] as Record<string, unknown>;
  const ack = (response: unknown) => {
    const args = last().args;
    (args[args.length - 1] as (r: unknown) => void)(response);
  };
  return { socket, client, last, intent, ack };
}

describe('socket client', () => {
  it('sends a bet intent with a fresh idempotency key and resolves with the result', async () => {
    const { client, last, intent, ack } = setup();
    const pending = client.bet<{ n: number }>('slots', { stake: 50 });
    expect(last().event).toBe('game:bet');
    expect(intent()).toMatchObject({ game: 'slots', stake: 50 });
    expect(intent()['idempotencyKey']).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(intent()).not.toHaveProperty('result');
    ack(accepted({ n: 1 }, { roundId: 'r-1' }));
    await expect(pending).resolves.toEqual({
      balance: 900,
      roundId: 'r-1',
      result: { n: 1 },
      replayed: false,
    });
  });

  it('forwards bet lines, round id and args, and omits what is not set', async () => {
    const { client, intent, ack } = setup();
    const pending = client.bet('roulette', {
      stake: 30,
      bets: [{ kind: 'red', targets: [], stake: 30 }],
      roundId: 'rlt-1',
      args: { table: true },
    });
    expect(intent()).toMatchObject({
      bets: [{ kind: 'red', targets: [], stake: 30 }],
      roundId: 'rlt-1',
      args: { table: true },
    });
    ack(accepted(null));
    await pending;
    const plain = client.bet('slots', { stake: 10 });
    expect(Object.keys(intent()).sort()).toEqual(['game', 'idempotencyKey', 'stake']);
    ack(accepted(null));
    await plain;
  });

  it('sends an action for the round and turns a rejection into a typed GameError', async () => {
    const { client, last, intent, ack } = setup();
    const pending = client.action('blackjack', 'bjt-1', 'hit');
    expect(last().event).toBe('game:action');
    expect(intent()).toMatchObject({
      game: 'blackjack',
      roundId: 'bjt-1',
      action: 'hit',
    });
    ack({ ok: false, idempotencyKey: null, error: 'conflict' } satisfies IntentAck);
    await expect(pending).rejects.toMatchObject({ code: 'conflict', offline: false });
  });

  it('carries retryAfterMs of a rate limit', async () => {
    const { client, ack } = setup();
    const pending = client.bet('slots', { stake: 10 });
    ack({
      ok: false,
      idempotencyKey: null,
      error: 'rate_limited',
      retryAfterMs: 2_500,
    } satisfies IntentAck);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GameError);
    expect((error as GameError).retryAfterMs).toBe(2_500);
  });

  it('fails at once, as offline, when the socket is not connected', async () => {
    const { client, socket } = setup(false);
    await expect(client.bet('slots', { stake: 10 })).rejects.toMatchObject({ offline: true });
    expect(socket.emitted).toHaveLength(0);
  });

  it('joins a table once, hears its snapshots, and leaves with the last listener', () => {
    const { client, socket, last } = setup();
    const heard: TableSnapshot[] = [];
    const off1 = client.watchTable('roulette', (s) => heard.push(s));
    const off2 = client.watchTable('roulette', () => undefined);
    expect(socket.emitted.filter((e) => e.event === 'table:join')).toHaveLength(1);
    const snap = {
      guildId: 'g',
      instanceId: 'i-1',
      game: 'roulette',
      seq: 1,
      roundId: null,
      phase: 'idle',
      seats: [],
      data: {},
    };
    socket.trigger('table:state', snap);
    socket.trigger('table:state', { ...snap, instanceId: 'other' });
    socket.trigger('table:state', { ...snap, game: 'blackjack' });
    expect(heard).toHaveLength(1);
    off1();
    expect(socket.emitted.some((e) => e.event === 'table:leave')).toBe(false);
    off2();
    expect(last()).toEqual({ event: 'table:leave', args: [{ game: 'roulette' }] });
  });

  it('delivers the snapshot from the join ack and joins again after a reconnect', () => {
    const { client, socket } = setup();
    const heard: number[] = [];
    client.watchTable('chinchiro', (s) => heard.push(s.seq));
    const join = socket.emitted.find((e) => e.event === 'table:join') as { args: unknown[] };
    (join.args[1] as (r: unknown) => void)({
      ok: true,
      data: {
        guildId: 'g',
        instanceId: 'i-1',
        game: 'chinchiro',
        seq: 4,
        roundId: null,
        phase: 'idle',
        seats: [],
        data: {},
      },
    });
    expect(heard).toEqual([4]);
    socket.trigger('connect');
    expect(socket.emitted.filter((e) => e.event === 'table:join')).toHaveLength(2);
  });

  it('measures the server clock offset once with time:ping', () => {
    const { client, socket } = setup();
    client.watchTable('roulette', () => undefined);
    const ping = socket.emitted.find((e) => e.event === 'time:ping') as {
      args: ((n: number) => void)[];
    };
    ping.args[0]?.(61_000);
    expect(client.clockOffsetMs()).toBe(60_000);
    client.watchTable('blackjack', () => undefined);
    expect(socket.emitted.filter((e) => e.event === 'time:ping')).toHaveLength(1);
  });

  it('makes keys the server accepts', () => {
    const a = newKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(newKey()).not.toBe(a);
  });
});
