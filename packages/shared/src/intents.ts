import { Type, type Static } from 'typebox';
import { ErrorCode } from './errors.ts';
import { GameId, Pelica } from './ids.ts';

/** Inbound schemas reject unknown properties: a client cannot smuggle `result` or `userId`. */
const closed = { additionalProperties: false } as const;

/**
 * Client-chosen key that makes a request safe to retry. One key = one effect: the server
 * stores the first response per (guild, user, key) and replays it for repeats.
 * `crypto.randomUUID()` fits.
 */
export const IdempotencyKey = Type.String({
  minLength: 16,
  maxLength: 64,
  pattern: '^[A-Za-z0-9_-]+$',
});
export type IdempotencyKey = Static<typeof IdempotencyKey>;

/** Server-issued id of a game round (or a shared table's current round). */
export const RoundId = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_:-]+$' });
export type RoundId = Static<typeof RoundId>;

/** Stake for one bet. Game rules apply their own min/max on top. */
export const StakeAmount = Type.Integer({ minimum: 1, maximum: 1_000_000_000_000 });
export type StakeAmount = Static<typeof StakeAmount>;

const ArgScalar = Type.Union([Type.String({ maxLength: 64 }), Type.Integer(), Type.Boolean()]);
const ArgList = Type.Array(ArgScalar, { maxItems: 64 });
const ArgObject = Type.Record(Type.String({ maxLength: 32 }), Type.Union([ArgScalar, ArgList]), {
  maxProperties: 16,
});

/**
 * Game-specific parameters (slot lines, chosen dice, ...). Values are scalars, lists of
 * scalars, one level of bounded objects, or lists of those. Numbers are integers.
 * Each game validates its own shape on the server.
 */
export const IntentArgs = Type.Record(
  Type.String({ maxLength: 32 }),
  Type.Union([ArgScalar, ArgList, ArgObject, Type.Array(ArgObject, { maxItems: 64 })]),
  { maxProperties: 16 },
);
export type IntentArgs = Static<typeof IntentArgs>;

/**
 * One line of a multi-bet (roulette chips, several race tickets, arena picks).
 * `kind` is game-specific (`straight`, `red`, `win`, `exacta`, ...); `targets` are numbers,
 * horse/fighter ids or labels.
 */
export const BetLine = Type.Object(
  {
    kind: Type.String({ pattern: '^[a-z][a-z0-9_]{0,31}$' }),
    targets: Type.Array(Type.Union([Type.Integer(), Type.String({ maxLength: 32 })]), {
      maxItems: 8,
    }),
    stake: StakeAmount,
  },
  closed,
);
export type BetLine = Static<typeof BetLine>;

/**
 * Place a bet. Clients send intents, never results: all randomness is on the server.
 * With `bets`, `stake` must equal the sum of the lines (checked by the server).
 */
export const BetIntent = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    game: GameId,
    stake: StakeAmount,
    bets: Type.Optional(Type.Array(BetLine, { minItems: 1, maxItems: 64 })),
    /** Shared tables: the round being bet on, so a late bet cannot land in the next round. */
    roundId: Type.Optional(RoundId),
    args: Type.Optional(IntentArgs),
  },
  closed,
);
export type BetIntent = Static<typeof BetIntent>;

/**
 * A follow-up move inside a round (`hit`, `stand`, `double`, `spin`, ...). `roundId` is the
 * round the client saw; the server rejects it with `conflict` if that round is no longer current.
 */
export const ActionIntent = Type.Object(
  {
    idempotencyKey: IdempotencyKey,
    game: GameId,
    roundId: RoundId,
    action: Type.String({ pattern: '^[a-z][a-z0-9_]{0,31}$' }),
    args: Type.Optional(IntentArgs),
  },
  closed,
);
export type ActionIntent = Static<typeof ActionIntent>;

export const IntentAccepted = Type.Object({
  ok: Type.Literal(true),
  idempotencyKey: IdempotencyKey,
  /** true when this is a stored response to a repeated key. */
  replayed: Type.Boolean(),
  /** Balance in this guild after the intent. */
  balance: Pelica,
  roundId: Type.Optional(RoundId),
  /** Game-specific result. Live state also arrives as `table:state`. */
  result: Type.Optional(Type.Unknown()),
});

export const IntentRejected = Type.Object({
  ok: Type.Literal(false),
  idempotencyKey: Type.Union([IdempotencyKey, Type.Null()]),
  error: ErrorCode,
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const IntentAck = Type.Union([IntentAccepted, IntentRejected]);
export type IntentAck = Static<typeof IntentAck>;
