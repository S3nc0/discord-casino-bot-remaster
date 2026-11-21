import { Value } from 'typebox/value';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InboxUnread,
  Participants,
  SOCKET_PATH,
  rooms,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
  type TableSnapshot,
  type TokenResponse,
} from '@casino/shared';
import {
  GUILD,
  INSTANCE,
  OTHER_GUILD,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../runtime/test-kit.ts';
import { joinScoped, type CasinoSocket } from './server.ts';

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

async function login(overrides: Record<string, unknown> = {}): Promise<TokenResponse> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE, ...overrides },
  });
  return res.json<TokenResponse>();
}

function open(url: string, auth: unknown, headers?: Record<string, string>): Client {
  const client: Client = connect(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    auth: auth as { token: string },
    extraHeaders: headers ?? server.signed(),
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

const failedWith = (c: Client): Promise<{ message: string; data?: unknown }> =>
  new Promise((resolve, reject) => {
    c.once('connect', () => reject(new Error('connected unexpectedly')));
    c.once('connect_error', (e) => resolve(e as { message: string; data?: unknown }));
  });

const next = <K extends keyof ServerToClientEvents>(
  c: Client,
  event: K,
): Promise<Parameters<ServerToClientEvents[K]>[0]> =>
  new Promise((resolve) => {
    (c as unknown as { once(e: string, f: (p: never) => void): void }).once(event, ((p: never) =>
      resolve(p)) as never);
  });

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('handshake', () => {
  it('accepts a valid session token and fills socket.data from the claims', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const [socket] = [...server.io.sockets.sockets.values()];
    expect(socket?.data).toMatchObject({
      userId: USER,
      guildId: GUILD,
      instanceId: INSTANCE,
      locale: 'en',
      expiresAt: server.clock.now() + 3600_000,
    });
    expect(typeof socket?.data.jti).toBe('string');
    expect(socket?.conn.transport.name).toBe('websocket');
  });

  it('joins exactly the guild, instance and user rooms of the token', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const [socket] = [...server.io.sockets.sockets.values()];
    const joined = [...(socket?.rooms ?? [])].filter((r) => r !== socket?.id).sort();
    expect(joined).toEqual([rooms.guild(GUILD), rooms.instance(INSTANCE), rooms.user(USER)].sort());
  });

  it('rejects a missing, malformed, wrongly signed or revoked token', async () => {
    const url = await start();
    const { sessionToken } = await login();
    for (const auth of [
      undefined,
      {},
      { token: 42 },
      { token: '' },
      { token: 'junk.junk.junk' },
      { token: `${sessionToken}x` },
    ]) {
      const err = await failedWith(open(url, auth));
      expect(err.data).toEqual({ error: 'unauthorized' });
    }
    const claims = JSON.parse(
      Buffer.from(sessionToken.split('.')[1] ?? '', 'base64url').toString(),
    ) as { jti: string; exp: number };
    server.sessions.revoke(claims);
    expect((await failedWith(open(url, { token: sessionToken }))).data).toEqual({
      error: 'unauthorized',
    });
  });

  it('rejects an expired token with `expired`', async () => {
    const url = await start();
    const { sessionToken } = await login();
    server.clock.advance(3601_000);
    const err = await failedWith(open(url, { token: sessionToken }));
    expect(err.data).toEqual({ error: 'expired' });
  });

  it('checks the Discord proxy signature on the upgrade', async () => {
    const url = await start();
    const { sessionToken } = await login();
    await failedWith(open(url, { token: sessionToken }, {}));
    await failedWith(
      open(
        url,
        { token: sessionToken },
        { ...server.signed(), 'x-signature-ed25519': 'cd'.repeat(64) },
      ),
    );
    await connected(open(url, { token: sessionToken }));
  });

  it('does not offer long polling', async () => {
    const url = await start();
    const res = await fetch(`${url}${SOCKET_PATH}/?EIO=4&transport=polling`, {
      headers: server.signed(),
    });
    expect(res.status).toBe(400);
  });
});

