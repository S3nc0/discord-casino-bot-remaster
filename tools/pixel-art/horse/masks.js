import { pathToFileURL } from 'node:url';
// Step 2: background removal. The plate is a plain light ground with a dark silhouette, so a
// threshold gives the mask; ruled ground lines and numbers are removed by opening + keeping the
// biggest piece, then growing it back inside the original mask.
import { P, out } from '../lib/env.js';
import { cells, lum } from './cells.js';

function disk(r) {
  const o = [];
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) o.push([x, y]);
  return o;
}
function erodeM(m, w, h, r) {
  const d = disk(r),
    o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (const [dx, dy] of d) {
        const X = x + dx,
          Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || !m[Y * w + X]) {
          ok = 0;
          break;
        }
      }
      o[y * w + x] = ok;
    }
  return o;
}
function dilateM(m, w, h, r) {
  const d = disk(r),
    o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (const [dx, dy] of d) {
        const X = x + dx,
          Y = y + dy;
        if (X >= 0 && Y >= 0 && X < w && Y < h) o[Y * w + X] = 1;
      }
    }
  return o;
}
function biggest(m, w, h) {
  const lab = new Int32Array(w * h),
    sizes = [0];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    n++;
    let c = 0;
    const st = [i];
    lab[i] = n;
    while (st.length) {
      const p = st.pop();
      c++;
      const x = p % w,
        y = (p / w) | 0;
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
        if (m[q] && !lab[q]) {
          lab[q] = n;
          st.push(q);
        }
      }
    }
    sizes[n] = c;
  }
  let best = 1;
  for (let k = 1; k <= n; k++) if (sizes[k] > sizes[best]) best = k;
  const o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = lab[i] === best ? 1 : 0;
  return o;
}

function maskOf(cell) {
  const { w, h } = cell;
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) raw[i] = lum(cell.px[i]) < 75 ? 1 : 0;
  // drop the numbered strip at the top
  for (let y = 0; y < 45; y++) raw.fill(0, y * w, (y + 1) * w);
  const seed = biggest(dilateM(erodeM(raw, w, h, 5), w, h, 5), w, h);
  const grown = dilateM(seed, w, h, 9);
  const o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = raw[i] && grown[i] ? 1 : 0;
  return biggest(o, w, h);
}
const masks = cells.map((c) => ({ w: c.w, h: c.h, m: maskOf(c) }));
export { masks, disk, erodeM, dilateM, biggest };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const items = masks.map(({ w, h, m }, i) => {
    const b = new P.Buf(w, h);
    for (let k = 0; k < w * h; k++) if (m[k]) b.px[k] = P.rgb(200, 90, 60);
    return { buf: P.resize(b, (w / 3) | 0, (h / 3) | 0), label: '#' + (i + 1), scale: 1 };
  });
  P.save(P.sheet(items, { cols: 4, scale: 1 }), out('masks.png'));
}
