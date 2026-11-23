// Regression tests for the transport review findings (R-3, R-4, R-7, R-11) on the socket side.
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SOCKET_PATH,
  type ClientToServerEvents,
  type DomainEvent,
  type IntentAck,
  type ServerToClientEvents,
} from '@casino/shared';
import {
  GUILD,
  INSTANCE,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../runtime/test-kit.ts';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let server: TestServer;
const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.close();
});

async function start(options: Parameters<typeof createTestServer>[0] = {}): Promise<string> {
  server = createTestServer(options);
  return server.app.listen({ port: 0, host: '127.0.0.1' });
}

/** A session for `userId` in the test guild and instance. */
async function loginAs(userId: string, username = 'user'): Promise<string> {
  server.discord.state.user = { id: userId, username, global_name: null, avatar: null };
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [USER, OTHER_USER],
  };
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  return res.json<{ sessionToken: string }>().sessionToken;
}

function open(url: string, token: string): Client {
  const client: Client = connect(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    auth: { token },
    extraHeaders: server.signed(),
    reconnection: false,
    forceNew: true,
  });
  clients.push(client);
  return client;
}

const connected = (c: Client): Promise<void> =>
  new Promise((resolve, reject) => {
    c.once('connect', resolve);
    c.once('connect_error', reject);
  });

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BET = {
  idempotencyKey: 'k'.repeat(20),
  game: 'slots',
  stake: 10,
} as const;
const ACK_OK: IntentAck = { ok: true, idempotencyKey: BET.idempotencyKey, data: {} } as never;

describe('R-3: events without an ack callback never throw on the server', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => void unhandled.push(reason);

  it('R-3: game:bet, game:action, table:join and inbox:read survive a missing ack', async () => {
    const url = await start({
      socketHandlers: {
        bet: () => ACK_OK,
        action: () => ACK_OK,
        tableSnapshot: () => null,
      },
    });
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);
    try {
      const client = open(url, await loginAs(USER));
      await connected(client);
      const loose = client as unknown as { emit(e: string, ...a: unknown[]): void };
      loose.emit('game:bet', BET);
      loose.emit('game:action', {
        idempotencyKey: BET.idempotencyKey,
        game: 'slots',
        roundId: 'r1',
        action: 'hit',
      });
      loose.emit('table:join', { game: 'slots' });
      loose.emit('inbox:read', { all: true });
      await settle(150);
      // The same socket still answers.
      const now = await new Promise<number>((r) => client.emit('time:ping', r));
      expect(now).toBe(server.clock.now());
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      process.off('uncaughtException', onUnhandled);
    }
  });

  it('R-3: a handler without a hook and no ack does not throw either', async () => {
    const url = await start();
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);
    try {
      const client = open(url, await loginAs(USER));
      await connected(client);
      (client as unknown as { emit(e: string, ...a: unknown[]): void }).emit('game:bet', BET);
      await settle(150);
      expect(unhandled).toEqual([]);
      expect(client.connected).toBe(true);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      process.off('uncaughtException', onUnhandled);
    }
  });
});
