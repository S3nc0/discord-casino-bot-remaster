import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DomainEvent, HorseRules } from '@casino/shared';
import { RuntimeContext } from '../../shell/runtime.ts';
import { formatClock } from './format.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useToastStore } from '../../shell/stores/toasts.ts';
import { useLocale, useT, type Translate } from '../../shell/i18n.ts';
import { HorseApiError } from './api.ts';

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Fetch again; the old data stays on screen until the new data arrives. */
  reload: () => Promise<void>;
}

/** Load once per `deps` change; `reload` refreshes in place. */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const alive = useRef(true);
  const generation = useRef(0);

  const run = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const data = await loadRef.current();
      if (alive.current && mine === generation.current)
        setState({ data, error: null, loading: false });
    } catch (error) {
      if (alive.current && mine === generation.current)
        setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true }));
    void run();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run };
}

/**
 * "Now" on the server's clock, ticking every `intervalMs`. The offset is taken whenever the
 * server's `now` of the last fetch changes, so a wrong device clock does not shift countdowns.
 */
export function useServerNow(serverNow: number | null | undefined, intervalMs = 1000): number {
  const skew = useRef(0);
  const lastSeen = useRef<number | null | undefined>(undefined);
  if (serverNow !== lastSeen.current) {
    lastSeen.current = serverNow;
    skew.current = serverNow == null ? 0 : serverNow - Date.now();
  }
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return Date.now() + skew.current;
}

/** Domain events of the guild (`RaceFinished`, `RaceScheduled`, ...) while the screen is open. */
export function useDomainEvents(handler: (event: DomainEvent) => void): void {
  const runtime = useContext(RuntimeContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const socket = runtime?.socket.raw;
    if (!socket) return;
    const listener = (event: DomainEvent) => ref.current(event);
    socket.on('domain:event', listener);
    return () => {
      socket.off('domain:event', listener);
    };
  }, [runtime]);
}

/** Show the balance a write returned right away; the socket event confirms it. */
export function applyBalance(balance: number): void {
  useBalanceStore.getState().set(balance);
}

/** The text for a refused request: the game rule's own message, else the error code's. */
export function errorText(
  t: Translate,
  locale: Parameters<typeof formatClock>[0],
  error: unknown,
  rules?: Pick<HorseRules, 'breedMinRaces' | 'maxFoals' | 'maxHorses' | 'nameMax'> | null,
): string {
  if (!(error instanceof HorseApiError)) return t('screen.horse.err.generic');
  const { rule } = error;
  if (rule) {
    const params: Record<string, string | number> = { ...error.params };
    if (typeof params.at === 'number') params.time = formatClock(locale, params.at);
    if (typeof params.stat === 'string') params.stat = t(`screen.horse.stat.${params.stat}`);
    if (rules) {
      params.min = rules.breedMinRaces;
      params.max =
        rule === 'foal_limit'
          ? rules.maxFoals
          : rule === 'stable_full'
            ? rules.maxHorses
            : rule === 'name_too_long'
              ? rules.nameMax
              : (params.max ?? rules.maxHorses);
    }
    for (const key of [
      `screen.horse.err.${rule}`,
      `horse.breed.err.${rule}`,
      `horse.err.${rule}`,
    ]) {
      const text = t(key, params);
      if (text !== key) return text;
    }
  }
  return t(`error.${error.code}`);
}

export interface Runner {
  busy: boolean;
  /** The last refusal, cleared by the next run. */
  error: unknown;
  clearError: () => void;
  /** Run a write; resolves with its response, or undefined when it failed. */
  run: <T>(
    fn: () => Promise<T>,
    done?: string,
    doneParams?: Record<string, string | number>,
  ) => Promise<T | undefined>;
}

/** Busy flag, error capture and a success toast for one screen's writes. */
export function useRunner(): Runner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async <T>(
      fn: () => Promise<T>,
      done?: string,
      doneParams?: Record<string, string | number>,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        if (done)
          useToastStore
            .getState()
            .push({
              tone: 'success',
              messageKey: done,
              ...(doneParams ? { params: doneParams } : {}),
            });
        return result;
      } catch (caught) {
        if (alive.current) setError(caught);
        return undefined;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, clearError: () => setError(null), run };
}

/** Text of the runner's error, live-translated. */
export function useErrorText(
  error: unknown,
  rules?: Pick<HorseRules, 'breedMinRaces' | 'maxFoals' | 'maxHorses' | 'nameMax'> | null,
): string | null {
  const t = useT();
  const locale = useLocale();
  return error ? errorText(t, locale, error, rules) : null;
}
