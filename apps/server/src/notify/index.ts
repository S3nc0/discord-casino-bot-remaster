import type { Clock } from '@casino/shared';
import type { Logger } from 'pino';
import type { Store } from '../db/store.ts';
import type { EventBus } from '../runtime/bus.ts';
import type { CasinoServer } from '../socket/server.ts';
import { Announcer, GuildRateLimiter, type FlushReport } from './announcer.ts';
import { NotifyConfigService } from './config-service.ts';
import { DmQueue, type DmProcessReport } from './dm-queue.ts';
import { InboxWriter } from './inbox-writer.ts';
import {
  EVENT_META,
  SUBSCRIBED_EVENT_TYPES,
  type PersonaId,
  type SubscribedDomainEvent,
} from './messages.ts';
import { WebhookPersonaManager } from './personas.ts';
import { StreamPosts } from './stream-posts.ts';
import {
  createNoopDiscordPort,
  createNoopRealtimePort,
  createSocketRealtimePort,
  type DiscordNotifyPort,
  type RealtimeNotifyPort,
} from './ports.ts';
import { defaultEmbedTheme, type EmbedTheme } from './theme.ts';

export * from './announcer.ts';
export * from './config-service.ts';
export * from './discord-port.ts';
export * from './dm-queue.ts';
export * from './inbox-writer.ts';
export * from './messages.ts';
export * from './personas.ts';
export * from './post-pins.ts';
export * from './ports.ts';
export * from './runtime.ts';
export * from './stream-posts.ts';
export * from './theme.ts';

export interface AttachNotifyOptions {
  bus: EventBus;
  store: Store;
  clock: Clock;
  logger: Logger;
  /** Fallback channel ID from `ANNOUNCE_CHANNEL_ID`. */
  defaultAnnounceChannelId: string;
  /** Discord I/O port (implemented over discord.js in `discord-port.ts`). Defaults to a safe no-op port when omitted. */
  port?: DiscordNotifyPort;
  /** Socket.io server or custom realtime emitter for `inbox:new` and `toast`. */
  io?: Pick<CasinoServer, 'to'>;
  realtime?: RealtimeNotifyPort;
  /** Embed role→color theme. */
  theme?: EmbedTheme;
  /** Base URL for default persona avatar images (e.g. `PUBLIC_API_ORIGIN`). */
  avatarBaseUrl?: string;
  avatarUrls?: Partial<Record<PersonaId, string>>;
  batchWindowMs?: number;
  maxBatchSize?: number;
  rateWindowMs?: number;
  digestWindowMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxAttempts?: number;
  permissionCooldownMs?: number;
  /** Background flush/poll interval (ms). Default 1,000 ms; set to `0` to drive manually. */
  pollIntervalMs?: number;
}

export interface NotifyHandle {
  readonly config: NotifyConfigService;
  readonly announcer: Announcer;
  readonly dmQueue: DmQueue;
  readonly inboxWriter: InboxWriter;
  readonly personas: WebhookPersonaManager;
  /** Tip cards, round notices and results of the stream panel, in the panel's channel. */
  readonly streamPosts: StreamPosts;
  /** Flush due announcement batches and process due DM queue items. */
  flush(): Promise<{ announcements: FlushReport; dms: DmProcessReport; streams: number }>;
  /** Unsubscribe from the bus and stop background timers. */
  stop(): void;
}

/** Extract deduplicated personal notification recipients for events that produce inbox/DM items. */
export function notificationRecipients(event: SubscribedDomainEvent): string[] {
  switch (event.type) {
    case 'RaceFinished':
      return [...new Set([...event.ownerIds, ...event.bettorIds])];
    case 'HorseRetired':
    case 'HorseFoaled':
    case 'LoanDue':
    case 'BankruptcyGraceStarted':
    case 'DailyReady':
    case 'MissionCompleted':
    case 'OrderFilled':
    case 'MarketplaceOutbid':
      return [event.userId];
    default:
      return [];
  }
}

