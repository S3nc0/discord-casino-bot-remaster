import { startBot, type BotHandle, type StartBotOptions } from '../bot/index.ts';
import { createDiscordColorRolePort } from '../games/shop/color-roles.ts';
import { createDiscordPinPort } from '../notify/post-pins.ts';
import { startNotifyRuntime, type NotifyRuntimeHandle } from '../notify/runtime.ts';
import { systemClock } from './clock.ts';
import type { Config } from './config.ts';
import type { CasinoServices } from './server.ts';

export interface RuntimeOptions {
  /** Environment the bot reads `BOT_DISABLED` from. Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  bot?: Pick<StartBotOptions, 'clientFactory'>;
}

export interface RuntimeHandle {
  readonly address: string;
  readonly bot: BotHandle;
  readonly notify: NotifyRuntimeHandle;
  /** Stop in order: scheduler, notify, bot, sockets and HTTP, then the database. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Start everything that runs in the process, in dependency order, on top of the services
 * `createServer` built: the chat bot (no login with `BOT_DISABLED=1`), notify subscribers,
 * then HTTP, sockets and the scheduler. Subscribers are in place before the first job can
 * publish an event.
 */
export async function startRuntime(
  server: CasinoServices,
  config: Config,
  options: RuntimeOptions = {},
): Promise<RuntimeHandle> {
  const env = options.env ?? process.env;
  const bot = await startBot(server, config, { env, ...options.bot });
  if (bot.client) server.postPins.attach(createDiscordPinPort(bot.client));
  if (bot.client)
    server.games.shop.colorRoles.attach(createDiscordColorRolePort(bot.client), server.logger);
  const notify = startNotifyRuntime({
    db: server.store,
    bus: server.bus,
    io: server.io,
    client: bot.client,
    env: config,
    logger: server.logger,
    clock: systemClock,
  });

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      const steps: [string, () => Promise<void>][] = [
        ['scheduler', () => server.stopJobs()],
        ['pins', async () => server.postPins.attach(null)],
        ['color roles', async () => server.games.shop.colorRoles.attach(null)],
        ['notify', async () => notify.stop()],
        ['bot', () => bot.close()],
        ['server', () => server.close()],
      ];
      for (const [name, step] of steps) {
        try {
          await step();
        } catch (error) {
          server.logger.error({ err: error, step: name }, 'shutdown step failed');
        }
      }
    })();
    return stopping;
  };

  try {
    const address = await server.listen();
    return { address, bot, notify, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
