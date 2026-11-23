import type { Logger } from 'pino';

/** The slice of `process` the guard uses (a stand-in in tests). */
export interface GuardedProcess {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off(event: 'uncaughtException', listener: (error: Error) => void): unknown;
}

/**
 * One handler that throws must not take the guilds, games and the bot down with it. Every
 * failure of this kind is logged with its stack and the process keeps serving: all state
 * changes are synchronous SQLite transactions, so a throw cannot leave one half done.
 * Returns the function that removes the listeners.
 */
export function installProcessGuards(
  logger: Logger,
  target: GuardedProcess = process as unknown as GuardedProcess,
): () => void {
  const onRejection = (reason: unknown): void => {
    logger.error({ err: reason }, 'unhandled rejection');
  };
  const onException = (error: Error): void => {
    logger.error({ err: error }, 'uncaught exception');
  };
  target.on('unhandledRejection', onRejection);
  target.on('uncaughtException', onException);
  return () => {
    target.off('unhandledRejection', onRejection);
    target.off('uncaughtException', onException);
  };
}
