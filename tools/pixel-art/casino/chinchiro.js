// Chinchiro: a porcelain donburi seen from above at a slant on a tatami floor, and dice rendered
// as real cubes (so the tumble frames turn correctly). One light from the top left.
import { P } from '../lib/env.js';
import { C, cmat, darker, lambert, paste } from './kit.js';
import { coin, chipStack } from './shared.js';

const TW = 88,
  TH = 84;

/** Tatami, seamless in both directions over a 88 by 84 tile: woven rush rows and a dark border. */
function tatami(w = TW, h = TH) {
  const b = new P.Buf(w, h);
  const t = cmat('tatami').map((c) => P.col(c));
  const heri = cmat('heri').map((c) => P.col(c));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // border cloth along the bottom of each mat (2 rows of a dark band with a stitch line)
      const ry = y % h;
      if (ry >= h - 5) {
        b.pset(
          x,
          y,
          ry === h - 5 ? heri[3] : ry === h - 1 ? heri[0] : (x + ry) % 6 === 0 ? heri[2] : heri[1],
        );
        continue;
      }
      // rush weave: fine rows across, faint warp threads every 6 columns, a soft wide sheen
      const sheen = 0.5 + 0.5 * Math.sin(((x * 0.7 + y * 0.25) / w) * Math.PI * 2);
      let k = y % 2 === 0 ? 2 : 3;
      if (x % 6 === 0 && y % 2 === 1) k = 2;
      if (sheen < 0.2 && y % 2 === 0) k = 1;
      if (sheen > 0.85 && y % 2 === 1 && x % 6 !== 0) k = 4;
      b.pset(x, y, t[k]);
    }
  return b;
}

const ELL = 0.74; // the bowl seen at a slant: vertical squash

/** Donburi bowl, rim radius r, drawn into b at centre (cx, cy). Returns the interior ellipse. */
function bowl(b, cx, cy, r = 36) {
  const por = cmat('porcelain').map((c) => P.col(c));
  const blue = cmat('cobalt').map((c) => P.col(c));
  const ry = r * ELL;
  const wall = 10; // visible outer wall height at the front
  // contact shadow on the tatami, down and to the right
  for (let y = Math.floor(cy - ry); y <= cy + ry + wall + 4; y++)
    for (let x = Math.floor(cx - r); x <= cx + r + 4; x++) {
      const dx = (x + 0.5 - cx - 3) / (r + 1),
        dy = (y + 0.5 - cy - wall * 0.6 - 3) / (ry + 2);
      if (dx * dx + dy * dy <= 1) {
        const c = b.get(x, y);
        if (c) b.pset(x, y, darker(c, 0.62));
      }
    }
  // outer wall: the lower half of the rim ellipse extruded down, cobalt band with a wave motif
  for (let y = Math.floor(cy); y <= cy + ry + wall + 1; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = (x + 0.5 - cx) / r;
      if (Math.abs(dx) > 1) continue;
      const yTop = cy + ry * Math.sqrt(1 - dx * dx);
      // the wall narrows toward the foot
      const foot = cy + ry * 0.7 * Math.sqrt(Math.max(0, 1 - (dx / 0.72) ** 2)) + wall + 2;
      const yb = Math.max(yTop, Math.min(yTop + wall, foot));
      if (y < yTop || y > yb) continue;
      const v = (y - yTop) / Math.max(1, yb - yTop);
      const light = lambert(dx, 0.2, 0.5 + 0.5 * Math.sqrt(1 - dx * dx));
      let c = light > 0.55 ? por[3] : light > 0.32 ? por[2] : por[1];
      // band: a cobalt stripe with a wave of small arches
      const ang = Math.atan2(0, dx);
      if (v > 0.3 && v < 0.75) {
        const u = Math.floor(Math.acos(Math.max(-1, Math.min(1, dx))) * r);
        const wave = u % 6 < 3 ? v < 0.5 : v > 0.55;
        c = wave ? blue[2] : light > 0.4 ? blue[4] : blue[3];
      }
      if (y >= yb - 0.5) c = por[0];
      void ang;
      b.pset(x, y, c);
    }
  // rim and interior
  const rin = r - 3;
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = (x + 0.5 - cx) / r,
        dy = (y + 0.5 - cy) / ry,
        d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const di = Math.hypot((x + 0.5 - cx) / rin, (y + 0.5 - cy) / (rin * ELL));
      if (di > 1) {
        // rim: lit on the top left
        b.pset(x, y, dx + dy < -0.5 ? por[4] : dx + dy > 0.6 ? por[2] : por[3]);
        continue;
      }
      // interior: concave, so the far (top left) wall is in shade and the near wall lit.
      // the inner wall's normal points toward the centre; the bottom is flat.
      const s = Math.min(1, di);
      const nx = -(x + 0.5 - cx) / rin,
        ny = -(y + 0.5 - cy) / (rin * ELL);
      const tilt = s > 0.55 ? (s - 0.55) / 0.45 : 0;
      const v = lambert(nx * tilt * 1.6, ny * tilt * 1.6, 1);
      let k = P.band(P.clamp((v - 0.35) / 0.55), 4, x, y, 0.2);
      // cobalt double line inside the rim, and a ring on the bottom
      if (di > 0.86 && di < 0.93) {
        b.pset(x, y, blue[3]);
        continue;
      }
      if (
        Math.abs(Math.hypot((x + 0.5 - cx) / rin, (y + 0.5 - cy - 4) / (rin * ELL)) - 0.34) < 0.045
      ) {
        b.pset(x, y, blue[4]);
        continue;
      }
      b.pset(x, y, por[Math.min(4, k + 1)]);
    }
  return { cx, cy, rx: rin - 2, ry: (rin - 2) * ELL };
}

