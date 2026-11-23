// Race track: the view across the course to the grandstand (one picture, right aligned so the
// finish post sits over the finish line), a turf strip for each lane with mowing stripes, the
// starting gate stall drawn over a horse at the start, and a dust puff behind a running horse.
// 1 art pixel = 1 CSS pixel, the same as the 48x32 race horse. Light theme = day, dark = night
// under floodlights. One light, from the top left.
import { P } from '../lib/env.js';
import { C, R, pick, snap, fill, colsOf } from './kit.js';

export const STAND_W = 360,
  STAND_H = 44,
  LANE_W = 48,
  LANE_H = 36;

const pal = (theme) => {
  const day = theme === 'light';
  return {
    day,
    sky: day
      ? C(['sky-70', 'sky-80', 'sky-90', 'sky-95'])
      : C(['neutral-6', 'neutral-8', 'blue-10', 'indigo-20']),
    cloud: day ? C(['sky-90', 'paper-96', 'paper-99']) : C(['neutral-8', 'blue-10', 'indigo-20']),
    star: day ? null : C(['yellow-90', 'paper-96']),
    tree: day
      ? R(['teal-30', 'green-40', 'green-50', 'lime-60'])
      : R(['neutral-7', 'teal-10', 'teal-20', 'green-20']),
    bark: day ? R(['brown-20', 'brown-30']) : R(['neutral-6', 'neutral-8']),
    concrete: day
      ? C(['neutral-50', 'neutral-65', 'neutral-80', 'paper-90', 'paper-96'])
      : C(['neutral-12', 'neutral-20', 'neutral-30', 'neutral-50', 'neutral-65']),
    roof: day
      ? C(['blue-20', 'blue-30', 'blue-40', 'sky-60'])
      : C(['neutral-4', 'neutral-7', 'blue-10', 'blue-20']),
    lamp: day ? C(['paper-90', 'paper-96']) : C(['yellow-80', 'yellow-95']),
    seat: day ? C(['blue-30', 'blue-40']) : C(['blue-10', 'blue-20']),
    shirts: day
      ? C([
          'red-40',
          'blue-40',
          'yellow-70',
          'paper-90',
          'neutral-30',
          'paper-96',
          'sky-50',
          'neutral-50',
          'orange-50',
          'neutral-24',
        ])
      : C([
          'red-30',
          'blue-30',
          'yellow-60',
          'neutral-65',
          'neutral-17',
          'paper-87',
          'sky-40',
          'neutral-35',
          'orange-40',
          'neutral-12',
        ]),
    skin: day
      ? C(['orange-80', 'brown-60', 'orange-70', 'brown-70'])
      : C(['orange-70', 'brown-50', 'orange-60', 'brown-60']),
    hair: day
      ? C(['neutral-12', 'brown-20', 'neutral-30'])
      : C(['neutral-6', 'brown-10', 'neutral-20']),
    board: day
      ? C(['neutral-10', 'neutral-17', 'neutral-25'])
      : C(['neutral-4', 'neutral-10', 'neutral-17']),
    bulbs: day ? C(['yellow-70', 'orange-60']) : C(['yellow-90', 'orange-70']),
    rail: day
      ? C(['neutral-65', 'paper-96', 'paper-99'])
      : C(['neutral-35', 'neutral-80', 'paper-96']),
    turf: day
      ? C(['teal-30', 'green-40', 'green-50', 'lime-60', 'lime-70'])
      : C(['teal-10', 'green-20', 'green-30', 'green-40', 'lime-50']),
    hedge: day ? C(['teal-20', 'green-30', 'green-40']) : C(['neutral-6', 'teal-10', 'teal-20']),
    post: day
      ? C(['neutral-65', 'paper-96', 'paper-99'])
      : C(['neutral-50', 'neutral-87', 'paper-99']),
    disc: day ? C(['red-30', 'red-50', 'red-60']) : C(['red-30', 'red-50', 'red-60']),
    gate: day
      ? C(['green-20', 'green-40', 'green-60', 'lime-80'])
      : C(['teal-10', 'green-30', 'green-50', 'lime-70']),
    pad: day ? C(['blue-30', 'blue-50', 'sky-60']) : C(['blue-20', 'blue-40', 'blue-50']),
    dust: day
      ? C(['brown-60', 'brown-80', 'paper-90', 'paper-96'])
      : C(['brown-50', 'brown-70', 'brown-80', 'paper-87']),
  };
};

