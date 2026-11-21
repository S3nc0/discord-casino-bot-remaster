import { QUANTITY_SCALE, type Rng } from '@casino/shared';
import {
  BPS_SCALE,
  microsToPrice,
  priceToMicros,
  roundHalfEven,
  roundTo,
  standardNormal,
  truncInt,
} from '../math.ts';
import {
  MARKET_CONSTANTS,
  MARKET_SYMBOLS,
  PIN_BLOCKED_ACTIONS,
  SYMBOL_BY_KEY,
  SYMBOL_CORRELATIONS,
  type PinnableAction,
  type PinState,
  type SymbolKey,
} from './constants.ts';
import { volatilityMultiplier, type VolatilityEvent } from './events.ts';

/** 4x4 1-minute log-return covariance matrix `Σ[i][j] = σ_i * σ_j * ρ_ij` in `[cs, teio, numa, gold]` order. */
export function covarianceMatrix(): number[][] {
  const n = MARKET_SYMBOLS.length;
  const cov: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    const sI = MARKET_SYMBOLS[i]!.sigma;
    for (let j = 0; j < n; j++) {
      const sJ = MARKET_SYMBOLS[j]!.sigma;
      const rho = SYMBOL_CORRELATIONS[i]?.[j] ?? 0;
      row.push(sI * sJ * rho);
    }
    cov.push(row);
  }
  return cov;
}

/** Lower-triangular Cholesky decomposition `L` satisfying `Σ = L * L^T`. */
export function choleskyDecomposition(matrix: readonly (readonly number[])[]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += (L[i]![k] ?? 0) * (L[j]![k] ?? 0);
      }
      const val = (matrix[i]?.[j] ?? 0) - sum;
      if (i === j) {
        L[i]![j] = Math.sqrt(Math.max(0, val));
      } else {
        const diag = L[j]![j] ?? 0;
        L[i]![j] = diag > 0 ? val / diag : 0;
      }
    }
  }
  return L;
}

export const COVARIANCE_MATRIX: readonly (readonly number[])[] = covarianceMatrix();
export const CHOLESKY_L: readonly (readonly number[])[] = choleskyDecomposition(COVARIANCE_MATRIX);

export interface MarketTickOptions {
  readonly events?: readonly VolatilityEvent[];
  readonly nowMs?: number;
  /** Optional explicit standard normals (length 4) for deterministic replay/testing. */
  readonly standardNormals?: readonly number[];
  /** Optional explicit panic roll (`0` = none, `+1` / `-1` with `size`) for replay/testing. */
  readonly panicOverride?: { readonly direction: -1 | 0 | 1; readonly size: number };
}

export interface MarketTickResult {
  readonly fairMicros: Record<SymbolKey, number>;
  /** `-1`, `0`, or `+1` panic shock indicator (matches legacy `shocks` return). */
  readonly shockDirection: -1 | 0 | 1;
}

/**
 * Advance global fair prices by one 1-minute correlated Cholesky tick.
 * Floating-point log-normal simulation is isolated inside this function and rounded to 2 decimal
 * places (`roundTo(x, 2)` -> integer micro-Pelica) clamped to `[20, 50_000]` at the boundary.
 */
export function nextMarketPrices(
  currentFairMicros: Readonly<Record<SymbolKey, number>>,
  rng: Rng,
  options: MarketTickOptions = {},
): MarketTickResult {
  const n = MARKET_SYMBOLS.length;
  const z =
    options.standardNormals && options.standardNormals.length === n
      ? options.standardNormals
      : Array.from({ length: n }, () => standardNormal(rng));

  const shocks: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k <= i; k++) {
      s += (CHOLESKY_L[i]![k] ?? 0) * (z[k] ?? 0);
    }
    shocks[i] = s;
  }

  let shockDirection: -1 | 0 | 1 = 0;
  let panicSize = 0;
  if (options.panicOverride) {
    shockDirection = options.panicOverride.direction;
    panicSize = options.panicOverride.size;
  } else if (rng.float() < 1 / MARKET_CONSTANTS.eventIntervalMinutes) {
    shockDirection = rng.int(0, 2) === 0 ? -1 : 1;
    panicSize =
      MARKET_CONSTANTS.eventRangeLo +
      (MARKET_CONSTANTS.eventRangeHi - MARKET_CONSTANTS.eventRangeLo) * rng.float();
  }

  const csSigma = SYMBOL_BY_KEY.cs.sigma;
  const lnDriftBand = Math.log(MARKET_CONSTANTS.driftBand);
  const events = options.events ?? [];
  const nowMs = options.nowMs ?? 0;
  const minPrice = microsToPrice(MARKET_CONSTANTS.minPriceMicros);
  const maxPrice = microsToPrice(MARKET_CONSTANTS.maxPriceMicros);

  const nextFair: Record<SymbolKey, number> = {
    cs: currentFairMicros.cs,
    teio: currentFairMicros.teio,
    numa: currentFairMicros.numa,
    gold: currentFairMicros.gold,
  };

  for (let i = 0; i < n; i++) {
    const sym = MARKET_SYMBOLS[i]!;
    const fair = microsToPrice(currentFairMicros[sym.key]);
    const start = microsToPrice(sym.startMicros);

    let d: number;
    if (sym.drift <= 0 || fair <= start) {
      d = sym.drift / 1440.0;
    } else {
      const fade = Math.max(0.0, 1.0 - Math.log(fair / start) / lnDriftBand);
      d = (sym.drift * fade) / 1440.0;
    }

    const mult = events.length > 0 ? volatilityMultiplier(events, sym.key, nowMs) : 1.0;
    const varII = COVARIANCE_MATRIX[i]![i] ?? 0;
    const panicScale = Math.min(MARKET_CONSTANTS.eventScaleMax, sym.sigma / csSigma);
    const panicFactor = 1.0 + shockDirection * panicSize * panicScale;
    const factor =
      Math.exp(d - (mult * mult * varII) / 2.0 + mult * (shocks[i] ?? 0)) * panicFactor;

    const rawNext = roundTo(fair * factor, 2);
    const clamped = Math.min(maxPrice, Math.max(minPrice, rawNext));
    nextFair[sym.key] = priceToMicros(clamped);
  }

  return { fairMicros: nextFair, shockDirection };
}

