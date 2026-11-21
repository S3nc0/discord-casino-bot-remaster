import { BPS_SCALE, rateToNano, roundTo, truncInt } from '../math.ts';
import { TEIAI_CONSTANTS } from '../teiai/constants.ts';
import { BOND_CONSTANTS, type BondKindDef, type BondKindKey } from './constants.ts';

/**
 * Convert a full-period coupon percentage (`pct`, e.g. `4` for 4%) over `hours` to a daily
 * continuous rate: `ln(1 + pct / 100) / (hours / 24)`.
 */
export function perDayRate(pct: number, hours: number): number {
  return Math.log(1 + pct / 100) / (hours / 24);
}

/** Baseline risk-free rate per day: `ln(1.04) / 3 ≈ 0.0130735711`. */
export const BASE_RISK_FREE_PER_DAY = perDayRate(
  BOND_CONSTANTS.kinds.normal.baseRatePct,
  BOND_CONSTANTS.kinds.normal.hours,
);

export const BASE_RISK_FREE_NANO = rateToNano(BASE_RISK_FREE_PER_DAY);

/** Lower and upper bounds on daily continuous risk-free rate `r_f`. */
export const RF_MIN_PER_DAY = perDayRate(TEIAI_CONSTANTS.rfMinPctBps / 100, 72);
export const RF_MAX_PER_DAY = perDayRate(TEIAI_CONSTANTS.rfMaxPctBps / 100, 72);

/** Fixed early-sale spread per hour above `r_f / 24`. */
export const SALE_SPREAD_PER_HOUR = Math.max(
  0,
  BOND_CONSTANTS.saleDiscountPerHour - BASE_RISK_FREE_PER_DAY / 24,
);

/**
 * Long-run CIR target `mu(theta)` as a function of Teiai Bank's reserve ratio `theta`:
 * - When `theta === null` (zero liabilities): returns `BASE_RISK_FREE_PER_DAY`.
 * - Otherwise: `RF_MIN + (RF_MAX - RF_MIN) * exp(-RF_ALPHA * max(0, theta))`.
 */
export function rfTarget(theta: number | null): number {
  if (theta === null) return BASE_RISK_FREE_PER_DAY;
  return (
    RF_MIN_PER_DAY +
    (RF_MAX_PER_DAY - RF_MIN_PER_DAY) * Math.exp(-TEIAI_CONSTANTS.rfAlpha * Math.max(0, theta))
  );
}

/**
 * One CIR mean-reverting step for `r_f` over `days` with standard normal draw `z`:
 *   drift = mu + (r - mu) * exp(-kappa * days)
 *   noise = sigma * sqrt(max(r, 0) * min(days, 1/24)) * z
 *   clamped to [RF_MIN_PER_DAY, RF_MAX_PER_DAY].
 */
export function rfStep(currentRf: number, theta: number | null, days: number, z: number): number {
  if (days <= 0) return Math.min(RF_MAX_PER_DAY, Math.max(RF_MIN_PER_DAY, currentRf));
  const mu = rfTarget(theta);
  const drift = mu + (currentRf - mu) * Math.exp(-TEIAI_CONSTANTS.rfKappaPerDay * days);
  const noise =
    TEIAI_CONSTANTS.rfSigma * Math.sqrt(Math.max(currentRf, 0) * Math.min(days, 1 / 24)) * z;
  return Math.min(RF_MAX_PER_DAY, Math.max(RF_MIN_PER_DAY, drift + noise));
}

/**
 * Bond purchase coupon percentage (2 decimals) given current daily `r_f`:
 *   spread = perDayRate(kind.baseRatePct, kind.hours) - BASE_RISK_FREE_PER_DAY
 *   ratePct = round(max(0, expm1((rf + spread) * kind.hours / 24) * 100), 2)
 */
export function bondRatePct(kind: BondKindKey | BondKindDef, rf: number): number {
  const def = typeof kind === 'string' ? BOND_CONSTANTS.kinds[kind] : kind;
  const spread = perDayRate(def.baseRatePct, def.hours) - BASE_RISK_FREE_PER_DAY;
  const rawPct = Math.max(0, Math.expm1(((rf + spread) * def.hours) / 24) * 100);
  return roundTo(rawPct, 2);
}

/** Bond purchase coupon in integer basis points (`Math.round(ratePct * 100)`). */
export function bondRateBps(kind: BondKindKey | BondKindDef, rf: number): number {
  return Math.round(bondRatePct(kind, rf) * 100);
}

/** Total bond interest at maturity in integer Pelica (`floor(principal * rateBps / 10_000)`). */
export function bondInterest(principal: number, rateBps: number): number {
  if (principal <= 0 || rateBps <= 0) return 0;
  return Math.floor((principal * rateBps) / BPS_SCALE);
}

/** Full maturity payout (`principal + interest`). */
export function bondMaturityPayout(principal: number, rateBps: number): number {
  return principal + bondInterest(principal, rateBps);
}

/**
 * Continuous Poisson default hazard probability over `elapsedHours` for a bond kind:
 * - Normal bond (`defaultPct === 0`): always `0`.
 * - Junk bond (`defaultPct === 20`, 24h): `lambda = -ln(0.8) / 24`, `p = 1 - exp(-lambda * hours)`.
 */
export function bondDefaultProbability(
  kind: BondKindKey | BondKindDef,
  elapsedHours: number,
): number {
  const def = typeof kind === 'string' ? BOND_CONSTANTS.kinds[kind] : kind;
  if (def.defaultPct <= 0 || elapsedHours <= 0) return 0;
  const pFull = def.defaultPct / 100;
  const lambda = -Math.log(1 - pFull) / def.hours;
  return -Math.expm1(-lambda * elapsedHours);
}

/** Hourly DCF discount rate for early bond sale: `rf / 24 + SALE_SPREAD_PER_HOUR`. */
export function bondSaleDiscountPerHour(rf: number): number {
  return rf / 24 + SALE_SPREAD_PER_HOUR;
}

/**
 * Early DCF resale value of a bond at `nowMs` before `dueMs`, rounded down (floor integer Pelica):
 * `saleValue = int(maturityPayout * exp(-discountPerHour * remainingHours))`.
 */
export function bondSaleValue(
  principal: number,
  rateBps: number,
  nowMs: number,
  dueMs: number,
  discountPerHour: number,
): number {
  const payout = bondMaturityPayout(principal, rateBps);
  const remHours = Math.max(0, (dueMs - nowMs) / 3_600_000);
  if (remHours <= 0) return payout;
  return truncInt(payout * Math.exp(-discountPerHour * remHours));
}
