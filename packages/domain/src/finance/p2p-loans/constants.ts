/**
 * P2P Loans (`/貸付`) constants.
 * Mirrors `catalogs/economy.yaml` (`loans`) with integer Pelica and integer basis points.
 * Rate convention: 10 bps = 0.1%/day = 1 legacy `rate_tenths`.
 */
export const P2P_LOAN_CONSTANTS = {
  minPrincipal: 100,
  minTermDays: 1,
  maxTermDays: 30,
  offerHours: 24,
  maxBorrowerOpen: 1,
  maxLenderOpen: 5,
  maxLenderActive: 10,
  remindHours: 24,
  /** Minimum overdue daily penalty rate: 2.0%/day = 200 bps (= 20 legacy tenths). */
  lateMinRateBps: 200,
  /** Maximum cumulative late penalty = 2x principal. */
  lateCapMultiplier: 2,
} as const;

export type LoanStatus =
  | 'offer'
  | 'request'
  | 'active'
  | 'overdue'
  | 'repaid'
  | 'discharged'
  | 'declined'
  | 'cancelled'
  | 'expired';
