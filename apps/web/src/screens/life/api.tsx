import { createContext, useContext, useMemo } from 'react';
import { RuntimeContext, type ShellRuntime } from '../../shell/runtime.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { createHttpLifeApi, type LifeApi } from './client.ts';

/** Tests (and previews) provide their own API here. */
export const LifeApiContext = createContext<LifeApi | null>(null);

/** Every method of `LifeApi`, so the lazy mock can be wrapped without loading it up front. */
const METHODS = [
  'work',
  'workClick',
  'workCollect',
  'workDrink',
  'workUpgrade',
  'workHire',
  'workDismiss',
  'workRenew',
  'workMerge',
  'workRanking',
  'quiz',
  'quizAnswer',
  'quizPost',
  'quizWithdraw',
  'lottery',
  'lotteryJoin',
  'polls',
  'pollCreate',
  'pollVote',
  'shop',
  'shopBuy',
  'shopMarketBuy',
  'shopSeizedBuy',
  'missions',
  'ranking',
  'transfer',
  'transferMembers',
  'transferPreview',
  'transferSend',
] as const satisfies readonly (keyof LifeApi)[];

/** The in-memory stand-in is loaded on first use, so the real bundle never carries it. */
function lazyMock(): LifeApi {
  let loaded: Promise<LifeApi> | null = null;
  const load = () => (loaded ??= import('./mock.ts').then((m) => m.createMockLifeApi()));
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const name of METHODS) {
    api[name] = (...args) =>
      load().then((real) => (real[name] as (...a: unknown[]) => Promise<unknown>)(...args));
  }
  return api as unknown as LifeApi;
}

function buildApi(runtime: ShellRuntime): LifeApi {
  return runtime.config.mode === 'mock'
    ? lazyMock()
    : createHttpLifeApi({
        prefix: runtime.config.proxyPrefix,
        getSessionToken: () => useSessionStore.getState().sessionToken,
      });
}

/** The life API: the provided one, or the real/mocked one of the running shell. */
export function useLifeApi(): LifeApi {
  const provided = useContext(LifeApiContext);
  const runtime = useContext(RuntimeContext);
  return useMemo(() => {
    if (provided) return provided;
    if (!runtime) throw new Error('ShellRuntime missing');
    return buildApi(runtime);
  }, [provided, runtime]);
}
