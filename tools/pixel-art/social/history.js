// History: an open ledger book on a desk in front of a bookshelf. Ruled pages with a red margin,
// entries in ink with green and red amounts, a quill in an inkwell, a coin stack.
import { P, C, CR, prop, paste, set, rect, vbands, frame } from './kit.js';

const W = 176,
  H = 60;
const DESK = 42;

function shelf(b) {
  // dark wood back, three shelves of book spines
  vbands(b, 2, 2, W - 4, DESK - 2, CR(['brown-10', 'brown-20']), (t) => 0.3 + t * 0.4);
  const R = P.rng(3);
  const SPINES = [
    ['red-30', 'red-40'],
    ['green-30', 'green-40'],
    ['blue-30', 'blue-40'],
    ['amber-40', 'amber-50'],
    ['violet-30', 'violet-40'],
    ['teal-30', 'teal-40'],
    ['brown-40', 'brown-50'],
  ];
  for (const top of [3, 16, 29]) {
    const base = top + 12;
    let x = 3;
    while (x < W - 4) {
      const w = 3 + Math.floor(R() * 3),
        h = 8 + Math.floor(R() * 4);
      if (R() < 0.08) {
        x += 3;
        continue;
      }
      const [d, l] = SPINES[Math.floor(R() * SPINES.length)];
      for (let i = 0; i < w && x + i < W - 3; i++)
        for (let y = base - h; y < base; y++) set(b, x + i, y, C(i === 0 ? l : d));
      // gold band on some spines
      if (R() < 0.5) for (let i = 0; i < w && x + i < W - 3; i++) set(b, x + i, base - h + 2, C('yellow-70'));
      set(b, x + w - 1, base - h, C('brown-10'));
      x += w;
    }
    for (let xx = 2; xx < W - 2; xx++) {
      set(b, xx, base, C('brown-40'));
      set(b, xx, base + 1, C('brown-20'));
    }
  }
}

function book() {
  return prop(104, 34, (hi, part) => {
    const cover = part(['green-10', 'green-20', 'green-30', 'green-40', 'green-50'], {
      bevel: true,
      steps: [1, 2, 3],
    });
    hi.rect(cover, 1, 3, 102, 30);
    const pageL = part('paper', { bevel: true, steps: [3, 4, 4] }),
      pageR = part('paper', { bevel: true, steps: [3, 4, 4] });
    hi.poly(pageL, [
      [4, 2],
      [26, 1],
      [51, 3],
      [51, 31],
      [26, 29.5],
      [4, 30.5],
    ]);
    hi.poly(pageR, [
      [53, 3],
      [78, 1],
      [100, 2],
      [100, 30.5],
      [78, 29.5],
      [53, 31],
    ]);
    const gutter = part('paper', { fixed: 1, outline: false });
    hi.rect(gutter, 51, 3, 2, 28);
    const rule = part('sky', { fixed: 3, outline: false });
    const margin = part('red', { fixed: 3, outline: false });
    for (let y = 7; y < 29; y += 3) {
      hi.rect(rule, 6, y, 44, 1);
      hi.rect(rule, 55, y, 44, 1);
    }
    hi.rect(margin, 12, 4, 1, 25).rect(margin, 61, 4, 1, 25);
    const ink = part('ink', { fixed: 3, outline: false }),
      plus = part('green', { fixed: 1, outline: false }),
      minus = part('red', { fixed: 1, outline: false });
    const R = P.rng(8);
    for (const x0 of [14, 63])
      for (let y = 6; y < 28; y += 3) {
        const w = 10 + Math.floor(R() * 12);
        for (let i = 0; i < w; i += 1 + (R() < 0.25 ? 1 : 0)) hi.rect(ink, x0 + i, y, 1, 1);
        const amt = R() < 0.55 ? plus : minus;
        hi.rect(amt, x0 + 28, y, 5 + Math.floor(R() * 3), 1);
      }
    const ribbon = part('red', { bevel: true, steps: [1, 2, 3] });
    hi.poly(ribbon, [
      [80, 30],
      [83, 30],
      [83, 34],
      [81.5, 32.6],
      [80, 34],
    ]);
  });
}

function inkwell() {
  return prop(20, 30, (hi, part) => {
    const quill = part('paper', { round: 0.8, steps: [2, 3, 4] });
    hi.poly(quill, [
      [9, 20],
      [16, 1],
      [18, 2],
      [11, 20],
    ]);
    const vane = part('paper', { fixed: 2, outline: false });
    hi.line(vane, 11.5, 15, 16.2, 3, 0.9);
    const jar = part(['neutral-10', 'neutral-17', 'neutral-25', 'neutral-40', 'sky-70'], {
      round: 2,
      steps: [1, 2, 4],
    });
    hi.rrect(jar, 3, 18, 14, 10, 3);
    const neck = part('ink', { bevel: true, steps: [1, 2, 3] });
    hi.rect(neck, 6, 16, 8, 3);
  });
}

function historyScene() {
  const b = new P.Buf(W, H);
  shelf(b);
  // desk
  vbands(b, 2, DESK, W - 4, H - 2 - DESK, CR(['brown-30', 'brown-40', 'brown-50']), (t) => 0.95 - t * 0.7);
  for (let x = 2; x < W - 2; x++) {
    set(b, x, DESK, C('brown-60'));
    set(b, x, H - 4, C('brown-20'));
  }
  paste(b, book(), 36, DESK - 16);
  paste(b, inkwell(), 146, DESK - 16);
  // coin stack on the left, 2 px coins
  for (let i = 0; i < 6; i++) {
    const y = DESK + 8 - i * 2;
    rect(b, 12, y - 1, 10, 1, C('yellow-80'));
    rect(b, 12, y, 10, 1, C('orange-40'));
  }
  rect(b, 13, DESK - 5, 8, 1, C('yellow-95'));
  for (let y = DESK - 5; y <= DESK + 8; y++) {
    set(b, 11, y, C('orange-30'));
    set(b, 22, y, C('orange-30'));
  }
  rect(b, 12, DESK - 6, 10, 1, C('orange-30'));
  rect(b, 12, DESK + 9, 10, 1, C('orange-30'));
  frame(b);
  return b;
}

export function preview() {
  return [historyScene()];
}

export { historyScene, W, H };
