// Trading floor: an LED ticker board across the top (the shipped screen scrolls the real prices
// over it), three wall screens (candles, a rising line, a heat map), and a row of traders seen
// from behind at their desks, each with two small monitors.
import { R } from './props.js';
import { P } from './lib.js';

export const W = 128,
  H = 48;

const UP = ['green-30', 'green-50', 'green-70'],
  DOWN = ['red-30', 'red-50', 'red-70'];

export function stocks(S, opt = {}) {
  const r = R(S);
  const wall = S.D(
    ['neutral-60', 'neutral-70', 'neutral-78', 'neutral-87', 'neutral-94'],
    ['neutral-4', 'neutral-8', 'neutral-11', 'neutral-14', 'neutral-20'],
  );
  // wall, darker toward the floor
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      S.set(x, y, wall[1 + P.band(S.D(0.85, 0.75) - y / 70, 3, x, y, 0.3)]);
  // wall panel seams
  for (let x = 0; x < W; x += 16) S.vl(x, 12, 18, wall[0]);

  // LED ticker board
  S.bevel(0, 0, W, 11, [r.steel[0], r.steel[1], r.steel[3]]);
  S.rect(1, 1, W - 2, 9, 'neutral-4');
  for (let y = 2; y < 9; y += 2) for (let x = 2; x < W - 2; x += 2) S.set(x, y, 'neutral-12');
  if (opt.tickerText !== false) {
    let x = 3;
    for (const [sym, ch, up] of [
      ['CS', '+8.1', true],
      ['TEIO', '+4.9', true],
      ['NUMA', '-1.2', false],
      ['GOLD', '+0.7', true],
    ]) {
      S.text(x, 3, sym, 'amber-70');
      x += sym.length * 4 + 1;
      S.text(x, 3, ch, up ? UP[2] : DOWN[2]);
      x += ch.length * 4 + 5;
    }
  }

  // wall screens
  screen(S, r, 4, 14, 36, 17, (x0, y0, w, h) => candles(S, x0, y0, w, h));
  screen(S, r, 44, 13, 40, 19, (x0, y0, w, h) => lineChart(S, x0, y0, w, h));
  screen(S, r, 88, 14, 36, 17, (x0, y0, w, h) => heatMap(S, x0, y0, w, h));

  // desks, monitors and traders
  const desk = S.D(
    ['neutral-40', 'neutral-60', 'neutral-80'],
    ['neutral-12', 'neutral-20', 'neutral-30'],
  );
  S.rect(0, 38, W, 10, desk[0]).hl(0, 37, W, desk[2]).hl(0, 38, W, desk[1]);
  for (let k = 0; k < 4; k++) {
    monitor(S, r, 3 + k * 32, 29, k % 2 === 0);
    monitor(S, r, 14 + k * 32, 29, k !== 2);
  }
  const suits = [
    ['blue-10', 'blue-20', 'blue-30'],
    ['neutral-12', 'neutral-20', 'neutral-30'],
    ['brown-10', 'brown-20', 'brown-30'],
    ['indigo-10', 'indigo-20', 'indigo-40'],
  ];
  const hair = [
    ['neutral-4', 'neutral-12'],
    ['brown-10', 'brown-30'],
    ['neutral-6', 'neutral-14'],
    ['orange-30', 'orange-50'],
  ];
  [9, 41, 73, 105].forEach((x, k) => trader(S, x, 35, suits[k], hair[k]));
  // coffee cup and a phone between traders
  S.rect(28, 35, 3, 2, 'paper-96').set(31, 35, 'paper-87').set(28, 34, 'brown-40');
  S.rect(91, 35, 5, 2, 'neutral-17')
    .hl(91, 34, 2, 'neutral-30')
    .set(95, 34, 'neutral-30')
    .set(93, 35, 'red-50');
}

function screen(S, r, x0, y0, w, h, draw) {
  S.bevel(x0, y0, w, h, [r.steel[0], 'neutral-17', r.steel[2]]);
  S.rect(x0 + 1, y0 + 1, w - 2, h - 2, 'neutral-6');
  // faint grid
  for (let y = y0 + 3; y < y0 + h - 1; y += 4) S.checker(x0 + 1, y, w - 2, 1, 'neutral-11');
  draw(x0 + 2, y0 + 2, w - 4, h - 4);
  // glass glint in the top left corner
  S.set(x0 + 1, y0 + 1, 'neutral-30')
    .set(x0 + 2, y0 + 1, 'neutral-20')
    .set(x0 + 1, y0 + 2, 'neutral-20');
}

