import { PRICE_SCALE, QUANTITY_SCALE } from '@casino/shared';
import { BPS_SCALE, microsToPrice, roundHalfEven, truncInt } from '../math.ts';
import {
  MARKET_CONSTANTS,
  MARKET_SYMBOLS,
  type MarginSide,
  type SymbolKey,
} from './constants.ts';
import { COVARIANCE_MATRIX } from './market.ts';

/**
 * Portfolio cross-margin required margin:
 * `requiredMargin(w) = 20.0 * sqrt(max(0, w^T Σ w))`,
 * where `w[s]` is signed exposure (`+notional` for long, `-notional` for short).
 * Unknown symbol keys are ignored (matching legacy `market.required_margin`).
 */
export function requiredMargin(exposures: Readonly<Record<string, number>>): number {
  const n = MARKET_SYMBOLS.length;
  const w: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const key = MARKET_SYMBOLS[i]!.key;
    w[i] = exposures[key] ?? 0;
  }
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const wi = w[i] ?? 0;
    if (wi === 0) continue;
    for (let j = 0; j < n; j++) {
      const wj = w[j] ?? 0;
      if (wj === 0) continue;
      variance += wi * wj * (COVARIANCE_MATRIX[i]![j] ?? 0);
    }
  }
  return MARKET_CONSTANTS.riskK * Math.sqrt(Math.max(0, variance));
}

/**
 * Margin position unrealized/realized PnL in integer Pelica:
 * - Long: `roundHalfEven(nowValue - entryValue)`
 * - Short: `roundHalfEven(entryValue - nowValue)`
 * where `nowValue = unitsMilli * price / 1000` and `entryValue = entryValueMicros / 1_000_000`.
 */
export function marginPnl(
  side: MarginSide,
  unitsMilli: number,
  entryValueMicros: number,
  priceMicros: number,
): number {
  const nowValue = (unitsMilli * microsToPrice(priceMicros)) / QUANTITY_SCALE;
  const entryValue = entryValueMicros / PRICE_SCALE;
  return side === 'long'
    ? roundHalfEven(nowValue - entryValue)
    : roundHalfEven(entryValue - nowValue);
}

/**
 * Principal base on which daily margin financing interest is charged (CODE behaviour):
 * - Long (`0.10%/day`): `max(0, entryValue - margin)` (borrowed funds only).
 * - Short (`0.05%/day`): `max(0, entryValue)` (stock-lending fee on full notional).
 */
export function marginInterestBaseMicros(
  side: MarginSide,
  entryValueMicros: number,
  marginPelica: number,
): number {
  if (side === 'long') {
    return Math.max(0, entryValueMicros - marginPelica * PRICE_SCALE);
  }
  return Math.max(0, entryValueMicros);
}

/**
 * Accrue margin financing interest over `elapsedSeconds` and determine integer charge once
 * accumulated interest reaches `INTEREST_MIN_CHARGE = 10` Pelica.
 */
export function accrueMarginInterest(input: {
  readonly side: MarginSide;
  readonly entryValueMicros: number;
  readonly marginPelica: number;
  readonly accruedMicros: number;
  readonly elapsedSeconds: number;
}): {
  readonly chargePelica: number;
  readonly nextAccruedMicros: number;
  readonly marginDeducted: number;
  readonly debtOverflow: number;
} {
  if (input.elapsedSeconds <= 0) {
    return {
      chargePelica: 0,
      nextAccruedMicros: input.accruedMicros,
      marginDeducted: 0,
      debtOverflow: 0,
    };
  }
  const base = marginInterestBaseMicros(input.side, input.entryValueMicros, input.marginPelica) / PRICE_SCALE;
  const ratePerDay = MARKET_CONSTANTS.borrowRatePerDayBps[input.side] / BPS_SCALE;
  const added = base * ratePerDay * (input.elapsedSeconds / 86_400);
  const total = input.accruedMicros / PRICE_SCALE + added;

  if (total < MARKET_CONSTANTS.interestMinCharge) {
    return {
      chargePelica: 0,
      nextAccruedMicros: Math.round(total * PRICE_SCALE),
      marginDeducted: 0,
      debtOverflow: 0,
    };
  }

  const chargePelica = truncInt(total);
  const nextAccruedMicros = Math.max(0, Math.round((total - chargePelica) * PRICE_SCALE));
  const marginDeducted = Math.min(Math.max(0, input.marginPelica), chargePelica);
  const debtOverflow = chargePelica - marginDeducted;
  return { chargePelica, nextAccruedMicros, marginDeducted, debtOverflow };
}

