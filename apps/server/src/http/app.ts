import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { Value } from 'typebox/value';
import {
  API_ROUTES,
  InboxQuery,
  InboxReadRequest,
  LaunchIntentConsumeRequest,
  PROXY_HEADERS,
  SettingsUpdateRequest,
  TokenRequest,
  type ApiError,
  type Clock,
  type InboxReadResponse,
  type LaunchIntentConsumeResponse,
  type LaunchIntentService,
  type MeResponse,
  type ProxySignatureVerifier,
  type SessionClaims,
  type SettingsResponse,
} from '@casino/shared';
import type { SessionService } from '../auth/sessions.ts';
import type { TokenFlow } from '../auth/token-flow.ts';
import type { InboxService } from '../db/inbox.ts';
import type { IdentityRepo } from '../db/identity.ts';
import type { SettingsRepo } from '../db/settings.ts';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import { AppError } from '../runtime/errors.ts';
import { RateLimiter } from '../runtime/rate-limit.ts';

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
  settings: SettingsRepo;
  inbox: InboxService;
  sessions: SessionService;
  tokenFlow: TokenFlow;
  launchIntents: LaunchIntentService;
  /** null disables the check (development only). */
  proxyVerifier: ProxySignatureVerifier | null;
  rateLimits?: RateLimits;
  /** Trust `X-Forwarded-For` (the server sits behind the tunnel on loopback). */
  trustProxy?: boolean;
}

const HEALTH_PATH = API_ROUTES.health;

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

  app.post(API_ROUTES.token, async (request) => {
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

    const sessionOf = (request: FastifyRequest): SessionClaims => {
      if (!request.session) throw new AppError('unauthorized');
      return request.session;
    };

    authed.get(API_ROUTES.me, (request): MeResponse => {
      const session = sessionOf(request);
      const user = deps.identity.getUser(session.sub);
      if (!user) throw new AppError('not_found');
      return {
        user: {
          id: user.userId,
          username: user.username,
          globalName: user.globalName,
          avatar: user.avatar,
        },
        guild: { id: session.gid, name: deps.identity.getGuildName(session.gid) },
        instanceId: session.iid,
        balance: deps.economy.getBalance(session.gid, session.sub),
        locale: session.loc,
        localeHints: {
          setting: deps.settings.get(session.sub).language,
          guild: deps.identity.getGuildLocale(session.gid),
        },
        expiresAt: session.exp * 1000,
      };
    });

    // Settings are global per user; the whole document is replaced.
    authed.get(API_ROUTES.settings, (request): SettingsResponse => {
      return deps.settings.get(sessionOf(request).sub);
    });

    authed.put(API_ROUTES.settings, (request): SettingsResponse => {
      const session = sessionOf(request);
      if (!Value.Check(SettingsUpdateRequest, request.body)) throw new AppError('invalid_payload');
      return deps.settings.put(session.sub, request.body);
    });

    authed.get(API_ROUTES.inbox, (request) => {
      const session = sessionOf(request);
      if (!Value.Check(InboxQuery, request.query)) throw new AppError('invalid_payload');
      const { before, limit, unread } = request.query;
      return deps.inbox.page(session.sub, session.gid, {
        ...(before === undefined ? {} : { before: Number(before) }),
        ...(limit === undefined ? {} : { limit: Number(limit) }),
        unreadOnly: unread === '1',
      });
    });

    authed.post(API_ROUTES.inboxRead, (request): InboxReadResponse => {
      const session = sessionOf(request);
      if (!Value.Check(InboxReadRequest, request.body)) throw new AppError('invalid_payload');
      return { unread: deps.inbox.markRead(session.sub, session.gid, request.body) };
    });

    // The Activity consumes its own pending intent (one that arrived after the token call).
    authed.post(API_ROUTES.launchIntentConsume, (request): LaunchIntentConsumeResponse => {
      const session = sessionOf(request);
      const body: unknown = request.body ?? {};
      if (!Value.Check(LaunchIntentConsumeRequest, body)) throw new AppError('invalid_payload');
      return { launchIntent: deps.launchIntents.consume(session.sub, session.gid) };
    });

    done();
  });

  return app;
}
