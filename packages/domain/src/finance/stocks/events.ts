import type { Rng } from '@casino/shared';
import { BPS_SCALE, MS_PER_MINUTE } from '../math.ts';
import {
  MARKET_SYMBOLS,
  SYMBOL_CORRELATIONS,
  VOLATILITY_EVENT_CONSTANTS,
  type SymbolKey,
} from './constants.ts';

export interface VolatilityEvent {
  readonly symbol: SymbolKey;
  /** Volatility multiplier in basis points (20_000 = 2.0x). */
  readonly factorBps: number;
  readonly announceAtMs: number;
  readonly startAtMs: number;
  readonly endAtMs: number;
}

export type MarketPricingEvent =
  | VolatilityEvent
  | {
      readonly symbol: SymbolKey;
      readonly jumpAtMs: number;
      readonly jumpVar: number;
    };

/** Type guard distinguishing earnings jump events from volatility window events. */
export function isEarningsJumpEvent(
  ev: MarketPricingEvent,
): ev is { readonly symbol: SymbolKey; readonly jumpAtMs: number; readonly jumpVar: number } {
  return 'jumpVar' in ev;
}

/**
 * Plan a new announced volatility event starting `leadMin` (15m) from `nowMs` and lasting
 * `durationMin` (20m) with `2.0x` volatility multiplier.
 */
export function planVolatilityEvent(nowMs: number, rng: Rng): VolatilityEvent {
  const idx = rng.int(0, MARKET_SYMBOLS.length);
  const sym = (MARKET_SYMBOLS[idx] ?? MARKET_SYMBOLS[0])!;
  const startAtMs = nowMs + VOLATILITY_EVENT_CONSTANTS.leadMin * MS_PER_MINUTE;
  const endAtMs = startAtMs + VOLATILITY_EVENT_CONSTANTS.durationMin * MS_PER_MINUTE;
  return {
    symbol: sym.key,
    factorBps: VOLATILITY_EVENT_CONSTANTS.factorBps,
    announceAtMs: nowMs,
    startAtMs,
    endAtMs,
  };
}

/**
 * Decide whether to trigger a new volatility event on the current 1-minute tick:
 * only when no event is currently active/announced and cooldown (60m) has elapsed since `lastEndAtMs`.
 */
export function maybeRollVolatilityEvent(
  nowMs: number,
  activeEvents: readonly VolatilityEvent[],
  lastEndAtMs: number | null,
  rng: Rng,
): VolatilityEvent | null {
  const hasLive = activeEvents.some((e) => e.endAtMs > nowMs);
  if (hasLive) return null;
  if (
    lastEndAtMs !== null &&
    nowMs - lastEndAtMs < VOLATILITY_EVENT_CONSTANTS.cooldownMin * MS_PER_MINUTE
  ) {
    return null;
  }
  if (rng.float() < 1 / VOLATILITY_EVENT_CONSTANTS.announceIntervalMinutes) {
    return planVolatilityEvent(nowMs, rng);
  }
  return null;
}

/** Active volatility multiplier (`2.0` during `[startAtMs, endAtMs)`, else `1.0`). */
export function volatilityMultiplier(
  events: readonly VolatilityEvent[],
  symbol: SymbolKey,
  nowMs: number,
): number {
  let mult = 1.0;
  for (const ev of events) {
    if (ev.symbol === symbol && ev.startAtMs <= nowMs && nowMs < ev.endAtMs) {
      mult *= ev.factorBps / BPS_SCALE;
    }
  }
  return mult;
}

/**
 * Extra variance ticks contributed by an announced/active volatility event overlapping
 * `[nowMs, nowMs + horizonSeconds * 1000]`.
 * Fully priced in at announcement (`pricedAtAnnounce = 1.0`).
 */
export function extraVarianceTicks(
  ev: VolatilityEvent,
  nowMs: number,
  horizonSeconds: number,
  tickSeconds = 60,
): number {
  if (nowMs < ev.announceAtMs) return 0;
  const horizonEndMs = nowMs + horizonSeconds * 1_000;
  const overlapStart = Math.max(nowMs, ev.startAtMs);
  const overlapEnd = Math.min(horizonEndMs, ev.endAtMs);
  if (overlapEnd <= overlapStart) return 0;
  const overlapSec = (overlapEnd - overlapStart) / 1_000;
  const weight = nowMs >= ev.startAtMs ? 1.0 : VOLATILITY_EVENT_CONSTANTS.pricedAtAnnounce;
  return (overlapSec / tickSeconds) * weight;
}

/** Expected baseline volatility-event ticks per symbol over `horizonSeconds` when no event is live. */
export function expectedEventTicks(horizonSeconds: number, tickSeconds = 60): number {
  const cycleMin =
    VOLATILITY_EVENT_CONSTANTS.announceIntervalMinutes +
    VOLATILITY_EVENT_CONSTANTS.leadMin +
    VOLATILITY_EVENT_CONSTANTS.durationMin +
    VOLATILITY_EVENT_CONSTANTS.cooldownMin;
  return (
    ((horizonSeconds / tickSeconds) * VOLATILITY_EVENT_CONSTANTS.durationMin) /
    cycleMin /
    MARKET_SYMBOLS.length
  );
}

export interface SpreadAlert {
  readonly symbolA: SymbolKey;
  readonly symbolB: SymbolKey;
  readonly corr: number;
  readonly zScore: number;
}

/**
 * Detect correlation breakdown spread alerts across strongly correlated pairs (`|rho| >= 0.5`)
 * over a window of `sampleCount >= 10` ticks. Returns alerts with `|z| >= 2.5` sorted by `|z|`
 * descending (top 3).
 */
export function detectSpreadAlerts(
  logReturns: Readonly<Partial<Record<SymbolKey, number>>>,
  sampleCount: number,
): readonly SpreadAlert[] {
  if (sampleCount < VOLATILITY_EVENT_CONSTANTS.alertMinSamples) return [];
  const alerts: SpreadAlert[] = [];

  for (let i = 0; i < MARKET_SYMBOLS.length; i++) {
    const symA = MARKET_SYMBOLS[i]!;
    const rA = logReturns[symA.key];
    if (rA === undefined) continue;
    for (let j = i + 1; j < MARKET_SYMBOLS.length; j++) {
      const symB = MARKET_SYMBOLS[j]!;
      const rB = logReturns[symB.key];
      if (rB === undefined) continue;
      const rho = SYMBOL_CORRELATIONS[i]?.[j] ?? 0;
      if (Math.abs(rho) < VOLATILITY_EVENT_CONSTANTS.minAbsCorr) continue;
      const sign = rho >= 0 ? 1 : -1;
      const sigmaAA = symA.sigma * symA.sigma;
      const sigmaBB = symB.sigma * symB.sigma;
      const sigmaAB = symA.sigma * symB.sigma * rho;
      const denom = Math.sqrt(
        Math.max(1e-18, (sigmaAA + sigmaBB - 2 * sign * sigmaAB) * sampleCount),
      );
      const zScore = (rA - sign * rB) / denom;
      if (Math.abs(zScore) >= VOLATILITY_EVENT_CONSTANTS.zAlertThreshold) {
        alerts.push({ symbolA: symA.key, symbolB: symB.key, corr: rho, zScore });
      }
    }
  }

  alerts.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  return alerts.slice(0, 3);
}
