import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { RuntimeContext, type ShellRuntime } from '../../shell/runtime.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import {
  createHttpStreamApi,
  createStreamSocket,
  type StreamApi,
  type StreamSocket,
} from './client.ts';

export interface StreamServices {
  api: StreamApi;
  socket: StreamSocket;
}

const StreamServicesContext = createContext<StreamServices | null>(null);

/** Tests inject fake HTTP + socket services here. */
export function StreamProvider({
  services,
  children,
}: {
  services: StreamServices;
  children: ReactNode;
}) {
  return (
    <StreamServicesContext.Provider value={services}>{children}</StreamServicesContext.Provider>
  );
}

/** Lazy in-memory stand-in for `dev:mock`, so production bundles never include mock code. */
function lazyMock(): StreamServices {
  const load = () => import('./mock.ts').then((m) => m.getMockStreamServices());
  return {
    api: {
      streams: () => load().then((s) => s.api.streams()),
      view: (id) => load().then((s) => s.api.view(id)),
      transfer: () => load().then((s) => s.api.transfer()),
      start: (input, key) => load().then((s) => s.api.start(input, key)),
      tip: (input, key) => load().then((s) => s.api.tip(input, key)),
      bet: (input, key) => load().then((s) => s.api.bet(input, key)),
      openRound: (input, key) => load().then((s) => s.api.openRound(input, key)),
      lock: (input, key) => load().then((s) => s.api.lock(input, key)),
      settle: (input, key) => load().then((s) => s.api.settle(input, key)),
      voidRound: (input, key) => load().then((s) => s.api.voidRound(input, key)),
      end: (input, key) => load().then((s) => s.api.end(input, key)),
    },
    socket: {
      join(streamId, onSnapshot) {
        let off: () => void = () => undefined;
        let stopped = false;
        void load().then((s) => {
          if (!stopped) off = s.socket.join(streamId, onSnapshot);
        });
        return () => {
          stopped = true;
          off();
        };
      },
      onEvent(listener) {
        let off: () => void = () => undefined;
        let stopped = false;
        void load().then((s) => {
          if (!stopped) off = s.socket.onEvent(listener);
        });
        return () => {
          stopped = true;
          off();
        };
      },
    },
  };
}

const built = new WeakMap<ShellRuntime, StreamServices>();

export function streamServicesFor(runtime: ShellRuntime): StreamServices {
  const known = built.get(runtime);
  if (known) return known;
  const services: StreamServices =
    runtime.config.mode === 'mock'
      ? lazyMock()
      : {
          api: createHttpStreamApi({
            prefix: runtime.config.proxyPrefix,
            getSessionToken: () => useSessionStore.getState().sessionToken,
          }),
          socket: createStreamSocket({
            getSocket: () => runtime.socket.raw,
            getGuildId: () => useSessionStore.getState().guildId,
          }),
        };
  built.set(runtime, services);
  return services;
}

export function useStreamServices(): StreamServices {
  const injected = useContext(StreamServicesContext);
  const runtime = useContext(RuntimeContext);
  return useMemo(() => {
    if (injected) return injected;
    if (!runtime) throw new Error('ShellRuntime missing');
    return streamServicesFor(runtime);
  }, [injected, runtime]);
}
