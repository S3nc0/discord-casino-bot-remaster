import { QUANTITY_SCALE } from '@casino/shared';
import {
  BPS_SCALE,
  microsToPrice,
  normalCdf,
  priceToMicros,
  roundTo,
  truncInt,
} from '../math.ts';
import {
  MARKET_CONSTANTS,
  MARKET_SYMBOLS,
  OPTION_CONSTANTS,
  SYMBOL_BY_KEY,
  VOLATILITY_EVENT_CONSTANTS,
  type SymbolKey,
} from './constants.ts';
import { earningsJumpVariance } from './earnings.ts';
import {
  expectedEventTicks,
  extraVarianceTicks,
  isEarningsJumpEvent,
  type MarketPricingEvent,
} from './events.ts';
import { COVARIANCE_MATRIX } from './market.ts';

function symbolIndex(sym: SymbolKey): number {
  return MARKET_SYMBOLS.findIndex((s) => s.key === sym);
}

/** `E[size^2] = (hi^3 - lo^3) / (3 * (hi - lo))` for uniform panic jump size. */
const PANIC_SIZE_SECOND_MOMENT =
  (MARKET_CONSTANTS.eventRangeHi ** 3 - MARKET_CONSTANTS.eventRangeLo ** 3) /
  (3 * (MARKET_CONSTANTS.eventRangeHi - MARKET_CONSTANTS.eventRangeLo));

const PANIC_PROB_PER_TICK = 1 / MARKET_CONSTANTS.eventIntervalMinutes;

function panicScale(sym: SymbolKey): number {
  return Math.min(MARKET_CONSTANTS.eventScaleMax, SYMBOL_BY_KEY[sym].sigma / SYMBOL_BY_KEY.cs.sigma);
}

/** Per-tick panic jump variance for a single ticker. */
export function singleJumpVariancePerTick(sym: SymbolKey): number {
  const s = panicScale(sym);
  return PANIC_PROB_PER_TICK * PANIC_SIZE_SECOND_MOMENT * s * s;
}

/**
 * Total log-return variance over `horizonSeconds` for a single asset, combining:
 * 1. Base diffusion + panic jump variance per 1-min tick.
 * 2. Baseline expected future volatility-event variance (when no volatility event is live on `sym`).
 * 3. Any announced/active volatility event overlap and upcoming earnings jump variance.
 */
export function optionTotalVariance(
  symbol: SymbolKey,
  horizonSeconds: number,
  nowMs: number,
  events: readonly MarketPricingEvent[] = [],
): number {
  if (horizonSeconds <= 0) return 0;
  const idx = symbolIndex(symbol);
  const sigmaII = COVARIANCE_MATRIX[idx]?.[idx] ?? 0;
  const ticks = horizonSeconds / OPTION_CONSTANTS.tickSeconds;
  let variance = ticks * (sigmaII + singleJumpVariancePerTick(symbol));

  const horizonEndMs = nowMs + horizonSeconds * 1_000;
  let hasVolEvent = false;
  for (const ev of events) {
    if (ev.symbol !== symbol) continue;
    if (isEarningsJumpEvent(ev)) {
      if (nowMs < ev.jumpAtMs && ev.jumpAtMs <= horizonEndMs) {
        variance += ev.jumpVar > 0 ? ev.jumpVar : earningsJumpVariance();
      }
    } else {
      if (ev.endAtMs > nowMs && ev.announceAtMs <= nowMs) {
        hasVolEvent = true;
      }
      const extra = extraVarianceTicks(ev, nowMs, horizonSeconds, OPTION_CONSTANTS.tickSeconds);
      if (extra > 0) {
        const factor = ev.factorBps / BPS_SCALE;
        variance += extra * sigmaII * (factor * factor - 1);
      }
    }
  }

  if (!hasVolEvent) {
    const defaultFactor = VOLATILITY_EVENT_CONSTANTS.factorBps / BPS_SCALE;
    variance +=
      expectedEventTicks(horizonSeconds, OPTION_CONSTANTS.tickSeconds) *
      sigmaII *
      (defaultFactor * defaultFactor - 1);
  }

  return variance;
}

/**
 * Relative log-return variance `Var(ln(A/B))` over `horizonSeconds` for a Margrabe pair warrant.
 */
