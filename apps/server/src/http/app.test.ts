import { afterEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { MeResponse, TokenResponse, type LaunchIntent } from '@casino/shared';
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

const body = { code: 'oauth-code', guildId: GUILD, instanceId: INSTANCE, clientLocale: 'ja-JP' };

async function token(overrides: Record<string, unknown> = {}, headers?: Record<string, string>) {
  return server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: headers ?? server.signed(),
    payload: { ...body, ...overrides },
  });
}

describe('GET /api/health', () => {
  it('answers without a proxy signature', async () => {
    server = createTestServer();
    const res = await server.app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });
});

describe('proxy signature hook', () => {
  it('rejects a bad signature and an expired payload on /api/* (see proxy-policy.test.ts)', async () => {
    server = createTestServer();
    const bad = await server.app.inject({
      url: '/api/me',
      headers: { ...server.signed(), 'x-signature-ed25519': 'ab'.repeat(64) },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: 'unauthorized' });
    const stale = server.keys.headers(Math.floor(server.clock.now() / 1000) - 1000, 10);
    expect((await server.app.inject({ url: '/api/me', headers: stale })).statusCode).toBe(401);
    expect(server.discord.requests).toEqual([]);
  });

  it('is skipped only when NODE_ENV=development', async () => {
    server = createTestServer({ env: { NODE_ENV: 'development' } });
    const res = await server.app.inject({ method: 'POST', url: '/api/token', payload: body });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/token', () => {
  it('exchanges the code, checks guild and instance with Discord, and returns a session', async () => {
    server = createTestServer();
    const res = await token();
    expect(res.statusCode).toBe(200);
    const json = res.json<TokenResponse>();
    expect(Value.Check(TokenResponse, json)).toBe(true);
    expect(json).toMatchObject({
      accessToken: 'discord-access-token',
      guildId: GUILD,
      locale: 'ja',
      launchIntent: null,
      user: { id: USER, username: 'alice', globalName: 'Alice', avatar: null },
    });
    expect(json.expiresAt).toBe(server.clock.now() + 3600_000);

    const [exchange, me, guilds, instance] = server.discord.requests;
    expect(exchange?.form).toMatchObject({
      grant_type: 'authorization_code',
      code: 'oauth-code',
      client_secret: 'test-client-secret',
    });
    expect(me?.headers?.authorization).toBe('Bearer discord-access-token');
    expect(guilds?.url).toContain('/users/@me/guilds');
    expect(instance?.url).toContain(`/activity-instances/${INSTANCE}`);
    expect(instance?.headers?.authorization).toBe('Bot test-bot-token');
  });

  it('creates the account with the 3,000 start balance and /api/me serves it', async () => {
    server = createTestServer();
    const { sessionToken } = (await token()).json<TokenResponse>();
    const me = await server.app.inject({
      url: '/api/me',
      headers: { ...server.signed(), authorization: `Bearer ${sessionToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(Value.Check(MeResponse, me.json())).toBe(true);
    expect(me.json()).toMatchObject({
      guild: { id: GUILD, name: 'Test Guild' },
      localeHints: { setting: 'auto', guild: null },
      instanceId: INSTANCE,
      locale: 'ja',
      balance: 3000,
      user: { id: USER },
    });
    server.economy.debit({ guildId: GUILD, userId: USER, amount: 500, reason: 'game_stake' });
    const again = await server.app.inject({
      url: '/api/me',
      headers: { ...server.signed(), authorization: `Bearer ${sessionToken}` },
    });
    expect(again.json<{ balance: number }>().balance).toBe(2500);
    // a second login must not grant again
    await token();
    expect(server.economy.getBalance(GUILD, USER)).toBe(2500);
  });

  it('resolves the locale: user setting, client locale, guild, en', async () => {
    server = createTestServer();
    server.identity.ensureUser(USER);
    server.store.db
      .prepare("INSERT INTO user_settings (user_id, locale, updated_at) VALUES (?, 'en', 0)")
      .run(USER);
    expect((await token()).json<TokenResponse>().locale).toBe('en'); // user setting beats ja-JP
    server.store.db.prepare('UPDATE user_settings SET locale = NULL').run();
    expect((await token()).json<TokenResponse>().locale).toBe('ja');
    expect((await token({ clientLocale: 'fr-FR' })).json<TokenResponse>().locale).toBe('en');
  });

  it('consumes the pending launch intent of this user and guild, once', async () => {
    server = createTestServer();
    server.launchIntents.create({ userId: OTHER_USER, guildId: GUILD, screen: 'bank' });
    server.launchIntents.create({ userId: USER, guildId: OTHER_GUILD, screen: 'shop' });
    server.launchIntents.create({ userId: USER, guildId: GUILD, screen: 'slots' });
    const first = (await token()).json<TokenResponse>();
    expect(first.launchIntent).toMatchObject<Partial<LaunchIntent>>({
      userId: USER,
      guildId: GUILD,
      screen: 'slots',
    });
    expect((await token()).json<TokenResponse>().launchIntent).toBeNull();
    expect(server.launchIntents.consume(OTHER_USER, GUILD)?.screen).toBe('bank');
  });

  it('POST /api/launch-intent/consume serves the session its own intent', async () => {
    server = createTestServer();
    const { sessionToken } = (await token()).json<TokenResponse>();
    const call = () =>
      server.app.inject({
        method: 'POST',
        url: '/api/launch-intent/consume',
        headers: { ...server.signed(), authorization: `Bearer ${sessionToken}` },
      });
    expect((await call()).json()).toEqual({ launchIntent: null });
    server.launchIntents.create({ userId: OTHER_USER, guildId: GUILD, screen: 'bank' });
    expect((await call()).json()).toEqual({ launchIntent: null });
    server.launchIntents.create({ userId: USER, guildId: GUILD, screen: 'daily' });
    expect((await call()).json<{ launchIntent: LaunchIntent }>().launchIntent.screen).toBe('daily');
    expect((await call()).json()).toEqual({ launchIntent: null });
  });

  it('accepts the extra rpc.activities.write grant, and a grant of just identify and guilds', async () => {
    server = createTestServer({ discord: { scope: 'identify guilds rpc.activities.write' } });
    expect((await token()).statusCode).toBe(200);
    await server.close();
    server = createTestServer({ discord: { scope: 'guilds identify' } });
    expect((await token()).statusCode).toBe(200);
  });

  it('403 when the grant lacks identify or guilds', async () => {
    for (const scope of ['identify', 'guilds rpc.activities.write', '']) {
      server = createTestServer({ discord: { scope } });
      const res = await token();
      expect(res.statusCode, scope).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
      expect(server.economy.hasAccount(GUILD, USER)).toBe(false);
      await server.close();
    }
    server = createTestServer();
  });

  it('401 when Discord rejects the code', async () => {
    server = createTestServer({ discord: { exchangeStatus: 400 } });
    const res = await token();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('502 when Discord is down', async () => {
    server = createTestServer({ discord: { exchangeStatus: 503 } });
    const res = await token();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'internal' });
  });

  it('403 forbidden when the user is not in the claimed guild', async () => {
    server = createTestServer({ discord: { guilds: [{ id: OTHER_GUILD, name: 'Elsewhere' }] } });
    const res = await token();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    expect(server.economy.hasAccount(GUILD, USER)).toBe(false);
  });

  it('403 guild_not_allowed for a guild outside ALLOWED_GUILD_IDS', async () => {
    server = createTestServer({ discord: { guilds: [{ id: OTHER_GUILD, name: 'Elsewhere' }] } });
    const res = await token({ guildId: OTHER_GUILD });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'guild_not_allowed' });
    expect(server.economy.hasAccount(OTHER_GUILD, USER)).toBe(false);
  });

  it('403 when the instance is not live, belongs to another guild, or does not include the user', async () => {
    for (const instance of [
      null,
      { instance_id: INSTANCE, location: { guild_id: OTHER_GUILD }, users: [USER] },
      { instance_id: INSTANCE, location: { guild_id: null }, users: [USER] },
      { instance_id: INSTANCE, location: { guild_id: GUILD }, users: [OTHER_USER] },
    ]) {
      server = createTestServer({ discord: { instance } });
      const res = await token();
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
      expect(server.economy.hasAccount(GUILD, USER)).toBe(false);
      await server.close();
    }
    server = createTestServer();
  });

  it('REQUIRE_APPROVAL=1 holds a new guild as pending until it is approved', async () => {
    server = createTestServer({ env: { REQUIRE_APPROVAL: '1' } });
    const pending = await token();
    expect(pending.statusCode).toBe(403);
    expect(pending.json()).toEqual({ error: 'guild_pending' });
    expect(server.identity.getGuildStatus(GUILD)).toBe('pending');
    expect(server.economy.hasAccount(GUILD, USER)).toBe(false);

    server.identity.setGuildStatus(GUILD, 'approved', USER);
    expect((await token()).statusCode).toBe(200);

    server.identity.setGuildStatus(GUILD, 'denied', USER);
    const denied = await token();
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'guild_not_allowed' });
  });

  it('rejects malformed bodies and unknown properties without calling Discord', async () => {
    server = createTestServer();
    for (const payload of [
      {},
      { ...body, extra: 1 },
      { ...body, guildId: '12' },
      { ...body, code: '' },
      { ...body, instanceId: 'bad id!' },
    ]) {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/token',
        headers: server.signed(),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_payload' });
    }
    const notJson = await server.app.inject({
      method: 'POST',
      url: '/api/token',
      headers: { ...server.signed(), 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(notJson.statusCode).toBe(400);
    expect(server.discord.requests).toEqual([]);
  });
});

describe('authenticated routes', () => {
  it('require a valid bearer session token', async () => {
    server = createTestServer();
    const { sessionToken } = (await token()).json<TokenResponse>();
    const get = (authorization?: string) =>
      server.app.inject({
        url: '/api/me',
        headers: { ...server.signed(), ...(authorization ? { authorization } : {}) },
      });
    expect((await get()).statusCode).toBe(401);
    expect((await get('Bearer junk')).statusCode).toBe(401);
    expect((await get(`Basic ${sessionToken}`)).statusCode).toBe(401);
    expect((await get(`Bearer ${sessionToken}`)).statusCode).toBe(200);
  });

  it('answer expired for an old token and unauthorized for a revoked one', async () => {
    server = createTestServer();
    const first = (await token()).json<TokenResponse>();
    const second = (await token()).json<TokenResponse>();
    const claimsOf = (t: string) =>
      JSON.parse(Buffer.from(t.split('.')[1] ?? '', 'base64url').toString()) as {
        jti: string;
        exp: number;
      };
    server.sessions.revoke(claimsOf(first.sessionToken));
    const get = (t: string) =>
      server.app.inject({
        url: '/api/me',
        headers: { ...server.signed(), authorization: `Bearer ${t}` },
      });
    expect((await get(first.sessionToken)).json()).toEqual({ error: 'unauthorized' });
    server.clock.advance(3601_000);
    const res = await get(second.sessionToken);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'expired' });
  });

  it('unknown routes are 404 with the error body', async () => {
    server = createTestServer();
    const res = await server.app.inject({ url: '/api/nope', headers: server.signed() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});

describe('rate limits', () => {
  it('limits per IP, with Retry-After', async () => {
    server = createTestServer({
      rateLimits: { ipPerMinute: 3, tokenPerMinute: 100, userPerMinute: 100 },
    });
    for (let i = 0; i < 3; i++)
      expect(
        (await server.app.inject({ url: '/api/nope', headers: server.signed() })).statusCode,
      ).toBe(404);
    const res = await server.app.inject({ url: '/api/nope', headers: server.signed() });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'rate_limited', retryAfterMs: 60_000 });
    expect(res.headers['retry-after']).toBe('60');
    server.clock.advance(60_000);
    expect(
      (await server.app.inject({ url: '/api/nope', headers: server.signed() })).statusCode,
    ).toBe(404);
  });

  it('limits /api/token separately and strictly', async () => {
    server = createTestServer({
      rateLimits: { ipPerMinute: 100, tokenPerMinute: 2, userPerMinute: 100 },
    });
    expect((await token()).statusCode).toBe(200);
    expect((await token()).statusCode).toBe(200);
    const res = await token();
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'rate_limited' });
  });

  it('limits per user on authenticated routes', async () => {
    server = createTestServer({
      rateLimits: { ipPerMinute: 100, tokenPerMinute: 100, userPerMinute: 2 },
    });
    const { sessionToken } = (await token()).json<TokenResponse>();
    const get = () =>
      server.app.inject({
        url: '/api/me',
        headers: { ...server.signed(), authorization: `Bearer ${sessionToken}` },
      });
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(429);
  });
});
