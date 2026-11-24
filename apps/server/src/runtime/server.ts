import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { RELIC_AUCTION_PER_DAY } from '@casino/domain/shop';
import type { Clock, LaunchIntentService, Rng } from '@casino/shared';
import { createFetchClient, DiscordApi, type HttpClient } from '../auth/discord.ts';
import { SqliteLaunchIntentService } from '../auth/launch-intents.ts';
import { createProxySignatureVerifier } from '../auth/proxy-verifier.ts';
import { SessionService } from '../auth/sessions.ts';
import { TokenFlow } from '../auth/token-flow.ts';
import { IdentityRepo } from '../db/identity.ts';
import { InboxService } from '../db/inbox.ts';
import { SettingsRepo } from '../db/settings.ts';
import { migrations } from '../db/migrations/index.ts';
import { openStore, type Store } from '../db/store.ts';
import { EconomyService } from '../economy/economy-service.ts';
import { createFinanceServices, type FinanceServices } from '../finance/index.ts';
import {
  createCasinoGames,
  type CasinoGames,
  type Scheduler as CasinoTimers,
} from '../games/index.ts';
import { Inventory } from '../games/shop/inventory.ts';
import { createNonCasinoGames, type NonCasinoGames } from '../games/progression/index.ts';
import { buildApp, type RateLimits } from '../http/app.ts';
import {
  attachSocketServer,
  type CasinoServer,
  type SocketHandlers,
  type SocketLimits,
} from '../socket/server.ts';
import {
  createCasinoPorts,
  createExternalLiquidation,
  createMarketplaceAssets,
  createTeiaiPort,
} from './adapters/index.ts';
import { EventBus } from './bus.ts';
import { PostPinService } from '../notify/post-pins.ts';
import { StreamService } from '../stream/service.ts';
import { systemClock } from './clock.ts';
import type { Config } from './config.ts';
import { buildJobManifest } from './jobs.ts';
import { createLogger } from './logger.ts';
import { cryptoRng } from './rng.ts';
import { Scheduler, type CronDriver } from './scheduler.ts';

/**
 * Proxies between the client and this server: the tunnel, which appends the client address to
 * `X-Forwarded-For`. Only that last entry is believed, so a client cannot choose its own address.
 */
export const TRUSTED_PROXY_HOPS = 1;

export interface CreateServerOptions {
  config: Config;
  /** Defaults to the real clock. */
  clock?: Clock;
  /** Defaults to `fetch`. Tests pass a fake so nothing reaches the network. */
  http?: HttpClient;
  logger?: Logger;
  /** Use an already open store (tests); otherwise `config.databasePath` is opened. */
  store?: Store;
  socketHandlers?: SocketHandlers;
  rateLimits?: RateLimits;
  sessionTtlSeconds?: number;
  /** `true` or a hop count: trust `X-Forwarded-For` (see `TRUSTED_PROXY_HOPS`). */
  trustProxy?: boolean | number;
  socketLimits?: SocketLimits;
  /** Defaults to the crypto RNG. Tests pass a seeded one. */
  rng?: Rng;
  /** Defaults to croner. Tests pass a driver they fire by hand. */
  cronDriver?: CronDriver;
  /** Timers of the casino rounds (betting windows, turn timeouts). Defaults to real timers. */
  casinoTimers?: CasinoTimers;
  /**
   * Relics Teiai puts on the player market per guild per UTC day. Defaults to
   * `RELIC_AUCTION_PER_DAY` (1); test worlds pass 0 unless a test turns it on.
   */
  relicAuctionPerDay?: number;
}

/** Everything one process shares. The bot and the scheduler plug into the same instances. */
export interface CasinoServices {
  app: FastifyInstance;
  io: CasinoServer;
  store: Store;
  identity: IdentityRepo;
  economy: EconomyService;
  settings: SettingsRepo;
  inbox: InboxService;
  sessions: SessionService;
  launchIntents: LaunchIntentService;
  bus: EventBus;
  logger: Logger;
  finance: FinanceServices;
  games: NonCasinoGames;
  casino: CasinoGames;
  /** Pins the poll, kyosai motion and raffle posts and unpins them when they end. */
  postPins: PostPinService;
  /** The stream panel: super chats and win/lose rounds (docs/spec/stream.md). */
  stream: StreamService;
  scheduler: Scheduler;
  /** Start HTTP and sockets, then the scheduler. */
  listen(): Promise<string>;
  /** Stop the scheduler and wait for the jobs in flight. Idempotent; `close()` does it too. */
  stopJobs(): Promise<void>;
  close(): Promise<void>;
}

