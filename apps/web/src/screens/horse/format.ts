import type { Locale } from '@casino/shared/i18n';
import { HORSE_COATS, HORSE_SILKS, type HorseBetKind } from '@casino/shared';

/** Odds in tenths (43) → "4.3". */
export const formatOdds = (tenths: number): string => (tenths / 10).toFixed(1);

/** Arena odds in hundredths (430) → "4.30". */
export const formatOddsHundredths = (hundredths: number): string => (hundredths / 100).toFixed(2);

export function formatClock(locale: Locale, ms: number): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ms);
}

export function formatNumber(locale: Locale, n: number): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** `h:mm:ss` from one hour, `m:ss` below; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Long waits (foals, cooldowns): `2d 3h`, `5h 12m`, `12m`. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** `4>2` shows as `4 → 2`; `2-4` as `2 - 4`; `3` as `3`. */
export const formatPicks = (key: string): string => key.replace(/>/g, ' → ').replace(/-/g, ' - ');

export const isOrderedKind = (kind: HorseBetKind): boolean =>
  kind === 'exacta' || kind === 'trifecta';

/** Index of a coat in the catalogue, for `screen.horse.coat.<i>` style lookups. */
export const coatIndex = (coat: string): number => (HORSE_COATS as readonly string[]).indexOf(coat);
export const silksIndex = (silks: string): number =>
  (HORSE_SILKS as readonly string[]).indexOf(silks);

/** Silks emoji → CSS colour token (a palette step that reads in both themes). */
const SILKS_COLOR: Record<string, string> = {
  '🟥': 'var(--red-60)',
  '🟧': 'var(--orange-60)',
  '🟨': 'var(--yellow-60)',
  '🟩': 'var(--green-60)',
  '🟦': 'var(--blue-60)',
  '🟪': 'var(--violet-60)',
  '⬛': 'var(--neutral-30)',
  '⬜': 'var(--neutral-90)',
  '🟫': 'var(--brown-40)',
};
export const silksColor = (silks: string): string => SILKS_COLOR[silks] ?? 'var(--neutral-60)';

/** Silks emoji → silks class suffix (the rider's three tones in horse.css). */
const SILKS_KEY: Record<string, string> = {
  '🟥': 'red',
  '🟧': 'orange',
  '🟨': 'yellow',
  '🟩': 'green',
  '🟦': 'blue',
  '🟪': 'violet',
  '⬛': 'black',
  '⬜': 'white',
  '🟫': 'brown',
};
export const silksKey = (silks: string): string => SILKS_KEY[silks] ?? 'white';

/** Coat → coat class suffix (the eight coat ramps in horse.css). */
const COAT_KEY: Record<string, string> = {
  栗毛: 'kurige',
  鹿毛: 'kage',
  黒鹿毛: 'kurokage',
  青毛: 'aoge',
  芦毛: 'ashige',
  白毛: 'shirage',
  栃栗毛: 'tochiguri',
  月毛: 'tsukige',
};
export const coatKey = (coat: string): string => COAT_KEY[coat] ?? 'kage';
