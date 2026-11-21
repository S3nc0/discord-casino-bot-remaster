import {
  loanRemaining,
  MS_PER_DAY,
  MS_PER_HOUR,
  P2P_LOAN_CONSTANTS,
  planMaturityCollection,
  planOverdueGarnishment,
  validateLoanTerms,
  type JuniorLoanClaim,
  type JuniorLoanSettlement,
  type LoanStatus,
} from '@casino/domain/finance';
import type { TeiaiService, ServiceResult } from './teiai-service.ts';
import type { FinanceDeps } from './types.ts';

export interface LoanRow {
  id: number;
  guild_id: string;
  lender_id: string;
  borrower_id: string;
  principal: number;
  rate_bps: number;
  term_days: number;
  status: LoanStatus;
  paid: number;
  reminded: number;
  channel_id: string | null;
  message_id: string | null;
  created_at: number;
  offer_expires_at: number;
  accepted_at: number | null;
  due_at: number | null;
}

export interface MaturityCollectionEntry {
  readonly loan: LoanRow;
  readonly collected: number;
  readonly left: number;
}

export class P2pLoanService {
  private readonly deps: FinanceDeps;
  private readonly teiai: TeiaiService;

  constructor(deps: FinanceDeps, teiai: TeiaiService) {
    this.deps = deps;
    this.teiai = teiai;
  }

  getLoan(loanId: number): LoanRow | null {
    const row = this.deps.store
      .stmt('SELECT * FROM loans WHERE id = ?')
      .get(loanId) as LoanRow | undefined;
    return row ?? null;
  }

  hasOverdueLoan(guildId: string, userId: string): boolean {
    const row = this.deps.store
      .stmt(
        "SELECT 1 AS found FROM loans WHERE guild_id = ? AND borrower_id = ? AND status = 'overdue' LIMIT 1",
      )
      .get(guildId, userId) as { found: number } | undefined;
    return row !== undefined;
  }

  remainingOf(loan: LoanRow, nowMs = this.deps.clock.now()): number {
    if (loan.accepted_at === null) return 0;
    return loanRemaining(
      {
        principal: loan.principal,
        rateBps: loan.rate_bps,
        termDays: loan.term_days,
        acceptedAtMs: loan.accepted_at,
        paid: loan.paid,
      },
      nowMs,
    );
  }

  private countOpenAsRole(
    guildId: string,
    column: 'lender_id' | 'borrower_id',
    userId: string,
    statuses: readonly LoanStatus[],
  ): number {
    const placeholders = statuses.map(() => '?').join(', ');
    const row = this.deps.store
      .stmt(
        `SELECT COUNT(*) AS cnt FROM loans
         WHERE guild_id = ? AND ${column} = ? AND status IN (${placeholders})`,
      )
      .get(guildId, userId, ...statuses) as { cnt: number };
    return row?.cnt ?? 0;
  }

  /** Lender creates a direct loan offer to a borrower (`offered`). */
  offerLoan(input: {
    readonly guildId: string;
    readonly lenderId: string;
    readonly borrowerId: string;
    readonly principal: number;
    readonly rateBps: number;
    readonly termDays: number;
    readonly channelId?: string;
    readonly messageId?: string;
    readonly nowMs?: number;
  }): ServiceResult<number> {
    const nowMs = input.nowMs ?? this.deps.clock.now();
    if (input.lenderId === input.borrowerId) return { ok: false, reason: 'loan_self_forbidden' };
    const valid = validateLoanTerms(input.principal, input.rateBps, input.termDays);
    if (!valid.ok) return valid;

    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(input.guildId, input.lenderId) !== 'katagi') {
        return { ok: false, reason: 'loan_lender_debtor_blocked' };
      }
      if (this.teiai.getStatus(input.guildId, input.borrowerId) === 'bankrupt') {
        return { ok: false, reason: 'loan_borrower_bankrupt' };
      }
      if (this.teiai.isBlacklistedFromP2pLoans(input.guildId, input.borrowerId, nowMs)) {
        return { ok: false, reason: 'loan_borrower_blacklisted' };
      }
      if (this.deps.economy.getBalance(input.guildId, input.lenderId) < input.principal) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const lenderOpen = this.countOpenAsRole(input.guildId, 'lender_id', input.lenderId, [
        'offer',
        'active',
        'overdue',
      ]);
      if (lenderOpen >= P2P_LOAN_CONSTANTS.maxLenderOpen) {
        return { ok: false, reason: 'loan_lender_limit' };
      }
      const borrowerOpen = this.countOpenAsRole(input.guildId, 'borrower_id', input.borrowerId, [
        'active',
        'overdue',
      ]);
      if (borrowerOpen >= P2P_LOAN_CONSTANTS.maxBorrowerOpen) {
        return { ok: false, reason: 'loan_borrower_limit' };
      }