/** Candles with wicks: green up, red down, 3 pixels wide with a 1 pixel gap. */
export function candles(S, x0, y0, w, h, seed = 3) {
  const rnd = P.rng(seed);
  let p = h * 0.35;
  for (let x = x0; x + 3 <= x0 + w; x += 4) {
    const o = p,
      c = Math.max(2, Math.min(h - 2, p + (rnd() - 0.45) * h * 0.45));
    const hiP = Math.max(o, c) + rnd() * 2,
      loP = Math.min(o, c) - rnd() * 2;
    const up = c >= o,
      col = up ? UP : DOWN;
    const Y = (v) => Math.round(y0 + h - 1 - Math.max(0, Math.min(h - 1, v)));
    S.vl(x + 1, Y(hiP), Y(loP) - Y(hiP) + 1, col[0]);
    const top = Y(Math.max(o, c)),
      bot = Y(Math.min(o, c));
    S.rect(x, top, 3, Math.max(1, bot - top + 1), col[1]).vl(
      x,
      top,
      Math.max(1, bot - top + 1),
      col[2],
    );
    p = c;
  }
}

function lineChart(S, x0, y0, w, h) {
  let prev = null;
  for (let x = 0; x < w; x++) {
    const v = h - 3 - (x / w) * (h - 6) - Math.sin(x / 3.2) * 2 - Math.sin(x / 7) * 1.5;
    const y = Math.round(y0 + v);
    if (prev !== null) S.line(x0 + x - 1, prev, x0 + x, y, UP[2]);
    for (let j = y + 1; j < y0 + h; j++) if ((x + j) % 2 === 0) S.set(x0 + x, j, UP[0]);
    prev = y;
  }
  // arrow head at the end
  S.set(x0 + w - 2, y0 + 1, UP[2])
    .set(x0 + w - 3, y0 + 1, UP[2])
    .set(x0 + w - 1, y0 + 2, UP[2])
    .set(x0 + w - 1, y0 + 3, UP[2]);
}

function heatMap(S, x0, y0, w, h) {
  const cells = [
    UP[1],
    UP[2],
    DOWN[1],
    UP[0],
    DOWN[0],
    UP[1],
    UP[2],
    DOWN[1],
    UP[0],
    UP[1],
    DOWN[2],
    UP[1],
  ];
  const cw = Math.floor(w / 4),
    ch = Math.floor(h / 3);
  cells.forEach((c, k) => {
    const x = x0 + (k % 4) * cw,
      y = y0 + Math.floor(k / 4) * ch;
    S.rect(x, y, cw - 1, ch - 1, c);
  });
}

function monitor(S, r, x, y, up) {
  S.rect(x, y, 10, 7, 'neutral-17').rect(x + 1, y + 1, 8, 5, 'neutral-6');
  const col = up ? UP : DOWN;
  for (let i = 0; i < 8; i++) {
    const v = up
      ? Math.round(i * 0.5 + Math.sin(i) * 0.8)
      : Math.round(4 - i * 0.5 + Math.sin(i) * 0.8);
    S.set(x + 1 + i, y + 5 - Math.max(0, Math.min(4, v)), col[2]);
  }
  S.set(x + 1, y + 1, 'neutral-25');
  S.vl(x + 4, y + 7, 1, 'neutral-20').hl(x + 3, y + 8, 4, 'neutral-25');
}

/** A trader seen from behind: hair, ears, collar, the back of a suit. */
function trader(S, x, y, suit, hair) {
  S.rows(
    x - 6,
    y,
    [
      '.....hhhh......',
      '....hHHhhh.....',
      '....hHhhhh.....',
      '...shhhhhhs....',
      '.....hhhh......',
      '.....cccc......',
      '..aabbccbbaa...',
      '.abbbbbbbbbba..',
      'abbbbbbbbbbbba.',
      'abbbbbbbbbbbba.',
      'abbbbbbbbbbbba.',
      'abbbbbbbbbbbba.',
      'abbbbbbbbbbbba.',
    ],
    { h: hair[0], H: hair[1], s: 'orange-60', c: 'paper-96', a: suit[0], b: suit[1] },
  );
  S.vl(x, y + 7, 6, suit[0]); // back seam
  S.hl(x - 4, y + 6, 2, suit[2]); // lit shoulder
}
