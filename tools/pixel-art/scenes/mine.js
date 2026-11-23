// Mine: a timbered tunnel going back into the dark on the left, rails with an ore cart, a hanging
// lantern, and a rock face with ore veins on the right where the miner works. 2 CSS px per art
// pixel, the same picture in both themes (underground). One light from the top left, plus the
// lantern.
import { P } from '../lib/env.js';
import { C, T, pick, snap, colsOf } from './kit.js';

export const MINE_W = 176,
  MINE_H = 72,
  MINE_FLOOR = 64; // the miner's feet
export const MINER_X = 86; // left edge of the miner sprite
export const FACE_X = 136; // where the rock face starts (at the floor)

const p = {
  rock: C(['neutral-6', 'neutral-10', 'brown-10', 'brown-20', 'brown-30']),
  face: C(['neutral-6', 'brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-50']),
  dark: C(['neutral-4', 'neutral-6']),
  wood: C(['brown-10', 'brown-20', 'brown-40', 'brown-50', 'brown-60']),
  iron: C(['neutral-6', 'neutral-17', 'neutral-35', 'neutral-60', 'neutral-87']),
  rail: C(['neutral-12', 'neutral-40', 'neutral-70']),
  gold: C(['orange-40', 'yellow-70', 'yellow-90']),
  copper: C(['red-30', 'orange-50', 'teal-50']),
  gem: C(['sky-60', 'sky-90']),
  glow: C(['yellow-80', 'yellow-95']),
  coal: C(['neutral-4', 'neutral-12', 'neutral-30']),
};
const LAMP = [64, 20];
const lampLight = (x, y) => Math.max(0, 1 - Math.hypot(x - LAMP[0], (y - LAMP[1]) * 1.1) / 70);

function timberPost(b, x0, y0, y1) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x0 + 4; x++) {
      const u = (x - x0) / 3;
      b.pset(
        x,
        y,
        pick(
          p.wood,
          0.25 +
            (0.75 - u * 0.6) * (0.35 + lampLight(x, y) * 0.9) +
            (P.fbm(x * 0.6, y * 0.15, 2, 5) - 0.5) * 0.2,
          x,
          y,
          0.1,
        ),
      );
    }
}
function timberBeam(b, x0, x1, y0) {
  for (let y = y0; y < y0 + 4; y++)
    for (let x = x0; x < x1; x++) {
      const u = (y - y0) / 3;
      b.pset(
        x,
        y,
        pick(
          p.wood,
          0.25 +
            (0.8 - u * 0.6) * (0.35 + lampLight(x, y) * 0.9) +
            (P.fbm(x * 0.15, y * 0.6, 2, 6) - 0.5) * 0.2,
          x,
          y,
          0.1,
        ),
      );
    }
}

/** Ore cart on the rails, wheels resting on `rail` (row of the rail top). */
function cart(b, x0, rail) {
  const w = 30,
    top = rail - 16;
  // load of ore heaped above the rim
  for (let y = top - 5; y < top + 2; y++)
    for (let x = x0 + 2; x < x0 + w - 2; x++) {
      const hump = top - 4 + Math.abs(x - x0 - w / 2) * 0.28 + Math.sin(x * 1.7) * 0.8;
      if (y < hump) continue;
      const lump = P.voronoi(x / 2.6, y / 2.2, 7);
      const lit = 0.55 - lump.r * 0.3 + (lump.edge < 0.12 ? -0.4 : 0) - (y - top + 5) * 0.03;
      const kind = P.hash(lump.cx, lump.cy, 3);
      const ramp = kind < 0.12 ? p.gold : kind < 0.22 ? p.copper : p.coal;
      b.pset(
        x,
        y,
        ramp === p.coal ? pick(p.coal, lit, x, y, 0.2) : ramp[lit > 0.45 ? 2 : lit > 0.25 ? 1 : 0],
      );
    }
  // iron tub, wider at the top
  for (let y = top; y < rail - 4; y++) {
    const inset = Math.round(((y - top) / (rail - 4 - top)) * 3);
    for (let x = x0 + inset; x < x0 + w - inset; x++) {
      const rim = y === top;
      const rib = (x - x0) % 9 === 4;
      const u = (x - x0) / w;
      let v = 0.7 - u * 0.45 - ((y - top) / 12) * 0.2 + (rim ? 0.25 : 0) + (rib ? 0.15 : 0);
      if (x === x0 + inset || x === x0 + w - inset - 1) v -= 0.3;
      b.pset(x, y, pick(p.iron, v * (0.5 + lampLight(x, y) * 0.8), x, y, 0.15));
    }
  }
  // rivets
  for (let x = x0 + 3; x < x0 + w - 3; x += 4) b.pset(x, top + 2, p.iron[3]);
  // wheels: rim, spokes, hub
  for (const wx of [x0 + 7, x0 + w - 8])
    for (let y = rail - 6; y <= rail; y++)
      for (let x = wx - 4; x <= wx + 4; x++) {
        const d = Math.hypot(x - wx, y - (rail - 3));
        if (d > 3.6) continue;
        const spoke = Math.abs(x - wx) < 0.5 || Math.abs(y - (rail - 3)) < 0.5;
        b.pset(
          x,
          y,
          d > 2.6
            ? p.iron[x < wx && y < rail - 3 ? 3 : 1]
            : d < 1
              ? p.iron[4]
              : spoke
                ? p.iron[2]
                : p.dark[0],
        );
      }
}

