import { startBot, type BotHandle, type StartBotOptions } from '../bot/index.ts';
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
  /** Stop in order: scheduler, bot, sockets and HTTP, then the database. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Start everything that runs in the process, in dependency order, on top of the services
 * `createServer` built: the chat bot (no login with `BOT_DISABLED=1`), then HTTP, sockets and
 * the scheduler. Subscribers are in place before the first job can publish an event.
 */
export async function startRuntime(
  server: CasinoServices,
  config: Config,
  options: RuntimeOptions = {},
): Promise<RuntimeHandle> {
  const env = options.env ?? process.env;
  const bot = await startBot(server, config, { env, ...options.bot });

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      const steps: [string, () => Promise<void>][] = [
        ['scheduler', () => server.stopJobs()],
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
    return { address, bot, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
