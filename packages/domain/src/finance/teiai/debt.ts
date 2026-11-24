import type { Rng } from '@casino/shared';
import { BPS_SCALE, MS_PER_DAY, MS_PER_HOUR, roundTo, truncInt } from '../math.ts';
import {
  TEIAI_CONSTANTS,
  WEALTHY_ASSETS,
  type PlayerDebtStatus,
  type PlayerDisplayStatus,
} from './constants.ts';

/** Daily bonus skim while in Teiai debt: 20%, rounded down (floor integer Pelica). */
export function dailySkim(amount: number): number {
  if (amount <= 0) return 0;
  return Math.floor((amount * TEIAI_CONSTANTS.skimRateBps) / BPS_SCALE);
}

/** Underground labor pot skim: 3% (code behaviour), rounded down (floor integer Pelica). */
export function laborSkim(amount: number): number {
  if (amount <= 0) return 0;
  return Math.floor((amount * TEIAI_CONSTANTS.laborSkimRateBps) / BPS_SCALE);
}

/** Automatic debt withholding on eligible income: 30%, rounded down (floor integer Pelica). */
export function debtWithhold(income: number): number {
  if (income <= 0) return 0;
  return Math.floor((income * TEIAI_CONSTANTS.repayRateBps) / BPS_SCALE);
}

/** Determine canonical debt status of a player. */
export function resolvePlayerStatus(input: {
  readonly debt: number;
  readonly bankruptAtMs: number | null;
  readonly hasOverdueLoan: boolean;
}): PlayerDebtStatus {
  if (input.bankruptAtMs !== null && input.debt > 0) return 'bankrupt';
  if (input.debt > 0 || input.hasOverdueLoan) return 'underground';
  return 'katagi';
}

/** True when player qualifies for cosmetic wealthy display (`katagi` and financial net worth >= 1,000,000). */
export function isWealthy(status: PlayerDebtStatus, financialNetWorth: number): boolean {
  return status === 'katagi' && financialNetWorth >= WEALTHY_ASSETS;
}

/** Alias of `isWealthy` kept for existing callers. */
export const isWealthyStatus = isWealthy;

/** Display-only status badge: upgrades `katagi` to `wealthy` when financial net worth qualifies. */
export function resolveDisplayStatus(
  status: PlayerDebtStatus,
  financialNetWorth: number,
): PlayerDisplayStatus {
  return isWealthy(status, financialNetWorth) ? 'wealthy' : status;
}

export interface DebtInterestAccrual {
  readonly added: number;
  readonly nextDebt: number;
  readonly nextInterestAtMs: number;
  readonly daysCounted: number;
}

/**
 * Toichi debt simple interest accrual: 1%/day over whole elapsed 24h periods, capped at 10 days
 * per tick and capped by `debtInterestCeiling` (14,999) so interest alone never triggers grace.
 * Rounding: floor integer Pelica (`int(debt * 0.01 * counted)`).
 */
export function accrueDebtInterest(
  debt: number,
  lastInterestAtMs: number,
  nowMs: number,
): DebtInterestAccrual {
  if (debt <= 0) {
    return { added: 0, nextDebt: 0, nextInterestAtMs: 0, daysCounted: 0 };
  }
  if (lastInterestAtMs <= 0) {
    return { added: 0, nextDebt: debt, nextInterestAtMs: nowMs, daysCounted: 0 };
  }
  const elapsedMs = Math.max(0, nowMs - lastInterestAtMs);
  const days = Math.floor(elapsedMs / MS_PER_DAY);
  if (days <= 0) {
    return { added: 0, nextDebt: debt, nextInterestAtMs: lastInterestAtMs, daysCounted: 0 };
  }
  const counted = Math.min(days, TEIAI_CONSTANTS.debtInterestMaxDays);
  const rawInterest = Math.floor((debt * TEIAI_CONSTANTS.debtRatePerDayBps * counted) / BPS_SCALE);
  const room = TEIAI_CONSTANTS.debtInterestCeiling - debt;
  const added = Math.max(0, Math.min(rawInterest, room));
  const nextInterestAtMs = days > counted ? nowMs : lastInterestAtMs + days * MS_PER_DAY;
  return {
    added,
    nextDebt: debt + added,
    nextInterestAtMs,
    daysCounted: counted,
  };
}

export interface GraceTransition {
  readonly nextGraceUntilMs: number | null;
  readonly enteredGrace: boolean;
  readonly exitedGrace: boolean;
}

/**
 * Evaluate bankruptcy grace window transition after a debt change.
 * Entering: `debt >= 15,000` when not already in grace -> starts 24h timer.
 * Exiting: `debt < 15,000` when currently in grace -> clears timer.
 */
