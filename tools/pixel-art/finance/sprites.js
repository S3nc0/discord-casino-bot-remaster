// Small sprites for the finance screens: one coin per market symbol, the company badge parts, the
// auction gavel, the dividend coin and the stamp. Drawn as lit shapes (lib/hi.js) or pixel rows.
import { Hi, selectiveOutline } from '../lib/hi.js';
import { mat, ramp, tok } from '../lib/palette.js';
import { P } from './lib.js';

const hiSprite = (w, h, draw, opt = {}) => {
  const hi = new Hi(w, h);
  const part = (m, o) => hi.part(typeof m === 'string' ? mat(m) : m, o);
  draw(hi, part);
  const { buf, owner } = hi.render({ cover: opt.cover ?? 0.5 });
  return opt.outline === false ? buf : selectiveOutline(buf, owner, hi.parts);
};

/** CS token: a red casino chip with white edge marks and a gold diamond. */
function coinCs() {
  return hiSprite(16, 16, (hi, part) => {
    const rim = part('red', { round: 1.6, steps: [1, 2, 3] });
    const mark = part('paper', { fixed: 4 });
    const face = part('red', { round: 0.8, steps: [0, 1, 2] });
    const gem = part('gold', { round: 0.6, steps: [1, 3, 4] });
    hi.ellipse(rim, 8, 8, 6.9, 6.9);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      hi.rot(
        mark,
        8 + Math.cos(a) * 5.7,
        8 + Math.sin(a) * 5.7,
        1.4,
        2.4,
        (a * 180) / Math.PI + 90,
      );
    }
    hi.ellipse(face, 8, 8, 4.1, 4.1);
    hi.poly(gem, [
      [8, 5.4],
      [10.5, 8],
      [8, 10.6],
      [5.5, 8],
    ]);
  });
}

/** TEIO heavy industries: a steel gear with a brass hub. */
function coinTeio() {
  return hiSprite(16, 16, (hi, part) => {
    const steel = part('steel', { round: 1.4, steps: [1, 2, 3] });
    const hub = part('gold', { round: 0.9, steps: [1, 2, 4] });
    hi.ellipse(steel, 8, 8, 5.6, 5.6);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      hi.rot(
        steel,
        8 + Math.cos(a) * 6.0,
        8 + Math.sin(a) * 6.0,
        2.2,
        2.6,
        (a * 180) / Math.PI + 90,
      );
    }
    hi.ellipse(hub, 8, 8, 2.6, 2.6);
    hi.ellipse(part('ink', { fixed: 1, outline: false }), 8, 8, 0.9, 0.9);
  });
}

/** NUMA bio: a green coin with a pale leaf and its midrib. */
function coinNuma() {
  const buf = hiSprite(16, 16, (hi, part) => {
    const coin = part('green', { round: 1.8, steps: [0, 1, 2] });
    const leaf = part(ramp(['green-60', 'lime-80', 'lime-90', 'yellow-95', 'paper-99']), {
      round: 1.0,
      steps: [1, 2, 3],
    });
    hi.ellipse(coin, 8, 8, 6.9, 6.9);
    hi.ellipse(leaf, 8.4, 7.6, 2.4, 4.2, -0.7);
  });
  // midrib, one step darker than the leaf, from the base (bottom left) to the tip
  const rib = P.col(tok('green-60'));
  for (const [x, y] of [
    [6, 10],
    [7, 9],
    [8, 8],
    [9, 7],
    [10, 6],
  ])
    buf.px[y * 16 + x] = rib;
  return buf;
}

/** GOLD: a gold bar seen from the front, lit top face. */
function coinGold() {
  return hiSprite(16, 16, (hi, part) => {
    const top = part('gold', { fixed: 4 });
    const front = part('gold', { bevel: true, steps: [1, 2, 3] });
    hi.poly(top, [
      [4.6, 4.6],
      [11.4, 4.6],
      [13.2, 7.0],
      [2.8, 7.0],
    ]);
    hi.poly(front, [
      [2.8, 7.0],
      [13.2, 7.0],
      [14.2, 11.6],
      [1.8, 11.6],
    ]);
    hi.rect(part('gold', { fixed: 1, outline: false }), 6, 8.6, 4, 1);
  });
}

export const COINS = { cs: coinCs, teio: coinTeio, numa: coinNuma, gold: coinGold };

/** Pixel rows to a buffer: `map` gives a token per character. */
function rowsBuf(rows, map) {
  const b = new P.Buf(rows[0].length, rows.length);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => map[ch] && (b.px[y * b.w + x] = P.col(tok(map[ch])))),
  );
  return b;
}

