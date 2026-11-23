// Step 4: pixels. Light every silhouette as a round body (top left light), cut it into sprite
// cells, and colour each cell from its part's ramp with a dither strip only where two bands meet.
import { P } from '../lib/env.js';
import { parts, L } from './parts.js';
import { tok, ramp, COATS, SILKS } from '../lib/palette.js';

function chamfer(m, w, h) {
  const d = new Float32Array(w * h);
  const INF = 1e6;
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[y * w + x]) {
        d[y * w + x] = Math.min(
          d[y * w + x],
          at(x - 1, y) + 1,
          at(x, y - 1) + 1,
          at(x - 1, y - 1) + 1.414,
          at(x + 1, y - 1) + 1.414,
        );
      }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--)
      if (d[y * w + x]) {
        d[y * w + x] = Math.min(
          d[y * w + x],
          at(x + 1, y) + 1,
          at(x, y + 1) + 1,
          at(x + 1, y + 1) + 1.414,
          at(x - 1, y + 1) + 1.414,
        );
      }
  return d;
}
function maxFilter(a, w, h, r) {
  const t = new Float32Array(w * h),
    o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++)
        m = Math.max(m, a[y * w + k]);
      t[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++)
        m = Math.max(m, t[k * w + x]);
      o[y * w + x] = m;
    }
  return o;
}
function blur(a, w, h, r) {
  const t = new Float32Array(w * h),
    o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0,
        n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        s += a[y * w + k];
        n++;
      }
      t[y * w + x] = s / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0,
        n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        s += t[k * w + x];
        n++;
      }
      o[y * w + x] = s / n;
    }
  return o;
}

/** Light value 0..1 per pixel: a round cross section under one light from the top left. */
function lightField(f) {
  const { w, h } = f;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = f.lab[i] ? 1 : 0;
  const d = chamfer(mask, w, h);
  const R = blur(maxFilter(d, w, h, 40), w, h, 10);
  const hh = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const r = Math.max(6, Math.min(R[i], 70)),
      u = Math.min(1, d[i] / r);
    hh[i] = r * Math.sqrt(1 - (1 - u) * (1 - u));
  }
  const hs = blur(hh, w, h, 3);
  const v = new Float32Array(w * h);
  const Lx = -0.55,
    Ly = -0.62,
    Lz = 0.56;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const gx = (hs[i + 1] - hs[i - 1]) / 2,
        gy = (hs[i + w] - hs[i - w]) / 2;
      const n = Math.hypot(gx, gy, 1);
      v[i] = (-gx * Lx - gy * Ly + Lz) / n;
    }
  return v;
}
for (const f of parts) f.v = lightField(f);

/** Sprite geometry: how many cells, how big a cell is on the plate, and where the rider sits. */
function geometry(W, H, frames = parts) {
  let top = 0,
    bottom = 1e9,
    left = 1e9,
    right = 0;
  for (const f of frames) {
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++)
        if (f.lab[y * f.w + x]) {
          top = Math.max(top, f.h - y);
          bottom = Math.min(bottom, f.h - y);
          left = Math.min(left, x - f.xr);
          right = Math.max(right, x - f.xr);
        }
  }
  const S = Math.max((right - left + 8) / W, (top - bottom + 8) / H);
  return { S, top, bottom, left, right };
}

const LABEL_PRIORITY = [L.HOOF, L.CAP, L.MANE, L.POINT, L.TAIL, L.HEAD, L.RIDER, L.BODY];

