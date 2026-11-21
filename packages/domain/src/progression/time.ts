/** Game-day arithmetic. Everything works on integer milliseconds and an hour offset (JST = 9). */
export const MS_SECOND = 1000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;
export const JST_OFFSET_HOURS = 9;

/** Days since 1970-01-01 of the local calendar day containing `ms`. */
export function localDayNumber(ms: number, offsetHours: number = JST_OFFSET_HOURS): number {
  return Math.floor((ms + offsetHours * MS_HOUR) / MS_DAY);
}

/** Local hour of day 0..23. */
export function localHour(ms: number, offsetHours: number = JST_OFFSET_HOURS): number {
  const local = ms + offsetHours * MS_HOUR;
  return Math.floor((((local % MS_DAY) + MS_DAY) % MS_DAY) / MS_HOUR);
}

/** UTC epoch ms of local midnight of `dayNumber`. */
export function dayStartMs(dayNumber: number, offsetHours: number = JST_OFFSET_HOURS): number {
  return dayNumber * MS_DAY - offsetHours * MS_HOUR;
}

/** Python `date.toordinal()` of a day number (0001-01-01 is 1). */
export function ordinalOf(dayNumber: number): number {
  return dayNumber + 719_163;
}

/** Monday = 0 … Sunday = 6 (1970-01-01 was a Thursday). */
export function weekdayOf(dayNumber: number): number {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

/** Civil date of a day number (proleptic Gregorian). */
export function civilFromDay(dayNumber: number): { year: number; month: number; day: number } {
  const z = dayNumber + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: month <= 2 ? y + 1 : y, month, day };
}

/** `YYYY-MM-DD` of a day number. */
export function isoDate(dayNumber: number): string {
  const { year, month, day } = civilFromDay(dayNumber);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day number of a `YYYY-MM-DD` string. */
export function dayFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`bad date: ${iso}`);
  const y0 = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const y = mo <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo > 2 ? mo - 3 : mo + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** Monday of the week holding `dayNumber`. */
export function weekStartDay(dayNumber: number): number {
  return dayNumber - weekdayOf(dayNumber);
}

/** Ranking week id: ISO date of that week's Monday. */
export function weekId(dayNumber: number): string {
  return isoDate(weekStartDay(dayNumber));
}

export function previousWeekId(dayNumber: number): string {
  return isoDate(weekStartDay(dayNumber) - 7);
}

/** `1/6〜1/12`, no zero padding. */
export function weekLabel(week: string): string {
  const start = dayFromIso(week);
  const a = civilFromDay(start);
  const b = civilFromDay(start + 6);
  return `${a.month}/${a.day}〜${b.month}/${b.day}`;
}

/** Python `round()` for a float: halves go to the even neighbour. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Python `round(x * rate)` evaluated without float noise for an integer amount and bps rate. */
export function roundBps(amount: number, bps: number): number {
  return roundHalfEven((amount * bps) / 10_000);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
