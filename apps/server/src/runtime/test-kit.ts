// Helpers shared by the server tests. Not imported by production code.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import Database from 'better-sqlite3';
import { manualClock, type ManualClock } from '@casino/shared';
import type { HttpClient, HttpRequest, HttpResponse } from '../auth/discord.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { applyPragmas } from '../db/pragmas.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadConfig, type Config } from './config.ts';
import type { Logger } from 'pino';
import { createLogger } from './logger.ts';
import type { SocketHandlers } from '../socket/server.ts';
import type { CronDriver } from './scheduler.ts';
import { createServer, type CasinoServices } from './server.ts';

export const GUILD = '234567890123456789';
export const OTHER_GUILD = '234567890123456780';
export const USER = '123456789012345678';
export const OTHER_USER = '123456789012345679';
export const INSTANCE = 'i-1234567890-gc-abc';
export const START_MS = 1_800_000_000_000;

export function memoryStore(): Store {
  const db = new Database(':memory:');
  applyPragmas(db);
  runMigrations(db, migrations);
  return new Store(db);
}

export interface ProxyKeys {
  publicKeyHex: string;
  privateKey: KeyObject;
  /** Headers Discord's proxy would attach at `nowSeconds`. */
  headers(nowSeconds: number, lifetimeSeconds?: number): Record<string, string>;
}

export function makeProxyKeys(): ProxyKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKeyHex: der.subarray(der.length - 32).toString('hex'),
    privateKey,
    headers(nowSeconds, lifetimeSeconds = 300) {
      const payload = Buffer.from(
        JSON.stringify({
          created_at: nowSeconds,
          expires_at: nowSeconds + lifetimeSeconds,
          user: 'x',
        }),
      );
      return {
        'x-signature-ed25519': sign(null, payload, privateKey).toString('hex'),
        'x-signature-timestamp': String(nowSeconds),
        'x-discord-proxy-payload': payload.toString('base64'),
      };
    },
  };
}

export function testConfig(publicKeyHex: string, overrides: Record<string, string> = {}): Config {
  return loadConfig({
    DISCORD_TOKEN: 'test-bot-token',
    DISCORD_CLIENT_ID: '345678901234567890',
    DISCORD_CLIENT_SECRET: 'test-client-secret',
    DISCORD_PUBLIC_KEY: publicKeyHex,
    ALLOWED_GUILD_IDS: GUILD,
    OWNER_IDS: USER,
    TEST_GUILD_ID: GUILD,
    REQUIRE_APPROVAL: '0',
    UTC_OFFSET_HOURS: '9',
    SESSION_SECRET: 'x'.repeat(40),
    PUBLIC_API_ORIGIN: 'https://api.example.com',
    ANNOUNCE_CHANNEL_ID: '456789012345678901',
    NODE_ENV: 'production',
    PORT: '0',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export interface FakeDiscordState {
  user: { id: string; username: string; global_name: string | null; avatar: string | null };
  guilds: { id: string; name: string }[];
  /** null = Discord answers 404 for the instance. */
  instance: { instance_id: string; location: { guild_id: string | null }; users: string[] } | null;
  /** Status for the token exchange; anything but 200 fails it. */
  exchangeStatus: number;
  /** Scopes Discord reports as granted (space separated). */
  scope: string;
}

export interface FakeDiscord extends HttpClient {
  state: FakeDiscordState;
  requests: HttpRequest[];
}

/** An HttpClient that answers like Discord from `state` and never touches the network. */
export function fakeDiscord(overrides: Partial<FakeDiscordState> = {}): FakeDiscord {
  const state: FakeDiscordState = {
    user: { id: USER, username: 'alice', global_name: 'Alice', avatar: null },
    guilds: [{ id: GUILD, name: 'Test Guild' }],
    instance: { instance_id: INSTANCE, location: { guild_id: GUILD }, users: [USER] },
    exchangeStatus: 200,
    scope: 'identify guilds rpc.activities.write',
    ...overrides,
  };
  const requests: HttpRequest[] = [];
  return {
    state,
    requests,
    request(request): Promise<HttpResponse> {
      requests.push(request);
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/v10/, '');
      let response: HttpResponse;
      if (path === '/oauth2/token') {
        response =
          state.exchangeStatus === 200
            ? { status: 200, body: { access_token: 'discord-access-token', scope: state.scope } }
            : { status: state.exchangeStatus, body: { error: 'invalid_grant' } };
      } else if (path === '/users/@me') {
        response = { status: 200, body: state.user };
      } else if (path === '/users/@me/guilds') {
        response = { status: 200, body: state.guilds };
      } else if (path.includes('/activity-instances/')) {
        response = state.instance
          ? { status: 200, body: state.instance }
          : { status: 404, body: {} };
      } else {
        response = { status: 404, body: {} };
      }
      return Promise.resolve(response);
    },
  };
}

export interface TestServer extends CasinoServices {
  clock: ManualClock;
  keys: ProxyKeys;
  discord: FakeDiscord;
  config: Config;
  /** Signed proxy headers valid at the manual clock's current time. */
  signed(extra?: Record<string, string>): Record<string, string>;
}

export function createTestServer(
  options: {
    discord?: Partial<FakeDiscordState>;
    env?: Record<string, string>;
    sessionTtlSeconds?: number;
    /** Defaults to a silent logger. */
    logger?: Logger;
    socketHandlers?: SocketHandlers;
    /** Use the casino's own socket handlers instead of the empty set the socket tests expect. */
    casinoHandlers?: boolean;
    /** A hand-fired cron driver, so no real timer runs. */
    cronDriver?: CronDriver;
    rateLimits?: { ipPerMinute: number; tokenPerMinute: number; userPerMinute: number };
  } = {},
): TestServer {
  const keys = makeProxyKeys();
  const clock = manualClock(START_MS);
  const discord = fakeDiscord(options.discord);
  const config = testConfig(keys.publicKeyHex, options.env);
  const server = createServer({
    config,
    clock,
    http: discord,
    logger: options.logger ?? createLogger({ level: 'silent' }),
    store: memoryStore(),
    ...(options.sessionTtlSeconds === undefined
      ? {}
      : { sessionTtlSeconds: options.sessionTtlSeconds }),
    // The socket tests drive their own handlers; pass `socketHandlers: games.handlers` to use the casino's.
    ...(options.casinoHandlers === true ? {} : { socketHandlers: options.socketHandlers ?? {} }),
    ...(options.cronDriver === undefined ? {} : { cronDriver: options.cronDriver }),
    ...(options.rateLimits === undefined ? {} : { rateLimits: options.rateLimits }),
  });
  return {
    ...server,
    clock,
    keys,
    discord,
    config,
    signed: (extra = {}) => ({ ...keys.headers(Math.floor(clock.now() / 1000)), ...extra }),
  };
}