/** A cumulus: `n` round puffs on a flat base at `cy`, shaded per puff from the top left. */
function puffs(b, cx, cy, n, ramp, seed) {
  const r = P.rng(seed);
  const list = [];
  for (let i = 0; i < n; i++) {
    const rad = 2.5 + r() * 2.5 + (i === Math.floor(n / 2) ? 1.5 : 0);
    list.push([cx + (i - (n - 1) / 2) * 4.5 + r() * 2, cy - rad * 0.4, rad]);
  }
  for (let y = cy - 9; y <= cy; y++)
    for (let x = cx - n * 4; x <= cx + n * 4; x++) {
      let best = null;
      for (const q of list) if (Math.hypot(x - q[0], y - q[1]) <= q[2]) best = q;
      if (!best) continue;
      const lit = (best[0] - x + (best[1] - y)) / (best[2] * 1.6);
      b.pset(x, y, pick(ramp, 0.55 + lit * 0.7 - (y > cy - 2 ? 0.3 : 0), x, y, 0.2));
    }
}

/** Turf value at a pixel: mowing stripes 24 px wide, small blade texture, darker at the bottom. */
function turfAt(p, x, y, y0, h) {
  const stripe = Math.floor(x / 24) % 2 === 0;
  const blade = P.fbm(x * 0.12, y * 0.7, 2, 7) - 0.5;
  const depth = (y - y0) / h; // lighter far, darker near
  const v = (stripe ? 0.52 : 0.33) + blade * 0.16 - depth * 0.04;
  return pick(p.turf, v, x, y, 0.12);
}

/**
 * Turf tile for the lanes, LANE_W by 8, repeating both ways. Mowing stripes run along the course:
 * odd lanes take the light tile, even lanes the dark one.
 */
export function lane(theme, light = true) {
  const p = pal(theme);
  const b = new P.Buf(LANE_W, 8);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < LANE_W; x++) {
      const grain = P.fbm((x % LANE_W) * 0.16, y * 0.9, 2, 7) - 0.5;
      const v = (light ? 0.55 : 0.35) + grain * 0.32;
      b.pset(x, y, pick(p.turf, v, x, y, 0.12));
    }
  return b;
}
export const laneDark = (theme) => lane(theme, false);

/** Inner rail along the bottom of the track: white rail on posts, turf under it. 48 by 10, tiles. */
export function innerRail(theme) {
  const p = pal(theme);
  const b = new P.Buf(LANE_W, 10);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < LANE_W; x++) b.pset(x, y, pick(p.turf, 0.4 - y * 0.03, x, y, 0.12));
  for (let x = 0; x < LANE_W; x++) {
    b.pset(x, 2, p.rail[2]);
    b.pset(x, 3, p.rail[1]);
    b.pset(x, 4, p.rail[0]);
    if (x % 8 === 0) for (let y = 5; y < 9; y++) b.pset(x, y, p.rail[1]);
    if (x % 8 === 1) for (let y = 5; y < 9; y++) b.pset(x, y, p.rail[0]);
    if (x % 8 === 2) for (let y = 6; y < 9; y++) b.pset(x, y, p.turf[0]);
  }
  return b;
}

