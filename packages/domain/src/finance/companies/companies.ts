import { createSeededRng, PRICE_SCALE, QUANTITY_SCALE, type Rng } from '@casino/shared';
import {
  addCalendarDays,
  BPS_SCALE,
  hashSeed,
  localDateString,
  localDayStartMs,
  MS_PER_DAY,
  roundTo,
  truncInt,
} from '../math.ts';
import {
  COMPANY_CONSTANTS,
  COMPANY_KINDS,
  type CompanyConditionDef,
  type CompanyKindKey,
} from './constants.ts';

const FORBIDDEN_NAME_CHARS = /[@<>`*_~|#:/\\\n\r]/;

/**
 * Validate a company name: stripped, 1..12 characters, no Discord/markdown special chars
 * (`@<>`*_~|#:/\\\n\r`), and no `"http"` (case-insensitive).
 */
export function validateCompanyName(
  rawName: string,
): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: string } {
  const name = rawName.trim();
  if (name.length === 0 || name.length > COMPANY_CONSTANTS.nameMax) {
    return { ok: false, reason: 'company_invalid_name' };
  }
  if (FORBIDDEN_NAME_CHARS.test(name) || name.toLowerCase().includes('http')) {
    return { ok: false, reason: 'company_invalid_name' };
  }
  return { ok: true, name };
}

/** Cumulative construction cost invested up to `level` (Lv1=100k, Lv2=300k, Lv3=700k, Lv4=1.5M, Lv5=3.1M). */
export function companyInvested(level: number): number {
  let sum = 0;
  const max = Math.min(Math.max(1, Math.floor(level)), COMPANY_CONSTANTS.maxLevel);
  for (let i = 0; i < max; i++) {
    sum += COMPANY_CONSTANTS.buildCosts[i] ?? 0;
  }
  return sum;
}

/** Total founding cost: `found_fee (100,000) + build_costs[0] (100,000) = 200,000`. */
export function companyFoundingCost(): number {
  return COMPANY_CONSTANTS.foundFee + (COMPANY_CONSTANTS.buildCosts[0] ?? 0);
}

/** Upgrade cost to move from `level` to `level + 1`, or `null` if already max level (Lv5). */
export function companyUpgradeCost(level: number): number | null {
  if (level < 1 || level >= COMPANY_CONSTANTS.maxLevel) return null;
  return COMPANY_CONSTANTS.buildCosts[level] ?? null;
}

/** Cost to change facility kind (resets to Lv1, wipes stock). */
export function companyChangeKindCost(): number {
  return COMPANY_CONSTANTS.buildCosts[0] ?? 100_000;
}

/** Daily upkeep in integer Pelica (`floor(invested * 0.003)`). */
export function companyDailyUpkeep(level: number): number {
  return Math.floor((companyInvested(level) * COMPANY_CONSTANTS.upkeepRateBps) / BPS_SCALE);
}

/** Maximum aggregate external investor stakes (`2.0x invested`). */
export function companyStakeCap(level: number): number {
  return Math.floor((companyInvested(level) * COMPANY_CONSTANTS.stakeCapRatioBps) / BPS_SCALE);
}

/** Normal-day (1.0x yield) output in integer milli-units (`invested * yieldRate * 1000`). */
export function companyDailyOutputMilli(kind: CompanyKindKey, level: number): number {
  const def = COMPANY_KINDS[kind];
  return Math.round((companyInvested(level) * def.yieldRateBps * QUANTITY_SCALE) / BPS_SCALE);
}

/** Warehouse storage cap in integer milli-units (`dailyOutput * 3`). */
export function companyStorageCapMilli(kind: CompanyKindKey, level: number): number {
  return companyDailyOutputMilli(kind, level) * COMPANY_CONSTANTS.storageDays;
}

/** CEO withdrawable cash from company funds (`max(0, funds - totalStakes)`). */
export function companyWithdrawable(funds: number, totalStakes: number): number {
  return Math.max(0, funds - Math.max(0, totalStakes));
}

export interface CompanyDayState {
  readonly condition: CompanyConditionDef;
  /** Buyout price per unit in integer micro-Pelica (rounded to 2 decimal places). */
  readonly priceMicros: number;
}

/**
 * Deterministic daily weather/market condition and buyout price for `(kind, guildId, dayStr)`.
 * Uses injected `rng` when provided, otherwise `createSeededRng(hashSeed(...))`.
 * Boundary rounding: buyout price rounded half-to-even to 2 decimals, stored in micro-Pelica.
 */