/** Ore veins and sparkles in the rock face. */
function veins(b) {
  const spots = [
    [148, 26, 'gold'],
    [160, 40, 'copper'],
    [142, 48, 'gem'],
    [166, 18, 'gold'],
    [154, 56, 'copper'],
    [170, 50, 'gem'],
  ];
  for (const [x, y, k] of spots) {
    const r = p[k];
    const pts = [
      [0, 0, 2],
      [1, 0, 1],
      [-1, 1, 1],
      [0, 1, 0],
      [1, -1, 1],
      [2, 1, 0],
      [-1, -1, 0],
    ];
    for (const [dx, dy, s] of pts) b.pset(x + dx, y + dy, r[Math.min(r.length - 1, s)]);
    if (k !== 'copper') b.pset(x - 1, y - 2, r[r.length - 1]);
  }
}

/** The mine, frame `f` of the miner's swing (0..3) only changes the chips; the miner is a sprite. */
export function mine(chips = false) {
  const b = new P.Buf(MINE_W, MINE_H);
  // rock everywhere, lit by the lantern
  const h = P.rockHeight({ sx: 16, sy: 10, seed: 12, crack: 0.1, tilt: 1.2, warp: 6 });
  P.surface(b, {
    height: h,
    cols: p.rock,
    relief: 1.1,
    shade: (x, y) => 0.5 + lampLight(x, y) * 0.7,
  });
  // tunnel going back on the left: darker toward its middle
  for (let y = 12; y < MINE_FLOOR + 2; y++)
    for (let x = 0; x < 52; x++) {
      const d = Math.hypot((x - 22) / 30, (y - 40) / 30);
      if (d > 1) continue;
      b.pset(x, y, p.dark[d > 0.8 && P.bt(x, y) < (d - 0.8) * 4 ? 1 : 0]);
    }
  // timber set framing the tunnel, and another nearer
  timberPost(b, 2, 12, MINE_FLOOR + 2);
  timberPost(b, 44, 12, MINE_FLOOR + 2);
  timberBeam(b, 0, 52, 9);
  timberPost(b, 104, 6, MINE_FLOOR + 2);
  timberBeam(b, 56, 112, 4);
  // rock face on the right: a brighter, rougher block of rock leaning in
  const faceH = P.rockHeight({ sx: 9, sy: 7, seed: 33, crack: 0.14, tilt: 1.6, warp: 3 });
  P.surface(b, {
    height: faceH,
    cols: p.face,
    relief: 2,
    mask: (x, y) => x > FACE_X + (MINE_FLOOR - y) * 0.18 && y > 6,
    shade: () => 0.95,
  });
  veins(b);
  // floor: packed earth, rails with sleepers
  for (let y = MINE_FLOOR - 1; y < MINE_H; y++)
    for (let x = 0; x < MINE_W; x++) {
      const g = P.fbm(x * 0.3, y * 0.7, 2, 44) - 0.5;
      b.pset(
        x,
        y,
        pick(p.rock, 0.35 + g * 0.3 + lampLight(x, y) * 0.4 - (y - MINE_FLOOR) * 0.02, x, y, 0.15),
      );
    }
  const railY = 67;
  for (let x = 0; x < 120; x += 7)
    for (let y = railY + 1; y < railY + 4; y++)
      for (let k = 0; k < 4; k++) b.pset(x + k, y, p.wood[y === railY + 1 ? 2 : 1]);
  for (let x = 0; x < 120; x++) {
    b.pset(x, railY, p.rail[2]);
    b.pset(x, railY + 1, p.rail[1]);
  }
  // rubble at the foot of the face
  for (let i = 0; i < 14; i++) {
    const x = FACE_X - 8 + ((i * 29) % 18),
      y = MINE_FLOOR - 1 + ((i * 7) % 4);
    b.pset(x, y, p.face[3]);
    b.pset(x + 1, y, p.face[2]);
    b.pset(x, y + 1, p.face[1]);
  }
  cart(b, 10, railY);
  // hanging lantern on the near beam
  const [lx, ly] = LAMP;
  for (let y = 8; y < ly - 3; y++) b.pset(lx, y, p.iron[1]);
  for (let i = -2; i <= 2; i++) b.pset(lx + i, ly - 3, p.iron[i < 0 ? 3 : 2]);
  for (let j = -2; j <= 3; j++)
    for (let i = -2; i <= 2; i++)
      b.pset(
        lx + i,
        ly + j,
        Math.abs(i) === 2 ? p.iron[i < 0 ? 2 : 1] : p.glow[j < 2 && i <= 0 ? 1 : 0],
      );
  for (let i = -2; i <= 2; i++) b.pset(lx + i, ly + 4, p.iron[1]);
  // chips flying off the face when the pick strikes
  if (chips)
    for (const [dx, dy, k] of [
      [-3, -5, 3],
      [-6, -3, 2],
      [-2, -8, 4],
      [-8, -7, 3],
      [1, -4, 2],
      [-5, -10, 4],
    ])
      b.pset(FACE_X + dx, MINE_FLOOR - 6 + dy, p.face[k]);
  return snap(b, colsOf(p));
}
export { T };
