import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  PROXY_HEADERS,
  PublicUser,
  Snowflake,
  LocaleSchema,
  TokenRequest,
  EpochMs,
  Pelica,
  InstanceId,
  type ApiError,
  type Clock,
  type LaunchIntentService,
  type ProxySignatureVerifier,
  type SessionClaims,
} from '@casino/shared';
import type { SessionService } from '../auth/sessions.ts';
import type { TokenFlow } from '../auth/token-flow.ts';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import { AppError } from '../runtime/errors.ts';
import { RateLimiter } from '../runtime/rate-limit.ts';

/** Response of `GET /api/me`. Not in the shared contract yet (see the task report). */
export const MeResponse = Type.Object({
  user: PublicUser,
  guildId: Snowflake,
  instanceId: InstanceId,
  locale: LocaleSchema,
  balance: Pelica,
  expiresAt: EpochMs,
});

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified session claims; set on authenticated routes only. */
    session: SessionClaims | null;
  }
}

export interface RateLimits {
  /** Requests per IP per minute on every `/api` route. */
  ipPerMinute: number;
  /** Requests per IP per minute on `POST /api/token` (each one costs Discord calls). */
  tokenPerMinute: number;
  /** Requests per user per minute on authenticated routes. */
  userPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  ipPerMinute: 600,
  tokenPerMinute: 30,
  userPerMinute: 240,
};

export interface AppDeps {
  logger: FastifyBaseLogger;
  clock: Clock;
  store: Store;
  identity: IdentityRepo;
  economy: EconomyService;
  sessions: SessionService;
  tokenFlow: TokenFlow;
  launchIntents: LaunchIntentService;
  /** null disables the check (development only). */
  proxyVerifier: ProxySignatureVerifier | null;
  rateLimits?: RateLimits;
  /** Trust `X-Forwarded-For` (the server sits behind the tunnel on loopback). */
  trustProxy?: boolean;
}

const HEALTH_PATH = '/api/health';

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function sendError(reply: FastifyReply, error: AppError): FastifyReply {
  const body: ApiError = {
    error: error.code,
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
  };
  if (error.retryAfterMs !== undefined) {
    void reply.header('retry-after', Math.max(1, Math.ceil(error.retryAfterMs / 1000)));
  }
  return reply.code(error.status).send(body);
}

function limitHit(limiter: RateLimiter, key: string): void {
  const result = limiter.hit(key);
  if (!result.allowed) throw new AppError('rate_limited', { retryAfterMs: result.retryAfterMs });
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const limits = deps.rateLimits ?? DEFAULT_RATE_LIMITS;
  const minute = 60_000;
  const ipLimiter = new RateLimiter({
    limit: limits.ipPerMinute,
    windowMs: minute,
    clock: deps.clock,
  }).start();
  const tokenLimiter = new RateLimiter({
    limit: limits.tokenPerMinute,
    windowMs: minute,
    clock: deps.clock,
  }).start();
  const userLimiter = new RateLimiter({
    limit: limits.userPerMinute,
    windowMs: minute,
    clock: deps.clock,
  }).start();

  const app = Fastify({
    loggerInstance: deps.logger,
    trustProxy: deps.trustProxy ?? false,
    bodyLimit: 16 * 1024,
  });
  app.decorateRequest('session', null);

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) return sendError(reply, error);
    const status = (error as FastifyError).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      // Malformed JSON, wrong content type, oversized body: the client's mistake.
      return sendError(
        reply,
        new AppError(status === 429 ? 'rate_limited' : 'invalid_payload', { status }),
      );
    }
    request.log.error({ err: error }, 'unhandled error');
    return sendError(reply, new AppError('internal'));
  });
  app.setNotFoundHandler((_request, reply) => sendError(reply, new AppError('not_found')));

  // 1. Discord proxy signature (fails closed unless the verifier is switched off for dev).
  app.addHook('onRequest', (request, _reply, done) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api') || path === HEALTH_PATH) return done();
    const verifier = deps.proxyVerifier;
    if (verifier) {
      const result = verifier.verify(
        {
          signature: header(request, PROXY_HEADERS.signature),
          timestamp: header(request, PROXY_HEADERS.timestamp),
          payload: header(request, PROXY_HEADERS.payload),
        },
        Math.floor(deps.clock.now() / 1000),
      );
      if (!result.ok) {
        request.log.warn({ reason: result.reason }, 'proxy signature rejected');
        return done(new AppError('unauthorized'));
      }
    }
    // 2. Per-IP limit, after the signature so unsigned noise costs nothing but a check.
    try {
      limitHit(ipLimiter, request.ip);
    } catch (error) {
      return done(error as Error);
    }
    return done();
  });

  app.addHook('onClose', (_instance, done) => {
    ipLimiter.stop();
    tokenLimiter.stop();
    userLimiter.stop();
    done();
  });

  app.get(HEALTH_PATH, (_request, reply) => {
    try {
      deps.store.stmt('SELECT 1').get();
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
    return { status: 'ok', db: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  });

  app.post('/api/token', async (request) => {
    limitHit(tokenLimiter, request.ip);
    if (!Value.Check(TokenRequest, request.body)) throw new AppError('invalid_payload');
    return deps.tokenFlow.exchange(request.body);
  });

  // Everything below needs a valid, unrevoked, unexpired session token.
  app.register((authed, _options, done) => {
    authed.addHook('onRequest', (request, _reply, hookDone) => {
      const match = /^Bearer (\S+)$/i.exec(header(request, 'authorization') ?? '');
      if (!match?.[1]) return hookDone(new AppError('unauthorized'));
      const check = deps.sessions.verify(match[1]);
      if (!check.ok) {
        return hookDone(new AppError(check.reason === 'expired' ? 'expired' : 'unauthorized'));
      }
      request.session = check.claims;
      try {
        limitHit(userLimiter, check.claims.sub);
      } catch (error) {
        return hookDone(error as Error);
      }
      return hookDone();
    });

    authed.get('/api/me', (request) => {
      const session = request.session;
      if (!session) throw new AppError('unauthorized');
      const user = deps.identity.getUser(session.sub);
      if (!user) throw new AppError('not_found');
      return {
        user: {
          id: user.userId,
          username: user.username,
          globalName: user.globalName,
          avatar: user.avatar,
        },
        guildId: session.gid,
        instanceId: session.iid,
        locale: session.loc,
        balance: deps.economy.getBalance(session.gid, session.sub),
        expiresAt: session.exp * 1000,
      };
    });

    // The Activity consumes its own pending intent (one that arrived after the token call).
    authed.post('/api/launch-intent/consume', (request) => {
      const session = request.session;
      if (!session) throw new AppError('unauthorized');
      return { launchIntent: deps.launchIntents.consume(session.sub, session.gid) };
    });

    done();
  });

  return app;
}
