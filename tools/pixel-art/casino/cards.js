// Playing cards, 26 by 36: number faces with pips, aces with a big lit suit, J/Q/K portraits
// (hand placed pixels, 13 by 19), a card back and the flip frames.
import { P } from '../lib/env.js';
import { C, hiSprite, paste, text3, textW } from './kit.js';

const CW = 31,
  CH = 43;

const SUIT5 = {
  '♥': ['.#.#.', '#####', '#####', '.###.', '..#..'],
  '♦': ['..#..', '.###.', '#####', '.###.', '..#..'],
  '♠': ['..#..', '.###.', '#####', '#.#.#', '..#..'],
  '♣': ['.###.', '.###.', '#####', '#.#.#', '..#..'],
};
const RED = new Set(['♥', '♦']);

function glyph(b, x, y, rows, c, flip = false) {
  const h = rows.length;
  rows.forEach((row, j) =>
    [...row].forEach((v, i) => {
      if (v !== '#') return;
      if (flip) b.pset(x + row.length - 1 - i, y + h - 1 - j, c);
      else b.pset(x + i, y + j, c);
    }),
  );
}
/** A rank glyph turned 180 degrees (for the bottom right index). */
function rankFlipped(b, x, y, s, c) {
  const t = new P.Buf(textW(s), 5);
  text3(t, 0, 0, s, c);
  for (let j = 0; j < 5; j++)
    for (let i = 0; i < t.w; i++)
      if (t.px[j * t.w + i]) b.pset(x + t.w - 1 - i, y + 4 - j, t.px[j * t.w + i]);
}

/** The card blank: paper, light from the top left, 1 pixel rounded border. */
function blank() {
  const b = new P.Buf(CW, CH);
  const edge = C('neutral-50'),
    lit = C('paper-99'),
    base = C('paper-97'),
    shade = C('neutral-87');
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      const corner = (x === 0 || x === CW - 1) && (y === 0 || y === CH - 1);
      if (corner) continue;
      const e = x === 0 || y === 0 || x === CW - 1 || y === CH - 1;
      const c2 = (x === 1 || x === CW - 2) && (y === 1 || y === CH - 2);
      b.pset(x, y, e || c2 ? edge : y === CH - 2 || x === CW - 2 ? shade : x + y < 18 ? lit : base);
    }
  return b;
}

const SUIT_COL = (s) => (RED.has(s) ? C('red-50') : C('neutral-10'));

// pip rows (top left y of a 5 pixel pip) and columns
const COLS = { l: 8, c: 13, r: 18 };
const T = 7,
  B = 31,
  M = 19;
const ROWS4 = [7, 15, 23, 31];
const LAYOUT = {
  2: [
    ['c', T],
    ['c', B],
  ],
  3: [
    ['c', T],
    ['c', M],
    ['c', B],
  ],
  4: [
    ['l', T],
    ['r', T],
    ['l', B],
    ['r', B],
  ],
  5: [
    ['l', T],
    ['r', T],
    ['c', M],
    ['l', B],
    ['r', B],
  ],
  6: [
    ['l', T],
    ['r', T],
    ['l', M],
    ['r', M],
    ['l', B],
    ['r', B],
  ],
  7: [
    ['l', T],
    ['r', T],
    ['c', 12],
    ['l', M],
    ['r', M],
    ['l', B],
    ['r', B],
  ],
  8: [
    ['l', T],
    ['r', T],
    ['c', 12],
    ['l', M],
    ['r', M],
    ['c', 26],
    ['l', B],
    ['r', B],
  ],
  9: [
    ...ROWS4.flatMap((y) => [
      ['l', y],
      ['r', y],
    ]),
    ['c', M],
  ],
  10: [
    ...ROWS4.flatMap((y) => [
      ['l', y],
      ['r', y],
    ]),
    ['c', 11],
    ['c', 27],
  ],
};

