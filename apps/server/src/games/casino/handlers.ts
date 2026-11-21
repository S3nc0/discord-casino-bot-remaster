import type {
  ActionIntent,
  BetIntent,
  Clock,
  ErrorCode,
  IntentAck,
  RoomScope,
  TableSnapshot,
} from '@casino/shared';
import { AppError } from '../../runtime/errors.ts';
import { RateLimiter } from '../../runtime/rate-limit.ts';
import type { SocketHandlers } from '../../socket/server.ts';
import type { BlackjackService } from './blackjack.ts';
import type { ChinchiroService } from './chinchiro.ts';
import type { PachinkoService } from './pachinko.ts';
import type { RouletteService } from './roulette.ts';
import type { SlotsService } from './slots.ts';
import type { CasinoCore } from './core.ts';
import type { Caller } from './types.ts';

export interface CasinoServices {
  core: CasinoCore;
  chinchiro: ChinchiroService;
  slots: SlotsService;
  pachinko: PachinkoService;
  blackjack: BlackjackService;
  roulette: RouletteService;
}

export interface HandlerLimits {
  /** Bets per user per 10 s. */
  betsPer10s: number;
  /** Follow-up actions (hit, stand, roll...) per user per 10 s. */
  actionsPer10s: number;
}

export const DEFAULT_LIMITS: HandlerLimits = { betsPer10s: 12, actionsPer10s: 30 };

const asInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;

function betLines(intent: BetIntent) {
  return intent.bets?.map((b) => ({ kind: b.kind, targets: b.targets, stake: b.stake }));
}

/**
 * The socket side of the games: `game:bet` and `game:action` intents become service calls with
 * the session's own user, guild and instance (never client-provided), after a per-user rate
 * limit. Errors come back as `IntentRejected`; nothing else leaks.
 */
export function createCasinoHandlers(
  games: CasinoServices,
  options: { clock: Clock; limits?: Partial<HandlerLimits> },
): SocketHandlers {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const betLimiter = new RateLimiter({
    limit: limits.betsPer10s,
    windowMs: 10_000,
    clock: options.clock,
  }).start();
  const actionLimiter = new RateLimiter({
    limit: limits.actionsPer10s,
    windowMs: 10_000,
    clock: options.clock,
  }).start();

  const callerOf = (scope: RoomScope): Caller => ({
    guildId: scope.guildId,
    userId: scope.userId,
    source: 'activity',
    instanceId: scope.instanceId,
  });

  const accepted = (
    caller: Caller,
    key: string,
    outcome: { response: unknown; replayed: boolean },
  ): IntentAck => {
    const result = outcome.response as { roundId?: string };
    return {
      ok: true,
      idempotencyKey: key,
      replayed: outcome.replayed,
      balance: games.core.economy.getBalance(caller.guildId, caller.userId),
      ...(typeof result?.roundId === 'string' ? { roundId: result.roundId } : {}),
      result: outcome.response,
    };
  };

  const rejected = (key: string, error: unknown): IntentAck => {
    if (error instanceof AppError) {
      return {
        ok: false,
        idempotencyKey: key,
        error: error.code,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    }
    throw error;
  };

  const limited = (limiter: RateLimiter, scope: RoomScope, key: string): IntentAck | null => {
    const hit = limiter.hit(`${scope.guildId}:${scope.userId}`);
    return hit.allowed
      ? null
      : {
          ok: false,
          idempotencyKey: key,
          error: 'rate_limited' as ErrorCode,
          retryAfterMs: hit.retryAfterMs,
        };
  };

  return {
    tableSnapshot(scope, game): TableSnapshot | null {
      if (game === 'blackjack') return games.blackjack.snapshot(scope.guildId, scope.instanceId);
      if (game === 'roulette') return games.roulette.snapshot(scope.guildId, scope.instanceId);
      return null;
    },

    bet(scope, intent): IntentAck {
      const key = intent.idempotencyKey;
      const blocked = limited(betLimiter, scope, key);
      if (blocked) return blocked;
      const caller = callerOf(scope);
      const base = { stake: intent.stake, idempotencyKey: key };
      try {
        switch (intent.game) {
          case 'chinchiro':
            return accepted(caller, key, games.chinchiro.start(caller, base));
          case 'slots':
            return accepted(caller, key, games.slots.play(caller, base));
          case 'pachinko': {
            const sets = intent.args?.['sets'];
            if (sets !== undefined && asInt(sets) === undefined)
              throw new AppError('invalid_payload');
            return accepted(
              caller,
              key,
              games.pachinko.play(caller, {
                ...base,
                ...(sets === undefined ? {} : { sets: sets as number }),
              }),
            );
          }
          case 'blackjack':
            return accepted(
              caller,
              key,
              games.blackjack.bet(caller, {
                ...base,
                ...(intent.roundId === undefined ? {} : { roundId: intent.roundId }),
              }),
            );
          case 'roulette': {
            const lines = betLines(intent);
            const kind = intent.args?.['kind'];
            const number = intent.args?.['number'];
            return accepted(
              caller,
              key,
              games.roulette.placeBet(caller, {
                ...base,
                ...(lines === undefined ? {} : { bets: lines }),
                ...(typeof kind === 'string' ? { kind } : {}),
                ...(asInt(number) === undefined ? {} : { number: asInt(number) as number }),
                ...(intent.roundId === undefined ? {} : { roundId: intent.roundId }),
              }),
            );
          }
          default:
            throw new AppError('feature_disabled');
        }
      } catch (error) {
        return rejected(key, error);
      }
    },

    action(scope, intent: ActionIntent): IntentAck {
      const key = intent.idempotencyKey;
      const blocked = limited(actionLimiter, scope, key);
      if (blocked) return blocked;
      const caller = callerOf(scope);
      const base = { roundId: intent.roundId, idempotencyKey: key };
      try {
        if (intent.game === 'chinchiro' && intent.action === 'roll') {
          return accepted(caller, key, games.chinchiro.roll(caller, base));
        }
        if (intent.game === 'blackjack') {
          switch (intent.action) {
            case 'hit':
              return accepted(caller, key, games.blackjack.hit(caller, base));
            case 'stand':
              return accepted(caller, key, games.blackjack.stand(caller, base));
            case 'deal':
              return accepted(caller, key, games.blackjack.deal(caller, base));
            case 'double':
              return accepted(
                caller,
                key,
                games.blackjack.double(caller, {
                  ...base,
                  credit: intent.args?.['credit'] === true,
                }),
              );
          }
        }
        throw new AppError('invalid_payload');
      } catch (error) {
        return rejected(key, error);
      }
    },
  };
}
