// Missions: a quest board on a tavern wall. A wooden frame round a cork board, notes held by pins,
// a done stamp on the finished one, a lantern beside it. The pin and the stamp ship on their own
// for the mission cards.
import { P, C, CR, prop, paste, set, vbands, field, line, frame } from './kit.js';

const W = 176,
  H = 72;

/** A round pin head, 7 by 7 with its outline. */
function pin(hue = 'red') {
  return prop(7, 7, (hi, part) => {
    const head = part(hue, { round: 1.4, steps: [1, 2, 3] });
    hi.ellipse(head, 3.5, 3.5, 2.4, 2.4);
  });
}

/** The done stamp: a red ink ring with a tick, 20 by 20, slightly broken like real ink. */
function stamp() {
  const b = new P.Buf(20, 20);
  const ink = C('red-50'),
    dark = C('red-40');
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const d = Math.hypot(x - 9.5, y - 9.5);
      const gap = P.hash(x, y, 3) < 0.12;
      if (d <= 9.4 && d >= 7.6 && !gap) set(b, x, y, (x + y) % 7 ? ink : dark);
    }
  const tick = [
    [5, 10],
    [6, 11],
    [7, 12],
    [8, 13],
    [9, 12],
    [10, 11],
    [11, 10],
    [12, 9],
    [13, 8],
    [14, 7],
  ];
  for (const [x, y] of tick) {
    set(b, x, y, ink);
    set(b, x, y + 1, ink);
  }
  set(b, 12, 10, dark);
  return b;
}

/** A paper note: w by h, a fold shadow at the bottom right, ink lines. */
function note(w, h, opt = {}) {
  return prop(w, h, (hi, part) => {
    const paper = part(opt.ramp ?? 'paper', { bevel: true, steps: opt.steps ?? [2, 3, 4] });
    hi.poly(paper, [
      [1, 1],
      [w - 1, 1],
      [w - 1, h - 5],
      [w - 5, h - 1],
      [1, h - 1],
    ]);
    const fold = part(opt.ramp ?? 'paper', { fixed: 1, outline: false });
    hi.poly(fold, [
      [w - 1, h - 5],
      [w - 5, h - 5],
      [w - 5, h - 1],
    ]);
    const ink = part('ink', { fixed: 3, outline: false });
    const lines = opt.lines ?? [];
    for (const [x, y, len] of lines) hi.rect(ink, x, y, len, 1);
    if (opt.draw) opt.draw(hi, part);
  });
}

function lantern() {
  return prop(14, 22, (hi, part) => {
    const hook = part('ink', { fixed: 3 });
    hi.rect(hook, 6, 0.5, 2, 3);
    const capP = part('steel', { bevel: true, steps: [0, 1, 3] });
    hi.poly(capP, [
      [3, 6],
      [7, 3],
      [11, 6],
    ]).rect(capP, 3, 5, 8, 2);
    const glass = part(['orange-60', 'amber-70', 'yellow-80', 'yellow-90', 'yellow-95'], {
      round: 2,
      steps: [2, 3, 4],
    });
    hi.rect(glass, 4, 7, 6, 9);
    const bar = part('steel', { fixed: 0, outline: false });
    hi.rect(bar, 6.5, 7, 1, 9);
    hi.rect(capP, 3, 16, 8, 2);
  });
}

