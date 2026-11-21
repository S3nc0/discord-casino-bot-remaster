import type { Rng } from '@casino/shared';

// A port of CPython's `random.Random(int_seed)` (MT19937), so parity tests can replay the
// legacy fixtures draw for draw. Test support only: production uses an injected Rng.

const N = 624;
const M = 397;

function initGenrand(s: number, mt: Uint32Array): void {
  mt[0] = s >>> 0;
  for (let i = 1; i < N; i++) {
    const prev = mt[i - 1] as number;
    mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
  }
}

function initByArray(key: readonly number[], mt: Uint32Array): void {
  initGenrand(19650218, mt);
  let i = 1;
  let j = 0;
  for (let k = Math.max(N, key.length); k > 0; k--) {
    const prev = mt[i - 1] as number;
    mt[i] =
      (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + (key[j] as number) + j) >>>
      0;
    i++;
    j++;
    if (i >= N) {
      mt[0] = mt[N - 1] as number;
      i = 1;
    }
    if (j >= key.length) j = 0;
  }
  for (let k = N - 1; k > 0; k--) {
    const prev = mt[i - 1] as number;
    mt[i] = (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
    i++;
    if (i >= N) {
      mt[0] = mt[N - 1] as number;
      i = 1;
    }
  }
  mt[0] = 0x80000000;
}

export interface PyRandom extends Rng {
  /** Python's `random.random()`. */
  random(): number;
  /** Python's `getrandbits(k)` for k <= 32. */
  getrandbits(k: number): number;
  /** Python's `randint(a, b)`. */
  randint(a: number, b: number): number;
}

export function pyRandom(seed: number): PyRandom {
  const mt = new Uint32Array(N);
  const key: number[] = [];
  let rest = Math.abs(seed);
  do {
    key.push(rest % 2 ** 32);
    rest = Math.floor(rest / 2 ** 32);
  } while (rest > 0);
  initByArray(key, mt);
  let index = N;

  const next32 = (): number => {
    if (index >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = ((mt[kk] as number) & 0x80000000) | ((mt[kk + 1] as number) & 0x7fffffff);
        mt[kk] = (mt[kk + M] as number) ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = ((mt[kk] as number) & 0x80000000) | ((mt[kk + 1] as number) & 0x7fffffff);
        mt[kk] = (mt[kk + (M - N)] as number) ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      const y = ((mt[N - 1] as number) & 0x80000000) | ((mt[0] as number) & 0x7fffffff);
      mt[N - 1] = (mt[M - 1] as number) ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      index = 0;
    }
    let y = mt[index++] as number;
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  };

  const random = (): number => {
    const a = next32() >>> 5;
    const b = next32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  };
  const getrandbits = (k: number): number => next32() >>> (32 - k);
  const randbelow = (n: number): number => {
    const k = n.toString(2).length;
    let r = getrandbits(k);
    while (r >= n) r = getrandbits(k);
    return r;
  };
  return {
    random,
    getrandbits,
    randint: (a, b) => a + randbelow(b - a + 1),
    float: random,
    int: (min, max) => min + randbelow(max - min),
  };
}
