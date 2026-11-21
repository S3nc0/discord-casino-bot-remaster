import { Type, type Static } from 'typebox';
import { ErrorCode } from './errors.ts';
import { GameId, Pelica } from './ids.ts';

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

/** Stake for one bet. Game rules apply their own min/max on top. */
export const StakeAmount = Type.Integer({ minimum: 1, maximum: 1_000_000_000_000 });
export type StakeAmount = Static<typeof StakeAmount>;

const ArgValue = Type.Union([
  Type.String({ maxLength: 64 }),
  Type.Number(),
  Type.Boolean(),
  Type.Array(Type.Union([Type.String({ maxLength: 64 }), Type.Number()]), { maxItems: 64 }),
]);

/** Game-specific parameters (roulette selection, slot lines, ...). Each game validates its own. */
export const IntentArgs = Type.Record(Type.String({ maxLength: 32 }), ArgValue, {
  maxProperties: 16,
});
export type IntentArgs = Static<typeof IntentArgs>;

/** Place a bet. Clients send intents, never results: all randomness is on the server. */
export const BetIntent = Type.Object({
  idempotencyKey: IdempotencyKey,
  game: GameId,
  stake: StakeAmount,
  args: Type.Optional(IntentArgs),
});
export type BetIntent = Static<typeof BetIntent>;

/** A follow-up move inside a round (`hit`, `stand`, `double`, `spin`, ...). */
export const ActionIntent = Type.Object({
  idempotencyKey: IdempotencyKey,
  game: GameId,
  action: Type.String({ pattern: '^[a-z][a-z0-9_]{0,31}$' }),
  args: Type.Optional(IntentArgs),
});
export type ActionIntent = Static<typeof ActionIntent>;

export const IntentAccepted = Type.Object({
  ok: Type.Literal(true),
  idempotencyKey: IdempotencyKey,
  /** true when this is a stored response to a repeated key. */
  replayed: Type.Boolean(),
  /** Balance in this guild after the intent. */
  balance: Pelica,
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
