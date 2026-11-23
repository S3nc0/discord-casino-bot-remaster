// Mining room: concrete wall, two server racks full of status lights, an open mining rig with six
// graphics cards and their fans, a monitor with the coin and the hash rate, cables on the floor.
// The shipped screen blinks the rack lights; LIGHTS lists them for the overlay.
import { R } from './props.js';
import { P } from './lib.js';

export const W = 128,
  H = 48;

export const LIGHTS = [];

export function crypto(S) {
  const r = R(S);
  LIGHTS.length = 0;
  const wall = S.D(
    ['neutral-50', 'neutral-60', 'neutral-70', 'neutral-78', 'neutral-87'],
    ['neutral-4', 'neutral-6', 'neutral-8', 'neutral-11', 'neutral-15'],
  );
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < W; x++) {
      const glow = Math.exp(-(((x - 64) / 30) ** 2 + ((y - 20) / 18) ** 2));
      S.set(x, y, wall[1 + P.band(S.D(0.4, 0.25) + glow * 0.5, 3, x, y, 0.3)]);
    }
  // concrete form lines and tie holes
  for (let y = 9; y < 40; y += 10) S.hl(0, y, W, wall[0]);
  for (let y = 4; y < 40; y += 10) for (let x = 6; x < W; x += 16) S.set(x, y, wall[0]);
  // exhaust fan on the wall
  fan(S, 64, 6, 4.5, r);
  // cable tray along the ceiling
  S.hl(0, 1, W, r.steel[1]).hl(0, 2, W, r.steel[0]);
  for (let x = 2; x < W; x += 6) S.set(x, 1, r.steel[3]);

  rack(S, r, 4, 6, 22, 36);
  rack(S, r, 102, 6, 22, 36);
  rig(S, r, 36, 15);
  // monitor on a stand right of the rig
  coinMonitor(S, r, 82, 17);

  // floor: raised tiles, cables
  const fl = S.D(
    ['neutral-40', 'neutral-50', 'neutral-60', 'neutral-70'],
    ['neutral-4', 'neutral-8', 'neutral-12', 'neutral-17'],
  );
  S.rect(0, 40, W, 8, fl[1]).hl(0, 40, W, fl[3]);
  for (let x = 0; x < W; x += 12) S.vl(x, 41, 7, fl[0]);
  S.hl(0, 44, W, fl[0]);
  const cab = [
    ['blue-30', 'blue-50'],
    ['red-30', 'red-50'],
    ['yellow-50', 'yellow-70'],
  ];
  cab.forEach(([a, b], k) => {
    let prev = null;
    for (let x = 30 + k * 5; x < 100 - k * 6; x++) {
      const y = Math.round(43 + k * 1.5 + Math.sin((x + k * 11) / 7) * 1.4);
      if (prev !== null && prev !== y) S.set(x, prev, a);
      S.set(x, y, b);
      prev = y;
    }
  });
}

function fan(S, cx, cy, rad, r) {
  S.disc(cx, cy, rad + 1, r.steel[0]).disc(cx, cy, rad, r.steel[1]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    S.line(
      cx - 0.5,
      cy - 0.5,
      cx - 0.5 + Math.cos(a) * (rad - 0.5),
      cy - 0.5 + Math.sin(a) * (rad - 0.5),
      r.steel[3],
    );
  }
  S.disc(cx, cy, 1.2, r.steel[2]);
}

function rack(S, r, x0, y0, w, h) {
  S.bevel(x0, y0, w, h, ['neutral-4', 'neutral-12', 'neutral-25']);
  S.rect(x0 + 2, y0 + 2, w - 4, h - 3, 'neutral-6');
  const leds = ['green-60', 'green-70', 'sky-60', 'amber-60', 'green-60', 'red-60'];
  let k = 0;
  for (let y = y0 + 3; y < y0 + h - 3; y += 4) {
    S.rect(x0 + 3, y, w - 6, 3, 'neutral-15')
      .hl(x0 + 3, y, w - 6, 'neutral-25')
      .hl(x0 + 3, y + 2, w - 6, 'neutral-10');
    // vent slits
    for (let x = x0 + 10; x < x0 + w - 4; x += 2) S.set(x, y + 1, 'neutral-8');
    // status lights
    for (let i = 0; i < 3; i++) {
      const c = leds[(k + i * 2) % leds.length];
      S.set(x0 + 4 + i * 2, y + 1, c);
      LIGHTS.push([x0 + 4 + i * 2, y + 1, c, (k * 3 + i) % 4]);
    }
    k++;
  }
  S.rect(x0 + 1, y0 + h - 1, 3, 1, 'neutral-4').rect(x0 + w - 4, y0 + h - 1, 3, 1, 'neutral-4');
}