export function pairOptionVariance(
  symA: SymbolKey,
  symB: SymbolKey,
  horizonSeconds: number,
  nowMs: number,
  events: readonly MarketPricingEvent[] = [],
): number {
  if (horizonSeconds <= 0) return 0;
  const iA = symbolIndex(symA);
  const iB = symbolIndex(symB);
  const sigmaAA = COVARIANCE_MATRIX[iA]?.[iA] ?? 0;
  const sigmaBB = COVARIANCE_MATRIX[iB]?.[iB] ?? 0;
  const sigmaAB = COVARIANCE_MATRIX[iA]?.[iB] ?? 0;
  const scaleDiff = panicScale(symA) - panicScale(symB);
  const ticks = horizonSeconds / OPTION_CONSTANTS.tickSeconds;

  let variance =
    ticks *
    (sigmaAA +
      sigmaBB -
      2 * sigmaAB +
      PANIC_PROB_PER_TICK * PANIC_SIZE_SECOND_MOMENT * scaleDiff * scaleDiff);

  const horizonEndMs = nowMs + horizonSeconds * 1_000;
  const hasVol = { [symA]: false, [symB]: false } as Record<SymbolKey, boolean>;

  for (const ev of events) {
    if (ev.symbol !== symA && ev.symbol !== symB) continue;
    if (isEarningsJumpEvent(ev)) {
      if (nowMs < ev.jumpAtMs && ev.jumpAtMs <= horizonEndMs) {
        variance += ev.jumpVar > 0 ? ev.jumpVar : earningsJumpVariance();
      }
    } else {
      if (ev.endAtMs > nowMs && ev.announceAtMs <= nowMs) {
        hasVol[ev.symbol] = true;
      }
      const extra = extraVarianceTicks(ev, nowMs, horizonSeconds, OPTION_CONSTANTS.tickSeconds);
      if (extra > 0) {
        const factor = ev.factorBps / BPS_SCALE;
        const ownVar = ev.symbol === symA ? sigmaAA : sigmaBB;
        // When one leg's volatility multiplies by factor, its variance scales by factor^2 and
        // cross-covariance scales by factor: delta = ownVar*(f^2 - 1) - 2*sigmaAB*(f - 1)
        variance += extra * (ownVar * (factor * factor - 1) - 2 * sigmaAB * (factor - 1));
      }
    }
  }

  const defaultFactor = VOLATILITY_EVENT_CONSTANTS.factorBps / BPS_SCALE;
  const expTicks = expectedEventTicks(horizonSeconds, OPTION_CONSTANTS.tickSeconds);
  if (!hasVol[symA]) {
    variance +=
      expTicks * (sigmaAA * (defaultFactor * defaultFactor - 1) - 2 * sigmaAB * (defaultFactor - 1));
  }
  if (!hasVol[symB]) {
    variance +=
      expTicks * (sigmaBB * (defaultFactor * defaultFactor - 1) - 2 * sigmaAB * (defaultFactor - 1));
  }

  return Math.max(0, variance);
}

/**
 * Zero-interest European Black-Scholes fair price per 1.000 share (`r = 0`).
 * Floating-point pricing math; callers apply spread and round to integer Pelica at boundary.
 */
export function blackScholesFairPrice(
  kind: 'call' | 'put',
  spot: number,
  strike: number,
  variance: number,
): number {
  if (spot <= 0 || strike <= 0) return 0;
  if (variance <= 1e-12) {
    return kind === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }
  const vol = Math.sqrt(variance);
  const d1 = (Math.log(spot / strike) + variance / 2) / vol;
  const d2 = d1 - vol;
  if (kind === 'call') {
    return Math.max(0, spot * normalCdf(d1) - strike * normalCdf(d2));
  }
  return Math.max(0, strike * normalCdf(-d2) - spot * normalCdf(-d1));
}

/**
 * Default or custom OTM strike price in integer micro-Pelica (rounded to 2 decimals).
 * When `symbol` is omitted and `customPct` is omitted, uses fallback `strike_otm = 2%`.
 */
export function optionStrikeMicros(
  kind: 'call' | 'put',
  spotMicros: number,
  symbol?: SymbolKey,
  customTargetPct?: number,
): number {
  const spot = microsToPrice(spotMicros);
  const pct =
    customTargetPct !== undefined
      ? customTargetPct / 100
      : symbol !== undefined
        ? SYMBOL_BY_KEY[symbol].defaultStrikeOtmBps / BPS_SCALE
        : OPTION_CONSTANTS.defaultStrikeOtmBps / BPS_SCALE;
  const raw = kind === 'call' ? spot * (1 + pct) : spot * (1 - pct);
  return priceToMicros(roundTo(raw, 2));
}

