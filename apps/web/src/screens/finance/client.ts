import { createContext, useContext, useMemo } from 'react';
import { ERROR_CODES, type ErrorCode } from '@casino/shared';
import { RuntimeContext } from '../../shell/runtime.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { createMockFinanceClient } from './mock.ts';
import { FinanceApiError, type FinanceClient } from './types.ts';

export { FinanceApiError } from './types.ts';
export type { FinanceBody, FinanceClient, FinanceReadRoute, FinanceReads } from './types.ts';

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

export interface HttpFinanceOptions {
  prefix: string;
  getSessionToken: () => string | null;
  fetchImpl?: typeof fetch;
}

export function createHttpFinanceClient(options: HttpFinanceOptions): FinanceClient {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = options.getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(`${options.prefix}${path}`, init);
    } catch {
      throw new FinanceApiError('internal', 0);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const p = (payload ?? {}) as { error?: unknown; reason?: unknown; retryAfterMs?: unknown };
      throw new FinanceApiError(
        isErrorCode(p.error) ? p.error : response.status === 401 ? 'unauthorized' : 'internal',
        response.status,
        typeof p.reason === 'string' ? p.reason : undefined,
        typeof p.retryAfterMs === 'number' ? p.retryAfterMs : undefined,
      );
    }
    return payload as T;
  }
  return {
    get: (route) => call('GET', route),
    post: (route, body) => call('POST', route, body),
  };
}

/** Tests and the screenshot run provide their own client here. */
export const FinanceClientContext = createContext<FinanceClient | null>(null);

let sharedMock: FinanceClient | null = null;

/** The injected client, else the in-memory one in mock mode, else the real HTTP one. */
export function useFinanceClient(): FinanceClient {
  const injected = useContext(FinanceClientContext);
  const runtime = useContext(RuntimeContext);
  const mode = runtime?.config.mode;
  const prefix = runtime?.config.proxyPrefix ?? '';
  return useMemo(() => {
    if (injected) return injected;
    if (mode === 'mock') return (sharedMock ??= createMockFinanceClient());
    return createHttpFinanceClient({
      prefix,
      getSessionToken: () => useSessionStore.getState().sessionToken,
    });
  }, [injected, mode, prefix]);
}