/**
 * Clamp fair prices to ±30% daily limits relative to 24h-ago reference prices (`refMicros`).
 * Boundary rounding: 2 decimal places (`roundTo(..., 2)` -> integer micro-Pelica).
 */
export function limitToDay(
  fairMicros: Readonly<Record<SymbolKey, number>>,
  refMicros: Readonly<Partial<Record<SymbolKey, number>>>,
  limitBps: number = MARKET_CONSTANTS.dailyLimitBps,
): Record<SymbolKey, number> {
  const limit = limitBps / BPS_SCALE;
  const out = { ...fairMicros };
  for (const sym of MARKET_SYMBOLS) {
    const ref = refMicros[sym.key];
    if (ref === undefined || ref <= 0) continue;
    const fair = microsToPrice(fairMicros[sym.key]);
    const refPrice = microsToPrice(ref);
    const lo = roundTo(refPrice * (1 - limit), 2);
    const hi = roundTo(refPrice * (1 + limit), 2);
    out[sym.key] = priceToMicros(Math.min(hi, Math.max(lo, fair)));
  }
  return out;
}

/**
 * Determine daily-limit pin state for each ticker:
 * `+1` (limit-up) if `fair >= ref * (1 + limit)`, `-1` (limit-down) if `fair <= ref * (1 - limit)`,
 * else `0`.
 */
export function pinStates(
  fairMicros: Readonly<Record<SymbolKey, number>>,
  refMicros: Readonly<Partial<Record<SymbolKey, number>>>,
  limitBps: number = MARKET_CONSTANTS.dailyLimitBps,
): Record<SymbolKey, PinState> {
  const limit = limitBps / BPS_SCALE;
  const out: Record<SymbolKey, PinState> = { cs: 0, teio: 0, numa: 0, gold: 0 };
  for (const sym of MARKET_SYMBOLS) {
    const ref = refMicros[sym.key];
    if (ref === undefined || ref <= 0) continue;
    const fair = microsToPrice(fairMicros[sym.key]);
    const refPrice = microsToPrice(ref);
    if (fair >= refPrice * (1 + limit)) {
      out[sym.key] = 1;
    } else if (fair <= refPrice * (1 - limit)) {
      out[sym.key] = -1;
    }
  }
  return out;
}

/** True when `action` is blocked by the symbol's current daily-limit pin lock. */
export function isActionPinned(pin: PinState, action: PinnableAction): boolean {
  return PIN_BLOCKED_ACTIONS[pin].includes(action);
}

/**
 * Progressive capital gains tax on realized spot/margin profit:
 *   0..10,000 -> 0%
 *   10,001..100,000 -> 3%
 *   100,001..1,000,000 -> 7%
 *   1,000,001+ -> 12%
 * Truncated to integer Pelica (`int(tax)`).
 */
export function capitalGainsTax(profit: number): number {
  if (profit <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const bracket of MARKET_CONSTANTS.gainsTaxBrackets) {
    if (profit <= prev) break;
    const upper = bracket.limit === null ? profit : Math.min(profit, bracket.limit);
    const slice = upper - prev;
    if (slice > 0 && bracket.rateBps > 0) {
      tax += (slice * bracket.rateBps) / BPS_SCALE;
    }
    if (bracket.limit === null) break;
    prev = bracket.limit;
  }
  return truncInt(tax);
}

