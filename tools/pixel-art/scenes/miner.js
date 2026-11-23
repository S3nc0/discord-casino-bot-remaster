// Miner swinging a pickaxe: four poses taken from Eadweard Muybridge, Animal Locomotion plate 385
// "Using a pick" (1887, public domain, see CREDITS.md), frames 4 (lift), 6 (raised), 8 (down
// swing) and 10 (strike). Joints are measured on the plate (units of a 126 wide crop of one
// frame, ground at y = 165; the man faces left there). The body is lit capsules (core P.solid),
// mirrored before lighting so it faces the rock on the right with the light still top left.
import { P } from '../lib/env.js';
import { C, T } from './kit.js';

export const MW = 52,
  MH = 54;
const S = 0.33;

const POSES = {
  lift: {
    head: [70, 66],
    neck: [74, 78],
    hip: [88, 118],
    shF: [74, 86],
    elF: [64, 104],
    haF: [56, 112],
    shB: [82, 86],
    elB: [80, 102],
    haB: [72, 96],
    hpF: [84, 122],
    knF: [80, 142],
    anF: [78, 162],
    toF: [70, 166],
    hpB: [92, 122],
    knB: [97, 142],
    anB: [100, 162],
    toB: [92, 166],
    stick: [
      [50, 118],
      [100, 58],
    ],
  },
  raised: {
    head: [62, 66],
    neck: [66, 78],
    hip: [84, 113],
    shF: [66, 86],
    elF: [56, 62],
    haF: [50, 46],
    shB: [72, 84],
    elB: [62, 58],
    haB: [56, 42],
    hpF: [80, 117],
    knF: [77, 139],
    anF: [74, 162],
    toF: [66, 166],
    hpB: [88, 117],
    knB: [95, 139],
    anB: [100, 162],
    toB: [92, 166],
    stick: [
      [46, 50],
      [110, 14],
    ],
  },
  down: {
    head: [56, 80],
    neck: [63, 90],
    hip: [88, 108],
    shF: [66, 96],
    elF: [50, 80],
    haF: [40, 64],
    shB: [72, 94],
    elB: [56, 76],
    haB: [46, 60],
    hpF: [84, 112],
    knF: [80, 136],
    anF: [78, 162],
    toF: [70, 166],
    hpB: [92, 112],
    knB: [97, 136],
    anB: [100, 162],
    toB: [92, 166],
    stick: [
      [44, 62],
      [22, 24],
    ],
  },
  strike: {
    head: [38, 106],
    neck: [47, 104],
    hip: [82, 100],
    shF: [52, 108],
    elF: [40, 124],
    haF: [32, 140],
    shB: [58, 106],
    elB: [46, 121],
    haB: [37, 134],
    hpF: [78, 106],
    knF: [72, 132],
    anF: [70, 162],
    toF: [62, 166],
    hpB: [86, 106],
    knB: [91, 132],
    anB: [94, 162],
    toB: [86, 166],
    stick: [
      [38, 132],
      [12, 160],
    ],
  },
};
export const SWING = ['lift', 'raised', 'down', 'strike'];

const R = {
  skin: C(['brown-40', 'orange-60', 'orange-70', 'orange-80', 'orange-90']),
  shirt: C(['blue-10', 'blue-30', 'blue-40', 'blue-50', 'sky-70']),
  pants: C(['brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-60']),
  boots: C(['neutral-4', 'neutral-10', 'neutral-17', 'neutral-25', 'neutral-40']),
  hat: C(['orange-40', 'yellow-60', 'yellow-70', 'yellow-80', 'yellow-95']),
  wood: C(['brown-20', 'brown-40', 'brown-60']),
  iron: C(['neutral-12', 'neutral-35', 'neutral-60', 'neutral-87']),
};

function joints(pose) {
  // mirror: the plate faces left, the game faces right
  const j = {};
  const hipX = POSES[pose].hip[0];
  const map = ([x, y]) => [20 - (x - hipX) * S, MH - 2 + (y - 165) * S];
  for (const [k, v] of Object.entries(POSES[pose])) j[k] = k === 'stick' ? v.map(map) : map(v);
  return j;
}