export function evaluateGraceTransition(
  debt: number,
  currentGraceUntilMs: number | null,
  nowMs: number,
): GraceTransition {
  if (debt >= TEIAI_CONSTANTS.graceDebt) {
    if (currentGraceUntilMs === null) {
      return {
        nextGraceUntilMs: nowMs + TEIAI_CONSTANTS.graceHours * MS_PER_HOUR,
        enteredGrace: true,
        exitedGrace: false,
      };
    }
    return { nextGraceUntilMs: currentGraceUntilMs, enteredGrace: false, exitedGrace: false };
  }
  if (currentGraceUntilMs !== null) {
    return { nextGraceUntilMs: null, enteredGrace: false, exitedGrace: true };
  }
  return { nextGraceUntilMs: null, enteredGrace: false, exitedGrace: false };
}

/**
 * Manual seed loan eligibility & amount (`SEED - balance`).
 * Blocked if bankrupt, in grace, or `balance >= 3,000`.
 */
export function manualSeedLoanQuote(input: {
  readonly balance: number;
  readonly status: PlayerDebtStatus;
  readonly inGrace: boolean;
}):
  { readonly ok: true; readonly amount: number } | { readonly ok: false; readonly reason: string } {
  if (input.status === 'bankrupt') return { ok: false, reason: 'seed_bankrupt' };
  if (input.inGrace) return { ok: false, reason: 'seed_in_grace' };
  if (input.balance >= TEIAI_CONSTANTS.seedLoanCap) {
    return { ok: false, reason: 'seed_balance_sufficient' };
  }
  return { ok: true, amount: TEIAI_CONSTANTS.seedLoanCap - input.balance };
}

/** Auto-seed on debt creation / bankruptcy: lends 3,000 iff `debt > 0 && balance === 0`. */
export function autoSeedIfEmpty(balance: number, debt: number): number {
  return debt > 0 && balance === 0 ? TEIAI_CONSTANTS.seedLoanCap : 0;
}

/** Daily claim top-up seed: lends `3,000 - balance` iff `debt > 0 && balance < 3,000`. */
export function dailyTopupSeed(balance: number, debt: number): number {
  return debt > 0 && balance < TEIAI_CONSTANTS.seedLoanCap
    ? TEIAI_CONSTANTS.seedLoanCap - balance
    : 0;
}

/**
 * Compute CDS odds in integer tenths (e.g. 15 = 1.5x, 150 = 15.0x) matching legacy `teiai.cds_odds`.
 * Formula:
 *   r = 0.04 if status === 'katagi' else 0.25 + 0.5 * min(1.0, debt / 15_000)
 *   if marginRatio !== null && marginRatio < 1.5: r += 0.1
 *   odds = round(min(15.0, max(1.2, 0.85 / r)), 1)
 * Rounding: half-to-even to 1 decimal place (stored as integer tenths).
 */
export function cdsOddsTenths(status: string, debt: number, marginRatio: number | null): number {
  let r =
    status === 'katagi'
      ? 0.04
      : 0.25 + 0.5 * Math.min(1.0, Math.max(0, debt) / TEIAI_CONSTANTS.graceDebt);
  if (marginRatio !== null && marginRatio < 1.5) {
    r += 0.1;
  }
  const clamped = Math.min(
    TEIAI_CONSTANTS.cdsMaxOddsTenths / 10,
    Math.max(TEIAI_CONSTANTS.cdsMinOddsTenths / 10, 0.85 / r),
  );
  const rounded = roundTo(clamped, 1);
  return Math.round(rounded * 10);
}

/** Expected payout of a single CDS contract, rounded down to integer Pelica. */
export function cdsExpectedPayout(stake: number, oddsTenths: number): number {
  return Math.floor((stake * oddsTenths) / 10);
}

/** Remaining self-CDS expected payout cap (`50,000 - currentExpected`). */
export function cdsSelfCapRoom(currentSelfExpectedPayout: number): number {
  return Math.max(0, TEIAI_CONSTANTS.cdsSelfCap - currentSelfExpectedPayout);
}

export interface CdsContractInput {
  readonly id: number;
  readonly buyerId: string;
  readonly stake: number;
  readonly oddsTenths: number;
}

export interface CdsPayoutLine {
  readonly contractId: number;
  readonly buyerId: string;
  readonly payout: number;
}

/**
 * Settle third-party CDS contracts on default.
 * Aggregate payout is capped at `floor(debtBefore * 0.50)`. If total raw claims exceed the cap,
 * each claim is scaled pro-rata and truncated (floor integer Pelica).
 */
