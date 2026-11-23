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

describe('R-4: private domain events go to their user, not the guild', () => {
  it('R-4: two users in one guild: a private event reaches only its user, a public one both', async () => {
    const url = await start();
    const alice = open(url, await loginAs(USER, 'alice'));
    const bob = open(url, await loginAs(OTHER_USER, 'bob'));
    await Promise.all([connected(alice), connected(bob)]);
    const seen = { alice: [] as string[], bob: [] as string[] };
    alice.on('domain:event', (e) => seen.alice.push(e.type));
    bob.on('domain:event', (e) => seen.bob.push(e.type));

    const at = 1;
    const events = [
      {
        type: 'OrderFilled',
        guildId: GUILD,
        at,
        userId: USER,
        orderId: 1,
        ticker: 'ABC',
        side: 'buy',
        quantity: 1000,
        price: 1_000_000,
      },
      { type: 'LoanDue', guildId: GUILD, at, userId: USER, loanId: 1, amount: 5, dueAt: at },
      {
        type: 'BankruptcyGraceStarted',
        guildId: GUILD,
        at,
        userId: USER,
        debt: 9,
        graceEndsAt: at,
      },
      { type: 'MarketplaceOutbid', guildId: GUILD, at, userId: USER, listingId: 1, newBid: 5 },
      { type: 'MissionCompleted', guildId: GUILD, at, userId: USER, missionId: 'm', reward: 5 },
      { type: 'DailyReady', guildId: GUILD, at, userId: USER },
      {
        type: 'GameSettled',
        guildId: GUILD,
        at,
        userId: USER,
        game: 'slots',
        roundId: 'r',
        stake: 5,
        payout: 0,
        net: -5,
        source: 'activity',
      },
      { type: 'MarketTick', guildId: GUILD, at, prices: { ABC: 1_000_000 } },
      {
        type: 'BigWin',
        guildId: GUILD,
        at,
        userId: USER,
        game: 'slots',
        roundId: 'r',
        payout: 99,
        multiplierBps: 50_000,
      },
    ] as DomainEvent[];
    for (const event of events) server.bus.publishDomain(event);
    await settle(150);

    expect(seen.alice).toEqual([
      'OrderFilled',
      'LoanDue',
      'BankruptcyGraceStarted',
      'MarketplaceOutbid',
      'MissionCompleted',
      'DailyReady',
      'GameSettled',
      'MarketTick',
      'BigWin',
    ]);
    expect(seen.bob).toEqual(['MarketTick', 'BigWin']);
  });

  it('R-4: a user-private event of another guild never reaches a socket of the same user elsewhere', async () => {
    const url = await start();
    const alice = open(url, await loginAs(USER, 'alice'));
    await connected(alice);
    const seen: string[] = [];
    alice.on('domain:event', (e) => seen.push(e.type));
    server.bus.publishDomain({
      type: 'DailyReady',
      guildId: '234567890123456780',
      at: 1,
      userId: USER,
    } as DomainEvent);
    await settle();
    expect(seen).toEqual([]);
  });
});

const failedWith = (c: Client): Promise<{ message: string; data?: unknown }> =>
  new Promise((resolve, reject) => {
    c.once('connect', () => reject(new Error('connected unexpectedly')));
    c.once('connect_error', (e) => resolve(e as { message: string; data?: unknown }));
  });

describe('R-7: a denied guild loses its sockets', () => {
  it('R-7: the handshake of a denied guild is refused', async () => {
    const url = await start();
    const token = await loginAs(USER);
    server.identity.setGuildStatus(GUILD, 'denied', 'owner');
    const err = await failedWith(open(url, token));
    expect(err.data).toEqual({ error: 'guild_not_allowed' });
  });

  it('R-7: revokeGuild disconnects every live socket of that guild at once', async () => {
    const url = await start();
    const a = open(url, await loginAs(USER));
    const b = open(url, await loginAs(OTHER_USER));
    await Promise.all([connected(a), connected(b)]);
    const closed = Promise.all([a, b].map((c) => new Promise((r) => c.once('disconnect', r))));
    server.identity.setGuildStatus(GUILD, 'denied', 'owner');
    server.sessions.revokeGuild(GUILD);
    await closed;
    expect(server.io.sockets.sockets.size).toBe(0);
  });

  it('R-7: even without the hook, the next event of a denied guild ends the socket', async () => {
    const url = await start({ socketHandlers: { bet: () => ACK_OK } });
    const client = open(url, await loginAs(USER));
    await connected(client);
    const closed = new Promise((r) => client.once('disconnect', r));
    server.identity.setGuildStatus(GUILD, 'denied', 'owner');
    client.emit('time:ping', () => {});
    await closed;
  });

  it('R-7: revokeGuild leaves other guilds alone', async () => {
    const url = await start();
    const client = open(url, await loginAs(USER));
    await connected(client);
    server.sessions.revokeGuild('234567890123456780');
    await settle(150);
    expect(client.connected).toBe(true);
  });
});
