import { BPS_SCALE, truncInt } from '../math.ts';
import { endAfterBidMs, marketplaceFee, minNextBid } from '../player-market/player-market.ts';
import { KYOSAI_CONSTANTS } from './constants.ts';

export interface KyosaiHolding {
  readonly holderId: string;
  readonly units: number;
}

/**
 * Compare two holder IDs for deterministic Hamilton tie-breaking (lowest numeric ID wins,
 * matching Python integer `user_id` ordering).
 */
function compareHolderIds(a: string, b: string): number {
  if (a === b) return 0;
  const aDigits = /^\d+$/.test(a);
  const bDigits = /^\d+$/.test(b);
  if (aDigits && bDigits) {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : 1;
  }
  return a < b ? -1 : 1;
}

/**
 * Largest-remainder (Hamilton) pro-rata split so integer shares sum to exact `amount`.
 * Ties on remainder are broken by lowest `holderId` (numeric order for snowflakes).
 */
export function hamiltonSplit(
  amount: number,
  holdings: readonly KyosaiHolding[],
): Record<string, number> {
  if (amount <= 0) return {};
  const positive = holdings.filter((h) => h.units > 0);
  const totalUnits = positive.reduce((sum, h) => sum + h.units, 0);
  if (totalUnits <= 0) return {};

  const rows = positive.map((h) => {
    const exactNum = BigInt(amount) * BigInt(h.units);
    const totalBig = BigInt(totalUnits);
    const base = Number(exactNum / totalBig);
    const rem = exactNum % totalBig;
    return { holderId: h.holderId, base, rem };
  });

  let assigned = 0;
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.holderId] = r.base;
    assigned += r.base;
  }

  const leftover = amount - assigned;
  if (leftover > 0) {
    const sorted = [...rows].sort((a, b) => {
      if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
      return compareHolderIds(a.holderId, b.holderId);
    });
    for (let i = 0; i < leftover && i < sorted.length; i++) {
      const winner = sorted[i];
      if (winner) {
        out[winner.holderId] = (out[winner.holderId] ?? 0) + 1;
      }
    }
  }

  return out;
}

/**
 * Daily Kyosai surplus dividend pool:
 *   surplus = availableCash - 0.30 * liabilities
 *   pool = min(50_000, floor(surplus * 0.05)) if surplus > 0 else 0
 */
export function kyosaiDividendPool(availableCashPelica: number, liabilitiesPelica: number): number {
  const surplus =
    availableCashPelica - (liabilitiesPelica * KYOSAI_CONSTANTS.targetRatioBps) / BPS_SCALE;
  if (surplus <= 0) return 0;
  return Math.min(
    KYOSAI_CONSTANTS.dividendCap,
    truncInt((surplus * KYOSAI_CONSTANTS.dividendShareBps) / BPS_SCALE),
  );
}

/**
 * Liquidity gate blocking P2P unit transfers during bank stress:
 * locked when `graceDebtors > 0` OR `(theta !== null && theta < 0.20)`.
 */
export function isKyosaiGateLocked(theta: number | null, graceDebtors: number): boolean {
  if (graceDebtors > 0) return true;
  if (theta !== null && theta < KYOSAI_CONSTANTS.gateRatioBps / BPS_SCALE) return true;
  return false;
}

/**
 * Governance motion passing rule (evaluated using unit balances at close time):
 * `yesUnits > noUnits` (strict majority) AND `yesUnits >= 0.25 * circulatingUnits`.
 */
export function doesMotionPass(
  yesUnits: number,
  noUnits: number,
  circulatingUnits: number,
): boolean {
  if (circulatingUnits <= 0) return false;
  return (
    yesUnits > noUnits &&
    yesUnits * BPS_SCALE >= circulatingUnits * KYOSAI_CONSTANTS.motionMinYesShareBps
  );
}

/** Validate proposed trust premium in integer nano-units (`0 < premiumNano <= 1e9`, i.e., `0..100%/day`). */
export function isPremiumNanoValid(premiumNano: number): boolean {
  return (
    Number.isInteger(premiumNano) &&
    premiumNano > 0 &&
    premiumNano <= KYOSAI_CONSTANTS.premiumLimitNano
  );
}

/** Validate proposed trust premium given as daily decimal rate (`0 < rate <= 1.0`). */
export function isPremiumRateValid(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate <= 1.0;
}

/** 5% P2P Kyosai unit transfer fee (same formula as Player Market). */
export function kyosaiTransferFee(price: number): number {
  return marketplaceFee(price);
}

/** Minimum next bid on a Kyosai house unit auction (reuses Player Market bidding step). */
export function kyosaiMinNextBid(currentTopBid: number): number {
  return minNextBid(KYOSAI_CONSTANTS.auctionMinBid, currentTopBid);
}

/** Anti-snipe extension on a Kyosai auction bid (5 minutes). */
export function kyosaiEndAfterBidMs(endAtMs: number, nowMs: number): number {
  return endAfterBidMs(endAtMs, nowMs);
}

/** Next auction lot size (`min(houseUnits, 100)`). */
export function kyosaiAuctionLotSize(houseUnits: number): number {
  return Math.min(Math.max(0, houseUnits), KYOSAI_CONSTANTS.auctionLot);
}