/**
 * Wire the notify module onto the in-process `EventBus`:
 * - Subscribes to all 19 domain events.
 * - Routes guild announcements through `Announcer` + optional `WebhookPersonaManager`.
 * - Routes personal notifications through `InboxWriter` (DB + live Socket.io) and opt-in `DmQueue`.
 */
export function attachNotify(options: AttachNotifyOptions): NotifyHandle {
  const port = options.port ?? createNoopDiscordPort();
  const realtime =
    options.realtime ??
    (options.io ? createSocketRealtimePort(options.io) : createNoopRealtimePort());
  const theme = options.theme ?? defaultEmbedTheme;

  const config = new NotifyConfigService({
    store: options.store,
    clock: options.clock,
    defaultAnnounceChannelId: options.defaultAnnounceChannelId,
  });

  const personas = new WebhookPersonaManager({
    store: options.store,
    port,
    clock: options.clock,
    logger: options.logger,
    ...(options.avatarBaseUrl === undefined ? {} : { avatarBaseUrl: options.avatarBaseUrl }),
    ...(options.avatarUrls === undefined ? {} : { avatarUrls: options.avatarUrls }),
    ...(options.permissionCooldownMs === undefined
      ? {}
      : { permissionCooldownMs: options.permissionCooldownMs }),
  });

  const rateLimiter = new GuildRateLimiter(options.rateWindowMs ?? 60_000);
  const announcer = new Announcer({
    configService: config,
    port,
    personas,
    clock: options.clock,
    logger: options.logger,
    theme,
    rateLimiter,
    ...(options.batchWindowMs === undefined ? {} : { batchWindowMs: options.batchWindowMs }),
    ...(options.maxBatchSize === undefined ? {} : { maxBatchSize: options.maxBatchSize }),
    ...(options.rateWindowMs === undefined ? {} : { rateWindowMs: options.rateWindowMs }),
  });

  const inboxWriter = new InboxWriter({
    store: options.store,
    bus: options.bus,
    clock: options.clock,
    configService: config,
    realtime,
  });

  const dmQueue = new DmQueue({
    store: options.store,
    port,
    configService: config,
    inboxWriter,
    clock: options.clock,
    logger: options.logger,
    theme,
    ...(options.digestWindowMs === undefined ? {} : { digestWindowMs: options.digestWindowMs }),
    ...(options.baseBackoffMs === undefined ? {} : { baseBackoffMs: options.baseBackoffMs }),
    ...(options.maxBackoffMs === undefined ? {} : { maxBackoffMs: options.maxBackoffMs }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  });

  dmQueue.recoverStuckSending();

  const handleEvent = (event: SubscribedDomainEvent): void => {
    announcer.enqueue(event);

    const kind = EVENT_META[event.type].notificationKind;
    if (kind !== null) {
      for (const userId of notificationRecipients(event)) {
        inboxWriter.writeNotification(userId, kind, event);
        dmQueue.enqueue(userId, kind, event);
      }
    }
  };

  const streamPosts = new StreamPosts({
    store: options.store,
    configService: config,
    port,
    rateLimiter,
    clock: options.clock,
    logger: options.logger,
    theme,
  });

  const unsubscribes = SUBSCRIBED_EVENT_TYPES.map((type) =>
    options.bus.onDomain(type, (event) => handleEvent(event)),
  );
  unsubscribes.push(streamPosts.attach(options.bus));

  const flush = async (): Promise<{
    announcements: FlushReport;
    dms: DmProcessReport;
    streams: number;
  }> => {
    const [announcements, dms, streams] = await Promise.all([
      announcer.flushDue(),
      dmQueue.processDue(),
      streamPosts.flushDue(),
    ]);
    return { announcements, dms, streams };
  };

  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  if (pollIntervalMs > 0) {
    timer = setInterval(() => {
      void flush().catch((error: unknown) => {
        options.logger.error({ err: error }, 'notify background flush failed');
      });
    }, pollIntervalMs);
    timer.unref();
  }

  let stopped = false;
  return {
    config,
    announcer,
    dmQueue,
    inboxWriter,
    personas,
    streamPosts,
    flush,
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const off of unsubscribes) off();
    },
  };
}
