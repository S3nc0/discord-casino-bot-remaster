import type { TableSnapshot } from '@casino/shared';
import { rooms } from '@casino/shared';
import type { CasinoServer } from '../socket/server.ts';
import type { SocketHandlers } from '../socket/server.ts';
import { BlackjackService } from './casino/blackjack.ts';
import { ChinchiroService } from './casino/chinchiro.ts';
import { ChinchiroTableService } from './casino/chinchiro-table.ts';
import { timerScheduler, type GameContext } from './casino/context.ts';
import { CasinoCore } from './casino/core.ts';
import { createCasinoHandlers, type HandlerLimits } from './casino/handlers.ts';
import { IdempotencyStore } from './casino/idempotency.ts';
import { PachinkoService } from './casino/pachinko.ts';
import { RouletteService } from './casino/roulette.ts';
import { SlotsService } from './casino/slots.ts';
import type { CasinoDeps } from './casino/types.ts';

export type { CasinoDeps, CasinoPorts, Caller, RoundSettled, Scheduler } from './casino/types.ts';

export interface CasinoGames {
  core: CasinoCore;
  chinchiro: ChinchiroService;
  chinchiroTable: ChinchiroTableService;
  slots: SlotsService;
  pachinko: PachinkoService;
  blackjack: BlackjackService;
  roulette: RouletteService;
  /** Pass to the socket server (`SocketServerOptions.handlers`). */
  handlers: SocketHandlers;
  /** Give tables a way to push `table:state`. Call once the socket server exists. */
  attach(io: CasinoServer): void;
  /** At start-up: refund every round a crash left open. Returns how many. */
  recover(): number;
}

/**
 * The registration hook: builds the casino games on the shared services and returns the
 * socket handlers plus the services the chat bot calls directly.
 *
 *   const games = createCasinoGames({ store, economy, bus, clock, rng: cryptoRng, logger });
 *   attachSocketServer({ ..., handlers: games.handlers });
 *   games.attach(io);
 *   games.recover();
 */
export function createCasinoGames(
  deps: CasinoDeps & { limits?: Partial<HandlerLimits> },
): CasinoGames {
  let io: CasinoServer | null = null;
  const core = new CasinoCore(deps);
  const ctx: GameContext = {
    core,
    idem: new IdempotencyStore(deps.store, deps.clock),
    rng: deps.rng,
    clock: deps.clock,
    scheduler: deps.scheduler ?? timerScheduler,
    logger: deps.logger,
    broadcast(snapshot: TableSnapshot) {
      io?.to(rooms.table(snapshot.instanceId, snapshot.game)).emit('table:state', snapshot);
    },
  };
  const services = {
    core,
    chinchiro: new ChinchiroService(ctx),
    chinchiroTable: new ChinchiroTableService(ctx),
    slots: new SlotsService(ctx),
    pachinko: new PachinkoService(ctx),
    blackjack: new BlackjackService(ctx),
    roulette: new RouletteService(ctx),
  };
  return {
    ...services,
    handlers: createCasinoHandlers(services, {
      clock: deps.clock,
      ...(deps.limits === undefined ? {} : { limits: deps.limits }),
    }),
    attach(server) {
      io = server;
    },
    recover: () => core.recoverOpenRounds(),
  };
}