      const offerExpiresAt = nowMs + P2P_LOAN_CONSTANTS.offerHours * MS_PER_HOUR;
      const res = this.deps.store
        .stmt(
          `INSERT INTO loans (
            guild_id, lender_id, borrower_id, principal, rate_bps, term_days, status,
            channel_id, message_id, created_at, offer_expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'offer', ?, ?, ?, ?)`,
        )
        .run(
          input.guildId,
          input.lenderId,
          input.borrowerId,
          input.principal,
          input.rateBps,
          input.termDays,
          input.channelId ?? null,
          input.messageId ?? null,
          nowMs,
          offerExpiresAt,
        );
      return { ok: true, data: Number(res.lastInsertRowid) };
    });
  }

  /** Borrower posts an open borrow request (`request`, `lender_id = ''` until funded). */
  requestLoan(input: {
    readonly guildId: string;
    readonly borrowerId: string;
    readonly principal: number;
    readonly rateBps: number;
    readonly termDays: number;
    readonly channelId?: string;
    readonly messageId?: string;
    readonly nowMs?: number;
  }): ServiceResult<number> {
    const nowMs = input.nowMs ?? this.deps.clock.now();
    const valid = validateLoanTerms(input.principal, input.rateBps, input.termDays);
    if (!valid.ok) return valid;

    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(input.guildId, input.borrowerId) === 'bankrupt') {
        return { ok: false, reason: 'loan_borrower_bankrupt' };
      }
      if (this.teiai.isBlacklistedFromP2pLoans(input.guildId, input.borrowerId, nowMs)) {
        return { ok: false, reason: 'loan_borrower_blacklisted' };
      }
      const borrowerOpen = this.countOpenAsRole(input.guildId, 'borrower_id', input.borrowerId, [
        'request',
        'active',
        'overdue',
      ]);
      if (borrowerOpen >= P2P_LOAN_CONSTANTS.maxBorrowerOpen) {
        return { ok: false, reason: 'loan_borrower_limit' };
      }

      const offerExpiresAt = nowMs + P2P_LOAN_CONSTANTS.offerHours * MS_PER_HOUR;
      const res = this.deps.store
        .stmt(
          `INSERT INTO loans (
            guild_id, lender_id, borrower_id, principal, rate_bps, term_days, status,
            channel_id, message_id, created_at, offer_expires_at
          ) VALUES (?, '', ?, ?, ?, ?, 'request', ?, ?, ?, ?)`,
        )
        .run(
          input.guildId,
          input.borrowerId,
          input.principal,
          input.rateBps,
          input.termDays,
          input.channelId ?? null,
          input.messageId ?? null,
          nowMs,
          offerExpiresAt,
        );
      return { ok: true, data: Number(res.lastInsertRowid) };
    });
  }

  /** Borrower accepts a pending lender offer (`offer` -> `active`). Transfers principal atomically. */
  acceptOffer(
    guildId: string,
    loanId: number,
    borrowerId: string,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<LoanRow> {
    return this.deps.store.transaction(() => {
      const loan = this.getLoan(loanId);
      if (!loan || loan.guild_id !== guildId || loan.status !== 'offer') {
        return { ok: false, reason: 'loan_not_found_or_closed' };
      }
      if (loan.borrower_id !== borrowerId) return { ok: false, reason: 'loan_not_borrower' };
      if (nowMs >= loan.offer_expires_at) {
        this.deps.store.stmt("UPDATE loans SET status = 'expired' WHERE id = ?").run(loanId);
        return { ok: false, reason: 'loan_offer_expired' };
      }
      if (this.teiai.getStatus(guildId, loan.lender_id) !== 'katagi') {
        return { ok: false, reason: 'loan_lender_debtor_blocked' };
      }
      if (this.teiai.getStatus(guildId, borrowerId) === 'bankrupt') {
        return { ok: false, reason: 'loan_borrower_bankrupt' };
      }
      if (this.teiai.isBlacklistedFromP2pLoans(guildId, borrowerId, nowMs)) {
        return { ok: false, reason: 'loan_borrower_blacklisted' };
      }
      if (this.deps.economy.getBalance(guildId, loan.lender_id) < loan.principal) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const dueAt = nowMs + loan.term_days * MS_PER_DAY;
      this.deps.economy.applyAll([
        {
          guildId,
          userId: loan.lender_id,
          delta: -loan.principal,
          reason: 'p2p_lend',
          refType: 'p2p_loan',
          refId: String(loanId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:lend` : undefined,
        },
        {
          guildId,
          userId: borrowerId,
          delta: loan.principal,
          reason: 'p2p_borrow',
          refType: 'p2p_loan',
          refId: String(loanId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:borrow` : undefined,
        },
      ]);

      this.deps.store
        .stmt("UPDATE loans SET status = 'active', accepted_at = ?, due_at = ? WHERE id = ?")
        .run(nowMs, dueAt, loanId);
      return { ok: true, data: this.getLoan(loanId)! };
    });
  }

  /** Any eligible lender funds an open borrow request (`request` -> `active`). */
  lendToRequest(
    guildId: string,
    loanId: number,
    lenderId: string,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<LoanRow> {
    return this.deps.store.transaction(() => {
      const loan = this.getLoan(loanId);
      if (!loan || loan.guild_id !== guildId || loan.status !== 'request') {
        return { ok: false, reason: 'loan_not_found_or_closed' };
      }
      if (loan.borrower_id === lenderId) return { ok: false, reason: 'loan_self_forbidden' };
      if (nowMs >= loan.offer_expires_at) {
        this.deps.store.stmt("UPDATE loans SET status = 'expired' WHERE id = ?").run(loanId);
        return { ok: false, reason: 'loan_offer_expired' };
      }
      if (this.teiai.getStatus(guildId, lenderId) !== 'katagi') {
        return { ok: false, reason: 'loan_lender_debtor_blocked' };
      }
      if (this.teiai.getStatus(guildId, loan.borrower_id) === 'bankrupt') {
        return { ok: false, reason: 'loan_borrower_bankrupt' };
      }
      if (this.teiai.isBlacklistedFromP2pLoans(guildId, loan.borrower_id, nowMs)) {
        return { ok: false, reason: 'loan_borrower_blacklisted' };
      }
      if (this.deps.economy.getBalance(guildId, lenderId) < loan.principal) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const lenderOpen = this.countOpenAsRole(guildId, 'lender_id', lenderId, [
        'offer',
        'active',
        'overdue',
      ]);
      if (lenderOpen >= P2P_LOAN_CONSTANTS.maxLenderOpen) {
        return { ok: false, reason: 'loan_lender_limit' };
      }

      const dueAt = nowMs + loan.term_days * MS_PER_DAY;
      this.deps.economy.applyAll([
        {
          guildId,
          userId: lenderId,
          delta: -loan.principal,
          reason: 'p2p_lend',
          refType: 'p2p_loan',
          refId: String(loanId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:lend` : undefined,
        },
        {
          guildId,
          userId: loan.borrower_id,
          delta: loan.principal,
          reason: 'p2p_borrow',
          refType: 'p2p_loan',
          refId: String(loanId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:borrow` : undefined,
        },
      ]);

      this.deps.store
        .stmt(
          "UPDATE loans SET lender_id = ?, status = 'active', accepted_at = ?, due_at = ? WHERE id = ?",
        )
        .run(lenderId, nowMs, dueAt, loanId);
      return { ok: true, data: this.getLoan(loanId)! };
    });
  }

  declineOffer(guildId: string, loanId: number, borrowerId: string): ServiceResult<void> {
    return this.deps.store.transaction(() => {
      const loan = this.getLoan(loanId);
      if (!loan || loan.guild_id !== guildId || loan.status !== 'offer') {
        return { ok: false, reason: 'loan_not_found_or_closed' };
      }
      if (loan.borrower_id !== borrowerId) return { ok: false, reason: 'loan_not_borrower' };
      this.deps.store.stmt("UPDATE loans SET status = 'declined' WHERE id = ?").run(loanId);
      return { ok: true, data: undefined };
    });
  }

  cancelPending(guildId: string, loanId: number, actorId: string): ServiceResult<void> {
    return this.deps.store.transaction(() => {
      const loan = this.getLoan(loanId);
      if (!loan || loan.guild_id !== guildId) return { ok: false, reason: 'loan_not_found_or_closed' };
      if (loan.status === 'offer' && loan.lender_id === actorId) {
        this.deps.store.stmt("UPDATE loans SET status = 'cancelled' WHERE id = ?").run(loanId);
        return { ok: true, data: undefined };
      }
      if (loan.status === 'request' && loan.borrower_id === actorId) {
        this.deps.store.stmt("UPDATE loans SET status = 'cancelled' WHERE id = ?").run(loanId);
        return { ok: true, data: undefined };
      }
      return { ok: false, reason: 'loan_cancel_forbidden' };
    });
  }

  /** Voluntary repayment (partial or full) by borrower on an active or overdue P2P loan. */
  repayLoan(
    guildId: string,
    loanId: number,
    borrowerId: string,
    amount?: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<number> {
    return this.deps.store.transaction(() => {
      const loan = this.getLoan(loanId);
      if (
        !loan ||
        loan.guild_id !== guildId ||
        (loan.status !== 'active' && loan.status !== 'overdue')
      ) {
        return { ok: false, reason: 'loan_not_found_or_closed' };
      }
      if (loan.borrower_id !== borrowerId) return { ok: false, reason: 'loan_not_borrower' };

      const rem = this.remainingOf(loan, nowMs);
      if (rem <= 0) {
        this.deps.store.stmt("UPDATE loans SET status = 'repaid' WHERE id = ?").run(loanId);
        return { ok: true, data: 0 };
      }
      const bal = this.deps.economy.getBalance(guildId, borrowerId);
      const want = amount === undefined ? rem : Math.min(amount, rem);
      const pay = Math.min(bal, want);
      if (pay <= 0) return { ok: false, reason: 'insufficient_funds' };

      this.deps.economy.applyAll([
        {
          guildId,
          userId: borrowerId,
          delta: -pay,
          reason: 'p2p_repay',
          refType: 'p2p_loan',
          refId: String(loanId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:repay` : undefined,
        },
        {
          guildId,
          userId: loan.lender_id,
          delta: pay,
          reason: 'p2p_collect',
          refType: 'p2p_loan',
          refId: String(loanId),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:collect` : undefined,
        },
      ]);

      const nextStatus: LoanStatus = rem - pay <= 0 ? 'repaid' : loan.status;
      this.deps.store
        .stmt('UPDATE loans SET paid = paid + ?, status = ? WHERE id = ?')
        .run(pay, nextStatus, loanId);

      return { ok: true, data: pay };
    });
  }

  /**
   * Automatic maturity collection (`loan_collect_due`).
   * Evaluates remaining owed at exact `due_at` (NOT `nowMs`) so bot downtime adds zero late penalty.
   * Publishes `LoanDue` for every matured loan processed.
   */
  collectDue(guildId: string, nowMs = this.deps.clock.now()): MaturityCollectionEntry[] {
    return this.deps.store.transaction(() => {
      const dueLoans = this.deps.store
        .stmt(
          `SELECT * FROM loans
           WHERE guild_id = ? AND status = 'active' AND due_at IS NOT NULL AND due_at <= ?
           ORDER BY due_at ASC, id ASC`,
        )
        .all(guildId, nowMs) as LoanRow[];

      const results: MaturityCollectionEntry[] = [];
      for (const loan of dueLoans) {
        if (loan.accepted_at === null || loan.due_at === null) continue;
        const bal = this.deps.economy.getBalance(guildId, loan.borrower_id);
        const plan = planMaturityCollection(
          {
            principal: loan.principal,
            rateBps: loan.rate_bps,
            termDays: loan.term_days,
            acceptedAtMs: loan.accepted_at,
            paid: loan.paid,
            dueMs: loan.due_at,
          },
          bal,
        );

        if (plan.collected > 0) {
          this.deps.economy.applyAll([
            {
              guildId,
              userId: loan.borrower_id,
              delta: -plan.collected,
              reason: 'p2p_repay',
              refType: 'p2p_loan_due',
              refId: String(loan.id),
            },
            {
              guildId,
              userId: loan.lender_id,
              delta: plan.collected,
              reason: 'p2p_collect',
              refType: 'p2p_loan_due',
              refId: String(loan.id),
            },
          ]);
        }

        this.deps.store
          .stmt('UPDATE loans SET paid = ?, status = ? WHERE id = ?')
          .run(plan.nextPaid, plan.nextStatus, loan.id);

        const updated = this.getLoan(loan.id)!;
        results.push({ loan: updated, collected: plan.collected, left: plan.left });

        const bus = this.deps.bus;
        if (bus) {
          const amountDue = plan.collected + plan.left;
          const dueAt = loan.due_at;
          this.deps.store.afterCommit(() => {
            bus.publishDomain({
              type: 'LoanDue',
              guildId,
              at: nowMs,
              userId: loan.borrower_id,
              loanId: loan.id,
              amount: amountDue,
              dueAt,
            });
          });
        }
      }

      return results;
    });
  }

  /**
   * Sweep overdue loans for any borrower holding cash (`collectOverdue`), OR garnish from an income
   * withholding budget (`garnishOverdue`).
   */
  garnishOverdue(
    guildId: string,
    borrowerId: string,
    budget: number,
    nowMs = this.deps.clock.now(),
  ): number {
    if (budget <= 0) return 0;
    return this.deps.store.transaction(() => {
      const overdueRows = this.deps.store
        .stmt(
          `SELECT * FROM loans
           WHERE guild_id = ? AND borrower_id = ? AND status = 'overdue'
           ORDER BY id ASC`,
        )
        .all(guildId, borrowerId) as LoanRow[];
      if (overdueRows.length === 0) return 0;

      const bal = this.deps.economy.getBalance(guildId, borrowerId);
      const plan = planOverdueGarnishment(
        budget,
        bal,
        overdueRows
          .filter((l) => l.accepted_at !== null)
          .map((l) => ({
            id: l.id,
            lenderId: l.lender_id,
            principal: l.principal,
            rateBps: l.rate_bps,
            termDays: l.term_days,
            acceptedAtMs: l.accepted_at!,
            paid: l.paid,
          })),
        nowMs,
      );

      for (const alloc of plan.allocations) {
        if (alloc.amount > 0) {
          this.deps.economy.applyAll([
            {
              guildId,
              userId: borrowerId,
              delta: -alloc.amount,
              reason: 'p2p_garnishment',
              refType: 'p2p_loan',
              refId: String(alloc.loanId),
            },
            {
              guildId,
              userId: alloc.lenderId,
              delta: alloc.amount,
              reason: 'p2p_collect',
              refType: 'p2p_loan',
              refId: String(alloc.loanId),
            },
          ]);
        }
        this.deps.store
          .stmt('UPDATE loans SET paid = ?, status = ? WHERE id = ?')
          .run(alloc.nextPaid, alloc.nextStatus, alloc.loanId);
      }

      return plan.totalGarnished;
    });
  }

  /** Publish `LoanDue` reminders once per active loan within 24h of maturity. */
  emitDueReminders(guildId: string, nowMs = this.deps.clock.now()): LoanRow[] {
    return this.deps.store.transaction(() => {
      const remindCutoff = nowMs + P2P_LOAN_CONSTANTS.remindHours * MS_PER_HOUR;
      const rows = this.deps.store
        .stmt(
          `SELECT * FROM loans
           WHERE guild_id = ? AND status = 'active' AND reminded = 0
             AND due_at IS NOT NULL AND due_at <= ? AND due_at > ?`,
        )
        .all(guildId, remindCutoff, nowMs) as LoanRow[];

      for (const loan of rows) {
        this.deps.store.stmt('UPDATE loans SET reminded = 1 WHERE id = ?').run(loan.id);
        const bus = this.deps.bus;
        if (bus && loan.due_at !== null) {
          const amount = this.remainingOf(loan, loan.due_at);
          const dueAt = loan.due_at;
          this.deps.store.afterCommit(() => {
            bus.publishDomain({
              type: 'LoanDue',
              guildId,
              at: nowMs,
              userId: loan.borrower_id,
              loanId: loan.id,
              amount,
              dueAt,
            });
          });
        }
      }
      return rows;
    });
  }

  /** Expire pending offers/requests older than 24h. */
  expireOffers(guildId: string, nowMs = this.deps.clock.now()): number {
    const res = this.deps.store
      .stmt(
        `UPDATE loans SET status = 'expired'
         WHERE guild_id = ? AND status IN ('offer', 'request') AND offer_expires_at <= ?`,
      )
      .run(guildId, nowMs);
    return res.changes;
  }

  /** Hook for `TeiaiService.declareBankruptcy`: list active/overdue loans oldest-first. */
  listJuniorLoansForBankruptcy(
    guildId: string,
    borrowerId: string,
    nowMs = this.deps.clock.now(),
  ): JuniorLoanClaim[] {
    const rows = this.deps.store
      .stmt(
        `SELECT * FROM loans
         WHERE guild_id = ? AND borrower_id = ? AND status IN ('active', 'overdue')
         ORDER BY id ASC`,
      )
      .all(guildId, borrowerId) as LoanRow[];
    return rows.map((l) => ({
      loanId: l.id,
      lenderId: l.lender_id,
      remaining: this.remainingOf(l, nowMs),
    }));
  }

  /** Hook for `TeiaiService.declareBankruptcy`: persist settlements and pay lenders via `p2p_bankruptcy_payout`. */
  applyJuniorLoanSettlements(
    guildId: string,
    settlements: readonly JuniorLoanSettlement[],
    nowMs = this.deps.clock.now(),
  ): void {
    this.deps.store.transaction(() => {
      for (const s of settlements) {
        this.deps.store
          .stmt('UPDATE loans SET paid = paid + ?, status = ? WHERE id = ?')
          .run(s.paid, s.nextStatus, s.loanId);
        if (s.paid > 0) {
          this.teiai.creditWithWithholding(guildId, s.lenderId, s.paid, 'p2p_bankruptcy_payout', {
            refType: 'p2p_loan_bankruptcy',
            refId: String(s.loanId),
            nowMs,
          });
        }
      }
    });
  }
}
