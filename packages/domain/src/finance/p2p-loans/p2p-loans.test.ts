import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MS_PER_DAY } from '../math.ts';
import {
  formatLoanRate,
  lateRateBps,
  loanFullTermTotal,
  loanLateInterest,
  loanRemaining,
  loanTotalOwed,
  planMaturityCollection,
  planOverdueGarnishment,
  rateTenthsToBps,
  validateLoanTerms,
} from './index.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const BASE_MS = 1_736_121_600_000;

interface LoansFixture {
  readonly domain_math: {
    readonly rate_text_15: string;
    readonly late_rate_tenths_15: number;
    readonly late_rate_tenths_10: number;
    readonly full_term_total: number;
    readonly total_day_2: number;
    readonly total_day_5_due: number;
    readonly total_day_10_overdue: number;
    readonly total_day_100_capped: number;
  };
}

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/legacy/p2p-loans/loans.json'), 'utf8'),
) as LoansFixture;

describe('p2p-loans domain parity', () => {
  it('matches legacy domain_math fixture 100%', () => {
    const rate15 = rateTenthsToBps(15);
    const rate10 = rateTenthsToBps(10);

    expect(formatLoanRate(rate15)).toBe(fixture.domain_math.rate_text_15);
    expect(lateRateBps(rate15) / 10).toBe(fixture.domain_math.late_rate_tenths_15);
    expect(lateRateBps(rate10) / 10).toBe(fixture.domain_math.late_rate_tenths_10);
    expect(loanFullTermTotal(10_000, rate15, 5)).toBe(fixture.domain_math.full_term_total);
    expect(loanTotalOwed(10_000, rate15, 5, BASE_MS, BASE_MS + 2 * MS_PER_DAY)).toBe(
      fixture.domain_math.total_day_2,
    );
    expect(loanTotalOwed(10_000, rate15, 5, BASE_MS, BASE_MS + 5 * MS_PER_DAY)).toBe(
      fixture.domain_math.total_day_5_due,
    );
    expect(loanTotalOwed(10_000, rate15, 5, BASE_MS, BASE_MS + 10 * MS_PER_DAY)).toBe(
      fixture.domain_math.total_day_10_overdue,
    );
    expect(loanTotalOwed(10_000, rate15, 5, BASE_MS, BASE_MS + 100 * MS_PER_DAY)).toBe(
      fixture.domain_math.total_day_100_capped,
    );
  });

  it('validates loan terms boundaries and maturity collection', () => {
    expect(validateLoanTerms(100, 0, 1).ok).toBe(true);
    expect(validateLoanTerms(99, 0, 1).ok).toBe(false);
    expect(validateLoanTerms(100, -10, 1).ok).toBe(false);
    expect(validateLoanTerms(100, 150, 0).ok).toBe(false);
    expect(validateLoanTerms(100, 150, 31).ok).toBe(false);

    const dueMs = BASE_MS + 5 * MS_PER_DAY;
    const mat = planMaturityCollection(
      { principal: 10_000, rateBps: 150, termDays: 5, acceptedAtMs: BASE_MS, paid: 3_000, dueMs },
      12_000,
    );
    expect(mat.collected).toBe(7_750);
    expect(mat.left).toBe(0);
    expect(mat.nextStatus).toBe('repaid');
  });
});

describe('p2p-loans fast-check invariants', () => {
  it('never produces negative wallet balances and strictly conserves Pelica across lend/repay/collect/garnish', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }), // lender initial balance
        fc.integer({ min: 0, max: 1_000_000 }), // borrower initial balance
        fc.integer({ min: 100, max: 500_000 }), // principal
        fc.integer({ min: 0, max: 500 }), // rate_tenths (0%..50%/day)
        fc.integer({ min: 1, max: 30 }), // term days
        fc.array(
          fc.record({
            dayOffset: fc.integer({ min: 0, max: 120 }),
            extraIncome: fc.integer({ min: 0, max: 200_000 }),
            manualRepay: fc.integer({ min: 0, max: 200_000 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (lenderInit, borrowerInit, rawPrincipal, rateTenths, termDays, steps) => {
          const principal = Math.min(rawPrincipal, lenderInit);
          let lenderBal = lenderInit;
          let borrowerBal = borrowerInit;
          let mintedIncome = 0;

          // Lend transfer (strict conservation)
          lenderBal -= principal;
          borrowerBal += principal;
          expect(lenderBal).toBeGreaterThanOrEqual(0);
          expect(borrowerBal).toBeGreaterThanOrEqual(0);
          expect(lenderBal + borrowerBal).toBe(lenderInit + borrowerInit);

          const rateBps = rateTenths * 10;
          let paid = 0;
          let currentMs = BASE_MS;

          for (const step of steps) {
            currentMs += step.dayOffset * MS_PER_DAY;
            borrowerBal += step.extraIncome;
            mintedIncome += step.extraIncome;

            const rem = loanRemaining(
              { principal, rateBps, termDays, acceptedAtMs: BASE_MS, paid },
              currentMs,
            );
            if (rem <= 0) break;

            const budget =
              step.manualRepay > 0 ? Math.min(borrowerBal, step.manualRepay) : borrowerBal;
            const garn = planOverdueGarnishment(
              budget,
              borrowerBal,
              [
                {
                  id: 1,
                  lenderId: 'lender',
                  principal,
                  rateBps,
                  termDays,
                  acceptedAtMs: BASE_MS,
                  paid,
                },
              ],
              currentMs,
            );

            borrowerBal -= garn.totalGarnished;
            lenderBal += garn.totalGarnished;
            paid += garn.totalGarnished;

            // 1. No negative wallet balances ever (unpaid debt stays in loan table)
            expect(borrowerBal).toBeGreaterThanOrEqual(0);
            expect(lenderBal).toBeGreaterThanOrEqual(0);
            // 2. Strict Pelica conservation across all P2P transfers
            expect(lenderBal + borrowerBal).toBe(lenderInit + borrowerInit + mintedIncome);
            // 3. Collection never exceeds remaining owed
            expect(garn.totalGarnished).toBeLessThanOrEqual(rem);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('total owed is monotonically non-decreasing in time and late penalty is capped at 2x principal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (principal, rateTenths, termDays, d1, d2) => {
          const rateBps = rateTenths * 10;
          const t1 = BASE_MS + Math.min(d1, d2) * MS_PER_DAY;
          const t2 = BASE_MS + Math.max(d1, d2) * MS_PER_DAY;
          const owed1 = loanTotalOwed(principal, rateBps, termDays, BASE_MS, t1);
          const owed2 = loanTotalOwed(principal, rateBps, termDays, BASE_MS, t2);
          expect(owed2).toBeGreaterThanOrEqual(owed1);

          const dueMs = BASE_MS + termDays * MS_PER_DAY;
          const late = loanLateInterest(principal, rateBps, dueMs, t2);
          expect(late).toBeLessThanOrEqual(principal * 2);
          expect(late).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