export function createServer(options: CreateServerOptions): CasinoServices {
  const { config } = options;
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? createLogger({ level: config.logLevel });

  const bus = new EventBus((error, channel) =>
    logger.error({ err: error, channel }, 'bus subscriber failed'),
  );
  const store =
    options.store ??
    openStore(config.databasePath, {
      migrations,
      onHookError: (error) => logger.error({ err: error }, 'after-commit hook failed'),
    });
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock, bus });
  const settings = new SettingsRepo(store, clock);
  const inbox = new InboxService({ store, clock, bus });
  const sessions = new SessionService({
    secret: config.sessionSecret,
    clock,
    isGuildDenied: (guildId) => identity.getGuildStatus(guildId) === 'denied',
    ...(options.sessionTtlSeconds === undefined ? {} : { ttlSeconds: options.sessionTtlSeconds }),
  });
  const launchIntents = new SqliteLaunchIntentService(store, clock);
  const discord = new DiscordApi({
    http: options.http ?? createFetchClient(),
    clientId: config.discord.clientId,
    clientSecret: config.discord.clientSecret,
    botToken: config.discord.token,
  });
  const tokenFlow = new TokenFlow({
    discord,
    store,
    identity,
    economy,
    sessions,
    launchIntents,
    allowedGuildIds: config.allowedGuildIds,
    clock,
    logger,
  });
  const proxyVerifier = config.enforceProxySignatures
    ? createProxySignatureVerifier(config.discord.publicKey)
    : null;

  // Game and finance services. The money modules and the games reach each other through the
  // adapters: the games' Teiai port runs on the finance services, the player market and
  // bankruptcy liquidation run on the shop inventory and the horses.
  const rng = options.rng ?? cryptoRng;
  const utcOffsetHours = config.utcOffsetHours;
  // The finance services are built first; bankruptcy liquidation reaches the shop through here.
  // The casino Activity routes look the games up per request, so they use this too.
  const lazy: {
    games?: NonCasinoGames;
    casino?: CasinoGames;
    teiai?: ReturnType<typeof createTeiaiPort>;
    stream?: StreamService;
  } = {};
  const finance = createFinanceServices(
    { store, economy, identity, clock, rng, bus, utcOffsetHours },
    {
      marketplaceAssets: createMarketplaceAssets(store, new Inventory(store)),
      relicAuctionPerDay: options.relicAuctionPerDay ?? RELIC_AUCTION_PER_DAY,
      liquidateExternalAssets: createExternalLiquidation(() => (lazy.games as NonCasinoGames).shop),
    },
  );
  const app = buildApp({
    logger,
    clock,
    store,
    identity,
    economy,
    settings,
    inbox,
    sessions,
    tokenFlow,
    launchIntents,
    finance,
    proxyVerifier,
    trustProxy: options.trustProxy ?? false,
    exposeReasons: config.nodeEnv !== 'production',
    requireProxySignature: config.requireProxySignature,
    activity: {
      casino: {
        store,
        economy,
        clock,
        progression: () => (lazy.games as NonCasinoGames).progression,
        core: () => (lazy.casino as CasinoGames).core,
      },
      // Inside the authed plugin, so session auth, the user limit and the proxy-signature
      // observation apply as on every other route. Read once the plugin loads.
      life: () => ({
        sessions,
        identity,
        economy,
        store,
        clock,
        games: lazy.games as NonCasinoGames,
        teiai: lazy.teiai as ReturnType<typeof createTeiaiPort>,
        offsetHours: utcOffsetHours,
        netWorth: finance.netWorth,
      }),
      stream: () => ({
        sessions,
        store,
        economy,
        clock,
        stream: lazy.stream as StreamService,
        locate: (instanceId, guildId) => discord.activityVoiceChannel(instanceId, guildId),
      }),
      horse: {
        store,
        economy,
        clock,
        services: () => ({
          games: lazy.games as NonCasinoGames,
          offsetHours: config.utcOffsetHours,
        }),
      },
    },
    ...(options.rateLimits === undefined ? {} : { rateLimits: options.rateLimits }),
  });

  const teiaiPort = createTeiaiPort({ store, teiai: finance.teiai, clock });
  lazy.teiai = teiaiPort;
  const games = createNonCasinoGames({
    store,
    economy,
    bus,
    clock,
    rng,
    teiai: teiaiPort,
    offsetHours: utcOffsetHours,
  });
  lazy.games = games;
  const casino = createCasinoGames({
    store,
    economy,
    bus,
    clock,
    rng,
    logger,
    ports: createCasinoPorts({ store, economy, teiai: finance.teiai, teiaiPort, shop: games.shop }),
    ...(options.casinoTimers === undefined ? {} : { scheduler: options.casinoTimers }),
  });
  lazy.casino = casino;
  const stopGames = games.start();
  const stream = new StreamService({
    store,
    economy,
    identity,
    clock,
    bus,
    teiai: teiaiPort,
    transfers: games.progression,
  });
  lazy.stream = stream;

  const sockets = attachSocketServer({
    httpServer: app.server,
    sessions,
    bus,
    identity,
    inbox,
    clock,
    logger,
    proxyVerifier,
    requireProxySignature: config.requireProxySignature,
    handlers: {
      ...(options.socketHandlers ?? casino.handlers),
      streamView: (scope, streamId) => stream.liveView(scope, streamId),
    },
    ...(options.socketLimits === undefined ? {} : { limits: options.socketLimits }),
    trustProxy: options.trustProxy ?? false,
  });
  casino.attach(sockets.io);
  // A crash can leave rounds open with their stakes held: give every stake back before play.
  const refunded = casino.recover();
  if (refunded > 0) logger.warn({ refunded }, 'refunded casino rounds left open by a crash');

  const postPins = new PostPinService({ store, clock, logger });

  const scheduler = new Scheduler({
    clock,
    logger,
    utcOffsetHours,
    jobs: buildJobManifest({
      store,
      logger,
      finance,
      games,
      postPins,
      colorRoles: games.shop.colorRoles,
      stream,
      purgeLaunchIntents: () => (launchIntents as SqliteLaunchIntentService).purge(),
    }),
    ...(options.cronDriver === undefined ? {} : { driver: options.cronDriver }),
  });
  const stopJobs = async (): Promise<void> => {
    scheduler.stop();
    await scheduler.drain();
  };

  let closed = false;
  return {
    app,
    io: sockets.io,
    store,
    identity,
    economy,
    settings,
    inbox,
    sessions,
    launchIntents,
    bus,
    logger,
    finance,
    games,
    casino,
    postPins,
    stream,
    scheduler,
    async listen() {
      const address = await app.listen({ port: config.port, host: config.host });
      scheduler.start();
      return address;
    },
    stopJobs,
    async close() {
      if (closed) return;
      closed = true;
      await stopJobs();
      stopGames();
      await sockets.close();
      await app.close();
      if (!options.store) store.close();
    },
  };
}
