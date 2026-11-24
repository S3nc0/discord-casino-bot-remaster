import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STREAM_ODDS_ONE,
  STREAM_TIP_COLOR_DEFAULT,
  STREAM_TIP_TIERS,
  streamTipColor,
  type StreamRoundView,
  type StreamView,
} from '@casino/shared';
import { en, type MessageParams } from '@casino/shared/i18n';
import type { TagHue } from '@casino/ui';
import { currentLocale } from '../../shell/i18n.ts';
import { useToastStore, type ToastTone } from '../../shell/stores/toasts.ts';
import { StreamApiError } from './client.ts';

/** Default transfer fee rate (10% = 1,000 bps) used until `GET /api/life/transfer` loads. */
export const DEFAULT_TIP_FEE_BPS = 1000;
/** Default transfer confirmation threshold (5,000 Pelica) used until transfer view loads. */
export const DEFAULT_TIP_CONFIRM_FROM = 5000;

/** One idempotency key per user intent; 16..64 chars of `[A-Za-z0-9_-]`. */
export function newStreamKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(16, '0');
}

/** `1,000` typed by a player → 1000; anything that is not a whole positive integer → 0. */
export function parseAmount(text: string): number {
  const digits = text.replace(/[,\s]/g, '');
  return /^[0-9]{1,7}$/.test(digits) ? Number(digits) : 0;
}

/** Transfer fee: `feeBps / 10_000` rounded up (10% ceiling, paid on top). */
export function calcTipFee(amount: number, feeBps = DEFAULT_TIP_FEE_BPS): number {
  if (amount <= 0 || feeBps <= 0) return 0;
  return Math.ceil((amount * feeBps) / 10_000);
}

/** Indicative odds string from basis points (`14_750` → `'1.48'`), or null if one side is empty. */
export function formatOdds(bps: number | null): string | null {
  if (bps === null) return null;
  return (bps / STREAM_ODDS_ONE).toFixed(2);
}

/** Effective status of a round at `serverNow`: `open` past `autoLockAt` counts as `locked` (D3). */
export function effectiveRoundStatus(
  round: Pick<StreamRoundView, 'status' | 'autoLockAt'>,
  serverNow: number,
): 'open' | 'locked' {
  return round.status === 'open' && serverNow >= round.autoLockAt ? 'locked' : round.status;
}

export interface TipTierMeta {
  /** Threshold key (`'20000'`, `'10000'`, ..., or `'default'`), matching `STREAM_TIP_TIERS`. */
  tier: string;
  /** Exact 6-digit hex colour from `STREAM_TIP_TIERS` / `STREAM_TIP_COLOR_DEFAULT`. */
  hex: string;
  /** Bitbloom `Tag` hue paired with the tier. */
  hue: TagHue;
}

const COLOR_TO_HUE: Readonly<Record<number, TagHue>> = {
  [STREAM_TIP_TIERS[0].color]: 'red',
  [STREAM_TIP_TIERS[1].color]: 'magenta',
  [STREAM_TIP_TIERS[2].color]: 'orange',
  [STREAM_TIP_TIERS[3].color]: 'yellow',
  [STREAM_TIP_TIERS[4].color]: 'emerald',
  [STREAM_TIP_TIERS[5].color]: 'cyan',
  [STREAM_TIP_COLOR_DEFAULT]: 'blue',
};

/** Resolve super-chat tier metadata strictly from `STREAM_TIP_TIERS` and `streamTipColor`. */
export function tipTierFor(amount: number): TipTierMeta {
  const color = streamTipColor(amount);
  const matched = STREAM_TIP_TIERS.find((t) => amount >= t.from);
  return {
    tier: matched ? String(matched.from) : 'default',
    hex: `#${color.toString(16).padStart(6, '0')}`,
    hue: COLOR_TO_HUE[color] ?? 'blue',
  };
}

const hasKey = (key: string): boolean => Object.prototype.hasOwnProperty.call(en, key);

/**
 * Translate a `StreamApiError` to its i18n key + formatted params:
 * `screen.stream.rule.<rule>` first, then shared transfer rules (`screen.life.rule.<rule>`),
 * finally the generic `error.<code>`.
 */
export function streamErrorMessage(error: unknown): { key: string; params: MessageParams } {
  if (error instanceof StreamApiError) {
    const locale = currentLocale();
    const nf = new Intl.NumberFormat(locale);
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(error.params ?? {})) {
      params[name] = typeof value === 'number' ? nf.format(value) : value;
    }
    if (error.rule && hasKey(`screen.stream.rule.${error.rule}`)) {
      return { key: `screen.stream.rule.${error.rule}`, params };
    }
    if (error.rule && hasKey(`screen.life.rule.${error.rule}`)) {
      return { key: `screen.life.rule.${error.rule}`, params };
    }
    return { key: `error.${error.code}`, params };
  }
  return { key: 'error.internal', params: {} };
}

export function pushStreamToast(
  tone: ToastTone,
  key: string,
  params?: Record<string, string | number>,
): void {
  useToastStore.getState().push({ tone, messageKey: key, params });
}

export interface StreamIntent {
  busy: boolean;
  /**
   * Run a write with an idempotency key. Reuses the same key for `label` when a retry follows
   * a transient network/5xx failure; drops the key on success or a deterministic 4xx refusal.
   */
  run<T>(
    label: string,
    fn: (key: string) => Promise<T>,
    onError?: (error: unknown) => void,
  ): Promise<T | undefined>;
}

export function useStreamIntent(): StreamIntent {
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

  const run = useCallback<StreamIntent['run']>(async (label, fn, onError) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    const key = keys.current.get(label) ?? newStreamKey();
    keys.current.set(label, key);
    try {
      const result = await fn(key);
      keys.current.delete(label);
      return result;
    } catch (e) {
      if (!(e instanceof StreamApiError && e.transient)) keys.current.delete(label);
      if (onError) {
        onError(e);
      } else {
        const { key: msgKey, params } = streamErrorMessage(e);
        pushStreamToast('error', msgKey, params as Record<string, string | number>);
      }
      return undefined;
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  return { busy, run };
}

/** Merge a newer `StreamView` safely, keeping any newer tip totals if needed. */
export function isFeatureDisabledError(error: unknown): boolean {
  return error instanceof StreamApiError && error.code === 'feature_disabled';
}

export function roundDisplayLabel(
  round: Pick<StreamRoundView, 'label'> | { label: string },
  fallback: string,
): string {
  const trimmed = round.label.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function isStreamLive(stream: Pick<StreamView, 'status'>): boolean {
  return stream.status === 'live';
}
