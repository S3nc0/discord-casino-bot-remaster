import type { FINANCE_ROUTES } from '@casino/shared';
import {
  type ErrorCode,
  type FinanceBankView,
  type FinanceCompaniesView,
  type FinanceKyosaiView,
  type FinanceListingsView,
  type FinanceLoansView,
  type FinanceMarketView,
  type FinanceWriteResult,
} from '@casino/shared';

/** Every read route and the view it answers with. */
export interface FinanceReads {
  [FINANCE_ROUTES.bank]: FinanceBankView;
  [FINANCE_ROUTES.loans]: FinanceLoansView;
  [FINANCE_ROUTES.kyosai]: FinanceKyosaiView;
  [FINANCE_ROUTES.market]: FinanceMarketView;
  [FINANCE_ROUTES.companies]: FinanceCompaniesView;
  [FINANCE_ROUTES.listings]: FinanceListingsView;
}
export type FinanceReadRoute = keyof FinanceReads;

/** A write body always carries the idempotency key; the rest is the route's request. */
export type FinanceBody = { readonly idempotencyKey: string } & Record<string, unknown>;

export interface FinanceClient {
  get<R extends FinanceReadRoute>(route: R): Promise<FinanceReads[R]>;
  post(route: string, body: FinanceBody): Promise<FinanceWriteResult>;
}

/** A refused request: the generic code plus the stable rule code of the service, if any. */
export class FinanceApiError extends Error {
  readonly code: ErrorCode;
  readonly reason: string | undefined;
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(code: ErrorCode, status: number, reason?: string, retryAfterMs?: number) {
    super(reason ?? code);
    this.name = 'FinanceApiError';
    this.code = code;
    this.reason = reason;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
