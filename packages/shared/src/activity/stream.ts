import { Type, type Static, type TProperties } from 'typebox';
import { ErrorCode } from '../errors.ts';
import { EpochMs, Pelica, Snowflake, StreamId, StreamRoundId } from '../ids.ts';
import { IdempotencyKey } from '../intents.ts';
import {
  STREAM_LIMITS,
  StreamRoundStatus,
  StreamSettleResult,
  StreamSide,
  StreamStatus,
} from '../stream.ts';

/**
 * Activity contracts of the stream panel (docs/spec/stream.md). Every route is under `/api`, needs
 * the session token and acts only on the token's own user and guild: the streamer is always the
 * session user, never a field of the body. Writes carry an `idempotencyKey`; the server stores the
 * first response per key and replays it (`replayed: true`). The chat bot calls the same service.
 *
 * Money: a tip is a transfer to the streamer (`transfer_out` / `transfer_in` / `transfer_fee`,
 * `ref_type = 'stream'`, shares the daily transfer cap), a bet escrows the stake as `stream_bet`,
 * a settle pays `stream_payout`, a void or one-sided round pays `stream_refund`.
 */
export const STREAM_ROUTES = {
  /** GET → `StreamList`: the live streams of the guild. */
  streams: '/api/stream',
  /** GET (query `StreamViewQuery`) → `StreamView`. */
  view: '/api/stream/view',
  /** POST `StreamStartRequest` → `StreamStartResponse`. */
  start: '/api/stream/start',
  /** POST `StreamTipRequest` → `StreamTipResponse`. */
  tip: '/api/stream/tip',
  /** POST `StreamBetRequest` → `StreamBetResponse`. */
  bet: '/api/stream/bet',
  /** POST `StreamOpenRequest` → `StreamWriteResponse` (streamer only). */
  open: '/api/stream/round/open',
  /** POST `StreamRoundRequest` → `StreamWriteResponse` (streamer only). */
  lock: '/api/stream/round/lock',
  /** POST `StreamSettleRequest` → `StreamSettleResponse` (streamer only, round must be locked). */
  settle: '/api/stream/round/settle',
  /** POST `StreamRoundRequest` → `StreamSettleResponse` (streamer only; allowed while open or locked). */
  void: '/api/stream/round/void',
  /** POST `StreamEndRequest` → `StreamEndResponse` (streamer only). */
  end: '/api/stream/end',
} as const;
export type StreamRoute = (typeof STREAM_ROUTES)[keyof typeof STREAM_ROUTES];

const closed = { additionalProperties: false } as const;
const keyed = { idempotencyKey: IdempotencyKey } as const;
const count = Type.Integer({ minimum: 0 });
const Name = Type.String({ maxLength: 80 });
const Avatar = Type.Union([Type.String({ maxLength: 64 }), Type.Null()]);

/**
 * Body of a refused stream request: the `ApiError` fields plus the stream rule that said no
 * (`screen.stream.rule.<rule>`; transfer rules keep `screen.life.rule.<rule>`). `params` fill the
 * message, e.g. `{ min: 100 }`, `{ max: 10000, already: 6000 }`.
 */
