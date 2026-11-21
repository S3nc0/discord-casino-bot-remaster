import { afterEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  DEFAULT_USER_SETTINGS,
  InboxPage,
  SettingsResponse,
  type TokenResponse,
  type UserSettings,
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

let server: TestServer;
afterEach(async () => {
  await server.close();
});

/** Log in through the real token flow; returns authenticated request helpers. */
async function session(
  who: { id: string; guild?: string } = { id: USER },
  options: Parameters<typeof createTestServer>[0] = {},
) {
  const guild = who.guild ?? GUILD;
  server ??= createTestServer(options);
  server.discord.state.user = {
    id: who.id,
    username: `u${who.id.slice(-3)}`,
    global_name: null,
    avatar: null,
  };
  server.discord.state.guilds = [{ id: guild, name: 'G' }];
  server.discord.state.instance = {
    instance_id: INSTANCE,
    location: { guild_id: guild },
    users: [who.id],
  };
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: guild, instanceId: INSTANCE },
  });
  const { sessionToken } = res.json<TokenResponse>();
  const headers = () => ({ ...server.signed(), authorization: `Bearer ${sessionToken}` });
  return {
    authorization: () => `Bearer ${sessionToken}`,
    get: (url: string) => server.app.inject({ url, headers: headers() }),
    send: (method: 'PUT' | 'POST', url: string, payload?: object) =>
      server.app.inject({
        method,
        url,
        headers: headers(),
        ...(payload === undefined ? {} : { payload }),
      }),
  };
}

const custom: UserSettings = {
  language: 'ja',
  theme: 'dark',
  sound: { enabled: false, sfxVolume: 10, musicVolume: 90 },
  motion: 'reduced',
};

