import { PRICE_SCALE, QUANTITY_SCALE } from '@casino/shared';

export type SymbolKey = 'cs' | 'teio' | 'numa' | 'gold';
export type MarginSide = 'long' | 'short';
export type OptionKind = 'call' | 'put' | 'pair';
export type OptionSide = 'long' | 'short';
export type BondKindKey = 'normal' | 'junk';
export type PinState = -1 | 0 | 1;

export type PinnableAction =
  | 'sell_spot'
  | 'close_long'
  | 'sell_call'
  | 'buy_spot'
  | 'open_long'
  | 'cover_short';

export interface MarketSymbolDef {
  readonly key: SymbolKey;
  readonly name: string;
  readonly emoji: string;
  /** Starting price in integer micro-Pelica. */
  readonly startMicros: number;
  /** 1-minute log-return volatility sigma (internal pricing math). */
  readonly sigma: number;
  /** Log-drift per day before high-price fade (internal pricing math). */
  readonly drift: number;
  /** Default OTM option strike offset in basis points (e.g. 300 = 3%). */
  readonly defaultStrikeOtmBps: number;
}

/**
 * Canonical 4 securities symbols in covariance matrix order `[cs, teio, numa, gold]`.
 * `cs` (`CSトークン`) is the consolidated crypto ticker and baseline panic-shock denominator.
 */
export const MARKET_SYMBOLS: readonly MarketSymbolDef[] = [
  {
    key: 'cs',
    name: 'CSトークン',
    emoji: '🪙',
    startMicros: 1_000 * PRICE_SCALE,
    sigma: 0.0012,
    drift: 0.008,
    defaultStrikeOtmBps: 300,
  },
  {
    key: 'teio',
    name: 'TEIO重工',
    emoji: '🏭',
    startMicros: 1_200 * PRICE_SCALE,
    sigma: 0.0007,
    drift: 0.007,
    defaultStrikeOtmBps: 200,
  },
  {
    key: 'numa',
    name: 'NUMAバイオ',
    emoji: '🧪',
    startMicros: 400 * PRICE_SCALE,
    sigma: 0.0022,
    drift: 0.01,
    defaultStrikeOtmBps: 500,
  },
  {
    key: 'gold',
    name: 'GOLD地金',
    emoji: '🥇',
    startMicros: 3_000 * PRICE_SCALE,
    sigma: 0.0004,
    drift: 0.003,
    defaultStrikeOtmBps: 150,
  },
] as const;

export const DEFAULT_SYMBOL: SymbolKey = 'cs';

export const SYMBOL_BY_KEY: Readonly<Record<SymbolKey, MarketSymbolDef>> = {
  cs: MARKET_SYMBOLS[0] as MarketSymbolDef,
  teio: MARKET_SYMBOLS[1] as MarketSymbolDef,
  numa: MARKET_SYMBOLS[2] as MarketSymbolDef,
  gold: MARKET_SYMBOLS[3] as MarketSymbolDef,
};

export function isSymbolKey(value: string): value is SymbolKey {
  return value === 'cs' || value === 'teio' || value === 'numa' || value === 'gold';
}

/** Symmetric pairwise correlation matrix in order `[cs, teio, numa, gold]`. */
export const SYMBOL_CORRELATIONS: readonly (readonly number[])[] = [
  [1.0, 0.6, 0.05, -0.6],
  [0.6, 1.0, 0.05, -0.5],
  [0.05, 0.05, 1.0, -0.1],
  [-0.6, -0.5, -0.1, 1.0],
];

