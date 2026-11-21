import { Writable } from 'node:stream';
import { io as connect } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { SOCKET_PATH, type TokenResponse } from '@casino/shared';
import { createLogger } from '../runtime/logger.ts';
import {
  GUILD,
  INSTANCE,
  OTHER_GUILD,
  createTestServer,
  type TestServer,
} from '../runtime/test-kit.ts';

/** Every 401/403 on the auth path logs one warn line with a stable `reason` and no secrets. */

interface LogLine {
  level: number;
  reason?: string;
  msg: string;
  [key: string]: unknown;
}

let server: TestServer;
afterEach(async () => {
  await server.close();
});

function start(options: Parameters<typeof createTestServer>[0] = {}) {
  const lines: LogLine[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as LogLine);
      }
      done();
    },
  });
  server = createTestServer({ ...options, logger: createLogger({ level: 'warn', stream }) });
  const reasons = () => lines.filter((l) => l.reason !== undefined).map((l) => l.reason);
  return { lines, reasons };
}

const body = { code: 'secret-oauth-code', guildId: GUILD, instanceId: INSTANCE };
const token = (headers: Record<string, string>, payload: object = body) =>
  server.app.inject({ method: 'POST', url: '/api/token', headers, payload });

describe('proxy signature reasons', () => {
  it('names missing headers, without a body reason in production', async () => {
    const { lines, reasons } = start({ env: { NODE_ENV: 'production' } });
    const res = await server.app.inject({ method: 'POST', url: '/api/token', payload: body });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
    expect(reasons()).toEqual([
      'proxy_signature_missing:x-signature-ed25519,x-signature-timestamp,x-discord-proxy-payload',
    ]);
    expect(lines[0]).toMatchObject({ level: 40, status: 401, path: '/api/token' });
  });

  it('separates an invalid signature, a timestamp mismatch and an expired payload', async () => {
    const { reasons } = start();
    await token({ ...server.signed(), 'x-signature-ed25519': 'ab'.repeat(64) });
    await token({ ...server.signed(), 'x-signature-timestamp': '1' });
    const now = Math.floor(server.clock.now() / 1000);
    await token(server.keys.headers(now - 1000, 10));
    expect(reasons()).toEqual(['proxy_signature_invalid', 'timestamp_skew', 'proxy_expired']);
  });

  it('puts the reason in the body only outside production', async () => {
    start({ env: { NODE_ENV: 'test' } });
    const res = await server.app.inject({ method: 'POST', url: '/api/token', payload: body });
    // Outside production the caller sees the reason too.
    expect(res.json()).toMatchObject({
      error: 'unauthorized',
      reason: expect.stringContaining('proxy_signature_missing'),
    });
  });
});

describe('POST /api/token reasons', () => {
  it('names the Discord status when the code exchange fails', async () => {
    const { lines, reasons } = start({ discord: { exchangeStatus: 401 } });
    const res = await token(server.signed());
    expect(res.statusCode).toBe(401);
    expect(reasons()).toContain('code_exchange_failed:401');
    // Neither the OAuth code nor any token reaches the log.
    expect(JSON.stringify(lines)).not.toContain('secret-oauth-code');
  });

  it('names a missing scope, a guild the user is not in, and a guild that is not allowed', async () => {
    const { reasons } = start({ discord: { scope: 'identify' } });
    expect((await token(server.signed())).statusCode).toBe(403);
    server.discord.state.scope = 'identify guilds';
    server.discord.state.guilds = [{ id: OTHER_GUILD, name: 'Other' }];
    expect((await token(server.signed())).statusCode).toBe(403);
    expect(reasons()).toEqual(['scope_missing', 'user_not_in_guild']);

    server.discord.state.guilds = [{ id: OTHER_GUILD, name: 'Other' }];
    await token(server.signed(), { ...body, guildId: OTHER_GUILD });
    expect(reasons().at(-1)).toBe('guild_not_allowed');
  });

  it('names an instance that is not live for this guild and user', async () => {
    const { reasons } = start({ discord: { instance: null } });
    expect((await token(server.signed())).statusCode).toBe(403);
    expect(reasons()).toEqual(['instance_mismatch']);
  });
});

describe('session reasons', () => {
  it('tells a missing bearer, a bad token and an expired session apart', async () => {
    const { reasons } = start({ sessionTtlSeconds: 60 });
    const login = await token(server.signed());
    const { sessionToken } = login.json<TokenResponse>();
    const get = (authorization?: string) =>
      server.app.inject({
        url: '/api/me',
        headers: { ...server.signed(), ...(authorization ? { authorization } : {}) },
      });
    expect((await get()).statusCode).toBe(401);
    expect((await get('Bearer junk.junk.junk')).statusCode).toBe(401);
    server.clock.advance(61_000);
    expect((await get(`Bearer ${sessionToken}`)).statusCode).toBe(401);
    expect(reasons()).toEqual(['bearer_missing', 'session_invalid', 'session_expired']);
  });

  it('logs socket_auth_failed for a rejected handshake', async () => {
    const { lines } = start();
    const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
    const client = connect(url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token: 'junk' },
      extraHeaders: server.signed(),
      reconnection: false,
      forceNew: true,
    });
    await new Promise((resolve) => client.once('connect_error', resolve));
    client.close();
    expect(lines.find((l) => l.reason === 'socket_auth_failed')).toMatchObject({
      detail: 'session_invalid',
    });
  });
});
