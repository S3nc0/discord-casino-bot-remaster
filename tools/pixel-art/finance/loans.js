// Loan office: green striped wallpaper over a wood wainscot, a ledger shelf, a window with blinds,
// a wall clock (due dates), a filing cabinet and the desk with the contract, ink pad and stamp.
import { R, wallValue } from './props.js';
import { P } from './lib.js';

export const W = 128,
  H = 48;

export function loans(S, opt = {}) {
  const r = R(S);
  const paper = S.D(
    ['teal-40', 'teal-50', 'teal-60', 'teal-70', 'green-80'],
    ['blue-10', 'teal-10', 'teal-20', 'teal-30', 'teal-40'],
  );
  const lamps = [[64, 6]];
  // wallpaper with stripes, lit from the ceiling light
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < W; x++) {
      const v = wallValue(S, x, y, lamps, 30, S.D(0.45, 0.3));
      const k = 1 + P.band(v, 3, x, y, 0.3);
      S.set(x, y, x % 6 === 0 ? paper[k - 1] : paper[k]);
    }
  S.rect(0, 0, W, 3, r.ceil[1])
    .hl(0, 2, W, r.wood[0])
    .hl(0, 3, W, r.wood[3])
    .hl(0, 4, W, r.wood[1]);
  // wainscot: rail and panels
  S.hl(0, 29, W, r.wood[4]).hl(0, 30, W, r.wood[2]).hl(0, 31, W, r.wood[0]);
  S.rect(0, 32, W, 11, r.wood[1]);
  for (let x = 2; x < W; x += 10) S.inset(x, 33, 8, 8, [r.wood[0], r.wood[2], r.wood[3]]);

  // ledger shelf on the left
  S.bevel(4, 6, 26, 37, [r.wood[0], r.wood[1], r.wood[3]]);
  S.rect(6, 8, 22, 33, r.back[0]);
  const spines = [
    r.red,
    r.green,
    ['blue-20', 'blue-40', 'blue-50', 'blue-60', 'blue-80'],
    r.gold,
    ['brown-20', 'brown-40', 'brown-50', 'brown-60', 'brown-80'],
  ];
  [8, 19, 30].forEach((sy, row) => {
    let x = 6;
    let k = row * 2;
    while (x < 27) {
      const w = 2 + ((k * 7) % 3 === 0 ? 1 : 0),
        h = 7 + ((k * 5) % 3),
        c = spines[k % spines.length];
      if (row === 1 && k === 4) {
        // one book leans on its neighbour
        for (let j = 0; j < h - 1; j++) S.hl(x + Math.floor(j / 3), sy + 9 - j, 2, c[1]);
        x += 4;
      } else {
        S.rect(x, sy + 9 - h, w, h, c[1])
          .vl(x, sy + 9 - h, h, c[3])
          .hl(x, sy + 11 - h, w, c[4])
          .hl(x, sy + 7, w, c[4]);
        x += w;
      }
      k++;
    }
    S.hl(6, sy + 9, 22, r.wood[3]).hl(6, sy + 10, 22, r.wood[0]);
  });

  // window with blinds
  const wx = 40,
    wy = 6,
    ww = 36,
    wh = 21;
  S.bevel(wx, wy, ww, wh, [r.wood[0], r.wood[2], r.wood[4]]);
  const sky = S.D(['sky-60', 'sky-70', 'sky-80'], ['neutral-4', 'neutral-8', 'neutral-12']);
  S.vbands(wx + 2, wy + 2, ww - 4, wh - 4, sky);
  // city outside, between the slats
  const city = S.D('sky-50', 'neutral-21'),
    lit = S.D('sky-80', 'yellow-80');
  for (let x = wx + 2; x < wx + ww - 2; x++) {
    const h = 4 + ((x * 37) % 7) + (x % 9 < 3 ? 3 : 0);
    S.rect(x, wy + wh - 2 - h, 1, h, city);
    if ((x * 13) % 3 === 0) S.set(x, wy + wh - h + 1, lit).set(x, wy + wh - h + 3 + (x % 2), lit);
  }
  if (S.theme === 'night')
    S.disc(wx + 9, wy + 13, 1.8, 'yellow-90').set(wx + 8, wy + 12, 'yellow-95');
  else S.disc(wx + 9, wy + 13, 1.8, 'yellow-90').set(wx + 8, wy + 12, 'paper-99');
  // blinds pulled half up: slats on top, a bottom rail, the cord on the right
  S.rect(wx + 2, wy + 2, ww - 4, 7, r.paper[S.D(3, 2)]);
  for (let y = wy + 3; y < wy + 9; y += 2) S.hl(wx + 2, y, ww - 4, r.paper[1]);
  S.hl(wx + 2, wy + 9, ww - 4, r.paper[4]).hl(wx + 2, wy + 10, ww - 4, r.paper[0]);
  S.vl(wx + ww - 5, wy + 10, 6, r.paper[1]).set(wx + ww - 5, wy + 16, r.gold[3]);
  S.hl(wx + 1, wy + wh - 1, ww - 2, r.wood[4]);

  // wall clock: due dates
  const cx = 92.5,
    cy = 13.5;
  S.disc(cx, cy, 7, r.wood[0]).disc(cx, cy, 6, r.gold[2]).disc(cx, cy, 5, r.paper[4]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    S.set(cx - 0.5 + Math.cos(a) * 4, cy - 0.5 + Math.sin(a) * 4, k % 3 ? r.paper[1] : r.ink);
  }
  S.line(92, 13, 92, 10, r.ink).line(92, 13, 95, 14, r.ink).set(92, 13, r.red[2]);
  S.set(cx - 3.5, cy - 4.5, r.gold[4]);

  // filing cabinet with a plant
  S.bevel(104, 20, 18, 23, [r.steel[0], r.steel[2], r.steel[3]]);
  for (let y = 22; y < 42; y += 7) {
    S.inset(106, y, 14, 6, [r.steel[1], r.steel[2], r.steel[4]]);
    S.hl(111, y + 2, 4, r.steel[0])
      .hl(111, y + 3, 4, r.steel[4])
      .rect(112, y + 4, 2, 1, r.paper[4]);
  }
  S.rect(108, 15, 8, 5, r.red[1]).hl(108, 15, 8, r.red[3]).vl(115, 16, 4, r.red[0]);
  const leaf = r.green;
  S.rows(
    105,
    6,
    [
      '....bc....',
      '..b.bcc.c.',
      '.bcc.bc.cd',
      'abcc.bcccd',
      '.abb.abcd.',
      '..aabbab..',
      '....aa.d..',
      '.....aa...',
      '.....a....',
    ],
    { a: leaf[0], b: leaf[1], c: leaf[3], d: leaf[2] },
  );

  // floor planks
  const fl = S.D(
    ['brown-30', 'brown-40', 'brown-50', 'brown-60'],
    ['red-10', 'brown-10', 'brown-20', 'brown-30'],
  );
  S.rect(0, 43, W, 5, fl[2]).hl(0, 43, W, fl[3]);
  for (let y = 45; y < H; y += 2) S.hl(0, y, W, fl[1]);
  for (let x = 5; x < W; x += 17) S.vl(x, 44, 1, fl[0]).vl(x + 8, 46, 1, fl[0]);

  // the desk
  desk(S, r, 32, 30, 66, opt.stamp ?? 0);
}

