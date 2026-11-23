// Quiz: a game-show stage. Curtains, a valance, a lit "?" sign with marquee bulbs, the host at a
// podium with a microphone, two contestant buzzers, spotlights on a plank floor.
// Bulbs are drawn in two groups (`bulbA`, `bulbB`) so the app can swap them for a chase.
import { P, C, CR, prop, paste, set, rect, vbands, field, frame } from './kit.js';
import { person } from './person.js';

const W = 176,
  H = 80;

/** The "?" glyph, 5 by 8. */
const Q = [
  '.#####.',
  '##...##',
  '##...##',
  '.....##',
  '....##.',
  '...##..',
  '..##...',
  '..##...',
  '.......',
  '..##...',
  '..##...',
];

/** The host: the shared character in a violet suit, holding a microphone. */
const host = () => person({ coat: 'violet', pose: 'mic', legs: false });

function sign() {
  return prop(52, 21, (hi, part) => {
    const rim = part('gold', { bevel: true, steps: [1, 2, 4] });
    hi.rrect(rim, 1, 1, 50, 19, 6);
    const face = part(['indigo-10', 'indigo-20', 'violet-20', 'violet-30', 'violet-40'], {
      bevel: true,
      steps: [3, 2, 1],
    });
    hi.rect(face, 3, 3, 46, 15);
    const shadow = part('gold', { fixed: 0, outline: false }),
      q = part('gold', { fixed: 3, outline: false });
    hi.cells(24, 5, Q, { '#': shadow });
    hi.cells(23, 4, Q, { '#': q });
  });
}

function podium() {
  return prop(36, 27, (hi, part) => {
    const top = part('gold', { bevel: true, steps: [1, 3, 4] });
    hi.rect(top, 1, 1, 34, 3);
    const body = part(['blue-20', 'blue-30', 'blue-40', 'blue-50', 'blue-60'], {
      bevel: true,
      steps: [1, 2, 3],
    });
    hi.poly(body, [
      [3, 4],
      [33, 4],
      [31, 24],
      [5, 24],
    ]);
    const trim = part('gold', { fixed: 2, outline: false });
    hi.rect(trim, 4, 6, 28, 1).rect(trim, 5, 21, 26, 1);
    const badge = part('gold', { round: 2.2, steps: [1, 2, 3] });
    hi.ellipse(badge, 18, 13.5, 5.6, 5.6);
    const inner = part('red', { round: 1.6, steps: [1, 2, 3] });
    hi.ellipse(inner, 18, 13.5, 4.0, 4.0);
    const q = part('paper', { fixed: 4, outline: false });
    hi.cells(17, 11, ['###', '..#', '.#.', '...', '.#.'], { '#': q });
    const base = part(['neutral-17', 'neutral-25', 'neutral-35', 'neutral-50', 'neutral-65'], {
      bevel: true,
    });
    hi.rect(base, 3, 24, 30, 2);
  });
}

function buzzer(hue) {
  return prop(20, 24, (hi, part) => {
    const cap = part(hue, { round: 2.0, steps: [1, 2, 3] });
    hi.ellipse(cap, 10, 6.2, 4.6, 3.4).rect(cap, 5.4, 6.2, 9.2, 1.4);
    const ring = part('steel', { bevel: true, steps: [1, 2, 4] });
    hi.rect(ring, 3, 7.6, 14, 2.4);
    const col = part(['neutral-24', 'neutral-35', 'neutral-50', 'neutral-65', 'neutral-80'], {
      round: 2.4,
      steps: [0, 1, 2],
    });
    hi.rect(col, 5, 10, 10, 11.5);
    const stripe = part(hue, { fixed: 2, outline: false });
    hi.rect(stripe, 5, 13, 10, 1.4);
    const foot = part('steel', { bevel: true, steps: [0, 1, 3] });
    hi.rect(foot, 2.5, 21, 15, 2);
  });
}

/** Replace colours inside `mask` by the next lighter step (spotlight on the wall and the floor). */
function lighten(b, x0, y0, w, h, mask, ramps) {
  const map = new Map();
  for (const r of ramps) {
    const cs = CR(r);
    for (let i = 0; i < cs.length - 1; i++) map.set(cs[i], cs[i + 1]);
  }
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      if (!mask(x, y)) continue;
      const c = b.px[y * b.w + x],
        n = map.get(c);
      if (n !== undefined) b.px[y * b.w + x] = n;
    }
}

