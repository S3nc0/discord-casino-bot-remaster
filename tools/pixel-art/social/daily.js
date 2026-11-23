// Daily: a wall calendar for the week with a red stamp on each streak day, and a gift box that
// opens when the bonus is claimed (frames of the box only). Stamps are placed by the app, one per
// day of the streak, at `DAY_CELLS`.
import { P, C, CR, prop, paste, set, rect, vbands, field, frame, clone } from './kit.js';
import { stamp as bigStamp } from './missions.js';

const W = 176,
  H = 64;
const CAL = { x: 8, y: 8, w: 116, h: 42 };
const CELL = 14;
/** Top-left of each day cell (Mon..Sun), 14 by 14. */
const DAY_CELLS = Array.from({ length: 7 }, (_, i) => [CAL.x + 6 + i * (CELL + 1), CAL.y + 22]);
const DIG = {
  1: ['.#', '##', '.#', '.#', '.#'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
};

function calendar() {
  const { w, h } = CAL;
  return prop(w, h, (hi, part) => {
    const back = part('stone', { bevel: true, steps: [1, 2, 3] });
    hi.rect(back, 1, 4, w - 2, h - 5);
    const head = part('red', { bevel: true, steps: [1, 2, 3] });
    hi.rect(head, 1, 4, w - 2, 10);
    const sheet = part('paper', { bevel: true, steps: [3, 4, 4] });
    hi.rect(sheet, 4, 15, w - 8, h - 19);
    // weekday strip above the cells: tiny dots in a darker step, Sunday red
    const dot = part('paper', { fixed: 1, outline: false }),
      sun = part('red', { fixed: 2, outline: false });
    for (let i = 0; i < 7; i++) hi.rect(i === 6 ? sun : dot, 6 + i * (CELL + 1) + 5, 18, 4, 1);
    const line = part('paper', { fixed: 2, outline: false });
    for (let i = 0; i < 7; i++) {
      const x = 6 + i * (CELL + 1);
      hi.rect(line, x, 21, CELL, 1).rect(line, x, 22 + CELL, CELL, 1);
      hi.rect(line, x, 21, 1, CELL + 2).rect(line, x + CELL - 1, 21, 1, CELL + 2);
    }
    const num = part('ink', { fixed: 2, outline: false }),
      numSun = part('red', { fixed: 1, outline: false });
    for (let i = 0; i < 7; i++)
      hi.cells(6 + i * (CELL + 1) + 2, 24, DIG[i + 1], { '#': i === 6 ? numSun : num });
    // title bar dots and rings
    const gold = part('gold', { fixed: 3, outline: false });
    hi.rect(gold, w / 2 - 14, 8, 28, 2);
    const ring = part('steel', { bevel: true, steps: [1, 2, 4] });
    for (let i = 0; i < 6; i++) hi.rrect(ring, 10 + i * ((w - 26) / 5), 0.5, 3, 7, 1);
  });
}

/** Stamp for a day cell: the done stamp shrunk to 12 by 12 (drawn again at that size). */
function dayStamp() {
  const b = new P.Buf(12, 12);
  const ink = C('red-50'),
    dark = C('red-40');
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const d = Math.hypot(x - 5.5, y - 5.5);
      if (d <= 5.6 && d >= 4.4 && P.hash(x, y, 9) > 0.1) set(b, x, y, (x + y) % 5 ? ink : dark);
    }
  for (const [x, y] of [
    [3, 6],
    [4, 7],
    [5, 8],
    [6, 7],
    [7, 6],
    [8, 5],
    [8, 4],
  ])
    set(b, x, y, ink);
  return b;
}

