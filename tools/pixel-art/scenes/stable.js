// Stable and paddock scenes behind the horse portraits (2 CSS px per art pixel). Light theme =
// day, dark = night with the lantern lit. One light, from the top left.
import { P } from '../lib/env.js';
import { C, pick, snap, colsOf } from './kit.js';

export const STALL_W = 160,
  STALL_H = 48;
/** Where the portrait goes (its top left), and the top of the door that hides the neck. */
export const STALL_HEAD = { x: 50, y: -1, door: 31 };
/** Both horses face left (the light stays top left); each neck ends behind a fence post. */
export const PADDOCK_HEADS = { left: { x: 29, y: 6 }, right: { x: 93, y: 6 }, rail: 33 };

const pal = (theme) => {
  const day = theme === 'light';
  return {
    day,
    plank: day
      ? C(['brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-50'])
      : C(['neutral-4', 'brown-10', 'brown-20', 'brown-30', 'brown-40']),
    timber: day
      ? C(['brown-10', 'brown-30', 'brown-50', 'brown-60'])
      : C(['neutral-4', 'brown-20', 'brown-30', 'brown-50']),
    door: day
      ? C(['red-20', 'red-30', 'red-40', 'red-50'])
      : C(['red-10', 'red-20', 'red-30', 'red-40']),
    dark: day ? C(['neutral-6', 'brown-10']) : C(['neutral-4', 'neutral-6']),
    iron: day
      ? C(['neutral-12', 'neutral-30', 'neutral-60'])
      : C(['neutral-6', 'neutral-20', 'neutral-40']),
    brass: day
      ? C(['orange-40', 'yellow-70', 'yellow-90'])
      : C(['orange-30', 'yellow-60', 'yellow-80']),
    glow: day ? C(['yellow-80', 'paper-96']) : C(['yellow-80', 'yellow-95']),
    sky: day ? C(['sky-70', 'sky-80', 'sky-90']) : C(['neutral-6', 'blue-10', 'indigo-20']),
    moon: day ? C(['paper-96']) : C(['yellow-90']),
    hay: day
      ? C(['orange-40', 'yellow-60', 'yellow-70', 'yellow-80', 'yellow-90'])
      : C(['brown-30', 'orange-40', 'yellow-50', 'yellow-60', 'yellow-70']),
    straw: day
      ? C(['brown-40', 'orange-60', 'yellow-70'])
      : C(['brown-20', 'brown-40', 'orange-50']),
    grass: day
      ? C(['teal-30', 'green-40', 'green-50', 'lime-60', 'lime-70'])
      : C(['teal-10', 'green-20', 'green-30', 'green-40', 'lime-50']),
    hill: day ? C(['green-50', 'lime-60', 'teal-50']) : C(['teal-10', 'green-20', 'teal-20']),
    fence: day
      ? C(['brown-30', 'brown-60', 'paper-90', 'paper-99'])
      : C(['brown-10', 'brown-40', 'neutral-65', 'neutral-80']),
    cloud: day ? C(['sky-90', 'paper-96', 'paper-99']) : C(['neutral-8', 'blue-10', 'indigo-20']),
  };
};

/** Planks lying horizontally, 5 px each, with grain, a lit top edge and dark seams. */
function planks(b, p, x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const row = Math.floor((y - y0) / 5),
        k = (y - y0) % 5;
      const shift = (row * 37) % 23;
      const seam = (x + shift) % 41 === 0;
      if (k === 4 || seam) {
        b.pset(x, y, p.plank[0]);
        continue;
      }
      const grain = P.fbm(x * 0.08 + row * 3, y * 0.9, 2, 31 + row) - 0.5;
      const v = 0.58 - k * 0.07 + grain * 0.35 + (k === 0 ? 0.18 : 0);
      b.pset(x, y, pick(p.plank, v, x, y, 0.15));
    }
  // nail heads near the seams
  for (let row = 0; row * 5 < y1 - y0; row++) {
    const shift = (row * 37) % 23;
    for (let x = x0 - shift; x < x1; x += 41) {
      const nx = x + shift + 2,
        ny = y0 + row * 5 + 2;
      if (nx > x0 && nx < x1 - 1 && ny < y1) b.pset(nx, ny, p.iron[1]);
    }
  }
}

