// Market street: sky, tiled roofs behind, a string of paper lanterns, three stalls with striped
// awnings and an empty shelf (the shipped screen puts the listed items there), an auction block
// with a gavel on the right stall, and a stone road.
import { R } from './props.js';
import { P } from './lib.js';

export const W = 128,
  H = 48;

/** Shelf slots on the stalls: [x, y] top-left of each 16 by 16 item, left to right. */
export const SLOTS = [];

export function market(S) {
  const r = R(S);
  SLOTS.length = 0;
  const sky = S.D(
    ['sky-70', 'sky-80', 'sky-90', 'amber-95'],
    ['neutral-4', 'neutral-6', 'indigo-10', 'violet-10'],
  );
  S.vbands(0, 0, W, 30, sky);
  if (S.theme === 'night') {
    const rnd = P.rng(5);
    for (let k = 0; k < 16; k++)
      S.set(Math.floor(rnd() * W), Math.floor(rnd() * 10), k % 4 ? 'neutral-40' : 'yellow-90');
  }
  // roofs behind: dark tile rows with a ridge
  const roof = S.D(
    ['neutral-30', 'neutral-40', 'neutral-50'],
    ['neutral-4', 'neutral-8', 'neutral-12'],
  );
  const wallC = S.D(['paper-80', 'paper-90'], ['neutral-11', 'neutral-15']);
  for (const [x0, w, top] of [
    [-4, 40, 10],
    [38, 46, 7],
    [86, 46, 11],
  ]) {
    S.rect(x0, top + 6, w, 24 - top, wallC[0]).rect(x0 + 2, top + 6, w - 4, 24 - top, wallC[1]);
    for (let j = 0; j < 6; j++) S.hl(x0 + 3 - j, top + j, w - 6 + j * 2, j % 2 ? roof[1] : roof[0]);
    S.hl(x0 + 3, top - 1, w - 6, roof[2]);
    for (let i = x0 + 4; i < x0 + w - 4; i += 9)
      S.rect(i, top + 9, 3, 4, S.D('brown-40', 'amber-60'));
  }
  // the far side of the street in shade under the stalls
  S.rect(0, 30, W, 12, S.D('paper-70', 'neutral-8')).hl(0, 30, W, S.D('paper-60', 'neutral-6'));
  // lantern string
  const sag = (x) => 1 + Math.round(Math.sin((x / W) * Math.PI) * 2);
  for (let x = 0; x < W; x++) S.set(x, sag(x), S.D('neutral-40', 'neutral-25'));

  // stalls
  stall(S, r, 2, 8, 38, ['red-40', 'red-60', 'paper-96', 'paper-87']);
  stall(S, r, 45, 8, 38, ['blue-40', 'blue-60', 'paper-96', 'paper-87']);
  stall(S, r, 88, 8, 38, ['green-40', 'green-60', 'paper-96', 'paper-87']);
  for (const x of [42, 85]) lantern(S, x, 10);
  gavel(S, r, 110, 26);

  // stone road
  const st = S.D(
    ['neutral-50', 'neutral-60', 'neutral-78', 'neutral-87'],
    ['neutral-6', 'neutral-10', 'neutral-14', 'neutral-21'],
  );
  S.rect(0, 42, W, 6, st[1]).hl(0, 42, W, st[3]);
  for (let y = 43; y < H; y++)
    for (let x = 0; x < W; x++) {
      const row = Math.floor((y - 43) / 2);
      if ((x + row * 3) % 7 === 0 || (y - 43) % 2 === 1) S.set(x, y, st[0]);
      else if ((x + row * 3) % 7 === 1) S.set(x, y, st[2]);
    }
}

function lantern(S, x, y) {
  S.vl(x, 0, y, 'neutral-25');
  S.rows(x - 2, y, ['.aaa.', 'bcccb', 'cdddc', 'bcccb', 'cdddc', 'bcccb', '.aaa.', '..e..'], {
    e: 'red-50',
    a: 'neutral-17',
    b: 'red-40',
    c: 'red-50',
    d: S.D('orange-70', 'yellow-80'),
  });
}

