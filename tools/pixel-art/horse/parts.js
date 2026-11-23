import { pathToFileURL } from 'node:url';
// Step 3: split each silhouette into parts (rider, body, tail, mane, head, legs) at full size.
import { P, out } from '../lib/env.js';
import { masks } from './masks.js';
import { erodeM, dilateM } from './masks.js';

/** The 8 frames of one stride: plate numbers 3 to 10 (frame 11 repeats frame 3). */
const FRAME_IDS = [3, 4, 5, 6, 7, 8, 9, 10];
const L = {
  NONE: 0,
  BODY: 1,
  TAIL: 2,
  MANE: 3,
  HEAD: 4,
  LEG: 5,
  RIDER: 6,
  POINT: 7,
  HOOF: 8,
  CAP: 9,
  FACE: 10,
};

function topY(m, w, h, x) {
  for (let y = 0; y < h; y++) if (m[y * w + x]) return y;
  return -1;
}

function split(frame) {
  const { w, h, m } = frame;
  // rider head column: mean x of the first rows
  let y0 = 0;
  while (y0 < h && !m.subarray(y0 * w, (y0 + 1) * w).some(Boolean)) y0++;
  let sx = 0,
    sn = 0;
  for (let y = y0; y < y0 + 4; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        sx += x;
        sn++;
      }
  const xr = Math.round(sx / sn);
  const lab = new Uint8Array(w * h);
  const xl = xr - 90,
    xrr = xr + 28;
  const yl = topY(m, w, h, xl),
    yrr = topY(m, w, h, xrr);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      lab[y * w + x] = L.BODY;
      if (x >= xl && x <= xrr) {
        const yb = yl + ((yrr - yl) * (x - xl)) / (xrr - xl);
        if (y < yb - 4) lab[y * w + x] = L.RIDER;
      }
    }
  refine(frame, lab, xr, y0, xrr);
  return { xr, y0, lab, xl, xrr, yl, yrr };
}

/** Body, tail, mane, head, legs: found with a big opening that removes everything thin. */
function refine(frame, lab, xr, y0, xrr) {
  const { w, h } = frame;
  const horse = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) horse[i] = lab[i] === L.BODY ? 1 : 0;
  const trunk = dilateM(erodeM(horse, w, h, 34), w, h, 34);
  const trunkD = dilateM(trunk, w, h, 26);
  let tx0 = w,
    tx1 = 0,
    ty1 = 0,
    sumB = 0,
    nB = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (trunk[y * w + x]) {
        if (x < tx0) tx0 = x;
        if (x > tx1) tx1 = x;
      }
  for (let x = tx0; x <= tx1; x++) {
    let b = -1;
    for (let y = h - 1; y >= 0; y--)
      if (trunk[y * w + x]) {
        b = y;
        break;
      }
    if (b >= 0) {
      sumB += b;
      nB++;
      ty1 = Math.max(ty1, b);
    }
  }
  const belly = Math.round(sumB / nB) - 6;
  let nose = 0;
  for (let i = 0; i < w * h; i++) if (horse[i]) nose = Math.max(nose, i % w);
  const headX = tx1 + Math.round((nose - tx1) * 0.42);
  const legSeed = new Uint8Array(w * h);
  for (let y = belly; y < h; y++)
    for (let x = 0; x < w; x++) if (horse[y * w + x] && x < nose) legSeed[y * w + x] = 1;
  // legs: connected pieces of the seed; each knows its own length
  const lc = new Int32Array(w * h);
  let nl = 0;
  const lenMax = [];
  for (let i = 0; i < w * h; i++) {
    if (!legSeed[i] || lc[i]) continue;
    nl++;
    const st = [i];
    lc[i] = nl;
    let ymax = 0;
    while (st.length) {
      const p = st.pop();
      const x = p % w,
        y = (p / w) | 0;
      ymax = Math.max(ymax, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const X = x + dx,
          Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (legSeed[q] && !lc[q]) {
          lc[q] = nl;
          st.push(q);
        }
      }
    }
    lenMax[nl] = ymax;
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (lab[i] !== L.BODY) continue;
      if (lc[i]) {
        const t = (y - belly) / Math.max(1, lenMax[lc[i]] - belly);
        lab[i] = t > 0.9 ? L.HOOF : t > 0.42 ? L.POINT : L.BODY;
      } else if (!trunkD[i] && x < tx0 + 6) lab[i] = L.TAIL;
      else if (!trunkD[i] && x > headX) lab[i] = L.HEAD;
    }
  // mane: the top rows of the neck, between the withers and the ears
  for (let x = xrr; x < headX + 20; x++) {
    let t = -1;
    for (let y = 0; y < h; y++)
      if (lab[y * w + x] === L.BODY || lab[y * w + x] === L.HEAD) {
        t = y;
        break;
      }
    if (t < 0) continue;
    for (let y = t; y < t + 15 && y < h; y++)
      if (lab[y * w + x] === L.BODY) lab[y * w + x] = L.MANE;
  }
  // rider: cap on top, face below it, silks for the rest
  let rt = h,
    rb = 0;
  for (let i = 0; i < w * h; i++)
    if (lab[i] === L.RIDER) {
      const y = (i / w) | 0;
      rt = Math.min(rt, y);
      rb = Math.max(rb, y);
    }
  for (let i = 0; i < w * h; i++)
    if (lab[i] === L.RIDER) {
      const y = (i / w) | 0,
        t = (y - rt) / Math.max(1, rb - rt);
      if (t < 0.17) lab[i] = L.CAP;
    }
  frame.geo = { tx0, tx1, belly, nose, headX };
}
const parts = FRAME_IDS.map((id) => ({ id, ...masks[id - 1], ...split(masks[id - 1]) }));
/** The standing horse of plate frame 12 without its rider, for the stable portrait and the icon. */
const stand = (() => {
  const f = { id: 12, ...masks[11], ...split(masks[11]) };
  for (let i = 0; i < f.w * f.h; i++) if (f.lab[i] === L.RIDER || f.lab[i] === L.CAP) f.lab[i] = 0;
  return f;
})();
export { parts, stand, FRAME_IDS, L, split };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tint = {
    1: [200, 90, 60],
    2: [150, 80, 200],
    3: [240, 220, 60],
    4: [60, 200, 120],
    5: [120, 120, 130],
    6: [60, 160, 220],
    7: [90, 90, 100],
    8: [250, 250, 250],
    9: [20, 80, 160],
    10: [240, 190, 150],
  };
  const items = parts.map((f) => {
    const b = new P.Buf(f.w, f.h);
    for (let k = 0; k < f.w * f.h; k++)
      if (f.lab[k]) {
        const c = tint[f.lab[k]];
        b.px[k] = P.rgb(c[0], c[1], c[2]);
      }
    return {
      buf: P.resize(b, (f.w / 2) | 0, (f.h / 2) | 0),
      label: '#' + f.id + ' xr' + f.xr,
      scale: 1,
    };
  });
  P.save(P.sheet(items, { cols: 4, scale: 1 }), out('parts_rider.png'));
}
