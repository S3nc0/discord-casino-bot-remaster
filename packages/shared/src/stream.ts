import { Type, type Static } from 'typebox';
import { EpochMs, Pelica, Snowflake, StreamId, StreamRoundId } from './ids.ts';

/**
 * Stream panel primitives shared by the domain events, the Activity routes and the chat bot
 * (docs/spec/stream.md). The rules and numbers live in the spec; the constants here are the same
 * numbers, exported so the server, the domain package and both clients cannot drift.
 */

/** Numbers of the stream panel. Percentages are basis points (500 = 5 %), never floats. */
export const STREAM_LIMITS = {
  /** Title length, 1..100. */
  titleMax: 100,
  /** A panel closes itself this long after it was started (unsettled rounds are voided). */
  maxHours: 24,
  /** Smallest tip. Fee, daily cap, games-played and debt rules are the transfer rules. */
  tipMin: 100,
  /** Longest message that can come with a tip. */
  tipMessageMax: 150,
  /** Smallest single bet. */
  betMin: 100,
  /** Most one person can stake on one round, both bets together. */
  betMax: 10_000,
  /** Teiai's cut of the losing side's total, in basis points. */
  rakeBps: 500,
  /** Round name length, 0..60 (empty means the default label). */
  roundLabelMax: 60,
  /** Longest stream URL. */
  urlMax: 300,
  /** Bets close by themselves this long after a round opens (owner decision D3). */
  roundAutoLockMs: 10 * 60_000,
  /** Reason of an owner void, 1..200 characters. */
  voidReasonMax: 200,
  /** Payout lines kept in a settle result and its announcement. */
  resultTopMax: 10,
  /** Tips a stream view carries for the feed. */
  recentTipsMax: 20,
} as const;

/** Odds are shown as basis points of the stake: 10_000 = x1.00, 14_750 = x1.475. */
export const STREAM_ODDS_ONE = 10_000;

/**
 * Embed colour of a tip card by amount, highest tier first: the first row whose `from` the amount
 * reaches wins; smaller tips use `STREAM_TIP_COLOR_DEFAULT`.
 */
export const STREAM_TIP_TIERS = [
  { from: 20_000, color: 0xe62117 },
  { from: 10_000, color: 0xe91e63 },
  { from: 5_000, color: 0xf57c00 },
  { from: 2_000, color: 0xffca28 },
  { from: 1_000, color: 0x1de9b6 },
  { from: 500, color: 0x00e5ff },
] as const;
export const STREAM_TIP_COLOR_DEFAULT = 0x1e88e5;
/** Panel embed colour while a stream is live. */
export const STREAM_PANEL_COLOR_LIVE = 0xe62117;

export const STREAM_SIDES = ['win', 'lose'] as const;
/** What a viewer bets on: the streamer wins the round, or loses it. */
export const StreamSide = Type.Enum(STREAM_SIDES);
export type StreamSide = Static<typeof StreamSide>;

export const STREAM_STATUSES = ['live', 'ended'] as const;
export const StreamStatus = Type.Enum(STREAM_STATUSES);
export type StreamStatus = Static<typeof StreamStatus>;

/**
 * Round state machine: `open` → `locked` → `win` | `lose`; `void` from `open` or `locked`.
 * `win` and `lose` can be declared only from `locked` (owner decision D3).
 */
export const STREAM_ROUND_STATUSES = ['open', 'locked', 'win', 'lose', 'void'] as const;
export const StreamRoundStatus = Type.Enum(STREAM_ROUND_STATUSES);
export type StreamRoundStatus = Static<typeof StreamRoundStatus>;

/** How a round ended. */
export const STREAM_OUTCOMES = ['win', 'lose', 'void'] as const;
export const StreamOutcome = Type.Enum(STREAM_OUTCOMES);
export type StreamOutcome = Static<typeof StreamOutcome>;

/** Who locked a round: the streamer, or the 10-minute timer. */
export const StreamLockCause = Type.Enum(['streamer', 'auto'] as const);
export type StreamLockCause = Static<typeof StreamLockCause>;

/**
 * Who ended a round. `streamer` declared or voided it; `owner` voided it with `/admin stream-void`;
 * `stream_end` is the streamer closing the panel; `timeout` is the 24 h auto-close.
 */
export const StreamSettleCause = Type.Enum(['streamer', 'owner', 'stream_end', 'timeout'] as const);
export type StreamSettleCause = Static<typeof StreamSettleCause>;

/** Who closed a stream. */
export const StreamEndCause = Type.Enum(['streamer', 'timeout'] as const);
export type StreamEndCause = Static<typeof StreamEndCause>;

/**
 * Stable snake_case rule that said no to a stream request. Sent as `StreamError.rule`; the
 * message is `screen.stream.rule.<rule>` (EN + JA). Append-only. Money and transfer refusals that
 * come from the shared transfer rules (`transfer_min_games`, `transfer_daily_limit`,
 * `transfer_insufficient_balance`) keep their own `screen.life.rule.*` names.
 */
