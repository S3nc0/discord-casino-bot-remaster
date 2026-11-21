import type { ErrorCode } from '@casino/shared';

/** Default HTTP status for each machine-readable error code. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  guild_not_allowed: 403,
  guild_pending: 403,
  invalid_payload: 400,
  rate_limited: 429,
  insufficient_funds: 409,
  feature_disabled: 403,
  not_found: 404,
  conflict: 409,
  in_flight: 409,
  expired: 401,
  game_busy: 409,
  internal: 500,
};

/** An expected failure: carries the wire error code and the HTTP status to use. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  /**
   * Stable, secret-free reason code for why an auth check said no (see `auth/reasons.ts`).
   * Logged on every 401/403; in the response body only outside production.
   */
  readonly authReason: string | undefined;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      status?: number;
      retryAfterMs?: number;
      reason?: string;
      cause?: unknown;
    } = {},
  ) {
    super(
      options.message ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.retryAfterMs = options.retryAfterMs;
    this.authReason = options.reason;
  }
}
