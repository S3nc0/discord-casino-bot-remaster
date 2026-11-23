// Lottery: a festival counter with a glass drawing machine. Numbered balls tumble inside the globe
// (frames of the globe only), the crank turns, and the drawn ball waits in the tray. A ticket
// sprite sits next to the buy button.
import { P, C, CR, prop, paste, set, rect, vbands, field, line, frame, clone } from './kit.js';

const W = 176,
  H = 72;
const GX = 88,
  GY = 24,
  GR = 17;
const TOP = 60;
const HUES = ['red', 'sky', 'gold', 'green', 'violet', 'orange'];
const RAMPS = {
  red: ['red-20', 'red-40', 'red-50', 'red-60', 'red-80'],
  sky: ['blue-20', 'sky-40', 'sky-60', 'sky-70', 'sky-90'],
  gold: ['orange-40', 'amber-60', 'yellow-70', 'yellow-80', 'yellow-95'],
  green: ['green-20', 'green-40', 'green-50', 'green-70', 'green-90'],
  violet: ['violet-20', 'violet-40', 'violet-50', 'violet-60', 'violet-80'],
  orange: ['red-30', 'orange-50', 'orange-60', 'orange-70', 'orange-90'],
};

/** A small ball, 9 by 9 with its outline: colour shell and a white band. */
function ball(hue) {
  return prop(9, 9, (hi, part) => {
    const shell = part(RAMPS[hue], { round: 1.8, steps: [1, 2, 3] });
    hi.ellipse(shell, 4.5, 4.5, 3.6, 3.6);
    const band = part('paper', { fixed: 4, outline: false });
    hi.rect(band, 3, 4, 3, 1).rect(band, 4, 3, 1, 3);
  });
}

const DIGITS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
};
/** The drawn ball, 15 by 15: a gold shell with a white face and a number. */
function bigBall(n = 7, hue = 'red') {
  return prop(15, 15, (hi, part) => {
    const shell = part(RAMPS[hue], { round: 3, steps: [1, 2, 3] });
    hi.ellipse(shell, 7.5, 7.5, 6.4, 6.4);
    const face = part('paper', { round: 1.6, steps: [2, 3, 4], outline: false });
    hi.ellipse(face, 7.5, 7.5, 3.9, 3.9);
    const ink = part('ink', { fixed: 1, outline: false });
    hi.cells(6, 5, DIGITS[n], { '#': ink });
  });
}

/** The ticket, 30 by 18: stub with a perforation, a star, a serial line. */
function ticket() {
  return prop(30, 18, (hi, part) => {
    const t = part('orange', { bevel: true, steps: [1, 2, 3] });
    hi.rect(t, 1, 2, 28, 14);
    hi.erase((x, y) => (x - 1) ** 2 + (y - 9) ** 2 < 4.5 || (x - 29) ** 2 + (y - 9) ** 2 < 4.5);
    const perf = part('orange', { fixed: 0, outline: false });
    for (let y = 3; y < 16; y += 2) hi.rect(perf, 21, y, 1, 1);
    const star = part('gold', { fixed: 4, outline: false });
    hi.cells(9, 5, ['..#..', '..#..', '#####', '.###.', '.#.#.', '#...#'], { '#': star });
    const ink = part('red', { fixed: 1, outline: false });
    hi.rect(ink, 5, 13, 12, 1).rect(ink, 23, 5, 3, 1).rect(ink, 23, 7, 3, 1).rect(ink, 23, 11, 3, 1);
  });
}

/** Two stacks of coins, each coin 2 px: a lit rim row and a shaded row, the top coin face on top. */
function coins(b, x0, y0, stacks = [6, 4]) {
  stacks.forEach((n, k) => {
    const x = x0 + k * 10,
      yb = y0;
    for (let i = 0; i < n; i++) {
      const y = yb - i * 2;
      rect(b, x, y - 1, 9, 1, C('yellow-80'));
      rect(b, x, y, 9, 1, C('orange-40'));
      set(b, x, y - 1, C('amber-60'));
      set(b, x + 8, y - 1, C('amber-60'));
    }
    const yt = yb - n * 2;
    rect(b, x + 1, yt - 1, 7, 2, C('yellow-95'));
    rect(b, x, yt, 9, 1, C('yellow-80'));
    set(b, x + 4, yt, C('amber-60'));
    // outline
    for (let y = yt - 1; y <= yb; y++) {
      set(b, x - 1, y, C('orange-30'));
      set(b, x + 9, y, C('orange-30'));
    }
    rect(b, x, yt - 2, 9, 1, C('orange-30'));
    rect(b, x, yb + 1, 9, 1, C('orange-30'));
  });
}

