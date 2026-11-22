import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { RuntimeContext, type ShellRuntime } from '../../shell/runtime.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { createHorseHttpApi, type HorseApi } from './api.ts';
import { createMockHorseApi } from './mock.ts';

const HorseApiContext = createContext<HorseApi | null>(null);

/** Tests and previews hand the screens their own API. */
export function HorseApiProvider({ api, children }: { api: HorseApi; children: ReactNode }) {
  return <HorseApiContext.Provider value={api}>{children}</HorseApiContext.Provider>;
}

const mocks = new WeakMap<ShellRuntime, HorseApi>();

function apiFor(runtime: ShellRuntime): HorseApi {
  // The flag is replaced at build time, so a production bundle carries no mock API.
  if (import.meta.env.VITE_MOCK_DISCORD === '1' && runtime.config.mode === 'mock') {
    let mock = mocks.get(runtime);
    if (!mock) {
      mock = createMockHorseApi();
      mocks.set(runtime, mock);
    }
    return mock;
  }
  return createHorseHttpApi({
    prefix: runtime.config.proxyPrefix,
    getSessionToken: () => useSessionStore.getState().sessionToken,
  });
}

/** The injected API, else the real one (or the in-memory one in mock mode) of the shell runtime. */
export function useHorseApi(): HorseApi {
  const injected = useContext(HorseApiContext);
  const runtime = useContext(RuntimeContext);
  return useMemo(() => {
    if (injected) return injected;
    if (!runtime) throw new Error('HorseApiProvider or ShellRuntime missing');
    return apiFor(runtime);
  }, [injected, runtime]);
}
