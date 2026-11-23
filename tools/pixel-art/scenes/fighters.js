// Underground arena fighters: one body built from lit capsules (core P.solid) in two poses taken
// from Eadweard Muybridge, Animal Locomotion plate 336 "Boxing" (1887, public domain, see
// CREDITS.md): frame 7 (guard, the idle frame) and frame 11 (straight punch, the attack frame).
// Joint positions are measured on the plate (units of a 200 wide crop of one frame, ground at
// y = 165). Each of the 16 fighters gets its own build, outfit colours and headgear. The body is
// lit from the top left in both facing directions, because the pose is mirrored before lighting.
import { P } from '../lib/env.js';
import { C, T } from './kit.js';

export const FW = 46,
  FH = 50;

// Joints on the plate. f = front side (nearer the opponent), b = back side.
const POSES = {
  idle: {
    head: [73, 22],
    neck: [70, 34],
    hip: [68, 88],
    shF: [80, 43],
    elF: [98, 54],
    fiF: [110, 30],
    shB: [60, 43],
    elB: [58, 62],
    fiB: [76, 44],
    hpF: [75, 92],
    knF: [95, 125],
    anF: [100, 159],
    toF: [109, 165],
    hpB: [61, 92],
    knB: [41, 125],
    anB: [24, 158],
    toB: [31, 165],
  },
  attack: {
    head: [86, 27],
    neck: [81, 39],
    hip: [72, 90],
    shF: [94, 43],
    elF: [120, 36],
    fiF: [146, 25],
    shB: [69, 45],
    elB: [72, 64],
    fiB: [87, 50],
    hpF: [80, 94],
    knF: [104, 122],
    anF: [119, 158],
    toF: [127, 165],
    hpB: [65, 94],
    knB: [50, 124],
    anB: [28, 155],
    toB: [34, 164],
  },
};

const S = 0.285; // art pixels per plate unit
/** Joints in sprite pixels: hips at x = 17 (facing right), ground at FH - 2. */
function joints(pose, flip) {
  const j = {};
  const hipX = POSES[pose].hip[0];
  for (const [k, [x, y]] of Object.entries(POSES[pose])) {
    let X = (x - hipX) * S;
    if (flip) X = -X;
    j[k] = [(flip ? FW - 17 : 17) + X, FH - 2 + (y - 165) * S];
  }
  return j;
}

/** Packed ramps for the fighter's materials. */
const M = (names) => C(names);
const SKIN = {
  light: ['brown-40', 'orange-60', 'orange-70', 'orange-80', 'orange-90'],
  tan: ['brown-20', 'brown-40', 'orange-50', 'orange-60', 'orange-80'],
  dark: ['brown-10', 'brown-20', 'brown-30', 'brown-50', 'brown-60'],
  pale: ['violet-40', 'neutral-70', 'paper-87', 'paper-96', 'paper-99'],
  green: ['teal-20', 'teal-40', 'green-60', 'lime-70', 'lime-80'],
  red: ['red-20', 'red-30', 'red-50', 'red-60', 'orange-70'],
};
const CLOTH = {
  black: ['neutral-4', 'neutral-10', 'neutral-17', 'neutral-25', 'neutral-35'],
  navy: ['neutral-4', 'blue-10', 'blue-20', 'blue-30', 'blue-40'],
  red: ['red-10', 'red-30', 'red-40', 'red-50', 'red-60'],
  orange: ['red-30', 'orange-40', 'orange-50', 'orange-60', 'yellow-80'],
  yellow: ['orange-40', 'yellow-60', 'yellow-70', 'yellow-80', 'yellow-95'],
  green: ['teal-10', 'teal-30', 'green-40', 'green-50', 'lime-70'],
  ice: ['blue-30', 'sky-50', 'sky-70', 'sky-80', 'sky-95'],
  white: ['neutral-50', 'neutral-70', 'paper-90', 'paper-96', 'paper-99'],
  violet: ['indigo-10', 'violet-20', 'violet-30', 'violet-40', 'violet-60'],
  brown: ['brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-60'],
  steel: ['neutral-12', 'neutral-30', 'neutral-50', 'neutral-70', 'paper-96'],
  gold: ['orange-40', 'orange-60', 'yellow-70', 'yellow-80', 'yellow-95'],
  indigo: ['neutral-4', 'indigo-10', 'indigo-20', 'indigo-30', 'indigo-40'],
  grey: ['neutral-12', 'neutral-25', 'neutral-35', 'neutral-50', 'neutral-65'],
  teal: ['teal-10', 'teal-20', 'teal-30', 'teal-40', 'teal-60'],
  straw: ['brown-30', 'orange-50', 'yellow-60', 'yellow-70', 'yellow-90'],
  sand: ['brown-20', 'brown-40', 'brown-50', 'brown-60', 'orange-80'],
  maroon: ['red-10', 'red-20', 'red-30', 'red-40', 'red-50'],
};

