// Shared casino sprites: Pelica coin (with a turn), betting chips in five colours, chip stacks
// and the win burst. All from palette ramps, light from the top left.
import { P } from '../lib/env.js';
import { cmat, sphere, text3, C } from './kit.js';

/** Pelica coin, 16 by 16, seen at `turn` 0..1 of a half turn (0 = face on). */
function coin(turn = 0, size = 16) {
  const g = cmat('gold');
  const b = new P.Buf(size, size);
  const r = size / 2 - 0.5,
    cx = size / 2,
    cy = size / 2;
  const sx = Math.max(0.12, Math.abs(Math.cos(turn * Math.PI))); // width factor
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - cx) / (r * sx),
        dy = (y + 0.5 - cy) / r;
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      // rim: lit on the top left, dark on the bottom right
      let k;
      if (d > 0.78) k = dx + dy < -0.2 ? 4 : dx + dy > 0.35 ? 0 : 2;
      else if (d > 0.66)
        k = dx + dy < 0 ? 1 : 3; // the inner bevel is the other way round
      else k = 2;
      b.pset(x, y, P.col(g[k]));
    }
  // the P, embossed: lit stroke with a shaded edge, only when the face shows
  if (sx > 0.55) {
    const P_ = ['###.', '#..#', '###.', '#...', '#...'];
    const w = Math.round(4 * sx),
      ox = Math.round(cx - w / 2),
      oy = Math.round(cy - 2.5);
    P_.forEach((row, j) =>
      [...row].forEach((v, i) => {
        if (v !== '#') return;
        const X = ox + Math.round((i * w) / 4);
        b.pset(X + 1, oy + j + 1, P.col(g[1]));
        b.pset(X, oy + j, P.col(g[4]));
      }),
    );
  } else {
    // edge on: a reeded edge line in the middle
    for (let y = 2; y < size - 2; y++) if (y % 2) b.pset(Math.floor(cx), y, P.col(g[1]));
  }
  return b;
}

/** Chip colours (edge stripes are paper): value order of the shared chip set. */
const CHIPS = {
  white: ['neutral-60', 'neutral-78', 'neutral-92', 'paper-97', 'paper-99'],
  red: ['red-20', 'red-30', 'red-50', 'red-60', 'orange-80'],
  green: ['teal-20', 'emerald-30', 'green-50', 'green-60', 'lime-80'],
  blue: ['indigo-20', 'blue-30', 'blue-50', 'blue-60', 'sky-80'],
  black: ['neutral-4', 'neutral-10', 'neutral-17', 'neutral-25', 'neutral-50'],
  violet: ['indigo-20', 'violet-30', 'violet-50', 'violet-60', 'magenta-80'],
};
const STRIPE = {
  white: ['blue-40', 'blue-60'],
  red: ['paper-90', 'paper-99'],
  green: ['paper-90', 'paper-99'],
  blue: ['paper-90', 'paper-99'],
  black: ['amber-60', 'yellow-80'],
  violet: ['paper-90', 'paper-99'],
};

/**
 * One chip seen from above at a slant: an ellipse top face (edge ring with four paper inserts, a
 * groove, a lit centre) over a 2 pixel side band with two paper blocks. `w` wide.
 */
function chip(colour, w = 14, phase = 0) {
  const ramp = CHIPS[colour].map((t) => C(t));
  const st = STRIPE[colour].map((t) => C(t));
  const rx = w / 2,
    ry = Math.round(w * 0.3),
    edge = 2,
    h = ry * 2 + edge;
  const b = new P.Buf(w, h);
  const cx = w / 2,
    cy = ry;
  const inEll = (x, y, oy) => {
    const dx = (x + 0.5 - cx) / rx,
      dy = (y + 0.5 - cy - oy) / ry;
    return dx * dx + dy * dy <= 1;
  };
  // side band
  const blocks = [
    [0.3, 0.7],
    [0.18, 0.56, 0.94],
    [0.06, 0.44, 0.82],
  ][phase];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inEll(x, y, 0) || !(inEll(x, y, 1) || inEll(x, y, 2))) continue;
      const u = (x + 0.5) / w;
      const white = blocks.some((c) => Math.abs(u - c) < 0.75 / w + 0.04);
      // the lowest band row is the shadow line between two chips of a stack
      const low = !inEll(x, y + 1, 1) && !inEll(x, y + 1, 2);
      b.pset(x, y, low ? ramp[0] : white ? st[0] : u < 0.35 ? ramp[2] : ramp[1]);
    }
  // top face
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inEll(x, y, 0)) continue;
      const dx = (x + 0.5 - cx) / rx,
        dy = (y + 0.5 - cy) / ry,
        d = Math.hypot(dx, dy);
      let c;
      if (d > 0.7) {
        const insert =
          (Math.abs(dy) < 0.36 && Math.abs(dx) > 0.7) ||
          (Math.abs(dx) < 0.16 && Math.abs(dy) > 0.6);
        c = insert ? st[1] : dx + dy < -0.3 ? ramp[3] : ramp[2];
      } else if (d > 0.5) c = ramp[1];
      else c = dx + dy < -0.2 ? ramp[4] : ramp[3];
      b.pset(x, y, c);
    }
  return b;
}