/** The view to the grandstand. */
export function stand(theme) {
  const p = pal(theme);
  const W = STAND_W,
    H = STAND_H;
  const b = new P.Buf(W, H);
  const rnd = P.rng(17);
  // sky
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) b.pset(x, y, pick(p.sky, y / 30, x, y, 0.3));
  // a few flat based clouds, lit from the top left (by night the same clouds, dark)
  for (const [cx, cy, n] of [
    [40, 9, 5],
    [205, 5, 4],
    [292, 10, 3],
  ])
    puffs(b, cx, cy, n, p.cloud, 40 + cx);
  const sr = P.rng(23);
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(sr() * W),
      y = Math.floor(sr() * 18),
      k = sr() < 0.7 ? 0 : 1;
    if (!p.day && (b.get(x, y) === p.sky[0] || b.get(x, y) === p.sky[1])) b.pset(x, y, p.star[k]);
  }
  // far trees on the left, behind the tote board
  for (let i = 0; i < 9; i++) {
    const x = 6 + i * 17 + rnd() * 6;
    P.tree(b, {
      x,
      base: 35,
      h: 9 + rnd() * 5,
      rx: 8 + rnd() * 3,
      ry: 6 + rnd() * 2,
      cols: p.tree,
      bark: p.bark,
      seed: 30 + i,
      trunk: 1,
      clumps: 30,
      clumpR: [2, 4],
    });
  }
  // tote board: two legs, a dark panel with lamp dots
  const bx0 = 64,
    bx1 = 112,
    by0 = 13,
    by1 = 27;
  for (const lx of [bx0 + 6, bx1 - 7])
    for (let y = by1; y < 36; y++) {
      b.pset(lx, y, p.concrete[2]);
      b.pset(lx + 1, y, p.concrete[0]);
    }
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const edge = y === by0 || x === bx0 ? 2 : y === by1 || x === bx1 ? 0 : 1;
      b.pset(x, y, p.board[edge]);
    }
  // lamp digits: three rows of small blocks
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 11; col++) {
      if (P.hash(col, row, 9) < 0.25) continue;
      const x = bx0 + 3 + col * 4,
        y = by0 + 3 + row * 4;
      b.pset(x, y, p.bulbs[0]);
      b.pset(x + 1, y, p.bulbs[0]);
      b.pset(x, y + 1, p.bulbs[1]);
      b.pset(x + 1, y + 1, p.bulbs[0]);
    }
  // grandstand
  const sx0 = 150,
    sx1 = 326;
  // back wall
  for (let y = 9; y < 34; y++) for (let x = sx0; x < sx1; x++) b.pset(x, y, p.concrete[1]);
  // tiers of seats with the crowd: each person is 2 px wide (head, shirt, shirt), each tier
  // ends in a concrete step in shade with a lit edge
  for (let t = 0; t < 5; t++) {
    const y = 11 + t * 4;
    for (let x = sx0 + 2; x < sx1 - 2; x += 2) {
      const k = Math.floor(P.hash(x, t, 11) * 1000);
      const full = P.hash(x, t, 3) < 0.8 - t * 0.05;
      for (const dx of [0, 1]) {
        b.pset(x + dx, y + 3, p.concrete[dx ? 2 : 3]);
        if (!full) {
          b.pset(x + dx, y, p.concrete[1]);
          b.pset(x + dx, y + 1, p.seat[1]);
          b.pset(x + dx, y + 2, p.seat[0]);
        }
      }
      if (!full) continue;
      const shirt = p.shirts[k % p.shirts.length];
      const skin = p.skin[(k >> 3) % p.skin.length];
      const hair = p.hair[(k >> 5) % p.hair.length];
      const cap = (k >> 7) % 5 === 0;
      b.pset(x, y, cap ? shirt : hair);
      b.pset(x + 1, y, skin);
      b.pset(x, y + 1, shirt);
      b.pset(x + 1, y + 1, shirt);
      b.pset(x, y + 2, shirt);
      b.pset(x + 1, y + 2, p.seat[0]);
    }
  }
  // roof: a slab with a lit front edge and shadow under it, on thin columns
  for (let x = sx0 - 4; x < sx1 + 4; x++) {
    b.pset(x, 4, p.roof[3]);
    b.pset(x, 5, p.roof[2]);
    b.pset(x, 6, p.roof[1]);
    b.pset(x, 7, p.roof[0]);
    b.pset(x, 8, p.roof[0]);
    if (x % 6 === 0) b.pset(x, 8, p.lamp[p.day ? 0 : 1]);
  }
  for (let x = sx0; x < sx1; x++) if (P.hash(x, 1, 2) < 0.5) b.pset(x, 9, p.roof[0]);
  for (let cx = sx0 + 4; cx < sx1; cx += 34)
    for (let y = 9; y < 34; y++) {
      b.pset(cx, y, p.concrete[4]);
      b.pset(cx + 1, y, p.concrete[2]);
    }
  // front wall with a hedge on top
  for (let x = sx0 - 4; x < sx1 + 4; x++) {
    b.pset(x, 31, p.hedge[2]);
    b.pset(x, 32, p.hedge[P.hash(x, 2, 4) < 0.5 ? 1 : 2]);
    b.pset(x, 33, p.hedge[1]);
    b.pset(x, 34, p.hedge[0]);
  }
  // floodlight towers at night (lamp heads), poles by day
  for (const lx of [142, 334]) {
    for (let y = 2; y < 35; y++) {
      b.pset(lx, y, p.concrete[3]);
      b.pset(lx + 1, y, p.concrete[1]);
    }
    for (let x = lx - 3; x <= lx + 4; x++) {
      b.pset(x, 1, p.concrete[2]);
      b.pset(x, 2, p.lamp[x & 1 ? 1 : 0]);
      b.pset(x, 3, p.concrete[0]);
    }
  }
  // turf in front of the stand, then the outer rail (white, posts every 6 px)
  for (let y = 35; y < H; y++) for (let x = 0; x < W; x++) b.pset(x, y, turfAt(p, x, y, 35, 9));
  for (let x = 0; x < W; x++) {
    b.pset(x, 36, p.rail[2]);
    b.pset(x, 37, p.rail[1]);
    if (x % 6 === 0) for (let y = 38; y < 42; y++) b.pset(x, y, p.rail[y < 39 ? 1 : 0]);
    if (x % 6 === 1) for (let y = 38; y < 42; y++) b.pset(x, y, p.turf[0]);
  }
  // finish post: a white pole with a round red and white sign, right over the finish line
  const fx = W - 4;
  for (let y = 8; y < H; y++) {
    b.pset(fx - 1, y, p.post[2]);
    b.pset(fx, y, p.post[1]);
    b.pset(fx + 1, y, p.post[0]);
  }
  for (let y = 0; y < 13; y++)
    for (let x = fx - 7; x <= fx + 7; x++) {
      const d = Math.hypot(x - fx, y - 6);
      if (d > 5.6) continue;
      const lit = (fx - x + (6 - y)) / 8;
      const c = d > 4 ? p.disc[lit > 0.2 ? 2 : lit < -0.4 ? 0 : 1] : p.post[lit > -0.3 ? 2 : 1];
      b.pset(x, y, c);
    }
  return snap(b, colsOf(p));
}

