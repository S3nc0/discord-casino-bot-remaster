import { PRICE_SCALE, QUANTITY_SCALE, type Rng } from '@casino/shared';

/** Basis-point denominator: 10_000 bps = 100%. */
export const BPS_SCALE = 10_000;

/** Fixed-point denominator for continuous daily rates (r_f, trust_premium): 1e9 = 1.0/day. */
export const RATE_NANO_SCALE = 1_000_000_000;

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const SECONDS_PER_DAY = 86_400;

/**
 * Convert a decimal price (in Pelica) to integer micro-Pelica (`PRICE_SCALE = 1_000_000`).
 * Rounding: nearest integer micro-Pelica.
 */
export function priceToMicros(price: number): number {
  return Math.round(price * PRICE_SCALE);
}

/** Convert integer micro-Pelica to a decimal price for internal pricing math. */
export function microsToPrice(micros: number): number {
  return micros / PRICE_SCALE;
}

/** Convert a continuous daily rate float (e.g. 0.0130735711) to integer nano-units. */
export function rateToNano(rate: number): number {
  return Math.round(rate * RATE_NANO_SCALE);
}

/** Convert integer nano-units back to a continuous daily rate float for pricing math. */
export function nanoToRate(nano: number): number {
  return nano / RATE_NANO_SCALE;
}

/**
 * Banker's rounding (round half to even), matching Python 3's built-in `round(x)`.
 * Used at legacy parity boundaries (cost-basis removal, margin PnL, strike rounding).
 */
export function roundHalfEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const floored = Math.floor(x);
  const diff = x - floored;
  if (Math.abs(diff - 0.5) <= 1e-12) {
    return floored % 2 === 0 ? floored : floored + 1;
  }
  return Math.round(x);
}

/**
 * Round `x` to `decimals` decimal places using half-to-even rounding, matching Python's `round(x, n)`.
 */
export function roundTo(x: number, decimals: number): number {
  const factor = 10 ** decimals;
  return roundHalfEven(x * factor) / factor;
}

/**
 * Truncate toward zero to an integer, matching Python's `int(x)`.
 * For non-negative amounts paid to a player this rounds down.
 */
export function truncInt(x: number): number {
  return Math.trunc(x);
}

/**
 * High-precision error function `erf(x)` matching IEEE 754 `math.erf` to ~1e-15.
 * Uses Taylor series for |x| <= 1.5 and Lentz's continued fraction for erfc when |x| > 1.5.
 */
export function erf(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax >= 6.0) return sign;

  if (ax <= 1.5) {
    const x2 = ax * ax;
    let term = ax;
    let sum = term;
    for (let n = 1; n <= 40; n++) {
      term *= (-x2 * (2 * n - 1)) / (n * (2 * n + 1));
      sum += term;
      if (Math.abs(term) <= Math.abs(sum) * 1e-16) break;
    }
    return sign * (2 / Math.sqrt(Math.PI)) * sum;
  }

  // Lentz's algorithm for continued fraction of erfc(ax):
  // erfc(x) = (exp(-x^2) / sqrt(pi)) * 1 / (x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + ...)))))
  const tiny = 1e-30;
  let b = ax;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i++) {
    const a = i * 0.5;
    b = ax;
    d = b + a * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + a / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = c * d;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  const erfcVal = (Math.exp(-ax * ax) / Math.sqrt(Math.PI)) * h;
  return sign * (1 - erfcVal);
}

/** Standard normal CDF Φ(x) = 0.5 * (1 + erf(x / sqrt(2))). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Draw one standard normal N(0, 1) variate using Box-Muller transform on injected `Rng`. */
export function standardNormal(rng: Rng): number {
  let u1 = rng.float();
  while (u1 <= 0) u1 = rng.float();
  const u2 = rng.float();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/** Deterministic 32-bit FNV-1a hash for deriving numeric RNG seeds from strings. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Format `YYYY-MM-DD` for an epoch-ms timestamp in the given UTC offset (default JST = +9). */
export function localDateString(epochMs: number, utcOffsetHours = 9): string {
  const d = new Date(epochMs + utcOffsetHours * MS_PER_HOUR);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Start of local calendar day `YYYY-MM-DD` in epoch-ms UTC. */
export function localDayStartMs(dateStr: string, utcOffsetHours = 9): number {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - utcOffsetHours * MS_PER_HOUR;
}

/**
 * Local weekday (0 = Monday .. 6 = Sunday, matching Python `datetime.weekday()`), hour, minute,
 * and start of local week (Monday 00:00 in epoch-ms UTC).
 */
export function localDateParts(
  epochMs: number,
  utcOffsetHours = 9,
): {
  year: number;
  month: number;
  day: number;
  /** 0 = Monday .. 6 = Sunday (Python `weekday()` convention). */
  weekday: number;
  hour: number;
  minute: number;
  dayStartMs: number;
} {
  const offsetMs = utcOffsetHours * MS_PER_HOUR;
  const d = new Date(epochMs + offsetMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const jsDow = d.getUTCDay(); // 0 = Sun .. 6 = Sat
  const weekday = (jsDow + 6) % 7; // 0 = Mon .. 6 = Sun
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const dayStartMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs;
  return { year, month, day, weekday, hour, minute, dayStartMs };
}

/** Add `days` calendar days to a `YYYY-MM-DD` string. */
export function addCalendarDays(dateStr: string, days: number): string {
  const ms = localDayStartMs(dateStr, 0) + days * MS_PER_DAY;
  return localDateString(ms, 0);
}

/** Convert decimal units to integer milli-units (`QUANTITY_SCALE = 1000`). */
export function toMilli(units: number): number {
  return Math.round(units * QUANTITY_SCALE);
}

/** Convert integer milli-units back to decimal units. */
export function fromMilli(milli: number): number {
  return milli / QUANTITY_SCALE;
}