function addInbox(userId: string, guildId: string, n: number, kind = 'daily_ready'): number[] {
  const ids: number[] = [];
  const insert = server.store.db.prepare(
    `INSERT INTO inbox (user_id, guild_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < n; i++) {
    const payload = JSON.stringify({ type: 'DailyReady', guildId, at: i, userId });
    ids.push(Number(insert.run(userId, guildId, kind, payload, 1000 + i).lastInsertRowid));
  }
  return ids;
}

describe('every new route needs a session', () => {
  it('401 without a bearer token', async () => {
    server = createTestServer();
    for (const [method, url] of [
      ['GET', '/api/settings'],
      ['PUT', '/api/settings'],
      ['GET', '/api/inbox'],
      ['POST', '/api/inbox/read'],
      ['POST', '/api/launch-intent/consume'],
    ] as const) {
      const res = await server.app.inject({ method, url, headers: server.signed(), payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
  });
});

describe('GET /api/me', () => {
  it('reports the guild name and locale hints', async () => {
    server = createTestServer();
    const me = await session();
    server.store.db.prepare("UPDATE guild_config SET locale = 'ja'").run();
    await me.send('PUT', '/api/settings', { ...custom, language: 'en' });
    const body = (await me.get('/api/me')).json();
    expect(body).toMatchObject({
      guild: { id: GUILD, name: 'G' },
      locale: 'en',
      localeHints: { setting: 'en', guild: 'ja' },
    });
    expect(body).not.toHaveProperty('guildId');
  });
});

describe('/api/settings', () => {
  it('returns the defaults for a user without a row', async () => {
    server = createTestServer();
    const me = await session();
    const res = await me.get('/api/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_USER_SETTINGS);
    expect(DEFAULT_USER_SETTINGS.sound.sfxVolume).toBe(30);
    expect(server.store.db.prepare('SELECT COUNT(*) AS n FROM user_settings').get()).toEqual({
      n: 0,
    });
  });

  it('PUT replaces the whole document and GET returns it', async () => {
    server = createTestServer();
    const me = await session();
    const put = await me.send('PUT', '/api/settings', custom);
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual(custom);
    expect(Value.Check(SettingsResponse, put.json())).toBe(true);
    expect((await me.get('/api/settings')).json()).toEqual(custom);
    expect(
      server.store.db
        .prepare('SELECT locale, sound, sfx_volume, music_volume, motion, theme FROM user_settings')
        .get(),
    ).toEqual({
      locale: 'ja',
      sound: 0,
      sfx_volume: 10,
      music_volume: 90,
      motion: 'reduced',
      theme: 'dark',
    });

    const back = { ...DEFAULT_USER_SETTINGS } as UserSettings;
    expect((await me.send('PUT', '/api/settings', back)).json()).toEqual(DEFAULT_USER_SETTINGS);
    expect(server.store.db.prepare('SELECT locale FROM user_settings').get()).toEqual({
      locale: null,
    });
  });

  it('rejects partial, unknown, out-of-range and mistyped documents', async () => {
    server = createTestServer();
    const me = await session();
    const bad: (object | undefined)[] = [
      undefined,
      {},
      { language: 'ja' },
      { ...custom, extra: 1 },
      { ...custom, language: 'fr' },
      { ...custom, theme: 'system' },
      { ...custom, motion: 'wild' },
      { ...custom, sound: { ...custom.sound, sfxVolume: 101 } },
      { ...custom, sound: { ...custom.sound, musicVolume: -1 } },
      { ...custom, sound: { ...custom.sound, musicVolume: 5.5 } },
      { ...custom, sound: { enabled: true, sfxVolume: 1, musicVolume: 1, extra: 1 } },
      { ...custom, sound: { ...custom.sound, enabled: 'yes' } },
    ];
    for (const payload of bad) {
      const res = await me.send('PUT', '/api/settings', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_payload' });
    }
    expect((await me.get('/api/settings')).json()).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('is per user, global across guilds, and ignores any user id in the request', async () => {
    server = createTestServer({ env: { ALLOWED_GUILD_IDS: `${GUILD},${OTHER_GUILD}` } });
    const alice = await session({ id: USER });
    const bob = await session({ id: OTHER_USER });
    await alice.send('PUT', '/api/settings', custom);
    expect((await bob.get('/api/settings')).json()).toEqual(DEFAULT_USER_SETTINGS);
    // a body naming another user is not accepted, and cannot reach bob's row
    const sneaky = await alice.send('PUT', '/api/settings', { ...custom, userId: OTHER_USER });
    expect(sneaky.statusCode).toBe(400);
    // alice in another guild sees the same settings
    const elsewhere = await session({ id: USER, guild: OTHER_GUILD });
    expect((await elsewhere.get('/api/settings')).json()).toEqual(custom);
  });
});

describe('GET /api/inbox', () => {
  it("lists the session user's items in their guild, newest first, with unread and paging", async () => {
    server = createTestServer({ env: { ALLOWED_GUILD_IDS: `${GUILD},${OTHER_GUILD}` } });
    const me = await session();
    await session({ id: OTHER_USER });
    const mine = addInbox(USER, GUILD, 5);
    addInbox(USER, OTHER_GUILD, 2); // same user, other guild
    addInbox(OTHER_USER, GUILD, 3); // other user, same guild
    server.store.db.prepare('UPDATE inbox SET read_at = 5 WHERE id = ?').run(mine[0]);

    const first = await me.get('/api/inbox?limit=2');
    expect(first.statusCode).toBe(200);
    const page1 = first.json();
    expect(Value.Check(InboxPage, page1)).toBe(true);
    expect(page1.items.map((i: { id: number }) => i.id)).toEqual([mine[4], mine[3]]);
    expect(page1.items[0]).toMatchObject({
      guildId: GUILD,
      kind: 'daily_ready',
      readAt: null,
      event: { type: 'DailyReady' },
    });
    expect(page1.unread).toBe(4);
    expect(page1.nextBefore).toBe(mine[3]);

    const page2 = (await me.get(`/api/inbox?limit=2&before=${page1.nextBefore}`)).json();
    expect(page2.items.map((i: { id: number }) => i.id)).toEqual([mine[2], mine[1]]);
    const page3 = (await me.get(`/api/inbox?limit=2&before=${page2.nextBefore}`)).json();
    expect(page3.items.map((i: { id: number }) => i.id)).toEqual([mine[0]]);
    expect(page3.items[0].readAt).toBe(5);
    expect(page3.nextBefore).toBeNull();

    const unreadOnly = (await me.get('/api/inbox?unread=1')).json();
    expect(unreadOnly.items.map((i: { id: number }) => i.id)).toEqual([
      mine[4],
      mine[3],
      mine[2],
      mine[1],
    ]);
    expect((await me.get('/api/inbox')).json().items).toHaveLength(5);
  });

  it('rejects bad queries', async () => {
    server = createTestServer();
    const me = await session();
    for (const q of [
      'limit=0',
      'limit=51',
      'limit=x',
      'before=0',
      'before=-1',
      'unread=2',
      'userId=1',
      'guildId=1',
      'limit=1&limit=2',
    ]) {
      const res = await me.get(`/api/inbox?${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_payload' });
    }
  });
});

