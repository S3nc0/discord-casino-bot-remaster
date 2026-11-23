// Underground arena: a sand pit under a stone vault, torches in iron sconces, a crowd behind bars
// on the upper tier, red banners. 2 CSS px per art pixel. The same picture in both themes
// (it is underground); torch flames have three frames. One light, from the top left, plus the
// warm torch light.
import { P } from '../lib/env.js';
import { C, pick, snap, colsOf } from './kit.js';

export const PIT_W = 176,
  PIT_H = 72,
  PIT_FLOOR = 66; // fighters stand on this row
export const PIT_SLOTS = { left: 70, right: 106 }; // fighters' hip x

const p = {
  stone: C(['neutral-6', 'neutral-12', 'brown-20', 'brown-30', 'brown-40', 'brown-50']),
  mortar: C(['neutral-4']),
  sand: C(['brown-30', 'brown-50', 'brown-60', 'orange-70', 'orange-80', 'yellow-90']),
  stain: C(['red-20', 'brown-20']),
  wood: C(['brown-10', 'brown-20', 'brown-40', 'brown-60']),
  iron: C(['neutral-4', 'neutral-12', 'neutral-25', 'neutral-40']),
  crowd: C(['neutral-4', 'neutral-8', 'neutral-12']),
  faces: C(['brown-30', 'brown-50', 'orange-50']),
  banner: C(['red-10', 'red-30', 'red-40', 'red-50']),
  gold: C(['orange-40', 'yellow-60', 'yellow-80']),
  flame: C(['red-40', 'orange-50', 'orange-70', 'yellow-90', 'paper-99']),
  dark: C(['neutral-4']),
};

/** Warm light from the torches and a pool of light on the middle of the pit. */
const TORCHES = [
  [22, 24],
  [88, 20],
  [154, 24],
];
function warm(x, y) {
  let w = 0;
  for (const [tx, ty] of TORCHES) w += Math.max(0, 1 - Math.hypot(x - tx, (y - ty) * 1.2) / 34);
  return Math.min(1, w);
}

function flame(b, x, y, f) {
  // 5 by 7 tongue, swaying one pixel between frames
  const sway = [0, 1, 0][f],
    tall = [7, 6, 8][f];
  for (let j = 0; j < tall; j++) {
    const half = Math.max(0, 2.2 - (j / tall) * 2.4 + (j < 2 ? 0 : 0));
    const cx = x + (j > tall / 2 ? sway : 0);
    for (let i = -Math.ceil(half); i <= Math.ceil(half); i++) {
      const d = Math.abs(i) / Math.max(0.6, half);
      if (d > 1.05) continue;
      const v = 1 - j / tall - d * 0.45;
      b.pset(Math.round(cx + i), y - j, p.flame[Math.max(0, Math.min(4, Math.floor(v * 5.2)))]);
    }
  }
}