/** Rotate a vector by Euler angles (x, then y, then z). */
function rot([x, y, z], [a, b2, c]) {
  let ca = Math.cos(a),
    sa = Math.sin(a);
  [y, z] = [y * ca - z * sa, y * sa + z * ca];
  ca = Math.cos(b2);
  sa = Math.sin(b2);
  [x, z] = [x * ca + z * sa, -x * sa + z * ca];
  ca = Math.cos(c);
  sa = Math.sin(c);
  [x, y] = [x * ca - y * sa, x * sa + y * ca];
  return [x, y, z];
}
const PIPS = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};
// face normals in cube space and the value on each (opposite faces sum to 7)
const FACES = [
  { n: [0, 0, 1], v: 1, u: [1, 0, 0], w: [0, 1, 0] },
  { n: [0, 0, -1], v: 6, u: [1, 0, 0], w: [0, 1, 0] },
  { n: [1, 0, 0], v: 3, u: [0, 1, 0], w: [0, 0, 1] },
  { n: [-1, 0, 0], v: 4, u: [0, 1, 0], w: [0, 0, 1] },
  { n: [0, 1, 0], v: 2, u: [1, 0, 0], w: [0, 0, 1] },
  { n: [0, -1, 0], v: 5, u: [1, 0, 0], w: [0, 0, 1] },
];
// rotation that brings face v to the top (+z toward the viewer)
const TOP = {
  1: [0, 0],
  6: [Math.PI, 0],
  3: [0, -Math.PI / 2],
  4: [0, Math.PI / 2],
  2: [Math.PI / 2, 0],
  5: [-Math.PI / 2, 0],
};

/**
 * A die `size` pixels across, rotated by `ang` [x, y, z] after `face` is put on top, seen from a
 * camera tilted `tilt` toward the front. Rendered 4x and reduced by majority, then outlined.
 */
