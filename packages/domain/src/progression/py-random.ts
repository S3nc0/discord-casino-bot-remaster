import type { Rng } from '@casino/shared';

/**
 * Bit-exact port of CPython's `random.Random` (MT19937) for the pieces the legacy bot used:
 * `random()`, `getrandbits`, `randint`/`randrange`, `choice`, `shuffle`, `uniform`, `gauss` and
 * string seeding. Used where the legacy rules say "seeded by this string" (daily terrain,
 * daily missions) so rosters stay identical, and by parity tests to replay fixtures.
 */

const K = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];
const M64 = (1n << 64n) - 1n;
const rotr = (x: bigint, n: bigint): bigint => ((x >> n) | (x << (64n - n))) & M64;

/** SHA-512 of a byte array (pure, no node:crypto). */
export function sha512(data: Uint8Array): Uint8Array {
  const h = [
    0x6a09e667f3bcc908n,
    0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn,
    0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n,
    0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn,
    0x5be0cd19137e2179n,
  ];
  const padLen = ((data.length + 17 + 127) >> 7) << 7;
  const buf = new Uint8Array(padLen);
  buf.set(data);
  buf[data.length] = 0x80;
  const bitLen = BigInt(data.length) * 8n;
  for (let i = 0; i < 16; i++) buf[padLen - 1 - i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);
  const w = new Array<bigint>(80).fill(0n);
  for (let off = 0; off < padLen; off += 128) {
    for (let t = 0; t < 16; t++) {
      let v = 0n;
      for (let b = 0; b < 8; b++) v = (v << 8n) | BigInt(buf[off + t * 8 + b] as number);
      w[t] = v;
    }
    for (let t = 16; t < 80; t++) {
      const w15 = w[t - 15] as bigint;
      const w2 = w[t - 2] as bigint;
      const s0 = rotr(w15, 1n) ^ rotr(w15, 8n) ^ (w15 >> 7n);
      const s1 = rotr(w2, 19n) ^ rotr(w2, 61n) ^ (w2 >> 6n);
      w[t] = ((w[t - 16] as bigint) + s0 + (w[t - 7] as bigint) + s1) & M64;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    for (let t = 0; t < 80; t++) {
      const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n);
      const ch = (e & f) ^ (~e & M64 & g);
      const t1 = (hh + S1 + ch + (K[t] as bigint) + (w[t] as bigint)) & M64;
      const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & M64;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) & M64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & M64;
    }
    h[0] = ((h[0] as bigint) + a) & M64;
    h[1] = ((h[1] as bigint) + b) & M64;
    h[2] = ((h[2] as bigint) + c) & M64;
    h[3] = ((h[3] as bigint) + d) & M64;
    h[4] = ((h[4] as bigint) + e) & M64;
    h[5] = ((h[5] as bigint) + f) & M64;
    h[6] = ((h[6] as bigint) + g) & M64;
    h[7] = ((h[7] as bigint) + hh) & M64;
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    for (let b = 0; b < 8; b++)
      out[i * 8 + b] = Number(((h[i] as bigint) >> BigInt(56 - 8 * b)) & 0xffn);
  }
  return out;
}

/** UTF-8 bytes of a string (no TextEncoder in the domain lib). */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** CPython `random.Random`. `gaussNext` is the cached second Box-Muller value, like CPython. */
export class PyRandom implements Rng {
  private readonly mt = new Uint32Array(624);
  private index = 624;
  private gaussNext: number | null = null;