/** Upright timber with a lit left edge. */
function post(b, p, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const u = (x - x0) / (w - 1);
      const g = P.fbm(x * 0.6, y * 0.12, 2, 77) - 0.5;
      b.pset(x, y, pick(p.timber, 0.75 - u * 0.6 + g * 0.25, x, y, 0.1));
    }
}
function beam(b, p, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const u = (y - y0) / (h - 1);
      const g = P.fbm(x * 0.12, y * 0.6, 2, 79) - 0.5;
      b.pset(x, y, pick(p.timber, 0.8 - u * 0.65 + g * 0.25, x, y, 0.1));
    }
}

/** Hanging lantern on a bracket at (x, y) (top of the hook). Lit at night. */
function lantern(b, p, x, y) {
  for (let i = 0; i < 7; i++) b.pset(x + i, y, p.iron[1]);
  b.pset(x, y + 1, p.iron[0]);
  b.pset(x + 6, y + 1, p.iron[1]);
  b.pset(x + 6, y + 2, p.iron[1]);
  const lx = x + 4,
    ly = y + 3;
  // cap, glass, base
  for (let i = -2; i <= 2; i++) b.pset(lx + i, ly, p.iron[i < 0 ? 2 : 1]);
  for (let j = 1; j <= 5; j++)
    for (let i = -2; i <= 2; i++) {
      const edge = Math.abs(i) === 2;
      b.pset(
        lx + i,
        ly + j,
        edge ? p.iron[i < 0 ? 1 : 0] : p.glow[j > 1 && j < 5 && i <= 0 ? 1 : 0],
      );
    }
  for (let i = -2; i <= 2; i++) b.pset(lx + i, ly + 6, p.iron[0]);
  if (!p.day)
    for (let j = -6; j < 14; j++)
      for (let i = -10; i <= 10; i++) {
        const d = Math.hypot(i, (j - 3) * 0.9);
        if (d < 3.5 || d > 9) continue;
        const X = lx + i,
          Y = ly + j;
        const c = b.get(X, Y);
        const k = p.plank.indexOf(c);
        if (k >= 0 && k < p.plank.length - 1 && P.bt(X, Y) < 0.75 - d * 0.07)
          b.pset(X, Y, p.plank[k + 1]);
      }
}

function hayBale(b, p, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const top = y - y0 < 3;
      const s = P.fbm(x * 0.9, y * 0.2, 2, 51) - 0.5;
      let v = (top ? 0.8 : 0.55 - ((y - y0) / h) * 0.3) + s * 0.4 - ((x - x0) / w) * 0.15;
      b.pset(x, y, pick(p.hay, v, x, y, 0.15));
    }
  // two twine bands
  for (const tx of [x0 + Math.floor(w * 0.28), x0 + Math.floor(w * 0.72)])
    for (let y = y0; y < y0 + h; y++) b.pset(tx, y, p.hay[0]);
  // loose straws on top
  for (let i = 0; i < 9; i++) {
    const x = x0 + 2 + ((i * 13) % (w - 4)),
      y = y0 - 1;
    b.pset(x, y, p.hay[3]);
    if (i % 2) b.pset(x + 1, y - 1, p.hay[4]);
  }
}