function die(face, { size = 17, ang = [0, 0, 0], tilt = 0.5, pipsFrom = 0.45 } = {}) {
  const SS = 4,
    N = size * SS;
  const ivory = ['neutral-65', 'neutral-80', 'paper-92', 'paper-99'].map(C);
  const ink = C('neutral-10'),
    red = C('red-50');
  const base = TOP[face] ?? [0, 0];
  const R = (v) => rot(rot(rot(v, [base[0], base[1], 0]), ang), [tilt, 0, 0]);
  const faces = FACES.map((f) => ({ ...f, N: R(f.n), U: R(f.u), V: R(f.w) }));
  const half = size * 0.29; // cube half size in pixels
  const votes = new Map();
  const big = new Array(N * N).fill(0);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const px = (i + 0.5) / SS - size / 2,
        py = (j + 0.5) / SS - size / 2;
      // orthographic ray along -z: find the visible face (normal toward the viewer) that contains it
      let hit = 0,
        bestZ = -1e9;
      for (const f of faces) {
        if (f.N[2] <= 0.02) continue;
        const c = f.N.map((v) => v * half);
        // intersect: point p = (px, py, z) on the plane through c with normal N
        const z = c[2] - ((px - c[0]) * f.N[0] + (py - c[1]) * f.N[1]) / f.N[2];
        const d = [px - c[0], py - c[1], z - c[2]];
        const a = (d[0] * f.U[0] + d[1] * f.U[1] + d[2] * f.U[2]) / half,
          bb = (d[0] * f.V[0] + d[1] * f.V[1] + d[2] * f.V[2]) / half;
        // rounded corners: drop the extreme corners of each face
        if (Math.abs(a) > 1 || Math.abs(bb) > 1 || a * a * a * a + bb * bb * bb * bb > 1.55)
          continue;
        if (z > bestZ) {
          bestZ = z;
          const l = lambert(f.N[0], f.N[1], f.N[2]);
          let col = ivory[l > 0.62 ? 3 : l > 0.45 ? 2 : l > 0.2 ? 1 : 0];
          const pips = PIPS[f.v];
          const pr = f.v === 1 ? 0.42 : 0.24;
          if (f.N[2] > pipsFrom)
            for (const [pa, pb] of pips)
              if (Math.hypot(a - pa * 0.56, bb - pb * 0.56) < pr)
                col = f.v === 1 ? red : l > 0.55 ? ink : C('neutral-25');
          hit = col;
        }
      }
      big[j * N + i] = hit;
    }
  const out = new P.Buf(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      votes.clear();
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) {
          const c = big[(y * SS + j) * N + x * SS + i];
          votes.set(c, (votes.get(c) ?? 0) + 1);
        }
      // pips win ties (small dark details survive the reduction)
      let best = 0,
        bc = -1;
      for (const [c, n] of votes) {
        const w = n + (c === ink || c === red ? 5 : 0);
        if (w > bc) {
          bc = w;
          best = c;
        }
      }
      if (best && (votes.get(0) ?? 0) <= 9) out.px[y * size + x] = best;
    }
  // outline in the shade colour so the die reads on white porcelain
  const o = new P.Buf(size, size);
  o.px.set(out.px);
  const line = C('neutral-40');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (out.px[y * size + x]) continue;
      const n = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => out.get(x + dx, y + dy));
      if (n) o.px[y * size + x] = line;
    }
  return o;
}

/** Tumble: `n` frames of a die turning in the air about a slanted axis. */
function tumble(n = 6, size = 17) {
  const fr = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    fr.push(die(1, { size, ang: [t, t * 0.5 + 0.6, t * 0.25] }));
  }
  return fr;
}

/**
 * Final resting dice, face up, square to the camera. Pips are placed by hand on the top face so
 * they stay crisp: 2 by 2 ink pips, one 3 by 3 red pip for the 1. Two variants (the second one
 * shifted by a pixel in its sprite) so three dice do not look stamped.
 */
function restDice(size = 17) {
  const blank = die(1, { size, pipsFrom: 2, tilt: 0.36 });
  // top face: rows whose middle pixel has the top face colour
  const top = blank.get(Math.floor(size / 2), Math.floor(size / 2) - 2);
  let x0 = size,
    x1 = 0,
    y0 = size,
    y1 = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (blank.get(x, y) === top) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  const ink = C('neutral-10'),
    red = C('red-50'),
    redD = C('red-30');
  const cxs = [x0 + 1, x0 + 4, x0 + 7];
  const cys = [y0 + 1, y0 + 4, y0 + 7];
  if (process.env.DEBUG_DICE) console.log('top face', x0, x1, y0, y1);
  const out = {};
  for (let f = 1; f <= 6; f++) {
    const d = new P.Buf(size, size);
    d.px.set(blank.px);
    if (f === 1) {
      const cx = x0 + 3,
        cy = y0 + 3;
      d.rect(cx, cy, cx + 4, cy + 4, red);
      for (const [x, y] of [
        [cx, cy],
        [cx + 3, cy],
        [cx, cy + 3],
        [cx + 3, cy + 3],
      ])
        d.pset(x, y, blank.get(x, y));
      d.pset(cx + 3, cy + 2, redD);
      d.pset(cx + 2, cy + 3, redD);
    } else
      for (const [pa, pb] of PIPS[f]) {
        const x = cxs[pa + 1],
          y = cys[pb + 1];
        d.rect(x, y, x + 2, y + 2, ink);
      }
    out[f] = [d, d];
  }
  return out;
}

