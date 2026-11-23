// Shared bits of the casino scenes: material ramps (every colour a palette token), a 3x5 pixel
// font for ranks and numbers, and small drawing helpers. One light, from the top left.
import { P } from '../lib/env.js';
import { Hi, selectiveOutline } from '../lib/hi.js';
import { HEX, MAT, ramp, tok } from '../lib/palette.js';

/** Ramps dark to light, hue shifted (dark toward cool, light toward warm). */
const CMAT = {
  ...MAT,
  felt: ['teal-10', 'teal-20', 'emerald-30', 'green-40', 'lime-50'],
  feltLine: ['amber-50', 'amber-60', 'amber-70', 'yellow-80', 'yellow-90'],
  porcelain: ['blue-60', 'blue-80', 'neutral-92', 'paper-97', 'paper-99'],
  cobalt: ['indigo-10', 'indigo-20', 'blue-30', 'blue-40', 'blue-60'],
  tatami: ['green-30', 'lime-40', 'lime-50', 'lime-60', 'lime-70'],
  heri: ['blue-10', 'indigo-20', 'indigo-30', 'indigo-40', 'blue-50'],
  lacquer: ['red-10', 'red-20', 'red-30', 'red-50', 'orange-60'],
  chrome: ['blue-20', 'neutral-40', 'neutral-70', 'neutral-90', 'paper-99'],
  brass: ['amber-30', 'amber-50', 'amber-70', 'yellow-80', 'yellow-95'],
  mahogany: ['brown-10', 'red-20', 'brown-30', 'orange-40', 'amber-60'],
  cabinet: ['indigo-10', 'magenta-20', 'red-30', 'red-40', 'red-60'],
  night: ['neutral-4', 'neutral-8', 'neutral-12', 'neutral-17', 'neutral-25'],
  ivory: ['amber-60', 'amber-80', 'paper-90', 'paper-96', 'paper-99'],
  pine: ['brown-20', 'brown-40', 'amber-60', 'amber-70', 'yellow-90'],
  glass: ['blue-10', 'blue-20', 'sky-30', 'sky-40', 'sky-60'],
  lemon: ['amber-40', 'amber-60', 'yellow-70', 'yellow-80', 'yellow-90'],
  cherry: ['red-20', 'red-30', 'red-50', 'red-60', 'paper-96'],
  grape: ['indigo-20', 'violet-30', 'violet-40', 'violet-60', 'magenta-80'],
  leaf: ['teal-20', 'green-40', 'green-60', 'lime-70', 'yellow-90'],
  diamond: ['blue-30', 'sky-50', 'sky-70', 'sky-90', 'paper-99'],
  pink: ['magenta-30', 'pink-50', 'pink-60', 'pink-80', 'paper-99'],
};
const cmat = (name) => ramp(CMAT[name]);
const C = (name) => P.col(tok(name));

/** 3x5 glyphs. */
const FONT = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
};
/** Width of a string in the 3x5 font (1 pixel gap; "1" keeps its 3 columns). */
const textW = (s) => s.length * 4 - 1;
/** Draw a string with its top left at (x, y). `c` is a packed colour. */
function text3(buf, x, y, s, c) {
  [...s].forEach((ch, k) => {
    const g = FONT[ch];
    if (!g) throw new Error(`no glyph ${ch}`);
    g.forEach((row, j) =>
      [...row].forEach((v, i) => {
        if (v === '#') buf.pset(x + k * 4 + i, y + j, c);
      }),
    );
  });
}

/** A Hi sprite rendered with the icons' selective outline. `draw(hi, part)`. */
function hiSprite(w, h, draw, opt = {}) {
  const hi = new Hi(w, h);
  const part = (m, o) => hi.part(typeof m === 'string' ? cmat(m) : m, o);
  const fix = draw(hi, part);
  const { buf, owner } = hi.render({ cover: opt.cover ?? 0.5 });
  if (fix) fix(buf, owner);
  return opt.outline === false ? buf : selectiveOutline(buf, owner, hi.parts);
}

