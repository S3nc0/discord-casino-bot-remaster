// Pachinko: the machine face. A round playfield behind glass with brass pins, a chrome guide rail,
// a centre display under a jackpot lamp, the start pocket, tulips (open and closed), two windmills,
// the out hole, the ball tray and the launcher handle. Ball paths come from a small simulation.
import { P } from '../lib/env.js';
import { C, cmat, darker, lambert, paste, sphere, text3 } from './kit.js';

const W = 176,
  H = 180;
const FC = { x: 88, y: 84, r: 78 }; // playfield circle
const BOTTOM = 152; // playfield floor
const LCD = { x: 56, y: 44, w: 64, h: 38 };
const POCKET = { x: 88, y: 104 };
const TULIPS = [
  [44, 116],
  [132, 116],
  [88, 128],
];
const MILLS = [
  [30, 72],
  [146, 72],
];
const OUT = { x: 88, y: 148 };

const ramp = (n) => cmat(n).map((c) => P.col(c));
const inField = (x, y) => Math.hypot(x - FC.x, y - FC.y) < FC.r - 6 && y < BOTTOM;
const inLcd = (x, y, m = 0) =>
  x >= LCD.x - m && x < LCD.x + LCD.w + m && y >= LCD.y - 10 - m && y < LCD.y + LCD.h + m;

/** Pin positions: staggered rows, cleared around the features, gates round the pocket and tulips. */
function pins() {
  const out = [];
  for (let row = 0, y = 20; y < 144; y += 9, row++)
    for (let x = 13 + (row % 2) * 5; x < 164; x += 10) {
      if (!inField(x, y)) continue;
      if (inLcd(x, y, 5)) continue;
      if (Math.hypot(x - POCKET.x, y - POCKET.y) < 8) continue;
      if (TULIPS.some(([tx, ty]) => Math.hypot(x - tx, y - ty) < 9)) continue;
      if (MILLS.some(([mx, my]) => Math.hypot(x - mx, y - my) < 9)) continue;
      if (Math.hypot(x - OUT.x, y - OUT.y) < 8) continue;
      out.push([x, y]);
    }
  // gates: a pair of pins flanking each target
  for (const [tx, ty] of [[POCKET.x, POCKET.y], ...TULIPS])
    out.push([tx - 6, ty - 6], [tx + 6, ty - 6]);
  // a funnel of pins over the display's shoulders
  for (let k = 0; k < 5; k++)
    out.push(
      [LCD.x - 4 - k * 5, LCD.y - 12 + k * 4],
      [LCD.x + LCD.w + 3 + k * 5, LCD.y - 12 + k * 4],
    );
  return out;
}
const PINS = pins();

/** The jackpot lamp: a red dome with a rotating reflector. `on` frame 0..3, -1 = off. */
function lamp(b, x, y, on) {
  const r =
    on >= 0
      ? ['red-30', 'red-50', 'orange-60', 'orange-80', 'yellow-95']
      : ['red-10', 'red-20', 'red-30', 'red-40', 'red-50'];
  sphere(
    b,
    x,
    y,
    6,
    r.map((t) => {
      const h = C(t);
      return [h & 255, (h >>> 8) & 255, (h >>> 16) & 255];
    }),
    { rim: true, steps: [1, 2, 3] },
  );
  // base
  for (let i = -7; i <= 7; i++) {
    b.pset(x + i, y + 4, C('neutral-40'));
    b.pset(x + i, y + 5, C('neutral-24'));
  }
  if (on >= 0) {
    // reflector beam sweeping round: a bright wedge and rays outside the dome
    const a = (on / 4) * Math.PI * 2;
    for (let s = 2; s < 6; s++)
      b.pset(
        Math.round(x + Math.cos(a) * s),
        Math.round(y - 1 + Math.sin(a) * s * 0.6),
        C('yellow-95'),
      );
    for (let k = 0; k < 8; k++) {
      if ((k + on) % 2) continue;
      const aa = (k / 8) * Math.PI * 2;
      for (let s = 9; s < 12; s++) {
        const X = Math.round(x + Math.cos(aa) * s),
          Y = Math.round(y + Math.sin(aa) * s * 0.8);
        if (Y < y + 4) b.pset(X, Y, s < 10 ? C('yellow-80') : C('orange-60'));
      }
    }
  }
}

