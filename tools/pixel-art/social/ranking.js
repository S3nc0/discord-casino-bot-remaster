// Ranking: a three-step podium under a sunburst, the trophy on the top step with a glint that
// sweeps across it, silver and bronze medals on the lower steps. Medals 1 to 3 ship on their own
// for the ranking rows.
import { P, C, prop, paste, set, rect, frame, clone } from './kit.js';

const W = 176,
  H = 72;
const BIG = {
  1: ['.##.', '###.', '.##.', '.##.', '.##.', '.##.', '####'],
  2: ['.###.', '##.##', '...##', '..##.', '.##..', '##...', '#####'],
  3: ['####.', '...##', '..##.', '...##', '...##', '##.##', '.###.'],
};
const METAL = {
  gold: ['orange-40', 'amber-60', 'yellow-70', 'yellow-80', 'yellow-95'],
  silver: ['neutral-40', 'neutral-60', 'neutral-78', 'neutral-90', 'neutral-99'],
  bronze: ['red-30', 'orange-40', 'orange-50', 'orange-70', 'orange-80'],
};
const RIBBON = {
  gold: ['red-30', 'red-40', 'red-50', 'red-60', 'red-70'],
  silver: ['blue-20', 'blue-40', 'blue-50', 'blue-60', 'blue-70'],
  bronze: ['green-20', 'green-40', 'green-50', 'green-60', 'green-70'],
};

function trophy() {
  return prop(26, 30, (hi, part) => {
    const cup = part(METAL.gold, { round: 3, steps: [1, 2, 3] });
    hi.poly(cup, [
      [5, 2],
      [21, 2],
      [20, 9],
      [17, 14],
      [13.8, 16],
      [12.2, 16],
      [9, 14],
      [6, 9],
    ]);
    const handle = part(METAL.gold, { round: 0.8, steps: [1, 2, 3] });
    // handles: two thick arcs
    for (let k = 0; k <= 12; k++) {
      const a = -Math.PI / 2 + (k / 12) * Math.PI;
      hi.ellipse(handle, 5 - Math.cos(a) * 3.4, 6.4 + Math.sin(a) * 3.4, 0.9, 0.9);
      hi.ellipse(handle, 21 + Math.cos(a) * 3.4, 6.4 + Math.sin(a) * 3.4, 0.9, 0.9);
    }
    const rim = part(METAL.gold, { fixed: 4, outline: false });
    hi.rect(rim, 6, 2, 14, 1);
    const stem = part(METAL.gold, { bevel: true, steps: [1, 2, 3] });
    hi.rect(stem, 11.5, 16, 3, 4).rrect(stem, 8, 19.6, 10, 2.4, 1);
    const plinth = part('wood', { bevel: true, steps: [1, 2, 3] });
    hi.rect(plinth, 6, 22, 14, 6);
    const plate = part(METAL.gold, { fixed: 3, outline: false });
    hi.rect(plate, 9, 24, 8, 2);
    const star = part('red', { fixed: 3, outline: false });
    hi.cells(11, 5, ['..#..', '.###.', '#####', '.#.#.'], { '#': star });
  });
}

/** A medal on a ribbon, 16 by 16 (the list size) with the place number on its face. */
function medal(metal, n) {
  return prop(16, 16, (hi, part) => {
    const ribL = part(RIBBON[metal], { fixed: 3 }),
      ribR = part(RIBBON[metal], { fixed: 1 });
    hi.poly(ribR, [
      [14, 0.5],
      [10.6, 0.5],
      [7.2, 6.6],
      [9.6, 7.4],
    ]);
    hi.poly(ribL, [
      [2, 0.5],
      [5.4, 0.5],
      [8.8, 6.6],
      [6.4, 7.4],
    ]);
    const disc = part(METAL[metal], { bevel: true, steps: [1, 2, 4] });
    hi.ellipse(disc, 8, 10.6, 4.6, 4.6);
    const digit = part(METAL[metal], { fixed: 0, outline: false });
    const D = {
      1: ['.#', '##', '.#', '.#', '.#'],
      2: ['##.', '..#', '.#.', '#..', '###'],
      3: ['##.', '..#', '.#.', '..#', '##.'],
    }[n];
    hi.cells(n === 1 ? 7 : 7, 8, D, { '#': digit });
  });
}

