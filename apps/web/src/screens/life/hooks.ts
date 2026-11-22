import { useCallback, useEffect, useRef, useState } from 'react';
import { en, type MessageParams } from '@casino/shared/i18n';
import { useSfx, type SfxName } from '@casino/ui';
import { currentLocale, formatPelica } from '../../shell/i18n.ts';
import { useToastStore, type ToastTone } from '../../shell/stores/toasts.ts';
import { LifeApiError } from './client.ts';

/** One key per user intent: the server runs a request once per key and replays the answer. */
export function newKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(16, '0');
}

const hasKey = (key: string): boolean => Object.prototype.hasOwnProperty.call(en, key);

/**
 * Message key and params for a failure: the game rule text if the server named one we know,
 * otherwise the generic text of the error code.
 */
export function errorMessage(error: unknown): { key: string; params: MessageParams } {
  if (error instanceof LifeApiError) {
    const locale = currentLocale();
    const nf = new Intl.NumberFormat(locale);
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(error.params ?? {})) {
      params[name] = typeof value === 'number' ? nf.format(value) : value;
    }
    if (error.rule && hasKey(`screen.life.rule.${error.rule}`)) {
      return { key: `screen.life.rule.${error.rule}`, params };
    }
    return { key: `error.${error.code}`, params };
  }
  return { key: 'error.internal', params: {} };
}

export function pushToast(tone: ToastTone, key: string, params?: Record<string, string | number>) {
  useToastStore.getState().push({ tone, messageKey: key, params });
}

export function toastError(error: unknown): void {
  const { key, params } = errorMessage(error);
  pushToast('error', key, params as Record<string, string | number>);
}

export interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  /** Patch the shown data without asking the server (after a write returned the new state). */
  patch: (update: (current: T) => T) => void;
}

/** Load once on mount (and on `reload`); the screens re-load after every write they make. */
export function useLoad<T>(load: () => Promise<T>, refreshMs = 0, key = ''): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await loader.current();
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, key]);
  useEffect(() => {
    if (refreshMs <= 0) return undefined;
    const id = setInterval(() => void reload(), refreshMs);
    return () => clearInterval(id);
  }, [reload, refreshMs]);

  const patch = useCallback((update: (current: T) => T) => {
    setData((current) => (current === null ? current : update(current)));
  }, []);
  return { data, error, loading, reload, patch };
}

export interface Intent {
  busy: boolean;
  /**
   * Run one write. Ignored while another is running. The key is made once per `label` and kept
   * when the call failed in transit, so a retry cannot pay twice; a rule refusal drops it.
   */
  run<T>(
    label: string,
    fn: (key: string) => Promise<T>,
    onError?: (error: unknown) => void,
  ): Promise<T | undefined>;
}

export function useIntent(): Intent {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const keys = useRef(new Map<string, string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback<Intent['run']>(async (label, fn, onError) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    const key = keys.current.get(label) ?? newKey();
    keys.current.set(label, key);
    try {
      const result = await fn(key);
      keys.current.delete(label);
      return result;
    } catch (e) {
      if (!(e instanceof LifeApiError && e.transient)) keys.current.delete(label);
      (onError ?? toastError)(e);
      return undefined;
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  return { busy, run };
}

/** `Date.now()` that re-renders every `ms` (countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** A sound effect that never throws (no audio device, tests). */
export function usePlay(): (name: SfxName) => void {
  const { play } = useSfx();
  return useCallback(
    (name) => {
      try {
        void play(name);
      } catch {
        // sound is a nicety
      }
    },
    [play],
  );
}

export { formatPelica };