const HEAD = ['.lll.', 'lmmmd', 'ggggd', 'lmmmd', 'mmmmd', 'ggggd', '.ddd.'];
/** Auction gavel, two frames: raised, and striking the block (with two sparks). */
export function gavelFrames() {
  const map = {
    l: 'brown-60',
    m: 'brown-40',
    d: 'brown-20',
    g: 'yellow-70',
    b: 'brown-30',
    B: 'brown-50',
    k: 'brown-10',
    y: 'yellow-90',
  };
  const blank = () => Array.from({ length: 16 }, () => [...'................']);
  const put = (g, x, y, rows) =>
    rows.forEach((r, j) => [...r].forEach((c, i) => c !== '.' && (g[y + j][x + i] = c)));
  const block = ['BBBBBBBBB', 'bbbbbbbbk', 'kkkkkkkkk'];
  const up = blank();
  put(up, 6, 13, block);
  put(up, 9, 1, HEAD);
  for (let k = 0; k < 8; k++) put(up, 1 + k, Math.round(8 - k * 0.5), ['m']);
  for (let k = 0; k < 8; k++) put(up, 1 + k, Math.round(9 - k * 0.5), ['d']);
  const hit = blank();
  put(hit, 6, 13, block);
  put(hit, 9, 6, HEAD);
  for (let k = 0; k < 8; k++) put(hit, 1 + k, Math.round(7 + k * 0.25), ['m']);
  for (let k = 0; k < 8; k++) put(hit, 1 + k, Math.round(8 + k * 0.25), ['d']);
  put(hit, 7, 11, ['y']);
  put(hit, 15, 11, ['y']);
  put(hit, 6, 10, ['y']);
  return [up, hit].map((g) =>
    rowsBuf(
      g.map((r) => r.join('')),
      map,
    ),
  );
}

/** Dividend coin, four frames of a spin (front, narrow, edge, narrow). */
export function spinFrames() {
  return [3.4, 2.2, 0.7, 2.2].map((rx) =>
    hiSprite(9, 9, (hi, part) => {
      const g = part('gold', { round: 0.9, steps: [1, 2, 4] });
      hi.ellipse(g, 4.5, 4.5, rx, 3.6);
      if (rx > 2) hi.rect(part('gold', { fixed: 1, outline: false }), 4.1, 2.8, 0.9, 3.4);
    }),
  );
}

/** Company badge: frame shapes (crest, round, square, hex) and the kind glyph (farm, mine). */
export const BADGE_RAMPS = {
  red: ['red-20', 'red-40', 'red-60', 'red-70', 'orange-80'],
  orange: ['red-30', 'orange-50', 'orange-60', 'orange-70', 'yellow-90'],
  green: ['green-20', 'green-40', 'green-60', 'green-80', 'yellow-90'],
  teal: ['teal-20', 'teal-40', 'teal-60', 'teal-80', 'green-90'],
  blue: ['blue-20', 'blue-40', 'blue-60', 'blue-70', 'sky-90'],
  violet: ['violet-20', 'violet-40', 'violet-60', 'violet-70', 'blue-90'],
};

export function badge(shape, kind, hue) {
  const ramps = BADGE_RAMPS;
  return hiSprite(12, 12, (hi, part) => {
    const body = part(ramp(ramps[hue]), { round: 1.6, steps: [1, 2, 3] });
    if (shape === 'round') hi.ellipse(body, 6, 6, 5.3, 5.3);
    else if (shape === 'square') hi.rrect(body, 0.9, 0.9, 10.2, 10.2, 1.6);
    else if (shape === 'hex')
      hi.poly(
        body,
        [0, 1, 2, 3, 4, 5].map((k) => [
          6 + Math.cos((k / 6) * Math.PI * 2 + Math.PI / 6) * 5.6,
          6 + Math.sin((k / 6) * Math.PI * 2 + Math.PI / 6) * 5.6,
        ]),
      );
    else
      hi.poly(body, [
        [1, 0.9],
        [11, 0.9],
        [11, 6],
        [6, 11.2],
        [1, 6],
      ]);
  });
}
/** The kind glyph laid over a badge, 7 by 6, centred: a sprout for farms, a pick for mines. */
export const GLYPHS = {
  farm: ['.bb.bb.', 'bbbabbb', '.bbabb.', '...a...', '...a...', '.aaaaa.'],
  mine: ['.aaaa..', 'a....a.', '...a..a', '..a....', '.a.....', 'a......'],
};
export function badgeWithGlyph(shape, kind, hue) {
  const b = badge(shape, kind, hue);
  const g = GLYPHS[kind];
  const ox = 3,
    oy = shape === 'crest' ? 2 : 3;
  g.forEach((row, j) =>
    [...row].forEach((c, i) => {
      if (c === '.') return;
      b.px[(oy + j) * b.w + ox + i] = P.col(tok(c === 'b' ? 'paper-99' : 'paper-96'));
    }),
  );
  return b;
}
export const BADGE_SHAPES = ['crest', 'round', 'square', 'hex'];
export const BADGE_HUES = ['red', 'orange', 'green', 'teal', 'blue', 'violet'];