/** Ask price per 1 milli-unit (`fair * 1.015 / 1000`). */
export function optionAskPerUnit(
  kind: 'call' | 'put',
  symbol: SymbolKey,
  spotMicros: number,
  strikeMicros: number,
  horizonSeconds: number,
  nowMs: number,
  events: readonly MarketPricingEvent[] = [],
): number {
  const v = optionTotalVariance(symbol, horizonSeconds, nowMs, events);
  const fair = blackScholesFairPrice(kind, microsToPrice(spotMicros), microsToPrice(strikeMicros), v);
  return (fair * (1 + OPTION_CONSTANTS.spreadBps / BPS_SCALE)) / QUANTITY_SCALE;
}

/** Bid price per 1 milli-unit (`fair * 0.985 / 1000`). */
export function optionBidPerUnit(
  kind: 'call' | 'put',
  symbol: SymbolKey,
  spotMicros: number,
  strikeMicros: number,
  horizonSeconds: number,
  nowMs: number,
  events: readonly MarketPricingEvent[] = [],
): number {
  const v = optionTotalVariance(symbol, horizonSeconds, nowMs, events);
  const fair = blackScholesFairPrice(kind, microsToPrice(spotMicros), microsToPrice(strikeMicros), v);
  return (fair * (1 - OPTION_CONSTANTS.spreadBps / BPS_SCALE)) / QUANTITY_SCALE;
}

/** Intrinsic payout at expiry in integer Pelica (`int(max(0, ±(spot - strike)) * units / 1000)`). */
export function optionIntrinsic(
  kind: 'call' | 'put',
  unitsMilli: number,
  spotMicros: number,
  strikeMicros: number,
): number {
  const spot = microsToPrice(spotMicros);
  const strike = microsToPrice(strikeMicros);
  const diff = kind === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  return truncInt((diff * unitsMilli) / QUANTITY_SCALE);
}

/** Long option buyer payout capped at `50 * premium`. */
export function optionBuyerPayout(intrinsicPelica: number, premiumPelica: number): number {
  return Math.min(Math.max(0, intrinsicPelica), premiumPelica * OPTION_CONSTANTS.payoutCapMult);
}

/** Margrabe exchange fair rate `C(relA, relB, v)`. */
export function pairFairRate(relA: number, relB: number, variance: number): number {
  return blackScholesFairPrice('call', relA, relB, variance);
}

/** Pair warrant ask rate (`pairFairRate(1, 1, v) * 1.015`). */
export function pairAskRate(
  symA: SymbolKey,
  symB: SymbolKey,
  horizonSeconds: number,
  nowMs: number,
  events: readonly MarketPricingEvent[] = [],
): number {
  const v = pairOptionVariance(symA, symB, horizonSeconds, nowMs, events);
  return pairFairRate(1.0, 1.0, v) * (1 + OPTION_CONSTANTS.spreadBps / BPS_SCALE);
}

/** Pair warrant early-sell bid rate (`pairFairRate(relA, relB, v) * 0.985`). */
export function pairBidRate(
  symA: SymbolKey,
  symB: SymbolKey,
  relA: number,
  relB: number,
  horizonSeconds: number,
  nowMs: number,
  events: readonly MarketPricingEvent[] = [],
): number {
  const v = pairOptionVariance(symA, symB, horizonSeconds, nowMs, events);
  return pairFairRate(relA, relB, v) * (1 - OPTION_CONSTANTS.spreadBps / BPS_SCALE);
}

/**
 * Pair warrant intrinsic value at expiry (`int(notional * max(0, aT / a0 - bT / b0))`).
 * Preserves IEEE 754 evaluation order matching legacy `options.pair_intrinsic`.
 */
export function pairIntrinsic(
  notional: number,
  a0Micros: number,
  b0Micros: number,
  aTMicros: number,
  bTMicros: number,
): number {
  if (notional <= 0 || a0Micros <= 0 || b0Micros <= 0) return 0;
  const relA = microsToPrice(aTMicros) / microsToPrice(a0Micros);
  const relB = microsToPrice(bTMicros) / microsToPrice(b0Micros);
  return truncInt(notional * Math.max(0.0, relA - relB));
}

/** Naked short option margin required: `ceil(0.20 * strike * units / 1000)` (rounds UP). */
export function shortOptionMarginRequired(strikeMicros: number, unitsMilli: number): number {
  const strike = microsToPrice(strikeMicros);
  return Math.ceil(((OPTION_CONSTANTS.marginRateBps / BPS_SCALE) * strike * unitsMilli) / QUANTITY_SCALE);
}
