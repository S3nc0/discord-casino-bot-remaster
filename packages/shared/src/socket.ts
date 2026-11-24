import { Type, type Static } from 'typebox';
import { ErrorCode } from './errors.ts';
import {
  type EpochMs,
  GameId,
  InstanceId,
  Pelica,
  PelicaDelta,
  ScreenId,
  Snowflake,
  StreamId,
} from './ids.ts';
import { ActionIntent, BetIntent, RoundId, type IntentAck } from './intents.ts';
import type { DomainEvent } from './events.ts';
import type { InboxItem, Toast } from './notify.ts';
import { LedgerReason } from './ledger.ts';
import { PublicUser } from './auth.ts';
import type { StreamView } from './activity/stream.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * Socket.io contract. The client connects to `${origin}/api/socket.io` (through the Discord
 * proxy mapping for `/api`) with `transports: ['websocket']` and `auth: SocketAuth`.
 */
export const SOCKET_PATH = '/api/socket.io';

export interface SocketAuth {
  token: string;
}

/**
 * Stored on `socket.data` after the handshake token is verified. The server checks
 * `isSessionExpired` on every incoming event and disconnects at `expiresAt`, emitting
 * `session:error` `{ error: 'expired' }` first so the client re-authenticates silently and
 * reconnects with a fresh token.
 */
export interface SocketData {
  userId: string;
  guildId: string;
  instanceId: string;
  locale: Locale;
  /** Token expiry (`exp` claim) in epoch ms. */
  expiresAt: number;
  /** Token id (`jti` claim), so a session can be revoked. */
  jti: string;
}

export function isSessionExpired(data: Pick<SocketData, 'expiresAt'>, nowMs: number): boolean {
  return nowMs >= data.expiresAt;
}

export type Ack<T> = (response: AckResult<T>) => void;
export type AckResult<T> = { ok: true; data: T } | { ok: false; error: ErrorCode };

// ---- payloads (client → server payloads have schemas: the server validates every one) ----

const closed = { additionalProperties: false } as const;

export const TableJoin = Type.Object({ game: GameId }, closed);
export type TableJoin = Static<typeof TableJoin>;

export const TableLeave = Type.Object({ game: GameId }, closed);
export type TableLeave = Static<typeof TableLeave>;

/** Join or leave the room of one live stream of the token's guild (`rooms.stream`). */
export const StreamJoin = Type.Object({ streamId: StreamId }, closed);
export type StreamJoin = Static<typeof StreamJoin>;
export const StreamLeave = Type.Object({ streamId: StreamId }, closed);
export type StreamLeave = Static<typeof StreamLeave>;

export const PresenceScreen = Type.Object({ screen: ScreenId }, closed);
export type PresenceScreen = Static<typeof PresenceScreen>;

export const InboxRead = Type.Object(
  { ids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 100 }) },
  closed,
);
export type InboxRead = Static<typeof InboxRead>;

export const Seat = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  userId: Type.Union([Snowflake, Type.Null()]),
});

/** Full state of a shared table. `seq` grows with every change; clients drop older snapshots. */
export const TableSnapshot = Type.Object({
  guildId: Snowflake,
  instanceId: InstanceId,
  game: GameId,
  seq: Type.Integer({ minimum: 0 }),
  roundId: Type.Union([RoundId, Type.Null()]),
  phase: Type.String({ maxLength: 32 }),
  seats: Type.Array(Seat),
  /** Game-specific public state (never hidden information such as the dealer's hole card). */
  data: Type.Unknown(),
});
export type TableSnapshot = Static<typeof TableSnapshot>;

export const BalanceUpdate = Type.Object({
  guildId: Snowflake,
  userId: Snowflake,
  balance: Pelica,
  delta: PelicaDelta,
  reason: LedgerReason,
  ledgerId: Type.Integer({ minimum: 1 }),
});
export type BalanceUpdate = Static<typeof BalanceUpdate>;

/**
 * Who is in an Activity instance. Sent to `instance:{instanceId}` as the full list (not a diff)
 * whenever a socket of that instance connects or the last socket of a user disconnects, and to
 * a new socket right after it joins. Ordered by join time.
 */
export const Participants = Type.Object({
  guildId: Snowflake,
  instanceId: InstanceId,
  users: Type.Array(PublicUser),
});
export type Participants = Static<typeof Participants>;

/** Unread inbox count of one guild, sent to `user:{id}` after any read or new item. */
export const InboxUnread = Type.Object({
  guildId: Snowflake,
  unread: Type.Integer({ minimum: 0 }),
});
export type InboxUnread = Static<typeof InboxUnread>;

export const SessionError = Type.Object({ error: ErrorCode });
export type SessionError = Static<typeof SessionError>;

// ---- event maps (for `new Server<ClientToServerEvents, ServerToClientEvents, ...>`) ----

export interface ClientToServerEvents {
  'table:join': (payload: TableJoin, ack: Ack<TableSnapshot>) => void;
  'table:leave': (payload: TableLeave) => void;
  'game:bet': (intent: BetIntent, ack: (result: IntentAck) => void) => void;
  'game:action': (intent: ActionIntent, ack: (result: IntentAck) => void) => void;
  'presence:screen': (payload: PresenceScreen) => void;
  /** Ack carries the stream view for this user; refused unless the stream is live in the guild. */
  'stream:join': (payload: StreamJoin, ack: Ack<StreamView>) => void;
  'stream:leave': (payload: StreamLeave) => void;
  'inbox:read': (payload: InboxRead, ack: Ack<{ unread: number }>) => void;
  /** Round-trip probe; the server answers with its clock (epoch ms). */
  'time:ping': (ack: (serverNow: EpochMs) => void) => void;
}

export interface ServerToClientEvents {
  'domain:event': (event: DomainEvent) => void;
  'balance:update': (update: BalanceUpdate) => void;
  'table:state': (snapshot: TableSnapshot) => void;
  'instance:participants': (participants: Participants) => void;
  /** A new inbox item (to `user:{id}`; filter on `guildId`). Followed by `inbox:unread`. */
  'inbox:new': (item: InboxItem) => void;
  'inbox:unread': (payload: InboxUnread) => void;
  toast: (toast: Toast) => void;
  'session:error': (error: SessionError) => void;
}

/** Single process: no adapter, so no inter-server events. */
export type InterServerEvents = Record<string, never>;

/** Schema for each client → server payload, keyed by event name. */
export const CLIENT_PAYLOADS = {
  'table:join': TableJoin,
  'table:leave': TableLeave,
  'game:bet': BetIntent,
  'game:action': ActionIntent,
  'presence:screen': PresenceScreen,
  'inbox:read': InboxRead,
  'stream:join': StreamJoin,
  'stream:leave': StreamLeave,
} as const satisfies Partial<Record<keyof ClientToServerEvents, unknown>>;