/** One pose of the miner, MW by MH, facing right. */
export function miner(pose) {
  const j = joints(pose);
  const b = new P.Buf(MW, MH);
  const L = [-0.55, -0.65, 0.52];
  const part = (prims, ramp, o = {}) =>
    P.solid(b, prims, ramp, { light: L, k: 0.6, ambient: 0.42, ...o });
  const cap = (a, c, ra, rb) => P.cap(j[a][0], j[a][1], j[c][0], j[c][1], ra, rb);
  const back = { dark: 0.8 };
  // pickaxe behind the front arm: handle and a curved iron head across its far end
  const [s0, s1] = j.stick;
  const dx = s1[0] - s0[0],
    dy = s1[1] - s0[1],
    len = Math.hypot(dx, dy),
    ux = dx / len,
    uy = dy / len;
  const handle = new Uint8Array(MW * MH);
  for (let t = 0; t <= 1; t += 1 / (len * 3)) {
    const x = Math.round(s0[0] + dx * t),
      y = Math.round(s0[1] + dy * t);
    if (x >= 0 && y >= 0 && x < MW && y < MH) handle[y * MW + x] = 1;
  }
  const pp = P.pixelPerfect(handle, MW, MH);
  // back leg, back arm
  part([cap('hpB', 'knB', 2.1, 1.8), cap('knB', 'anB', 1.7, 1.4)], R.pants, back);
  part([cap('anB', 'toB', 1.4, 1.2)], R.boots, back);
  part([cap('shB', 'elB', 1.5, 1.3), cap('elB', 'haB', 1.3, 1.1)], R.shirt, back);
  // trunk, hips
  const chest = [(j.shF[0] + j.shB[0]) / 2, (j.shF[1] + j.shB[1]) / 2 + 1];
  part([P.cap(chest[0], chest[1], j.hip[0], j.hip[1] - 2, 3.6, 3.1)], R.shirt);
  part(
    [P.cap(j.hip[0], j.hip[1] - 1, j.hpF[0], j.hpF[1], 3, 2.3), cap('hpB', 'hpF', 2.4, 2.4)],
    R.pants,
  );
  // belt
  for (let k = -3; k <= 3; k++)
    b.pset(
      Math.round(j.hip[0] + k * 0.9),
      Math.round(j.hip[1] - 2.5),
      T(k === 0 ? 'yellow-70' : 'brown-10'),
    );
  // handle and iron head
  for (let i = 0; i < pp.length; i++)
    if (pp[i]) b.px[i] = R.wood[(i % MW) + Math.floor(i / MW) * 0 < 0 ? 0 : 1];
  const tip = s1;
  const nx = -uy,
    ny = ux; // across the handle
  for (let k = -5; k <= 5; k++) {
    const bend = (k * k) / 12; // curve back toward the handle
    const x = tip[0] + nx * k * 0.95 - ux * bend,
      y = tip[1] + ny * k * 0.95 - uy * bend;
    b.pset(Math.round(x), Math.round(y), R.iron[Math.abs(k) > 3 ? 1 : 2]);
    b.pset(Math.round(x - ux), Math.round(y - uy), R.iron[Math.abs(k) > 3 ? 0 : 1]);
  }
  b.pset(Math.round(tip[0]), Math.round(tip[1]), R.iron[3]);
  // front leg and arm
  part([cap('hpF', 'knF', 2.2, 1.9), cap('knF', 'anF', 1.8, 1.4)], R.pants);
  part([cap('anF', 'toF', 1.5, 1.3)], R.boots);
  part([cap('shF', 'elF', 1.6, 1.4), cap('elF', 'haF', 1.4, 1.2)], R.shirt);
  part([P.ell(j.haF[0], j.haF[1], 1.3, 1.3)], R.skin);
  part([P.ell(j.haB[0], j.haB[1], 1.2, 1.2)], R.skin, back);
  // head and helmet with a lamp
  part([cap('neck', 'head', 1.3, 1.2)], R.skin);
  const [hx, hy] = j.head;
  part([P.ell(hx, hy, 2.9, 3.2)], R.skin, { ambient: 0.62 });
  // the helmet brim faces the way the head looks (toward the right, down when bent)
  const lean = Math.atan2(j.head[1] - j.neck[1], j.head[0] - j.neck[0]);
  part([P.ell(hx - Math.cos(lean) * 0.6, hy - 1.6, 3.4, 2.2, 0)], R.hat, { gloss: 0.5 });
  for (let k = -4; k <= 4; k++)
    b.pset(Math.round(hx + k * 0.9), Math.round(hy - 0.4), R.hat[k < 0 ? 2 : 1]);
  b.pset(Math.round(hx + 3), Math.round(hy - 1.8), T('paper-99'));
  b.pset(Math.round(hx + 3), Math.round(hy - 2.8), T('yellow-90'));
  b.pset(Math.round(hx + 1.5), Math.round(hy + 0.6), T('neutral-4'));
  return b;
}

/** Selective outline in the scene's darkest rock colour, lit side a step lighter. */
export function outlinedMiner(buf) {
  const lit = T('neutral-30'),
    shade = T('neutral-4');
  const o = new P.Buf(buf.w, buf.h);
  o.px.set(buf.px);
  const at = (x, y) => x >= 0 && y >= 0 && x < buf.w && y < buf.h && buf.px[y * buf.w + x] >>> 24;
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++) {
      if (at(x, y)) continue;
      const r = at(x + 1, y),
        d = at(x, y + 1),
        l = at(x - 1, y),
        u = at(x, y - 1);
      if (!(r || d || l || u)) continue;
      o.px[y * buf.w + x] = (r || d) && !(l || u) ? lit : shade;
    }
  return o;
}