function desk(S, r, x0, y0, w, stamp) {
  S.checker(x0 + 2, 45, w - 2, 2, r.wood[0]);
  S.hl(x0, y0, w, r.wood[4])
    .hl(x0, y0 + 1, w, r.wood[3])
    .hl(x0, y0 + 2, w, r.wood[0]);
  S.rect(x0 + 2, y0 + 3, w - 4, 12, r.wood[1]);
  for (let x = x0 + 4; x < x0 + w - 8; x += 15) {
    S.bevel(x, y0 + 4, 13, 5, [r.wood[0], r.wood[2], r.wood[3]]).hl(x + 5, y0 + 6, 3, r.gold[3]);
    S.bevel(x, y0 + 10, 13, 4, [r.wood[0], r.wood[2], r.wood[3]]);
  }
  S.vl(x0 + w - 3, y0 + 3, 12, r.wood[0]).vl(x0 + 2, y0 + 3, 12, r.wood[2]);
  // contract on a green blotter
  S.rect(x0 + 18, y0 - 1, 26, 2, r.green[1]).hl(x0 + 18, y0 - 1, 26, r.green[2]);
  S.rect(x0 + 22, y0 - 3, 16, 3, r.paper[4]).hl(x0 + 22, y0 - 3, 16, r.paper[3]);
  for (const x of [x0 + 24, x0 + 28]) S.hl(x, y0 - 2, 3, r.paper[1]);
  // the seal (left out while the stamp animation has not pressed it yet)
  if (stamp === 0 || stamp >= 4)
    S.rect(x0 + 34, y0 - 2, 2, 2, r.red[2]).set(x0 + 34, y0 - 2, r.red[3]);
  // stamp and ink pad
  S.rect(x0 + 8, y0 - 1, 6, 1, r.red[1])
    .hl(x0 + 7, y0 - 1, 1, r.ink)
    .hl(x0 + 14, y0 - 1, 1, r.ink);
  // the stamp: at rest on the right, or over the contract while it seals it
  const [sx, sy] =
    stamp === 2 || stamp === 4
      ? [x0 + 33, y0 - 12]
      : stamp === 3
        ? [x0 + 33, y0 - 9]
        : [x0 + 46, y0 - 8];
  S.rect(sx + 1, sy, 3, 7, r.wood[3])
    .vl(sx + 1, sy, 7, r.wood[4])
    .vl(sx + 3, sy, 7, r.wood[1]);
  S.rect(sx, sy + 7, 5, 1, r.red[2]);
  // money bag
  S.rows(
    x0 + 54,
    y0 - 9,
    ['..ab.', '.dcd.', '.bcb.', 'abccb', 'bccccb'.slice(0, 5), 'bcccc', 'abbbb', '.aaa.', '.....'],
    { a: r.wood[1], b: r.wood[3], c: r.wood[4], d: r.gold[3] },
  );
  // fountain pen
  S.line(x0 + 4, y0 - 1, x0 + 9, y0 - 3, r.ink).set(x0 + 9, y0 - 3, r.gold[3]);
}
