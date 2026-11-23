// One real server process-in-a-box for the end-to-end suites: Fastify + Socket.io + the casino
// services on an in-memory database, a scripted clock and scheduler, and a fake Discord that
// knows several users, guilds and Activity instances. Nothing reaches the network and the chat
// bot is never started (the equivalent of BOT_DISABLED=1: `startRuntime` is not called).
import { manualClock, type ManualClock, type Rng } from '../../../packages/shared/src/index.ts';
import type {
  HttpClient,
  HttpRequest,
  HttpResponse,
} from '../../../apps/server/src/auth/discord.ts';
import { manualScheduler } from '../../../apps/server/src/games/casino/test-kit.ts';
import { createLogger } from '../../../apps/server/src/runtime/logger.ts';
import { createServer, type CasinoServices } from '../../../apps/server/src/runtime/server.ts';
import {
  START_MS,
  makeProxyKeys,
  memoryStore,
  testConfig,
  type ProxyKeys,
} from '../../../apps/server/src/runtime/test-kit.ts';

export const GUILD_A = '234567890123456789';
export const GUILD_B = '234567890123456780';
export const INSTANCE_A1 = 'i-aaaaaaaaaa-gc-a1';
export const INSTANCE_A2 = 'i-aaaaaaaaaa-gc-a2';
export const INSTANCE_B1 = 'i-bbbbbbbbbb-gc-b1';

export interface Person {
  id: string;
  username: string;
}

export const ALICE: Person = { id: '123456789012345601', username: 'alice' };
export const BOB: Person = { id: '123456789012345602', username: 'bob' };
export const CAROL: Person = { id: '123456789012345603', username: 'carol' };
export const DAVE: Person = { id: '123456789012345604', username: 'dave' };
export const PEOPLE: Person[] = [ALICE, BOB, CAROL, DAVE];

export interface InstanceSpec {
  id: string;
  guildId: string;
}

/** What Discord answers. Everybody is in every guild; an instance admits whoever is listed. */
export interface WorldSpec {
  people: Person[];
  guilds: string[];
  instances: InstanceSpec[];
}

export const DEFAULT_WORLD: WorldSpec = {
  people: PEOPLE,
  guilds: [GUILD_A, GUILD_B],
  instances: [
    { id: INSTANCE_A1, guildId: GUILD_A },
    { id: INSTANCE_A2, guildId: GUILD_A },
    { id: INSTANCE_B1, guildId: GUILD_B },
  ],
};

/**
 * A Discord that maps `code` to a user: the OAuth code of a test client is the user's id, the
 * access token `at:<id>`. Every person is in every listed guild and every instance.
 */
export function worldDiscord(world: WorldSpec): HttpClient {
  const people = new Map(world.people.map((p) => [p.id, p]));
  const userOf = (request: HttpRequest): Person | undefined => {
    const bearer = request.headers?.['authorization'] ?? '';
    return people.get(bearer.replace(/^Bearer at:/, ''));
  };
  return {
    request(request): Promise<HttpResponse> {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/v10/, '');
      const reply = (status: number, body: unknown): Promise<HttpResponse> =>
        Promise.resolve({ status, body });
      if (path === '/oauth2/token') {
        const code = request.form?.['code'] ?? '';
        return people.has(code)
          ? reply(200, {
              access_token: `at:${code}`,
              scope: 'identify guilds rpc.activities.write',
            })
          : reply(400, { error: 'invalid_grant' });
      }
      if (path === '/users/@me') {
        const person = userOf(request);
        return person
          ? reply(200, {
              id: person.id,
              username: person.username,
              global_name: person.username,
              avatar: null,
            })
          : reply(401, {});
      }
      if (path === '/users/@me/guilds') {
        return reply(
          200,
          world.guilds.map((id) => ({ id, name: `Guild ${id.slice(-2)}` })),
        );
      }
      if (path.includes('/activity-instances/')) {
        const id = decodeURIComponent(path.split('/activity-instances/')[1] ?? '');
        const instance = world.instances.find((i) => i.id === id);
        return instance
          ? reply(200, {
              instance_id: instance.id,
              location: { guild_id: instance.guildId },
              users: world.people.map((p) => p.id),
            })
          : reply(404, {});
      }
      return reply(404, {});
    },
  };
}

export interface Stack extends CasinoServices {
  url: string;
  clock: ManualClock;
  keys: ProxyKeys;
  timers: ReturnType<typeof manualScheduler>;
  world: WorldSpec;
  /** Signed proxy headers valid at the clock's present. */
  signed(extra?: Record<string, string>): Record<string, string>;
}

export interface StackOptions {
  world?: WorldSpec;
  /** Extra env for the server config (`ALLOWED_GUILD_IDS` defaults to every guild of the world). */
  env?: Record<string, string>;
  /** Listen on this port instead of an ephemeral one. */
  port?: number;
  /** Randomness of every game; defaults to the crypto RNG. Pass a seeded one to replay a table. */
  rng?: Rng;
  /** Session lifetime; the default of one hour is plenty for a test. */
  sessionTtlSeconds?: number;
}

/** Start a server on 127.0.0.1. Call `stack.close()` when done. */
export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const world = options.world ?? DEFAULT_WORLD;
  const keys = makeProxyKeys();
  const clock = manualClock(START_MS);
  const timers = manualScheduler(clock);
  const config = testConfig(keys.publicKeyHex, {
    ALLOWED_GUILD_IDS: world.guilds.join(','),
    OWNER_IDS: world.people.map((p) => p.id).join(','),
    TEST_GUILD_ID: world.guilds[0] ?? GUILD_A,
    BOT_DISABLED: '1',
    PORT: String(options.port ?? 0),
    HOST: '127.0.0.1',
    ...options.env,
  });
  const server = createServer({
    config,
    clock,
    http: worldDiscord(world),
    logger: createLogger({ level: 'silent' }),
    store: memoryStore(),
    casinoTimers: timers.scheduler,
    ...(options.rng === undefined ? {} : { rng: options.rng }),
    // Tests run many requests from one address.
    rateLimits: { ipPerMinute: 100_000, tokenPerMinute: 100_000, userPerMinute: 100_000 },
    ...(options.sessionTtlSeconds === undefined
      ? {}
      : { sessionTtlSeconds: options.sessionTtlSeconds }),
  });
  const address = await server.app.listen({ port: config.port, host: '127.0.0.1' });
  const url = address.replace('[::1]', '127.0.0.1');
  return {
    ...server,
    url,
    clock,
    keys,
    timers,
    world,
    signed: (extra = {}) => ({ ...keys.headers(Math.floor(clock.now() / 1000)), ...extra }),
  };
}