export interface MarginPositionSnapshot {
  readonly symbol: SymbolKey;
  readonly side: MarginSide;
  readonly unitsMilli: number;
  readonly entryValueMicros: number;
  readonly margin: number;
}

export interface PortfolioMarginStatus {
  readonly equity: number;
  readonly required: number;
  /** `equity / required`, or `null` when no margin positions are open (`required === 0`). */
  readonly ratio: number | null;
  readonly meetsOpenRatio: boolean;
  readonly needsLossCut: boolean;
}

/**
 * Compute cross-margin portfolio equity, required margin, and maintenance ratio:
 * `equity = sum(pos.margin + pnl) + 0.80 * spotValue + 0.95 * normalBonds + 0.50 * junkBonds`.
 */
export function computePortfolioMarginStatus(input: {
  readonly positions: readonly MarginPositionSnapshot[];
  readonly pricesMicros: Readonly<Record<SymbolKey, number>>;
  readonly spotValuePelica: number;
  readonly normalBondPrincipal: number;
  readonly junkBondPrincipal: number;
}): PortfolioMarginStatus {
  const exposures: Partial<Record<SymbolKey, number>> = {};
  let posEquity = 0;

  for (const pos of input.positions) {
    if (pos.unitsMilli <= 0) continue;
    const priceMicros = input.pricesMicros[pos.symbol];
    const notional = (pos.unitsMilli * microsToPrice(priceMicros)) / QUANTITY_SCALE;
    const signed = pos.side === 'long' ? notional : -notional;
    exposures[pos.symbol] = (exposures[pos.symbol] ?? 0) + signed;
    posEquity += pos.margin + marginPnl(pos.side, pos.unitsMilli, pos.entryValueMicros, priceMicros);
  }

  const req = requiredMargin(exposures);
  const collateral =
    (input.spotValuePelica * MARKET_CONSTANTS.collateralHaircutBps.spot) / BPS_SCALE +
    (input.normalBondPrincipal * MARKET_CONSTANTS.collateralHaircutBps.normal) / BPS_SCALE +
    (input.junkBondPrincipal * MARKET_CONSTANTS.collateralHaircutBps.junk) / BPS_SCALE;
  const equity = posEquity + collateral;

  if (req <= 0 || input.positions.length === 0) {
    return { equity, required: 0, ratio: null, meetsOpenRatio: true, needsLossCut: false };
  }
  const ratio = equity / req;
  return {
    equity,
    required: req,
    ratio,
    meetsOpenRatio: ratio >= MARKET_CONSTANTS.openRatioBps / BPS_SCALE,
    needsLossCut: ratio < MARKET_CONSTANTS.losscutRatioBps / BPS_SCALE,
  };
}

/**
 * Compute milli-units and exact integer margin required to open a leveraged position given
 * posted `collateral` and `leverage ∈ {1, 2, 3, 5}`:
 *   unitsMilli = floor(collateral * leverage * 1000 / price)
 *   entryValueMicros = round(unitsMilli * priceMicros / 1000)
 *   margin = ceil(entryValue / leverage)
 */
export function quoteMarginOpen(
  collateralPelica: number,
  leverage: number,
  priceMicros: number,
): { readonly unitsMilli: number; readonly entryValueMicros: number; readonly margin: number } | null {
  if (
    !MARKET_CONSTANTS.allowedLeverages.includes(leverage) ||
    collateralPelica < MARKET_CONSTANTS.minMargin ||
    priceMicros <= 0
  ) {
    return null;
  }
  const price = microsToPrice(priceMicros);
  const notional = collateralPelica * leverage;
  const unitsMilli = Math.floor((notional * QUANTITY_SCALE) / price);
  if (unitsMilli < 1) return null;
  const entryValue = (unitsMilli * price) / QUANTITY_SCALE;
  const entryValueMicros = Math.round(entryValue * PRICE_SCALE);
  const margin = Math.ceil(entryValue / leverage);
  return { unitsMilli, entryValueMicros, margin };
}

/**
 * Sort open margin positions by worst PnL first for forced liquidation (loss-cut).
 */
export function sortPositionsForLossCut<T extends MarginPositionSnapshot>(
  positions: readonly T[],
  pricesMicros: Readonly<Record<SymbolKey, number>>,
): T[] {
  return [...positions].sort((a, b) => {
    const pnlA = marginPnl(a.side, a.unitsMilli, a.entryValueMicros, pricesMicros[a.symbol]);
    const pnlB = marginPnl(b.side, b.unitsMilli, b.entryValueMicros, pricesMicros[b.symbol]);
    return pnlA - pnlB;
  });
}
