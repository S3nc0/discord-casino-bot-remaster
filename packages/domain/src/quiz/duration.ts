const UNIT_MINUTES: Record<string, number> = {
  日: 1440,
  d: 1440,
  時間: 60,
  時: 60,
  h: 60,
  分: 1,
  m: 1,
};

/**
 * Parse a duration like `3日`, `2時間30分`, `90m` (NFKC-normalised, commas ignored) into
 * minutes. A bare number uses `defaultUnit`. Null when it is not a duration.
 */
export function parseDuration(
  text: string,
  defaultUnit: '時間' | '分' | '日' = '時間',
): number | null {
  const s = text.normalize('NFKC').replace(/[,\s]/g, '').toLowerCase();
  if (s.length === 0) return null;
  if (/^\d+$/.test(s)) return Number(s) * (UNIT_MINUTES[defaultUnit] as number);
  let rest = s;
  let total = 0;
  const seen = new Set<number>();
  while (rest.length > 0) {
    const m = /^(\d+)(時間|日|時|分|d|h|m)/.exec(rest);
    if (!m) return null;
    const unit = UNIT_MINUTES[m[2] as string] as number;
    if (seen.has(unit)) return null;
    seen.add(unit);
    total += Number(m[1]) * unit;
    rest = rest.slice(m[0].length);
  }
  return total;
}

/** `1日2時間30分` for a number of minutes. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0分';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `${d ? `${d}日` : ''}${h ? `${h}時間` : ''}${m ? `${m}分` : ''}`;
}