function base() {
  return prop(46, 23, (hi, part) => {
    const collar = part('gold', { bevel: true, steps: [1, 3, 4] });
    hi.rrect(collar, 13, 1, 20, 3, 1.2);
    const neck = part('red', { round: 1.6, steps: [1, 2, 3] });
    hi.rect(neck, 17, 4, 12, 3);
    const box = part('red', { bevel: true, steps: [1, 2, 3] });
    hi.rrect(box, 4, 7, 38, 13, 2);
    const trim = part('gold', { fixed: 3, outline: false });
    hi.rect(trim, 5, 9, 36, 1).rect(trim, 5, 18, 36, 1);
    const star = part('gold', { fixed: 4, outline: false });
    hi.cells(9, 11, ['..#..', '#####', '.###.', '.#.#.'], { '#': star });
    hi.cells(32, 11, ['..#..', '#####', '.###.', '.#.#.'], { '#': star });
    const mouth = part('ink', { fixed: 0 });
    hi.rrect(mouth, 18, 11, 10, 6, 2);
    const foot = part('gold', { bevel: true, steps: [0, 1, 3] });
    hi.rect(foot, 2, 20, 42, 2);
  });
}

/** Static part: wall, bunting, counter, machine base, ticket stack, coins, tray. */
function lotteryBase() {
  const b = new P.Buf(W, H);
  vbands(b, 2, 2, W - 4, 52, CR(['neutral-4', 'teal-10', 'teal-20']), (t) => 0.1 + t * 0.8);
  // tent stripes, faint
  for (let x = 2; x < W - 2; x++)
    if (Math.floor((x - 2) / 11) % 2 === 0)
      for (let y = 2; y < 54; y++) {
        const c = b.px[y * W + x];
        if (c === C('teal-10')) set(b, x, y, C('teal-20'));
        else if (c === C('neutral-4')) set(b, x, y, C('teal-10'));
      }
  // bunting: a cord in two sags, a flag every 8 px
  const sag = (x) => 6 + Math.round(5 * Math.sin(((x - 2) / (W - 4)) * Math.PI * 2) ** 2);
  for (let x = 2; x < W - 2; x++) set(b, x, sag(x), C('paper-70'));
  const FL = [
    ['red-60', 'red-40'],
    ['yellow-80', 'amber-60'],
    ['sky-70', 'sky-50'],
    ['green-70', 'green-50'],
  ];
  let k = 0;
  for (let x = 6; x < W - 8; x += 9, k++) {
    const y = sag(x + 3) + 1,
      [lit, sh] = FL[k % 4];
    for (let j = 0; j < 6; j++)
      for (let i = j >> 1; i < 7 - (j >> 1); i++) set(b, x + i, y + j, i < 3 ? C(lit) : C(sh));
  }
  // counter: red cloth with gold trim, lighter on top
  vbands(b, 2, TOP, W - 4, H - 2 - TOP, CR(['red-20', 'red-30', 'red-40']), (t) => 0.9 - t * 0.8);
  for (let x = 2; x < W - 2; x++) {
    set(b, x, TOP, C('red-60'));
    set(b, x, TOP + 3, C('yellow-70'));
    set(b, x, TOP + 4, C('orange-40'));
    if (x % 6 < 3) set(b, x, TOP + 5, C('yellow-70'));
  }
  // machine base
  paste(b, base(), GX - 23, GY + GR - 1);
  // tickets on the left
  const tk = ticket();
  paste(b, tk, 22, TOP - 20);
  paste(b, tk, 18, TOP - 16);
  // tray with the drawn ball, the chute from the base mouth
  rect(b, 116, TOP - 4, 22, 4, C('neutral-30'));
  rect(b, 116, TOP - 4, 22, 1, C('neutral-60'));
  rect(b, 116, TOP - 1, 22, 1, C('neutral-17'));
  line(b, 106, TOP - 10, 116, TOP - 5, C('neutral-60'));
  line(b, 106, TOP - 9, 116, TOP - 4, C('neutral-30'));
  paste(b, bigBall(7, 'red'), 120, TOP - 17);
  coins(b, 146, TOP - 2);
  frame(b);
  return b;
}

