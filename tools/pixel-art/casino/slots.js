// Slot cabinet: a crimson cabinet with a chasing-light marquee, a chrome bezel around three reel
// windows, a payline, a lever and a coin tray. The reels are their own layer (symbols, blur).
import { P } from '../lib/env.js';
import { C, cmat, darker, nearest, paste, rgbOf, sphere } from './kit.js';
import { coin } from './shared.js';
import { SYMBOLS } from './symbols.js';

const W = 176,
  H = 140;
/** Reel windows: x of each reel, top, width, height. */
const REEL = { xs: [18, 65, 112], y: 38, w: 42, h: 64, pitch: 36 };
const ORDER = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];

const ramp = (n) => cmat(n).map((c) => P.col(c));

/** Rounded box filled by `fn(x, y, edge)`; edge is the distance in pixels from the box edge. */
function box(b, x0, y0, w, h, r, fn) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const cx = Math.min(Math.max(x + 0.5, x0 + r), x0 + w - r),
        cy = Math.min(Math.max(y + 0.5, y0 + r), y0 + h - r);
      const dc = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dc > r) continue;
      const edge = Math.min(x - x0, y - y0, x0 + w - 1 - x, y0 + h - 1 - y, r - dc);
      const c = fn(x, y, edge, x - x0, y - y0);
      if (c) b.pset(x, y, c);
    }
}
/** Cabinet frame. `phase` 0/1 swaps the lit bulbs; `flash` lights the bezel for a win; `lever` 0 up, 1 pulled. */
function cabinet({ phase = 0, flash = false, lever = 0 } = {}) {
  const b = new P.Buf(W, H);
  const cab = ramp('cabinet'),
    chrome = ramp('chrome'),
    gold = ramp('gold'),
    night = ramp('night');
  const CX0 = 2,
    CW = 158;
  // cabinet body: vertical light falloff, lit left edge, dark right edge
  box(b, CX0, 8, CW, H - 8, 6, (x, y, e, u, v) => {
    if (e < 1) return u < CW / 2 && v < 60 ? cab[3] : cab[0];
    if (u < 2) return cab[4];
    if (u === 4 || u === 5) return cab[4];
    if (u > CW - 4) return cab[1];
    if (u > CW - 8) return cab[2];
    return cab[3];
  });
  // marquee: a gold arch with a dark panel and the coin emblem
  box(b, CX0 + 8, 0, CW - 16, 30, 10, (x, y, e, u, v) => {
    if (e < 1) return v < 12 ? gold[4] : gold[1];
    if (e < 2) return v < 14 && u < 80 ? gold[3] : gold[2];
    if (e < 3) return gold[0];
    return v < 6 ? night[3] : night[2];
  });
  // rays behind the emblem
  for (let k = 0; k < 12; k++) {
    const a = Math.PI + (k / 11) * Math.PI;
    for (let s = 9; s < 60; s++) {
      const x = Math.round(81 + Math.cos(a) * s),
        y = Math.round(22 + Math.sin(a) * s * 0.45);
      if (y < 3 || y > 26 || x < 13 || x > 148) continue;
      if (b.get(x, y) === night[2] || b.get(x, y) === night[3])
        b.pset(x, y, k % 2 ? C('magenta-20') : C('indigo-30'));
    }
  }
  paste(b, coin(0, 20), 71, 5);
  // two small sevens' worth of sparkle: four plus-shaped stars in the panel
  for (const [x, y] of [
    [30, 14],
    [52, 9],
    [110, 9],
    [132, 14],
  ]) {
    b.pset(x, y, gold[4]);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      b.pset(x + dx, y + dy, gold[2]);
  }
  // marquee bulbs along the arch and down the cabinet sides
  const bulbs = [];
  for (let x = 16; x <= 146; x += 10) bulbs.push([x, 31]);
  for (let y = 42; y <= 126; y += 12) bulbs.push([5, y], [CX0 + CW - 4, y]);
  bulbs.forEach(([x, y], i) => {
    const on = (i + phase) % 2 === 0;
    const c = on
      ? [C('yellow-95'), C('yellow-80'), C('orange-60')]
      : [C('amber-60'), C('amber-40'), C('brown-20')];
    b.rect(x - 1, y - 1, x + 2, y + 2, c[1]);
    b.pset(x - 1, y - 1, c[0]);
    b.pset(x, y - 1, c[0]);
    b.pset(x - 1, y, c[0]);
    b.pset(x + 1, y + 1, c[2]);
    if (on)
      for (const [dx, dy] of [
        [0, -2],
        [-2, 0],
        [2, 0],
        [0, 2],
      ])
        if (b.get(x + dx, y + dy) !== 0) b.pset(x + dx, y + dy, c[2]);
  });
  // chrome bezel around the reels
  const bx = REEL.xs[0] - 6,
    by = REEL.y - 4,
    bw = REEL.xs[2] + REEL.w + 6 - bx,
    bh = REEL.h + 8;
  box(b, bx, by, bw, bh, 3, (x, y, e, u, v) => {
    if (flash) return e < 1 ? gold[0] : u + v < bw * 0.5 ? gold[4] : gold[2];
    if (e < 1) return chrome[0];
    if (v < 2 || u < 2) return chrome[4];
    if (v > bh - 3 || u > bw - 3) return chrome[1];
    return chrome[3];
  });
  // window: dark glass behind the reels and the dividers between them
  b.rect(bx + 3, by + 3, bx + bw - 4, by + bh - 4, night[1]);
  // reel areas are left clear (the reel layer shows through)
  for (const rx of REEL.xs) b.rect(rx, REEL.y, rx + REEL.w - 1, REEL.y + REEL.h - 1, 0);
  // payline markers: arrows on the bezel at the centre row
  const py = REEL.y + REEL.h / 2;
  const red = flash ? C('yellow-95') : C('red-50'),
    redD = flash ? C('orange-60') : C('red-30');
  for (let k = 0; k < 4; k++) {
    for (let j = -k; j <= k; j++) {
      b.pset(bx - 2 + k, py + j - 1, k === 3 || Math.abs(j) === k ? redD : red);
      b.pset(bx + bw + 1 - k, py + j - 1, k === 3 || Math.abs(j) === k ? redD : red);
    }
  }
  // lower deck: a slanted button panel and the coin tray
  box(b, CX0 + 8, 108, CW - 16, 12, 2, (x, y, e, u, v) =>
    e < 1 ? cab[0] : v < 2 ? cab[4] : cab[3],
  );
  const buttons = [
    ['red', 34],
    ['lemon', 58],
    ['leaf', 82],
  ];
  for (const [m, x] of buttons) sphere(b, x, 114, 3.2, cmat(m), { rim: true, steps: [1, 2, 3] });
  // spin button: long and lit
  box(b, 100, 110, 42, 8, 3, (x, y, e, u, v) =>
    e < 1 ? C('green-20') : v < 2 ? C('lime-70') : v > 5 ? C('green-40') : C('green-60'),
  );
  // tray
  box(b, CX0 + 18, 124, CW - 36, 14, 4, (x, y, e, u, v) => {
    if (e < 1) return chrome[0];
    if (v < 2) return chrome[3];
    if (e < 2) return chrome[2];
    return v < 6 ? night[0] : night[1];
  });
  // coins in the tray
  const c12 = coin(0, 12),
    c12b = coin(0.3, 12);
  for (const [x, y, k] of [
    [36, 127, 0],
    [46, 128, 1],
    [55, 126, 0],
    [104, 128, 1],
    [114, 127, 0],
  ])
    paste(b, k ? c12b : c12, x, y);
  // lever on the right side: a chrome housing, the arm and a red ball
  box(b, CX0 + CW - 1, 62, 8, 18, 2, (x, y, e, u) =>
    e < 1 ? chrome[0] : u < 2 ? chrome[4] : chrome[2],
  );
  const ax = CX0 + CW + 5,
    top = lever ? 100 : 18;
  const y0 = Math.min(top, 70),
    y1 = Math.max(top, 70);
  for (let y = y0; y <= y1; y++) {
    b.pset(ax, y, chrome[4]);
    b.pset(ax + 1, y, chrome[2]);
    b.pset(ax + 2, y, chrome[1]);
  }
  sphere(b, ax + 1.5, top + (lever ? 3 : -3), 5, cmat('cherry'), { rim: true });
  return b;
}

