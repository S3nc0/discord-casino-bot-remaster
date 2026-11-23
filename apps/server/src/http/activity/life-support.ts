import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { Static } from 'typebox';
import type { Clock, LifeError, SessionClaims } from '@casino/shared';
import type { SessionService } from '../../auth/sessions.ts';
import { REASONS, sessionError } from '../../auth/reasons.ts';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import { IdempotencyStore } from '../../games/casino/idempotency.ts';
import { GameRuleError } from '../../games/progression/context.ts';
import { AppError } from '../../runtime/errors.ts';
import { RateLimiter } from '../../runtime/rate-limit.ts';

export interface LifeKitDeps {
  sessions: SessionService;
  store: Store;
  economy: EconomyService;
  clock: Clock;
}

/** The signed-in player of a request: the session token's user and guild, never the client's. */
export interface Who {
  guildId: string;
  userId: string;
}

const MINUTE = 60_000;
/** A click a second is 60 writes a minute; the rest of the screens are far slower. */
export const LIFE_WRITES_PER_MINUTE = 150;
export const LIFE_READS_PER_MINUTE = 300;

/**
 * Session auth, typed errors, rate limits and idempotent writes for the Activity routes of the
 * "life" slice. Registered inside its own Fastify scope so the error handler only changes these
 * routes (the generic API keeps its shape).
 */
export class LifeKit {
  private readonly deps: LifeKitDeps;
  private readonly idempotency: IdempotencyStore;
  private readonly writes: RateLimiter;
  private readonly reads: RateLimiter;

  constructor(deps: LifeKitDeps) {
    this.deps = deps;
    this.idempotency = new IdempotencyStore(deps.store, deps.clock);
    this.writes = new RateLimiter({
      limit: LIFE_WRITES_PER_MINUTE,
      windowMs: MINUTE,
      clock: deps.clock,
    }).start();
    this.reads = new RateLimiter({
      limit: LIFE_READS_PER_MINUTE,
      windowMs: MINUTE,
      clock: deps.clock,
    }).start();
  }

  /** Install auth, the error handler and the limiter cleanup on a plugin scope. */
  install(scope: FastifyInstance): void {
    scope.addHook('onRequest', (request, _reply, done) => {
      const header = request.headers.authorization;
      const match = /^Bearer (\S+)$/i.exec(typeof header === 'string' ? header : '');
      if (!match?.[1]) return done(new AppError('unauthorized', { reason: REASONS.bearerMissing }));
      const check = this.deps.sessions.verify(match[1]);
      if (!check.ok) {
        return done(sessionError(check.reason));
      }
      request.session = check.claims;
      return done();
    });
    scope.addHook('onClose', (_instance, done) => {
      this.writes.stop();
      this.reads.stop();
      done();
    });
    scope.setErrorHandler((error: FastifyError | AppError, request, reply) => {
      if (error instanceof AppError) {
        if (error.status === 401 || error.status === 403) {
          request.log.warn(
            { reason: error.authReason ?? error.code, errorCode: error.code, status: error.status },
            `auth rejected: ${error.authReason ?? error.code}`,
          );
        }
        const body: LifeError = {
          error: error.code,
          ...(error instanceof GameRuleError
            ? {
                rule: error.rule,
                ...(Object.keys(error.params).length > 0 ? { params: error.params } : {}),
              }
            : {}),
          ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        };
        if (error.retryAfterMs !== undefined) {
          void reply.header('retry-after', Math.max(1, Math.ceil(error.retryAfterMs / 1000)));
        }
        return reply.code(error.status).send(body);
      }
      const status = (error as FastifyError).statusCode;
      if (status !== undefined && status >= 400 && status < 500) {
        const code = status === 429 ? 'rate_limited' : 'invalid_payload';
        return reply.code(status).send({ error: code } satisfies LifeError);
      }
      request.log.error({ err: error }, 'unhandled error');
      return reply.code(500).send({ error: 'internal' } satisfies LifeError);
    });
  }

  session(request: FastifyRequest): SessionClaims {
    if (!request.session) throw new AppError('unauthorized');
    return request.session;
  }

  who(request: FastifyRequest): Who {
    const session = this.session(request);
    return { guildId: session.gid, userId: session.sub };
  }

  private limit(limiter: RateLimiter, userId: string): void {
    const result = limiter.hit(userId);
    if (!result.allowed) throw new AppError('rate_limited', { retryAfterMs: result.retryAfterMs });
  }

  /** A read: rate limited, user and guild from the token. */
  read<T>(request: FastifyRequest, fn: (who: Who) => T): T {
    const who = this.who(request);
    this.limit(this.reads, who.userId);
    return fn(who);
  }

  /** A read whose query string is checked against a schema first. */
  readQuery<S extends TSchema, T>(
    request: FastifyRequest,
    schema: S,
    fn: (who: Who, query: Static<S>) => T,
  ): T {
    return this.read(request, (who) => {
      if (!Value.Check(schema, request.query)) throw new AppError('invalid_payload');
      return fn(who, request.query as Static<S>);
    });
  }

  /**
   * A write: rate limited, body checked, run once per `idempotencyKey` inside one transaction
   * (a rule that refuses leaves nothing behind, so the player can retry with the same key).
   * `fn` returns the fields of the response; `replayed` and the current `balance` are added.
   */
  write<S extends TSchema & { properties: { idempotencyKey: unknown } }, R extends object>(
    request: FastifyRequest,
    scope: string,
    schema: S,
    fn: (who: Who, body: Static<S>) => R,
  ): R & { replayed: boolean; balance: number } {
    const who = this.who(request);
    this.limit(this.writes, who.userId);
    if (!Value.Check(schema, request.body)) throw new AppError('invalid_payload');
    const body = request.body as Static<S> & { idempotencyKey: string };
    const { response, replayed } = this.idempotency.run(who, body.idempotencyKey, scope, body, () =>
      fn(who, body),
    );
    return {
      ...response,
      replayed,
      balance: this.deps.economy.getBalance(who.guildId, who.userId),
    };
  }

  /** A read-only POST (a preview): rate limited and checked, nothing stored. */
  preview<S extends TSchema, T>(
    request: FastifyRequest,
    schema: S,
    fn: (who: Who, body: Static<S>) => T,
  ): T {
    const who = this.who(request);
    this.limit(this.reads, who.userId);
    if (!Value.Check(schema, request.body)) throw new AppError('invalid_payload');
    return fn(who, request.body as Static<S>);
  }
}
