import type { Clock } from '@casino/shared';
import type Database from 'better-sqlite3';
import type { Client } from 'discord.js';
import type { Logger } from 'pino';
import { Store } from '../db/store.ts';
import type { EventBus } from '../runtime/bus.ts';
import type { CasinoServer } from '../socket/server.ts';
import { createDiscordNotifyPort, type DiscordPortClient } from './discord-port.ts';
import { attachNotify, type NotifyHandle } from './index.ts';
import { createNoopDiscordPort } from './ports.ts';

export interface NotifyRuntimeEnv {
  readonly announceChannelId?: string;
  readonly publicApiOrigin?: string;
  readonly ANNOUNCE_CHANNEL_ID?: string;
  readonly PUBLIC_API_ORIGIN?: string;
}

export interface StartNotifyRuntimeDeps {
  db: Store | Database.Database;
  bus: EventBus;
  io: Pick<CasinoServer, 'to'> | null;
  client: Client | DiscordPortClient | null;
  env: NotifyRuntimeEnv;
  logger: Logger;
  clock: Clock;
  /** Optional poll interval override (ms); defaults to 1,000 ms. */
  pollIntervalMs?: number;
}

export type NotifyRuntimeHandle = NotifyHandle;

/**
 * Start the notify runtime: builds the Discord port (or a safe no-op port when `client` is
 * `null`, i.e. `BOT_DISABLED=1`), subscribes to every domain event on `bus`, and starts the
 * announcement + DM queue flush loop.
 */
export function startNotifyRuntime(deps: StartNotifyRuntimeDeps): NotifyRuntimeHandle {
  const store = deps.db instanceof Store ? deps.db : new Store(deps.db);
  const port = deps.client ? createDiscordNotifyPort(deps.client) : createNoopDiscordPort();
  const defaultAnnounceChannelId = deps.env.announceChannelId ?? deps.env.ANNOUNCE_CHANNEL_ID ?? '';
  const avatarBaseUrl = deps.env.publicApiOrigin ?? deps.env.PUBLIC_API_ORIGIN;

  return attachNotify({
    bus: deps.bus,
    store,
    clock: deps.clock,
    logger: deps.logger,
    defaultAnnounceChannelId,
    port,
    ...(deps.io ? { io: deps.io } : {}),
    ...(avatarBaseUrl ? { avatarBaseUrl } : {}),
    ...(deps.pollIntervalMs === undefined ? {} : { pollIntervalMs: deps.pollIntervalMs }),
  });
}
