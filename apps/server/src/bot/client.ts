import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  type CacheWithLimitsOptions,
  type SweeperOptions,
} from 'discord.js';
import type { Clock } from '@casino/shared';
import { NotifyConfigService } from '../notify/config-service.ts';
import { systemClock } from '../runtime/clock.ts';
import type { Config } from '../runtime/config.ts';
import type { CasinoServices } from '../runtime/server.ts';
import { PLACEHOLDER_DISCORD_TOKEN } from './deploy.ts';
import { startBoardRefresh } from './boards.ts';
import { createInteractionHandler, type BotRouterDeps } from './router.ts';

/** Guilds intent only: zero privileged intents (no GuildMembers, Presences, MessageContent). */
export const BOT_INTENTS = [GatewayIntentBits.Guilds] as const;

/** Tiny caches tailored for a single-process server with `--max-old-space-size=192`. */
export const BOT_CACHE_SETTINGS: CacheWithLimitsOptions = {
  ApplicationCommandManager: 0,
  ApplicationEmojiManager: 0,
  AutoModerationRuleManager: 0,
  BaseGuildEmojiManager: 0,
  DMMessageManager: 0,
  EntitlementManager: 0,
  GuildBanManager: 0,
  GuildEmojiManager: 0,
  GuildForumThreadManager: 0,
  GuildInviteManager: 0,
  GuildMemberManager: 0,
  GuildMessageManager: 10,
  GuildScheduledEventManager: 0,
  GuildStickerManager: 0,
  GuildTextThreadManager: 0,
  MessageManager: 10,
  PresenceManager: 0,
  ReactionManager: 0,
  ReactionUserManager: 0,
  StageInstanceManager: 0,
  ThreadManager: 0,
  ThreadMemberManager: 0,
  UserManager: {
    maxSize: 100,
    keepOverLimit: (user) => user.id === user.client.user?.id,
  },
  VoiceStateManager: 0,
};

/** Periodic sweepers so tiny caches never retain stale entries. */
export const BOT_SWEEPER_OPTIONS: SweeperOptions = {
  messages: { interval: 300, lifetime: 600 },
  threads: { interval: 300, lifetime: 600 },
  users: {
    interval: 600,
    filter: () => (user) => user.id !== user.client.user?.id,
  },
};

export type BotDisabledReason =
  'BOT_DISABLED=1' | 'missing DISCORD_TOKEN' | 'placeholder DISCORD_TOKEN';

/** Determine whether the Discord gateway login should be skipped on startup. */
export function getBotDisabledReason(
  token: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): BotDisabledReason | null {
  if (env.BOT_DISABLED === '1' || env.BOT_DISABLED === 'true') {
    return 'BOT_DISABLED=1';
  }
  if (!token || token.trim().length === 0) {
    return 'missing DISCORD_TOKEN';
  }
  if (token === PLACEHOLDER_DISCORD_TOKEN) {
    return 'placeholder DISCORD_TOKEN';
  }
  return null;
}

export interface BotHandle {
  readonly client: Client | null;
  close(): Promise<void>;
}

export type CreateBotClientDeps = BotRouterDeps;

/** Create and configure a discord.js v14 Client with Guilds intent, tiny caches, and interaction routing. */
export function createDiscordClient(deps: CreateBotClientDeps): Client {
  const client = new Client({
    intents: [...BOT_INTENTS],
    makeCache: Options.cacheWithLimits(BOT_CACHE_SETTINGS),
    sweepers: BOT_SWEEPER_OPTIONS,
    allowedMentions: { parse: [] },
  });

  const onInteraction = createInteractionHandler(deps);

  let stopBoards: (() => void) | null = null;
  client.once(Events.ClientReady, (readyClient) => {
    if (deps.store) {
      stopBoards = startBoardRefresh(
        client,
        deps.store,
        deps.identity,
        deps.logger,
        () => (deps.clock ?? systemClock).now(),
        deps.finance?.netWorth,
      );
    }
    deps.logger.info(
      { userId: readyClient.user.id, guilds: readyClient.guilds.cache.size },
      'discord bot ready',
    );
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void onInteraction(interaction);
  });

  client.once(Events.ShardDisconnect, () => stopBoards?.());

  client.on(Events.Warn, (warning) => {
    deps.logger.warn({ warning }, 'discord client warning');
  });

  client.on(Events.Error, (error) => {
    deps.logger.error({ err: error }, 'discord client error');
  });

  return client;
}

export interface StartBotOptions {
  env?: Readonly<Record<string, string | undefined>>;
  clientFactory?: (deps: CreateBotClientDeps) => Client;
  notifyConfig?: NotifyConfigService;
  clock?: Clock;
}

export type StartBotServices = Pick<
  CasinoServices,
  'identity' | 'economy' | 'settings' | 'logger'
> &
  Partial<
    Pick<
      CasinoServices,
      'store' | 'launchIntents' | 'casino' | 'finance' | 'games' | 'sessions' | 'postPins'
    >
  >;

export type StartBotConfig = Pick<
  Config,
  'discord' | 'ownerIds' | 'allowedGuildIds' | 'requireApproval'
> &
  Partial<Pick<Config, 'announceChannelId'>>;

/**
 * Start the Discord bot in-process if enabled and configured with a real token.
 * Skips gateway login when `BOT_DISABLED=1` or `DISCORD_TOKEN` is missing/placeholder.
 */
export async function startBot(
  services: StartBotServices,
  config: StartBotConfig,
  options: StartBotOptions = {},
): Promise<BotHandle> {
  const reason = getBotDisabledReason(config.discord.token, options.env);
  if (reason !== null) {
    services.logger.info({ reason }, 'discord bot login skipped');
    return {
      client: null,
      close: async () => {},
    };
  }

  const notifyConfig =
    options.notifyConfig ??
    (services.store
      ? new NotifyConfigService({
          store: services.store,
          clock: options.clock ?? systemClock,
          defaultAnnounceChannelId: config.announceChannelId ?? '',
        })
      : undefined);

  const factory = options.clientFactory ?? createDiscordClient;
  const client = factory({
    identity: services.identity,
    economy: services.economy,
    settings: services.settings,
    logger: services.logger,
    ownerIds: config.ownerIds,
    allowedGuildIds: config.allowedGuildIds,
    requireApproval: config.requireApproval,
    clock: options.clock ?? systemClock,
    ...(services.launchIntents ? { launchIntents: services.launchIntents } : {}),
    ...(notifyConfig ? { notifyConfig } : {}),
    ...(services.store ? { store: services.store } : {}),
    ...(services.casino ? { casino: services.casino } : {}),
    ...(services.finance ? { finance: services.finance } : {}),
    ...(services.games ? { games: services.games } : {}),
    ...(services.postPins ? { pins: services.postPins } : {}),
    // A denied guild loses its live sockets at once; HTTP and new handshakes already read the status.
    ...(services.sessions
      ? { onGuildRevoked: (guildId: string) => services.sessions!.revokeGuild(guildId) }
      : {}),
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await client.destroy();
  };

  try {
    await client.login(config.discord.token);
  } catch (error) {
    await close();
    throw error;
  }

  return { client, close };
}