export function settleCdsDefault(
  contracts: readonly CdsContractInput[],
  debtBefore: number,
): { readonly totalPaid: number; readonly payouts: readonly CdsPayoutLine[] } {
  if (contracts.length === 0 || debtBefore <= 0) {
    return { totalPaid: 0, payouts: [] };
  }
  const cap = Math.floor((debtBefore * TEIAI_CONSTANTS.cdsPayoutCapRateBps) / BPS_SCALE);
  const rawClaims = contracts.map((c) => ({
    contractId: c.id,
    buyerId: c.buyerId,
    raw: cdsExpectedPayout(c.stake, c.oddsTenths),
  }));
  const totalRaw = rawClaims.reduce((acc, c) => acc + c.raw, 0);
  if (totalRaw <= 0 || cap <= 0) {
    return {
      totalPaid: 0,
      payouts: rawClaims.map((c) => ({ contractId: c.contractId, buyerId: c.buyerId, payout: 0 })),
    };
  }
  const scale = totalRaw > cap ? cap / totalRaw : 1.0;
  const payouts: CdsPayoutLine[] = [];
  let totalPaid = 0;
  for (const c of rawClaims) {
    const payout = scale < 1.0 ? truncInt(c.raw * scale) : c.raw;
    payouts.push({ contractId: c.contractId, buyerId: c.buyerId, payout });
    totalPaid += payout;
  }
  return { totalPaid, payouts };
}

export interface EscapeEligibility {
  readonly debt: number;
  readonly status: PlayerDebtStatus;
  readonly escapeTries: number;
  readonly lastEscapeAtMs: number;
  readonly nowMs: number;
}

export type EscapeRollResult =
  | { readonly ok: false; readonly reason: string }
  | {
      readonly ok: true;
      readonly escaped: true;
      readonly fine: 0;
      readonly nextDebt: number;
      readonly nextTries: number;
    }
  | {
      readonly ok: true;
      readonly escaped: false;
      readonly fine: number;
      readonly nextDebt: number;
      readonly nextTries: number;
    };

/**
 * Evaluate overseas escape attempt:
 * - Blocked if bankrupt, `debt < 5,000`, `tries >= 2`, or `< 24h` since last attempt.
 * - Rolls `rng.float() < 0.01`: 1% success (caller executes escape bankruptcy),
 *   99% failure adding fine `max(1,000, floor(debt * 0.10))` to debt.
 */
export function rollEscapeAttempt(input: EscapeEligibility, rng: Rng): EscapeRollResult {
  if (input.status === 'bankrupt') return { ok: false, reason: 'escape_bankrupt' };
  if (input.debt < TEIAI_CONSTANTS.escapeMinDebt) return { ok: false, reason: 'escape_low_debt' };
  if (input.escapeTries >= TEIAI_CONSTANTS.escapeMaxTries) {
    return { ok: false, reason: 'escape_max_tries' };
  }
  const cooldownMs = TEIAI_CONSTANTS.escapeCooldownHours * MS_PER_HOUR;
  if (input.lastEscapeAtMs > 0 && input.nowMs - input.lastEscapeAtMs < cooldownMs) {
    return { ok: false, reason: 'escape_cooldown' };
  }
  const escaped = rng.float() < TEIAI_CONSTANTS.escapeChanceBps / BPS_SCALE;
  const nextTries = input.escapeTries + 1;
  if (escaped) {
    return { ok: true, escaped: true, fine: 0, nextDebt: input.debt, nextTries };
  }
  const fine = Math.max(
    TEIAI_CONSTANTS.escapeFineMin,
    Math.floor((input.debt * TEIAI_CONSTANTS.escapeFineRateBps) / BPS_SCALE),
  );
  return {
    ok: true,
    escaped: false,
    fine,
    nextDebt: input.debt + fine,
    nextTries,
  };
}

/**
 * Pure waterfall distribution for bankruptcy (`bankrupt_for`):
 * 1. Senior Teiai debt paid first from `pool`.
 * 2. Remaining pool pays junior P2P loans oldest-first (`repaid` if remaining == 0, else `discharged`).
 * 3. Any surplus returned to player.
 * 4. Remaining Teiai debt compressed to `<= 10,000` (or `0` on `escape: true`).
 * 5. Auto-seed `3,000` added if `debtAfterCompression > 0` and player has 0 cash.
 * 6. CDS settlement rule (CODE behaviour): `cdsPayable = forced || inGrace`.
 */
export interface JuniorLoanClaim {
  readonly loanId: number;
  readonly lenderId: string;
  readonly remaining: number;
}

