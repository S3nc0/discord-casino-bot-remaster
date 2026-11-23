// Shop and inventory: a shop with shelves of goods over a counter, a storeroom with an open chest,
// and the small tiles drawn behind each item icon in the lists (a shelf, a chest slot).
// 2 CSS px per art pixel, the same picture in both themes (indoors). One light, from the top left,
// plus a hanging lamp.
import { P } from '../lib/env.js';
import { C, pick, snap, colsOf, paste } from './kit.js';
import { make } from '../icons/kit.js';
import '../icons/games.js';
import '../icons/more.js';
import '../icons/life.js';

export const BANNER_W = 176,
  BANNER_H = 56,
  SHELF_W = 22,
  SHELF_H = 20,
  SLOT_W = 20,
  SLOT_H = 20;

const p = {
  wall: C(['indigo-10', 'indigo-20', 'indigo-30', 'indigo-40']),
  plank: C(['brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-50', 'brown-60']),
  shelf: C(['brown-10', 'brown-30', 'brown-50', 'brown-60', 'brown-80']),
  iron: C(['neutral-6', 'neutral-17', 'neutral-35', 'neutral-60', 'neutral-87']),
  brass: C(['orange-40', 'yellow-60', 'yellow-80', 'yellow-95']),
  glow: C(['yellow-80', 'yellow-95']),
  stone: C(['neutral-6', 'neutral-12', 'neutral-20', 'neutral-30', 'neutral-40']),
  chest: C(['red-10', 'brown-10', 'brown-20', 'brown-30', 'brown-40']),
  gold: C(['orange-40', 'orange-60', 'yellow-70', 'yellow-80', 'yellow-95']),
  dark: C(['neutral-4', 'neutral-6']),
  cloth: C(['red-20', 'red-30', 'red-40']),
};

const lamp = (cx, cy) => (x, y) => Math.max(0, 1 - Math.hypot(x - cx, (y - cy) * 1.3) / 80);

function woodRect(b, ramp, x0, y0, w, h, light, horizontal = true, seed = 1) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const u = horizontal ? (y - y0) / Math.max(1, h - 1) : (x - x0) / Math.max(1, w - 1);
      const g =
        P.fbm(horizontal ? x * 0.12 : x * 0.7, horizontal ? y * 0.7 : y * 0.12, 2, seed) - 0.5;
      const v = (0.82 - u * 0.55 + g * 0.25) * (0.55 + light(x, y) * 0.6);
      b.pset(x, y, pick(ramp, v, x, y, 0.12));
    }
}

/** Shelf plank: lit top edge, front face, a shadow line under it. */
function shelfPlank(b, x0, x1, y, light) {
  for (let x = x0; x < x1; x++) {
    b.pset(x, y, p.shelf[4]);
    b.pset(x, y + 1, pick(p.shelf, 0.55 * (0.6 + light(x, y) * 0.6), x, y + 1, 0.1));
    b.pset(x, y + 2, pick(p.shelf, 0.4 * (0.6 + light(x, y) * 0.6), x, y + 2, 0.1));
    b.pset(x, y + 3, p.shelf[0]);
  }
}

/** The shop: wallpaper, two shelves of goods, a hanging lamp, the counter with a till. */
export function shopBanner() {
  const b = new P.Buf(BANNER_W, BANNER_H);
  const L = lamp(88, 4);
  // striped wallpaper
  for (let y = 0; y < BANNER_H; y++)
    for (let x = 0; x < BANNER_W; x++) {
      const stripe = x % 8 < 4;
      b.pset(x, y, pick(p.wall, (stripe ? 0.5 : 0.36) * (0.5 + L(x, y) * 0.9), x, y, 0.15));
    }
  // shelves with goods (the game's own icons)
  const rows = [
    {
      y: 18,
      items: ['dice', 'drink', 'clover', 'ticket', 'carrot', 'gem', 'cards', 'coin', 'trophy'],
    },
    {
      y: 36,
      items: ['crown', 'shield', 'flame', 'daily', 'slots', 'relic', 'sword', 'lottery', 'horse'],
    },
  ];
  for (const row of rows) {
    shelfPlank(b, 0, BANNER_W, row.y, L);
    let x = 4;
    row.items.forEach((name, i) => {
      const icon = make(name).buf;
      const bb = P.bounds(icon);
      const y = row.y - (bb.y + bb.h - 1) - 1;
      paste(b, icon, x, y);
      x += 17 + ((i * 5) % 4) + 1;
    });
    // brackets under the plank
    for (const bx of [12, 88, 164])
      for (let k = 0; k < 4; k++) {
        b.pset(bx + k, row.y + 4 + k, p.iron[2]);
        b.pset(bx, row.y + 4 + k, p.iron[1]);
      }
  }
  // counter along the bottom: lit top, panelled front, a brass till on the left
  for (let x = 0; x < BANNER_W; x++) {
    b.pset(x, 45, p.shelf[4]);
    b.pset(x, 46, p.shelf[3]);
    b.pset(x, 47, p.shelf[1]);
  }
  woodRect(b, p.plank, 0, 48, BANNER_W, 8, L, true, 7);
  for (let x = 0; x < BANNER_W; x += 22)
    for (let y = 49; y < BANNER_H; y++) {
      b.pset(x, y, p.plank[0]);
      b.pset(x + 1, y, p.plank[4]);
    }
  for (let y = 38; y < 45; y++)
    for (let x = 8; x < 22; x++) {
      const top = y < 41;
      if (top && x > 18) continue;
      b.pset(x, y, pick(p.brass, 0.85 - (x - 8) / 16 - (y - 38) * 0.04, x, y, 0.15));
    }
  for (let x = 9; x < 17; x += 2) b.pset(x, 39, p.iron[1]);
  // coins stacked by the till
  for (let k = 0; k < 4; k++)
    for (let x = 26; x < 30; x++) b.pset(x, 44 - k, p.gold[k % 2 ? 2 : 3]);
  // hanging lamp
  for (let y = 0; y < 3; y++) b.pset(88, y, p.iron[1]);
  for (let i = -4; i <= 4; i++) {
    b.pset(88 + i, 3, p.brass[i < 0 ? 2 : 1]);
    if (Math.abs(i) < 4) b.pset(88 + i, 4, p.brass[i < 0 ? 1 : 0]);
  }
  for (let i = -2; i <= 2; i++) b.pset(88 + i, 5, p.glow[i <= 0 ? 1 : 0]);
  return snap(b, colsOf(p));
}

