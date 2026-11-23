// Ramps and small props shared by the finance scenes. Ramps run dark to light and are hue shifted
// (the dark end leans cool, the light end warm). `R(S)` picks the day or night version.
import { P } from './lib.js';

export function R(S) {
  const D = (d, n) => S.D(d, n);
  return {
    stone: D(
      ['brown-60', 'brown-70', 'brown-80', 'paper-87', 'amber-95'],
      ['blue-10', 'neutral-14', 'neutral-20', 'neutral-25', 'neutral-35'],
    ),
    ceil: D(['brown-50', 'brown-60'], ['neutral-6', 'neutral-8']),
    marble: D(
      ['neutral-65', 'neutral-80', 'paper-90', 'paper-96', 'paper-99'],
      ['neutral-8', 'neutral-17', 'neutral-25', 'neutral-35', 'neutral-50'],
    ),
    wood: D(
      ['red-20', 'brown-30', 'brown-40', 'brown-50', 'orange-60'],
      ['red-10', 'brown-20', 'brown-30', 'brown-40', 'brown-50'],
    ),
    gold: ['orange-40', 'orange-60', 'yellow-70', 'yellow-80', 'yellow-95'],
    steel: D(
      ['neutral-40', 'neutral-60', 'neutral-78', 'neutral-90', 'neutral-98'],
      ['neutral-15', 'neutral-30', 'neutral-40', 'neutral-60', 'neutral-80'],
    ),
    back: D(['brown-30', 'brown-40'], ['neutral-4', 'neutral-7']),
    paper: D(
      ['neutral-60', 'neutral-78', 'neutral-90', 'paper-96', 'paper-99'],
      ['neutral-30', 'neutral-50', 'neutral-65', 'neutral-80', 'neutral-90'],
    ),
    green: ['green-20', 'green-30', 'green-40', 'green-60', 'green-80'],
    red: ['red-20', 'red-40', 'red-50', 'red-60', 'red-80'],
    rope: ['red-30', 'red-50'],
    ink: D('neutral-10', 'neutral-4'),
    glow: D('yellow-90', 'yellow-80'),
  };
}

/** Wall brightness 0..1: base tone, pools of light under the lamps, darker toward ceiling and floor. */
export function wallValue(S, x, y, lamps, floorY, base) {
  let v = base ?? S.D(0.5, 0.32);
  for (const [lx, ly] of lamps) {
    const d2 = ((x - lx) / 1.4) ** 2 + (y - ly) ** 2;
    v += S.D(0.28, 0.55) * Math.exp(-d2 / (2 * 13 * 13));
  }
  if (y < 12) v -= (12 - y) * 0.025;
  if (y > floorY - 6) v -= (y - (floorY - 6)) * 0.03;
  return v;
}

/** A pendant lamp: chain from the ceiling to y, a brass dome and a bright bulb under it. */
export function pendant(S, r, x, y) {
  S.vl(x, 4, y - 4, r.steel[1]);
  S.hl(x - 1, y, 3, r.gold[2]).set(x - 1, y, r.gold[3]);
  S.hl(x - 2, y + 1, 5, r.gold[2])
    .set(x - 2, y + 1, r.gold[4])
    .set(x + 2, y + 1, r.gold[1]);
  S.hl(x - 3, y + 2, 7, r.gold[1])
    .set(x - 3, y + 2, r.gold[3])
    .set(x + 3, y + 2, r.gold[0]);
  S.hl(x - 1, y + 3, 3, r.glow).set(x, y + 3, 'paper-99');
}

/** Checked floor tiles: lit front edge, tiles `tw` wide, alternate rows offset by half a tile. */
export function tiles(S, x0, y0, w, h, m, tw) {
  S.hl(x0, y0, w, m[4]);
  for (let y = y0 + 1; y < y0 + h; y++) {
    const row = Math.floor((y - y0 - 1) / 3);
    for (let x = x0; x < x0 + w; x++) {
      const k = Math.floor((x + (row % 2) * (tw / 2)) / tw);
      const dark = (k + row) % 2;
      S.set(x, y, dark ? m[1] : m[3]);
    }
    if ((y - y0 - 1) % 3 === 2) S.hl(x0, y, w, m[0]);
  }
  // a soft reflection band right under the edge
  S.checker(x0, y0 + 1, w, 1, m[2]);
}

/** A flat pilaster 6 wide: capital, fluted shaft lit from the left, base. */
export function column(S, x, y, h, st) {
  S.hl(x - 1, y, 8, st[4])
    .hl(x - 1, y + 1, 8, st[2])
    .hl(x - 1, y + 2, 8, st[0]);
  const shade = [4, 3, 2, 3, 1, 0];
  for (let i = 0; i < 6; i++) S.vl(x + i, y + 3, h - 6, st[shade[i]]);
  S.vl(x + 2, y + 4, h - 8, st[1]);
  S.hl(x - 1, y + h - 3, 8, st[4])
    .hl(x - 1, y + h - 2, 8, st[2])
    .hl(x - 1, y + h - 1, 8, st[0]);
}

export { P };
