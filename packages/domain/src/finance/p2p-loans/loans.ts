import { BPS_SCALE, MS_PER_DAY } from '../math.ts';
import { P2P_LOAN_CONSTANTS, type LoanStatus } from './constants.ts';

/** Convert legacy `rate_tenths` (0.1%/day) to basis points (`rate_bps = rate_tenths * 10`). */
export function rateTenthsToBps(rateTenths: number): number {
  return Math.round(rateTenths) * 10;
}

/** Format a daily rate in bps as a percentage string with 1 decimal (e.g. `150` -> `"1.5%"`). */
export function formatLoanRate(rateBps: number): string {
  const tenths = Math.round(rateBps / 10);
  return `${(tenths / 10).toFixed(1)}%`;
}

/**
 * Overdue daily penalty rate in basis points:
 * `max(1.5x contract rate truncated to 0.1%, 2.0%/day)`.
 * Mirrors legacy `max(r_tenths * 3 // 2, 20) * 10`.
 */
export function lateRateBps(rateBps: number): number {
  const rateTenths = Math.floor(rateBps / 10);
  const lateTenths = Math.max(
    Math.floor((rateTenths * 3) / 2),
    P2P_LOAN_CONSTANTS.lateMinRateBps / 10,
  );
  return lateTenths * 10;
}

/**
 * Elapsed interest days, ceiling-rounded and clamped to `[1, termDays]`
 * (minimum 1 day even if repaid immediately).
 */
export function loanElapsedDays(acceptedAtMs: number, nowMs: number, termDays: number): number {
  const rawDays = Math.ceil((nowMs - acceptedAtMs) / MS_PER_DAY);
  return Math.min(termDays, Math.max(1, rawDays));
}

/** Simple daily regular interest in integer Pelica (floor division). */
export function loanRegularInterest(principal: number, rateBps: number, days: number): number {
  if (principal <= 0 || rateBps <= 0 || days <= 0) return 0;
  return Math.floor((principal * rateBps * days) / BPS_SCALE);
}

/**
 * Overdue penalty interest when `nowMs > dueMs`.
 * Ceiling on overdue days, capped at `2 * principal`. Floor integer Pelica.
 */
export function loanLateInterest(
  principal: number,
  rateBps: number,
  dueMs: number,
  nowMs: number,
): number {
  if (principal <= 0 || nowMs <= dueMs) return 0;
  const overdueDays = Math.ceil((nowMs - dueMs) / MS_PER_DAY);
  if (overdueDays <= 0) return 0;
  const penaltyRate = lateRateBps(rateBps);
  const raw = Math.floor((principal * penaltyRate * overdueDays) / BPS_SCALE);
  return Math.min(principal * P2P_LOAN_CONSTANTS.lateCapMultiplier, raw);
}

/** Full-term total owed at exact maturity (principal + full regular interest, zero penalty). */
export function loanFullTermTotal(principal: number, rateBps: number, termDays: number): number {
  return principal + loanRegularInterest(principal, rateBps, termDays);
}

/** Total owed on an active/overdue loan evaluated at `nowMs`. */
export function loanTotalOwed(
  principal: number,
  rateBps: number,
  termDays: number,
  acceptedAtMs: number,
  nowMs: number,
): number {
  const days = loanElapsedDays(acceptedAtMs, nowMs, termDays);
  const regular = loanRegularInterest(principal, rateBps, days);
  const dueMs = acceptedAtMs + termDays * MS_PER_DAY;
  const late = loanLateInterest(principal, rateBps, dueMs, nowMs);
  return principal + regular + late;
}

export interface LoanTerms {
  readonly principal: number;
  readonly rateBps: number;
  readonly termDays: number;
  readonly acceptedAtMs: number;
  readonly paid: number;
}

/** Remaining Pelica owed on an active or overdue loan at `nowMs` (clamped at 0). */
export function loanRemaining(loan: LoanTerms, nowMs: number): number {
  const total = loanTotalOwed(
    loan.principal,
    loan.rateBps,
    loan.termDays,
    loan.acceptedAtMs,
    nowMs,
  );
  return Math.max(0, total - loan.paid);
}

/** Validate shared loan term parameters (`principal`, `rateBps`, `termDays`). */
export function validateLoanTerms(
  principal: number,
  rateBps: number,
  termDays: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!Number.isInteger(principal) || principal < P2P_LOAN_CONSTANTS.minPrincipal) {
    return { ok: false, reason: 'loan_principal_too_small' };
  }
  if (!Number.isInteger(rateBps) || rateBps < 0) {
    return { ok: false, reason: 'loan_invalid_rate' };
  }
  if (
    !Number.isInteger(termDays) ||
    termDays < P2P_LOAN_CONSTANTS.minTermDays ||
    termDays > P2P_LOAN_CONSTANTS.maxTermDays
  ) {
    return { ok: false, reason: 'loan_invalid_term' };
  }
  return { ok: true };
}

/**
 * Evaluate maturity auto-collection (`loan_collect_due`).
 * Crucially evaluates remaining owed at exact `dueMs` (NOT `nowMs`) so bot downtime does not
 * add late penalty before the loan transitions to `overdue`.
 */
export function planMaturityCollection(
  loan: LoanTerms & { readonly dueMs: number },
  borrowerBalance: number,
): {
  readonly collected: number;
  readonly left: number;
  readonly nextPaid: number;
  readonly nextStatus: Extract<LoanStatus, 'repaid' | 'overdue'>;
} {
  const remainingAtDue = loanRemaining(loan, loan.dueMs);
  const collected = Math.min(Math.max(0, borrowerBalance), remainingAtDue);
  const left = remainingAtDue - collected;
  return {
    collected,
    left,
    nextPaid: loan.paid + collected,
    nextStatus: left <= 0 ? 'repaid' : 'overdue',
  };
}

export interface OverdueLoanItem extends LoanTerms {
  readonly id: number;
  readonly lenderId: string;
}

export interface GarnishmentAllocation {
  readonly loanId: number;
  readonly lenderId: string;
  readonly amount: number;
  readonly nextPaid: number;
  readonly nextStatus: Extract<LoanStatus, 'repaid' | 'overdue'>;
}

/**
 * Allocate remaining 30% withholding budget (after senior Teiai debt) across overdue P2P loans
 * in ascending `id` (oldest-first) order. Never exceeds borrower's available cash or budget.
 */
export function planOverdueGarnishment(
  budget: number,
  borrowerBalance: number,
  overdueLoans: readonly OverdueLoanItem[],
  nowMs: number,
): { readonly totalGarnished: number; readonly allocations: readonly GarnishmentAllocation[] } {
  let available = Math.min(Math.max(0, budget), Math.max(0, borrowerBalance));
  if (available <= 0 || overdueLoans.length === 0) {
    return { totalGarnished: 0, allocations: [] };
  }

  const ordered = [...overdueLoans].sort((a, b) => a.id - b.id);
  const allocations: GarnishmentAllocation[] = [];
  let totalGarnished = 0;

  for (const loan of ordered) {
    if (available <= 0) break;
    const rem = loanRemaining(loan, nowMs);
    if (rem <= 0) continue;
    const amount = Math.min(available, rem);
    available -= amount;
    totalGarnished += amount;
    allocations.push({
      loanId: loan.id,
      lenderId: loan.lenderId,
      amount,
      nextPaid: loan.paid + amount,
      nextStatus: rem - amount <= 0 ? 'repaid' : 'overdue',
    });
  }

  return { totalGarnished, allocations };
}