export interface SpotBuyQuote {
  readonly unitsMilli: number;
  /** Total Pelica charged to the buyer (`gross + fee <= budget`). */
  readonly total: number;
  readonly fee: number;
}

/**
 * Spot buy quote (`domain/market.py:buy_quote`):
 * Given integer budget `amount` and unit price `priceMicros`, computes the maximum milli-units
 * purchasable where `gross = ceil(round(units * price / 1000, 6))` and `fee = ceil(gross * feeRate)`
 * satisfy `gross + fee <= amount`.
 * Rounding: gross and fee round UP (charged to player).
 */
export function spotBuyQuote(
  amount: number,
  priceMicros: number,
  feeRateBps: number = MARKET_CONSTANTS.feeRateBps,
): SpotBuyQuote {
  if (amount <= 0 || priceMicros <= 0) {
    return { unitsMilli: 0, total: 0, fee: 0 };
  }
  const price = microsToPrice(priceMicros);
  const feeRate = feeRateBps / BPS_SCALE;
  let units = Math.floor((amount * QUANTITY_SCALE) / (price * (1 + feeRate)));
  while (units > 0) {
    const gross = Math.ceil(roundTo((units * price) / QUANTITY_SCALE, 6));
    const fee = Math.ceil(gross * feeRate);
    if (gross + fee <= amount) {
      return { unitsMilli: units, total: gross + fee, fee };
    }
    units -= 1;
  }
  return { unitsMilli: 0, total: 0, fee: 0 };
}

export interface SpotSellQuote {
  /** Net Pelica before capital gains tax (`max(0, gross - fee)`). */
  readonly proceeds: number;
  readonly gross: number;
  readonly fee: number;
}

/**
 * Spot sell quote (`domain/market.py:sell_quote`):
 * `gross = floor(round(units * price / 1000, 6))`, `fee = ceil(gross * feeRate)`.
 * Rounding: proceeds round DOWN (paid to player); fee rounds UP.
 */
export function spotSellQuote(
  unitsMilli: number,
  priceMicros: number,
  feeRateBps: number = MARKET_CONSTANTS.feeRateBps,
): SpotSellQuote {
  if (unitsMilli <= 0 || priceMicros <= 0) {
    return { proceeds: 0, gross: 0, fee: 0 };
  }
  const price = microsToPrice(priceMicros);
  const feeRate = feeRateBps / BPS_SCALE;
  const gross = Math.floor(roundTo((unitsMilli * price) / QUANTITY_SCALE, 6));
  const fee = Math.ceil(gross * feeRate);
  return { proceeds: Math.max(0, gross - fee), gross, fee };
}

/**
 * Cost basis removed on selling `sellUnitsMilli` out of `heldUnitsMilli`:
 * Full sell removes exact `totalCost`; partial sell uses banker's rounding `roundHalfEven`
 * matching Python's `round(cost * u / have)`.
 */
export function removedCostBasis(
  totalCost: number,
  sellUnitsMilli: number,
  heldUnitsMilli: number,
): number {
  if (sellUnitsMilli <= 0 || heldUnitsMilli <= 0) return 0;
  if (sellUnitsMilli >= heldUnitsMilli) return totalCost;
  return roundHalfEven((totalCost * sellUnitsMilli) / heldUnitsMilli);
}

/** Average acquisition price per 1.000 share in micro-Pelica. */
export function avgPriceMicros(unitsMilli: number, cost: number): number {
  if (unitsMilli <= 0) return 0;
  return priceToMicros((cost * QUANTITY_SCALE) / unitsMilli);
}

/** Unrealized spot PnL percentage (`(price - avgPrice) / avgPrice * 100`). */
export function spotPnlPercent(priceMicros: number, unitsMilli: number, cost: number): number {
  if (unitsMilli <= 0 || cost <= 0) return 0;
  const avg = (cost * QUANTITY_SCALE) / unitsMilli;
  const price = microsToPrice(priceMicros);
  return ((price - avg) / avg) * 100;
}

/**
 * Detect whether a price change over a window crosses the `MarketMove` alert threshold
 * (default ±5% = ±500 bps). Returns `{ direction, changeBps }` or `null`.
 */
export function detectMarketMove(
  windowStartPriceMicros: number,
  currentPriceMicros: number,
  thresholdBps: number = MARKET_CONSTANTS.moveAlertThresholdBps,
): { readonly direction: 'spike' | 'crash'; readonly changeBps: number } | null {
  if (windowStartPriceMicros <= 0 || currentPriceMicros <= 0) return null;
  const changeBps = Math.round(
    ((currentPriceMicros - windowStartPriceMicros) / windowStartPriceMicros) * BPS_SCALE,
  );
  if (changeBps >= thresholdBps) return { direction: 'spike', changeBps };
  if (changeBps <= -thresholdBps) return { direction: 'crash', changeBps };
  return null;
}