describe('session expiry while connected', () => {
  it('emits session:error expired and disconnects on the next event after expiry', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    // before expiry the clock probe works
    expect(await new Promise<number>((r) => client.emit('time:ping', r))).toBe(server.clock.now());
    server.clock.advance(3601_000);
    const error = next(client, 'session:error');
    const closed = new Promise((r) => client.once('disconnect', r));
    client.emit('time:ping', () => {});
    expect(await error).toEqual({ error: 'expired' });
    await closed;
    expect(client.connected).toBe(false);
  });

  it('disconnects a quiet client at expiry (real timer)', async () => {
    // The manual clock stays put; the timer is armed for `expiresAt - now` = 1 s of real time.
    const url = await start({ sessionTtlSeconds: 1 });
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const error = next(client, 'session:error');
    const closed = new Promise((r) => client.once('disconnect', r));
    expect(await error).toEqual({ error: 'expired' });
    await closed;
  }, 10_000);

  it('revoking a session disconnects its sockets', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const closed = new Promise((r) => client.once('disconnect', r));
    const [socket] = [...server.io.sockets.sockets.values()];
    server.sessions.revoke({
      jti: socket?.data.jti ?? '',
      exp: Math.floor(server.clock.now() / 1000) + 3600,
    });
    await closed;
  });
});

describe('rooms and fan-out', () => {
  it('delivers guild events to the guild room only and balances to the user room only', async () => {
    const url = await start();
    const { sessionToken } = await login();
    server.discord.state.user = {
      id: OTHER_USER,
      username: 'bob',
      global_name: null,
      avatar: null,
    };
    server.discord.state.instance = {
      instance_id: INSTANCE,
      location: { guild_id: GUILD },
      users: [USER, OTHER_USER],
    };
    const other = await login();
    const a = open(url, { token: sessionToken });
    const b = open(url, { token: other.sessionToken });
    await Promise.all([connected(a), connected(b)]);

    const gotA: string[] = [];
    const gotB: string[] = [];
    a.on('domain:event', (e) => gotA.push(`domain:${e.type}`));
    b.on('domain:event', (e) => gotB.push(`domain:${e.type}`));
    a.on('balance:update', (u) => gotA.push(`balance:${u.balance}`));
    b.on('balance:update', (u) => gotB.push(`balance:${u.balance}`));

    const event = { type: 'DailyReady', guildId: GUILD, at: 1, userId: USER } as DomainEvent;
    server.bus.publishDomain(event);
    server.bus.publishDomain({ ...event, guildId: OTHER_GUILD } as DomainEvent); // another guild: nobody here
    server.economy.credit({ guildId: GUILD, userId: USER, amount: 10, reason: 'admin_grant' });
    await settle();
    expect(gotA).toEqual(['domain:DailyReady', 'balance:3010']);
    expect(gotB).toEqual(['domain:DailyReady']);
  });

  it("never delivers another guild's or user's room traffic", async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    await settle(); // the connect-time instance:participants has arrived
    const got: unknown[] = [];
    client.onAny((...args) => got.push(args));
    server.io
      .to(rooms.guild(OTHER_GUILD))
      .emit('toast', { guildId: OTHER_GUILD, tone: 'info', messageKey: 'x' });
    server.io
      .to(rooms.user(OTHER_USER))
      .emit('toast', { guildId: GUILD, tone: 'info', messageKey: 'x' });
    server.io
      .to(rooms.instance('i-other'))
      .emit('toast', { guildId: GUILD, tone: 'info', messageKey: 'x' });
    await settle();
    expect(got).toEqual([]);
  });

  it('joinScoped refuses every room outside the token scope', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const [socket] = [...server.io.sockets.sockets.values()] as CasinoSocket[];
    if (!socket) throw new Error('no socket');
    for (const room of [
      rooms.guild(OTHER_GUILD),
      rooms.user(OTHER_USER),
      rooms.instance('i-other'),
      rooms.table('i-other', 'slots'),
      'guild:',
      'table:x',
      'admin',
      'user:123456789012345678:extra',
    ]) {
      expect(joinScoped(socket, room), room).toBe(false);
      expect(socket.rooms.has(room)).toBe(false);
    }
    expect(joinScoped(socket, rooms.table(INSTANCE, 'slots'))).toBe(true);
  });

  it('a client cannot ask to join an arbitrary room', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const loose = client as unknown as { emit(e: string, ...a: unknown[]): void };
    loose.emit('join', rooms.guild(OTHER_GUILD));
    loose.emit('join', rooms.user(OTHER_USER));
    loose.emit('room:join', 'guild:' + OTHER_GUILD);
    const ack = await new Promise((r) =>
      client.emit(
        'table:join',
        { game: 'slots', room: rooms.guild(OTHER_GUILD) } as never,
        r as never,
      ),
    );
    expect(ack).toEqual({ ok: false, error: 'invalid_payload' });
    await settle();
    const [socket] = [...server.io.sockets.sockets.values()];
    expect(
      [...(socket?.rooms ?? [])].some((r) => r.includes(OTHER_GUILD) || r.includes(OTHER_USER)),
    ).toBe(false);
  });
});