  constructor(seed: number | string) {
    this.seed(seed);
  }

  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = this.mt[i - 1] as number;
      const x = prev ^ (prev >>> 30);
      this.mt[i] = (Math.imul(1_812_433_253, x) + i) >>> 0;
    }
    this.index = 624;
  }

  private initByArray(key: number[]): void {
    this.initGenrand(19_650_218);
    let i = 1;
    let j = 0;
    const mt = this.mt;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      const prev = mt[i - 1] as number;
      mt[i] =
        (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1_664_525)) +
          (key[j] as number) +
          j) >>>
        0;
      i++;
      j++;
      if (i >= 624) {
        mt[0] = mt[623] as number;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const prev = mt[i - 1] as number;
      mt[i] = (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1_566_083_941)) - i) >>> 0;
      i++;
      if (i >= 624) {
        mt[0] = mt[623] as number;
        i = 1;
      }
    }
    mt[0] = 0x8000_0000;
    this.index = 624;
  }

  seed(seed: number | string): void {
    this.gaussNext = null;
    let big: bigint;
    if (typeof seed === 'string') {
      const bytes = utf8(seed);
      const digest = sha512(bytes);
      const all = new Uint8Array(bytes.length + digest.length);
      all.set(bytes);
      all.set(digest, bytes.length);
      big = 0n;
      for (const b of all) big = (big << 8n) | BigInt(b);
    } else {
      big = BigInt(Math.abs(seed));
    }
    const key: number[] = [];
    if (big === 0n) key.push(0);
    while (big > 0n) {
      key.push(Number(big & 0xffff_ffffn));
      big >>= 32n;
    }
    this.initByArray(key);
  }

  private genrand(): number {
    const mt = this.mt;
    if (this.index >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = ((mt[k] as number) & 0x8000_0000) | ((mt[(k + 1) % 624] as number) & 0x7fff_ffff);
        let v = (mt[(k + 397) % 624] as number) ^ (y >>> 1);
        if (y & 1) v ^= 0x9908_b0df;
        mt[k] = v >>> 0;
      }
      this.index = 0;
    }
    let y = mt[this.index++] as number;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c_5680;
    y ^= (y << 15) & 0xefc6_0000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Uniform float in [0, 1) (53-bit, same as CPython). */
  float(): number {
    const a = this.genrand() >>> 5;
    const b = this.genrand() >>> 6;
    return (a * 67_108_864 + b) / 9_007_199_254_740_992;
  }

  private getrandbits(k: number): number {
    // k <= 32 is all the legacy rules need.
    return this.genrand() >>> (32 - k);
  }

  /** CPython `_randbelow(n)` for n < 2^32. */
  randBelow(n: number): number {
    if (n <= 0) throw new RangeError('randBelow needs n > 0');
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** Rng contract: integer in [min, max). Equals CPython `randint(min, max - 1)`. */
  int(min: number, max: number): number {
    return min + this.randBelow(max - min);
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.float();
  }

  gauss(mu: number, sigma: number): number {
    let z = this.gaussNext;
    this.gaussNext = null;
    if (z === null) {
      const x2pi = this.float() * (2 * Math.PI);
      const g2rad = Math.sqrt(-2 * Math.log(1 - this.float()));
      z = Math.cos(x2pi) * g2rad;
      this.gaussNext = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }

  choice<T>(items: readonly T[]): T {
    return items[this.randBelow(items.length)] as T;
  }

  /** `random.choices(population, weights=weights, k=1)[0]`. */
  weightedChoiceIndex(weights: readonly number[]): number {
    const cum: number[] = [];
    let total = 0;
    for (const w of weights) {
      total += w;
      cum.push(total);
    }
    const x = this.float() * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x < (cum[mid] as number)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randBelow(i + 1);
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
  }
}

/**
 * Gaussian draws from any `Rng`, with CPython's pair caching, for a fresh `Random(seed)`-like
 * run. One instance per simulation (the cache must not leak between runs).
 */
export class Gauss {
  private next: number | null = null;
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  draw(mu: number, sigma: number): number {
    let z = this.next;
    this.next = null;
    if (z === null) {
      const x2pi = this.rng.float() * (2 * Math.PI);
      const g2rad = Math.sqrt(-2 * Math.log(1 - this.rng.float()));
      z = Math.cos(x2pi) * g2rad;
      this.next = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }
}

/** `random.choices(range(n), weights=weights)[0]` with any `Rng` (cumulative weights + bisect). */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const cum: number[] = [];
  let total = 0;
  for (const w of weights) {
    total += w;
    cum.push(total);
  }
  const x = rng.float() * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < (cum[mid] as number)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Number of successes in `n` trials of probability `p`, one `float()` per trial. */
export function binomial(rng: Rng, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng.float() < p) k++;
  return k;
}

/** `random.uniform(a, b)`. */
export function uniform(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng.float();
}