/** Paste opaque pixels of src into dst at (x, y). */
function paste(dst, src, x0, y0, flip = false) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const px = src.px[y * src.w + (flip ? src.w - 1 - x : x)];
      if (!(px >>> 24)) continue;
      const X = x0 + x,
        Y = y0 + y;
      if (X >= 0 && Y >= 0 && X < dst.w && Y < dst.h) dst.px[Y * dst.w + X] = px;
    }
  return dst;
}
const copy = (b) => {
  const o = new P.Buf(b.w, b.h);
  o.px.set(b.px);
  return o;
};

/** Value 0..1 to one of a ramp's steps with dither only in a thin strip where two bands meet. */
function shade(rampCols, v, x, y, strip = 0.25) {
  const n = rampCols.length;
  return P.col(rampCols[P.band(P.clamp(v), n, x, y, strip)]);
}

/** Light from the top left on a surface normal (nx, ny, nz). */
const L = (() => {
  const v = [-0.55, -0.62, 0.56],
    n = Math.hypot(...v);
  return v.map((a) => a / n);
})();
const lambert = (nx, ny, nz) => {
  const n = Math.hypot(nx, ny, nz) || 1;
  return Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / n);
};

/**
 * A lit sphere in pixel space, centre (cx, cy), radius r, ramp dark to light. `rim` draws a 1 pixel
 * ring of the darkest step around it (separates overlapping balls). `steps` picks ramp steps for
 * shadow, base, light; `hl` the highlight step (top left, a few pixels).
 */
function sphere(buf, cx, cy, r, rampCols, o = {}) {
  const steps = o.steps ?? [1, 2, 3],
    hl = o.hl ?? 4;
  const R = r + (o.rim ? 1 : 0);
  for (let y = Math.floor(cy - R - 1); y <= Math.ceil(cy + R + 1); y++)
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) {
      const dx = (x + 0.5 - cx) / r,
        dy = (y + 0.5 - cy) / r,
        d = Math.hypot(dx, dy);
      if (d > 1) {
        if (o.rim && d <= R / r) buf.pset(x, y, P.col(rampCols[0]));
        continue;
      }
      const nz = Math.sqrt(Math.max(0, 1 - d * d));
      const v = lambert(dx, dy, nz * 1.1);
      const k = P.band(P.clamp((v - 0.15) / 0.8), 3, x, y, o.strip ?? 0.2);
      let c = rampCols[steps[k]];
      if (hl !== null && Math.hypot(dx + 0.42, dy + 0.42) < (o.hlr ?? 0.26)) c = rampCols[hl];
      buf.pset(x, y, P.col(c));
    }
  return buf;
}

/** All palette colours as packed values (the snap targets of `darker`). */
const ALL = [...new Set(Object.values(HEX))].map((h) =>
  P.col([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))),
);
const rgbOf = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
/** Nearest palette colour to an rgb triple. */
function nearest(m) {
  let best = ALL[0],
    bd = 1e9;
  for (const c of ALL) {
    const q = rgbOf(c),
      d = (m[0] - q[0]) ** 2 * 2 + (m[1] - q[1]) ** 2 * 4 + (m[2] - q[2]) ** 2 * 3;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}
const darkCache = new Map();
/** The palette colour closest to `c` darkened by `f` (0..1) and pulled a little toward blue. */
function darker(c, f) {
  const key = `${c}:${f}`;
  if (!darkCache.has(key)) {
    const [r, g, b] = rgbOf(c);
    darkCache.set(key, nearest([r * f, g * f, b * f + (1 - f) * 30]));
  }
  return darkCache.get(key);
}

/** Every opaque pixel must be a palette token; returns the token names used. */
function tokensOf(buf, HEX) {
  const map = new Map();
  for (const [name, hex] of Object.entries(HEX)) {
    const key = P.col([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    if (!map.has(key)) map.set(key, name);
  }
  const used = new Set();
  for (let i = 0; i < buf.px.length; i++) {
    const px = buf.px[i];
    if (!(px >>> 24)) continue;
    const t = map.get(px);
    if (!t) throw new Error(`pixel ${i % buf.w},${Math.floor(i / buf.w)} is not a palette token`);
    used.add(t);
  }
  return used;
}

export {
  darker,
  nearest,
  rgbOf,
  sphere,
  CMAT,
  cmat,
  C,
  FONT,
  text3,
  textW,
  hiSprite,
  paste,
  copy,
  shade,
  lambert,
  tokensOf,
  tok,
};