/** A stack of `n` chips (bottom to top). */
function chipStack(colour, n, w = 14) {
  const one = chip(colour, w);
  const b = new P.Buf(w, one.h + (n - 1) * 2);
  for (let i = 0; i < n; i++)
    b.sprite(i ? chip(colour, w, [0, 1, 2, 1, 0, 2, 1][i % 7]) : one, 0, b.h - one.h - i * 2);
  return b;
}

/** Win burst: 8 frames, `size` square. Rays turn and grow, sparkles fly out, then it fades. */
function burst(frame, size = 48, frames = 8) {
  const b = new P.Buf(size, size);
  const cx = size / 2,
    cy = size / 2;
  const t = frame / frames;
  const cols = ['orange-60', 'yellow-80', 'yellow-95', 'paper-99'].map(C);
  const R = (size / 2 - 2) * (0.45 + 0.55 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5));
  const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  // eight rays, alternate long and short, turning slowly
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + t * 0.5;
    const len = (k % 2 ? 0.62 : 1) * R * fade;
    for (let s = 2; s < len; s += 0.5) {
      const x = cx + Math.cos(a) * s,
        y = cy + Math.sin(a) * s;
      const wdt = (1 - s / len) * 2.2;
      for (let o = -wdt; o <= wdt; o += 0.5) {
        const X = Math.floor(x - Math.sin(a) * o),
          Y = Math.floor(y + Math.cos(a) * o);
        const ci = s / len < 0.35 ? 3 : s / len < 0.7 ? 2 : Math.abs(o) > wdt * 0.5 ? 0 : 1;
        if (X >= 0 && Y >= 0 && X < size && Y < size) b.pset(X, Y, cols[ci]);
      }
    }
  }
  // core
  const core = Math.max(0, 4 * (1 - t * 1.3));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < core) b.pset(x, y, cols[d < core * 0.5 ? 3 : 2]);
    }
  // sparkles: plus shapes that fly out on the diagonals
  const sp = [0.39, 1.18, 1.96, 2.75, 3.53, 4.32, 5.11, 5.89];
  sp.forEach((a, k) => {
    const d = (0.3 + t * 0.75) * (size / 2 - 3) * (k % 2 ? 0.8 : 1);
    if (t > 0.9) return;
    const X = Math.round(cx + Math.cos(a) * d),
      Y = Math.round(cy + Math.sin(a) * d);
    const c = cols[t > 0.6 ? 1 : 3];
    b.pset(X, Y, c);
    if (t < 0.7)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        b.pset(X + dx, Y + dy, cols[t > 0.4 ? 0 : 1]);
  });
  return outlineWith(b, C('orange-40'));
}

/** 1 pixel outline in one colour around every opaque pixel (4 neighbours), same size. */
function outlineWith(src, c) {
  const b = new P.Buf(src.w, src.h);
  b.px.set(src.px);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      if (src.px[y * src.w + x] >>> 24) continue;
      const n = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const X = x + dx,
          Y = y + dy;
        return X >= 0 && Y >= 0 && X < src.w && Y < src.h && src.px[Y * src.w + X] >>> 24;
      });
      if (n) b.px[y * src.w + x] = c;
    }
  return b;
}

export { outlineWith, coin, chip, chipStack, burst, CHIPS };
// keep the font and sphere reachable for the scenes that import shared sprites only
export { text3, sphere };