describe('table rooms and handlers', () => {
  it('without a table provider table:join answers feature_disabled and joins nothing', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const ack = await new Promise((r) => client.emit('table:join', { game: 'slots' }, r as never));
    expect(ack).toEqual({ ok: false, error: 'feature_disabled' });
    const [socket] = [...server.io.sockets.sockets.values()];
    expect(socket?.rooms.has(rooms.table(INSTANCE, 'slots'))).toBe(false);
  });

  it('validates every inbound payload and answers intents in their own shape', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    expect(
      await new Promise((r) => client.emit('table:join', { game: 'nope' } as never, r as never)),
    ).toEqual({
      ok: false,
      error: 'invalid_payload',
    });
    expect(
      await new Promise((r) => client.emit('game:bet', { junk: true } as never, r as never)),
    ).toEqual({
      ok: false,
      idempotencyKey: null,
      error: 'invalid_payload',
    });
    expect(
      await new Promise((r) => client.emit('inbox:read', { ids: [] } as never, r as never)),
    ).toEqual({
      ok: false,
      error: 'invalid_payload',
    });
  });

  it('rate-limits a flooding socket', async () => {
    const url = await start();
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const results = await Promise.all(
      Array.from(
        { length: 130 },
        () => new Promise<unknown>((r) => client.emit('table:join', { game: 'slots' }, r as never)),
      ),
    );
    expect(
      results.filter((r) => (r as { error: string }).error === 'rate_limited').length,
    ).toBeGreaterThanOrEqual(25);
  });
});

describe('table provider', () => {
  it("joins the token's own table room and returns the snapshot", async () => {
    const snapshot: TableSnapshot = {
      guildId: GUILD,
      instanceId: INSTANCE,
      game: 'blackjack',
      seq: 1,
      roundId: null,
      phase: 'idle',
      seats: [],
      data: {},
    };
    const url = await start({
      socketHandlers: {
        tableSnapshot: (scope, game) => ({ ...snapshot, game, instanceId: scope.instanceId }),
      },
    });
    const { sessionToken } = await login();
    const client = open(url, { token: sessionToken });
    await connected(client);
    const ack = await new Promise((r) =>
      client.emit('table:join', { game: 'blackjack' }, r as never),
    );
    expect(ack).toMatchObject({ ok: true, data: { game: 'blackjack', instanceId: INSTANCE } });
    const [socket] = [...server.io.sockets.sockets.values()];
    expect(socket?.rooms.has(rooms.table(INSTANCE, 'blackjack'))).toBe(true);
    client.emit('table:leave', { game: 'blackjack' });
    await settle();
    expect(socket?.rooms.has(rooms.table(INSTANCE, 'blackjack'))).toBe(false);
  });
});

/** Log in as another user in the same instance (the fake Discord answers for whoever is set). */
async function loginAs(id: string, username: string): Promise<string> {
  server.discord.state.user = { id, username, global_name: null, avatar: null };
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: GUILD },
    users: [USER, OTHER_USER],
  };
  return (await login()).sessionToken;
}

const collect = <K extends keyof ServerToClientEvents>(c: Client, event: K) => {
  const seen: Parameters<ServerToClientEvents[K]>[0][] = [];
  (c as unknown as { on(e: string, f: (p: never) => void): void }).on(event, ((p: never) =>
    seen.push(p)) as never);
  return seen;
};