/**
 * Fighter designs. build: thickness of limbs and trunk. top/arms/legs/feet: a cloth key or 'skin'.
 * fist: cloth key of gloves or wraps. hair: style and cloth key. extra: drawn after the body.
 */
export const FIGHTERS = [
  {
    name: 'iron-fist',
    skin: 'tan',
    build: 1.05,
    top: 'skin',
    arms: 'skin',
    legs: 'black',
    feet: 'black',
    fist: 'steel',
    fistR: 1.35,
    hair: ['spiky', 'black'],
    band: 'white',
  },
  {
    name: 'scorch',
    skin: 'light',
    build: 1,
    top: 'skin',
    arms: 'skin',
    legs: 'maroon',
    feet: 'black',
    fist: 'orange',
    fistR: 1.1,
    hair: ['flame', 'red'],
    belt: 'yellow',
  },
  {
    name: 'crow',
    skin: 'pale',
    build: 0.95,
    top: 'black',
    arms: 'black',
    legs: 'black',
    feet: 'black',
    fist: 'black',
    fistR: 1,
    hair: ['hood', 'black'],
    extra: 'beak',
    scarf: 'violet',
  },
  {
    name: 'asura',
    skin: 'tan',
    build: 1.2,
    top: 'skin',
    arms: 'skin',
    legs: 'black',
    feet: 'skin',
    fist: 'white',
    fistR: 1.15,
    hair: ['short', 'red'],
    extra: 'scars',
  },
  {
    name: 'ice-fang',
    skin: 'light',
    build: 0.9,
    top: 'ice',
    arms: 'skin',
    legs: 'ice',
    feet: 'white',
    fist: 'ice',
    fistR: 1.2,
    hair: ['long', 'white'],
  },
  {
    name: 'thunder',
    skin: 'light',
    build: 1,
    top: 'black',
    arms: 'skin',
    legs: 'black',
    feet: 'yellow',
    fist: 'yellow',
    fistR: 1.2,
    hair: ['short', 'black'],
    band: 'yellow',
    extra: 'bolt',
  },
  {
    name: 'oni',
    skin: 'red',
    build: 1.15,
    top: 'skin',
    arms: 'skin',
    legs: 'indigo',
    feet: 'skin',
    fist: 'white',
    fistR: 1.1,
    hair: ['wild', 'black'],
    extra: 'horns',
  },
  {
    name: 'gale',
    skin: 'light',
    build: 0.92,
    top: 'green',
    arms: 'skin',
    legs: 'white',
    feet: 'brown',
    fist: 'white',
    fistR: 1,
    hair: ['short', 'brown'],
    band: 'green',
    scarf: 'green',
  },
  {
    name: 'gorius',
    skin: 'dark',
    build: 1.4,
    top: 'black',
    arms: 'skin',
    legs: 'grey',
    feet: 'black',
    fist: 'gold',
    fistR: 1.3,
    hair: ['bald', 'black'],
  },
  {
    name: 'shinobi',
    skin: 'tan',
    build: 0.95,
    top: 'brown',
    arms: 'skin',
    legs: 'grey',
    feet: 'black',
    fist: 'white',
    fistR: 1,
    hair: ['kasa', 'straw'],
    extra: 'veil',
    scarf: 'maroon',
  },
  {
    name: 'destro',
    skin: 'light',
    build: 1.15,
    top: 'black',
    arms: 'skin',
    legs: 'red',
    feet: 'black',
    fist: 'black',
    fistR: 1.2,
    hair: ['mohawk', 'orange'],
    extra: 'shades',
  },
  {
    name: 'zomba',
    skin: 'green',
    build: 1,
    top: 'grey',
    arms: 'skin',
    legs: 'brown',
    feet: 'skin',
    fist: 'skin',
    fistR: 1,
    hair: ['messy', 'black'],
    extra: 'stitches',
  },
  {
    name: 'medusa',
    skin: 'tan',
    build: 0.85,
    top: 'teal',
    arms: 'skin',
    legs: 'sand',
    feet: 'gold',
    fist: 'gold',
    fistR: 1,
    hair: ['cobra', 'gold'],
    extra: 'slit',
  },
  {
    name: 'berserker',
    skin: 'light',
    build: 1.25,
    top: 'skin',
    arms: 'skin',
    legs: 'brown',
    feet: 'brown',
    fist: 'brown',
    fistR: 1.15,
    hair: ['wild', 'red'],
    extra: 'pelt',
  },
  {
    name: 'titan',
    skin: 'tan',
    build: 1.35,
    top: 'steel',
    arms: 'steel',
    legs: 'steel',
    feet: 'steel',
    fist: 'steel',
    fistR: 1.3,
    hair: ['helmet', 'steel'],
  },
  {
    name: 'shadow-king',
    skin: 'pale',
    build: 1.05,
    top: 'black',
    arms: 'black',
    legs: 'black',
    feet: 'black',
    fist: 'violet',
    fistR: 1.15,
    hair: ['crown', 'gold'],
    extra: 'cape',
  },
];