export const STREAM_RULES = [
  'stream_bad_title',
  'stream_bad_url',
  'stream_already_live',
  'stream_ended',
  'stream_not_streamer',
  'stream_self_tip',
  'stream_tip_min',
  'stream_bad_label',
  'stream_round_active',
  'stream_no_open_round',
  'stream_no_round',
  'stream_bad_side',
  'stream_self_bet',
  'stream_other_side',
  'stream_bet_min',
  'stream_bet_max',
  // owner decision D3: a round must be locked before win or lose is declared
  'stream_not_locked',
  // a request names a round that is no longer the stream's active one
  'stream_round_changed',
  // a round that already paid out cannot be voided (the money is gone)
  'stream_round_settled',
  // tips and bets are refused while the player has Teiai debt
  'stream_debt',
  // `/admin stream-void`: no reason given, or no such stream / round
  'stream_void_reason',
  'stream_void_target',
] as const;
export const StreamRule = Type.Enum(STREAM_RULES);
export type StreamRule = (typeof STREAM_RULES)[number];

/** One line of a settle result: who was paid and how much (stake included). */
export const StreamPayoutLine = Type.Object({ userId: Snowflake, amount: Pelica });
export type StreamPayoutLine = Static<typeof StreamPayoutLine>;

/**
 * What a round paid. Parimutuel: `rake = floor(loserTotal * rakeBps / 10_000)`,
 * `pot = loserTotal - rake`, each winner gets `stake + floor(pot * stake / winnerTotal)`.
 * `refunded` is true for a void and for a one-sided round: every bettor got exactly their stake.
 * `payouts` is the top payouts (at most `resultTopMax`, largest first); `payoutCount` counts all.
 */
export const StreamSettleResult = Type.Object({
  roundId: StreamRoundId,
  label: Type.String({ maxLength: 60 }),
  outcome: StreamOutcome,
  refunded: Type.Boolean(),
  cause: StreamSettleCause,
  bettors: Type.Integer({ minimum: 0 }),
  winTotal: Pelica,
  loseTotal: Pelica,
  /** Teiai's deduction plus the rounding dust (0 when refunded). */
  rake: Pelica,
  payoutCount: Type.Integer({ minimum: 0 }),
  payouts: Type.Array(StreamPayoutLine, { maxItems: STREAM_LIMITS.resultTopMax }),
});
export type StreamSettleResult = Static<typeof StreamSettleResult>;

/**
 * Round audit log row (owner decision D3): one per round that ended, written in the same
 * transaction as the settle or void. Owner-only; never sent to the Activity.
 */
export const StreamAuditEntry = Type.Object({
  roundId: StreamRoundId,
  streamId: StreamId,
  guildId: Snowflake,
  streamerId: Snowflake,
  label: Type.String({ maxLength: 60 }),
  openedAt: EpochMs,
  lockedAt: Type.Union([EpochMs, Type.Null()]),
  endedAt: EpochMs,
  outcome: StreamOutcome,
  cause: StreamSettleCause,
  /** Who settled or voided: the streamer, the owner, or null for the timer and the 24 h close. */
  actorId: Type.Union([Snowflake, Type.Null()]),
  /** The owner's reason for a `/admin stream-void`; null otherwise. */
  reason: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  bettors: Type.Integer({ minimum: 0 }),
  winTotal: Pelica,
  loseTotal: Pelica,
  rake: Pelica,
  refunded: Type.Boolean(),
  /** Top winners, largest first, at most `resultTopMax`. */
  top: Type.Array(StreamPayoutLine, { maxItems: STREAM_LIMITS.resultTopMax }),
});
export type StreamAuditEntry = Static<typeof StreamAuditEntry>;

/** Tip card colour for `amount` (docs/spec/stream.md §3). */
export function streamTipColor(amount: number): number {
  for (const tier of STREAM_TIP_TIERS) if (amount >= tier.from) return tier.color;
  return STREAM_TIP_COLOR_DEFAULT;
}

/**
 * Indicative odds for `side`, in basis points of the stake (`STREAM_ODDS_ONE` = x1.00):
 * `10_000 + floor((other - floor(other * rakeBps / 10_000)) * 10_000 / mine)`. `null` while either
 * side has nothing on it (no contest). A hint only; the payout is computed at settle.
 */
export function streamOddsBps(
  winTotal: number,
  loseTotal: number,
  side: StreamSide,
): number | null {
  const mine = side === 'win' ? winTotal : loseTotal;
  const other = side === 'win' ? loseTotal : winTotal;
  if (mine <= 0 || other <= 0) return null;
  const pot = other - Math.floor((other * STREAM_LIMITS.rakeBps) / 10_000);
  return STREAM_ODDS_ONE + Math.floor((pot * STREAM_ODDS_ONE) / mine);
}
