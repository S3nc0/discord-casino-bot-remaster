/**
 * Injected randomness. Domain code never calls Math.random or crypto directly.
 * The server provides a `crypto.randomInt` implementation; tests use `createSeededRng`.
 */
export interface Rng {
  /** Uniform integer in [min, max), same contract as `crypto.randomInt(min, max)`. */
  int(min: number, max: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
}

/** Largest range `crypto.randomInt` accepts (max - min must be below 2^48). */
export const RNG_MAX_RANGE = 2 ** 48 - 1;

export function assertRange(min: number, max: number): void {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new RangeError('rng.int bounds must be safe integers');
  }
  if (max <= min) throw new RangeError('rng.int requires max > min');
  if (max - min > RNG_MAX_RANGE) throw new RangeError('rng.int range must be below 2^48');
}

/**
 * Deterministic generator (sfc32) for tests, replays and parity checks. Not for production.
 */
export function createSeededRng(seed: number): Rng {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next32();
  const float = (): number => (next32() * 2 ** 21 + (next32() >>> 11)) / 2 ** 53;
  return {
    float,
    int(min, max) {
      assertRange(min, max);
      return min + Math.floor(float() * (max - min));
    },
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick from an empty list');
  return items[rng.int(0, items.length)] as T;
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