const mat = (f, key) => M(key === 'skin' ? SKIN[f.skin] : CLOTH[key]);

/** Draw one fighter in one pose. `flip` faces left. Returns a Buf FW by FH. */
export function fighter(f, pose, flip = false) {
  const j = joints(pose, flip);
  const b = new P.Buf(FW, FH);
  const bw = f.build;
  const dir = flip ? -1 : 1;
  const L = [-0.55, -0.65, 0.52];
  const part = (prims, key, o = {}) =>
    P.solid(b, prims, mat(f, key), { light: L, k: 0.6, ambient: 0.42, ...o });
  const cap = (a, c, ra, rb) => P.cap(j[a][0], j[a][1], j[c][0], j[c][1], ra, rb);
  const capP = (a, c, ra, rb) => P.cap(a[0], a[1], c[0], c[1], ra, rb);

  // cape behind everything
  if (f.extra === 'cape') {
    const sh = j.shB;
    const prims = [
      capP(sh, [sh[0] - dir * 6, FH - 6], 2.5 * bw, 4.5),
      capP(j.shF, [sh[0] - dir * 2, FH - 8], 2, 4),
    ];
    part(prims, 'violet', { ambient: 0.2 });
  }
  if (f.scarf) {
    const n = j.neck;
    part(
      [
        capP(n, [n[0] - dir * 8, n[1] + 2], 1.2, 0.9),
        capP([n[0] - dir * 8, n[1] + 2], [n[0] - dir * 13, n[1] + 6], 0.9, 0.7),
      ],
      f.scarf,
    );
  }
  // back limbs (in shade: darker)
  const back = { dark: 0.78 };
  part(
    [cap('hpB', 'knB', 2.2 * bw, 1.8 * bw), cap('knB', 'anB', 1.7 * bw, 1.2 * bw)],
    f.legs,
    back,
  );
  part([cap('anB', 'toB', 1.2, 1.0)], f.feet, back);
  part(
    [cap('shB', 'elB', 1.6 * bw, 1.4 * bw), cap('elB', 'fiB', 1.4 * bw, 1.2 * bw)],
    f.arms,
    back,
  );
  part([P.ell(j.fiB[0], j.fiB[1], 1.6 * f.fistR, 1.6 * f.fistR)], f.fist, back);
  // trunk: chest to hips, then the hips in the leg colour
  const chest = [(j.shF[0] + j.shB[0]) / 2, (j.shF[1] + j.shB[1]) / 2 + 1];
  part([capP(chest, j.hip, 4.2 * bw, 3.3 * bw), cap('shB', 'shF', 2 * bw, 2 * bw)], f.top);
  part(
    [
      capP([j.hip[0], j.hip[1] - 1], j.hpF, 3.2 * bw, 2.4 * bw),
      cap('hpB', 'hpF', 2.6 * bw, 2.6 * bw),
    ],
    f.legs,
  );
  if (f.belt)
    part(
      [P.cap(j.hip[0] - 3.4 * bw, j.hip[1] - 2.5, j.hip[0] + 3.4 * bw, j.hip[1] - 2.5, 0.8, 0.8)],
      f.belt,
    );
  // neck and head
  part([cap('neck', 'head', 1.5 * bw, 1.4)], 'skin');
  const hx = j.head[0],
    hy = j.head[1];
  part([P.ell(hx, hy, 3.3, 3.7)], 'skin', { ambient: 0.62 });
  // front leg and arm
  part([cap('hpF', 'knF', 2.3 * bw, 1.9 * bw), cap('knF', 'anF', 1.8 * bw, 1.2 * bw)], f.legs);
  part([cap('anF', 'toF', 1.2, 1.0)], f.feet);
  part([cap('shF', 'elF', 1.7 * bw, 1.5 * bw), cap('elF', 'fiF', 1.5 * bw, 1.3 * bw)], f.arms);
  part([P.ell(j.fiF[0], j.fiF[1], 1.7 * f.fistR, 1.7 * f.fistR)], f.fist);

  headgear(b, f, hx, hy, dir, part, j);
  return b;
}

