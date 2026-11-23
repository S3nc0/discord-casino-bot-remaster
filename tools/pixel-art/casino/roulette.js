// Roulette: a single zero wheel seen from straight above (wood rim, ball track, the numbered ring,
// pockets with chrome frets, a lit cone and the turret), the ball, spin blur for the ring, and the
// betting board with chips on the player's lines.
import { P } from '../lib/env.js';
import { C, cmat, darker, lambert, paste, sphere, text3, textW } from './kit.js';
import { chip } from './shared.js';

/** Pocket order round the wheel, clockwise from the top. */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const N = WHEEL.length;
const SIZE = 148;
const CX = SIZE / 2,
  CY = SIZE / 2;
// radii
const R = { rim: 73, track: 66, numOut: 58, numIn: 48, pocketIn: 40, cone: 39, turret: 9 };
/** Angle of pocket index i (centre), 0 at the top, clockwise. */
const angleOf = (i) => -Math.PI / 2 + ((i + 0.5) / N) * Math.PI * 2;
const pocketColour = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

const COL = {
  red: ['red-20', 'red-30', 'red-40', 'red-50'].map(C),
  black: ['neutral-4', 'neutral-8', 'neutral-12', 'neutral-20'].map(C),
  green: ['teal-20', 'emerald-30', 'green-40', 'green-50'].map(C),
};

function wheel({ blur = -1, highlight = null } = {}) {
  const b = new P.Buf(SIZE, SIZE);
  const wood = cmat('mahogany').map((c) => P.col(c));
  const pine = cmat('pine').map((c) => P.col(c));
  const chrome = cmat('chrome').map((c) => P.col(c));
  const gold = cmat('gold').map((c) => P.col(c));
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - CX,
        dy = y + 0.5 - CY,
        r = Math.hypot(dx, dy);
      if (r > R.rim) continue;
      const ux = dx / r,
        uy = dy / r;
      let a = Math.atan2(dy, dx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      const pi = Math.floor((a / (Math.PI * 2)) * N) % N;
      const frac = (a / (Math.PI * 2)) * N - Math.floor((a / (Math.PI * 2)) * N);
      let c;
      if (r > R.track) {
        // outer rim: a rounded wooden lip, lit toward the top left
        const t = (r - R.track) / (R.rim - R.track); // 0 inner .. 1 outer
        const nz = Math.sin(t * Math.PI),
          n = (t - 0.5) * 2;
        const l = lambert(ux * n, uy * n, nz + 0.3);
        c = wood[P.band(P.clamp(l * 1.1), 5, x, y, 0.25)];
        if (r > R.rim - 1) c = wood[0];
      } else if (r > R.numOut) {
        // ball track: a bowl sloping down toward the centre, the far side (top left) in shade
        const l = lambert(-ux * 0.6, -uy * 0.6, 1);
        c = pine[P.band(P.clamp((l - 0.2) * 1.4), 5, x, y, 0.25)];
        if (r < R.numOut + 1.2) c = chrome[3];
        // eight diamond deflectors on the track
        const dk = ((a / (Math.PI * 2)) * 8 + 0.0625) % 1;
        if (Math.abs(r - 62) < 1.6 && Math.abs(dk - 0.5) < 0.02 * (2 - Math.abs(r - 62)))
          c = chrome[4];
      } else if (r > R.pocketIn) {
        const n = WHEEL[pi];
        const set = COL[pocketColour(n)];
        if (r > R.numIn) {
          // number ring: flat colour with its edges a step darker
          c = set[r > R.numOut - 1.2 ? 1 : 3];
          if (frac < 0.07 || frac > 0.93) c = gold[1];
        } else {
          // pockets: recessed, so the far wall (toward the centre) is lit, the near wall dark
          c = r > R.numIn - 1.5 ? set[0] : set[2];
          if (frac < 0.09 || frac > 0.91) c = chrome[frac < 0.09 ? 4 : 2];
        }
        if (highlight !== null && WHEEL[pi] === highlight)
          c =
            r > R.numIn
              ? r > R.numOut - 1.2
                ? gold[1]
                : gold[3]
              : frac < 0.09 || frac > 0.91
                ? gold[4]
                : c;
      } else if (r > R.turret) {
        // cone: rises to the turret, lit on the top left
        const t = (r - R.turret) / (R.cone - R.turret);
        const l = lambert(ux * 0.8, uy * 0.8, 1 + t);
        c = wood[P.band(P.clamp((l - 0.3) * 1.6), 5, x, y, 0.25)];
        if (r > R.cone - 1) c = chrome[1];
        // four spokes of the turret
        const sp = Math.min(Math.abs(dx), Math.abs(dy));
        if (sp < 1.6 && r < 26) c = chrome[sp < 0.8 ? 4 : 2];
        if (r > 25 && r < 29 && sp < 2.2) c = gold[r < 27 ? 3 : 1];
      } else {
        const l = lambert(dx / R.turret, dy / R.turret, 1);
        c = chrome[P.band(P.clamp(l * 1.2), 5, x, y, 0.2)];
      }
      b.pset(x, y, c);
    }
  // numbers, upright, centred on the ring
  WHEEL.forEach((n, i) => {
    const a = angleOf(i),
      rr = (R.numOut + R.numIn) / 2;
    const s = String(n),
      w = textW(s);
    const x = Math.round(CX + Math.cos(a) * rr - w / 2),
      y = Math.round(CY + Math.sin(a) * rr - 2.5);
    text3(b, x, y, s, n === highlight ? C('neutral-10') : C('paper-99'));
  });
  if (blur >= 0) blurRing(b, blur);
  return b;
}

