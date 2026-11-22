import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Value } from 'typebox/value';
import type { Static, TSchema } from 'typebox';
import type { Clock, SessionClaims } from '@casino/shared';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import { IdempotencyStore } from '../../games/casino/idempotency.ts';
import type { NonCasinoGames } from '../../games/progression/register.ts';
import { AppError } from '../../runtime/errors.ts';
import { RateLimiter } from '../../runtime/rate-limit.ts';

/** The services the Activity screens call. `createServer` hands them over once they exist. */
export interface ActivityServices {
  games: NonCasinoGames;
  /** Game-day offset in hours (JST = 9). */
  offsetHours: number;
}

/** Writes per user per minute across every Activity screen (on top of the general limit). */
export const ACTIVITY_WRITES_PER_MINUTE = 60;

/**
 * What a screen's route file gets: the authenticated Fastify scope, the shared services, a
 * body validator that rejects unknown properties, and the write guard (session + rate limit).
 */
export interface ActivityKit {
  app: FastifyInstance;
  clock: Clock;
  store: Store;
  economy: EconomyService;
  readonly services: ActivityServices;
  idem: IdempotencyStore;
  /** The verified session; 401 when there is none. Use on reads. */
  session(request: FastifyRequest): SessionClaims;
  /** The verified session after the per-user write limit. Use on every write. */
  writer(request: FastifyRequest): SessionClaims;
  /** `request.body` as the schema's type, or `invalid_payload`. */
  body<T extends TSchema>(schema: T, request: FastifyRequest): Static<T>;
  /** `request.query` as the schema's type, or `invalid_payload`. */
  query<T extends TSchema>(schema: T, request: FastifyRequest): Static<T>;
}

export interface ActivityKitDeps {
  clock: Clock;
  store: Store;
  economy: EconomyService;
  /** Resolved per request: the games are built after the app. */
  services: () => ActivityServices;
}

export function createActivityKit(
  app: FastifyInstance,
  deps: ActivityKitDeps,
  session: (request: FastifyRequest) => SessionClaims,
): ActivityKit {
  const limiter = new RateLimiter({
    limit: ACTIVITY_WRITES_PER_MINUTE,
    windowMs: 60_000,
    clock: deps.clock,
  }).start();
  app.addHook('onClose', (_instance, done) => {
    limiter.stop();
    done();
  });
  return {
    app,
    clock: deps.clock,
    store: deps.store,
    economy: deps.economy,
    get services() {
      return deps.services();
    },
    idem: new IdempotencyStore(deps.store, deps.clock),
    session,
    writer(request) {
      const claims = session(request);
      const hit = limiter.hit(claims.sub);
      if (!hit.allowed) throw new AppError('rate_limited', { retryAfterMs: hit.retryAfterMs });
      return claims;
    },
    body(schema, request) {
      const body: unknown = request.body ?? {};
      if (!Value.Check(schema, body)) throw new AppError('invalid_payload');
      return body;
    },
    query(schema, request) {
      if (!Value.Check(schema, request.query)) throw new AppError('invalid_payload');
      return request.query;
    },
  };
}
