import type { Locale } from '@casino/shared/i18n';

/** `MIN_BET` of the server; the overview also reports it. */
export const MIN_BET_FALLBACK = 10;

const formats = new Map<Locale, Intl.NumberFormat>();

export function formatNumber(locale: Locale, value: number): string {
  let format = formats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    formats.set(locale, format);
  }
  return format.format(value);
}

/** Signed amount for the history and the last results: `+1,200` / `−300`. */
export function formatSigned(locale: Locale, value: number): string {
  const body = formatNumber(locale, Math.abs(value));
  return value > 0 ? `+${body}` : value < 0 ? `−${body}` : body;
}

/** `2h 5m` style wait, never negative. */
export function splitWait(ms: number): { h: number; m: number } {
  const total = Math.max(0, Math.ceil(ms / 60_000));
  return { h: Math.floor(total / 60), m: total % 60 };
}
