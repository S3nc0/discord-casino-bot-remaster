import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Value } from 'typebox/value';
import {
  CASINO_GAME_IDS,
  CASINO_MIN_BET,
  CASINO_ROUTES,
  DailyClaimRequest,
  HISTORY_PAGE_DEFAULT,
  HistoryQuery,
  type CasinoOverview,
  type Clock,
  type DailyClaimResponse,
  type DailyStatus,
  type HistoryPage,
  type RecentRound,
  type SessionClaims,
} from '@casino/shared';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import type { CasinoCore } from '../../games/casino/core.ts';
import { IdempotencyStore } from '../../games/casino/idempotency.ts';
import type { ProgressionService } from '../../games/progression/service.ts';
import { AppError } from '../../runtime/errors.ts';
import { RateLimiter } from '../../runtime/rate-limit.ts';

export type SessionOf = (request: FastifyRequest) => SessionClaims;

/** What the casino routes need. Services are looked up per request: they are built after the app. */
export interface CasinoHttpDeps {
  store: Store;
  economy: EconomyService;
  clock: Clock;
  progression: () => ProgressionService;
  core: () => CasinoCore;
  /** Daily claims per user per minute (a repeat of the same key is free). */
  claimsPerMinute?: number;
}

interface RoundRow {
  round_id: string;
  game: RecentRound['game'];
  stake: number;
  payout: number;
  net: number;
  settled_at: number;
}

/**
 * Casino slice of the Activity: the jackpot and last rounds, the daily bonus and the ledger
 * history. Session user and guild only; the games themselves run on the socket.
 */
export function registerCasinoRoutes(
  authed: FastifyInstance,
  deps: CasinoHttpDeps,
  sessionOf: SessionOf,
): void {
  const idem = new IdempotencyStore(deps.store, deps.clock);
  const claims = new RateLimiter({
    limit: deps.claimsPerMinute ?? 10,
    windowMs: 60_000,
    clock: deps.clock,
  }).start();
  authed.addHook('onClose', (_instance, done) => {
    claims.stop();
    done();
  });

  authed.get(CASINO_ROUTES.overview, (request): CasinoOverview => {
    const session = sessionOf(request);
    const core = deps.core();
    const recent = deps.store
      .stmt(
        `SELECT round_id, game, stake, payout, net, settled_at FROM game_rounds
         WHERE guild_id = ? AND user_id = ? AND status = 'settled'
         ORDER BY settled_at DESC, round_id DESC LIMIT 10`,
      )
      .all(session.gid, session.sub) as RoundRow[];
    return {
      minBet: CASINO_MIN_BET,
      jackpotPool: core.jackpotPool(session.gid),
      disabled: CASINO_GAME_IDS.filter((game) => !core.ports.isEnabled(session.gid, game)),
      recent: recent.map((r) => ({
        roundId: r.round_id,
        game: r.game,
        stake: r.stake,
        payout: r.payout,
        net: r.net,
        settledAt: r.settled_at,
      })),
    };
  });

  authed.get(CASINO_ROUTES.daily, (request): DailyStatus => {
    const session = sessionOf(request);
    const { claimable, nextSlotAt, streak } = deps
      .progression()
      .dailyStatus(session.gid, session.sub);
    return { claimable, nextSlotAt, streak };
  });

  authed.post(CASINO_ROUTES.dailyClaim, (request): DailyClaimResponse => {
    const session = sessionOf(request);
    if (!Value.Check(DailyClaimRequest, request.body)) throw new AppError('invalid_payload');
    const key = request.body.idempotencyKey;
    const who = { guildId: session.gid, userId: session.sub };
    const progression = deps.progression();
    // A repeat of a stored key is answered from the store before it counts against the limit.
    const hit = claims.hit(`${session.gid}:${session.sub}`);
    if (!hit.allowed) throw new AppError('rate_limited', { retryAfterMs: hit.retryAfterMs });
    const { response, replayed } = idem.run(who, key, 'http:daily:claim', {}, () => {
      const result = progression.claimDaily(session.gid, session.sub);
      if (!result.ok) throw new AppError('conflict');
      return {
        amount: result.amount,
        skimmed: result.skimmed,
        repaid: result.repaid,
        streak: result.streak,
        boosted: result.boosted,
        guarded: result.guarded,
      };
    });
    return {
      replayed,
      ...response,
      balance: deps.economy.getBalance(session.gid, session.sub),
      nextSlotAt: progression.dailyStatus(session.gid, session.sub).nextSlotAt,
    };
  });

  authed.get(CASINO_ROUTES.history, (request): HistoryPage => {
    const session = sessionOf(request);
    if (!Value.Check(HistoryQuery, request.query)) throw new AppError('invalid_payload');
    const { before, limit } = request.query;
    const page = deps.economy.historyPage(session.gid, session.sub, {
      ...(before === undefined ? {} : { before: Number(before) }),
      limit: limit === undefined ? HISTORY_PAGE_DEFAULT : Number(limit),
    });
    return {
      items: page.items.map((e) => ({
        id: e.id,
        delta: e.delta,
        balanceAfter: e.balanceAfter,
        reason: e.reason,
        refType: e.refType,
        createdAt: e.createdAt,
      })),
      nextBefore: page.nextBefore,
    };
  });
}
