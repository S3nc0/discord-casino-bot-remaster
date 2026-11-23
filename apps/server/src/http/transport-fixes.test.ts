// Regression tests for the transport review findings on the HTTP side (R-7, R-12, R-18).
import { afterEach, describe, expect, it } from 'vitest';
import { TRUSTED_PROXY_HOPS } from '../runtime/server.ts';
import { GUILD, INSTANCE, createTestServer, type TestServer } from '../runtime/test-kit.ts';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

async function login(): Promise<string> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: server.signed(),
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  return res.json<{ sessionToken: string }>().sessionToken;
}

const get = (url: string, token: string) =>
  server.app.inject({
    url,
    headers: { ...server.signed(), authorization: `Bearer ${token}` },
  });

describe('R-7: a denied guild loses its HTTP sessions', () => {
  it('R-7: /api/me and /api/life/* answer guild_not_allowed once the guild is denied', async () => {
    server = createTestServer();
    const token = await login();
    expect((await get('/api/me', token)).statusCode).toBe(200);
    expect((await get('/api/life/work', token)).statusCode).toBe(200);

    server.identity.setGuildStatus(GUILD, 'denied', 'owner');

    for (const url of ['/api/me', '/api/inbox', '/api/life/work']) {
      const res = await get(url, token);
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toMatchObject({ error: 'guild_not_allowed' });
    }
  });

  it('R-7: approving the guild again brings the same session back', async () => {
    server = createTestServer();
    const token = await login();
    server.identity.setGuildStatus(GUILD, 'denied', 'owner');
    expect((await get('/api/me', token)).statusCode).toBe(403);
    server.identity.setGuildStatus(GUILD, 'approved', 'owner');
    expect((await get('/api/me', token)).statusCode).toBe(200);
  });
});

describe('R-12: trusted proxy hops', () => {
  const forged = (i: number) => ({
    ...server.signed(),
    'x-forwarded-for': `10.0.0.${i}, 8.8.8.8`,
  });

  it('R-12: production trusts one hop, so rotating a forged X-Forwarded-For does not dodge the IP limit', async () => {
    server = createTestServer({
      trustProxy: TRUSTED_PROXY_HOPS,
      rateLimits: { ipPerMinute: 5, tokenPerMinute: 5, userPerMinute: 5 },
    });
    expect(TRUSTED_PROXY_HOPS).toBe(1);
    // /api/me answers 401 without a token, but every request counts against the IP limit.
    const status: number[] = [];
    for (let i = 0; i < 8; i++) {
      status.push(
        (
          await server.app.inject({
            url: '/api/me',
            headers: forged(i),
            remoteAddress: '127.0.0.1',
          })
        ).statusCode,
      );
    }
    expect(status.filter((s) => s === 429).length).toBe(3);
  });
});