function missionsBase() {
  const b = new P.Buf(W, H);
  // tavern wall: horizontal planks, darker at the top
  const plank = CR(['brown-10', 'brown-20', 'brown-30']);
  vbands(b, 2, 2, W - 4, H - 4, plank, (t) => 0.25 + t * 0.55, 0.2);
  for (let y = 7; y < H - 2; y += 7)
    for (let x = 2; x < W - 2; x++) {
      set(b, x, y, C('brown-10'));
      set(b, x, y + 1, C('brown-40'));
    }
  for (let y = 2; y < H - 2; y += 7) {
    const off = ((y / 7) | 0) % 2 ? 23 : 7;
    for (let x = off; x < W - 4; x += 38) for (let j = 0; j < 6; j++) set(b, x, y + j + 2, C('brown-10'));
  }
  // warm glow round the lantern: one step lighter in a circle
  const glow = (x, y) => (x - 14) ** 2 + ((y - 30) * 1.2) ** 2 < 16 ** 2;
  const map = new Map(
    [
      ['brown-10', 'brown-20'],
      ['brown-20', 'brown-30'],
      ['brown-30', 'brown-40'],
      ['brown-40', 'brown-50'],
    ].map(([a, c]) => [C(a), C(c)]),
  );
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < 40; x++) if (glow(x, y)) set(b, x, y, map.get(b.px[y * W + x]) ?? b.px[y * W + x]);
  paste(b, lantern(), 7, 16);

  // board: frame and cork
  const BX = 34,
    BY = 6,
    BW = 132,
    BH = 60;
  const frameP = prop(BW, BH, (hi, part) => {
    const f = part('wood', { bevel: true, steps: [1, 2, 3] });
    hi.rect(f, 1, 1, BW - 2, BH - 2);
  });
  paste(b, frameP, BX, BY);
  const cork = CR(['amber-30', 'amber-40', 'amber-50', 'amber-60']);
  field(b, BX + 4, BY + 4, BW - 8, BH - 8, cork, (x, y) => {
    const n = P.fbm(x * 0.18, y * 0.18, 3, 7);
    const shade = 1 - ((x - BX) / BW) * 0.25 - ((y - BY) / BH) * 0.3;
    return 0.2 + 0.4 * n * shade + 0.1 * shade;
  }, 0.25);
  // inner shadow of the frame on the cork (top and left)
  for (let x = BX + 4; x < BX + BW - 4; x++) set(b, x, BY + 4, C('amber-20'));
  for (let y = BY + 4; y < BY + BH - 4; y++) set(b, BX + 4, y, C('amber-20'));

  // notes
  const lines = (w, n, x0 = 4, y0 = 6) =>
    Array.from({ length: n }, (_, i) => [x0, y0 + i * 3, Math.max(4, w - 9 - ((i * 7) % 9))]);
  const n1 = note(34, 30, { lines: lines(34, 5) });
  const n2 = note(30, 26, {
    lines: lines(30, 4),
  });
  const n3 = note(36, 32, {
    lines: lines(36, 6),
  });
  const n4 = note(22, 18, {
    ramp: ['sky-40', 'sky-60', 'sky-80', 'sky-90', 'sky-95'],
    lines: [
      [4, 6, 10],
      [4, 9, 7],
    ],
  });
  paste(b, n1, BX + 10, BY + 9);
  paste(b, n3, BX + 50, BY + 12);
  paste(b, n2, BX + 92, BY + 8);
  paste(b, n4, BX + 98, BY + 34);
  // shadows under the notes: one step darker cork just below and right
  // (drawn as a dark line on the cork, so the paper looks lifted)
  for (const [x, y, w, h] of [
    [BX + 10, BY + 9, 34, 30],
    [BX + 50, BY + 12, 36, 32],
    [BX + 92, BY + 8, 30, 26],
    [BX + 98, BY + 34, 22, 18],
  ]) {
    for (let i = 2; i < w; i++) if (b.px[(y + h) * W + x + i] >>> 24 && isCork(b.px[(y + h) * W + x + i])) set(b, x + i, y + h, C('amber-20'));
    for (let j = 2; j < h; j++) if (isCork(b.px[(y + j) * W + x + w])) set(b, x + w, y + j, C('amber-20'));
  }
  function isCork(c) {
    return cork.includes(c);
  }
  // pins
  paste(b, pin('red'), BX + 24, BY + 8);
  paste(b, pin('sky'), BX + 65, BY + 11);
  paste(b, pin('green'), BX + 104, BY + 7);
  paste(b, pin('gold'), BX + 106, BY + 33);
  // the finished note carries the stamp
  paste(b, stamp(), BX + 59, BY + 21);
  // a string between two notes (a quest line)
  line(b, BX + 27, BY + 11, BX + 68, BY + 14, C('red-60'));
  frame(b);
  return b;
}

export function preview() {
  return [missionsBase()];
}

export { missionsBase, pin, stamp, note, W, H };
