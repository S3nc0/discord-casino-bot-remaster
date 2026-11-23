// Kyosai (mutual aid) office: a big shield crest with an umbrella on the wall, rain outside the
// window, the notice board with the members' motions, a ballot box and the shared fund chest.
import { R, wallValue } from './props.js';
import { P } from './lib.js';
import { Hi } from '../lib/hi.js';
import { ramp } from '../lib/palette.js';

export const W = 128,
  H = 48;

export function kyosai(S, opt = {}) {
  const r = R(S);
  const plaster = S.D(
    ['paper-70', 'paper-80', 'paper-87', 'paper-92', 'yellow-95'],
    ['indigo-10', 'neutral-14', 'neutral-17', 'neutral-22', 'neutral-30'],
  );
  const lamps = [[64, 4]];
  for (let y = 0; y < 43; y++)
    for (let x = 0; x < W; x++) {
      const v = wallValue(S, x, y, lamps, 43, S.D(0.5, 0.3));
      S.set(x, y, plaster[1 + P.band(v, 3, x, y, 0.3)]);
    }
  // beams: ceiling rail and two posts
  S.rect(0, 0, W, 3, r.wood[1]).hl(0, 2, W, r.wood[0]).hl(0, 0, W, r.wood[3]);
  for (const x of [38, 88])
    S.rect(x, 3, 4, 40, r.wood[2])
      .vl(x, 3, 40, r.wood[3])
      .vl(x + 3, 3, 40, r.wood[0]);
  S.hl(0, 31, W, r.wood[3]).hl(0, 32, W, r.wood[1]);

  rainWindow(S, r, 6, 7, 27, 22, opt.t ?? 0);
  shield(S, r, 64, 5);
  noticeBoard(S, r, 94, 6);

  // floor: tatami edge then boards
  const fl = S.D(
    ['brown-30', 'brown-40', 'brown-50', 'brown-60'],
    ['red-10', 'brown-10', 'brown-20', 'brown-30'],
  );
  S.rect(0, 43, W, 5, fl[2]).hl(0, 43, W, fl[3]);
  for (let y = 45; y < H; y += 2) S.hl(0, y, W, fl[1]);
  for (let x = 7; x < W; x += 19) S.vl(x, 44, 1, fl[0]).vl(x + 9, 46, 1, fl[0]);

  umbrellaStand(S, r, 10, 29);
  fundChest(S, r, 52, 33);
  ballotBox(S, r, 98, 29);
}

function rainWindow(S, r, x0, y0, w, h, t) {
  S.bevel(x0, y0, w, h, [r.wood[0], r.wood[2], r.wood[4]]);
  const sky = S.D(
    ['neutral-60', 'neutral-70', 'neutral-80'],
    ['neutral-6', 'neutral-8', 'neutral-12'],
  );
  S.vbands(x0 + 2, y0 + 2, w - 4, h - 4, sky);
  // roof tops across the street
  const roof = S.D('neutral-50', 'neutral-17');
  for (let x = x0 + 2; x < x0 + w - 2; x++)
    S.vl(x, y0 + h - 5 - (Math.floor(x / 6) % 2) * 2, 3 + (Math.floor(x / 6) % 2) * 2, roof);
  // rain streaks (the shipped scene animates them)
  const rain = S.D('sky-90', 'sky-40');
  for (let k = 0; k < 9; k++) {
    const x = x0 + 3 + ((k * 7) % (w - 6)),
      y = y0 + 2 + ((k * 5 + t * 2) % (h - 5));
    S.set(x, y, rain).set(x - 1, y + 1, rain);
  }
  // cross bar of the frame and the sill
  S.vl(x0 + Math.floor(w / 2), y0 + 1, h - 2, r.wood[2]).hl(
    x0 + 1,
    y0 + Math.floor(h / 2),
    w - 2,
    r.wood[2],
  );
  S.hl(x0 - 1, y0 + h, w + 2, r.wood[4]).hl(x0 - 1, y0 + h + 1, w + 2, r.wood[0]);
}

/** The crest: a blue shield with a gold rim and a white umbrella. */
function shield(S, r, cx, y0) {
  const hi = new Hi(30, 28);
  const rim = hi.part(ramp(r.gold), { round: 1.0, steps: [1, 2, 4] });
  const blue = hi.part(ramp(['blue-20', 'blue-40', 'blue-50', 'blue-60', 'sky-80']), {
    round: 3.0,
    steps: [1, 2, 3],
    gain: 2.2,
  });
  const outline = (inset) => {
    const pts = [];
    pts.push([3 + inset, 1 + inset], [27 - inset, 1 + inset], [27 - inset, 12]);
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push([27 - inset - t * (12 - inset), 12 + t * (14 - inset * 1.4)]);
    }
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push([15 - t * (12 - inset), 26 - inset * 1.4 - t * (14 - inset * 1.4)]);
    }
    return pts;
  };
  hi.poly(rim, outline(0));
  hi.poly(blue, outline(1.6));
  S.hi(hi, cx - 15, y0);
  // umbrella on the shield, drawn pixel by pixel
  const u = ['neutral-60', 'neutral-87', 'paper-99'];
  S.rows(
    cx - 8,
    y0 + 6,
    [
      '.......cc.......',
      '.....cccccb.....',
      '...cccccccbbb...',
      '..ccccccccbbbb..',
      '.ccccccccbbbbbb.',
      'abaabaabbaabaaba',
      '.......a........',
      '.......a........',
      '.......a........',
      '.......a........',
      '.......a.a......',
      '........a.......',
    ],
    { a: u[0], b: u[1], c: u[2] },
  );
  // three drops held off by the umbrella
  for (const [dx, dy] of [
    [-10, 4],
    [9, 2],
    [-6, 1],
  ])
    S.set(cx + dx, y0 + 2 + dy, 'sky-80').set(cx + dx, y0 + 3 + dy, 'sky-60');
}