describe('POST /api/inbox/read', () => {
  it("marks the given ids read, returns the unread count and tells the user's sockets", async () => {
    server = createTestServer();
    const me = await session();
    const ids = addInbox(USER, GUILD, 4);
    const pushed: unknown[] = [];
    server.bus.onInboxUnread((u) => pushed.push(u));
    const res = await me.send('POST', '/api/inbox/read', { ids: [ids[0], ids[1]] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unread: 2 });
    expect(pushed).toEqual([{ guildId: GUILD, userId: USER, unread: 2 }]);
    // reading the same ids again changes nothing but is still answered
    expect((await me.send('POST', '/api/inbox/read', { ids: [ids[0]] })).json()).toEqual({
      unread: 2,
    });
  });

  it('{ all: true } marks every item of the session guild only', async () => {
    server = createTestServer({ env: { ALLOWED_GUILD_IDS: `${GUILD},${OTHER_GUILD}` } });
    const me = await session();
    addInbox(USER, GUILD, 3);
    addInbox(USER, OTHER_GUILD, 2);
    expect((await me.send('POST', '/api/inbox/read', { all: true })).json()).toEqual({ unread: 0 });
    expect(
      server.store.db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE read_at IS NULL').get(),
    ).toEqual({ n: 2 });
  });

  it('ignores ids that belong to another user or guild', async () => {
    server = createTestServer({ env: { ALLOWED_GUILD_IDS: `${GUILD},${OTHER_GUILD}` } });
    const me = await session();
    await session({ id: OTHER_USER });
    const theirs = addInbox(OTHER_USER, GUILD, 2);
    const otherGuild = addInbox(USER, OTHER_GUILD, 1);
    addInbox(USER, GUILD, 1);
    const res = await me.send('POST', '/api/inbox/read', { ids: [...theirs, ...otherGuild] });
    expect(res.json()).toEqual({ unread: 1 });
    expect(
      server.store.db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE read_at IS NOT NULL').get(),
    ).toEqual({ n: 0 });
  });

  it('rejects malformed bodies', async () => {
    server = createTestServer();
    const me = await session();
    for (const payload of [
      undefined,
      {},
      { ids: [] },
      { ids: ['1'] },
      { ids: [0] },
      { ids: Array.from({ length: 101 }, (_, i) => i + 1) },
      { all: false },
      { all: true, ids: [1] },
      { ids: [1], extra: 1 },
    ]) {
      const res = await me.send('POST', '/api/inbox/read', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_payload' });
    }
  });
});

describe('empty-body routes', () => {
  const JSON_HEADER = { 'content-type': 'application/json' };

  it('consume accepts no body, an empty body with a JSON content type, and {}', async () => {
    server = createTestServer();
    const me = await session();
    const call = (extra: Record<string, unknown>) =>
      server.app.inject({
        method: 'POST',
        url: '/api/launch-intent/consume',
        headers: { ...server.signed(), authorization: me.authorization(), ...JSON_HEADER },
        ...extra,
      });
    const plain = () =>
      server.app.inject({
        method: 'POST',
        url: '/api/launch-intent/consume',
        headers: { ...server.signed(), authorization: me.authorization() },
      });
    for (const send of [plain, () => call({ payload: '' }), () => call({ payload: '{}' })]) {
      server.launchIntents.create({ userId: USER, guildId: GUILD, screen: 'daily' });
      const res = await send();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ launchIntent: { screen: 'daily' } });
    }
  });

  it('still rejects fields that are present, malformed JSON and plain text', async () => {
    server = createTestServer();
    const me = await session();
    const headers = { ...server.signed(), authorization: me.authorization(), ...JSON_HEADER };
    const post = (payload: string, h = headers) =>
      server.app.inject({ method: 'POST', url: '/api/launch-intent/consume', headers: h, payload });
    expect((await post('{"userId":"1"}')).statusCode).toBe(400);
    expect((await post('{nope')).statusCode).toBe(400);
    expect((await post('{"__proto__":{"x":1}}')).statusCode).toBe(400);
    expect((await post('{}', { ...headers, 'content-type': 'text/plain' })).statusCode).toBe(400);
  });

  it('routes that need a body still answer 400 to an empty one', async () => {
    server = createTestServer();
    const me = await session();
    const headers = { ...server.signed(), authorization: me.authorization(), ...JSON_HEADER };
    for (const [method, url] of [
      ['PUT', '/api/settings'],
      ['POST', '/api/inbox/read'],
    ] as const) {
      const res = await server.app.inject({ method, url, headers, payload: '' });
      expect(res.statusCode, url).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_payload' });
    }
  });
});

describe('POST /api/launch-intent/consume', () => {
  it('accepts no body or {}, and rejects anything else (no user or guild from the client)', async () => {
    server = createTestServer();
    const me = await session();
    server.launchIntents.create({ userId: USER, guildId: GUILD, screen: 'daily' });
    for (const payload of [
      { userId: OTHER_USER },
      { guildId: OTHER_GUILD },
      { screen: 'bank' },
      [],
    ]) {
      const res = await me.send('POST', '/api/launch-intent/consume', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    // the rejected calls consumed nothing
    const ok = await me.send('POST', '/api/launch-intent/consume', {});
    expect(ok.json()).toMatchObject({
      launchIntent: { userId: USER, guildId: GUILD, screen: 'daily' },
    });
    server.launchIntents.create({ userId: USER, guildId: GUILD, screen: 'shop' });
    expect((await me.send('POST', '/api/launch-intent/consume')).json()).toMatchObject({
      launchIntent: { screen: 'shop' },
    });
  });

  it("never hands out another guild's or user's intent", async () => {
    server = createTestServer();
    const me = await session();
    server.launchIntents.create({ userId: OTHER_USER, guildId: GUILD, screen: 'bank' });
    server.launchIntents.create({ userId: USER, guildId: OTHER_GUILD, screen: 'shop' });
    expect((await me.send('POST', '/api/launch-intent/consume', {})).json()).toEqual({
      launchIntent: null,
    });
  });
});
