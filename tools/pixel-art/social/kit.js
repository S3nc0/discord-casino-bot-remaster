// Shared helpers for the social and player scenes: props drawn as lit parts (lib/hi.js, the same
// method as the icons), flat backdrops drawn straight into a buffer, and a stepped frame so every
// scene sits on navy and on cream. Every colour is a palette step (lib/palette.js).
import { P } from '../lib/env.js';
import { Hi, selectiveOutline } from '../lib/hi.js';
import { mat, tok, MAT } from '../lib/palette.js';

/** Packed colour of a palette token. */
const C = (name) => P.col(tok(name));
/** Ramp of token names → packed colours. */
const CR = (names) => names.map(C);
/** A material ramp (lib/palette.js MAT) as packed colours. */
const M = (name) => CR(MAT[name]);

/**
 * A prop drawn at 8x as lit parts, cut into pixels, with a selective outline from its own ramps.
 * `draw(hi, part)` fills the Hi; it may return `(buf, owner) => void` pixel fixes. Leave a 1 pixel
 * margin for the outline.
 */
function prop(w, h, draw, opt = {}) {
  const hi = new Hi(w, h);
  const part = (m, o) =>
    hi.part(typeof m === 'string' ? mat(m) : m.map((c) => (typeof c === 'string' ? tok(c) : c)), o);
  const fix = draw(hi, part);
  const { buf, owner } = hi.render({ cover: opt.cover ?? 0.5 });
  if (fix) fix(buf, owner);
  return opt.outline === false ? buf : selectiveOutline(buf, owner, hi.parts);
}

/** Paste the opaque pixels of `src` into `dst` at (x, y). */
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
const set = (b, x, y, c) => {
  if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.px[y * b.w + x] = c;
};
const get = (b, x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.px[y * b.w + x] : 0);
function rect(b, x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(b, i, j, c);
  return b;
}
/** Vertical bands: value 0..1 per row from `fn(t)` turned into ramp steps, dither only at band edges. */
function vbands(b, x, y, w, h, ramp, fn = (t) => t, strip = 0.3) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const v = P.clamp(fn(h > 1 ? j / (h - 1) : 0, i / Math.max(1, w - 1)));
      set(b, x + i, y + j, ramp[P.band(v, ramp.length, x + i, y + j, strip)]);
    }
  return b;
}
/** Any field: `fn(x, y)` 0..1 → ramp step, inside the rectangle, where `fn` is not null. */
function field(b, x, y, w, h, ramp, fn, strip = 0.3) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const v = fn(x + i, y + j);
      if (v === null || v === undefined) continue;
      set(b, x + i, y + j, ramp[P.band(P.clamp(v), ramp.length, x + i, y + j, strip)]);
    }
  return b;
}
/** A pixel-perfect 1 px line. */
function line(b, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0),
    sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    set(b, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return b;
}
/** Mix a see-through colour over what is there, in steps: every pixel gets `a` (0..1) by dither. */
function glaze(b, x, y, w, h, c, a, mask = () => true) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const X = x + i,
        Y = y + j;
      if (!mask(X, Y)) continue;
      const k = typeof a === 'function' ? a(X, Y) : a;
      if (k <= 0) continue;
      if (k >= 1 || P.bt(X, Y) < k) set(b, X, Y, c);
    }
  return b;
}

/**
 * The scene window: a stepped (pixel) corner frame, 2 px, dark outer line and a lit inner line on
 * the top and left, so the scene reads as one object on navy and on cream.
 */
function frame(b, opt = {}) {
  const dark = C(opt.dark ?? 'neutral-4'),
    lit = C(opt.lit ?? 'neutral-40'),
    shade = C(opt.shade ?? 'neutral-17');
  const { w, h } = b;
  // clear the corners (2 px step)
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [w - 1, 0],
    [w - 2, 0],
    [w - 1, 1],
    [0, h - 1],
    [1, h - 1],
    [0, h - 2],
    [w - 1, h - 1],
    [w - 2, h - 1],
    [w - 1, h - 2],
  ])
    b.px[y * w + x] = 0;
  for (let x = 2; x < w - 2; x++) {
    set(b, x, 0, dark);
    set(b, x, h - 1, dark);
    set(b, x, 1, lit);
    set(b, x, h - 2, shade);
  }
  for (let y = 2; y < h - 2; y++) {
    set(b, 0, y, dark);
    set(b, w - 1, y, dark);
    set(b, 1, y, lit);
    set(b, w - 2, y, shade);
  }
  set(b, 1, 1, dark);
  set(b, w - 2, 1, dark);
  set(b, 1, h - 2, dark);
  set(b, w - 2, h - 2, dark);
  return b;
}

/** Copy of a buffer. */
const clone = (b) => {
  const o = new P.Buf(b.w, b.h);
  o.px.set(b.px);
  return o;
};
/** How many pixels differ between two buffers of the same size. */
const diff = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) n++;
  return n;
};

export { P, C, CR, M, prop, paste, set, get, rect, vbands, field, line, glaze, frame, clone, diff };