/** Big lit suit for the aces, 13 by 13. */
function bigSuit(s) {
  const red = RED.has(s);
  return hiSprite(
    13,
    13,
    (hi, part) => {
      const m = part(red ? 'cherry' : 'ink', { round: 3, steps: red ? [1, 2, 3] : [1, 2, 4] });
      if (s === '♥') {
        hi.ellipse(m, 4.2, 4.6, 3.4, 3.4).ellipse(m, 8.8, 4.6, 3.4, 3.4);
        hi.poly(m, [
          [1.0, 5.6],
          [12.0, 5.6],
          [6.5, 12.4],
        ]);
      } else if (s === '♦') {
        hi.poly(m, [
          [6.5, 0.6],
          [11.6, 6.5],
          [6.5, 12.4],
          [1.4, 6.5],
        ]);
      } else if (s === '♠') {
        hi.ellipse(m, 4.2, 7.0, 3.2, 3.0).ellipse(m, 8.8, 7.0, 3.2, 3.0);
        hi.poly(m, [
          [1.0, 6.2],
          [12.0, 6.2],
          [6.5, 0.6],
        ]);
        hi.poly(m, [
          [6.5, 7.6],
          [9.2, 12.4],
          [3.8, 12.4],
        ]);
      } else {
        hi.ellipse(m, 6.5, 3.6, 2.9, 2.9)
          .ellipse(m, 3.4, 7.4, 2.9, 2.9)
          .ellipse(m, 9.6, 7.4, 2.9, 2.9);
        hi.poly(m, [
          [6.5, 6.6],
          [9.0, 12.4],
          [4.0, 12.4],
        ]);
      }
    },
    { outline: false },
  );
}

// Court portraits, 13 by 19. g/G gold light/dark, j jewel, s/S skin/shade, e eye, m mouth,
// h hair or beard, w white (ermine, lace, moustache), k ink, r/R robe and its shade (suit colour),
// c cap (suit colour dark), p feather, f flower (gold).
const COURT = {
  K: [
    '..g...g...g..',
    '..gg.ggg.gg..',
    '..gjgggggjg..',
    '..GGGGGGGGG..',
    '.hsssssssssh.',
    '.hsesssssesh.',
    '.hsssssSsssh.',
    '.hhsswwwsshh.',
    '.hhhhhhhhhhh.',
    '..hhhhhhhhh..',
    '.rr.hhhhh.rr.',
    'rrrr.hhh.rrrr',
    'rrRrw.h.wrRrr',
    'rRrrwwwwwrrRr',
    'rrRrrwkwrrRrr',
    'rRrrrwwwrrrRr',
    'rrRrrrwrrrRrr',
    'rRrrrrgrrrrRr',
    'rrrrrrgrrrrrr',
  ],
  Q: [
    '...g..g..g...',
    '...ggjgjgg...',
    '...GGGGGGG...',
    '..hhhhhhhhh..',
    '.hhsssssssh h.'.replace(' ', ''),
    '.hsesssssesh.',
    '.hsssssSsssh.',
    '.hssssmssssh.',
    '.hhssssssshh.',
    'hhh.sssss.hhh',
    'hhrrwwwwwrrhh',
    'hrrwrrjrrwrrh',
    'hrRrwrrrwrRrh',
    'rrRrrwrwrrRrr',
    'rRrrrrwrrrrRr',
    'rrRrrfffrrRrr',
    'rRrrfgfgfrrRr',
    'rrRrrfffrrRrr',
    'rrrrrrrrrrrrr',
  ],
  J: [
    '........pp...',
    '.......pp....',
    '...cccccc....',
    '..cccccccc...',
    '.cccgggggccc.',
    '.hsssssssssh.',
    '.hsesssssesh.',
    '.hsssssSsssh.',
    '.hhsssmssshh.',
    '.hh.sssss.hh.',
    'rrrrwwwwwrrrr',
    'rRrrrwgwrrrRr',
    'rrRrrrgrrrRrr',
    'rRrrrrgrrrrRr',
    'rrRrgggggrRrr',
    'rRrrrrrrrrrRr',
    'rrRrrrrrrrRrr',
    'rRrrrrrrrrrRr',
    'rrrrrrrrrrrrr',
  ],
};