/** One reel: the symbol strip shown with `final` in the middle (above and below as on the strip). */
function reel(final, flash = false) {
  const b = new P.Buf(REEL.w, REEL.h);
  const iv = ramp('ivory');
  // cylinder: lighter in the middle, darker toward the top and bottom edges
  for (let y = 0; y < REEL.h; y++)
    for (let x = 0; x < REEL.w; x++) {
      b.pset(x, y, x > REEL.w - 4 ? iv[2] : x < 2 ? iv[4] : iv[3]);
    }
  const i = ORDER.indexOf(final);
  const sym = (k) => SYMBOLS[ORDER[(k + ORDER.length) % ORDER.length]]();
  const sx = Math.round((REEL.w - 32) / 2);
  const cy = REEL.h / 2 - 16;
  paste(b, sym(i - 1), sx, cy - REEL.pitch);
  paste(b, sym(i), sx, cy);
  paste(b, sym(i + 1), sx, cy + REEL.pitch);
  shadeEdges(b);
  if (flash) {
    const g = C('yellow-80');
    for (let x = 1; x < REEL.w - 1; x++) {
      b.pset(x, cy - 2, g);
      b.pset(x, cy + 33, g);
    }
    for (let y = cy - 2; y <= cy + 33; y++) {
      b.pset(1, y, g);
      b.pset(REEL.w - 2, y, g);
    }
  }
  return b;
}