/** The globe with balls at time `t` of `T` frames (one full tumble), the crank at its angle. */
function globe(b, t, T) {
  // see-through glass: the wall behind one step lighter, rim in steel
  const map = new Map(
    [
      ['neutral-4', 'teal-10'],
      ['teal-10', 'teal-20'],
      ['teal-20', 'teal-30'],
      ['paper-70', 'paper-80'],
    ].map(([a, c]) => [C(a), C(c)]),
  );
  for (let y = GY - GR - 1; y <= GY + GR + 1; y++)
    for (let x = GX - GR - 1; x <= GX + GR + 1; x++) {
      const d = Math.hypot(x - GX + 0.5, y - GY + 0.5);
      if (d > GR + 0.5) continue;
      const c = b.px[y * W + x];
      if (d > GR - 1) set(b, x, y, (x - GX) + (y - GY) < 0 ? C('neutral-80') : C('neutral-40'));
      else set(b, x, y, map.get(c) ?? c);
    }
  // balls: a pile at the bottom that churns and a few in the air, all turning with the drum
  const balls = HUES.map(ball);
  const a = (t / T) * Math.PI * 2;
  const placed = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const ph = (i / N) * Math.PI * 2;
    const air = i % 3 === 0;
    const rr = air ? 7 + (i % 4) : 10 - (i % 2) * 3;
    const ang = air ? a + ph : Math.PI / 2 + Math.sin(a + ph) * 0.9;
    const x = Math.round(GX + Math.cos(ang) * rr) - 4,
      y = Math.round(GY + Math.sin(ang) * rr * (air ? 0.85 : 1)) - 4;
    placed.push([y, x, balls[i % balls.length]]);
  }
  placed.sort((p, q) => p[0] - q[0]);
  for (const [y, x, s] of placed) paste(b, s, x, y);
  // glass shine: a short arc top left and a dot, drawn over the balls
  for (let k = 0; k < 9; k++) {
    const an = Math.PI * 1.05 + k * 0.07;
    set(b, Math.round(GX + Math.cos(an) * (GR - 3)), Math.round(GY + Math.sin(an) * (GR - 3)), C('paper-99'));
  }
  set(b, GX - 8, GY - 11, C('paper-99'));
  set(b, GX - 7, GY - 12, C('paper-99'));
  // crank: an axle on the right, an arm that turns once per loop, a red knob
  const ca = a;
  const ax = GX + GR + 3,
    ay = GY;
  rect(b, GX + GR, ay - 1, 4, 3, C('neutral-50'));
  const kx = Math.round(ax + Math.cos(ca) * 7),
    ky = Math.round(ay + Math.sin(ca) * 7);
  line(b, ax, ay, kx, ky, C('neutral-70'));
  line(b, ax, ay + 1, kx, ky + 1, C('neutral-35'));
  rect(b, kx - 1, ky - 1, 3, 3, C('red-50'));
  set(b, kx - 1, ky - 1, C('red-70'));
  set(b, kx + 1, ky + 1, C('red-30'));
  set(b, ax, ay, C('yellow-80'));
  return b;
}

/** The whole scene at frame t (globe + crank region changes, the rest is the same). */
function lotteryFrame(baseBuf, t, T) {
  return globe(clone(baseBuf), t, T);
}

export { lotteryBase, lotteryFrame, ticket, bigBall, ball, W, H, GX, GY, GR };

/** Preview frames for the sheets. */
export function preview(T = 6) {
  const b = lotteryBase();
  return Array.from({ length: T }, (_, t) => lotteryFrame(b, t, T));
}