/** Shadow of a die on the bowl (an offset darkened blot). */
function shadowUnder(b, x, y, size, lift = 0) {
  const r = size * 0.42 - lift * 0.08;
  for (let j = -size; j <= size; j++)
    for (let i = -size; i <= size; i++) {
      const X = x + size / 2 + 2 + lift * 0.4 + i,
        Y = y + size / 2 + 3 + lift + j;
      if (Math.hypot(i / r, j / (r * 0.7)) > 1) continue;
      const c = b.get(X, Y);
      if (c) b.pset(X, Y, darker(c, 0.8));
    }
}

/** Spots on the bowl's bottom for three dice: a small triangle with jitter (top left corners). */
function diceSpots(inner, rng) {
  return [
    [-12, -3],
    [10, -5],
    [0, 8],
  ].map(([dx, dy]) => [
    inner.cx + dx + (rng() - 0.5) * 4 - 8.5,
    inner.cy + dy + (rng() - 0.5) * 3 - 8.5,
  ]);
}

/**
 * A seat tile: tatami with the bowl and its three dice. `dice` = values (null = empty bowl),
 * `rolling` frame index for the tumble, `dealer` adds the dealer's lacquer tray and bank.
 */
function seat({ dice = null, rolling = -1, dealer = false, seed = 1 } = {}) {
  const b = tatami();
  const cx = TW / 2,
    cy = TH / 2 - 4;
  if (dealer) {
    // red lacquer tray under the bowl, gold edge
    const lac = cmat('lacquer').map((c) => P.col(c));
    const gold = cmat('gold').map((c) => P.col(c));
    for (let y = 4; y < TH - 9; y++)
      for (let x = 2; x < TW - 2; x++) {
        const e = Math.min(x - 2, y - 4, TW - 3 - x, TH - 10 - y);
        if (e < 0) continue;
        if ((x - 2 < 3 && y - 4 < 3 - (x - 2)) || (TW - 3 - x < 3 && y - 4 < 3 - (TW - 3 - x)))
          continue;
        b.pset(
          x,
          y,
          e < 1
            ? x < TW / 2 && y < TH / 2
              ? gold[3]
              : gold[1]
            : e < 2
              ? lac[0]
              : (x + y) % 23 === 0
                ? lac[3]
                : lac[2],
        );
      }
    // the bank: coins stacked on the tray corners
    const cs = coin(0, 10);
    for (let k = 0; k < 4; k++) paste(b, cs, 4, TH - 24 - k * 2);
    for (let k = 0; k < 2; k++) paste(b, cs, 13, TH - 22 - k * 2);
    paste(b, chipStack('black', 4, 10), TW - 13, TH - 26);
  }
  const inner = bowl(b, cx, cy, 34);
  if (dice) {
    const rng = P.rng(seed);
    const rest = restDice();
    const spots = diceSpots(inner, rng);
    const tum = rolling >= 0 ? tumble() : null;
    dice.forEach((v, i) => {
      const [x, y] = spots[i].map(Math.round);
      if (tum) {
        const lift = 3 + ((rolling + i * 2) % 3);
        shadowUnder(b, x, y, 17, lift);
        paste(b, tum[(rolling + i * 2) % tum.length], x, y - lift);
      } else {
        shadowUnder(b, x, y, 17, 0);
        paste(b, rest[v][Math.floor(rng() * 2)], x, y);
      }
    });
  }
  return b;
}

export { tatami, bowl, die, tumble, restDice, seat, shadowUnder, diceSpots, TW, TH };