describe('instance:participants', () => {
  it('sends the full list to the new socket and the room, ordered by join time', async () => {
    const url = await start();
    const aliceToken = await loginAs(USER, 'alice');
    const bobToken = await loginAs(OTHER_USER, 'bob');

    const alice = open(url, { token: aliceToken });
    const aliceSeen = collect(alice, 'instance:participants');
    await connected(alice);
    await settle();
    expect(aliceSeen).toHaveLength(1);
    expect(aliceSeen[0]).toMatchObject({
      guildId: GUILD,
      instanceId: INSTANCE,
      users: [{ id: USER, username: 'alice', globalName: null, avatar: null }],
    });
    expect(Value.Check(Participants, aliceSeen[0])).toBe(true);

    const bob = open(url, { token: bobToken });
    const bobSeen = collect(bob, 'instance:participants');
    await connected(bob);
    await settle();
    // bob got the list right after joining; alice got the update
    expect(bobSeen.at(-1)?.users.map((u) => u.id)).toEqual([USER, OTHER_USER]);
    expect(aliceSeen.at(-1)?.users.map((u) => u.id)).toEqual([USER, OTHER_USER]);
    expect(aliceSeen.at(-1)?.users[1]?.username).toBe('bob');
  });

  it('updates when the last socket of a user leaves, not when a second socket of the user does', async () => {
    const url = await start();
    const aliceToken = await loginAs(USER, 'alice');
    const bobToken = await loginAs(OTHER_USER, 'bob');
    const alice = open(url, { token: aliceToken });
    await connected(alice);
    const seen = collect(alice, 'instance:participants');

    const bob1 = open(url, { token: bobToken });
    const bob2 = open(url, { token: bobToken });
    await Promise.all([connected(bob1), connected(bob2)]);
    await settle();
    expect(seen.at(-1)?.users.map((u) => u.id)).toEqual([USER, OTHER_USER]); // bob listed once
    const before = seen.length;

    bob1.close();
    await settle(150);
    expect(seen).toHaveLength(before); // bob still has a socket

    bob2.close();
    await settle(150);
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)?.users.map((u) => u.id)).toEqual([USER]);
  });

  it('is scoped to the instance', async () => {
    const url = await start();
    const aliceToken = await loginAs(USER, 'alice');
    const alice = open(url, { token: aliceToken });
    await connected(alice);
    await settle();
    const seen = collect(alice, 'instance:participants');
    // a different instance in the same guild
    server.discord.state.user = {
      id: OTHER_USER,
      username: 'bob',
      global_name: null,
      avatar: null,
    };
    server.discord.state.instance = {
      instance_id: 'i-other',
      location: { guild_id: GUILD },
      users: [OTHER_USER],
    };
    const other = (await login({ instanceId: 'i-other' })).sessionToken;
    await connected(open(url, { token: other }));
    await settle();
    expect(seen).toEqual([]);
  });
});

describe('inbox:unread', () => {
  const addItems = (userId: string, guildId: string, n: number): number[] =>
    Array.from({ length: n }, (_, i) =>
      Number(
        server.store.db
          .prepare(
            'INSERT INTO inbox (user_id, guild_id, kind, payload, created_at) VALUES (?, ?, ?, ?, 0)',
          )
          .run(
            userId,
            guildId,
            'daily_ready',
            JSON.stringify({ type: 'DailyReady', guildId, at: i, userId }),
          ).lastInsertRowid,
      ),
    );

  it('inbox:read acks the count and every socket of the user hears inbox:unread, nobody else', async () => {
    const url = await start();
    const aliceToken = await loginAs(USER, 'alice');
    const bobToken = await loginAs(OTHER_USER, 'bob');
    const ids = addItems(USER, GUILD, 3);
    addItems(OTHER_USER, GUILD, 2);

    const tab1 = open(url, { token: aliceToken });
    const tab2 = open(url, { token: aliceToken });
    const bob = open(url, { token: bobToken });
    await Promise.all([connected(tab1), connected(tab2), connected(bob)]);
    const seen1 = collect(tab1, 'inbox:unread');
    const seen2 = collect(tab2, 'inbox:unread');
    const seenBob = collect(bob, 'inbox:unread');

    const ack = await new Promise((r) =>
      tab1.emit('inbox:read', { ids: [ids[0] ?? 0] }, r as never),
    );
    expect(ack).toEqual({ ok: true, data: { unread: 2 } });
    await settle();
    expect(seen1).toEqual([{ guildId: GUILD, unread: 2 }]);
    expect(seen2).toEqual([{ guildId: GUILD, unread: 2 }]);
    expect(seenBob).toEqual([]);
    expect(Value.Check(InboxUnread, seen1[0])).toBe(true);
  });

  it("also fires for a read over HTTP, and ignores ids that are not the session user's", async () => {
    const url = await start();
    const aliceToken = await loginAs(USER, 'alice');
    const alice = open(url, { token: aliceToken });
    await connected(alice);
    const seen = collect(alice, 'inbox:unread');
    const mine = addItems(USER, GUILD, 2);
    const theirs = addItems(OTHER_USER, GUILD, 1);

    const res = await server.app.inject({
      method: 'POST',
      url: '/api/inbox/read',
      headers: { ...server.signed(), authorization: `Bearer ${aliceToken}` },
      payload: { all: true },
    });
    expect(res.json()).toEqual({ unread: 0 });
    await settle();
    expect(seen).toEqual([{ guildId: GUILD, unread: 0 }]);

    const ack = await new Promise((r) =>
      alice.emit('inbox:read', { ids: [...theirs, ...mine] }, r as never),
    );
    expect(ack).toEqual({ ok: true, data: { unread: 0 } });
    expect(
      server.store.db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE read_at IS NULL').get(),
    ).toEqual({ n: 1 });
  });
});