/** Tulip at (x, y): two red petals; open spreads them. */
function tulip(b, x, y, open) {
  const pet = ramp('cherry'),
    leaf = ramp('leaf'),
    ch = ramp('chrome');
  // cup
  for (let j = 0; j < 4; j++)
    for (let i = -3; i <= 3; i++) b.pset(x + i, y + j, j === 3 ? ch[1] : i < 0 ? ch[3] : ch[2]);
  // petals: closed stand upright, open fold outward
  const spread = open ? 3 : 0;
  for (let j = 0; j < 7; j++) {
    const w = j < 2 ? 1 : 2;
    for (let i = 0; i < w; i++) {
      b.pset(x - 3 - Math.round((spread * (7 - j)) / 7) + i, y - 7 + j, i === 0 ? pet[3] : pet[2]);
      b.pset(x + 2 + Math.round((spread * (7 - j)) / 7) + i, y - 7 + j, i === 0 ? pet[2] : pet[1]);
    }
  }
  if (!open)
    for (let j = 2; j < 7; j++) {
      b.pset(x, y - 7 + j, j % 2 ? pet[1] : pet[2]);
      b.pset(x - 1, y - 7 + j, pet[3]);
      b.pset(x + 1, y - 7 + j, pet[2]);
    }
  // leaves at the base
  b.pset(x - 5, y + 2, leaf[2]);
  b.pset(x - 4, y + 3, leaf[1]);
  b.pset(x + 5, y + 2, leaf[2]);
  b.pset(x + 4, y + 3, leaf[1]);
}

/** Windmill: a hub with four blades, `f` 0/1 turns it by 45 degrees. */
function mill(b, x, y, f) {
  const bl = ramp('sky'),
    hub = ramp('gold');
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + (f ? Math.PI / 4 : 0);
    for (let s = 2; s <= 6; s++)
      for (let o = 0; o <= 1; o++) {
        const X = Math.round(x + Math.cos(a) * s - Math.sin(a) * o),
          Y = Math.round(y + Math.sin(a) * s + Math.cos(a) * o);
        b.pset(X, Y, o ? bl[1] : bl[3]);
      }
  }
  b.rect(x - 1, y - 1, x + 2, y + 2, hub[3]);
  b.pset(x + 1, y + 1, hub[1]);
}

