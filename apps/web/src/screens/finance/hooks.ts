import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceWriteResult, PublicUser } from '@casino/shared';
import { useSfx } from '@casino/ui';
import { formatPelica, useLocale, useT, type Translate } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useToastStore } from '../../shell/stores/toasts.ts';
import { useFinanceClient, FinanceApiError } from './client.ts';
import type { FinanceReadRoute, FinanceReads } from './types.ts';

export interface View<R extends FinanceReadRoute> {
  data: FinanceReads[R] | null;
  error: FinanceApiError | null;
  reload: () => Promise<void>;
}

/**
 * Loads one read route, then again after every write, when the balance changes (another player
 * settled something with us) and, if asked, on a timer. `enabled: false` loads nothing.
 */
export function useView<R extends FinanceReadRoute>(
  route: R,
  pollMs?: number,
  enabled = true,
): View<R> {
  const client = useFinanceClient();
  const balance = useBalanceStore((s) => s.balance);
  const [data, setData] = useState<FinanceReads[R] | null>(null);
  const [error, setError] = useState<FinanceApiError | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await client.get(route);
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (alive.current)
        setError(e instanceof FinanceApiError ? e : new FinanceApiError('internal', 0));
    }
  }, [client, route]);

  useEffect(() => {
    if (enabled) void reload();
  }, [reload, balance, enabled]);
  useEffect(() => {
    if (!pollMs || !enabled) return;
    const timer = setInterval(() => void reload(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, reload, enabled]);

  return { data, error, reload };
}

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export function errorMessage(t: Translate, error: unknown): string {
  if (error instanceof FinanceApiError) {
    if (error.reason) {
      const key = `screen.finance.reason.${error.reason}`;
      const text = t(key);
      if (text !== key) return text;
    }
    return t(`error.${error.code}`);
  }
  return t('error.internal');
}

export interface Action {
  busy: boolean;
  error: string | null;
  clear: () => void;
  /**
   * Send one write. `sig` names the request body: a retry of the same body reuses the
   * idempotency key (so a lost answer cannot pay twice), a changed body gets a new one.
   */
  run: (
    sig: string,
    send: (idempotencyKey: string) => Promise<FinanceWriteResult>,
    success: {
      key: string;
      params?: (result: FinanceWriteResult) => Record<string, string | number>;
    },
  ) => Promise<boolean>;
}

export function useAction(onDone: () => void | Promise<void>): Action {
  const t = useT();
  const sfx = useSfx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ sig: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const run: Action['run'] = useCallback(
    async (sig, send, success) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      if (pending.current?.sig !== sig) pending.current = { sig, key: newKey() };
      try {
        const result = await send(pending.current.key);
        pending.current = null;
        useToastStore.getState().push({
          tone: 'success',
          messageKey: success.key,
          ...(success.params ? { params: success.params(result) } : {}),
        });
        sfx.play('chip');
        await onDone();
        return true;
      } catch (e) {
        // A rule refusal stored nothing, so the same key may be tried again; keep it.
        setError(errorMessage(t, e));
        sfx.play('errorBuzz');
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [onDone, sfx, t],
  );

  return { busy, error, clear: () => setError(null), run };
}

/** Whole-number input: the text the player sees and the integer it stands for. */
export function useInt(initial = ''): [string, (text: string) => void, number | undefined] {
  const [text, setText] = useState(initial);
  const set = useCallback((next: string) => setText(next.replace(/[^0-9]/g, '').slice(0, 13)), []);
  const value = text === '' ? undefined : Number(text);
  return [text, set, value !== undefined && Number.isSafeInteger(value) ? value : undefined];
}

const WORD_JOINER = '\u2060';
const NO_BREAK_SPACE = '\u00a0';

/**
 * Keep an amount and its unit on one line: a space becomes a no-break space, and a unit written
 * straight after the digits (ペリカ) gets word joiners so the line cannot break inside it.
 */
export function glueAmount(text: string): string {
  return text.replace(/(\d)(\s?)([^\d\s]+)$/u, (_, digit: string, space: string, unit: string) =>
    space
      ? `${digit}${NO_BREAK_SPACE}${unit}`
      : `${digit}${WORD_JOINER}${[...unit].join(WORD_JOINER)}`,
  );
}

export function usePelica(): (amount: number) => string {
  const locale = useLocale();
  return useCallback((amount) => glueAmount(formatPelica(locale, amount)), [locale]);
}

/** Name of a ticker in the active language. */
export function useSymbolName(): (symbol: string) => string {
  const t = useT();
  return useCallback((symbol) => t(`screen.finance.market.symbol.${symbol}`), [t]);
}

/**
 * Display name of a listed asset: the catalog name in the active language, the relic name
 * (with its star), or the horse's own name.
 */
export function useAssetName(): (listing: {
  kind: 'item' | 'horse';
  ref: string;
  name: { en: string; ja: string } | null;
}) => string {
  const t = useT();
  const locale = useLocale();
  return useCallback(
    (listing) => {
      if (listing.name) return listing.name[locale];
      if (listing.kind === 'item') {
        const star = /^(relic_[a-z]+)_s(\d)$/.exec(listing.ref);
        const base = star?.[1] ?? listing.ref;
        const key = `screen.finance.item.${base}`;
        const name = t(key);
        if (name !== key)
          return star?.[2] ? t('screen.finance.item.star', { name, star: star[2] }) : name;
      }
      return listing.ref;
    },
    [t, locale],
  );
}

export function useNumber(): (amount: number, digits?: number) => string {
  const locale = useLocale();
  return useCallback(
    (amount, digits = 0) =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(amount),
    [locale],
  );
}

/** "3h 20m left" style text for a deadline. */
export function useTimeLeft(): (endMs: number) => string {
  const t = useT();
  return useCallback(
    (endMs) => {
      const left = Math.max(0, endMs - Date.now());
      const minutes = Math.floor(left / 60_000);
      if (minutes >= 1_440) {
        return t('screen.finance.time.days', {
          d: Math.floor(minutes / 1_440),
          h: Math.floor((minutes % 1_440) / 60),
        });
      }
      return t('screen.finance.time.hours', { h: Math.floor(minutes / 60), m: minutes % 60 });
    },
    [t],
  );
}

export interface Person {
  id: string;
  name: string;
}

/** The other players in this Activity, the ones a loan or unit offer can go to. */
export function usePeople(): Person[] {
  const participants = useSessionStore((s) => s.participants);
  const me = useSessionStore((s) => s.user?.id);
  return participants
    .filter((p: PublicUser) => p.id !== me)
    .map((p) => ({ id: p.id, name: p.globalName ?? p.username }));
}