const FLOOR = 62;
/** Draw the stage; returns { buf, bulbsA, bulbsB } with the bulb pixel positions of each group. */
function quizScene() {
  const b = new P.Buf(W, H);
  // back wall: violet, darker at the top
  vbands(b, 2, 2, W - 4, FLOOR - 2, CR(['neutral-4', 'violet-10', 'indigo-10', 'violet-20']), (t) =>
    0.15 + t * 0.75,
  );
  // wall panels: a dark seam and a lit edge
  for (let x = 30; x < W - 28; x += 14) {
    for (let y = 12; y < FLOOR; y++) set(b, x, y, C('neutral-4'));
    for (let y = 12; y < FLOOR; y++) set(b, x + 1, y, C('violet-20'));
  }
  // floor: planks, lighter towards the front
  const wood = CR(['brown-10', 'brown-20', 'brown-30', 'brown-40']);
  vbands(b, 2, FLOOR, W - 4, H - 4 - FLOOR, wood, (t) => 0.2 + t * 0.7, 0.2);
  for (let x = 2; x < W - 2; x++) {
    set(b, x, FLOOR, C('brown-10'));
    set(b, x, FLOOR + 5, C('brown-20'));
    set(b, x, FLOOR + 10, C('brown-20'));
  }
  for (const [x0, y0] of [
    [20, FLOOR + 1],
    [61, FLOOR + 1],
    [118, FLOOR + 1],
    [150, FLOOR + 1],
    [40, FLOOR + 6],
    [97, FLOOR + 6],
    [134, FLOOR + 6],
    [12, FLOOR + 11],
    [70, FLOOR + 11],
    [124, FLOOR + 11],
  ])
    for (let y = y0; y < y0 + 4; y++) set(b, x0, y, C('brown-10'));
  // stage lip: gold trim and a dark front
  for (let x = 2; x < W - 2; x++) {
    set(b, x, H - 4, C('yellow-70'));
    set(b, x, H - 3, C('orange-40'));
  }

  // spotlight cones from two lamps onto the podium: one step lighter where the light falls
  const cone = (ax, ay, bx0, bx1, by) => (x, y) => {
    if (y < ay || y > by) return false;
    const t = (y - ay) / (by - ay),
      l = ax + (bx0 - ax) * t,
      r = ax + (bx1 - ax) * t;
    return x >= l && x <= r;
  };
  const c1 = cone(36, 15, 62, 90, H - 5),
    c2 = cone(140, 15, 86, 114, H - 5);
  lighten(b, 2, 15, W - 4, H - 19, (x, y) => c1(x, y) || c2(x, y), [
    ['neutral-4', 'violet-10', 'violet-20', 'violet-30'],
    ['indigo-10', 'indigo-20'],
    ['brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-50'],
  ]);
  // pool of light on the floor under the podium
  const pool = (x, y) => ((x - 88) / 46) ** 2 + ((y - (FLOOR + 9)) / 7) ** 2 <= 1;
  lighten(b, 2, FLOOR, W - 4, H - 4 - FLOOR, pool, [
    ['brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-50', 'brown-60'],
  ]);

  // sign with bulbs
  const SX = 62,
    SY = 13;
  paste(b, sign(), SX, SY);
  const bulbsA = [],
    bulbsB = [];
  const ring = [];
  for (let x = SX + 6; x <= SX + 44; x += 4) ring.push([x, SY + 1]);
  for (let y = SY + 6; y <= SY + 14; y += 4) ring.push([SX + 50, y]);
  for (let x = SX + 44; x >= SX + 6; x -= 4) ring.push([x, SY + 19]);
  for (let y = SY + 14; y >= SY + 6; y -= 4) ring.push([SX + 1, y]);
  ring.forEach(([x, y], i) => (i % 2 ? bulbsB : bulbsA).push([x, y]));

  // curtains and the valance
  const red = CR(['red-10', 'red-20', 'red-30', 'red-40', 'red-50', 'red-60']);
  const drape = (x0, x1, flip) =>
    field(b, x0, 2, x1 - x0, H - 6, red, (x, _y) => {
      const u = (x - x0) / 6;
      const ph = (u - Math.floor(u)) * Math.PI * 2;
      const fold = 0.5 + 0.38 * Math.cos(ph + 0.9);
      const edge = flip ? (x - x0) / (x1 - x0) : 1 - (x - x0) / (x1 - x0);
      return fold * 0.85 + 0.15 - 0.12 * (1 - edge);
    });
  drape(2, 26, false);
  drape(W - 26, W - 2, true);
  for (const x of [8, W - 16]) {
    rect(b, x, 46, 8, 2, C('yellow-70'));
    rect(b, x, 48, 8, 1, C('orange-40'));
  }
  const scallop = (x) => 2 + 7 + Math.round(2 * Math.sin((((x - 2) % 16) / 16) * Math.PI));
  field(b, 2, 2, W - 4, 10, red, (x, y) => {
    if (y > scallop(x)) return null;
    const u = ((x - 2) % 16) / 16;
    return 0.55 - (y - 2) * 0.05 + 0.15 * Math.cos(u * Math.PI * 2);
  });
  for (let x = 2; x < W - 2; x++) {
    set(b, x, scallop(x) + 1, C('yellow-70'));
    if (x % 2) set(b, x, scallop(x) + 2, C('orange-40'));
  }
  // spotlight lamps
  for (const x of [32, 136]) {
    rect(b, x, 12, 8, 3, C('neutral-30'));
    rect(b, x + 1, 12, 6, 1, C('neutral-60'));
    rect(b, x + 2, 15, 4, 1, C('yellow-95'));
  }

  // buzzers, host and podium
  paste(b, buzzer('red'), 30, FLOOR - 11);
  paste(b, buzzer('sky'), 126, FLOOR - 11);
  paste(b, host(), 76, 29);
  paste(b, podium(), 70, 50);

  frame(b);
  return { buf: b, bulbsA, bulbsB };
}

/** Bulbs lit in `group` (0 or 1): lit bulbs are 2x2 warm white with a gold edge, dim ones orange. */
function bulbs(buf, s, lit) {
  const on = [C('yellow-95'), C('yellow-80')],
    off = [C('orange-40'), C('red-30')];
  for (const [g, list] of [
    [0, s.bulbsA],
    [1, s.bulbsB],
  ]) {
    const c = g === lit ? on : off;
    for (const [x, y] of list) {
      set(buf, x, y, c[0]);
      set(buf, x + 1, y, c[1]);
      set(buf, x, y + 1, c[1]);
      set(buf, x + 1, y + 1, c[1]);
    }
  }
  return buf;
}

export { quizScene, bulbs, host, podium, buzzer, sign, W, H };

export function preview(T = 2) {
  const s = quizScene();
  return Array.from({ length: T }, (_, t) => bulbs(s.buf.constructor === Object ? s.buf : cloneBuf(s.buf), s, t % 2));
}
function cloneBuf(b) {
  const o = new P.Buf(b.w, b.h);
  o.px.set(b.px);
  return o;
}
