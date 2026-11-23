// Business district: sky (day blue, night with stars and moon), a hazy far row, five office
// towers with window grids and an empty badge plate on each roof (the shipped screen puts the
// companies' logo badges there), street trees and lamps in front.
import { R } from './props.js';
import { P } from './lib.js';

export const W = 128,
  H = 48;

/** Roof badge plates: [x, y] of the 12 by 12 slot on each tower, left to right. */
export const PLATES = [];

export function companies(S) {
  const r = R(S);
  PLATES.length = 0;
  const sky = S.D(
    ['sky-60', 'sky-70', 'sky-80', 'sky-90'],
    ['neutral-4', 'neutral-6', 'neutral-8', 'indigo-10'],
  );
  S.vbands(0, 0, W, 41, sky);
  if (S.theme === 'night') {
    const rnd = P.rng(7);
    for (let k = 0; k < 26; k++)
      S.set(Math.floor(rnd() * W), Math.floor(rnd() * 18), k % 5 ? 'neutral-40' : 'yellow-90');
    S.disc(112, 6, 3.4, 'yellow-90').disc(113.4, 5.2, 2.8, sky[0]);
  } else {
    S.disc(112, 7, 3.6, 'yellow-90').disc(111.6, 6.6, 2.2, 'paper-99');
    cloud(S, 14, 6, 'paper-99', 'sky-90');
    cloud(S, 78, 4, 'paper-99', 'sky-90');
  }
  // far row, hazy
  const far = S.D('sky-50', 'neutral-11'),
    farLit = S.D('sky-70', 'neutral-25');
  let x = 0;
  const rnd = P.rng(11);
  while (x < W) {
    const w = 6 + Math.floor(rnd() * 8),
      h = 10 + Math.floor(rnd() * 12);
    S.rect(x, 40 - h, w, h, far);
    for (let j = 40 - h + 2; j < 40; j += 3)
      for (let i = x + 1; i < x + w - 1; i += 2) if (rnd() < 0.3) S.set(i, j, farLit);
    x += w + 1;
  }
  // towers: x, width, top
  const towers = [
    [4, 18, 16, 'blue'],
    [27, 16, 10, 'steel'],
    [49, 24, 6, 'teal'],
    [79, 16, 12, 'brown'],
    [101, 20, 18, 'blue'],
  ];
  for (const [tx, tw, top, kind] of towers) tower(S, r, tx, top, tw, 41 - top, kind);
  // street
  const road = S.D(
    ['neutral-40', 'neutral-50', 'neutral-70', 'neutral-87'],
    ['neutral-6', 'neutral-10', 'neutral-17', 'neutral-25'],
  );
  S.rect(0, 41, W, 7, road[1]).hl(0, 41, W, road[3]).hl(0, 42, W, road[2]);
  for (let x = 2; x < W; x += 12) S.hl(x, 45, 6, S.D('paper-96', 'neutral-40'));
  for (const x of [22, 72, 122]) streetLamp(S, r, x, 29);
  for (const x of [44, 96]) tree(S, x, 33);
}

function cloud(S, x, y, lit, base) {
  S.rows(x, y, ['...aaa.....', '.aaaaaaa.a.', 'abbbbbbbbbb'], { a: lit, b: base });
}

function tower(S, r, x0, y0, w, h, kind) {
  const ramps = {
    blue: S.D(
      ['blue-30', 'blue-40', 'blue-50', 'sky-70'],
      ['blue-10', 'blue-20', 'blue-30', 'blue-40'],
    ),
    steel: S.D(
      ['neutral-40', 'neutral-50', 'neutral-65', 'neutral-80'],
      ['neutral-8', 'neutral-14', 'neutral-21', 'neutral-30'],
    ),
    teal: S.D(
      ['teal-30', 'teal-40', 'teal-50', 'teal-70'],
      ['teal-10', 'teal-20', 'teal-30', 'teal-40'],
    ),
    brown: S.D(
      ['brown-30', 'brown-40', 'brown-50', 'brown-70'],
      ['brown-10', 'brown-20', 'brown-30', 'brown-40'],
    ),
  };
  const c = ramps[kind];
  // body: lit left face, shaded right edge
  S.rect(x0, y0, w, h, c[1])
    .vl(x0, y0, h, c[3])
    .vl(x0 + 1, y0, h, c[2])
    .vl(x0 + w - 1, y0, h, c[0]);
  // roof cap and the badge plate (12 by 12, centred under the roof)
  S.hl(x0 - 1, y0, w + 2, c[3]).hl(x0 - 1, y0 + 1, w + 2, c[0]);
  const px = x0 + Math.floor((w - 12) / 2),
    py = y0 + 2;
  S.rect(px - 1, py - 1, 14, 14, c[0]).rect(px, py, 12, 12, S.D('neutral-87', 'neutral-14'));
  PLATES.push([px, py]);
  // windows: lit at night in a fixed scatter, sky reflections by day
  const win = S.D(['sky-80', 'sky-60'], ['yellow-80', 'neutral-11']);
  const rnd = P.rng(x0 * 7 + 3);
  for (let j = y0 + 16; j < y0 + h - 5; j += 3)
    for (let i = x0 + 3; i < x0 + w - 2; i += 3) {
      const on = rnd() < S.D(0.35, 0.45);
      S.rect(i, j, 2, 2, on ? win[0] : win[1]);
      if (S.theme === 'day' && on) S.set(i + 1, j + 1, 'sky-60');
    }
  // entrance
  const ex = x0 + Math.floor(w / 2) - 2;
  S.rect(ex, y0 + h - 4, 4, 4, S.D('neutral-30', 'yellow-70')).hl(ex - 1, y0 + h - 5, 6, c[3]);
}

function streetLamp(S, r, x, y) {
  S.vl(x, y + 2, 10, r.steel[1]).set(x, y + 12, r.steel[0]);
  S.hl(x - 1, y + 1, 3, r.steel[2]);
  S.hl(x - 1, y + 2, 3, S.D('paper-96', 'yellow-90'));
  if (S.theme === 'night') S.checker(x - 2, y + 3, 5, 2, 'yellow-70');
}

function tree(S, x, y) {
  const g = S.D(
    ['green-30', 'green-40', 'green-50', 'green-60'],
    ['emerald-10', 'green-10', 'green-20', 'green-30'],
  );
  S.rows(
    x - 4,
    y,
    [
      '...cdd...',
      '.bccddd..',
      'bbcccddc.',
      'abbcccccb',
      'aabbbccb.',
      '.aabbbb..',
      '...aa....',
      '....t....',
      '....t....',
    ],
    { a: g[0], b: g[1], c: g[2], d: g[3], t: S.D('brown-40', 'brown-20') },
  );
}
