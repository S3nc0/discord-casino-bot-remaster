import type { Rng } from '@casino/shared';

export const MIN_FEE = 500;
export const RANDOM_FEE_RANGE: readonly [number, number] = [500, 3000];
export const DEFAULT_MINUTES = 60;
export const MAX_MINUTES = 1440;
export const SHOWN_ENTRANTS = 20;
export const MIN_ENTRANTS = 2;

export const LOTTERY_STATUSES = ['open', 'done', 'cancelled'] as const;
export type LotteryStatus = (typeof LOTTERY_STATUSES)[number];

/** A random entry fee in steps of 100 within 500..3,000. */
export function randomFee(rng: Rng): number {
  const steps = (RANDOM_FEE_RANGE[1] - RANDOM_FEE_RANGE[0]) / 100 + 1;
  return RANDOM_FEE_RANGE[0] + 100 * rng.int(0, steps);
}

export type JoinError =
  'raffle_closed' | 'raffle_already_joined' | 'debt_blocks' | 'insufficient_balance';

export function validateJoin(input: {
  nowMs: number;
  closesMs: number;
  status: LotteryStatus;
  alreadyJoined: boolean;
  debt: number;
  balance: number;
  fee: number;
}): JoinError | null {
  if (input.status !== 'open' || input.nowMs >= input.closesMs) return 'raffle_closed';
  if (input.alreadyJoined) return 'raffle_already_joined';
  if (input.debt > 0) return 'debt_blocks';
  if (input.balance < input.fee) return 'insufficient_balance';
  return null;
}

export type DrawResult =
  { outcome: 'won'; winnerId: string; prize: number } | { outcome: 'refunded'; prize: 0 };

/** One winner takes `fee * entrants` with no house cut; fewer than 2 entrants (or a cancel) refunds all. */
export function drawLottery(
  entrants: readonly string[],
  fee: number,
  rng: Rng,
  cancelled = false,
): DrawResult {
  if (cancelled || entrants.length < MIN_ENTRANTS) return { outcome: 'refunded', prize: 0 };
  const winnerId = entrants[rng.int(0, entrants.length)] as string;
  return { outcome: 'won', winnerId, prize: fee * entrants.length };
}
