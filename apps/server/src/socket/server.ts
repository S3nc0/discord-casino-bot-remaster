import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  CLIENT_PAYLOADS,
  PROXY_HEADERS,
  SOCKET_PATH,
  canJoinRoom,
  isSessionExpired,
  rooms,
  type ActionIntent,
  type BetIntent,
  type Clock,
  type ClientToServerEvents,
  type ErrorCode,
  type GameId,
  type InterServerEvents,
  type IntentAck,
  type Participants,
  type PresenceScreen,
  type ProxySignatureVerifier,
  type RoomScope,
  type ServerToClientEvents,
  type SocketData,
  type TableSnapshot,
} from '@casino/shared';
import type { Logger } from 'pino';
import {
  ProxySignatureObserver,
  checkProxySignature,
  decisionReason,
  type ProxySignatureState,
} from '../auth/proxy-policy.ts';
import { REASONS, SESSION_FAILURE_REASON } from '../auth/reasons.ts';
import type { SessionService } from '../auth/sessions.ts';
import type { IdentityRepo } from '../db/identity.ts';
import type { InboxService } from '../db/inbox.ts';
import type { EventBus } from '../runtime/bus.ts';
import { RateLimiter } from '../runtime/rate-limit.ts';
import { audienceOf } from './domain-audience.ts';

export type CasinoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type CasinoSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * Game and inbox logic lives in other services. They plug in through these hooks; a hook that
 * is not provided answers `feature_disabled` instead of silently doing nothing.
 */
export interface SocketHandlers {
  /** Current snapshot of the shared table, or null when that game has no table. */
  tableSnapshot?(scope: RoomScope, game: GameId): TableSnapshot | null;
  bet?(scope: RoomScope, intent: BetIntent): Promise<IntentAck> | IntentAck;
  action?(scope: RoomScope, intent: ActionIntent): Promise<IntentAck> | IntentAck;
  presence?(scope: RoomScope, payload: PresenceScreen): void;
}

export interface SocketServerOptions {
  httpServer: HttpServer;
  sessions: SessionService;
  bus: EventBus;
  identity: IdentityRepo;
  inbox: InboxService;
  clock: Clock;
  logger: Logger;
  /** null disables the upgrade signature check (development only). */
  proxyVerifier: ProxySignatureVerifier | null;
  /** Refuse an upgrade without proxy signature headers. */
  requireProxySignature?: boolean;
  handlers?: SocketHandlers;
  /** Events per socket per 10 s before they are dropped with `rate_limited`. */
  eventsPer10s?: number;
}

export interface SocketServer {
  io: CasinoServer;
  /** Tear down the sockets (the HTTP server is closed by its owner). */
  close(): Promise<void>;
}

const scopeOf = (data: SocketData): RoomScope => ({
  userId: data.userId,
  guildId: data.guildId,
  instanceId: data.instanceId,
});

/**
 * Answer an event's ack. A client may emit without an ack callback (the schema cannot require
 * one), and an ack that throws inside an async handler is an unhandled rejection.
 */
function reply<T>(ack: unknown, payload: T): void {
  if (typeof ack !== 'function') return;
  try {
    (ack as (p: T) => void)(payload);
  } catch {
    // The client went away between the work and the answer; nothing is left to tell it.
  }
}

function rejection(code: ErrorCode): Error & { data: { error: ErrorCode } } {
  return Object.assign(new Error(code), { data: { error: code } });
}

/**
 * Join `room` only if the session is allowed there. Every join in this file goes through here.
 * Returns whether the socket joined.
 */
export function joinScoped(socket: CasinoSocket, room: string): boolean {
  if (!canJoinRoom(scopeOf(socket.data), room)) return false;
  void socket.join(room);
  return true;
}

/**
 * Who is connected to each Activity instance, ordered by when each user first connected.
 * A user with several sockets (two tabs, a reconnect overlap) appears once and leaves with
 * their last socket.
 */
class InstanceParticipants {
  private readonly identity: IdentityRepo;
  private readonly instances = new Map<string, Map<string, Set<string>>>();

  constructor(identity: IdentityRepo) {
    this.identity = identity;
  }

  add(scope: RoomScope, socketId: string): void {
    let users = this.instances.get(scope.instanceId);
    if (!users) this.instances.set(scope.instanceId, (users = new Map()));
    let sockets = users.get(scope.userId);
    if (!sockets) users.set(scope.userId, (sockets = new Set()));
    sockets.add(socketId);
  }

  /** Returns true when this was the user's last socket in the instance. */
  remove(scope: RoomScope, socketId: string): boolean {
    const users = this.instances.get(scope.instanceId);
    const sockets = users?.get(scope.userId);
    if (!users || !sockets) return false;
    sockets.delete(socketId);
    if (sockets.size > 0) return false;
    users.delete(scope.userId);
    if (users.size === 0) this.instances.delete(scope.instanceId);
    return true;
  }