export const MARKET_CONSTANTS = {
  minPriceMicros: 20 * PRICE_SCALE,
  maxPriceMicros: 50_000 * PRICE_SCALE,
  keepDays: 30,
  confirmFrom: 5_000,
  eventIntervalMinutes: 720, // panic shock probability = 1/720 per min
  eventRangeLo: 0.015,
  eventRangeHi: 0.035,
  eventScaleMax: 1.5,
  unitMilli: QUANTITY_SCALE, // 1000 milli-units = 1 share
  feeRateBps: 0,
  driftBand: 8.0, // drift fades linearly in log-price to 0 at 8x start
  dailyLimitBps: 3_000, // ±30%

  // Margin trading (CODE behaviour: interest IS actively charged per infra/db/margin.py)
  allowedLeverages: [1, 2, 3, 5] as readonly number[],
  minMargin: 10,
  riskK: 20.0,
  openRatioBps: 13_000, // 130%
  losscutRatioBps: 10_000, // 100%
  collateralHaircutBps: {
    spot: 8_000, // 80%
    normal: 9_500, // 95%
    junk: 5_000, // 50%
  },
  borrowRatePerDayBps: {
    long: 10, // 0.10%/day = 0.001
    short: 5, // 0.05%/day = 0.0005
  },
  interestMinCharge: 10,

  // Progressive capital gains tax brackets (marginal upper bound -> rate bps)
  gainsTaxBrackets: [
    { limit: 10_000, rateBps: 0 },
    { limit: 100_000, rateBps: 300 },
    { limit: 1_000_000, rateBps: 700 },
    { limit: null, rateBps: 1_200 },
  ] as readonly { readonly limit: number | null; readonly rateBps: number }[],

  // Move detection threshold for `MarketMove` domain event (5% = 500 bps over window)
  moveAlertThresholdBps: 500,
} as const;

/** Actions blocked by daily limit pin locks. */
export const PIN_BLOCKED_ACTIONS: Readonly<Record<PinState, readonly PinnableAction[]>> = {
  [-1]: ['sell_spot', 'close_long', 'sell_call'],
  [0]: [],
  [1]: ['buy_spot', 'open_long', 'cover_short'],
};

export const OPTION_CONSTANTS = {
  optionHours: 6,
  defaultStrikeOtmBps: 200, // 2% fallback when symbol omitted
  tickSeconds: 60,
  spreadBps: 150, // ±1.5%
  payoutCapMult: 50,
  minPremium: 100,
  maxOpenPremium: 20_000,
  marginRateBps: 2_000, // 20% of strike * units / 1000
  maxShortMargin: 20_000,
  maxTargetPct: 50,
} as const;

export const VOLATILITY_EVENT_CONSTANTS = {
  leadMin: 15,
  durationMin: 20,
  factorBps: 20_000, // 2.0x
  announceIntervalMinutes: 300, // prob 1/300 per min
  cooldownMin: 60,
  pricedAtAnnounce: 1.0,
  keepDays: 7,
  alertWindowMin: 60,
  alertMinSamples: 10,
  zAlertThreshold: 2.5,
  minAbsCorr: 0.5,
} as const;

export const EARNINGS_CONSTANTS = {
  eligibleSymbols: ['teio', 'numa'] as readonly SymbolKey[],
  announceWeekday: 0, // Monday (0 = Mon .. 6 = Sun)
  announceHour: 9,
  announceMinute: 0,
  releaseWeekday: 1, // Tuesday
  releaseHour: 13,
  releaseMinute: 30,
  sizeLo: 0.08,
  sizeHi: 0.22,
  surpriseProb: 0.15,
  surpriseLo: 0.35,
  surpriseHi: 0.6,
  memoProb: 0.1,
  memoLeadHours: 48,
  memoTruthBps: 7_000, // 70%
  shopTruthBps: 8_000, // 80%
  shopStock: 5,
  shopMemoPrice: 5_000, // catalogs/shop.yaml insider_memo price
} as const;

export interface BondKindDef {
  readonly key: BondKindKey;
  readonly name: string;
  readonly emoji: string;
  readonly hours: number;
  /** Base coupon percentage for full maturity (e.g. 4 = 4%, 20 = 20%). */
  readonly baseRatePct: number;
  /** Default probability over maturity in percent (0 or 20). */
  readonly defaultPct: number;
  readonly maxTotal: number;
  readonly sellable: boolean;
}

export const BOND_CONSTANTS = {
  minAmount: 1_000,
  saleDiscountPerHour: 0.001,
  kinds: {
    normal: {
      key: 'normal',
      name: '通常債',
      emoji: '🏦',
      hours: 72,
      baseRatePct: 4,
      defaultPct: 0,
      maxTotal: 30_000,
      sellable: true,
    },
    junk: {
      key: 'junk',
      name: 'ジャンク債',
      emoji: '🗑️',
      hours: 24,
      baseRatePct: 20,
      defaultPct: 20,
      maxTotal: 10_000,
      sellable: false,
    },
  } as Readonly<Record<BondKindKey, BondKindDef>>,
} as const;

export function isBondKind(value: string): value is BondKindKey {
  return value === 'normal' || value === 'junk';
}
