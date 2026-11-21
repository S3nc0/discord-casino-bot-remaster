import {
  API_ROUTES,
  ERROR_CODES,
  INBOX_PAGE_MAX,
  type ErrorCode,
  type InboxPage,
  type InboxReadRequest,
  type InboxReadResponse,
  type MeResponse,
  type TokenRequest,
  type TokenResponse,
  type UserSettings,
} from '@casino/shared';
import { parseSettings } from './stores/settings.ts';

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

export interface InboxRequest {
  /** Only items with `id < before`. */
  before?: number;
  limit?: number;
  unreadOnly?: boolean;
}

/** The HTTP routes of `API_ROUTES` the shell uses. */
export interface Api {
  token(request: TokenRequest): Promise<TokenResponse>;
  getMe(): Promise<MeResponse>;
  getSettings(): Promise<UserSettings>;
  /** Replaces the whole document; resolves with the stored copy. */
  saveSettings(settings: UserSettings): Promise<UserSettings>;
  getInbox(query?: InboxRequest): Promise<InboxPage>;
  markInboxRead(request: InboxReadRequest): Promise<InboxReadResponse>;
}

export interface HttpApiOptions {
  /** Path prefix in front of the routes, e.g. `/.proxy` inside Discord. */
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
      response = await doFetch(`${prefix}${path}`, init);
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
    token: (request) => call<TokenResponse>('POST', API_ROUTES.token, request, false),
    getMe: () => call<MeResponse>('GET', API_ROUTES.me),
    getSettings: async () => parseSettings(await call('GET', API_ROUTES.settings)),
    saveSettings: async (settings) =>
      parseSettings(await call('PUT', API_ROUTES.settings, settings)),
    getInbox: (query = {}) => {
      const params = new URLSearchParams();
      if (query.before !== undefined) params.set('before', String(query.before));
      params.set('limit', String(Math.min(query.limit ?? INBOX_PAGE_MAX, INBOX_PAGE_MAX)));
      if (query.unreadOnly) params.set('unread', '1');
      return call<InboxPage>('GET', `${API_ROUTES.inbox}?${params.toString()}`);
    },
    markInboxRead: (request) => call<InboxReadResponse>('POST', API_ROUTES.inboxRead, request),
  };
}
