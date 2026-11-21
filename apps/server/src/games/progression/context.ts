import type { Clock, DomainEvent, ErrorCode, Rng } from '@casino/shared';
import type { Store } from '../../db/store.ts';
import type { EconomyService, ApplyResult } from '../../economy/economy-service.ts';
import type { EventBus } from '../../runtime/bus.ts';
import { withholdIncome } from '@casino/domain/progression';
import type { LedgerReason } from '@casino/shared';
import { AppError } from '../../runtime/errors.ts';
import type { TeiaiPort } from './ports.ts';

/** Everything a non-casino game service needs. One instance per process. */
export interface GamesCtx {
  store: Store;
  economy: EconomyService;
  bus: EventBus;
  clock: Clock;
  rng: Rng;
  teiai: TeiaiPort;
  /** Game-day offset in hours (JST = 9). */
  offsetHours: number;
}

/** Publish a domain event once the surrounding transaction has committed. */
export function emit(ctx: GamesCtx, event: DomainEvent): void {
  ctx.store.afterCommit(() => ctx.bus.publishDomain(event));
}

export interface IncomeChange {
  guildId: string;
  userId: string;
  amount: number;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  idempotencyKey: string;
}

/**
 * Credit income and take the debtor's 30 % withholding: the gross credit is one ledger row, the
 * withholding its own `debt_withholding` sink row, and the debt shrinks by the same amount.
 */
export function creditIncome(
  ctx: GamesCtx,
  change: IncomeChange,
): { result: ApplyResult; withheld: number } {
  const result = ctx.economy.credit({ ...change });
  const debt = ctx.teiai.debtOf(change.guildId, change.userId);
  const withheld = result.replayed ? 0 : withholdIncome(change.amount, debt);
  if (withheld > 0) {
    ctx.economy.debit({
      guildId: change.guildId,
      userId: change.userId,
      amount: withheld,
      reason: 'debt_withholding',
      refType: change.refType,
      refId: change.refId,
      idempotencyKey: `${change.idempotencyKey}:w`,
    } as Parameters<EconomyService['debit']>[0]);
    ctx.teiai.repayDebt(change.guildId, change.userId, withheld);
  }
  return { result, withheld };
}

/**
 * Charge a player as far as the wallet reaches and turn the rest into Teiai debt. The balance
 * never goes below zero; the shortfall is returned.
 */
export function chargeOrOwe(
  ctx: GamesCtx,
  charge: {
    guildId: string;
    userId: string;
    amount: number;
    reason: LedgerReason;
    why: string;
    refType?: string;
    refId?: string;
    idempotencyKey: string;
  },
): { paid: number; shortfall: number } {
  const balance = ctx.economy.getBalance(charge.guildId, charge.userId);
  const paid = Math.min(balance, charge.amount);
  if (paid > 0) {
    ctx.economy.debit({
      guildId: charge.guildId,
      userId: charge.userId,
      amount: paid,
      reason: charge.reason,
      refType: charge.refType,
      refId: charge.refId,
      idempotencyKey: charge.idempotencyKey,
    } as Parameters<EconomyService['debit']>[0]);
  }
  const shortfall = charge.amount - paid;
  if (shortfall > 0) ctx.teiai.addDebt(charge.guildId, charge.userId, shortfall, charge.why);
  return { paid, shortfall };
}

/**
 * A rule of a game said no (not enough Pelica, a limit, a closed window). `rule` is the stable
 * snake_case key the client maps to its i18n text (`horse.err.<rule>` style); `params` fill it.
 */
export class GameRuleError extends AppError {
  readonly rule: string;
  readonly params: Record<string, string | number>;

  constructor(
    rule: string,
    params: Record<string, string | number> = {},
    code: ErrorCode = 'conflict',
  ) {
    super(code, { message: rule });
    this.name = 'GameRuleError';
    this.rule = rule;
    this.params = params;
  }
}
