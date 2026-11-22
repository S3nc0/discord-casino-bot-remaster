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
import {
  ProxySignatureObserver,
  checkProxySignature,
  decisionReason,
  type ProxySignatureState,
} from '../auth/proxy-policy.ts';
import { REASONS } from '../auth/reasons.ts';
import type { FinanceServices } from '../finance/index.ts';
import { GameRuleError } from '../games/progression/context.ts';
import { AppError } from '../runtime/errors.ts';
import { registerFinanceRoutes } from './activity/finance.ts';
import { registerActivityRoutes, type ActivityDeps } from './activity/index.ts';
import { RateLimiter } from '../runtime/rate-limit.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified session claims; set on authenticated routes only. */
    session: SessionClaims | null;
    /** What the proxy signature check found; set on every non-exempt `/api` request. */
    proxySignature: ProxySignatureState | null;
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
  /** Finance services; the Activity finance routes exist only when given. */
  finance?: FinanceServices;
  /** null disables the check (development only). */
  proxyVerifier: ProxySignatureVerifier | null;
  rateLimits?: RateLimits;
  /** Trust `X-Forwarded-For` (the server sits behind the tunnel on loopback). */
  trustProxy?: boolean;
  /** Put the auth reason code in 401/403 bodies. Off in production (the log always has it). */
  exposeReasons?: boolean;
  /** Refuse missing proxy signature headers (health and token excepted). */
  requireProxySignature?: boolean;
  /** Routes of the Activity slices (casino, ...); see `http/activity`. */
  activity?: ActivityDeps;
}

const HEALTH_PATH = API_ROUTES.health;
const TOKEN_PATH = API_ROUTES.token;

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** The URL path without the query string (which may carry anything). */
const routeOf = (request: FastifyRequest): string => request.url.split('?')[0] ?? '';

function sendError(reply: FastifyReply, error: AppError, exposeReasons = false): FastifyReply {
  const body: ApiError & { rule?: string; params?: Record<string, string | number> } = {
    error: error.code,
    // A game rule that said no: the screen shows its own text for `rule`.
    ...(error instanceof GameRuleError ? { rule: error.rule, params: error.params } : {}),
    ...(exposeReasons && error.authReason !== undefined ? { reason: error.authReason } : {}),
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
  app.decorateRequest('proxySignature', null);
  const observer = new ProxySignatureObserver(deps.logger);

  // Browsers and the SDK fetch wrapper send an empty body with or without a JSON content type.
  // An empty body parses as "no body" (routes treat that as {} where the contract allows);
  // anything else goes through the default parser, which also guards against prototype poisoning.
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (body === '' || body === undefined) return done(null, undefined);
    return parseJson(request, body as string, done);
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      // One warn line per auth refusal, with a stable reason and nothing secret.
      if (error.status === 401 || error.status === 403) {
        const reason = error.authReason ?? error.code;
        request.log.warn(
          {
            reason,
            errorCode: error.code,
            status: error.status,
            method: request.method,
            path: routeOf(request),
          },
          `auth rejected: ${reason}`,
        );
      }
      return sendError(reply, error, deps.exposeReasons);
    }
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

  // 1. Discord proxy signature. `health` and `token` are exempt: Discord does not sign the
  // pre-authenticate `token` call (observed), and that route checks the Discord code itself.
  // Elsewhere headers are verified when present; a request without any still needs our session
  // token, and `REQUIRE_PROXY_SIGNATURE` refuses it outright.
  app.addHook('onRequest', (request, _reply, done) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api') || path === HEALTH_PATH) return done();
    if (path !== TOKEN_PATH) {
      const decision = checkProxySignature(
        deps.proxyVerifier,
        {
          signature: header(request, PROXY_HEADERS.signature),
          timestamp: header(request, PROXY_HEADERS.timestamp),
          payload: header(request, PROXY_HEADERS.payload),
        },
        Math.floor(deps.clock.now() / 1000),
        deps.requireProxySignature ?? false,
      );
      if (!decision.ok) {
        // The error handler writes the warn line.
        return done(new AppError('unauthorized', { reason: decisionReason(decision) }));
      }
      request.proxySignature = decision.state;
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
      if (!match?.[1]) {
        return hookDone(new AppError('unauthorized', { reason: REASONS.bearerMissing }));
      }
      const check = deps.sessions.verify(match[1]);
      if (!check.ok) {
        const reason = {
          expired: REASONS.sessionExpired,
          revoked: REASONS.sessionRevoked,
          invalid: REASONS.sessionInvalid,
        }[check.reason];
        return hookDone(
          new AppError(check.reason === 'expired' ? 'expired' : 'unauthorized', { reason }),
        );
      }
      request.session = check.claims;
      if (request.proxySignature !== null) {
        observer.note(check.claims.jti, 'http', request.proxySignature);
      }
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

    // Activity slices register here, one line each.
    if (deps.finance)
      registerFinanceRoutes(authed, { ...deps, finance: deps.finance, session: sessionOf });
    registerActivityRoutes(authed, deps.activity ?? {}, sessionOf);

    done();
  });

  return app;
}