/** Frame `f` (0..2) of the pit. */
export function pit(f = 0) {
  const b = new P.Buf(PIT_W, PIT_H);
  // vault and back wall: stone blocks lit by the torches
  const h = P.rockHeight({ sx: 18, sy: 9, seed: 4, crack: 0.12, tilt: 1.1, warp: 4 });
  P.surface(b, {
    height: h,
    cols: p.stone,
    relief: 1.6,
    shade: (x, y) => 0.6 + warm(x, y) * 0.55 - (y < 8 ? 0.15 : 0),
    y0: 0,
    y1: 52,
  });
  // upper tier: dark gap with the crowd, iron bars in front
  const ty0 = 3,
    ty1 = 16;
  for (let y = ty0; y < ty1; y++) for (let x = 0; x < PIT_W; x++) b.pset(x, y, p.crowd[0]);
  for (let x = 1; x < PIT_W - 2; x += 3) {
    const k = Math.floor(P.hash(x, 1, 7) * 100);
    const hy = ty0 + 3 + (k % 3);
    // head and shoulders, faces catching the torch light
    const lit = warm(x, hy) > 0.25;
    b.pset(x, hy, lit ? p.faces[k % 3] : p.crowd[2]);
    b.pset(x + 1, hy, p.crowd[2]);
    for (let y = hy + 1; y < ty1; y++) {
      b.pset(x - 1, y, p.crowd[1]);
      b.pset(x, y, p.crowd[2]);
      b.pset(x + 1, y, p.crowd[1]);
    }
    // a raised fist now and then
    if (k % 7 === 0) {
      b.pset(x + 1, hy - 2, lit ? p.faces[1] : p.crowd[2]);
      b.pset(x + 1, hy - 1, p.crowd[2]);
    }
  }
  for (let x = 0; x < PIT_W; x++) {
    b.pset(x, ty0 - 1, p.iron[2]);
    b.pset(x, ty1, p.iron[3]);
    b.pset(x, ty1 + 1, p.iron[1]);
    if (x % 5 === 0) for (let y = ty0; y < ty1; y++) b.pset(x, y, p.iron[y === ty0 ? 3 : 2]);
  }
  // banners hanging from the rail
  for (const bx of [30, 134]) {
    for (let y = ty1 + 2; y < ty1 + 22; y++)
      for (let x = bx; x < bx + 12; x++) {
        const tail = y > ty1 + 17 && Math.abs(x - bx - 5.5) < (y - ty1 - 17) * 1.4;
        if (tail) continue;
        const u = (x - bx) / 11;
        b.pset(
          x,
          y,
          pick(p.banner, 0.8 - u * 0.6 + (Math.sin(x * 1.3) > 0.7 ? 0.1 : 0), x, y, 0.15),
        );
      }
    for (let x = bx; x < bx + 12; x++) b.pset(x, ty1 + 2, p.iron[2]);
    // a gold coin mark on each
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++)
        if (Math.hypot(x, y) < 2.6)
          b.pset(
            bx + 6 + x,
            ty1 + 9 + y,
            p.gold[Math.hypot(x + 1, y + 1) < 1.5 ? 2 : Math.hypot(x, y) > 1.8 ? 0 : 1],
          );
  }
  // torches: iron sconce and flame
  for (const [tx, ty] of TORCHES) {
    for (let y = ty; y < ty + 6; y++) {
      b.pset(tx, y, p.wood[y === ty ? 3 : 2]);
      b.pset(tx + 1, y, p.wood[1]);
    }
    for (let x = tx - 2; x <= tx + 3; x++) b.pset(x, ty, p.iron[x < tx ? 3 : 2]);
    b.pset(tx - 2, ty - 1, p.iron[2]);
    b.pset(tx + 3, ty - 1, p.iron[1]);
    flame(b, tx, ty - 1, (f + tx) % 3);
  }
  // wooden barrier around the pit, lit along its top
  const wy = 50;
  for (let y = wy; y < 56; y++)
    for (let x = 0; x < PIT_W; x++) {
      const k = (x + 3) % 16;
      const v =
        y === wy
          ? 0.95
          : 0.55 -
            (y - wy) * 0.07 +
            (k === 0 ? -0.4 : 0) +
            (P.fbm(x * 0.2, y * 0.8, 2, 9) - 0.5) * 0.3;
      b.pset(x, y, pick(p.wood, v + warm(x, y) * 0.2, x, y, 0.12));
    }
  // sand floor: lighter in the middle, footprints and dark stains
  for (let y = 56; y < PIT_H; y++)
    for (let x = 0; x < PIT_W; x++) {
      const pool = 1 - Math.hypot((x - PIT_W / 2) / 90, (y - 64) / 14);
      const g = P.fbm(x * 0.25, y * 0.6, 3, 21) - 0.5;
      const v = 0.25 + pool * 0.45 + g * 0.3 - (y - 56) * 0.004 + (y === 56 ? -0.2 : 0);
      b.pset(x, y, pick(p.sand, v, x, y, 0.18));
    }
  for (const [sx, sy, r] of [
    [30, 63, 3],
    [140, 68, 2.4],
  ])
    for (let y = sy - 2; y <= sy + 2; y++)
      for (let x = sx - 4; x <= sx + 4; x++)
        if (Math.hypot((x - sx) / r, (y - sy) / (r * 0.45)) < 1 && P.bt(x, y) < 0.7)
          b.pset(x, y, p.stain[(x + y) & 1]);
  return snap(b, colsOf(p));
}

export const pitFrames = () => [0, 1, 2].map(pit);