/** Starting gate stall, drawn over the horse at the start: a frame, a side rail and the front doors. */
export const GATE_W = 52;
export function gate(theme) {
  const p = pal(theme);
  const b = new P.Buf(GATE_W, LANE_H);
  const tube = (x, y, k) => b.pset(x, y, p.gate[k]);
  // top beam: round tube lit on top
  for (let x = 0; x < GATE_W; x++) {
    tube(x, 0, 3);
    tube(x, 1, 2);
    tube(x, 2, 1);
    tube(x, 3, 0);
  }
  // back post and front post
  for (let y = 4; y < LANE_H; y++) {
    tube(0, y, 2);
    tube(1, y, 1);
    tube(2, y, 0);
  }
  // front doors: two leaves of bars, padded at the top
  for (let y = 4; y < LANE_H - 1; y++)
    for (let x = 45; x < GATE_W; x++) {
      if (x === 45 || x === GATE_W - 1) b.pset(x, y, p.gate[x === 45 ? 2 : 0]);
      else if (y < 9) b.pset(x, y, p.pad[y === 4 ? 2 : y === 8 ? 0 : 1]);
      else if (y % 3 === 0) b.pset(x, y, p.gate[1]);
    }
  // side rail at the height of the horse's elbow, with a padded cover
  for (let x = 3; x < 45; x++) {
    b.pset(x, 17, p.pad[2]);
    b.pset(x, 18, p.pad[1]);
    b.pset(x, 19, p.pad[0]);
  }
  return b;
}

/** Dust puff: 4 frames, 12 by 8, growing and thinning out. */
export const DUST_W = 16,
  DUST_H = 10;
export function dust(theme) {
  const p = pal(theme);
  const frames = [];
  const blobs = [
    [12, 7, 2.5],
    [8, 6, 3.2],
    [4, 7, 2.6],
  ];
  for (let f = 0; f < 4; f++) {
    const b = new P.Buf(DUST_W, DUST_H);
    const grow = 0.7 + f * 0.25,
      thin = f / 3;
    blobs.forEach(([cx, cy, r], i) => {
      const X = cx - f * (i === 2 ? 1 : 0.5),
        Y = cy - f * 0.4;
      for (let y = 0; y < DUST_H; y++)
        for (let x = 0; x < DUST_W; x++) {
          const d = Math.hypot(x - X, (y - Y) * 1.2) / (r * grow);
          if (d > 1) continue;
          if (P.bt(x + f, y) < thin * 0.85 + d * 0.3 - 0.05) continue;
          const lit = (X - x + (Y - y)) / (r * 2);
          b.pset(x, y, pick(p.dust, 0.45 + lit * 0.6 - d * 0.2 + (1 - thin) * 0.1, x, y, 0.2));
        }
    });
    frames.push(b);
  }
  return frames;
}

export { pal as racePalette, fill };
