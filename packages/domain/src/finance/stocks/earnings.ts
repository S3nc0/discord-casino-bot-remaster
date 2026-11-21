import type { Rng } from '@casino/shared';
import {
  BPS_SCALE,
  localDateParts,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  roundTo,
} from '../math.ts';
import { EARNINGS_CONSTANTS, type SymbolKey } from './constants.ts';

export interface EarningsPlan {
  readonly symbol: SymbolKey;
  readonly direction: -1 | 1;
  /** Jump magnitude rounded to 3 decimals (e.g. 0.185 = 18.5%). Stored as integer bps (×10_000) in DB. */
  readonly size: number;
  /** Integer basis points (`Math.round(size * 10_000)`). */
  readonly sizeBps: number;
  readonly announceAtMs: number;
  readonly releaseAtMs: number;
}

/**
 * Plan the next weekly earnings release (announce Monday 09:00, release Tuesday 13:30 in local TZ).
 * Picks `teio` or `numa`, direction ∈ {+1, -1} (50/50), 15% surprise (`0.35..0.60`),
 * else normal (`0.08..0.22`), rounded to 3 decimal places.
 */
export function planWeeklyEarnings(
  nowMs: number,
  utcOffsetHours: number,
  rng: Rng,
): EarningsPlan {
  const parts = localDateParts(nowMs, utcOffsetHours);
  // Start of current local week (Monday 00:00)
  const mondayStartMs = parts.dayStartMs - parts.weekday * MS_PER_DAY;
  let announceAtMs =
    mondayStartMs +
    EARNINGS_CONSTANTS.announceWeekday * MS_PER_DAY +
    EARNINGS_CONSTANTS.announceHour * MS_PER_HOUR +
    EARNINGS_CONSTANTS.announceMinute * MS_PER_MINUTE;
  let releaseAtMs =
    mondayStartMs +
    EARNINGS_CONSTANTS.releaseWeekday * MS_PER_DAY +
    EARNINGS_CONSTANTS.releaseHour * MS_PER_HOUR +
    EARNINGS_CONSTANTS.releaseMinute * MS_PER_MINUTE;

  // If this week's release already passed, schedule next week
  if (nowMs >= releaseAtMs) {
    announceAtMs += 7 * MS_PER_DAY;
    releaseAtMs += 7 * MS_PER_DAY;
  }

  const syms = EARNINGS_CONSTANTS.eligibleSymbols;
  const symbol = syms[rng.int(0, syms.length)] ?? 'teio';
  const direction: -1 | 1 = rng.int(0, 2) === 0 ? -1 : 1;
  const isSurprise = rng.float() < EARNINGS_CONSTANTS.surpriseProb;
  const lo = isSurprise ? EARNINGS_CONSTANTS.surpriseLo : EARNINGS_CONSTANTS.sizeLo;
  const hi = isSurprise ? EARNINGS_CONSTANTS.surpriseHi : EARNINGS_CONSTANTS.sizeHi;
  const size = roundTo(lo + (hi - lo) * rng.float(), 3);

  return {
    symbol,
    direction,
    size,
    sizeBps: Math.round(size * BPS_SCALE),
    announceAtMs,
    releaseAtMs,
  };
}

/**
 * Log-symmetric earnings price multiplier `exp(direction * ln(1 + size))`
 * (`1 + size` when positive, `1 / (1 + size)` when negative, so E[log jump] = 0).
 */
export function earningsFactor(direction: -1 | 1, size: number): number {
  return Math.exp(direction * Math.log(1 + size));
}

let cachedJumpVariance: number | null = null;

/**
 * Theoretical log-jump variance of a weekly earnings shock via 200-bin midpoint quadrature:
 * `0.85 * E[ln(1 + U(0.08, 0.22))^2] + 0.15 * E[ln(1 + U(0.35, 0.60))^2]`.
 */
export function earningsJumpVariance(): number {
  if (cachedJumpVariance !== null) return cachedJumpVariance;
  const meanSq = (lo: number, hi: number, bins = 200): number => {
    const step = (hi - lo) / bins;
    let sum = 0;
    for (let i = 0; i < bins; i++) {
      const mid = lo + (i + 0.5) * step;
      const lg = Math.log(1 + mid);
      sum += lg * lg;
    }
    return sum / bins;
  };
  const normalVar = meanSq(EARNINGS_CONSTANTS.sizeLo, EARNINGS_CONSTANTS.sizeHi);
  const surpriseVar = meanSq(EARNINGS_CONSTANTS.surpriseLo, EARNINGS_CONSTANTS.surpriseHi);
  cachedJumpVariance =
    (1 - EARNINGS_CONSTANTS.surpriseProb) * normalVar +
    EARNINGS_CONSTANTS.surpriseProb * surpriseVar;
  return cachedJumpVariance;
}

export interface InsiderMemo {
  readonly symbolName: string;
  readonly hint: -1 | 1;
  readonly releaseAtMs: number;
  readonly truthBps: number;
}

/**
 * Build an insider earnings memo. When `rng` is supplied, flips `direction` with probability
 * `1 - truthBps / 10_000` (30% fake for daily memos, 20% fake for shop memos).
 * When `rng` is omitted, uses `direction` verbatim as `hint`.
 */
export function buildEarningsMemo(
  symbolName: string,
  direction: -1 | 1,
  releaseAtMs: number,
  truthBps: number = EARNINGS_CONSTANTS.memoTruthBps,
  rng?: Rng,
): InsiderMemo {
  let hint: -1 | 1 = direction;
  if (rng && rng.float() >= truthBps / BPS_SCALE) {
    hint = direction === 1 ? -1 : 1;
  }
  return { symbolName, hint, releaseAtMs, truthBps };
}
