import { describe, expect, it } from 'vitest';
import {
  WEALTHY_ASSETS,
  isWealthy,
  resolveDisplayStatus,
  type PlayerDebtStatus,
  type PlayerDisplayStatus,
} from '../finance/teiai/index.ts';
import { emptyParts, financialNetWorth, type AssetParts } from './economy-core.ts';

function partsWith(overrides: Partial<AssetParts>): AssetParts {
  return { ...emptyParts(), ...overrides };
}

describe('isWealthy & financialNetWorth (🟡 wealthy badge)', () => {
  it('defines WEALTHY_ASSETS = 1,000,000', () => {
    expect(WEALTHY_ASSETS).toBe(1_000_000);
  });

  const cases: readonly {
    readonly name: string;
    readonly status: PlayerDebtStatus;
    readonly parts: Partial<AssetParts>;
    readonly expectedFnw: number;
    readonly expectedWealthy: boolean;
    readonly expectedDisplay: PlayerDisplayStatus;
  }[] = [
    {
      name: 'katagi at 999,999 cash is not wealthy',
      status: 'katagi',
      parts: { cash: 999_999 },
      expectedFnw: 999_999,
      expectedWealthy: false,
      expectedDisplay: 'katagi',
    },
    {
      name: 'katagi at exactly 1,000,000 cash is wealthy',
      status: 'katagi',
      parts: { cash: 1_000_000 },
      expectedFnw: 1_000_000,
      expectedWealthy: true,
      expectedDisplay: 'wealthy',
    },
    {
      name: 'katagi reaches 1,000,000 across cash + deposit + stocks + bonds + options',
      status: 'katagi',
      parts: {
        cash: 100_000,
        deposit: 250_000,
        crypto: 300_000,
        bonds: 250_000,
        options: 100_000,
      },
      expectedFnw: 1_000_000,
      expectedWealthy: true,
      expectedDisplay: 'wealthy',
    },
    {
      name: 'negative written option value pulls financial net worth below 1,000,000',
      status: 'katagi',
      parts: { cash: 1_050_000, options: -50_001 },
      expectedFnw: 999_999,
      expectedWealthy: false,
      expectedDisplay: 'katagi',
    },
    {
      name: 'Teiai debt subtracts from financial net worth and underground blocks wealthy',
      status: 'underground',
      parts: { cash: 2_000_000, debt: -1_000 },
      expectedFnw: 1_999_000,
      expectedWealthy: false,
      expectedDisplay: 'underground',
    },
    {
      name: 'Teiai debt alone reducing fnw below threshold also yields not wealthy',
      status: 'katagi',
      parts: { cash: 1_000_000, debt: -1 },
      expectedFnw: 999_999,
      expectedWealthy: false,
      expectedDisplay: 'katagi',
    },
    {
      name: 'underground from overdue P2P loan is not wealthy even with >= 1,000,000 cash',
      status: 'underground',
      parts: { cash: 1_500_000 },
      expectedFnw: 1_500_000,
      expectedWealthy: false,
      expectedDisplay: 'underground',
    },
    {
      name: 'bankrupt player is never wealthy even with >= 1,000,000 financial assets',
      status: 'bankrupt',
      parts: { cash: 2_000_000, debt: -5_000 },
      expectedFnw: 1_995_000,
      expectedWealthy: false,
      expectedDisplay: 'bankrupt',
    },
    {
      name: 'fixed assets (horses, items, relics, company, tools) are ignored',
      status: 'katagi',
      parts: {
        cash: 999_999,
        horses: 500_000,
        items: 200_000,
        relics: 300_000,
        company: 400_000,
        tools: 100_000,
      },
      expectedFnw: 999_999,
      expectedWealthy: false,
      expectedDisplay: 'katagi',
    },
    {
      name: 'unclaimed labor pot and auction escrow are ignored',
      status: 'katagi',
      parts: { cash: 999_999, pot: 50_000, escrow: 100_000 },
      expectedFnw: 999_999,
      expectedWealthy: false,
      expectedDisplay: 'katagi',
    },
    {
      name: 'P2P loans lent are ignored and do not qualify for wealthy',
      status: 'katagi',
      parts: { cash: 500_000, loans_lent: 600_000 },
      expectedFnw: 500_000,
      expectedWealthy: false,
      expectedDisplay: 'katagi',
    },
    {
      name: 'active (non-overdue) P2P loans owed are ignored and do not strip wealthy',
      status: 'katagi',
      parts: { cash: 1_000_000, loans_owed: -400_000 },
      expectedFnw: 1_000_000,
      expectedWealthy: true,
      expectedDisplay: 'wealthy',
    },
  ];

  it.each(cases)('$name', ({ status, parts, expectedFnw, expectedWealthy, expectedDisplay }) => {
    const fnw = financialNetWorth(partsWith(parts));
    expect(fnw).toBe(expectedFnw);
    expect(isWealthy(status, fnw)).toBe(expectedWealthy);
    expect(resolveDisplayStatus(status, fnw)).toBe(expectedDisplay);
  });
});
