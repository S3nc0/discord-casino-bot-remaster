import {
  STREAM_LIMITS,
  STREAM_TIP_COLOR_DEFAULT,
  STREAM_TIP_TIERS,
  streamOddsBps,
  type StreamPayoutLine,
  type StreamSide,
} from '@casino/shared';

/**
 * Stream panel rules (docs/spec/stream.md). The numbers are `STREAM_LIMITS` from the shared
 * contracts, so the server, this package and both clients read the same values.
 */
export const TITLE_MAX = STREAM_LIMITS.titleMax;
export const URL_MAX = STREAM_LIMITS.urlMax;
export const MAX_HOURS = STREAM_LIMITS.maxHours;
export const MAX_MS = STREAM_LIMITS.maxHours * 60 * 60 * 1000;
export const TIP_MIN = STREAM_LIMITS.tipMin;
export const TIP_MESSAGE_MAX = STREAM_LIMITS.tipMessageMax;
export const BET_MIN = STREAM_LIMITS.betMin;
export const BET_MAX = STREAM_LIMITS.betMax;
export const RAKE_BPS = STREAM_LIMITS.rakeBps;
export const ROUND_LABEL_MAX = STREAM_LIMITS.roundLabelMax;
export const ROUND_AUTO_LOCK_MS = STREAM_LIMITS.roundAutoLockMs;
export const VOID_REASON_MAX = STREAM_LIMITS.voidReasonMax;
export const RESULT_TOP_MAX = STREAM_LIMITS.resultTopMax;

/** One person's whole stake on a round (both of their bets added; the side is fixed). */
export interface StreamStake {
  userId: string;
  side: StreamSide;
  amount: number;
}

/** What a round pays: the streamer won, lost, or the round was voided. */
export type StreamSettleOutcome = StreamSide | 'void';

export interface StreamPayout extends StreamPayoutLine {
  /** The stake inside `amount`. `amount - stake` is the profit (income for debt withholding). */
  stake: number;
}

export interface StreamSettlement {
  /** Void, one-sided or empty round: everyone gets exactly their stake back. */
  refunded: boolean;
  winTotal: number;
  loseTotal: number;
  bettors: number;
  /** `floor(loserTotal * rakeBps / 10_000)`; 0 when refunded. */
  rake: number;
  /** The pot's rounding leftover after the shares; 0 when refunded. */
  dust: number;
  /**
   * Everyone who gets money back, largest first (ties by user id): the winners when paid out,
   * every bettor when refunded. Losers of a paid round get nothing and are not listed.
   */
  payouts: StreamPayout[];
}

/** Compare snowflakes as numbers (equal length first), so the order is the same everywhere. */
function byId(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function largestFirst(a: StreamPayout, b: StreamPayout): number {
  return b.amount - a.amount || byId(a.userId, b.userId);
}

/** Teiai's cut of the losing side, rounded down. */
export function rakeOf(loserTotal: number): number {
  return Math.floor((loserTotal * RAKE_BPS) / 10_000);
}

/**
 * Parimutuel settlement of one round. Integers only:
 * `rake = floor(loser * 500 / 10_000)`, `pot = loser - rake`, each winner gets
 * `stake + floor(pot * stake / winnerTotal)`; the rake and the dust stay with Teiai. A void, a
 * side with nothing on it, or nobody betting refunds every stake exactly. No Pelica is created:
 * Σ payouts + rake + dust = Σ stakes, or Σ payouts = Σ stakes when refunded.
 */
export function settle(
  stakes: readonly StreamStake[],
  outcome: StreamSettleOutcome,
): StreamSettlement {
  let winTotal = 0;
  let loseTotal = 0;
  for (const s of stakes) {
    if (!Number.isSafeInteger(s.amount) || s.amount <= 0) {
      throw new RangeError(`stake must be a positive integer: ${s.amount}`);
    }
    if (s.side === 'win') winTotal += s.amount;
    else loseTotal += s.amount;
  }
  const bettors = stakes.length;
  if (outcome === 'void' || winTotal === 0 || loseTotal === 0) {
    return {
      refunded: true,
      winTotal,
      loseTotal,
      bettors,
      rake: 0,
      dust: 0,
      payouts: stakes
        .map((s) => ({ userId: s.userId, amount: s.amount, stake: s.amount }))
        .sort(largestFirst),
    };
  }
  const winnerTotal = outcome === 'win' ? winTotal : loseTotal;
  const loserTotal = outcome === 'win' ? loseTotal : winTotal;
  const rake = rakeOf(loserTotal);
  const pot = loserTotal - rake;
  let shared = 0;
  const payouts: StreamPayout[] = [];
  for (const s of stakes) {
    if (s.side !== outcome) continue;
    // pot * stake stays far below 2^53: both are at most a few million.
    const share = Math.floor((pot * s.amount) / winnerTotal);
    shared += share;
    payouts.push({ userId: s.userId, amount: s.amount + share, stake: s.amount });
  }
  return {
    refunded: false,
    winTotal,
    loseTotal,
    bettors,
    rake,
    dust: pot - shared,
    payouts: payouts.sort(largestFirst),
  };
}

/** Indicative odds of `side` in basis points of the stake, or null while a side is empty. */
export function odds(winTotal: number, loseTotal: number, side: StreamSide): number | null {
  return streamOddsBps(winTotal, loseTotal, side);
}

/** Tip card tier: the colour and the smallest amount of the tier (0 for the default tier). */
export function tipTier(amount: number): { from: number; color: number } {
  for (const tier of STREAM_TIP_TIERS) if (amount >= tier.from) return { ...tier };
  return { from: 0, color: STREAM_TIP_COLOR_DEFAULT };
}

/** Title check: 1..100 characters after trimming. */
export function validTitle(title: string): boolean {
  const t = title.trim();
  return t.length >= 1 && t.length <= TITLE_MAX;
}

/** URL check: empty, or `http(s)://…` of at most 300 characters. */
export function validUrl(url: string): boolean {
  return url.length <= URL_MAX && /^https?:\/\/\S+$/i.test(url);
}