/** One frame -> { cells: [{i, label, v}], W, H } before colouring. */
function cut(f, W, H, geo, opt = {}) {
  const { S } = geo;
  const x0 = f.xr + geo.left - 4 - ((W * S - (geo.right - geo.left + 8)) / 2) * 0; // rider column anchors
  const yTop = f.h - geo.top - 4;
  const cells = [];
  const cov = opt.cover ?? 0.42;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const ax = Math.round(x0 + i * S),
        bx = Math.round(x0 + (i + 1) * S);
      const ay = Math.round(yTop + j * S),
        by = Math.round(yTop + (j + 1) * S);
      let n = 0,
        tot = 0,
        sv = 0;
      const cnt = {};
      for (let y = ay; y < by; y++)
        for (let x = ax; x < bx; x++) {
          tot++;
          if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
          const k = y * f.w + x,
            lab = f.lab[k];
          if (!lab) continue;
          n++;
          sv += f.v[k];
          cnt[lab] = (cnt[lab] || 0) + 1;
        }
      if (n / tot < cov) {
        cells.push(null);
        continue;
      }
      let best = 0,
        bc = -1;
      for (const l of LABEL_PRIORITY) {
        const c =
          (cnt[l] || 0) *
          (l === L.HOOF || l === L.MANE || l === L.CAP ? 2.2 : l === L.POINT ? 1.4 : 1);
        if (c > bc) {
          bc = c;
          best = l;
        }
      }
      cells.push({ label: best, v: sv / n });
    }
  return cells;
}

/** Colour one cut frame for a coat and a set of silks. Returns a P.Buf (outline added separately). */
function paint(cells, W, H, coatKey, silksKey) {
  const coat = COATS[coatKey];
  const body = ramp(coat.body),
    mane = ramp(coat.mane),
    points = ramp(coat.points ?? coat.body);
  const silks = ramp(SILKS[silksKey]);
  const dark = !!coat.points || coatKey === 'aoge';
  const buf = new P.Buf(W, H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = cells[j * W + i];
      if (!c) continue;
      const raw = (c.v - 0.1) / 0.8;
      const v = P.clamp(raw < 0.55 ? 0.55 - (0.55 - raw) * 0.62 : raw);
      const lo = dark ? 0 : 1;
      let col;
      switch (c.label) {
        case L.HOOF:
          col = coat.points ? tok('neutral-6') : body[0];
          break;
        case L.POINT:
          col = coat.points ? points[P.band(v, 3, i, j, 0.3)] : body[1 + P.band(v, 3, i, j, 0.3)];
          break;
        case L.MANE:
          col = mane[Math.min(4, lo + 1 + P.band(v, 3, i, j, 0.3))];
          break;
        case L.TAIL:
          col = mane[lo + P.band(v, 3, i, j, 0.3)];
          break;
        case L.CAP:
          col = silks[0];
          break;
        case L.RIDER:
          col = silks[P.band(v * 0.92, 3, i, j, 0.3)];
          break;
        default:
          col = body[1 + P.band(v, 4, i, j, 0.3)];
      }
      buf.px[j * W + i] = P.col(col);
    }
  return buf;
}

/** Eye: one cell on the head, a third of the way down from the brow and back from the nose. */
function addEye(buf, cells, W, H, coatKey) {
  const heads = [];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = cells[j * W + i];
      if (c && c.label === L.HEAD) heads.push([i, j]);
    }
  if (heads.length < 3) return;
  const x0 = Math.min(...heads.map((p) => p[0])),
    x1 = Math.max(...heads.map((p) => p[0]));
  const y0 = Math.min(...heads.map((p) => p[1])),
    y1 = Math.max(...heads.map((p) => p[1]));
  const tx = x0 + (x1 - x0) * 0.3,
    ty = y0 + (y1 - y0) * 0.3;
  let best = null,
    bd = 1e9;
  for (const [i, j] of heads) {
    const d = (i - tx) ** 2 + (j - ty) ** 2;
    if (d < bd) {
      bd = d;
      best = [i, j];
    }
  }
  const coat = COATS[coatKey];
  const dark = !!coat.points || coatKey === 'aoge' || coatKey === 'tochiguri';
  buf.px[best[1] * W + best[0]] = P.col(dark ? tok('neutral-65') : tok('neutral-6'));
}

/** Outline in the sprite's own ramp: light side takes a mid step, the others the darkest. */
function finish(buf, coatKey) {
  const body = ramp(COATS[coatKey].body);
  const dark = !!COATS[coatKey].points || coatKey === 'aoge' || coatKey === 'tochiguri';
  const lit = coatKey === 'aoge' ? tok('neutral-35') : body[2];
  const shade = dark ? tok('neutral-4') : body[0];
  return P.selout(buf, lit, shade, { dir: [-1, -1] });
}
export { geometry, cut, paint, addEye, finish, lightField, parts, L };
