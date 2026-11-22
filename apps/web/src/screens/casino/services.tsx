import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { RuntimeContext, type ShellRuntime } from '../../shell/runtime.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { createCasinoApi, type CasinoApi } from './api.ts';
import { createSocketClient, type CasinoClient } from './client.ts';

export interface CasinoServices {
  api: CasinoApi;
  client: CasinoClient;
}

const ServicesContext = createContext<CasinoServices | null>(null);

/** Tests and the screenshot runs hand the screens their own services. */
export function CasinoProvider({
  services,
  children,
}: {
  services: CasinoServices;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** The mock implementation loads on first use, so a production bundle never pulls it in. */
function lazyMock(): CasinoServices {
  const load = () => import('./mock.ts').then((m) => m.getMockServices());
  return {
    api: {
      overview: () => load().then((s) => s.api.overview()),
      daily: () => load().then((s) => s.api.daily()),
      claimDaily: (key) => load().then((s) => s.api.claimDaily(key)),
      history: (query) => load().then((s) => s.api.history(query)),
    },
    client: {
      bet: (game, request) => load().then((s) => s.client.bet(game, request)),
      action: (game, roundId, action, args) =>
        load().then((s) => s.client.action(game, roundId, action, args)),
      watchTable(game, listener) {
        let off: () => void = () => undefined;
        let stopped = false;
        void load().then((s) => {
          if (!stopped) off = s.client.watchTable(game, listener);
        });
        return () => {
          stopped = true;
          off();
        };
      },
      clockOffsetMs: () => 0,
    },
  };
}

const built = new WeakMap<ShellRuntime, CasinoServices>();

export function servicesFor(runtime: ShellRuntime): CasinoServices {
  const known = built.get(runtime);
  if (known) return known;
  const services: CasinoServices =
    runtime.config.mode === 'mock'
      ? lazyMock()
      : {
          api: createCasinoApi({
            prefix: runtime.config.proxyPrefix,
            getSessionToken: () => useSessionStore.getState().sessionToken,
          }),
          client: createSocketClient({
            getSocket: () => runtime.socket.raw,
            getInstanceId: () => useSessionStore.getState().instanceId,
          }),
        };
  built.set(runtime, services);
  return services;
}

export function useCasino(): CasinoServices {
  const injected = useContext(ServicesContext);
  const runtime = useContext(RuntimeContext);
  return useMemo(() => {
    if (injected) return injected;
    if (!runtime) throw new Error('ShellRuntime missing');
    return servicesFor(runtime);
  }, [injected, runtime]);
}

/** Like `useCasino`, but null outside the app (a component test of Home without a runtime). */
export function useCasinoOptional(): CasinoServices | null {
  const injected = useContext(ServicesContext);
  const runtime = useContext(RuntimeContext);
  return useMemo(() => injected ?? (runtime ? servicesFor(runtime) : null), [injected, runtime]);
}
