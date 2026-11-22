import {
  CASINO_ROUTES,
  ERROR_CODES,
  type CasinoOverview,
  type DailyClaimResponse,
  type DailyStatus,
  type ErrorCode,
  type HistoryPage,
} from '@casino/shared';
import { ApiError } from '../../shell/api.ts';
import { newKey } from './client.ts';

/** The HTTP routes of the casino slice. */
export interface CasinoApi {
  overview(): Promise<CasinoOverview>;
  daily(): Promise<DailyStatus>;
  /** One claim; a repeat with the same key is answered from the server's store. */
  claimDaily(idempotencyKey?: string): Promise<DailyClaimResponse>;
  history(query?: { before?: number; limit?: number }): Promise<HistoryPage>;
}

export interface CasinoApiOptions {
  /** `/.proxy` inside Discord, empty otherwise. */
  prefix: string;
  getSessionToken: () => string | null;
  fetchImpl?: typeof fetch;
}

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

export function createCasinoApi({
  prefix,
  getSessionToken,
  fetchImpl,
}: CasinoApiOptions): CasinoApi {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(`${prefix}${path}`, init);
    } catch {
      throw new ApiError('internal', 0);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const p = (payload ?? {}) as { error?: unknown; retryAfterMs?: unknown };
      const code: ErrorCode = isErrorCode(p.error)
        ? p.error
        : response.status === 401
          ? 'unauthorized'
          : 'internal';
      throw new ApiError(
        code,
        response.status,
        typeof p.retryAfterMs === 'number' ? p.retryAfterMs : undefined,
      );
    }
    return payload as T;
  }

  return {
    overview: () => call<CasinoOverview>('GET', CASINO_ROUTES.overview),
    daily: () => call<DailyStatus>('GET', CASINO_ROUTES.daily),
    claimDaily: (idempotencyKey = newKey()) =>
      call<DailyClaimResponse>('POST', CASINO_ROUTES.dailyClaim, { idempotencyKey }),
    history: (query = {}) => {
      const params = new URLSearchParams();
      if (query.before !== undefined) params.set('before', String(query.before));
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const qs = params.toString();
      return call<HistoryPage>(
        'GET',
        qs ? `${CASINO_ROUTES.history}?${qs}` : CASINO_ROUTES.history,
      );
    },
  };
}