export function companyDayState(
  kind: CompanyKindKey,
  guildId: string,
  dayStr: string,
  rng?: Rng,
): CompanyDayState {
  const def = COMPANY_KINDS[kind];
  const prng = rng ?? createSeededRng(hashSeed(`company:${kind}:${guildId}:${dayStr}`));
  const totalWeight = def.conditions.reduce((s, c) => s + c.weight, 0);
  const roll = prng.float() * totalWeight;
  let acc = 0;
  let chosen = def.conditions[def.conditions.length - 1] as CompanyConditionDef;
  for (const cond of def.conditions) {
    acc += cond.weight;
    if (roll < acc) {
      chosen = cond;
      break;
    }
  }
  const lo = chosen.priceLoMicros / PRICE_SCALE;
  const hi = chosen.priceHiMicros / PRICE_SCALE;
  const rawPrice = lo + (hi - lo) * prng.float();
  const roundedPrice = roundTo(rawPrice, 2);
  return {
    condition: chosen,
    priceMicros: Math.round(roundedPrice * PRICE_SCALE),
  };
}

/**
 * Continuous production across calendar day boundaries `[fromMs, toMs]` in the guild's local TZ.
 * Returns updated `stockMilli`, capped at `storageCapMilli`.
 * Rounding: continuous float integration rounded to nearest integer milli-unit at the boundary.
 */
export function produceCompanyStock(input: {
  readonly kind: CompanyKindKey;
  readonly level: number;
  readonly guildId: string;
  readonly currentStockMilli: number;
  readonly fromMs: number;
  readonly toMs: number;
  readonly utcOffsetHours?: number;
  readonly resolveDayState?: (
    kind: CompanyKindKey,
    guildId: string,
    dayStr: string,
  ) => CompanyDayState;
}): number {
  const cap = companyStorageCapMilli(input.kind, input.level);
  if (input.toMs <= input.fromMs) {
    return Math.min(cap, Math.max(0, input.currentStockMilli));
  }
  const offset = input.utcOffsetHours ?? 9;
  const dailyOut = companyDailyOutputMilli(input.kind, input.level) / QUANTITY_SCALE;
  const getDay = input.resolveDayState ?? companyDayState;

  let stock = Math.max(0, input.currentStockMilli) / QUANTITY_SCALE;
  let cursor = input.fromMs;
  const capUnits = cap / QUANTITY_SCALE;

  while (cursor < input.toMs && stock < capUnits) {
    const dayStr = localDateString(cursor, offset);
    const nextDayStart = localDayStartMs(addCalendarDays(dayStr, 1), offset);
    const segEnd = Math.min(input.toMs, nextDayStart);
    const dtSeconds = Math.max(0, (segEnd - cursor) / 1_000);
    const state = getDay(input.kind, input.guildId, dayStr);
    const mult = state.condition.yieldMultBps / BPS_SCALE;
    stock += dtSeconds * (dailyOut / 86_400) * mult;
    if (stock >= capUnits) {
      stock = capUnits;
      break;
    }
    cursor = segEnd;
  }

  return Math.min(cap, Math.round(stock * QUANTITY_SCALE));
}

export interface CompanySaleResult {
  /** Net Pelica paid into company funds (after 3% Teiai skim, capped by server buyout budget). */
  readonly paid: number;
  /** 3% Teiai pinhane skim retained by Teiai. */
  readonly pinhane: number;
  /** Remaining unsold warehouse stock in milli-units (0 on full sale). */
  readonly leftStockMilli: number;
  /** Exact floating remaining stock units (for legacy fixture verification). */
  readonly leftStockUnits: number;
}

/**
 * Shipment sale with 3% Teiai skim and server buyout budget cap:
 * - Full sale (`net <= budget`): `gross = int(stock * price)`, `pinhane = int(gross * 0.03)`, `paid = gross - pinhane`.
 * - Partial sale (`net > budget`): `fraction = budget / net`, `soldGross = int(gross * fraction)`,
 *   `pinhane = int(soldGross * 0.03)`, `paid = min(budget, soldGross - pinhane)`, `left = stock * (1 - fraction)`.
 */
export function computeCompanySale(
  stockMilli: number,
  priceMicros: number,
  budget: number,
): CompanySaleResult {
  if (stockMilli <= 0 || priceMicros <= 0 || budget <= 0) {
    return {
      paid: 0,
      pinhane: 0,
      leftStockMilli: Math.max(0, stockMilli),
      leftStockUnits: Math.max(0, stockMilli) / QUANTITY_SCALE,
    };
  }
  const stock = stockMilli / QUANTITY_SCALE;
  const price = priceMicros / PRICE_SCALE;
  const gross = truncInt(stock * price);
  if (gross <= 0) {
    return { paid: 0, pinhane: 0, leftStockMilli: stockMilli, leftStockUnits: stock };
  }
  const fullPinhane = truncInt((gross * COMPANY_CONSTANTS.pinhaneRateBps) / BPS_SCALE);
  const fullNet = gross - fullPinhane;
  if (fullNet <= 0) {
    return { paid: 0, pinhane: 0, leftStockMilli: stockMilli, leftStockUnits: stock };
  }
  if (fullNet <= budget) {
    return { paid: fullNet, pinhane: fullPinhane, leftStockMilli: 0, leftStockUnits: 0 };
  }
  const fraction = budget / fullNet;
  const soldGross = truncInt(gross * fraction);
  const soldPinhane = truncInt((soldGross * COMPANY_CONSTANTS.pinhaneRateBps) / BPS_SCALE);
  const paid = Math.min(budget, Math.max(0, soldGross - soldPinhane));
  const leftStockUnits = Math.max(0, stock * (1 - fraction));
  return {
    paid,
    pinhane: soldPinhane,
    leftStockMilli: Math.max(0, Math.round(leftStockUnits * QUANTITY_SCALE)),
    leftStockUnits,
  };
}

