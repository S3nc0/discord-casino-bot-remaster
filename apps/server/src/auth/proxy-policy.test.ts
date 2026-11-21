import { Writable } from 'node:stream';
import { io as connect } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { SOCKET_PATH, type TokenResponse } from '@casino/shared';
import { createLogger } from '../runtime/logger.ts';
import { GUILD, INSTANCE, createTestServer, type TestServer } from '../runtime/test-kit.ts';

/**
 * Discord does not sign the pre-authenticate `POST /api/token` (observed on real traffic), so
 * that route is exempt. Elsewhere signature headers are verified when present and, unless
 * REQUIRE_PROXY_SIGNATURE is on, may be absent because the route needs our session token.
 */

interface LogLine {
  msg: string;
  reason?: string;
  [key: string]: unknown;
}

let server: TestServer;
afterEach(async () => {
  await server.close();
});

function start(env: Record<string, string> = {}) {
  const lines: LogLine[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as LogLine);
      }
      done();
    },
  });
  server = createTestServer({ env, logger: createLogger({ level: 'info', stream }) });
  return lines;
}

const login = async (headers: Record<string, string> = {}) => {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/token',
    headers,
    payload: { code: 'c', guildId: GUILD, instanceId: INSTANCE },
  });
  return { res, token: res.statusCode === 200 ? res.json<TokenResponse>().sessionToken : '' };
};

const get = (url: string, headers: Record<string, string> = {}) =>
  server.app.inject({ url, headers });

describe.each<{ mode: string; env: Record<string, string> }>([
  { mode: 'policy off', env: {} },
  { mode: 'REQUIRE_PROXY_SIGNATURE=1', env: { REQUIRE_PROXY_SIGNATURE: '1' } },
])('$mode', ({ env }) => {
  it('POST /api/token works without any signature header', async () => {
    start(env);
    const { res } = await login();
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/health stays exempt', async () => {
    start(env);
    expect((await get('/api/health')).statusCode).toBe(200);
  });

  it('refuses partial or invalid headers on an authenticated route', async () => {
    start(env);
    const { token } = await login();
    const auth = { authorization: `Bearer ${token}` };
    const signed = server.signed();
    const cases: Record<string, string>[] = [
      { 'x-signature-ed25519': signed['x-signature-ed25519'] ?? '' },
      { 'x-discord-proxy-payload': signed['x-discord-proxy-payload'] ?? '' },
      { ...signed, 'x-signature-ed25519': 'ab'.repeat(64) },
      { ...signed, 'x-signature-timestamp': '1' },
      server.keys.headers(Math.floor(server.clock.now() / 1000) - 1000, 10),
    ];
    for (const headers of cases) {
      expect((await get('/api/me', { ...auth, ...headers })).statusCode).toBe(401);
    }
    expect((await get('/api/me', { ...auth, ...signed })).statusCode).toBe(200);
  });
});

describe('verify if present (default)', () => {
  it('lets an authenticated route through without headers, but still needs the session', async () => {
    start();
    const { token } = await login();
    expect((await get('/api/me', { authorization: `Bearer ${token}` })).statusCode).toBe(200);
    expect((await get('/api/me')).statusCode).toBe(401);
    expect((await get('/api/settings')).statusCode).toBe(401);
    expect((await get('/api/inbox')).statusCode).toBe(401);
  });

  it('lets the socket handshake through without headers', async () => {
    start();
    const { token } = await login();
    const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
    const client = connect(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    client.close();
  });
});

describe('REQUIRE_PROXY_SIGNATURE=1', () => {
  it('refuses a missing signature on authenticated routes', async () => {
    const lines = start({ REQUIRE_PROXY_SIGNATURE: '1' });
    const { token } = await login();
    const res = await get('/api/me', { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(401);
    expect(lines.find((l) => l.reason?.startsWith('proxy_signature_missing'))).toBeDefined();
    const signed = { ...server.signed(), authorization: `Bearer ${token}` };
    expect((await get('/api/me', signed)).statusCode).toBe(200);
  });

  it('refuses the upgrade without headers', async () => {
    start({ REQUIRE_PROXY_SIGNATURE: '1' });
    const { token } = await login();
    const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
    const connectWith = (extraHeaders: Record<string, string>) =>
      connect(url, {
        path: SOCKET_PATH,
        transports: ['websocket'],
        auth: { token },
        extraHeaders,
        reconnection: false,
        forceNew: true,
      });
    const bare = connectWith({});
    await new Promise((resolve) => bare.once('connect_error', resolve));
    bare.close();
    const signed = connectWith(server.signed());
    await new Promise<void>((resolve, reject) => {
      signed.once('connect', () => resolve());
      signed.once('connect_error', reject);
    });
    signed.close();
  });
});

describe('per-session observation', () => {
  it('logs one info line per session saying whether the headers were present', async () => {
    const lines = start();
    const { token } = await login();
    const auth = { authorization: `Bearer ${token}` };
    await get('/api/me', auth);
    await get('/api/settings', auth);
    await get('/api/me', { ...auth, ...server.signed() });
    const observed = lines.filter((l) => l.msg.startsWith('proxy signature:'));
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      msg: 'proxy signature: present=absent',
      transport: 'http',
    });
    expect(JSON.stringify(observed)).not.toContain(server.signed()['x-signature-ed25519']);
  });

  it('reports valid when the headers verified', async () => {
    const lines = start();
    const { token } = await login();
    await get('/api/me', { authorization: `Bearer ${token}`, ...server.signed() });
    expect(lines.find((l) => l.msg.startsWith('proxy signature:'))?.msg).toBe(
      'proxy signature: present=valid',
    );
  });

  it('logs the socket connect too', async () => {
    const lines = start();
    const { token } = await login();
    const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
    const client = connect(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token },
      extraHeaders: server.signed(),
      reconnection: false,
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    client.close();
    expect(
      lines.find((l) => l.transport === 'socket' && l.msg.startsWith('proxy signature:'))?.msg,
    ).toBe('proxy signature: present=valid');
  });
});