export const StreamError = Type.Object({
  error: ErrorCode,
  /** A `StreamRule`, or a transfer rule name (`transfer_min_games`, ...) for the shared money checks. */
  rule: Type.Optional(Type.String({ maxLength: 64 })),
  params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type StreamError = Static<typeof StreamError>;

// ---- views ----

/** Where the stream happens, when the server knows. */
export const StreamLocation = Type.Object({
  /** A voice channel of the guild. */
  channelId: Snowflake,
  /** Only `activity` exists: the voice channel the streamer's Activity instance runs in. */
  source: Type.Literal('activity'),
});
export type StreamLocation = Static<typeof StreamLocation>;

/** The round that is not settled yet (`open` or `locked`). */
export const StreamRoundView = Type.Object({
  id: StreamRoundId,
  label: Type.String({ maxLength: 60 }),
  status: Type.Enum(['open', 'locked'] as const),
  openedAt: EpochMs,
  /** When bets close by themselves (`openedAt + roundAutoLockMs`); the streamer can lock earlier. */
  autoLockAt: EpochMs,
  lockedAt: Type.Union([EpochMs, Type.Null()]),
  winTotal: Pelica,
  loseTotal: Pelica,
  bettors: count,
  /**
   * Indicative odds in basis points of the stake (`STREAM_ODDS_ONE` = x1.00), or null while a side
   * is empty. A hint: the payout is computed at settle.
   */
  winOddsBps: Type.Union([Type.Integer({ minimum: 10_000 }), Type.Null()]),
  loseOddsBps: Type.Union([Type.Integer({ minimum: 10_000 }), Type.Null()]),
});
export type StreamRoundView = Static<typeof StreamRoundView>;

export const StreamTipItem = Type.Object({
  tipperId: Snowflake,
  tipperName: Name,
  amount: Pelica,
  message: Type.String({ maxLength: STREAM_LIMITS.tipMessageMax }),
  at: EpochMs,
});
export type StreamTipItem = Static<typeof StreamTipItem>;

/** What the caller can do and has done on this stream. */
export const StreamMe = Type.Object({
  isStreamer: Type.Boolean(),
  balance: Pelica,
  /** The caller's stake on the active round (side fixed after the first bet), or null. */
  bet: Type.Union([Type.Object({ side: StreamSide, amount: Pelica }), Type.Null()]),
  /** What the caller can still add to the active round (`betMax - already`), 0 when none. */
  betRoom: count,
});
export type StreamMe = Static<typeof StreamMe>;

export const StreamView = Type.Object({
  now: EpochMs,
  id: StreamId,
  streamerId: Snowflake,
  streamerName: Name,
  streamerAvatar: Avatar,
  title: Type.String({ maxLength: STREAM_LIMITS.titleMax }),
  /** An outside stream URL (`http://` or `https://`), or null. */
  url: Type.Union([Type.String({ maxLength: STREAM_LIMITS.urlMax }), Type.Null()]),
  /** Text channel that holds the panel message, or null for a stream started in the Activity only. */
  channelId: Type.Union([Snowflake, Type.Null()]),
  /** The voice channel of the streamer's Activity instance, or null. Never created by the bot. */
  location: Type.Union([StreamLocation, Type.Null()]),
  status: StreamStatus,
  startedAt: EpochMs,
  /** The panel closes itself at this time (`startedAt + maxHours`). */
  endsAt: EpochMs,
  endedAt: Type.Union([EpochMs, Type.Null()]),
  tips: Pelica,
  tipCount: count,
  round: Type.Union([StreamRoundView, Type.Null()]),
  /** Newest first, at most `recentTipsMax`. May be shorter after a server restart. */
  recentTips: Type.Array(StreamTipItem, { maxItems: STREAM_LIMITS.recentTipsMax }),
  me: StreamMe,
});
export type StreamView = Static<typeof StreamView>;

export const StreamSummary = Type.Object({
  id: StreamId,
  streamerId: Snowflake,
  streamerName: Name,
  streamerAvatar: Avatar,
  title: Type.String({ maxLength: STREAM_LIMITS.titleMax }),
  startedAt: EpochMs,
  tips: Pelica,
  roundStatus: Type.Union([StreamRoundStatus, Type.Null()]),
});
export type StreamSummary = Static<typeof StreamSummary>;

export const StreamList = Type.Object({
  now: EpochMs,
  streams: Type.Array(StreamSummary, { maxItems: 100 }),
  /** The caller's own live stream, if any (one per streamer per guild). */
  mine: Type.Union([StreamId, Type.Null()]),
});
export type StreamList = Static<typeof StreamList>;

// ---- requests and responses ----

export const StreamViewQuery = Type.Object({ streamId: Type.Integer({ minimum: 1 }) }, closed);
export type StreamViewQuery = Static<typeof StreamViewQuery>;

export const StreamStartRequest = Type.Object(
  {
    ...keyed,
    title: Type.String({ minLength: 1, maxLength: STREAM_LIMITS.titleMax }),
    url: Type.Optional(Type.String({ maxLength: STREAM_LIMITS.urlMax })),
  },
  closed,
);
export type StreamStartRequest = Static<typeof StreamStartRequest>;

/** A write's response: the first response of the key, the balance now, and the stream as it is now. */
const written = <T extends TProperties>(extra: T) =>
  Type.Object({ replayed: Type.Boolean(), balance: Pelica, stream: StreamView, ...extra });

export const StreamStartResponse = written({});
export type StreamStartResponse = Static<typeof StreamStartResponse>;
export const StreamWriteResponse = StreamStartResponse;
export type StreamWriteResponse = Static<typeof StreamWriteResponse>;

export const StreamTipRequest = Type.Object(
  {
    ...keyed,
    streamId: StreamId,
    amount: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    message: Type.Optional(Type.String({ maxLength: STREAM_LIMITS.tipMessageMax })),
  },
  closed,
);
export type StreamTipRequest = Static<typeof StreamTipRequest>;
export const StreamTipResponse = written({
  amount: count,
  /** Paid on top by the sender, rounded up (transfer rules). */
  fee: count,
  /** What reached the streamer's balance after Teiai debt withholding. */
  received: count,
  withheld: count,
});
export type StreamTipResponse = Static<typeof StreamTipResponse>;

export const StreamBetRequest = Type.Object(
  {
    ...keyed,
    streamId: StreamId,
    roundId: StreamRoundId,
    side: StreamSide,
    amount: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  },
  closed,
);
export type StreamBetRequest = Static<typeof StreamBetRequest>;
export const StreamBetResponse = written({
  side: StreamSide,
  /** The caller's total on the round after this bet. */
  total: count,
});
export type StreamBetResponse = Static<typeof StreamBetResponse>;

export const StreamOpenRequest = Type.Object(
  {
    ...keyed,
    streamId: StreamId,
    /** Round name, 0..60 characters; empty or absent means the default label. */
    label: Type.Optional(Type.String({ maxLength: STREAM_LIMITS.roundLabelMax })),
  },
  closed,
);
export type StreamOpenRequest = Static<typeof StreamOpenRequest>;

/** Lock and void name the round, so a double click cannot act on the next round. */
export const StreamRoundRequest = Type.Object(
  { ...keyed, streamId: StreamId, roundId: StreamRoundId },
  closed,
);
export type StreamRoundRequest = Static<typeof StreamRoundRequest>;

export const StreamSettleRequest = Type.Object(
  { ...keyed, streamId: StreamId, roundId: StreamRoundId, winner: StreamSide },
  closed,
);
export type StreamSettleRequest = Static<typeof StreamSettleRequest>;
export const StreamSettleResponse = written({ result: StreamSettleResult });
export type StreamSettleResponse = Static<typeof StreamSettleResponse>;

export const StreamEndRequest = Type.Object({ ...keyed, streamId: StreamId }, closed);
export type StreamEndRequest = Static<typeof StreamEndRequest>;
export const StreamEndResponse = written({
  /** The round that was voided by closing the stream, if there was one. */
  voided: Type.Union([StreamSettleResult, Type.Null()]),
});
export type StreamEndResponse = Static<typeof StreamEndResponse>;