/** Curve of the reel: rows near the top and bottom edge turn darker, in palette steps. */
function shadeEdges(b) {
  for (let y = 0; y < REEL.h; y++) {
    const e = Math.min(y, REEL.h - 1 - y);
    const f = e < 1 ? 0.25 : e < 4 ? 0.5 : e < 9 ? 0.72 : e < 14 ? 0.88 : 1;
    if (f === 1) continue;
    for (let x = 0; x < b.w; x++) {
      const c = b.px[y * b.w + x];
      if (c >>> 24) b.px[y * b.w + x] = darker(c, f);
    }
  }
}

/**
 * Spin blur: each symbol stretched down with two fading ghosts above it (the strip moves down),
 * `f` 0..2 shifts the strip by a third of a symbol.
 */
function blur(f) {
  const iv = ramp('ivory');
  const pitch = 40,
    n = ORDER.length,
    strip = new P.Buf(REEL.w, pitch * n);
  strip.px.fill(iv[3]);
  const sx = Math.round((REEL.w - 32) / 2);
  ORDER.forEach((s, k) => {
    const sym = SYMBOLS[s]();
    const top = k * pitch;
    const put = (dy, fn, stretch) => {
      for (let y = 0; y < Math.round(32 * stretch); y++)
        for (let x = 0; x < 32; x++) {
          const c = sym.px[Math.min(31, Math.floor(y / stretch)) * 32 + x];
          if (!(c >>> 24)) continue;
          const Y = (top + dy + y + strip.h) % strip.h;
          strip.px[Y * strip.w + sx + x] = fn(c);
        }
    };
    put(
      -10,
      (c) =>
        darker(c, 0.9) === c
          ? iv[2]
          : nearest(rgbOf(c).map((v, i) => v * 0.45 + rgbOf(iv[3])[i] * 0.55)),
      1,
    );
    put(-5, (c) => nearest(rgbOf(c).map((v, i) => v * 0.7 + rgbOf(iv[3])[i] * 0.3)), 1);
    put(0, (c) => c, 1.25);
  });
  const b = new P.Buf(REEL.w, REEL.h);
  const off = f * Math.round(pitch / 3);
  for (let y = 0; y < REEL.h; y++)
    for (let x = 0; x < REEL.w; x++)
      b.px[y * REEL.w + x] = strip.px[((y + off) % strip.h) * strip.w + x];
  for (let y = 0; y < REEL.h; y++) {
    b.px[y * REEL.w + REEL.w - 1] = iv[2];
    b.px[y * REEL.w + REEL.w - 2] = iv[2];
  }
  shadeEdges(b);
  return b;
}

/** Whole machine: cabinet with three reels set in. `reels` are three symbols or blur frame numbers. */
function machine(reels, opt = {}) {
  const b = cabinet(opt);
  reels.forEach((r, i) => {
    const layer = typeof r === 'number' ? blur(r) : reel(r, opt.flash && opt.winning?.includes(i));
    for (let y = 0; y < REEL.h; y++)
      for (let x = 0; x < REEL.w; x++) b.pset(REEL.xs[i] + x, REEL.y + y, layer.px[y * REEL.w + x]);
  });
  // payline across the window over the reels
  const py = REEL.y + REEL.h / 2 - 1;
  const lc = opt.flash ? C('yellow-95') : C('red-50');
  for (let x = REEL.xs[0]; x < REEL.xs[2] + REEL.w; x++) {
    const inGap = !REEL.xs.some((rx) => x >= rx && x < rx + REEL.w);
    if (opt.flash || inGap) b.pset(x, py, lc);
  }
  return b;
}

export { cabinet, reel, blur, machine, W, H, REEL, ORDER };
