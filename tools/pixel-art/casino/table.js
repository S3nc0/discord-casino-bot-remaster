// Blackjack table: green felt (a seamless tile), the dealer's strip (padded rail, chip rack,
// shoe, discard tray), the printed arc between dealer and players, and a betting spot.
import { P } from '../lib/env.js';
import { C, cmat, paste } from './kit.js';
import { chip, chipStack } from './shared.js';
import { back } from './cards.js';

const W = 176;
const felt = cmat('felt').map((c) => P.col(c));

/** Felt: flat, seamless 32 by 32 (the sheen comes from the shadows the rails and props cast). */
function feltTile(n = 32) {
  const b = new P.Buf(n, n);
  b.px.fill(felt[2]);
  return b;
}
function fillFelt(b, y0 = 0, y1 = b.h) {
  const t = feltTile();
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < b.w; x++) b.px[y * b.w + x] = t.px[(y % 32) * 32 + (x % 32)];
}

/** Padded leather rail, `h` tall, lit along its top. */
function rail(b, y0, h = 8, flipLight = false) {
  const lea = cmat('mahogany').map((c) => P.col(c));
  for (let y = y0; y < y0 + h; y++)
    for (let x = 0; x < b.w; x++) {
      const v = (y - y0) / (h - 1);
      const t = flipLight ? 1 - v : v;
      const k = t < 0.15 ? 4 : t < 0.4 ? 3 : t < 0.75 ? 2 : t < 0.95 ? 1 : 0;
      // stitch line and tufting dimples
      const stitch = Math.round(y - y0 - h * 0.75) === 0 && x % 3 === 0;
      const dimple = y - y0 === Math.floor(h * 0.4) && x % 22 === 11;
      b.pset(x, y, stitch ? lea[3] : dimple ? lea[0] : lea[k]);
    }
}

/** Dealer's strip: rail, chip rack with six columns, the shoe on the right, discard tray left. */
function dealerStrip(h = 44) {
  const b = new P.Buf(W, h);
  fillFelt(b);
  rail(b, 0, 8);
  // the rail's shadow on the felt
  for (let x = 0; x < W; x++) {
    b.pset(x, 8, felt[0]);
    b.pset(x, 9, felt[1]);
    if (x % 2) b.pset(x, 10, felt[1]);
  }
  // chip rack: a chrome tray with six recessed columns of chips seen from the side
  const ch = cmat('chrome').map((c) => P.col(c));
  const rx = 46,
    rw = 84,
    ry = 9,
    rh = 18;
  for (let y = ry; y < ry + rh; y++)
    for (let x = rx; x < rx + rw; x++) {
      const e = Math.min(x - rx, y - ry, rx + rw - 1 - x, ry + rh - 1 - y);
      b.pset(x, y, e < 1 ? ch[0] : y === ry + rh - 2 ? ch[1] : y < ry + 3 ? ch[3] : ch[2]);
    }
  const cols = ['black', 'violet', 'green', 'blue', 'red', 'white'];
  cols.forEach((c, i) => {
    const x = rx + 3 + i * 13;
    // recess
    for (let y = ry + 2; y < ry + rh - 2; y++)
      for (let k = 0; k < 12; k++) b.pset(x + k - 1, y, ch[1]);
    // chips lying on edge in the column: a row of thin bands
    const one = chip(c, 10);
    for (let k = 0; k < 4; k++) paste(b, one, x, ry + 3 + k * 2);
  });
  // the shoe: a dark box, slanted face, the top card's back showing, a chrome lip
  const sx = 140,
    sy = 10;
  const sh = cmat('ink').map((c) => P.col(c));
  for (let y = sy; y < sy + 26; y++)
    for (let x = sx; x < sx + 30; x++) {
      const slant = (y - sy) * 0.35;
      if (x < sx + slant) continue;
      const e = Math.min(x - sx - slant, y - sy, sx + 29 - x, sy + 25 - y);
      b.pset(x, y, e < 1 ? sh[0] : x < sx + slant + 2 ? sh[4] : y < sy + 3 ? sh[3] : sh[2]);
    }
  // card back peeking out of the shoe mouth
  const cb = back();
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 18; x++) b.pset(sx + 6 + x, sy + 16 + y, cb.px[(y + 2) * cb.w + x + 2]);
  for (let x = sx + 5; x < sx + 26; x++) b.pset(x, sy + 15, ch[3]);
  // discard tray on the left: a low stack of backs, slightly fanned
  for (let k = 0; k < 4; k++)
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 24; x++)
        b.pset(
          10 + x + k,
          22 - k * 2 + y,
          y === 0 ? C('paper-99') : y === 2 ? C('neutral-60') : C('neutral-87'),
        );
  for (let x = 6; x < 40; x++) {
    b.pset(x, 27, ch[0]);
    b.pset(x, 26, ch[3]);
  }
  // shadow of the rack and shoe on the felt
  for (let x = rx + 1; x < rx + rw + 1; x++) b.pset(x, ry + rh, felt[0]);
  for (let x = sx + 9; x < sx + 31; x++) b.pset(x, sy + 26, felt[0]);
  return b;
}

/** Printed arc: two gold lines bowing down, with small diamond marks between them. */
function arcStrip(h = 18) {
  const b = new P.Buf(W, h);
  fillFelt(b);
  const gl = cmat('feltLine').map((c) => P.col(c));
  const line = (off, c) => {
    let prev = null;
    for (let x = 0; x < W; x++) {
      const u = (x - W / 2) / (W / 2);
      const y = Math.round(off + 9 * (1 - u * u) - 6);
      if (prev !== null)
        for (let yy = Math.min(prev, y); yy <= Math.max(prev, y); yy++)
          if (yy === y || Math.abs(yy - prev) < Math.abs(y - prev)) b.pset(x, yy, c);
      b.pset(x, y, c);
      prev = y;
    }
  };
  line(4, gl[3]);
  line(9, gl[1]);
  for (let k = 1; k < 8; k++) {
    const x = Math.round((k / 8) * W),
      u = (x - W / 2) / (W / 2),
      y = Math.round(6.5 + 9 * (1 - u * u) - 6);
    for (const [dx, dy, c] of [
      [0, -1, gl[4]],
      [-1, 0, gl[2]],
      [1, 0, gl[2]],
      [0, 1, gl[1]],
      [0, 0, gl[3]],
    ])
      b.pset(x + dx, y + dy, c);
  }
  return b;
}

/** Betting spot: a printed ring with a stack of the player's chips on it, 24 by 24. */
function betSpot(chips = 0, colour = 'red') {
  const b = new P.Buf(24, 26);
  const gl = cmat('feltLine').map((c) => P.col(c));
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const d = Math.hypot((x + 0.5 - 12) / 11, (y + 0.5 - 17) / 7.5);
      if (Math.abs(d - 1) < 0.1) b.pset(x, y, x + y < 24 ? gl[3] : gl[1]);
    }
  if (chips > 0) paste(b, chipStack(colour, chips, 14), 5, 26 - (9 + (chips - 1) * 2) - 3);
  return b;
}

/** Whole table for the preview: strip, felt with room for the dealer's hand, arc, more felt, rail. */
function tablePreview(h = 150) {
  const b = new P.Buf(W, h);
  fillFelt(b);
  paste(b, dealerStrip(), 0, 0);
  paste(b, arcStrip(), 0, 84);
  rail(b, h - 6, 6, true);
  return b;
}

export { feltTile, dealerStrip, arcStrip, betSpot, rail, tablePreview, W };
