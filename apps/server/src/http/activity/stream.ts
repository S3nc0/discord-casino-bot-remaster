import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Value } from 'typebox/value';
import type { Static, TSchema } from 'typebox';
import {
  STREAM_ROUTES,
  StreamBetRequest,
  StreamEndRequest,
  StreamOpenRequest,
  StreamRoundRequest,
  StreamSettleRequest,
  StreamStartRequest,
  StreamTipRequest,
  StreamViewQuery,
  type Clock,
  type StreamList,
  type StreamView,
} from '@casino/shared';
import type { SessionService } from '../../auth/sessions.ts';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import { AppError } from '../../runtime/errors.ts';
import { RateLimiter } from '../../runtime/rate-limit.ts';
import type { StreamService } from '../../stream/service.ts';
import { LifeKit, type Who } from './life-support.ts';

export interface StreamRouteDeps {
  sessions: SessionService;
  store: Store;
  economy: EconomyService;
  clock: Clock;
  stream: StreamService;
  /**
   * The voice channel the caller's Activity instance runs in, verified with Discord, or null.
   * Only `start` asks; nothing a client sends is used as the location.
   */
  locate?: (instanceId: string, guildId: string) => Promise<string | null>;
}

/** Tips and bets per user per minute (both together), on top of the general write limit. */
export const STREAM_MONEY_WRITES_PER_MINUTE = 30;
/** Every stream write per user per minute. */
export const STREAM_WRITES_PER_MINUTE = 60;

/**
 * Activity routes of the stream panel (`STREAM_ROUTES`, docs/spec/stream.md §12). The actor is
 * always the session's user and guild; the service runs every write once per idempotency key
 * (the chat bot calls the same service, so both clients replay the same way). Refusals are
 * `StreamError` bodies (`error`, `rule`, `params`).
 */
export function registerStreamRoutes(app: FastifyInstance, deps: StreamRouteDeps): void {
  const { stream } = deps;
  const kit = new LifeKit({
    sessions: deps.sessions,
    store: deps.store,
    economy: deps.economy,
    clock: deps.clock,
  });
  const writes = new RateLimiter({
    limit: STREAM_WRITES_PER_MINUTE,
    windowMs: 60_000,
    clock: deps.clock,
  }).start();
  const money = new RateLimiter({
    limit: STREAM_MONEY_WRITES_PER_MINUTE,
    windowMs: 60_000,
    clock: deps.clock,
  }).start();

  const hit = (limiter: RateLimiter, userId: string): void => {
    const r = limiter.hit(userId);
    if (!r.allowed) throw new AppError('rate_limited', { retryAfterMs: r.retryAfterMs });
  };
  /** Session user, rate limits, then the body checked against its closed schema. */
  const write = <S extends TSchema>(
    request: FastifyRequest,
    schema: S,
    isMoney = false,
  ): { who: Who; body: Static<S> } => {
    const who = kit.who(request);
    hit(writes, who.userId);
    if (isMoney) hit(money, who.userId);
    if (!Value.Check(schema, request.body)) throw new AppError('invalid_payload');
    return { who, body: request.body as Static<S> };
  };

  app.register((scope, _options, done) => {
    kit.install(scope);
    scope.addHook('onClose', (_instance, next) => {
      writes.stop();
      money.stop();
      next();
    });

    scope.get(STREAM_ROUTES.streams, (request): StreamList =>
      kit.read(request, (w) => stream.list(w)),
    );

    scope.get(STREAM_ROUTES.view, (request): StreamView => {
      // Query values arrive as strings; the contract's `streamId` is an integer.
      const raw = request.query as Record<string, unknown>;
      const query = { ...raw, streamId: Number(raw.streamId) };
      if (typeof raw.streamId !== 'string' || !/^\d{1,15}$/.test(raw.streamId)) {
        throw new AppError('invalid_payload');
      }
      if (!Value.Check(StreamViewQuery, query)) throw new AppError('invalid_payload');
      return kit.read(request, (w) => stream.view(w, query.streamId));
    });

    scope.post(STREAM_ROUTES.start, async (request) => {
      const { who, body } = write(request, StreamStartRequest);
      const session = kit.session(request);
      // Asked of Discord before the write: a slow or failing answer means no location.
      const channelId = deps.locate ? await deps.locate(session.iid, who.guildId) : null;
      return stream.start(who, {
        title: body.title,
        ...(body.url === undefined ? {} : { url: body.url }),
        channelId: null,
        location: channelId ? { channelId } : null,
        idempotencyKey: body.idempotencyKey,
      });
    });

    scope.post(STREAM_ROUTES.tip, (request) => {
      const { who, body } = write(request, StreamTipRequest, true);
      return stream.tip(who, body);
    });

    scope.post(STREAM_ROUTES.bet, (request) => {
      const { who, body } = write(request, StreamBetRequest, true);
      return stream.bet(who, body);
    });

    scope.post(STREAM_ROUTES.open, (request) => {
      const { who, body } = write(request, StreamOpenRequest);
      return stream.openRound(who, body);
    });

    scope.post(STREAM_ROUTES.lock, (request) => {
      const { who, body } = write(request, StreamRoundRequest);
      return stream.lock(who, body);
    });

    scope.post(STREAM_ROUTES.settle, (request) => {
      const { who, body } = write(request, StreamSettleRequest);
      return stream.settle(who, body);
    });

    scope.post(STREAM_ROUTES.void, (request) => {
      const { who, body } = write(request, StreamRoundRequest);
      return stream.voidRound(who, body);
    });

    scope.post(STREAM_ROUTES.end, (request) => {
      const { who, body } = write(request, StreamEndRequest);
      return stream.end(who, body);
    });

    done();
  });
}
