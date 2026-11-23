// Small shapes drawn in code, at 8x resolution, lit as round or flat parts and cut into cells.
// Used for every icon that needs no photo: each part has an id, a ramp (dark to light) and a
// roundness. One light, from the top left. Dither only in a thin strip where two bands meet.
import { P } from './env.js';

const K = 8;

function chamfer(m, w, h) {
  const d = new Float32Array(w * h),
    INF = 1e6;
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[y * w + x])
        d[y * w + x] = Math.min(
          d[y * w + x],
          at(x - 1, y) + 1,
          at(x, y - 1) + 1,
          at(x - 1, y - 1) + 1.414,
          at(x + 1, y - 1) + 1.414,
        );
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--)
      if (d[y * w + x])
        d[y * w + x] = Math.min(
          d[y * w + x],
          at(x + 1, y) + 1,
          at(x, y + 1) + 1,
          at(x + 1, y + 1) + 1.414,
          at(x - 1, y + 1) + 1.414,
        );
  return d;
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

class Hi {
  /** `w` and `h` in cells. */
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.W = w * K;
    this.H = h * K;
    this.id = new Uint8Array(this.W * this.H); // part id per hi-res pixel, 0 = empty
    this.height = new Float32Array(this.W * this.H); // extra height from dome parts
    this.parts = {}; // id -> { ramp, round, lo, hi, flat }
    this.n = 0;
  }
  /** Declare a part: ramp is an array of [r,g,b] dark to light. `round` is the radius (cells) over which the edge curves; 0 is flat. */
  part(ramp, opt = {}) {
    const id = ++this.n;
    this.parts[id] = {
      ramp,
      round: opt.round ?? 1.2,
      flat: opt.flat ?? 0.55,
      lo: opt.lo ?? 0.12,
      hi: opt.hi ?? 0.92,
      strip: opt.strip ?? 0.28,
      dither: opt.dither !== false,
      tilt: opt.tilt ?? [0, 0],
      outline: opt.outline,
      litStep: opt.litStep,
      fixed: opt.fixed,
      bevel: !!opt.bevel,
      steps: opt.steps ?? [1, 2, 3],
      gain: opt.gain ?? 2.4,
    };
    return id;
  }
  _fill(id, inside) {
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++)
        if (inside((x + 0.5) / K, (y + 0.5) / K)) this.id[y * this.W + x] = id;
    return this;
  }
  rect(id, x, y, w, h) {
    return this._fill(id, (px, py) => px >= x && px < x + w && py >= y && py < y + h);
  }
  ellipse(id, cx, cy, rx, ry, rot = 0) {
    const c = Math.cos(rot),
      s = Math.sin(rot);
    return this._fill(id, (px, py) => {
      const dx = px - cx,
        dy = py - cy,
        u = dx * c + dy * s,
        v = -dx * s + dy * c;
      return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
    });
  }
  poly(id, pts) {
    return this._fill(id, (px, py) => {
      let ins = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i],
          [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) ins = !ins;
      }
      return ins;
    });
  }
  rrect(id, x, y, w, h, r) {
    return this._fill(id, (px, py) => {
      if (px < x || px > x + w || py < y || py > y + h) return false;
      const cx = Math.min(Math.max(px, x + r), x + w - r),
        cy = Math.min(Math.max(py, y + r), y + h - r);
      return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
    });
  }
  /** A rectangle turned by `deg` degrees around its centre. */
  rot(id, cx, cy, w, h, deg) {
    const a = (deg * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    return this._fill(id, (px, py) => {
      const dx = px - cx,
        dy = py - cy,
        u = dx * c + dy * s,
        v = -dx * s + dy * c;
      return Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2;
    });
  }
  /** A thick line with round ends. */
  line(id, x0, y0, x1, y1, wd) {
    return this._fill(id, (px, py) => {
      const dx = x1 - x0,
        dy = y1 - y0,
        l2 = dx * dx + dy * dy || 1;
      const t = P.clamp(((px - x0) * dx + (py - y0) * dy) / l2);
      return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) <= wd / 2;
    });
  }
  /** Pixel-exact cells: rows of characters, `.` empty, others mapped by `map` to part ids. */
  cells(x0, y0, rows, map) {
    rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        const id = map[ch];
        if (id) this.rect(id, x0 + i, y0 + j, 1, 1);
      }),
    );
    return this;
  }
  erase(inside) {
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++)
        if (inside((x + 0.5) / K, (y + 0.5) / K)) this.id[y * this.W + x] = 0;
    return this;
  }

  /** Per hi-res pixel light 0..1, computed on each part's own mask so overlapping parts shade on their own. */
  _light() {
    const { W, H } = this,
      v = new Float32Array(W * H);
    const Lx = -0.55,
      Ly = -0.62,
      Lz = 0.56;
    for (const sid of Object.keys(this.parts)) {
      const id = +sid,
        p = this.parts[id];
      const mask = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) mask[i] = this.id[i] === id ? 1 : 0;
      const d = chamfer(mask, W, H);
      const R = Math.max(0.01, p.round * K);
      const hh = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++)
        if (mask[i]) {
          const u = Math.min(1, d[i] / R);
          hh[i] = p.round > 0 ? R * Math.sqrt(1 - (1 - u) * (1 - u)) : 0;
          hh[i] += this.height[i];
        }
      const hs = blur(hh, W, H, Math.max(1, Math.round(K * 0.3)));
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!mask[i]) continue;
          const gx = (hs[i + 1] - hs[i - 1]) / 2,
            gy = (hs[i + W] - hs[i - W]) / 2;
          const n = Math.hypot(gx, gy, 1);
          const base = (-gx * Lx - gy * Ly + Lz) / n;
          v[i] = base + p.tilt[0] * 0 + p.tilt[1] * 0;
        }
    }
    return v;
  }

  /** Cut into cells. Returns { buf, owner } with `owner[j*w+i]` the part id of each filled cell. */
  render(opt = {}) {
    const { W, w, h } = this,
      v = this._light(),
      cover = opt.cover ?? 0.5;
    const buf = new P.Buf(w, h),
      owner = new Uint8Array(w * h),
      val = new Float32Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        let n = 0,
          sv = 0;
        const cnt = {};
        for (let y = j * K; y < (j + 1) * K; y++)
          for (let x = i * K; x < (i + 1) * K; x++) {
            const id = this.id[y * W + x];
            if (!id) continue;
            n++;
            sv += v[y * W + x];
            cnt[id] = (cnt[id] || 0) + 1;
          }
        if (n / (K * K) < cover) continue;
        let best = 0,
          bc = -1;
        for (const id of Object.keys(cnt))
          if (cnt[id] > bc) {
            bc = cnt[id];
            best = +id;
          }
        owner[j * w + i] = best;
        val[j * w + i] = sv / n;
      }
    const same = (i, j, id) => i >= 0 && j >= 0 && i < w && j < h && owner[j * w + i] === id;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const id = owner[j * w + i];
        if (!id) continue;
        const p = this.parts[id],
          c = val[j * w + i],
          r = p.ramp,
          [s0, s1, s2] = p.steps;
        let col;
        if (p.fixed !== undefined) col = r[p.fixed];
        else if (p.bevel) {
          const up = !same(i, j - 1, id) || !same(i - 1, j, id),
            dn = !same(i, j + 1, id) || !same(i + 1, j, id);
          col = r[up && !dn ? s2 : dn && !up ? s0 : s1];
        } else {
          const t = P.clamp(0.5 + (c - 0.56) * p.gain);
          col = r[p.steps[P.band(t, 3, i, j, p.dither ? p.strip : 0.001)]];
        }
        buf.px[j * w + i] = P.col(col);
      }
    return { buf, owner, val };
  }
}

/**
 * Outline made of the sprite's own colours: each new pixel takes the darkest step of the part it
 * touches, and a middle step on the side facing the light (top left). Leave a 1 cell margin.
 */
function selectiveOutline(buf, owner, parts) {
  const { w, h } = buf,
    out = new P.Buf(w, h);
  out.px.set(buf.px);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (owner[y * w + x]) continue;
      let pick = 0,
        lit = false;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const X = x + dx,
          Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const id = owner[Y * w + X];
        if (!id || parts[id].outline === false) continue;
        const isLit = dx > 0 || dy > 0;
        if (!pick || (isLit && !lit)) {
          pick = id;
          lit = isLit;
        }
      }
      if (!pick) continue;
      const r = parts[pick].ramp;
      out.px[y * w + x] = P.col(lit ? r[Math.min(parts[pick].litStep ?? 2, r.length - 1)] : r[0]);
    }
  return out;
}
export { Hi, selectiveOutline, K };
