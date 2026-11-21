import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Clock, LaunchIntentService } from '@casino/shared';
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
import { buildApp, type RateLimits } from '../http/app.ts';
import { attachSocketServer, type CasinoServer, type SocketHandlers } from '../socket/server.ts';
import { EventBus } from './bus.ts';
import { systemClock } from './clock.ts';
import type { Config } from './config.ts';
import { createLogger } from './logger.ts';

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
  trustProxy?: boolean;
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
  listen(): Promise<string>;
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
    requireApproval: config.requireApproval,
    clock,
    logger,
  });
  const proxyVerifier = config.enforceProxySignatures
    ? createProxySignatureVerifier(config.discord.publicKey)
    : null;

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
    proxyVerifier,
    trustProxy: options.trustProxy ?? false,
    exposeReasons: config.nodeEnv !== 'production',
    ...(options.rateLimits === undefined ? {} : { rateLimits: options.rateLimits }),
  });
  const sockets = attachSocketServer({
    httpServer: app.server,
    sessions,
    bus,
    identity,
    inbox,
    clock,
    logger,
    proxyVerifier,
    ...(options.socketHandlers === undefined ? {} : { handlers: options.socketHandlers }),
  });

  const purge = setInterval(() => {
    try {
      (launchIntents as SqliteLaunchIntentService).purge();
    } catch (error) {
      logger.error({ err: error }, 'launch intent purge failed');
    }
  }, 60_000);
  purge.unref();

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
    listen: () => app.listen({ port: config.port, host: config.host }),
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(purge);
      await sockets.close();
      await app.close();
      if (!options.store) store.close();
    },
  };
}
