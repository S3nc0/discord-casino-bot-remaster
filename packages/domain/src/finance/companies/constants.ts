/**
 * Companies (`/会社`) constants and facility definitions.
 * Mirrors `catalogs/company.yaml` with integer Pelica and integer basis points.
 */
export const COMPANY_CONSTANTS = {
  foundFee: 100_000,
  nameMax: 12,
  buildCosts: [100_000, 200_000, 400_000, 800_000, 1_600_000] as readonly number[],
  maxLevel: 5,
  upkeepRateBps: 30, // 0.3%/day
  pinhaneRateBps: 300, // 3% shipment skim
  storageDays: 3,
  bankruptDays: 3,
  dailyGrant: 30_000,
  stakeMin: 1_000,
  stakeCapRatioBps: 20_000, // 2.0x invested
  dividendMaxBps: 5_000, // 50%
} as const;

export type CompanyKindKey = 'farm' | 'mine';

export interface CompanyConditionDef {
  readonly key: string;
  readonly weight: number;
  /** Yield multiplier in basis points (10_000 = 1.0x). */
  readonly yieldMultBps: number;
  /** Min buyout price in micro-Pelica (1_000_000 = 1.00). */
  readonly priceLoMicros: number;
  /** Max buyout price in micro-Pelica. */
  readonly priceHiMicros: number;
}

export interface CompanyKindDef {
  readonly key: CompanyKindKey;
  readonly name: string;
  /** Daily output rate in basis points of cumulative invested cost (180 = 1.8%/day). */
  readonly yieldRateBps: number;
  readonly conditions: readonly CompanyConditionDef[];
}

export const COMPANY_KINDS: Readonly<Record<CompanyKindKey, CompanyKindDef>> = {
  farm: {
    key: 'farm',
    name: '農場',
    yieldRateBps: 180, // 0.018
    conditions: [
      {
        key: 'sunny',
        weight: 40,
        yieldMultBps: 10_000,
        priceLoMicros: 900_000,
        priceHiMicros: 1_100_000,
      },
      {
        key: 'rain',
        weight: 20,
        yieldMultBps: 13_000,
        priceLoMicros: 800_000,
        priceHiMicros: 1_000_000,
      },
      {
        key: 'bumper',
        weight: 10,
        yieldMultBps: 18_000,
        priceLoMicros: 600_000,
        priceHiMicros: 800_000,
      },
      {
        key: 'drought',
        weight: 15,
        yieldMultBps: 5_000,
        priceLoMicros: 1_300_000,
        priceHiMicros: 1_500_000,
      },
      {
        key: 'storm',
        weight: 5,
        yieldMultBps: 1_000,
        priceLoMicros: 1_500_000,
        priceHiMicros: 1_900_000,
      },
      {
        key: 'season',
        weight: 10,
        yieldMultBps: 10_000,
        priceLoMicros: 1_400_000,
        priceHiMicros: 1_600_000,
      },
    ],
  },
  mine: {
    key: 'mine',
    name: '採掘場',
    yieldRateBps: 240, // 0.024
    conditions: [
      {
        key: 'steady',
        weight: 1,
        yieldMultBps: 10_000,
        priceLoMicros: 900_000,
        priceHiMicros: 1_100_000,
      },
    ],
  },
};

export function isCompanyKind(value: string): value is CompanyKindKey {
  return value === 'farm' || value === 'mine';
}
