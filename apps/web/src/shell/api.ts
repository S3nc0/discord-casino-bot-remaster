import {
  ERROR_CODES,
  type ErrorCode,
  type InboxItem,
  type TokenRequest,
  type TokenResponse,
} from '@casino/shared';
import { parseSettings, type Settings } from './stores/settings.ts';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(code: ErrorCode, status: number, retryAfterMs?: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * HTTP surface the shell needs. `token` is in the shared contract. The other three are NOT:
 * the contract has no settings, inbox-list or balance endpoint yet, so the paths below are a
 * proposal (`GET|PUT /api/settings`, `GET /api/inbox`, `GET /api/balance`) and mock mode
 * serves them from memory.
 */
export interface Api {
  token(request: TokenRequest): Promise<TokenResponse>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  getInbox(): Promise<InboxItem[]>;
  getBalance(): Promise<number | null>;
}

export interface HttpApiOptions {
  /** Path prefix in front of `/api`, e.g. `/.proxy` inside Discord. */
  prefix: string;
  getSessionToken: () => string | null;
  fetchImpl?: typeof fetch;
}

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

export function createHttpApi({ prefix, getSessionToken, fetchImpl }: HttpApiOptions): Api {
  const doFetch = (input: string, init: RequestInit) => (fetchImpl ?? fetch)(input, init);

  async function call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = auth ? getSessionToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let response: Response;
    try {
      response = await doFetch(`${prefix}/api${path}`, init);
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
    token: (request) => call<TokenResponse>('POST', '/token', request, false),
    getSettings: async () => parseSettings(await call('GET', '/settings')),
    saveSettings: async (settings) => parseSettings(await call('PUT', '/settings', settings)),
    getInbox: async () => {
      const body = await call<{ items?: InboxItem[] } | InboxItem[]>('GET', '/inbox');
      return Array.isArray(body) ? body : (body.items ?? []);
    },
    getBalance: async () => {
      const body = await call<{ balance?: unknown }>('GET', '/balance');
      return typeof body.balance === 'number' ? body.balance : null;
    },
  };
}