/** Spin blur over the number and pocket rings: colours smeared round the wheel. */
function blurRing(b, f) {
  const src = new P.Buf(b.w, b.h);
  src.px.set(b.px);
  const rgb = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - CX,
        dy = y + 0.5 - CY,
        r = Math.hypot(dx, dy);
      if (r > R.numOut - 0.5 || r < R.pocketIn + 0.5) continue;
      const a0 = Math.atan2(dy, dx) + f * 0.11;
      const acc = [0, 0, 0];
      const K = 9;
      for (let k = 0; k < K; k++) {
        const a = a0 - (k / K) * 0.34;
        const c = rgb(src.get(CX + Math.cos(a) * r - 0.5, CY + Math.sin(a) * r - 0.5));
        acc[0] += c[0];
        acc[1] += c[1];
        acc[2] += c[2];
      }
      const m = acc.map((v) => v / K);
      // snap to a few ring tones so it stays in the palette
      const tones = [
        C('red-20'),
        C('red-30'),
        C('red-40'),
        C('neutral-8'),
        C('neutral-12'),
        C('brown-20'),
        C('neutral-17'),
      ];
      let best = tones[0],
        bd = 1e9;
      for (const t of tones) {
        const q = rgb(t),
          d = (m[0] - q[0]) ** 2 + (m[1] - q[1]) ** 2 + (m[2] - q[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      b.pset(x, y, best);
    }
}

/** The ball, 5 by 5. */
function ball() {
  const b = new P.Buf(5, 5);
  sphere(
    b,
    2.5,
    2.5,
    2.5,
    ['neutral-50', 'neutral-80', 'paper-96', 'paper-99', 'paper-99'].map((t) => {
      const h = C(t);
      return [h & 255, (h >>> 8) & 255, (h >>> 16) & 255];
    }),
    { steps: [0, 1, 2], hl: 3, hlr: 0.35 },
  );
  return b;
}
/** Where the ball sits: in pocket `n` or on the track at angle `a`. Top left of the 5x5 sprite. */
function ballAt(n, a = null) {
  if (a === null) {
    const i = WHEEL.indexOf(n);
    const ang = angleOf(i),
      r = (R.numIn + R.pocketIn) / 2 + 0.5;
    return [Math.round(CX + Math.cos(ang) * r - 2.5), Math.round(CY + Math.sin(ang) * r - 2.5)];
  }
  const r = (R.track + R.numOut) / 2;
  return [Math.round(CX + Math.cos(a) * r - 2.5), Math.round(CY + Math.sin(a) * r - 2.5)];
}
function withBall(w, pos) {
  const o = new P.Buf(w.w, w.h);
  o.px.set(w.px);
  // shadow down-right, then the ball
  const [x, y] = pos;
  for (const [dx, dy] of [
    [2, 4],
    [3, 4],
    [4, 3],
    [4, 2],
    [3, 3],
  ]) {
    const c = o.get(x + dx, y + dy);
    if (c) o.pset(x + dx, y + dy, darker(c, 0.6));
  }
  paste(o, ball(), x, y);
  return o;
}

/** Betting board 176 by 58: zero, the 3 by 12 grid, dozens, the outside row. `lines` get chips. */
const BW = 176,
  BH = 60;
const CELL = { w: 13, h: 11, x0: 13, y0: 2 };
function cellOfNumber(n) {
  if (n === 0) return [2, CELL.y0, 11, CELL.h * 3];
  const col = Math.floor((n - 1) / 3),
    row = 2 - ((n - 1) % 3);
  return [CELL.x0 + col * CELL.w, CELL.y0 + row * CELL.h, CELL.w, CELL.h];
}
const OUTSIDE = ['low', 'even', 'red', 'black', 'odd', 'high'];
function cellOfKind(kind, number) {
  if (kind === 'number') return cellOfNumber(number);
  const dz = ['dozen1', 'dozen2', 'dozen3'].indexOf(kind);
  if (dz >= 0) return [CELL.x0 + dz * CELL.w * 4, CELL.y0 + CELL.h * 3, CELL.w * 4, CELL.h];
  const o = OUTSIDE.indexOf(kind);
  return [CELL.x0 + o * CELL.w * 2, CELL.y0 + CELL.h * 4, CELL.w * 2, CELL.h];
}

const WORD = {
  E: ['###', '#..', '##.', '#..', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  N: ['#.#', '###', '###', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  '-': ['...', '...', '###', '...', '...'],
};
function word(b, x, y, s, c) {
  [...s].forEach((ch, k) => {
    const g = WORD[ch];
    if (!g) {
      text3(b, x + k * 4, y, ch, c);
      return;
    }
    g.forEach((row, j) => [...row].forEach((v, i) => v === '#' && b.pset(x + k * 4 + i, y + j, c)));
  });
}

function board(lines = []) {
  const b = new P.Buf(BW, BH);
  const felt = cmat('felt').map((c) => P.col(c));
  const gl = cmat('feltLine').map((c) => P.col(c));
  b.px.fill(felt[2]);
  const white = C('paper-99');
  const cellBox = ([x, y, w, h]) => {
    for (let i = x; i < x + w + 1; i++) {
      b.pset(i, y, gl[3]);
      b.pset(i, y + h, gl[1]);
    }
    for (let j = y; j < y + h + 1; j++) {
      b.pset(x, j, gl[3]);
      b.pset(x + w, j, gl[1]);
    }
  };
  // zero: a green cell with a pointed left side
  const [zx, zy, zw, zh] = cellOfNumber(0);
  for (let j = zy; j <= zy + zh; j++)
    for (let i = zx; i <= zx + zw; i++) {
      const slope = Math.abs(j - (zy + zh / 2)) / (zh / 2);
      if (i - zx < slope * 4) continue;
      const edge = i - zx < slope * 4 + 1 || j === zy || j === zy + zh;
      b.pset(i, j, edge ? gl[3] : COL.green[2]);
    }
  text3(b, zx + 5, zy + zh / 2 - 2, '0', white);
  for (let n = 1; n <= 36; n++) {
    const box = cellOfNumber(n);
    cellBox(box);
    const [x, y, w, h] = box;
    const set = COL[RED.has(n) ? 'red' : 'black'];
    // the number sits on an oval of its colour
    for (let j = 1; j < h; j++)
      for (let i = 1; i < w; i++) {
        const d = Math.hypot((i - w / 2) / (w / 2 - 1.2), (j - h / 2) / (h / 2 - 1.2));
        if (d <= 1) b.pset(x + i, y + j, d > 0.8 && i + j > (w + h) / 2 ? set[0] : set[3]);
      }
    const s = String(n);
    text3(b, x + Math.round((w - textW(s)) / 2), y + Math.round((h - 5) / 2), s, white);
  }
  const labels = {
    dozen1: '1-12',
    dozen2: '13-24',
    dozen3: '25-36',
    low: '1-18',
    even: 'EVEN',
    odd: 'ODD',
    high: '19-36',
  };
  for (const k of ['dozen1', 'dozen2', 'dozen3', ...OUTSIDE]) {
    const box = cellOfKind(k);
    cellBox(box);
    const [x, y, w, h] = box;
    if (k === 'red' || k === 'black') {
      const set = COL[k];
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const m = Math.abs(i - w / 2) / 7 + Math.abs(j - h / 2) / 4;
          if (m <= 1)
            b.pset(x + i, y + j, m > 0.75 ? (k === 'black' ? C('neutral-40') : set[0]) : set[3]);
        }
    } else {
      const s = labels[k];
      word(b, x + Math.round((w - (s.length * 4 - 1)) / 2), y + Math.round((h - 5) / 2), s, gl[4]);
    }
  }
  // chips on the lines, a little stack for repeats
  const colours = ['red', 'blue', 'green', 'violet', 'black', 'white'];
  lines.forEach((l, k) => {
    const [x, y, w, h] = cellOfKind(l.kind, l.number);
    const c = chip(colours[k % colours.length], 10);
    paste(b, c, x + Math.round(w / 2) - 5 + (l.dx ?? 0), y + Math.round(h / 2) - 4);
  });
  return b;
}

export {
  wheel,
  ball,
  ballAt,
  withBall,
  board,
  cellOfKind,
  WHEEL,
  SIZE,
  BW,
  BH,
  R,
  CX,
  CY,
  angleOf,
};