/** Whole machine face. `lampOn` frame or -1, `tulipOpen` bools, `digits` the display (3 chars), `millF` 0/1. */
function machine({
  lampOn = -1,
  tulipOpen = [false, false, false],
  digits = '7 3 5',
  millF = 0,
  flash = false,
} = {}) {
  const b = new P.Buf(W, H);
  const frame = ramp('violet'),
    ch = ramp('chrome'),
    gold = ramp('gold');
  // cabinet frame: a rounded violet body, lit on the top left
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const r = 18;
      const cx = Math.min(Math.max(x + 0.5, r), W - r),
        cy = Math.min(Math.max(y + 0.5, r), H - 6);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const e = Math.min(x, y, W - 1 - x, H - 1 - y, r - d);
      b.pset(x, y, e < 1 ? frame[0] : e < 3 ? (x + y < W ? frame[4] : frame[1]) : frame[2]);
    }
  // LED dots round the frame (top and sides): chase while the lamp turns, dim otherwise
  const leds = [];
  for (let x = 22; x <= W - 22; x += 8) leds.push([x, 3]);
  for (let y = 20; y <= BOTTOM; y += 8) leds.push([3, y], [W - 4, y]);
  leds.forEach(([x, y], i) => {
    const on = lampOn >= 0 && (i + lampOn) % 2 === 0;
    b.pset(x, y, on ? C('yellow-95') : C('violet-30'));
    b.pset(x + 1, y, on ? C('yellow-80') : C('violet-20'));
    b.pset(x, y + 1, on ? C('orange-60') : C('violet-20'));
    b.pset(x + 1, y + 1, on ? C('orange-60') : C('violet-20'));
  });
  // playfield: a pale printed panel with a sunburst, round, behind glass
  const pan = ['sky-80', 'sky-90', 'sky-95', 'paper-96'].map(C);
  for (let y = 0; y < BOTTOM + 2; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - FC.x, y + 0.5 - FC.y);
      if (d > FC.r) continue;
      if (d > FC.r - 2) {
        b.pset(x, y, x + y < FC.x + FC.y ? ch[4] : ch[1]);
        continue;
      }
      const a = Math.atan2(y - LCD.y - 10, x - FC.x);
      const ray = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 2;
      const k = d > FC.r - 12 ? 1 : ray ? 2 : 3;
      b.pset(x, y, y > BOTTOM ? ch[1] : pan[k]);
    }
  // guide rail: two chrome arcs from the launcher at the bottom left, up and over the top
  for (let t = 0; t < 1; t += 0.002) {
    const a = Math.PI * 0.72 + t * Math.PI * 1.32;
    for (const [rr, c] of [
      [FC.r - 3, ch[3]],
      [FC.r - 7, ch[2]],
      [FC.r - 8, ch[0]],
    ]) {
      const x = FC.x + Math.cos(a) * rr,
        y = FC.y + Math.sin(a) * rr;
      if (y < BOTTOM) b.pset(Math.floor(x), Math.floor(y), c);
    }
  }
  // pins: a brass head with a light top left pixel and a shadow down right
  const brass = ramp('brass');
  for (const [x, y] of PINS) {
    for (const [dx, dy] of [
      [1, 1],
      [0, 1],
      [1, 0],
    ]) {
      const s = b.get(x + dx, y + dy);
      if (s) b.pset(x + dx, y + dy, darker(s, 0.72));
    }
    b.pset(x, y, brass[1]);
    b.pset(x - 1, y, brass[0]);
    b.pset(x - 1, y - 1, brass[3]);
    b.pset(x, y - 1, brass[2]);
  }
  // centre display: an ornate gold frame, a dark screen with three big digits
  const L = LCD;
  for (let y = L.y; y < L.y + L.h; y++)
    for (let x = L.x; x < L.x + L.w; x++) {
      const e = Math.min(x - L.x, y - L.y, L.x + L.w - 1 - x, L.y + L.h - 1 - y);
      let c;
      if (e < 1) c = gold[0];
      else if (e < 3) c = x - L.x < L.w / 2 && y - L.y < L.h / 2 ? gold[4] : gold[2];
      else if (e < 4) c = gold[0];
      else c = flash ? C('indigo-30') : y - L.y < 10 ? C('indigo-20') : C('blue-10');
      b.pset(x, y, c);
    }
  // crown ornament over the display (the lamp sits on it)
  for (let k = -12; k <= 12; k++) {
    const yy = L.y - 2 - Math.round(4 * Math.cos((k / 12) * Math.PI * 0.5));
    for (let j = yy; j < L.y; j++)
      b.pset(FC.x + k, j, j === yy ? gold[4] : k > 0 ? gold[1] : gold[3]);
  }
  lamp(b, FC.x, L.y - 10, lampOn);
  // digits: the 3x5 font at twice the size, each in its own reel window
  [...digits.replace(/ /g, '')].forEach((d, i) => {
    const wx = L.x + 7 + i * 18,
      wy = L.y + 8;
    for (let y = wy; y < wy + 22; y++)
      for (let x = wx; x < wx + 14; x++)
        b.pset(x, y, y < wy + 2 ? C('neutral-20') : C('neutral-8'));
    const tmp = new P.Buf(3, 5);
    text3(tmp, 0, 0, d, 1);
    const col = d === '7' ? C('red-60') : C('yellow-80'),
      sh = d === '7' ? C('red-30') : C('amber-40');
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++)
        if (tmp.px[y * 3 + x]) {
          b.rect(
            wx + 4 + x * 2 + 1,
            wy + 6 + y * 2 + 1,
            wx + 4 + x * 2 + 3,
            wy + 6 + y * 2 + 3,
            sh,
          );
          b.rect(wx + 4 + x * 2, wy + 6 + y * 2, wx + 4 + x * 2 + 2, wy + 6 + y * 2 + 2, col);
        }
  });
  // start pocket: a chrome cup with a red flag
  for (let j = 0; j < 5; j++)
    for (let i = -4; i <= 4; i++) {
      if (j === 4 && Math.abs(i) > 3) continue;
      b.pset(
        POCKET.x + i,
        POCKET.y + j,
        j === 0
          ? ch[4]
          : Math.abs(i) < 3 && j > 0 && j < 4
            ? C('neutral-8')
            : i < 0
              ? ch[3]
              : ch[1],
      );
    }
  for (let j = -6; j < 0; j++) b.pset(POCKET.x + 4, POCKET.y + j, ch[2]);
  b.rect(POCKET.x + 5, POCKET.y - 6, POCKET.x + 9, POCKET.y - 3, C('red-50'));
  TULIPS.forEach(([x, y], i) => tulip(b, x, y, tulipOpen[i]));
  MILLS.forEach(([x, y]) => mill(b, x, y, millF));
  // out hole
  for (let j = -3; j <= 3; j++)
    for (let i = -6; i <= 6; i++) {
      const d = Math.hypot(i / 6, j / 3);
      if (d <= 1) b.pset(OUT.x + i, OUT.y + j, d > 0.75 ? ch[1] : C('neutral-4'));
    }
  // glass glare: two thin diagonal streaks on the top left of the playfield
  for (let k = 0; k < 22; k++) {
    for (const off of [0, 5]) {
      const x = 26 + k + off,
        y = 44 - k;
      const c = b.get(x, y);
      if (c && inField(x, y) && !inLcd(x, y))
        b.pset(x, y, darker(c, 1.25) === c ? C('paper-99') : C('paper-99'));
    }
  }
  // lower deck: the ball tray (with balls) and the launcher handle
  for (let y = BOTTOM + 6; y < H - 4; y++)
    for (let x = 14; x < 126; x++) {
      const e = Math.min(x - 14, y - BOTTOM - 6, 125 - x, H - 5 - y);
      b.pset(
        x,
        y,
        e < 1 ? ch[0] : y < BOTTOM + 9 ? ch[4] : e < 2 ? ch[2] : y < BOTTOM + 13 ? ch[1] : ch[2],
      );
    }
  const balls = [
    [24, 163],
    [29, 163],
    [34, 163],
    [39, 163],
    [44, 163],
    [26, 167],
    [31, 167],
    [36, 167],
    [41, 167],
    [50, 166],
  ];
  for (const [x, y] of balls) paste(b, ball(), x, y);
  // launcher: a round dial with grip ridges and a chrome knob
  const hx = 150,
    hy = 165;
  for (let y = hy - 12; y <= hy + 12; y++)
    for (let x = hx - 12; x <= hx + 12; x++) {
      const dx = x + 0.5 - hx,
        dy = y + 0.5 - hy,
        d = Math.hypot(dx, dy);
      if (d > 11) continue;
      const a = Math.atan2(dy, dx);
      const ridge = d > 8 && Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0;
      const l = lambert(dx / 11, dy / 11, 1);
      let c = ridge
        ? l > 0.6
          ? C('neutral-60')
          : C('neutral-30')
        : l > 0.7
          ? ch[4]
          : l > 0.45
            ? ch[3]
            : ch[2];
      if (d < 4) c = d < 2 ? C('red-60') : C('red-40');
      if (d > 10) c = ch[0];
      b.pset(x, y, c);
    }
  return b;
}