function step(w, h, metal, n) {
  return prop(w, h, (hi, part) => {
    const top = part(METAL[metal], { bevel: true, steps: [2, 3, 4] });
    hi.rect(top, 1, 1, w - 2, 3);
    const front = part(
      metal === 'gold'
        ? ['blue-20', 'blue-30', 'blue-40', 'blue-50', 'blue-60']
        : metal === 'silver'
          ? ['indigo-20', 'indigo-30', 'indigo-40', 'indigo-50', 'indigo-60']
          : ['violet-20', 'violet-30', 'violet-40', 'violet-50', 'violet-60'],
      { bevel: true, steps: [1, 2, 3] },
    );
    hi.rect(front, 1, 4, w - 2, h - 5);
    const d = BIG[n];
    const dw = d[0].length;
    const num = part(METAL[metal], { fixed: 3, outline: false }),
      sh = part(METAL[metal], { fixed: 0, outline: false });
    const x0 = Math.round((w - dw) / 2),
      y0 = 7;
    hi.cells(x0 + 1, y0 + 1, d, { '#': sh });
    hi.cells(x0, y0, d, { '#': num });
  });
}

function rankingBase() {
  const b = new P.Buf(W, H);
  // sunburst: wedges round a point above the podium
  const cx = 88,
    cy = 18;
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const a = Math.atan2(y - cy, x - cx);
      const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 2;
      const d = Math.hypot(x - cx, (y - cy) * 1.4);
      const far = d > 70 ? 1 : d > 40 ? 0.5 : 0;
      const tone = k ? (far === 1 ? 'neutral-4' : far ? 'violet-10' : 'violet-20') : far === 1 ? 'neutral-4' : far ? 'neutral-4' : 'violet-10';
      set(b, x, y, C(tone));
    }
  // dither at the ring edges so the bands meet softly
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.4);
      if ((Math.abs(d - 40) < 1.5 || Math.abs(d - 70) < 1.5) && (x + y) % 2) set(b, x, y, b.px[y * W + x - 1]);
    }
  // confetti
  const R = P.rng(11);
  const CONF = ['red-60', 'yellow-80', 'sky-70', 'green-70', 'pink-70'];
  for (let i = 0; i < 40; i++) {
    const x = 4 + Math.floor(R() * (W - 8)),
      y = 4 + Math.floor(R() * 34);
    const c = C(CONF[i % CONF.length]);
    set(b, x, y, c);
    if (i % 3 === 0) set(b, x + 1, y, c);
    else if (i % 3 === 1) set(b, x, y + 1, c);
  }
  // floor
  rect(b, 2, H - 8, W - 4, 6, C('neutral-17'));
  rect(b, 2, H - 8, W - 4, 1, C('neutral-30'));
  // podium
  paste(b, step(42, 22, 'silver', 2), 26, H - 30);
  paste(b, step(42, 16, 'bronze', 3), 108, H - 24);
  paste(b, step(44, 30, 'gold', 1), 66, H - 38);
  // trophy and medals
  paste(b, trophy(), 75, H - 67);
  paste(b, medal('silver', 2), 39, H - 45);
  paste(b, medal('bronze', 3), 121, H - 39);
  frame(b);
  return b;
}

/** Frame t of T: a glint band sweeps over the cup, then a star twinkles at the rim. */
function rankingFrame(base, t, T) {
  const b = clone(base);
  const TX = 75,
    TY = H - 67;
  const cupCols = new Set(METAL.gold.slice(0, 4).map(C));
  const sweep = -10 + (t / (T * 0.6)) * 40; // diagonal position, done by 60% of the loop
  for (let y = TY; y < TY + 22; y++)
    for (let x = TX; x < TX + 26; x++) {
      const c = b.px[y * W + x];
      if (!cupCols.has(c)) continue;
      const u = x - TX + (y - TY) * 0.6;
      if (u > sweep && u < sweep + 3) set(b, x, y, C('yellow-95'));
    }
  const tw = t >= Math.floor(T * 0.6) && t < Math.floor(T * 0.6) + 2;
  if (tw) {
    const sx = TX + 20,
      sy = TY + 2;
    const big = t === Math.floor(T * 0.6);
    const arm = big ? 3 : 2;
    for (let k = -arm; k <= arm; k++) {
      set(b, sx + k, sy, C('paper-99'));
      set(b, sx, sy + k, C('paper-99'));
    }
    set(b, sx, sy, C('yellow-95'));
  }
  return b;
}

export function preview(T = 8) {
  const b = rankingBase();
  return Array.from({ length: T }, (_, t) => rankingFrame(b, t, T));
}

export { rankingBase, rankingFrame, medal, trophy, W, H };
