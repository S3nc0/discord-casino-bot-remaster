import type { Translate } from '../../shell/i18n.ts';

/** `1d 4h`, `3h 20m`, `4m 05s`, `12s`: the two largest units, never negative. */
export function formatDuration(t: Translate, ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const unit = (key: string, n: number) => t(`screen.life.unit.${key}`, { n });
  if (d > 0) return h > 0 ? `${unit('d', d)} ${unit('h', h)}` : unit('d', d);
  if (h > 0) return m > 0 ? `${unit('h', h)} ${unit('m', m)}` : unit('h', h);
  if (m > 0) return s > 0 && m < 10 ? `${unit('m', m)} ${unit('s', s)}` : unit('m', m);
  return unit('s', s);
}

export const signed = (locale: string, n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${new Intl.NumberFormat(locale).format(Math.abs(n))}`;

/** `2026-11-23` → `11/23` (no zero padding). */
export function monthDay(iso: string): string {
  const [, m = '1', d = '1'] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}