/** The stall: planked wall, a framed opening with a dark inside, a Dutch door, lantern, window, hay. */
export function stall(theme) {
  const p = pal(theme);
  const b = new P.Buf(STALL_W, STALL_H);
  planks(b, p, 0, 0, STALL_W, STALL_H - 3);
  // straw on the ground
  for (let y = STALL_H - 3; y < STALL_H; y++)
    for (let x = 0; x < STALL_W; x++)
      b.pset(
        x,
        y,
        pick(p.straw, 0.6 + (P.fbm(x * 0.7, y, 2, 61) - 0.5) * 0.7 - (y - 45) * 0.1, x, y, 0.2),
      );
  // opening: dark inside, timber frame
  const ox0 = 48,
    ox1 = 92,
    oy0 = 4;
  for (let y = oy0; y < STALL_H - 3; y++)
    for (let x = ox0; x < ox1; x++) b.pset(x, y, p.dark[y > oy0 + 20 && (x + y) % 9 === 0 ? 1 : 0]);
  post(b, p, ox0 - 4, oy0, 4, STALL_H - 3 - oy0);
  post(b, p, ox1, oy0, 4, STALL_H - 3 - oy0);
  beam(b, p, ox0 - 6, oy0 - 4, ox1 - ox0 + 16, 4);
  // Dutch door (lower half), boards with a lit top rail and an X brace
  const dy0 = STALL_HEAD.door;
  for (let y = dy0; y < STALL_H - 3; y++)
    for (let x = ox0; x < ox1; x++) {
      const board = Math.floor((x - ox0) / 7),
        k = (x - ox0) % 7;
      let v = 0.55 - k * 0.04 + (P.fbm(x * 0.4, y * 0.1, 2, 90 + board) - 0.5) * 0.3;
      if (k === 6) v = 0.05;
      b.pset(x, y, pick(p.door, v, x, y, 0.15));
    }
  for (let x = ox0; x < ox1; x++) {
    b.pset(x, dy0, p.timber[3]);
    b.pset(x, dy0 + 1, p.timber[2]);
    b.pset(x, dy0 + 2, p.timber[1]);
  }
  // X brace: two boards, 2 px, lit on top
  const dh = STALL_H - 3 - dy0 - 4;
  const mask = new Uint8Array(STALL_W * STALL_H);
  for (let t = 0; t <= 1; t += 1 / 200)
    for (const dir of [0, 1]) {
      const x = Math.round(ox0 + 2 + t * (ox1 - ox0 - 5)),
        y = Math.round(dy0 + 3 + (dir ? 1 - t : t) * (dh - 1));
      mask[y * STALL_W + x] = 1;
      mask[(y + 1) * STALL_W + x] = 2;
    }
  for (let i = 0; i < mask.length; i++) if (mask[i]) b.px[i] = p.door[mask[i] === 1 ? 3 : 2];
  for (let i = 0; i < mask.length; i++)
    if (mask[i] === 2 && !mask[i + STALL_W]) b.px[i + STALL_W] = p.door[0];
  // hinges and a latch
  for (const hy of [dy0 + 4, STALL_H - 7])
    for (let x = ox1 - 9; x < ox1; x++) {
      b.pset(x, hy, p.iron[1]);
      b.pset(x, hy + 1, p.iron[0]);
    }
  for (let y = dy0 + 7; y < dy0 + 10; y++) {
    b.pset(ox0 + 1, y, p.brass[1]);
    b.pset(ox0 + 2, y, p.brass[0]);
  }
  // window with sky on the right
  const wx0 = 118,
    wx1 = 142,
    wy0 = 7,
    wy1 = 24;
  for (let y = wy0; y < wy1; y++)
    for (let x = wx0; x < wx1; x++) b.pset(x, y, pick(p.sky, (y - wy0) / (wy1 - wy0), x, y, 0.3));
  if (p.day) {
    for (const [cx, cy, r] of [
      [124, 13, 2.5],
      [128, 12, 3],
      [132, 13, 2.2],
    ])
      for (let y = wy0; y < wy1; y++)
        for (let x = wx0; x < wx1; x++)
          if (Math.hypot(x - cx, y - cy) <= r && y <= 14) b.pset(x, y, p.cloud[y < cy ? 2 : 1]);
  } else {
    for (let y = 9; y < 13; y++)
      for (let x = 134; x < 138; x++)
        if (Math.hypot(x - 135.5, y - 10.5) < 2.2) b.pset(x, y, p.moon[0]);
    b.pset(122, 10, p.moon[0]);
    b.pset(128, 18, p.moon[0]);
  }
  for (let y = wy0 - 2; y < wy1 + 2; y++)
    for (let x = wx0 - 2; x < wx1 + 2; x++) {
      const frame = y < wy0 || y >= wy1 || x < wx0 || x >= wx1;
      const mull = x === 129 || x === 130 || y === 15;
      if (frame) b.pset(x, y, p.timber[y < wy0 || x < wx0 ? 3 : 1]);
      else if (mull) b.pset(x, y, p.timber[x === 129 || y === 15 ? 2 : 1]);
    }
  // sill
  for (let x = wx0 - 3; x < wx1 + 3; x++) {
    b.pset(x, wy1 + 2, p.timber[3]);
    b.pset(x, wy1 + 3, p.timber[0]);
  }
  hayBale(b, p, 114, 34, 34, 11);
  lantern(b, p, 26, 6);
  // bucket on the ground, left
  for (let y = 38; y < 45; y++) {
    const half = 4 - (y - 38) * 0.15;
    for (let x = Math.round(16 - half); x <= Math.round(16 + half); x++) {
      const u = (x - 16) / half;
      b.pset(
        x,
        y,
        y === 38 ? p.iron[2] : y === 41 ? p.iron[0] : pick(p.iron, 0.75 - u * 0.5, x, y, 0.2),
      );
    }
  }
  for (let x = 12; x <= 20; x++) if (Math.abs(x - 16) === 4) b.pset(x, 36, p.iron[1]);
  for (let x = 13; x <= 19; x++) b.pset(x, 35, p.iron[1]);
  snap(b, colsOf(p));
  // the door and the right post are also drawn in front of the horse
  const front = cut(
    b,
    (x, y) => (y >= dy0 && x >= ox0 - 4 && x < ox1 + 4) || (x >= ox1 && x < ox1 + 4 && y >= oy0),
  );
  return { back: b, front };
}