/** Hair, masks and the other things on and around the head. */
function headgear(b, f, hx, hy, dir, part, j) {
  const [style, key] = f.hair;
  const ramp = mat(f, key);
  const px = (x, y, k) => b.pset(Math.round(x), Math.round(y), ramp[k]);
  const eye = (c) => b.pset(Math.round(hx + dir * 1.6), Math.round(hy - 0.5), c);
  const back = -dir;
  switch (style) {
    case 'spiky':
    case 'flame': {
      part([P.ell(hx + back * 1, hy - 2.6, 3.1, 1.7)], key);
      const spikes = style === 'flame' ? 5 : 4;
      for (let i = 0; i < spikes; i++) {
        const sx = hx + back * (3 - i * 1.6),
          len = 2 + ((i * 7) % 3);
        for (let k = 0; k < len; k++)
          px(
            sx + back * k * 0.7,
            hy - 4 - k,
            k === 0 ? 2 : style === 'flame' ? 4 - Math.min(k, 2) : 3,
          );
      }
      break;
    }
    case 'short':
      part([P.ell(hx + back * 0.9, hy - 2.7, 3.0, 1.5)], key);
      break;
    case 'long':
      part(
        [
          P.ell(hx + back * 1, hy - 2.6, 3.1, 1.7),
          P.cap(hx + back * 2.2, hy - 1.5, hx + back * 4, hy + 7, 1.8, 1.3),
        ],
        key,
      );
      break;
    case 'bald':
      break;
    case 'mohawk':
      for (let k = 0; k < 6; k++) {
        px(hx + back * (k * 0.9 - 1.5), hy - 4 - (k < 4 ? 1 : 0) - (k === 1 || k === 2 ? 1 : 0), 3);
        px(hx + back * (k * 0.9 - 1.5), hy - 3.2, 1);
      }
      break;
    case 'messy':
      part([P.ell(hx + back * 1, hy - 2.6, 3.2, 1.8)], key);
      for (let k = 0; k < 4; k++) px(hx + back * (2 - k * 1.5), hy - 4.4, 1);
      px(hx + back * 3.5, hy + 0.5, 1);
      break;
    case 'wild': {
      part([P.ell(hx + back * 1.6, hy - 2.8, 3.8, 2.4)], key);
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + back * (i - 1) * 0.42;
        for (let k = 0; k < 3; k++)
          px(
            hx + back * 1.2 + Math.cos(a) * (4 + k),
            hy - 2.5 + Math.sin(a) * (3.2 + k),
            k < 2 ? 3 : 2,
          );
      }
      break;
    }
    case 'hood':
      part(
        [
          P.ell(hx + back * 0.6, hy - 0.6, 3.9, 4.2),
          P.cap(hx + back * 2, hy, j.neck[0] + back, j.neck[1] + 2, 2.6, 2.6),
        ],
        key,
      );
      break;
    case 'mask':
      part([P.ell(hx + back * 0.4, hy - 0.4, 3.6, 4)], 'navy');
      break;
    case 'helmet':
      part([P.ell(hx, hy - 0.8, 3.8, 4.1)], key, { gloss: 0.6 });
      for (let k = -1; k <= 2; k++)
        px(hx - back * 1.5 + back * k * 0.5, hy - 5 - (k === 0 ? 1 : 0), 4);
      break;
    case 'crown':
      part([P.ell(hx + back * 0.9, hy - 2.6, 3.0, 1.6)], 'black');
      for (let k = -3; k <= 3; k++) {
        px(hx + k, hy - 4, 2);
        if (k % 2 === 1 || k % 2 === -1) px(hx + k, hy - 5, 4);
      }
      break;
    case 'kasa': {
      // wide conical straw hat: a flat cone well past both sides of the head
      for (let r = 0; r < 4; r++) {
        const half = 1 + r * 2.1;
        for (let x = -half; x <= half; x += 0.5)
          px(hx + back * 0.3 + x, hy - 5 + r, r === 3 ? 0 : x * dir < 0 ? 3 : r === 0 ? 4 : 2);
      }
      break;
    }
    case 'cobra':
      // a flared hood behind the head (cobra), black hair under it
      part([P.ell(hx + back * 2.6, hy - 0.2, 3.0, 5.2)], key, { dark: 0.85 });
      for (let k = 0; k < 3; k++) px(hx + back * (3.4 + k * 0.3), hy - 2.4 + k * 1.8, 0);
      part([P.ell(hx + back * 0.8, hy - 2.6, 3.0, 1.5)], 'black');
      break;
    case 'snakes':
      part([P.ell(hx + back * 1, hy - 2.6, 3.2, 1.8)], key);
      for (let i = 0; i < 5; i++) {
        const sx = hx + back * (i * 1.3 - 1),
          sy = hy - 3 + i * 1.6;
        for (let k = 0; k < 4; k++)
          px(sx + back * (2 + k), sy + Math.round(Math.sin(k + i) * 1), k === 3 ? 4 : 2);
      }
      break;
  }
  // face: eye, then the extras
  const shade = T('neutral-4');
  if (style === 'mask') {
    b.pset(Math.round(hx + dir * 1.4), Math.round(hy - 0.8), T('paper-96'));
    b.pset(Math.round(hx + dir * 2.3), Math.round(hy - 0.8), T('paper-96'));
  } else if (style === 'helmet') {
    for (let k = 0; k < 3; k++) b.pset(Math.round(hx + dir * (1 + k)), Math.round(hy - 0.5), shade);
  } else if (style === 'hood') {
    eye(T('red-60'));
  } else if (f.extra === 'slit') {
    eye(T('yellow-80'));
  } else if (f.skin === 'dark') eye(T('paper-90'));
  else eye(shade);
  if (f.band) {
    const r = M(CLOTH[f.band]);
    for (let k = -3; k <= 3; k++)
      b.pset(Math.round(hx + k), Math.round(hy - 2.6), r[k * dir < 0 ? 2 : 3]);
    b.pset(Math.round(hx + back * 4), Math.round(hy - 2), r[2]);
    b.pset(Math.round(hx + back * 5), Math.round(hy - 1), r[1]);
  }
  switch (f.extra) {
    case 'beak': {
      const r = M(CLOTH.yellow);
      for (let k = 0; k < 3; k++)
        b.pset(Math.round(hx + dir * (3 + k)), Math.round(hy + 0.5 + k * 0.4), r[k === 0 ? 2 : 1]);
      break;
    }
    case 'horns': {
      const r = M(CLOTH.yellow);
      for (let k = 0; k < 3; k++) {
        b.pset(Math.round(hx + dir * (1 + k * 0.4)), Math.round(hy - 4 - k), r[3 - k]);
        b.pset(Math.round(hx - dir * (2 - k * 0.3)), Math.round(hy - 4 - k), r[2 - Math.min(k, 1)]);
      }
      break;
    }
    case 'shades':
      for (let k = 0; k < 3; k++)
        b.pset(Math.round(hx + dir * (0.6 + k)), Math.round(hy - 0.6), T('neutral-4'));
      b.pset(Math.round(hx + dir * 1.6), Math.round(hy - 1.4), T('sky-80'));
      break;
    case 'bolt': {
      const r = M(CLOTH.yellow);
      const cx = (j.shF[0] + j.hip[0]) / 2,
        cy = (j.shF[1] + j.hip[1]) / 2;
      [
        [0, -2],
        [-1, -1],
        [0, 0],
        [1, 0],
        [0, 1],
        [-1, 2],
      ].forEach(([x, y]) => b.pset(Math.round(cx + x), Math.round(cy + y), r[3]));
      break;
    }
    case 'scars': {
      const cx = (j.shF[0] + j.hip[0]) / 2,
        cy = (j.shF[1] + j.hip[1]) / 2 - 2;
      for (let k = 0; k < 4; k++)
        b.pset(Math.round(cx - 2 + k), Math.round(cy - 2 + k), T('red-30'));
      break;
    }
    case 'stitches': {
      const cx = (j.shF[0] + j.hip[0]) / 2;
      for (let k = 0; k < 4; k++)
        b.pset(Math.round(cx), Math.round(j.shF[1] + 2 + k * 2), T('neutral-12'));
      b.pset(Math.round(hx), Math.round(hy + 1.5), T('neutral-12'));
      break;
    }
    case 'ears': {
      const r = M(CLOTH.grey);
      b.pset(Math.round(hx + dir * 0.5), Math.round(hy - 4.5), r[3]);
      b.pset(Math.round(hx + dir * 0.5), Math.round(hy - 5.5), r[2]);
      b.pset(Math.round(hx - dir * 1.5), Math.round(hy - 4.5), r[2]);
      b.pset(Math.round(hx - dir * 1.5), Math.round(hy - 5.5), r[1]);
      break;
    }
    case 'veil': {
      // cloth over the lower face, up to under the eye
      const r = M(CLOTH.grey);
      for (let y = 0; y < 3; y++)
        for (let x = -2; x <= 3; x++)
          if (Math.hypot(x, y * 1.3) < 3.6)
            b.pset(Math.round(hx + dir * x), Math.round(hy + 0.6 + y), r[x * dir < 1 ? 2 : 3]);
      break;
    }
    case 'pelt': {
      const r = M(CLOTH.grey);
      P.solid(b, [P.cap(j.shB[0], j.shB[1] - 1, j.shF[0], j.shF[1] - 1, 2.6, 2.6)], r, {
        light: [-0.55, -0.65, 0.52],
        k: 0.6,
      });
      break;
    }
  }
}

/** Selective outline: shade colour all round, a lighter one where the light falls (top left). */
export function outlined(buf) {
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
