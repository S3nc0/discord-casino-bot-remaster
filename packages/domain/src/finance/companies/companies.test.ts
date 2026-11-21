import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRICE_SCALE, QUANTITY_SCALE } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import {
  applyDailyUpkeepStep,
  COMPANY_KINDS,
  companyDailyOutputMilli,
  companyDailyUpkeep,
  companyDayState,
  companyInvested,
  companyStakeCap,
  companyStorageCapMilli,
  companyUpgradeCost,
  computeCompanySale,
  computeDividendSplit,
  computeStakeValues,
  produceCompanyStock,
  validateCompanyName,
  type CompanyKindKey,
} from './index.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const BASE_MS = 1_736_121_600_000;

interface CompaniesFixture {
  readonly kind_sample: CompanyKindKey;
  readonly domain_math: {
    readonly daily_output_lv1: number;
    readonly storage_cap_lv1: number;
    readonly daily_upkeep_lv1: number;
    readonly upgrade_cost_lv1: number;
    readonly invested_lv1: number;
    readonly stake_cap_lv1: number;
    readonly day_state_2025_01_06: {
      readonly condition: {
        readonly key: string;
        readonly yield_mult: number;
      };
      readonly price: number;
    };
    readonly produce_12h: number;
    readonly sale_full: readonly [number, number, number];
    readonly sale_capped_2300: readonly [number, number, number];
    readonly dividend_split: Record<string, number>;
    readonly stake_values: readonly [number, Record<string, number>];
  };
}

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/legacy/companies/operations.json'), 'utf8'),
) as CompaniesFixture;

describe('companies domain parity', () => {
  it('matches legacy domain_math fixture 100%', () => {
    const kind = fixture.kind_sample;
    expect(companyDailyOutputMilli(kind, 1) / QUANTITY_SCALE).toBe(
      fixture.domain_math.daily_output_lv1,
    );
    expect(companyStorageCapMilli(kind, 1) / QUANTITY_SCALE).toBe(
      fixture.domain_math.storage_cap_lv1,
    );
    expect(companyDailyUpkeep(1)).toBe(fixture.domain_math.daily_upkeep_lv1);
    expect(companyUpgradeCost(1)).toBe(fixture.domain_math.upgrade_cost_lv1);
    expect(companyInvested(1)).toBe(fixture.domain_math.invested_lv1);
    expect(companyStakeCap(1)).toBe(fixture.domain_math.stake_cap_lv1);

    // Deterministic day state using injected day state matching Python's MT19937 fixture roll
    const droughtCond = COMPANY_KINDS[kind].conditions.find(
      (c) => c.key === fixture.domain_math.day_state_2025_01_06.condition.key,
    )!;
    const fixtureDayState = {
      condition: droughtCond,
      priceMicros: Math.round(fixture.domain_math.day_state_2025_01_06.price * PRICE_SCALE),
    };
    const producedMilli = produceCompanyStock({
      kind,
      level: 1,
      guildId: '100000000000000001',
      currentStockMilli: 0,
      fromMs: BASE_MS,
      toMs: BASE_MS + 12 * 3_600_000,
      utcOffsetHours: 9,
      resolveDayState: () => fixtureDayState,
    });
    expect(producedMilli / QUANTITY_SCALE).toBeCloseTo(fixture.domain_math.produce_12h, 6);

    // Native deterministic day state is pure & within valid condition bounds
    const nativeA = companyDayState(kind, '100000000000000001', '2025-01-06');
    const nativeB = companyDayState(kind, '100000000000000001', '2025-01-06');
    expect(nativeA).toEqual(nativeB);
    expect(nativeA.priceMicros).toBeGreaterThanOrEqual(nativeA.condition.priceLoMicros);
    expect(nativeA.priceMicros).toBeLessThanOrEqual(nativeA.condition.priceHiMicros);

    // Sales (full and budget-capped)
    const saleFull = computeCompanySale(10 * QUANTITY_SCALE, 500 * PRICE_SCALE, 10_000);
    expect(saleFull.paid).toBe(fixture.domain_math.sale_full[0]);
    expect(saleFull.pinhane).toBe(fixture.domain_math.sale_full[1]);
    expect(saleFull.leftStockUnits).toBeCloseTo(fixture.domain_math.sale_full[2], 6);

    const saleCapped = computeCompanySale(10 * QUANTITY_SCALE, 500 * PRICE_SCALE, 2_300);
    expect(saleCapped.paid).toBe(fixture.domain_math.sale_capped_2300[0]);
    expect(saleCapped.pinhane).toBe(fixture.domain_math.sale_capped_2300[1]);
    expect(saleCapped.leftStockUnits).toBeCloseTo(fixture.domain_math.sale_capped_2300[2], 6);

    // Dividend split and stake values
    const stakes = {
      '200000000000000002': 30_000,
      '200000000000000003': 20_000,
    };
    expect(computeDividendSplit(10_000, 5_000, stakes)).toEqual(fixture.domain_math.dividend_split);

    const stakeVals = computeStakeValues(100_000, stakes);
    expect(stakeVals.ownerValue).toBe(fixture.domain_math.stake_values[0]);
    expect(stakeVals.investorValues).toEqual(fixture.domain_math.stake_values[1]);
  });

  it('validates names and handles 3 consecutive unpaid upkeep days bankruptcy', () => {
    expect(validateCompanyName('  帝愛商事  ')).toEqual({ ok: true, name: '帝愛商事' });
    expect(validateCompanyName('')).toEqual({ ok: false, reason: 'company_invalid_name' });
    expect(validateCompanyName('https://evil')).toEqual({
      ok: false,
      reason: 'company_invalid_name',
    });

    const step = applyDailyUpkeepStep({ funds: 100, unpaidDays: 0, level: 1, elapsedDays: 3 });
    expect(step.bankrupt).toBe(true);
    expect(step.nextUnpaidDays).toBe(3);
  });
});