function portrait(rank, suit) {
  const red = RED.has(suit);
  const map = {
    g: C('yellow-80'),
    G: C('amber-50'),
    j: red ? C('blue-50') : C('red-50'),
    s: C('orange-80'),
    S: C('orange-60'),
    e: C('neutral-10'),
    m: C('red-50'),
    h: rank === 'K' ? C('neutral-78') : rank === 'Q' ? C('amber-40') : C('brown-30'),
    w: C('paper-99'),
    k: C('neutral-10'),
    r: red ? C('red-50') : C('blue-40'),
    R: red ? C('red-30') : C('indigo-20'),
    c: red ? C('red-30') : C('indigo-30'),
    p: C('paper-99'),
    f: C('yellow-80'),
  };
  const rows = COURT[rank];
  const b = new P.Buf(13, 19);
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (map[ch]) b.pset(i, j, map[ch]);
    }),
  );
  return b;
}

/** A card face. `rank` 'A','2'..'10','J','Q','K'; `suit` one of ♠♥♦♣. */
function face(rank, suit) {
  const b = blank();
  const col = SUIT_COL(suit);
  // indexes: rank over a small suit, top left and (turned) bottom right
  text3(b, 2, 2, rank, col);
  glyph(b, 2, 8, SUIT5[suit], col);
  const rw = textW(rank);
  rankFlipped(b, CW - 3 - rw + 1, CH - 7, rank, col);
  glyph(b, CW - 7, CH - 13, SUIT5[suit], col, true);
  if (rank === 'A') {
    paste(b, bigSuit(suit), 9, 15);
  } else if (COURT[rank]) {
    // gold frame around the portrait, the portrait, a small suit in the frame's corner
    const fx = 8,
      fy = 11,
      gold = C('amber-60'),
      goldD = C('amber-40');
    for (let x = fx; x < fx + 15; x++) {
      b.pset(x, fy, gold);
      b.pset(x, fy + 20, goldD);
    }
    for (let y = fy; y <= fy + 20; y++) {
      b.pset(fx, y, gold);
      b.pset(fx + 14, y, goldD);
    }
    paste(b, portrait(rank, suit), fx + 1, fy + 1);
  } else {
    for (const [c, y] of LAYOUT[+rank]) {
      const x = COLS[c];
      glyph(b, x, Math.round(y), SUIT5[suit], col, y > M);
    }
  }
  return b;
}

/** Card back: white border, a blue lattice with dots, a gold coin mark in the middle. */
function back() {
  const b = blank();
  const a = C('blue-30'),
    a2 = C('blue-40'),
    d = C('sky-80'),
    dark = C('indigo-20');
  for (let y = 3; y < CH - 3; y++)
    for (let x = 3; x < CW - 3; x++) {
      const e = x === 3 || y === 3 || x === CW - 4 || y === CH - 4;
      const u = (x + y) % 6,
        v = (x - y + 60) % 6;
      let c = a;
      if (u === 0 || v === 0) c = a2;
      if (u === 3 && v === 3) c = d;
      b.pset(x, y, e ? dark : c);
    }
  // centre mark: a small diamond medallion
  const g = [C('amber-40'), C('amber-60'), C('yellow-80'), C('yellow-95')];
  const cx = CW / 2 - 0.5,
    cy = CH / 2 - 0.5;
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      const m = Math.abs(x - cx) + Math.abs(y - cy) * 0.8;
      if (m > 6.2) continue;
      b.pset(x, y, m > 5.2 ? dark : m > 4 ? g[x + y < cx + cy ? 2 : 0] : m < 1.5 ? g[3] : g[1]);
    }
  return b;
}

/** Squeeze a card horizontally to `w` pixels (nearest), centred in a CW wide buffer. */
function squeeze(card, w) {
  const b = new P.Buf(CW, CH);
  const x0 = Math.round((CW - w) / 2);
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(CW - 1, Math.floor(((x + 0.5) / w) * CW));
      b.px[y * CW + x0 + x] = card.px[y * CW + sx];
    }
  return b;
}
/** Flip from back to face: 5 frames. */
function flip(faceCard) {
  const edge = new P.Buf(CW, CH);
  for (let y = 1; y < CH - 1; y++) {
    edge.pset(Math.floor(CW / 2) - 1, y, C('neutral-50'));
    edge.pset(Math.floor(CW / 2), y, C('neutral-87'));
  }
  return [back(), squeeze(back(), 15), edge, squeeze(faceCard, 15), faceCard];
}

export { face, back, flip, blank, CW, CH, SUIT5, RED };