function noticeBoard(S, r, x0, y0) {
  const cork = ['brown-40', 'brown-50', 'brown-60', 'brown-70'];
  S.bevel(x0, y0, 28, 21, [r.wood[0], r.wood[2], r.wood[4]]);
  S.rect(x0 + 2, y0 + 2, 24, 17, cork[2]).checker(x0 + 2, y0 + 2, 24, 17, cork[1]);
  const notes = [
    [x0 + 3, y0 + 3, 9, 7, r.paper, r.red[3]],
    [
      x0 + 14,
      y0 + 3,
      10,
      6,
      ['yellow-50', 'yellow-70', 'yellow-80', 'yellow-90', 'yellow-95'],
      r.green[3],
    ],
    [
      x0 + 5,
      y0 + 11,
      8,
      7,
      ['yellow-50', 'yellow-70', 'yellow-80', 'yellow-90', 'yellow-95'],
      'blue-50',
    ],
    [x0 + 15, y0 + 10, 9, 8, r.paper, r.red[3]],
  ];
  for (const [x, y, w, h, pr, pin] of notes) {
    S.rect(x + 1, y + 1, w, h, cork[0]);
    S.rect(x, y, w, h, pr[4])
      .vl(x + w - 1, y, h, pr[2])
      .hl(x, y + h - 1, w, pr[2]);
    for (let j = y + 2; j < y + h - 1; j += 2) S.hl(x + 1, j, w - 3 - (j % 3), pr[1]);
    S.set(x + Math.floor(w / 2), y, pin);
  }
  // a tick on one motion: passed
  S.set(x0 + 19, y0 + 15, r.green[2])
    .set(x0 + 20, y0 + 16, r.green[2])
    .set(x0 + 21, y0 + 15, r.green[2])
    .set(x0 + 22, y0 + 14, r.green[2]);
}

function umbrellaStand(S, r, x0, y0) {
  // three closed umbrellas, red, blue, yellow, hooked handles on top
  const cols = [
    r.red,
    ['blue-20', 'blue-40', 'blue-50', 'blue-60', 'blue-80'],
    ['orange-40', 'yellow-50', 'yellow-70', 'yellow-80', 'yellow-90'],
  ];
  cols.forEach((c, k) => {
    const x = x0 + 1 + k * 3,
      top = y0 + 1 + (k % 2) * 2;
    S.vl(x, top + 3, 9, c[2])
      .vl(x + 1, top + 4, 7, c[1])
      .set(x, top + 3, c[3]);
    S.set(x, top + 2, r.wood[3])
      .set(x, top + 1, r.wood[3])
      .set(x + 1, top, r.wood[3])
      .set(x + 2, top + 1, r.wood[2]);
  });
  // brass stand
  S.rect(x0, y0 + 9, 10, 6, r.gold[1])
    .hl(x0, y0 + 9, 10, r.gold[3])
    .vl(x0, y0 + 9, 6, r.gold[2])
    .vl(x0 + 9, y0 + 9, 6, r.gold[0]);
  S.hl(x0, y0 + 11, 10, r.gold[2]);
}

function fundChest(S, r, x0, y0) {
  // a wooden chest with iron bands, lid open, coins inside
  S.checker(x0 + 1, y0 + 10, 25, 1, r.wood[0]);
  S.rect(x0, y0 - 3, 24, 3, r.wood[1]).hl(x0, y0 - 3, 24, r.wood[3]);
  S.rect(x0 + 1, y0 - 1, 22, 2, r.gold[2])
    .hl(x0 + 2, y0 - 2, 6, r.gold[3])
    .hl(x0 + 12, y0 - 2, 7, r.gold[3])
    .set(x0 + 5, y0 - 3, r.gold[4])
    .set(x0 + 15, y0 - 3, r.gold[4]);
  S.bevel(x0, y0, 24, 10, [r.wood[0], r.wood[2], r.wood[3]]);
  for (const x of [x0 + 3, x0 + 20]) S.vl(x, y0, 10, r.steel[1]).vl(x + 1, y0, 10, r.steel[3]);
  S.rect(x0 + 10, y0 + 3, 4, 4, r.gold[2])
    .set(x0 + 10, y0 + 3, r.gold[4])
    .set(x0 + 12, y0 + 5, r.ink);
}

function ballotBox(S, r, x0, y0) {
  // small table
  S.hl(x0 - 2, y0 + 5, 26, r.wood[4]).hl(x0 - 2, y0 + 6, 26, r.wood[1]);
  for (const x of [x0, x0 + 20]) S.vl(x, y0 + 7, 7, r.wood[1]).vl(x + 1, y0 + 7, 7, r.wood[0]);
  // the box with a slot and a ballot going in
  S.bevel(x0 + 5, y0 - 3, 12, 8, [r.wood[0], r.wood[3], r.wood[4]]);
  S.hl(x0 + 8, y0 - 3, 6, r.ink);
  S.rect(x0 + 9, y0 - 7, 4, 4, r.paper[4])
    .vl(x0 + 12, y0 - 7, 4, r.paper[2])
    .hl(x0 + 10, y0 - 6, 2, r.paper[1]);
  S.rect(x0 + 9, y0 + 1, 4, 2, r.red[2]).set(x0 + 9, y0 + 1, r.red[3]);
}