/** Small shelf tile for one item row: dark back, a plank at the bottom. The icon goes at (3, 1). */
export function shelfTile() {
  const b = new P.Buf(SHELF_W, SHELF_H);
  const flat = () => 0.8;
  for (let y = 0; y < SHELF_H; y++)
    for (let x = 0; x < SHELF_W; x++) {
      const edge = x === 0 || y === 0;
      const v = 0.3 - (x === SHELF_W - 1 || y === SHELF_H - 1 ? 0.2 : 0) + (edge ? 0.25 : 0);
      b.pset(x, y, pick(p.plank, v + (P.fbm(x * 0.15, y * 0.8, 2, 3) - 0.5) * 0.15, x, y, 0.1));
    }
  shelfPlank(b, 1, SHELF_W - 1, SHELF_H - 4, flat);
  return snap(b, colsOf(p));
}

/** The storeroom: stone wall, crates and barrels, an open chest full of coins in the middle. */
export function storeBanner() {
  const b = new P.Buf(BANNER_W, BANNER_H);
  const L = lamp(150, 10);
  // stone wall, blocks
  const h = P.rockHeight({ sx: 14, sy: 7, seed: 9, crack: 0.12, tilt: 0.8, warp: 2 });
  P.surface(b, { height: h, cols: p.stone, relief: 1.4, shade: (x, y) => 0.55 + L(x, y) * 0.6 });
  // floor boards
  woodRect(b, p.plank, 0, 46, BANNER_W, 10, L, true, 5);
  for (let x = 0; x < BANNER_W; x += 23)
    for (let y = 46; y < BANNER_H; y++) b.pset(x, y, p.plank[0]);
  // crates on the left
  const crate = (x0, y0, s) => {
    woodRect(b, p.plank, x0, y0, s, s, L, true, x0);
    for (let k = 0; k < s; k++) {
      b.pset(x0 + k, y0, p.plank[5]);
      b.pset(x0, y0 + k, p.plank[4]);
      b.pset(x0 + k, y0 + s - 1, p.plank[0]);
      b.pset(x0 + s - 1, y0 + k, p.plank[0]);
      b.pset(x0 + k, y0 + k, p.plank[3]);
    }
  };
  crate(6, 30, 16);
  crate(22, 34, 12);
  crate(10, 16, 13);
  // barrels on the right
  const barrel = (cx, y0, hgt, r) => {
    for (let y = y0; y < y0 + hgt; y++) {
      const bulge = r + Math.sin(((y - y0) / hgt) * Math.PI) * 1.5;
      for (let x = Math.round(cx - bulge); x <= Math.round(cx + bulge); x++) {
        const u = (x - cx) / bulge;
        const hoop = y === y0 + 2 || y === y0 + hgt - 3;
        const v = 0.7 - u * 0.55 - (u < -0.85 ? 0.2 : 0);
        b.pset(
          x,
          y,
          hoop ? p.iron[u < -0.2 ? 3 : 1] : pick(p.plank, v * (0.6 + L(x, y) * 0.5), x, y, 0.12),
        );
      }
    }
    for (let x = Math.round(cx - r); x <= Math.round(cx + r); x++) b.pset(x, y0, p.plank[1]);
  };
  barrel(146, 28, 18, 6);
  barrel(162, 32, 14, 5);
  // open chest in the middle: lid up behind, coins heaped, iron bands, a lock
  const cx0 = 68,
    cw = 40,
    cy0 = 32;
  // lid (open, seen from the inside)
  for (let y = cy0 - 14; y < cy0 - 1; y++)
    for (let x = cx0 + 1; x < cx0 + cw - 1; x++) {
      const arch =
        y < cy0 - 11 && (x - cx0 < 4 - (y - cy0 + 14) || cx0 + cw - x < 5 - (y - cy0 + 14));
      if (arch) continue;
      const v = 0.3 + ((y - cy0 + 14) / 14) * 0.2;
      b.pset(x, y, pick(p.chest, v, x, y, 0.15));
    }
  for (let x = cx0 + 1; x < cx0 + cw - 1; x++) b.pset(x, cy0 - 14, p.chest[4]);
  for (const bx of [cx0 + 6, cx0 + cw - 8])
    for (let y = cy0 - 13; y < cy0 - 1; y++) b.pset(bx, y, p.iron[2]);
  // heap of coins
  for (let y = cy0 - 6; y < cy0 + 2; y++)
    for (let x = cx0 + 2; x < cx0 + cw - 2; x++) {
      const top = cy0 - 5 + Math.abs(x - cx0 - cw / 2) * 0.25 + Math.sin(x * 0.9) * 0.7;
      if (y < top) continue;
      const coin = P.voronoi(x / 2.2, y / 1.6, 17);
      const v = 0.75 - coin.f1 * 0.6 + (coin.edge < 0.1 ? -0.35 : 0);
      b.pset(x, y, pick(p.gold, v, x, y, 0.15));
    }
  // a gem and a crown on the heap
  paste(b, make('gem').buf, cx0 + 4, cy0 - 18);
  paste(b, make('crown').buf, cx0 + 21, cy0 - 19);
  // chest body
  for (let y = cy0; y < cy0 + 14; y++)
    for (let x = cx0; x < cx0 + cw; x++) {
      const u = (x - cx0) / cw;
      const top = y === cy0;
      b.pset(
        x,
        y,
        top
          ? p.chest[4]
          : pick(
              p.chest,
              (0.72 - u * 0.5 - ((y - cy0) / 14) * 0.2) * (0.6 + L(x, y) * 0.4) + 0.15,
              x,
              y,
              0.12,
            ),
      );
    }
  for (const bx of [cx0 + 5, cx0 + cw - 7])
    for (let y = cy0; y < cy0 + 14; y++) {
      b.pset(bx, y, p.iron[3]);
      b.pset(bx + 1, y, p.iron[2]);
      b.pset(bx + 2, y, p.iron[1]);
    }
  for (let y = cy0 + 3; y < cy0 + 8; y++)
    for (let x = cx0 + cw / 2 - 2; x < cx0 + cw / 2 + 2; x++)
      b.pset(
        x,
        y,
        p.brass[
          y === cy0 + 3 || x === cx0 + cw / 2 - 2 ? 3 : y === cy0 + 5 && x === cx0 + cw / 2 ? 0 : 1
        ],
      );
  // coins spilled on the floor
  for (const [x, y] of [
    [60, 48],
    [63, 50],
    [112, 49],
    [115, 51],
    [109, 52],
    [57, 51],
  ]) {
    b.pset(x, y, p.gold[3]);
    b.pset(x + 1, y, p.gold[2]);
    b.pset(x, y + 1, p.gold[1]);
    b.pset(x + 1, y + 1, p.gold[0]);
  }
  // wall lantern
  const [lx, ly] = [150, 10];
  for (let i = -2; i <= 2; i++) b.pset(lx + i, ly - 3, p.iron[i < 0 ? 3 : 2]);
  for (let j = -2; j <= 3; j++)
    for (let i = -2; i <= 2; i++)
      b.pset(
        lx + i,
        ly + j,
        Math.abs(i) === 2 ? p.iron[i < 0 ? 2 : 1] : p.glow[j < 2 && i <= 0 ? 1 : 0],
      );
  for (let i = -2; i <= 2; i++) b.pset(lx + i, ly + 4, p.iron[1]);
  return snap(b, colsOf(p));
}