export interface JuniorLoanSettlement {
  readonly loanId: number;
  readonly lenderId: string;
  readonly paid: number;
  readonly discharged: number;
  readonly nextStatus: 'repaid' | 'discharged';
}

export interface BankruptcyWaterfallResult {
  readonly seniorPaid: number;
  readonly juniorPaid: number;
  readonly forgiven: number;
  readonly surplusReturned: number;
  readonly compressed: number;
  readonly debtAfterCompression: number;
  readonly seedLoan: number;
  readonly finalDebt: number;
  readonly cdsPayable: boolean;
  readonly juniorSettlements: readonly JuniorLoanSettlement[];
}

export function computeBankruptcyWaterfall(input: {
  readonly pool: number;
  readonly teiaiDebt: number;
  readonly juniorLoans: readonly JuniorLoanClaim[];
  readonly forced: boolean;
  readonly inGrace: boolean;
  readonly escape: boolean;
}): BankruptcyWaterfallResult {
  let remainingPool = Math.max(0, input.pool);
  const seniorPaid = Math.min(remainingPool, Math.max(0, input.teiaiDebt));
  remainingPool -= seniorPaid;
  const debtAfterSenior = Math.max(0, input.teiaiDebt) - seniorPaid;

  let juniorPaid = 0;
  let forgiven = 0;
  const juniorSettlements: JuniorLoanSettlement[] = [];
  for (const loan of input.juniorLoans) {
    const owed = Math.max(0, loan.remaining);
    const paid = Math.min(remainingPool, owed);
    remainingPool -= paid;
    const left = owed - paid;
    juniorPaid += paid;
    forgiven += left;
    juniorSettlements.push({
      loanId: loan.loanId,
      lenderId: loan.lenderId,
      paid,
      discharged: left,
      nextStatus: left <= 0 ? 'repaid' : 'discharged',
    });
  }

  const surplusReturned = remainingPool;
  const floor = input.escape ? 0 : TEIAI_CONSTANTS.bankruptFloor;
  const debtAfterCompression = Math.min(debtAfterSenior, floor);
  const compressed = debtAfterSenior - debtAfterCompression;
  const seedLoan =
    debtAfterCompression > 0 && surplusReturned === 0 ? TEIAI_CONSTANTS.seedLoanCap : 0;
  const finalDebt = debtAfterCompression + seedLoan;
  // CODE behaviour per docs/spec/teiai.md:81: payable = forced || inGrace (escaping while in grace pays CDS)
  const cdsPayable = input.forced || input.inGrace;

  return {
    seniorPaid,
    juniorPaid,
    forgiven,
    surplusReturned,
    compressed,
    debtAfterCompression,
    seedLoan,
    finalDebt,
    cdsPayable,
    juniorSettlements,
  };
}

/**
 * Exact 9-step forced execution seizure order (`owe_for`).
 * Given a target `need` and available liquid/seizable pools in priority order, returns how much
 * to seize from each bucket and any leftover added to Teiai debt.
 */
export interface ForcedExecutionInputs {
  readonly need: number;
  readonly cash: number;
  readonly trustDeposit: number;
  readonly companyFunds: number;
  readonly marginLiquidatable: number;
  readonly spotLiquidatable: number;
  readonly optionLiquidatable: number;
  readonly normalBondLiquidatable: number;
  readonly selfCdsCoverage: number;
}

export interface ForcedExecutionPlan {
  readonly fromCash: number;
  readonly fromTrust: number;
  readonly fromCompanyFunds: number;
  readonly fromMargin: number;
  readonly fromSpot: number;
  readonly fromOptions: number;
  readonly fromBonds: number;
  readonly fromSelfCds: number;
  readonly addedDebt: number;
}

export function planForcedExecution(input: ForcedExecutionInputs): ForcedExecutionPlan {
  let rem = Math.max(0, input.need);
  const take = (avail: number): number => {
    const t = Math.min(rem, Math.max(0, avail));
    rem -= t;
    return t;
  };
  const fromCash = take(input.cash);
  const fromTrust = take(input.trustDeposit);
  const fromCompanyFunds = take(input.companyFunds);
  const fromMargin = take(input.marginLiquidatable);
  const fromSpot = take(input.spotLiquidatable);
  const fromOptions = take(input.optionLiquidatable);
  const fromBonds = take(input.normalBondLiquidatable);
  const fromSelfCds = take(input.selfCdsCoverage);
  return {
    fromCash,
    fromTrust,
    fromCompanyFunds,
    fromMargin,
    fromSpot,
    fromOptions,
    fromBonds,
    fromSelfCds,
    addedDebt: rem,
  };
}