/** Copy of the pixels of `b` where `keep(x, y)`, clear elsewhere. */
function cut(b, keep) {
  const o = new P.Buf(b.w, b.h);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) if (keep(x, y)) o.px[y * b.w + x] = b.px[y * b.w + x];
  return o;
}

/** Paddock for the breeding pair: sky, hills, a post and rail fence, grass. */
export function paddock(theme) {
  const p = pal(theme);
  const b = new P.Buf(STALL_W, STALL_H);
  for (let y = 0; y < STALL_H; y++)
    for (let x = 0; x < STALL_W; x++) b.pset(x, y, pick(p.sky, y / 26, x, y, 0.3));
  // clouds (dark clouds at night) and, at night, a moon
  for (const [cx, cy, n] of [
    [30, 8, 4],
    [118, 6, 3],
  ])
    for (let i = 0; i < n; i++) {
      const X = cx + i * 5,
        r = 2.5 + ((i * 7) % 3);
      for (let y = cy - 5; y <= cy; y++)
        for (let x = X - 4; x <= X + 4; x++)
          if (Math.hypot(x - X, y - (cy - r * 0.4)) <= r) b.pset(x, y, p.cloud[y < cy - 1 ? 2 : 1]);
    }
  if (!p.day)
    for (let y = 2; y < 9; y++)
      for (let x = 140; x < 148; x++)
        if (Math.hypot(x - 143.5, y - 5) < 3.2) b.pset(x, y, p.moon[0]);
  // two far hills
  for (let x = 0; x < STALL_W; x++) {
    const h1 = 26 - Math.round(6 * Math.exp(-(((x - 40) / 40) ** 2))),
      h2 = 27 - Math.round(5 * Math.exp(-(((x - 125) / 35) ** 2)));
    for (let y = Math.min(h1, h2); y < 30; y++)
      b.pset(x, y, p.hill[y === Math.min(h1, h2) ? 1 : y < 28 ? 0 : 2]);
  }
  // grass, darker toward the front, blade texture
  for (let y = 29; y < STALL_H; y++)
    for (let x = 0; x < STALL_W; x++) {
      const g = P.fbm(x * 0.3, y * 0.5, 2, 71) - 0.5;
      b.pset(x, y, pick(p.grass, 0.68 - (y - 29) * 0.02 + g * 0.35, x, y, 0.15));
    }
  for (let i = 0; i < 70; i++) {
    const x = (i * 53) % STALL_W,
      y = 31 + ((i * 17) % 16);
    b.pset(x, y, p.grass[4]);
    b.pset(x, y + 1, p.grass[1]);
  }
  // fence: posts every 32 px, two rails (white painted)
  const rail = PADDOCK_HEADS.rail;
  for (let x = 0; x < STALL_W; x++)
    for (const ry of [rail, rail + 7]) {
      b.pset(x, ry, p.fence[3]);
      b.pset(x, ry + 1, p.fence[2]);
      b.pset(x, ry + 2, p.fence[1]);
    }
  for (let px = 8; px < STALL_W; px += 32)
    for (let y = rail - 3; y < STALL_H - 2; y++) {
      b.pset(px, y, p.fence[3]);
      b.pset(px + 1, y, p.fence[2]);
      b.pset(px + 2, y, p.fence[1]);
      if (y > rail + 9) b.pset(px + 3, y, p.grass[0]);
    }
  snap(b, colsOf(p));
  const isPost = (x) => (x - 8) % 32 >= 0 && (x - 8) % 32 < 3;
  const front = cut(
    b,
    (x, y) =>
      (y >= rail && y < rail + 3) ||
      (y >= rail + 7 && y < rail + 10) ||
      (isPost(x) && y >= rail - 3 && y < STALL_H - 2),
  );
  return { back: b, front };
}