/**
 * Pro-rata dividend split on shipment proceeds (`pool = floor(paid * rateBps / 10_000)`,
 * each investor gets `floor(pool * stake / totalStakes)`). Dust remains in company funds.
 */
export function computeDividendSplit(
  paid: number,
  dividendRateBps: number,
  stakes: Readonly<Record<string, number>>,
): Record<string, number> {
  if (paid <= 0 || dividendRateBps <= 0) return {};
  const totalStakes = Object.values(stakes).reduce((s, v) => s + Math.max(0, v), 0);
  if (totalStakes <= 0) return {};
  const pool = Math.floor((paid * dividendRateBps) / BPS_SCALE);
  if (pool <= 0) return {};
  const out: Record<string, number> = {};
  for (const [investorId, amount] of Object.entries(stakes)) {
    if (amount <= 0) continue;
    const share = Math.floor((pool * amount) / totalStakes);
    if (share > 0) out[investorId] = share;
  }
  return out;
}

/**
 * Non-double-counting net-worth valuation split between CEO and external investors:
 *   totalStakes = sum(stakes)
 *   scale = min(1.0, max(0, companyValue) / totalStakes)
 *   investorVal = floor(stake * scale), ownerVal = max(0, companyValue - totalStakes)
 */
export function computeStakeValues(
  companyValue: number,
  stakes: Readonly<Record<string, number>>,
): { readonly ownerValue: number; readonly investorValues: Record<string, number> } {
  const totalStakes = Object.values(stakes).reduce((s, v) => s + Math.max(0, v), 0);
  const positiveVal = Math.max(0, companyValue);
  if (totalStakes <= 0) {
    return { ownerValue: positiveVal, investorValues: {} };
  }
  const scale = Math.min(1.0, positiveVal / totalStakes);
  const investorValues: Record<string, number> = {};
  for (const [investorId, amount] of Object.entries(stakes)) {
    if (amount <= 0) continue;
    investorValues[investorId] = truncInt(amount * scale);
  }
  return {
    ownerValue: Math.max(0, positiveVal - totalStakes),
    investorValues,
  };
}

/**
 * Apply one or more missed calendar days of upkeep.
 * If `funds >= upkeep`, pays upkeep and resets `unpaidDays = 0`.
 * Otherwise increments `unpaidDays`; reaching `>= 3` consecutive unpaid days bankrupts the company.
 */
export function applyDailyUpkeepStep(input: {
  readonly funds: number;
  readonly unpaidDays: number;
  readonly level: number;
  readonly elapsedDays: number;
}): {
  readonly nextFunds: number;
  readonly nextUnpaidDays: number;
  readonly totalUpkeepPaid: number;
  readonly bankrupt: boolean;
} {
  const upkeep = companyDailyUpkeep(input.level);
  let funds = Math.max(0, input.funds);
  let unpaidDays = Math.max(0, input.unpaidDays);
  let totalUpkeepPaid = 0;

  for (let i = 0; i < input.elapsedDays; i++) {
    if (funds >= upkeep) {
      funds -= upkeep;
      totalUpkeepPaid += upkeep;
      unpaidDays = 0;
    } else {
      unpaidDays += 1;
      if (unpaidDays >= COMPANY_CONSTANTS.bankruptDays) {
        return { nextFunds: funds, nextUnpaidDays: unpaidDays, totalUpkeepPaid, bankrupt: true };
      }
    }
  }
  return { nextFunds: funds, nextUnpaidDays: unpaidDays, totalUpkeepPaid, bankrupt: false };
}

/** Number of whole local calendar days between `fromDayStr` and `toDayStr` (clamped >= 0). */
export function calendarDayDiff(fromDayStr: string, toDayStr: string): number {
  const a = localDayStartMs(fromDayStr, 0);
  const b = localDayStartMs(toDayStr, 0);
  return Math.max(0, Math.round((b - a) / MS_PER_DAY));
}