/** A pachinko ball, 5 by 5. */
function ball() {
  const b = new P.Buf(5, 5);
  const t = ['neutral-17', 'neutral-50', 'neutral-78', 'neutral-92', 'paper-99'].map(C);
  const rows = ['.000.', '04310', '03210', '02110', '.000.'];
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && b.pset(i, j, t[+ch])));
  return b;
}

/**
 * Ball paths: each ball leaves the rail at the top right and falls through the pins (circles of
 * radius 1.5) with gravity and a little bounce. Returns integer points per frame (step 1/30 s).
 */
function paths(n = 7, frames = 60, seed = 3) {
  const rng = P.rng(seed);
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    let x = 30 + rng() * 34,
      y = 20 + rng() * 10,
      vx = 0.2 + rng() * 1.0,
      vy = 0.4;
    const pts = [];
    for (let f = 0; f < frames; f++) {
      for (let s = 0; s < 4; s++) {
        vy += 0.06;
        x += (vx / 4) * 4;
        y += vy;
        for (const [px, py] of PINS) {
          const dx = x - px,
            dy = y - py,
            d = Math.hypot(dx, dy);
          if (d < 3 && d > 0) {
            const nx = dx / d,
              ny = dy / d,
              dot = vx * nx + vy * ny;
            if (dot < 0) {
              vx -= 1.5 * dot * nx;
              vy -= 1.5 * dot * ny;
              vx += (rng() - 0.5) * 0.3;
            }
            x = px + nx * 3;
            y = py + ny * 3;
          }
        }
        if (inLcd(x, y, 1) && y > LCD.y - 10) {
          // slide off the display's shoulders
          vx = x < FC.x ? -Math.abs(vx) - 0.3 : Math.abs(vx) + 0.3;
          y -= vy;
          vy = 0;
        }
        const d = Math.hypot(x - FC.x, y - FC.y);
        if (d > FC.r - 9) {
          const nx = (x - FC.x) / d,
            ny = (y - FC.y) / d;
          x = FC.x + nx * (FC.r - 9);
          y = FC.y + ny * (FC.r - 9);
          const dot = vx * nx + vy * ny;
          if (dot > 0) {
            vx -= 1.6 * dot * nx;
            vy -= 1.6 * dot * ny;
          }
        }
        vx *= 0.995;
        vy = Math.min(vy, 2.2);
        if (Math.hypot(vx, vy) < 0.25) vx += (rng() < 0.5 ? -1 : 1) * 0.9;
      }
      pts.push(y < BOTTOM - 2 ? [Math.round(x - 2.5), Math.round(y - 2.5)] : null);
      if (y >= BOTTOM - 2) break;
    }
    // keep only balls that reach the floor (none stuck on a pin)
    if (pts[pts.length - 1] === null && pts.length > 20) out.push(pts);
  }
  return out;
}

export { machine, ball, paths, PINS, W, H, LCD };