  snapshot(scope: RoomScope): Participants {
    const ids = [...(this.instances.get(scope.instanceId)?.keys() ?? [])];
    return {
      guildId: scope.guildId,
      instanceId: scope.instanceId,
      users: ids.map((id) => {
        const user = this.identity.getUser(id);
        return {
          id,
          username: user?.username ?? '',
          globalName: user?.globalName ?? null,
          avatar: user?.avatar ?? null,
        };
      }),
    };
  }
}

export function attachSocketServer(options: SocketServerOptions): SocketServer {
  const { sessions, bus, clock, logger } = options;
  const { identity, inbox } = options;
  const handlers = options.handlers ?? {};
  const participants = new InstanceParticipants(identity);
  const eventLimiter = new RateLimiter({
    limit: options.eventsPer10s ?? 100,
    windowMs: 10_000,
    clock,
  }).start();

  const observer = new ProxySignatureObserver(logger);
  /** What `allowRequest` found, by upgrade request (the handshake sees the same object). */
  const proxyStates = new WeakMap<object, ProxySignatureState>();

  const io: CasinoServer = new Server(options.httpServer, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    perMessageDeflate: false,
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    // Same policy as HTTP: signature headers are verified when present, and refused when absent
    // only with REQUIRE_PROXY_SIGNATURE. The handshake still needs our session token.
    allowRequest(request, callback) {
      const pick = (name: string): string | undefined => {
        const value = request.headers[name];
        return typeof value === 'string' ? value : undefined;
      };
      const decision = checkProxySignature(
        options.proxyVerifier,
        {
          signature: pick(PROXY_HEADERS.signature),
          timestamp: pick(PROXY_HEADERS.timestamp),
          payload: pick(PROXY_HEADERS.payload),
        },
        Math.floor(clock.now() / 1000),
        options.requireProxySignature ?? false,
      );
      if (!decision.ok) {
        const reason = decisionReason(decision);
        logger.warn({ reason, transport: 'socket' }, `auth rejected: ${reason}`);
        return callback(null, false);
      }
      proxyStates.set(request, decision.state);
      return callback(null, true);
    },
  });

  // Handshake: a valid, unexpired, unrevoked session token.
  io.use((socket, next) => {
    const auth: unknown = socket.handshake.auth;
    const token =
      typeof auth === 'object' && auth !== null ? (auth as { token?: unknown }).token : undefined;
    if (typeof token !== 'string' || token.length === 0) {
      logger.warn(
        { reason: REASONS.socketAuthFailed, detail: REASONS.bearerMissing, transport: 'socket' },
        `auth rejected: ${REASONS.socketAuthFailed}`,
      );
      return next(rejection('unauthorized'));
    }
    const check = sessions.verify(token);
    if (!check.ok) {
      const detail = SESSION_FAILURE_REASON[check.reason];
      logger.warn(
        { reason: REASONS.socketAuthFailed, detail, transport: 'socket' },
        `auth rejected: ${REASONS.socketAuthFailed}`,
      );
      return next(
        rejection(
          check.reason === 'expired'
            ? 'expired'
            : check.reason === 'guild_denied'
              ? 'guild_not_allowed'
              : 'unauthorized',
        ),
      );
    }
    const claims = check.claims;
    socket.data.userId = claims.sub;
    socket.data.guildId = claims.gid;
    socket.data.instanceId = claims.iid;
    socket.data.locale = claims.loc;
    socket.data.expiresAt = claims.exp * 1000;
    socket.data.jti = claims.jti;
    observer.note(claims.jti, 'socket', proxyStates.get(socket.request) ?? 'absent');
    return next();
  });

  const expire = (socket: CasinoSocket): void => {
    logger.warn(
      { reason: REASONS.sessionExpired, transport: 'socket' },
      `auth rejected: ${REASONS.sessionExpired}`,
    );
    socket.emit('session:error', { error: 'expired' });
    socket.disconnect(true);
  };

  const denyGuild = (socket: CasinoSocket): void => {
    logger.warn(
      { reason: REASONS.guildDenied, transport: 'socket' },
      `auth rejected: ${REASONS.guildDenied}`,
    );
    socket.emit('session:error', { error: 'guild_not_allowed' });
    socket.disconnect(true);
  };

  io.on('connection', (socket) => {
    const scope = scopeOf(socket.data);
    for (const room of [
      rooms.guild(scope.guildId),
      rooms.instance(scope.instanceId),
      rooms.user(scope.userId),
    ]) {
      joinScoped(socket, room);
    }

    // Everyone in the instance (the new socket included) gets the full list.
    participants.add(scope, socket.id);
    io.to(rooms.instance(scope.instanceId)).emit(
      'instance:participants',
      participants.snapshot(scope),
    );
    socket.on('disconnect', () => {
      if (!participants.remove(scope, socket.id)) return;
      io.to(rooms.instance(scope.instanceId)).emit(
        'instance:participants',
        participants.snapshot(scope),
      );
    });

    // Disconnect at the token's expiry even if the client stays quiet.
    const remaining = Math.max(0, socket.data.expiresAt - clock.now());
    const timer = setTimeout(() => expire(socket), remaining);
    timer.unref();
    socket.on('disconnect', () => clearTimeout(timer));

    // Runs before every handler: expiry, per-socket rate limit, payload schema.
    socket.use((packet, next) => {
      if (isSessionExpired(socket.data, clock.now())) {
        expire(socket);
        return;
      }
      // The owner may have denied the guild since the handshake.
      if (sessions.guildDenied(socket.data.guildId)) {
        denyGuild(socket);
        return;
      }
      const [event, ...args] = packet as [string, ...unknown[]];
      const ack =
        typeof args[args.length - 1] === 'function'
          ? (args.pop() as (r: unknown) => void)
          : undefined;
      const refuse = (code: ErrorCode): void => {
        if (!ack) return;
        // Intent acks have their own shape; everything else uses AckResult.
        if (event === 'game:bet' || event === 'game:action') {
          ack({ ok: false, idempotencyKey: null, error: code });
        } else {
          ack({ ok: false, error: code });
        }
      };
      if (!eventLimiter.hit(socket.id).allowed) return refuse('rate_limited');
      const schema = (CLIENT_PAYLOADS as unknown as Record<string, TSchema | undefined>)[event];
      if (schema && !Value.Check(schema, args[0])) return refuse('invalid_payload');
      next();
    });
    socket.on('disconnect', () => eventLimiter.forget(socket.id));

    socket.on('time:ping', (ack) => {
      if (typeof ack === 'function') ack(clock.now());
    });

    socket.on('table:join', (payload, ack) => {
      const snapshot = handlers.tableSnapshot?.(scope, payload.game);
      if (!handlers.tableSnapshot) return reply(ack, { ok: false, error: 'feature_disabled' });
      if (!snapshot) return reply(ack, { ok: false, error: 'not_found' });
      // The room name is built from the token's instance, never from client input.
      if (!joinScoped(socket, rooms.table(scope.instanceId, payload.game))) {
        return reply(ack, { ok: false, error: 'forbidden' });
      }
      return reply(ack, { ok: true, data: snapshot });
    });

    socket.on('table:leave', (payload) => {
      void socket.leave(rooms.table(scope.instanceId, payload.game));
    });

    socket.on('game:bet', async (intent, ack) => {
      if (!handlers.bet) {
        return reply(ack, {
          ok: false,
          idempotencyKey: intent.idempotencyKey,
          error: 'feature_disabled',
        });
      }
      try {
        reply(ack, await handlers.bet(scope, intent));
      } catch (error) {
        logger.error({ err: error }, 'bet handler failed');
        reply(ack, { ok: false, idempotencyKey: intent.idempotencyKey, error: 'internal' });
      }
    });

    socket.on('game:action', async (intent, ack) => {
      if (!handlers.action) {
        return reply(ack, {
          ok: false,
          idempotencyKey: intent.idempotencyKey,
          error: 'feature_disabled',
        });
      }
      try {
        reply(ack, await handlers.action(scope, intent));
      } catch (error) {
        logger.error({ err: error }, 'action handler failed');
        reply(ack, { ok: false, idempotencyKey: intent.idempotencyKey, error: 'internal' });
      }
    });

    socket.on('presence:screen', (payload) => {
      handlers.presence?.(scope, payload);
    });

    // Same effect as POST /api/inbox/read; the unread count also reaches the user's other
    // sockets as `inbox:unread`.
    socket.on('inbox:read', (payload, ack) => {
      try {
        const unread = inbox.markRead(scope.userId, scope.guildId, payload);
        reply(ack, { ok: true, data: { unread } });
      } catch (error) {
        logger.error({ err: error }, 'inbox read failed');
        reply(ack, { ok: false, error: 'internal' });
      }
    });
  });

  // A revoked session loses its sockets at once.
  const offRevoke = sessions.onRevoke((jti) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.jti === jti) socket.disconnect(true);
    }
  });

  // A revoked guild loses its sockets at once.
  const offRevokeGuild = sessions.onRevokeGuild((guildId) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.guildId === guildId) denyGuild(socket);
    }
  });

  // Fan-out of committed events to rooms.
  // Guild-public events go to the guild room; everything else only to the sockets of the users
  // it names, and only the ones signed in to that guild (a user room spans guilds).
  const offDomain = bus.onAnyDomain((event) => {
    const audience = audienceOf(event);
    if (audience.scope === 'guild') {
      io.to(rooms.guild(event.guildId)).emit('domain:event', event);
      return;
    }
    for (const userId of audience.userIds) {
      for (const id of io.sockets.adapter.rooms.get(rooms.user(userId)) ?? []) {
        const target = io.sockets.sockets.get(id);
        if (target?.data.guildId === event.guildId) target.emit('domain:event', event);
      }
    }
  });
  const offBalance = bus.onBalance((update) => {
    io.to(rooms.user(update.userId)).emit('balance:update', update);
  });
  const offUnread = bus.onInboxUnread(({ userId, guildId, unread }) => {
    io.to(rooms.user(userId)).emit('inbox:unread', { guildId, unread });
  });

  return {
    io,
    async close() {
      offRevoke();
      offRevokeGuild();
      offDomain();
      offBalance();
      offUnread();
      eventLimiter.stop();
      io.local.disconnectSockets(true);
      await io.close();
    },
  };
}