/** Chest slot tile for one inventory row: a dark inset with an iron frame and corner studs. */
export function slotTile() {
  const b = new P.Buf(SLOT_W, SLOT_H);
  for (let y = 0; y < SLOT_H; y++)
    for (let x = 0; x < SLOT_W; x++) {
      const frame = x < 2 || y < 2 || x >= SLOT_W - 2 || y >= SLOT_H - 2;
      if (frame) {
        const lit = x < 2 || y < 2;
        b.pset(
          x,
          y,
          p.plank[
            lit ? (x === 0 || y === 0 ? 5 : 4) : x === SLOT_W - 1 || y === SLOT_H - 1 ? 0 : 2
          ],
        );
      } else {
        const inner = x === 2 || y === 2;
        b.pset(
          x,
          y,
          inner
            ? p.dark[0]
            : pick(p.chest, 0.2 + (P.fbm(x * 0.2, y * 0.2, 2, 8) - 0.5) * 0.2, x, y, 0.1),
        );
      }
    }
  for (const [x, y] of [
    [1, 1],
    [SLOT_W - 2, 1],
    [1, SLOT_H - 2],
    [SLOT_W - 2, SLOT_H - 2],
  ])
    b.pset(x, y, p.iron[x === 1 && y === 1 ? 4 : 3]);
  return snap(b, colsOf(p));
}
