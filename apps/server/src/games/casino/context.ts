import type { Clock, Rng, TableSnapshot } from '@casino/shared';
import type { Logger } from 'pino';
import type { CasinoCore } from './core.ts';
import type { IdempotencyStore } from './idempotency.ts';
import type { Scheduler } from './types.ts';

/** What every game service is built from. */
export interface GameContext {
  core: CasinoCore;
  idem: IdempotencyStore;
  rng: Rng;
  clock: Clock;
  scheduler: Scheduler;
  logger: Logger;
  /** Push a table snapshot to its room (`table:state`). A no-op until a socket server attaches. */
  broadcast(snapshot: TableSnapshot): void;
}

export const timerScheduler: Scheduler = {
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
