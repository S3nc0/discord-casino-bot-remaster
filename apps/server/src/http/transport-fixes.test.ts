// Regression tests for the transport review findings on the HTTP side (R-7, R-12, R-18).
import { afterEach, describe, expect, it } from 'vitest';
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