function room() {
  const b = new P.Buf(W, H);
  // wallpaper: teal with thin stripes, a skirting board and a wood floor
  vbands(b, 2, 2, W - 4, H - 14, CR(['teal-10', 'teal-20', 'teal-30']), (t) => 0.25 + t * 0.6);
  for (let x = 6; x < W - 2; x += 8) for (let y = 2; y < H - 12; y++) set(b, x, y, C('teal-10'));
  rect(b, 2, H - 12, W - 4, 2, C('brown-50'));
  rect(b, 2, H - 10, W - 4, 8, C('brown-30'));
  for (let x = 2; x < W - 2; x++) {
    set(b, x, H - 10, C('brown-20'));
    if (x % 17 === 0) for (let y = H - 9; y < H - 2; y++) set(b, x, y, C('brown-20'));
  }
  paste(b, calendar(), CAL.x, CAL.y);
  return b;
}

/** Gift box frames, 40 by 44: 0 still, 1 and 2 wiggle, 3 lid up, 4 lid off and light, 5 open. */
function gift(f) {
  const box = (dx, lidUp, open, phase = 0) =>
    prop(40, 44, (hi, part) => {
      if (open) {
        const light = part(['yellow-80', 'yellow-90', 'yellow-95', 'paper-99', 'paper-99'], {
          fixed: 2,
          outline: false,
        });
        const ax = 20 + dx,
          ay = 26;
        for (let k = -2; k <= 2; k++) {
          const a = k * 0.42 + phase,
            l = k === 0 ? 22 : 18 - Math.abs(k) * 2;
          hi.line(
            light,
            ax + Math.sin(a) * 4,
            ay - Math.cos(a) * 4,
            ax + Math.sin(a) * l,
            ay - Math.cos(a) * l,
            1.4,
          );
        }
      }
      const body = part('red', { bevel: true, steps: [1, 2, 3] });
      hi.rect(body, 7 + dx, 26, 26, 16);
      const rib = part('gold', { bevel: true, steps: [1, 3, 4] });
      hi.rect(rib, 18 + dx, 26, 4, 16);
      if (open) {
        const inside = part('red', { fixed: 0 });
        hi.rect(inside, 8 + dx, 26, 24, 2);
        const coin = part('gold', { round: 1.2, steps: [1, 3, 4] });
        hi.ellipse(coin, 14 + dx, 22, 2.6, 2.6)
          .ellipse(coin, 25 + dx, 20, 2.6, 2.6)
          .ellipse(coin, 20 + dx, 14, 3, 3);
      } else {
        const ly = 21 - lidUp;
        const lid = part('red', { bevel: true, steps: [2, 3, 4] });
        hi.rect(lid, 5 + dx, ly, 30, 6);
        hi.rect(rib, 18 + dx, ly, 4, 6);
        const bow = part('gold', { round: 1.4, steps: [1, 2, 3] });
        hi.ellipse(bow, 15.5 + dx, ly - 3, 4, 2.8).ellipse(bow, 24.5 + dx, ly - 3, 4, 2.8);
        const knot = part('gold', { bevel: true, steps: [1, 3, 4] });
        hi.rect(knot, 18 + dx, ly - 5, 4, 4);
      }
    });
  return [
    () => box(0, 0, false),
    () => box(-1, 0, false),
    () => box(1, 1, false),
    () => box(0, 5, false),
    () => box(0, 0, true),
    () => box(0, 0, true, 0.21),
  ][f]();
}

const GIFT = { x: 128, y: H - 52 };
/** The scene with `streak` stamps and gift frame `f`. */
function dailyFrame(streak, f) {
  const b = room();
  const st = dayStamp();
  for (let i = 0; i < Math.min(7, streak); i++)
    paste(b, st, DAY_CELLS[i][0] + 1, DAY_CELLS[i][1] + 1);
  paste(b, gift(f), GIFT.x, GIFT.y);
  frame(b);
  return b;
}

export function preview() {
  return [0, 1, 2, 3, 4, 5].map((f) => dailyFrame(3, f));
}

export { room, calendar, dayStamp, gift, dailyFrame, DAY_CELLS, GIFT, W, H };
void bigStamp;
void field;
void clone;