/** Open-frame rig: a steel frame holding six cards, each with two fans, power cables on top. */
function rig(S, r, x0, y0) {
  const fw = 42,
    fh = 22;
  // shelf frame
  const fr = S.D(r.steel, ['neutral-12', 'neutral-20', 'neutral-30', 'neutral-40', 'neutral-60']);
  S.rect(x0, y0, fw, 2, fr[2]).hl(x0, y0, fw, fr[4]);
  S.rect(x0, y0 + fh, fw, 2, fr[2])
    .hl(x0, y0 + fh, fw, fr[4])
    .hl(x0, y0 + fh + 1, fw, fr[0]);
  for (const x of [x0, x0 + fw - 2]) S.rect(x, y0, 2, fh + 6, fr[1]).vl(x, y0, fh + 6, fr[3]);
  // the cards stand on edge; we see their fan side
  for (let k = 0; k < 6; k++) {
    const x = x0 + 3 + k * 6;
    S.rect(x, y0 + 4, 5, 17, 'neutral-17')
      .vl(x, y0 + 4, 17, 'neutral-30')
      .vl(x + 4, y0 + 4, 17, 'neutral-8');
    for (const fy of [y0 + 9, y0 + 16]) {
      S.rect(x + 1, fy - 2, 3, 5, 'neutral-8');
      S.hl(x + 1, fy - 2, 3, 'neutral-35')
        .vl(x, fy - 1, 3, 'neutral-35')
        .vl(x + 4, fy - 1, 3, 'neutral-20')
        .hl(x + 1, fy + 2, 3, 'neutral-20');
      S.set(x + 2, fy, 'neutral-50')
        .set(x + 1, fy - 1, 'neutral-17')
        .set(x + 3, fy + 1, 'neutral-17');
    }
    // accent strip glows
    S.hl(x + 1, y0 + 5, 3, k % 2 ? 'sky-60' : 'violet-60');
    S.hl(x + 1, y0 + 20, 3, 'neutral-25');
    // power cable down from the top shelf
    S.vl(x + 2, y0 + 2, 2, 'neutral-4');
  }
  // power supply on the bottom shelf
  S.bevel(x0 + 8, y0 + fh + 2, 14, 4, ['neutral-6', 'neutral-17', 'neutral-30']);
  S.set(x0 + 10, y0 + fh + 3, 'green-60');
  S.bevel(x0 + 26, y0 + fh + 2, 8, 4, ['neutral-6', 'neutral-17', 'neutral-30']);
}

function coinMonitor(S, r, x0, y0) {
  S.bevel(x0, y0, 17, 13, ['neutral-4', 'neutral-17', 'neutral-30']);
  S.rect(x0 + 1, y0 + 1, 15, 11, 'neutral-6');
  // a gold coin
  S.disc(x0 + 6, y0 + 5.5, 3.6, 'orange-40').disc(x0 + 5.6, y0 + 5.1, 3, 'yellow-70');
  S.vl(x0 + 5, y0 + 4, 3, 'orange-50').set(x0 + 4, y0 + 3, 'yellow-95');
  // hash rate bars
  [3, 5, 4, 6].forEach((h, i) =>
    S.vl(x0 + 11 + i, y0 + 11 - h, h, i === 3 ? 'green-70' : 'green-50'),
  );
  S.vl(x0 + 8, y0 + 13, 3, 'neutral-20').hl(x0 + 5, y0 + 16, 7, 'neutral-25');
  // keyboard
  S.rect(x0 + 2, y0 + 20, 13, 2, 'neutral-17').hl(x0 + 2, y0 + 20, 13, 'neutral-30');
  S.hl(x0 - 1, y0 + 22, 19, r.wood[3]).hl(x0 - 1, y0 + 23, 19, r.wood[0]);
  for (const x of [x0, x0 + 16]) S.vl(x, y0 + 24, 6, r.wood[1]);
}