function stall(S, r, x0, y0, w, [a, a2, b, b2]) {
  // posts
  for (const x of [x0 + 1, x0 + w - 3])
    S.rect(x, y0 + 3, 2, 31, r.wood[1]).vl(x, y0 + 3, 31, r.wood[3]);
  // awning: scalloped stripes, lit top, shade under
  for (let x = x0 - 1; x < x0 + w + 1; x++) {
    const stripe = Math.floor((x - x0 + 1) / 4) % 2 === 0;
    S.vl(x, y0, 5, stripe ? a2 : b);
    S.set(x, y0, stripe ? a2 : b);
    S.vl(x, y0 + 4, 1, stripe ? a : b2);
    if ((x - x0 + 1) % 4 === 1 || (x - x0 + 1) % 4 === 2) S.set(x, y0 + 5, stripe ? a : b2);
  }
  S.hl(x0 - 1, y0 - 1, w + 2, r.wood[2]);
  // back of the stall in shadow
  const back = S.D(['brown-30', 'brown-40', 'brown-50'], ['neutral-4', 'brown-10', 'brown-20']);
  S.rect(x0 + 3, y0 + 6, w - 6, 14, back[1]).hl(x0 + 3, y0 + 6, w - 6, back[0]);
  for (let x = x0 + 5; x < x0 + w - 4; x += 5) S.vl(x, y0 + 7, 13, back[0]);
  S.hl(x0 + 3, y0 + 13, w - 6, back[2]).hl(x0 + 3, y0 + 14, w - 6, back[0]);
  // counter
  S.hl(x0, y0 + 20, w, r.wood[4]).hl(x0, y0 + 21, w, r.wood[3]);
  S.rect(x0 + 1, y0 + 22, w - 2, 8, r.wood[2]);
  for (let x = x0 + 1; x < x0 + w - 1; x += 4) S.vl(x, y0 + 22, 8, r.wood[1]);
  S.hl(x0 + 1, y0 + 22, w - 2, r.wood[0]).hl(x0 + 1, y0 + 29, w - 2, r.wood[0]);
  // jars on the back shelf, between the item slots
  const cx = x0 + Math.floor(w / 2);
  for (const [dx, c] of [
    [-3, r.red],
    [0, r.gold],
    [3, r.green],
  ]) {
    S.rect(cx + dx - 1, y0 + 10, 2, 3, c[2])
      .set(cx + dx - 1, y0 + 10, c[4])
      .hl(cx + dx - 1, y0 + 9, 2, 'neutral-60');
  }
  // a basket of goods on the road in front
  S.rect(x0 + 6, y0 + 31, 8, 3, r.wood[3])
    .hl(x0 + 6, y0 + 31, 8, r.wood[4])
    .checker(x0 + 6, y0 + 32, 8, 2, r.wood[1]);
  S.hl(x0 + 7, y0 + 30, 6, 'orange-60')
    .set(x0 + 8, y0 + 29, 'orange-70')
    .set(x0 + 11, y0 + 29, 'red-50');
  // slots: two items per stall stand on the counter
  SLOTS.push([x0 + 3, y0 + 5], [x0 + w - 19, y0 + 5]);
  if (x0 > 80) SLOTS.pop(); // the auction block takes the last place
}

function gavel(S, r, x, y) {
  // sound block and gavel lying on it
  S.rect(x - 3, y + 2, 7, 2, r.wood[1]).hl(x - 3, y + 2, 7, r.wood[3]);
  S.rect(x - 2, y - 2, 5, 3, r.wood[2])
    .hl(x - 2, y - 2, 5, r.wood[4])
    .vl(x + 2, y - 2, 3, r.wood[0]);
  S.line(x - 7, y + 1, x - 2, y - 1, r.wood[3]);
}
